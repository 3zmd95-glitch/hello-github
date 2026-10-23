import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  LocalAiProviderError,
  type LocalAiModel,
  type LocalAiPlanInput,
  type LocalAiProvider,
  type LocalAiProviderStatus,
} from "./types";

const MAX_OUTPUT_BYTES = 256 * 1024;
const PLAN_TIMEOUT_MS = 180_000;
const AUTH_TIMEOUT_MS = 300_000;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export interface ClaudeCommand {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface ClaudeCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type ClaudeRunner = (command: ClaudeCommand) => Promise<ClaudeCommandResult>;

/** The installed Claude process owns and refreshes its own credentials. */
export function subscriptionEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !/^ANTHROPIC_/i.test(key) &&
        !/^CLAUDE_CODE_(OAUTH_TOKEN|USE_|API_KEY_HELPER|EFFORT_LEVEL)/i.test(key) &&
        !/^CLAUDE_(ENV_FILE|CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD)$/i.test(key),
    ),
  ) as NodeJS.ProcessEnv;
}

export const runClaudeCommand: ClaudeRunner = (command) =>
  new Promise((resolve, reject) => {
    if (command.signal?.aborted) {
      reject(new LocalAiProviderError("cancelled"));
      return;
    }
    const child = spawn(command.executable, command.args, {
      shell: false,
      windowsHide: true,
      cwd: command.cwd,
      env: command.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let settled = false;
    const finish = (error?: LocalAiProviderError, code = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      command.signal?.removeEventListener("abort", onAbort);
      if (error) {
        child.kill();
        reject(error);
      } else
        resolve({
          stdout: stdout + stdoutDecoder.end(),
          stderr: stderr + stderrDecoder.end(),
          code,
        });
    };
    const onAbort = () => finish(new LocalAiProviderError("cancelled"));
    const timer = setTimeout(
      () => finish(new LocalAiProviderError("ai_timeout")),
      command.timeoutMs,
    );
    command.signal?.addEventListener("abort", onAbort, { once: true });
    const collect = (chunk: Buffer, target: "stdout" | "stderr") => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) return finish(new LocalAiProviderError("invalid_response"));
      if (target === "stdout") stdout += stdoutDecoder.write(chunk);
      else stderr += stderrDecoder.write(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
    child.on("error", () => finish(new LocalAiProviderError("cli_unavailable")));
    child.on("close", (code) => finish(undefined, code ?? 1));
    child.stdin.on("error", () => undefined);
    child.stdin.end(command.input ?? "", "utf8");
  });

export async function resolveClaudeExecutable(): Promise<string> {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA)
      candidates.push(
        path.join(process.env.APPDATA, "npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
      );
    candidates.push(path.join(os.homedir(), ".local/bin/claude.exe"));
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory)
      candidates.push(path.join(directory, process.platform === "win32" ? "claude.exe" : "claude"));
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next official installation location. */
    }
  }
  throw new LocalAiProviderError("cli_unavailable");
}

function atLeast(version: string, minor: number): boolean {
  const found = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  return Boolean(
    found &&
    (Number(found[1]) > 2 ||
      (Number(found[1]) === 2 &&
        (Number(found[2]) > 1 || (Number(found[2]) === 1 && Number(found[3]) >= minor)))),
  );
}

