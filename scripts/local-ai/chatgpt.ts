/** Local-only ChatGPT plan provider. Implements the public Sign in with ChatGPT
 * protocol; it never reads credentials belonging to Codex or another app. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import lockfile from "proper-lockfile";
import { LocalAiProviderError, type LocalAiProvider, type LocalAiProviderStatus } from "./types";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SHARING = "chatgpt.tokens.use.direct";
const SCOPES = `openid profile email offline_access resource.invoke ${SHARING}`;
const TERMINAL_REFRESH = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);
const KNOWN_ERRORS = new Set([
  ...TERMINAL_REFRESH,
  "invalid_client",
  "subscription_sharing_user_not_eligible",
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_usage_unavailable",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user",
  "subscription_sharing_user_unavailable",
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
]);
function fail(code: string): never {
  throw new LocalAiProviderError(code);
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown, maximum = 32_768): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;
const issuedClient = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_-]{1,200}$/.test(value) &&
  value !== "dynamic_agent_client";
const safeError = (error: unknown, fallback = "chatgpt_request_failed") =>
  error instanceof LocalAiProviderError ? error.code : fallback;

interface Credentials {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  earliestRefreshAt: number;
  scopes: string[];
}
interface Connection {
  version: 1;
  hostId: string;
  clientId?: string;
  subject?: string;
  email?: string;
  credentials?: Credentials;
  /** A rotated token is saved before identity verification, so a temporary JWKS
   * outage cannot lose the only valid replacement refresh token. */
  pendingRefresh?: Credentials;
}
interface Protection {
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}
interface Options {
  fetcher?: typeof fetch;
  openBrowser?: (url: string) => Promise<void>;
  protection?: Protection;
  now?: () => number;
}

function powershell(script: string, input = ""): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new LocalAiProviderError("chatgpt_storage_error"));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      output += data;
      if (output.length > 2_000_000) child.kill();
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(new LocalAiProviderError("chatgpt_storage_error"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new LocalAiProviderError("chatgpt_storage_error"));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

function credentialProtection(): Protection {
  if (process.platform !== "win32") {
    // The store enforces 0700/0600 and ownership on Unix; no insecure fallback
    // is used when Windows DPAPI fails.
    return {
      encrypt: async (value) => Buffer.from(value, "utf8"),
      decrypt: async (value) => value.toString("utf8"),
    };
  }
  const common =
    "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $e=[Text.Encoding]::UTF8.GetBytes('3z-prod.chatgpt.v1'); ";
  return {
    encrypt: async (value) =>
      Buffer.from(
        await powershell(
          common +
            "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser))",
          Buffer.from(value).toString("base64"),
        ),
        "base64",
      ),
    decrypt: async (value) =>
      Buffer.from(
        await powershell(
          common +
            "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser))",
          value.toString("base64"),
        ),
        "base64",
      ).toString("utf8"),
  };
}

async function openSystemBrowser(url: string): Promise<void> {
  if (process.platform === "win32") {
    // The authorization URL can contain an ID-token hint. It goes over stdin,
    // never a command line, log, or app/browser API response.
    await powershell(
      "$u=[Console]::In.ReadToEnd(); Start-Process -FilePath $u -WindowStyle Hidden",
      url,
    );
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
      stdio: "ignore",
    });
    child.on("error", () => reject(new LocalAiProviderError("chatgpt_connection_failed")));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new LocalAiProviderError("chatgpt_connection_failed")),
    );
  });
}

function validateCredentials(value: unknown): value is Credentials {
  return (
    object(value) &&
    string(value.accessToken) &&
    string(value.refreshToken) &&
    string(value.idToken) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt) &&
    typeof value.earliestRefreshAt === "number" &&
    Number.isFinite(value.earliestRefreshAt) &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => typeof scope === "string")
  );
}

function validateConnection(value: unknown): Connection {
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.hostId !== "string" ||
    !/^urn:uuid:[0-9a-f-]{36}$/.test(value.hostId) ||
    (value.clientId !== undefined && !issuedClient(value.clientId)) ||
    (value.subject !== undefined && !string(value.subject, 512)) ||
    (value.email !== undefined && !string(value.email, 320)) ||
    (value.credentials !== undefined && !validateCredentials(value.credentials)) ||
    (value.pendingRefresh !== undefined && !validateCredentials(value.pendingRefresh)) ||
    ((value.credentials || value.pendingRefresh) && (!value.clientId || !value.subject))
  )
    fail("chatgpt_storage_error");
  return value as unknown as Connection;
}

function tokenCredentials(value: unknown, now: number, previous?: Credentials): Credentials {
  if (
    !object(value) ||
    !string(value.access_token) ||
    !string(value.refresh_token) ||
    !string(value.id_token) ||
    value.token_type !== "Bearer" ||
    typeof value.expires_in !== "number" ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    (typeof value.scope !== "string" && !previous)
  )
    fail("chatgpt_invalid_token");
  const earliest =
    typeof value.earliest_refresh_at === "number"
      ? value.earliest_refresh_at * 1000
      : typeof value.earliest_refresh_at === "string"
        ? Date.parse(value.earliest_refresh_at)
        : 0;
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    idToken: value.id_token,
    expiresAt: now + value.expires_in * 1000,
    earliestRefreshAt: Number.isFinite(earliest) ? earliest : 0,
    scopes:
      typeof value.scope === "string" ? value.scope.split(/\s+/).filter(Boolean) : previous!.scopes,
  };
}

/** Instantiate only in the loopback server. The optional dependencies support
 * protocol tests; production callers pass only their app-owned storage path. */
export function createChatGptProvider(runtimeDir: string, options: Options = {}): LocalAiProvider {
  if (!isAbsolute(runtimeDir)) fail("chatgpt_storage_error");
  const directory = join(runtimeDir, "chatgpt");
  const filename = join(directory, "connection.dat");
  const protection = options.protection ?? credentialProtection();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let metadata:
    Promise<{ jwks: ReturnType<typeof createRemoteJWKSet>; revoke: string }> | undefined;
  let pending: AbortController | undefined;
  let signInTask: Promise<void> | undefined;
  let statusRequest: Promise<LocalAiProviderStatus> | undefined;
  let listener: Server | undefined;
  let lastError: string | undefined;
  let catalog:
    | {
        subject: string;
        clientId: string;
        expiresAt: number;
        models: LocalAiProviderStatus["models"];
      }
    | undefined;
  const activeRequests = new Set<AbortController>();

  async function request(url: string, init: RequestInit = {}, timeout = 60_000): Promise<Response> {
    try {
      return await fetcher(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(timeout),
          ...(init.signal ? [init.signal] : []),
        ]),
      });
    } catch {
      return fail(init.signal?.aborted ? "request_cancelled" : "chatgpt_request_failed");
    }
  }
  async function readJson(response: Response): Promise<unknown> {
    const content = await response.text();
    if (content.length > 2_000_000) fail("chatgpt_invalid_response");
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      return fail("chatgpt_invalid_response");
    }
    if (!response.ok) {
      const error =
        object(data) && object(data.error)
          ? data.error.code
          : object(data)
            ? data.error
            : undefined;
      fail(
        typeof error === "string" && KNOWN_ERRORS.has(error)
          ? error
          : response.status === 401
            ? "chatgpt_sign_in_required"
            : response.status === 429
              ? "subscription_sharing_usage_limit_exceeded"
              : "chatgpt_request_failed",
      );
    }
    return data;
  }
  async function discovery() {
    if (!metadata)
      metadata = (async () => {
        const data = await readJson(await request(`${ISSUER}/.well-known/openid-configuration`));
        if (
          !object(data) ||
          data.issuer !== ISSUER ||
          typeof data.jwks_uri !== "string" ||
          typeof data.revocation_endpoint !== "string"
        )
          fail("chatgpt_invalid_identity");
        for (const url of [data.jwks_uri, data.revocation_endpoint])
          if (new URL(url).origin !== ISSUER) fail("chatgpt_invalid_identity");
        return {
          jwks: createRemoteJWKSet(new URL(data.jwks_uri), {
            [customFetch]: (url, init) => fetcher(url, { ...init, redirect: "error" }),
          }),
          revoke: data.revocation_endpoint,
        };
      })().catch((error) => {
        metadata = undefined;
        throw error;
      });
    return metadata;
  }
  async function verify(credentials: Credentials, clientId: string, nonce?: string) {
    const { jwks } = await discovery();
    try {
      const { payload } = await jwtVerify(credentials.idToken, jwks, {
        issuer: ISSUER,
        audience: clientId,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "iat"],
        currentDate: new Date(now()),
      });
      if (!string(payload.sub, 512) || (nonce !== undefined && payload.nonce !== nonce))
        fail("chatgpt_invalid_identity");
      return {
        subject: payload.sub,
        ...(string(payload.email, 320) ? { email: payload.email } : {}),
      };
    } catch (error) {
      if (error instanceof LocalAiProviderError) throw error;
      if (
        object(error) &&
        typeof error.code === "string" &&
        [
          "ERR_JWT_EXPIRED",
          "ERR_JWT_CLAIM_VALIDATION_FAILED",
          "ERR_JWT_INVALID",
          "ERR_JWS_INVALID",
          "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
          "ERR_JOSE_ALG_NOT_ALLOWED",
        ].includes(error.code)
      )
        fail("chatgpt_invalid_identity");
      return fail("chatgpt_identity_unavailable");
    }
  }

  async function withStore<T>(
    operation: (state: Connection, save: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const info = await lstat(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (process.platform !== "win32" && process.getuid && info.uid !== process.getuid())
      )
        fail("chatgpt_storage_error");
      if (process.platform !== "win32") await chmod(directory, 0o700);
      let compromised = false;
      const release = await lockfile.lock(directory, {
        realpath: false,
        stale: 120_000,
        update: 20_000,
        retries: { retries: 100, minTimeout: 100, maxTimeout: 200 },
        onCompromised: () => {
          compromised = true;
        },
      });
      try {
        let state: Connection;
        try {
          const file = await lstat(filename);
          if (
            !file.isFile() ||
            file.isSymbolicLink() ||
            file.size > 2_000_000 ||
            (process.platform !== "win32" &&
              ((file.mode & 0o077) !== 0 || (process.getuid && file.uid !== process.getuid())))
          )
            fail("chatgpt_storage_error");
          state = validateConnection(
            JSON.parse(await protection.decrypt(await readFile(filename))),
          );
        } catch (error) {
          if (object(error) && error.code === "ENOENT")
            state = { version: 1, hostId: `urn:uuid:${randomUUID()}` };
          else throw error;
        }
        const save = async () => {
          if (compromised) fail("chatgpt_storage_error");
          const temporary = join(directory, `${randomUUID()}.tmp`);
          try {
            const encrypted = await protection.encrypt(JSON.stringify(state));
            await writeFile(temporary, encrypted, { flag: "wx", mode: 0o600 });
            if (compromised) fail("chatgpt_storage_error");
            await rename(temporary, filename);
          } finally {
            await rm(temporary, { force: true });
          }
        };
        return await operation(state, save);
      } finally {
        if (!compromised) await release();
      }
    } catch (error) {
      if (error instanceof LocalAiProviderError) throw error;
      return fail("chatgpt_storage_error");
    }
  }

  async function access(
    signal: AbortSignal,
  ): Promise<{ token: string; subject: string; clientId: string }> {
    return withStore(async (state, save) => {
      if (!state.clientId || !state.subject || !state.credentials) fail("chatgpt_sign_in_required");
      let credentials = state.credentials;
      if (state.pendingRefresh || credentials.expiresAt <= now() + 60_000) {
        if (!state.pendingRefresh && credentials.earliestRefreshAt > now()) {
          if (credentials.expiresAt <= now()) fail("chatgpt_refresh_not_ready");
        } else {
          try {
            // Do not cancel a rotation after it has been sent. Persist its
            // replacement even if the requesting tab closes in the meantime.
            if (!state.pendingRefresh) {
              signal.throwIfAborted();
              const data = await readJson(
                await request(`${ISSUER}/api/accounts/oauth/token`, {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: state.clientId,
                    refresh_token: credentials.refreshToken,
                    resource: RESOURCE,
                  }),
                }),
              );
              state.pendingRefresh = tokenCredentials(data, now(), credentials);
              await save();
            }
            const identity = await verify(state.pendingRefresh, state.clientId);
            if (identity.subject !== state.subject) fail("chatgpt_account_mismatch");
            credentials = state.pendingRefresh;
            state.credentials = credentials;
            state.email = identity.email;
            delete state.pendingRefresh;
            await save();
          } catch (error) {
            const code = safeError(error);
            if (
              TERMINAL_REFRESH.has(code) ||
              code === "chatgpt_account_mismatch" ||
              code === "chatgpt_invalid_identity"
            ) {
              delete state.credentials;
              delete state.pendingRefresh;
              catalog = undefined;
              await save();
            }
            throw error;
          }
        }
      }
      signal.throwIfAborted();
      if (!credentials.scopes.includes(SHARING)) fail("chatgpt_sharing_disabled");
      if (credentials.expiresAt <= now()) fail("chatgpt_refresh_not_ready");
      return { token: credentials.accessToken, subject: state.subject, clientId: state.clientId };
    });
  }

  async function models(
    signal: AbortSignal,
    force = false,
  ): Promise<LocalAiProviderStatus["models"]> {
    const account = await access(signal);
    if (
      !force &&
      catalog?.subject === account.subject &&
      catalog.clientId === account.clientId &&
      catalog.expiresAt > now()
    )
      return catalog.models;
    const data = await readJson(
      await request(`${RESOURCE}/models`, {
        headers: { Authorization: `Bearer ${account.token}` },
        signal,
      }),
    );
    if (!object(data) || !Array.isArray(data.models)) fail("chatgpt_invalid_response");
    const result: LocalAiProviderStatus["models"] = [];
    for (const model of data.models) {
      if (!object(model) || model.visibility !== "list") continue;
      if (!string(model.slug, 200) || !string(model.display_name, 200))
        fail("chatgpt_invalid_response");
      // Only advertise effort values explicitly supplied by this account's
      // catalog. A model name is not evidence of support for a given effort.
      const levels = Array.isArray(model.supported_reasoning_levels)
        ? model.supported_reasoning_levels.map((level) => (object(level) ? level.effort : level))
        : model.supported_reasoning_efforts;
      const efforts = Array.isArray(levels)
        ? levels.filter(
            (level): level is string => typeof level === "string" && /^[a-z]{1,16}$/.test(level),
          )
        : [];
      result.push({
        id: model.slug,
        name: model.display_name,
        ...(efforts.length ? { efforts } : {}),
      });
    }
    catalog = {
      subject: account.subject,
      clientId: account.clientId,
      expiresAt: now() + 60_000,
      models: result,
    };
    return result;
  }

  async function loadStatus(): Promise<LocalAiProviderStatus> {
    try {
      const state = await withStore(async (value) => ({
        connected: Boolean(value.credentials),
        sharing: Boolean(value.credentials?.scopes.includes(SHARING)),
        account: value.email,
        accountId: value.clientId,
      }));
      let available: LocalAiProviderStatus["models"] = [];
      if (state.connected && state.sharing && !pending) {
        try {
          available =
            catalog && catalog.clientId === state.accountId && catalog.expiresAt > now()
              ? catalog.models
              : await models(AbortSignal.timeout(60_000));
          lastError = undefined;
        } catch (error) {
          lastError = safeError(error);
        }
      }
      return {
        ...state,
        connecting: Boolean(pending),
        models: available,
        ...(lastError ? { error: lastError } : {}),
      };
    } catch (error) {
      return {
        connected: false,
        sharing: false,
        connecting: Boolean(pending),
        models: [],
        error: safeError(error, "chatgpt_storage_error"),
      };
    }
  }

  function status(): Promise<LocalAiProviderStatus> {
    // Several settings panels/tabs may poll together. Coalesce slow protected
    // storage reads instead of building a queue that can delay OAuth writes.
    statusRequest ??= loadStatus().finally(() => {
      statusRequest = undefined;
    });
    return statusRequest;
  }

  async function connect(): Promise<void> {
    if (pending) return;
    const controller = new AbortController();
    pending = controller;
    lastError = undefined;
    let saved: Connection;
    try {
      saved = await withStore(async (state, save) => {
        await save();
        return structuredClone(state);
      });
      if (controller.signal.aborted) fail("chatgpt_connection_cancelled");
    } catch (error) {
      if (pending === controller) pending = undefined;
      lastError = safeError(error, "chatgpt_connection_failed");
      throw new LocalAiProviderError(lastError);
    }
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    let callbackResolve!: (value: { code: string; clientId: string }) => void;
    let callbackReject!: (error: Error) => void;
    const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
      callbackResolve = resolve;
      callbackReject = reject;
    });
    // Attach a handler immediately, before opening the browser can fail.
    callback.catch(() => undefined);
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const received = url.searchParams.get("state") ?? "";
      const receivedBytes = Buffer.from(received);
      const stateBytes = Buffer.from(state);
      const equal =
        receivedBytes.length === stateBytes.length && timingSafeEqual(receivedBytes, stateBytes);
      const duplicates = ["state", "code", "client_id", "error"].some(
        (name) => url.searchParams.getAll(name).length > 1,
      );
      if (req.method !== "GET" || url.pathname !== "/auth/callback" || !equal || duplicates) {
        res.writeHead(400).end("Invalid sign-in callback.");
        return;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      if (url.searchParams.has("error")) {
        res.end("Sign-in was cancelled. Return to 3z Prod.");
        callbackReject(new LocalAiProviderError("chatgpt_connection_declined"));
        return;
      }
      const clientId = url.searchParams.get("client_id") ?? saved.clientId;
      const code = url.searchParams.get("code");
      if (
        !issuedClient(clientId) ||
        (saved.clientId && clientId !== saved.clientId) ||
        !string(code, 4096)
      ) {
        res.writeHead(400).end("Incomplete sign-in. Return to 3z Prod.");
        callbackReject(new LocalAiProviderError("chatgpt_invalid_identity"));
        return;
      }
      res.end("Sign-in received. Return to 3z Prod to check the connection.");
      callbackResolve({ code, clientId });
    });
    listener = server;
    const abort = () => callbackReject(new LocalAiProviderError("chatgpt_connection_cancelled"));
    controller.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), 5 * 60_000);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") fail("chatgpt_connection_failed");
      const redirect = `http://127.0.0.1:${address.port}/auth/callback`;
      const url = new URL(`${ISSUER}/api/accounts/authorize`);
      url.search = new URLSearchParams({
        client_id: saved.clientId ?? "dynamic_agent_client",
        ...(saved.clientId ? {} : { agent_name_hint: "3z Prod" }),
        ext_agent_host_id: saved.hostId,
        response_type: "code",
        redirect_uri: redirect,
        scope: SCOPES,
        resource: RESOURCE,
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        ...(saved.credentials?.idToken ? { id_token_hint: saved.credentials.idToken } : {}),
        ...(saved.email ? { login_hint: saved.email } : {}),
        ...(saved.credentials && !saved.credentials.scopes.includes(SHARING)
          ? { prompt: "consent" }
          : {}),
      }).toString();
      const finish = async () => {
        try {
          const accepted = await callback;
          controller.signal.throwIfAborted();
          await withStore(async (value, save) => {
            value.clientId = accepted.clientId;
            await save();
          });
          const data = await readJson(
            await request(`${ISSUER}/api/accounts/oauth/token`, {
              method: "POST",
              signal: controller.signal,
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                client_id: accepted.clientId,
                code: accepted.code,
                code_verifier: verifier,
                redirect_uri: redirect,
                resource: RESOURCE,
              }),
            }),
          );
          const credentials = tokenCredentials(data, now());
          const identity = await verify(credentials, accepted.clientId, nonce);
          if (saved.subject && saved.subject !== identity.subject) fail("chatgpt_account_mismatch");
          controller.signal.throwIfAborted();
          await withStore(async (value, save) => {
            controller.signal.throwIfAborted();
            value.clientId = accepted.clientId;
            value.subject = identity.subject;
            value.email = identity.email;
            value.credentials = credentials;
            delete value.pendingRefresh;
            await save();
          });
          catalog = undefined;
          lastError = undefined;
        } catch (error) {
          lastError = safeError(error, "chatgpt_connection_failed");
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", abort);
          server.close();
          if (listener === server) listener = undefined;
          if (pending === controller) pending = undefined;
        }
      };
      signInTask = finish();
      await (options.openBrowser ?? openSystemBrowser)(url.toString());
    } catch (error) {
      controller.abort();
      clearTimeout(timer);
      server.close();
      pending = undefined;
      listener = undefined;
      lastError = safeError(error, "chatgpt_connection_failed");
      throw new LocalAiProviderError(lastError);
    }
  }

  async function disconnect(): Promise<void> {
    pending?.abort();
    await signInTask;
    pending = undefined;
    listener?.close();
    listener = undefined;
    for (const request of activeRequests) request.abort();
    catalog = undefined;
    lastError = undefined;
    await withStore(async (state, save) => {
      const token = state.pendingRefresh?.refreshToken ?? state.credentials?.refreshToken;
      if (token && state.clientId) {
        let revoked = false;
        try {
          const { revoke } = await discovery();
          for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt) await new Promise((resolve) => setTimeout(resolve, 250));
            const response = await request(
              revoke,
              {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  token,
                  token_type_hint: "refresh_token",
                  client_id: state.clientId,
                }),
              },
              10_000,
            );
            if (response.status === 200) {
              revoked = true;
              break;
            }
            if (response.status < 500) break;
          }
        } catch {
          /* Local disconnect still clears this app's token set. */
        }
        if (!revoked) lastError = "chatgpt_revocation_unconfirmed";
      }
      delete state.credentials;
      delete state.pendingRefresh;
      await save();
    });
  }

  return {
    status,
    connect,
    disconnect,
    async plan(input) {
      if (pending) fail("chatgpt_connecting");
      const controller = new AbortController();
      activeRequests.add(controller);
      const signal = AbortSignal.any([
        input.signal,
        controller.signal,
        AbortSignal.timeout(180_000),
      ]);
      try {
        const available = await models(signal);
        const selected = available.find((model) => model.id === input.model);
        if (!selected) fail("chatgpt_model_unavailable");
        if (input.effort && !selected.efforts?.includes(input.effort))
          fail("chatgpt_effort_unavailable");
        const account = await access(signal);
        const response = await request(
          `${RESOURCE}/responses`,
          {
            method: "POST",
            signal,
            headers: {
              Authorization: `Bearer ${account.token}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              model: input.model,
              instructions: input.instructions,
              input: [{ role: "user", content: input.input }],
              store: false,
              stream: true,
              text: {
                format: {
                  type: "json_schema",
                  name: "discover_search_plan",
                  strict: true,
                  schema: input.schema,
                },
              },
              ...(input.effort ? { reasoning: { effort: input.effort } } : {}),
            }),
          },
          180_000,
        );
        if (!response.ok) await readJson(response);
        const text = await completedText(response, signal, input.model);
        try {
          if (!object(JSON.parse(text))) fail("chatgpt_invalid_response");
        } catch {
          fail("chatgpt_invalid_response");
        }
        return { text, model: input.model };
      } finally {
        activeRequests.delete(controller);
      }
    },
    async dispose() {
      pending?.abort();
      listener?.close();
      for (const request of activeRequests) request.abort();
      await signInTask;
    },
  };
}

async function completedText(
  response: Response,
  signal: AbortSignal,
  requestedModel: string,
): Promise<string> {
  const contentType = response.headers.get("content-type");
  if (!response.body || (contentType && !contentType.startsWith("text/event-stream")))
    fail("chatgpt_invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let text = "";
  let completed = false;
  function dispatch() {
    if (!data.length) return;
    const raw = data.join("\n");
    data = [];
    if (raw === "[DONE]") return;
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      fail("chatgpt_invalid_response");
    }
    if (!object(event)) fail("chatgpt_invalid_response");
    if (event.type === "response.output_text.delta" && typeof event.delta === "string")
      text += event.delta;
    if (text.length > 64_000) fail("chatgpt_invalid_response");
    if (event.type === "response.failed" || event.type === "error") {
      const responseError = object(event.response) ? event.response.error : event.error;
      const code = object(responseError) ? responseError.code : event.code;
      fail(typeof code === "string" && KNOWN_ERRORS.has(code) ? code : "chatgpt_request_failed");
    }
    if (event.type === "response.incomplete" || event.type === "response.refusal.done")
      fail("chatgpt_incomplete_response");
    if (event.type === "response.completed") {
      if (
        object(event.response) &&
        event.response.status !== undefined &&
        event.response.status !== "completed"
      )
        fail("chatgpt_incomplete_response");
      if (
        object(event.response) &&
        event.response.model !== undefined &&
        event.response.model !== requestedModel
      )
        fail("chatgpt_model_mismatch");
      completed = true;
    }
  }
  function line(value: string) {
    if (!value) dispatch();
    else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
  }
  try {
    while (!completed) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length + data.join("\n").length > 1_000_000) fail("chatgpt_invalid_response");
      let position = 0;
      for (let index = 0; index < buffer.length; index++) {
        if (buffer[index] !== "\r" && buffer[index] !== "\n") continue;
        if (buffer[index] === "\r" && index === buffer.length - 1 && !chunk.done) break;
        line(buffer.slice(position, index));
        if (buffer[index] === "\r" && buffer[index + 1] === "\n") index++;
        position = index + 1;
      }
      buffer = buffer.slice(position);
      if (chunk.done) {
        if (buffer) line(buffer);
        dispatch();
        break;
      }
    }
    if (!completed || !text.trim()) fail("chatgpt_incomplete_response");
    return text;
  } catch (error) {
    if (error instanceof LocalAiProviderError) throw error;
    return fail(signal.aborted ? "request_cancelled" : "chatgpt_incomplete_response");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