function modelsFor(version: string, subscription: string): LocalAiModel[] {
  const models: LocalAiModel[] = [];
  // Max includes Fable within its weekly allowance. Other plan tiers require
  // separate credits, so do not advertise it as subscription-included there.
  if (subscription === "max" && atLeast(version, 257))
    models.push({ id: "claude-fable-5-1", name: "Claude Fable 5.1", efforts: EFFORTS });
  if (atLeast(version, 280))
    models.push({ id: "claude-opus-5-5", name: "Claude Opus 5.5", efforts: EFFORTS });
  else if (atLeast(version, 219))
    models.push({ id: "claude-opus-5", name: "Claude Opus 5", efforts: EFFORTS });
  if (atLeast(version, 284))
    models.push({ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", efforts: EFFORTS });
  return models;
}

function commandFailure(result: ClaudeCommandResult): LocalAiProviderError {
  const text = `${result.stdout}\n${result.stderr}`;
  if (/usage limit|rate.?limit|weekly limit|extra usage|usage credits|hit your limit/i.test(text))
    return new LocalAiProviderError("ai_limit");
  if (/log.?in|not authenticated|authentication|oauth|expired/i.test(text))
    return new LocalAiProviderError("not_connected");
  if (
    /model.*(unavailable|not.*support|not.*found|invalid)|does not support this model/i.test(text)
  )
    return new LocalAiProviderError("model_unavailable");
  return new LocalAiProviderError("ai_unavailable");
}

export function createClaudeProvider(
  runtimeDir: string,
  dependencies: {
    run?: ClaudeRunner;
    resolveExecutable?: () => Promise<string>;
    environment?: NodeJS.ProcessEnv;
    now?: () => number;
  } = {},
): LocalAiProvider {
  const run = dependencies.run ?? runClaudeCommand;
  const resolveExecutable = dependencies.resolveExecutable ?? resolveClaudeExecutable;
  const env = subscriptionEnvironment(dependencies.environment ?? process.env);
  const now = dependencies.now ?? Date.now;
  const cwd = path.join(runtimeDir, "claude-planner");
  const linkFile = path.join(runtimeDir, "claude-linked.json");
  let cache: { at: number; value: LocalAiProviderStatus } | undefined;
  let connecting: AbortController | undefined;
  let loginError: string | undefined;
  const prepare = () => mkdir(cwd, { recursive: true, mode: 0o700 });
  const linked = async (accountId: string) => {
    try {
      const saved = JSON.parse(await readFile(linkFile, "utf8"));
      return saved.enabled === true && saved.accountId === accountId;
    } catch {
      return false;
    }
  };
  const setLinked = async (enabled: boolean, accountId?: string) => {
    await prepare();
    await writeFile(linkFile, JSON.stringify({ enabled, accountId }), { mode: 0o600 });
    cache = undefined;
  };
  const command = async (args: string[], options: Partial<ClaudeCommand> = {}) => {
    await prepare();
    return run({
      executable: await resolveExecutable(),
      args,
      cwd,
      env,
      timeoutMs: 10_000,
      ...options,
    });
  };
  const status = async (): Promise<LocalAiProviderStatus> => {
    if (cache && now() - cache.at < 5_000)
      return { ...cache.value, connecting: Boolean(connecting) };
    let value: LocalAiProviderStatus;
    try {
      const [auth, version] = await Promise.all([
        command(["auth", "status"]),
        command(["--version"]),
      ]);
      const data = JSON.parse(auth.stdout) as Record<string, unknown>;
      const authenticated = data.loggedIn === true && data.authMethod === "claude.ai";
      const accountId = authenticated
        ? createHash("sha256")
            .update(`${data.orgId ?? ""}:${data.email ?? ""}`)
            .digest("hex")
            .slice(0, 24)
        : undefined;
      const sharing = Boolean(accountId && (await linked(accountId)));
      value = {
        connected: authenticated && sharing,
        sharing,
        connecting: Boolean(connecting),
        accountId,
        account:
          typeof data.subscriptionType === "string" ? `Claude ${data.subscriptionType}` : undefined,
        models: authenticated
          ? modelsFor(version.stdout.trim(), String(data.subscriptionType ?? ""))
          : [],
        error: authenticated
          ? undefined
          : (loginError ?? (data.loggedIn ? "subscription_required" : undefined)),
      };
    } catch (error) {
      value = {
        connected: false,
        sharing: false,
        connecting: Boolean(connecting),
        models: [],
        error: error instanceof LocalAiProviderError ? error.code : "cli_unavailable",
      };
    }
    cache = { at: now(), value };
    return value;
  };
  return {
    status,
    async connect() {
      cache = undefined;
      const current = await status();
      if (current.accountId) {
        await setLinked(true, current.accountId);
        return;
      }
      if (current.error === "cli_unavailable") throw new LocalAiProviderError("cli_unavailable");
      if (connecting) return;
      const controller = new AbortController();
      connecting = controller;
      loginError = undefined;
      void command(["auth", "login", "--claudeai"], {
        timeoutMs: AUTH_TIMEOUT_MS,
        signal: controller.signal,
      })
        .then(async (result) => {
          if (result.code !== 0) throw commandFailure(result);
          cache = undefined;
          const signedIn = await status();
          if (!signedIn.accountId) throw new LocalAiProviderError("not_connected");
          if (!controller.signal.aborted) await setLinked(true, signedIn.accountId);
        })
        .catch((error) => {
          loginError = error instanceof LocalAiProviderError ? error.code : "not_connected";
        })
        .finally(() => {
          if (connecting === controller) connecting = undefined;
          cache = undefined;
        });
    },
    async disconnect() {
      connecting?.abort();
      connecting = undefined;
      loginError = undefined;
      await setLinked(false);
    },
    async plan(input: LocalAiPlanInput) {
      if (input.images?.length) throw new LocalAiProviderError("claude_images_unavailable");
      // A native login can change between UI refreshes. Recheck the account's
      // app activation immediately before making a subscription request.
      cache = undefined;
      const current = await status();
      if (!current.connected || !current.sharing) throw new LocalAiProviderError("not_connected");
      const selected = current.models.find((model) => model.id === input.model);
      if (!selected || (input.effort && !selected.efforts?.includes(input.effort)))
        throw new LocalAiProviderError("model_unavailable");
      try {
        const result = await command(
          [
            "-p",
            "--model",
            input.model,
            ...(input.effort ? ["--effort", input.effort] : []),
            "--output-format",
            "json",
            "--json-schema",
            JSON.stringify(input.schema),
            "--safe-mode",
            "--tools",
            "",
            "--strict-mcp-config",
            "--no-chrome",
            "--no-session-persistence",
            "--permission-prompts",
            "none",
            "--system-prompt",
            input.instructions,
          ],
          { input: input.input, signal: input.signal, timeoutMs: PLAN_TIMEOUT_MS },
        );
        if (result.code !== 0) throw commandFailure(result);
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(result.stdout);
        } catch {
          throw new LocalAiProviderError("invalid_response");
        }
        if (data.is_error === true || data.subtype !== "success") throw commandFailure(result);
        if (!data.structured_output || typeof data.structured_output !== "object")
          throw new LocalAiProviderError("invalid_response");
        const used =
          data.modelUsage && typeof data.modelUsage === "object"
            ? Object.keys(data.modelUsage)
            : [];
        // Do not label an automatic provider fallback as the chosen highest model.
        if (used.length !== 1 || used[0] !== input.model)
          throw new LocalAiProviderError("model_unavailable");
        return { text: JSON.stringify(data.structured_output), model: input.model };
      } catch (error) {
        cache = undefined;
        throw error;
      }
    },
    dispose() {
      connecting?.abort();
    },
  };
}
