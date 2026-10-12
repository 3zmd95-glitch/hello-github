// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClaudeProvider,
  runClaudeCommand,
  subscriptionEnvironment,
  type ClaudeCommand,
  type ClaudeCommandResult,
} from "./claude";
import { LocalAiProviderError, type LocalAiPlanInput } from "./types";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const output = (value: unknown): ClaudeCommandResult => ({
  stdout: JSON.stringify(value),
  stderr: "",
  code: 0,
});
const auth = {
  loggedIn: true,
  authMethod: "claude.ai",
  subscriptionType: "max",
  orgId: "org",
  email: "private@example.test",
};
const planInput = (model = "claude-fable-5-1"): LocalAiPlanInput => ({
  model,
  effort: "max",
  instructions: "Only a search plan",
  input: "قهوة",
  schema: { type: "object" },
  signal: new AbortController().signal,
});
async function fixture(
  options: { auth?: unknown; plan?: ClaudeCommandResult; version?: string } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "3z-claude-test-"));
  directories.push(directory);
  const calls: ClaudeCommand[] = [];
  let clock = 0;
  const run = vi.fn(async (command: ClaudeCommand) => {
    calls.push(command);
    if (command.args[0] === "--version")
      return { stdout: options.version ?? "2.1.278 (Claude Code)", stderr: "", code: 0 };
    if (command.args[0] === "auth") return output(options.auth ?? auth);
    return (
      options.plan ??
      output({
        subtype: "success",
        structured_output: { summary: "قهوة" },
        modelUsage: { "claude-fable-5-1": {} },
      })
    );
  });
  const provider = createClaudeProvider(directory, {
    run,
    resolveExecutable: async () => "/official/claude",
    now: () => clock,
    environment: {
      NODE_ENV: "test",
      PATH: "path",
      ANTHROPIC_API_KEY: "never-use",
      ANTHROPIC_AUTH_TOKEN: "never-use",
      ANTHROPIC_BASE_URL: "https://wrong.example",
      CLAUDE_CODE_OAUTH_TOKEN: "never-use",
    },
  });
  return {
    provider,
    calls,
    run,
    directory,
    advance: () => {
      clock += 10_000;
    },
    options,
  };
}

describe("Claude subscription adapter", () => {
  it("rejects image verification explicitly before any CLI call instead of silently dropping the image", async () => {
    const f = await fixture();
    await expect(
      f.provider.plan({ ...planInput(), images: [{ mime: "image/jpeg", base64: "/9j/4A==" }] }),
    ).rejects.toMatchObject({ code: "claude_images_unavailable" });
    expect(f.calls).toHaveLength(0);
  });
  it("requires app activation, reuses native login, and does not expose the email", async () => {
    const f = await fixture();
    const initial = await f.provider.status();
    expect(initial).toMatchObject({
      connected: false,
      sharing: false,
      account: "Claude max",
      models: [{ id: "claude-fable-5-1" }, { id: "claude-opus-5" }],
    });
    expect(JSON.stringify(initial)).not.toContain("private@example.test");
    await f.provider.connect();
    expect(await f.provider.status()).toMatchObject({ connected: true, sharing: true });
    expect(f.calls.some((command) => command.args.includes("login"))).toBe(false);
    await f.provider.disconnect();
    expect(await f.provider.status()).toMatchObject({ connected: false, sharing: false });
    expect(f.calls.some((command) => command.args.includes("logout"))).toBe(false);
  });

  it("binds app activation to the native account and persists only that consent", async () => {
    const f = await fixture();
    await f.provider.connect();
    f.options.auth = { ...auth, orgId: "another", email: "another@example.test" };
    f.advance();
    expect(await f.provider.status()).toMatchObject({ connected: false, sharing: false });
    await expect(f.provider.plan(planInput())).rejects.toMatchObject({ code: "not_connected" });
  });

  it("runs the official CLI with no tools, no ambient API key, isolated cwd and structured output", async () => {
    const f = await fixture();
    await f.provider.connect();
    expect(await f.provider.plan(planInput())).toEqual({
      text: '{"summary":"قهوة"}',
      model: "claude-fable-5-1",
    });
    const command = f.calls.at(-1)!;
    expect(command.executable).toBe("/official/claude");
    expect(command.cwd).toBe(path.join(f.directory, "claude-planner"));
    expect(command.args).toEqual(
      expect.arrayContaining([
        "--safe-mode",
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-chrome",
        "--no-session-persistence",
        "--permission-prompts",
        "none",
        "--model",
        "claude-fable-5-1",
        "--effort",
        "max",
        "--json-schema",
      ]),
    );
    expect(command.args).not.toContain("--bare");
    expect(command.input).toBe("قهوة");
    expect(command.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(command.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(command.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("rechecks the native account before inference even inside the status-cache window", async () => {
    const f = await fixture();
    await f.provider.connect();
    expect((await f.provider.status()).connected).toBe(true);
    f.options.auth = { ...auth, orgId: "changed-between-status-and-search" };
    await expect(f.provider.plan(planInput())).rejects.toMatchObject({ code: "not_connected" });
    expect(f.calls.some((command) => command.args[0] === "-p")).toBe(false);
  });

  it("starts the native login flow when required, then activates the newly authenticated account", async () => {
    const f = await fixture({ auth: { loggedIn: false, authMethod: "none" } });
    f.run.mockImplementation(async (command) => {
      f.calls.push(command);
      if (command.args[0] === "--version") return { stdout: "2.1.278", stderr: "", code: 0 };
      if (command.args[1] === "login") {
        f.options.auth = auth;
        return { stdout: "Signed in", stderr: "", code: 0 };
      }
      return output(f.options.auth);
    });
    await f.provider.connect();
    await vi.waitFor(async () => expect((await f.provider.status()).connected).toBe(true));
    expect(f.calls.some((command) => command.args.join(" ") === "auth login --claudeai")).toBe(
      true,
    );
  });

  it("does not advertise paid-only Fable for Pro and respects CLI version requirements", async () => {
    const f = await fixture({ auth: { ...auth, subscriptionType: "pro" }, version: "2.1.284" });
    expect((await f.provider.status()).models.map((model) => model.id)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
    ]);
    await f.provider.connect();
    await expect(f.provider.plan(planInput())).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("does not treat API-key authentication as a subscription connection", async () => {
    const f = await fixture({ auth: { ...auth, authMethod: "api_key" } });
    expect(await f.provider.status()).toMatchObject({
      connected: false,
      models: [],
      error: "subscription_required",
    });
  });

  it.each([
    [{ stdout: "Weekly usage limit reached secret=do-not-leak", stderr: "", code: 1 }, "ai_limit"],
    [{ stdout: "", stderr: "Login expired secret=do-not-leak", code: 1 }, "not_connected"],
    [{ stdout: "broken", stderr: "", code: 0 }, "invalid_response"],
    [output({ subtype: "success", result: "no structured object" }), "invalid_response"],
    [
      output({ subtype: "success", structured_output: {}, modelUsage: { "claude-opus-5": {} } }),
      "model_unavailable",
    ],
    [
      output({
        subtype: "success",
        structured_output: {},
        modelUsage: { "claude-fable-5-1": {}, "claude-opus-5": {} },
      }),
      "model_unavailable",
    ],
    [output({ subtype: "success", structured_output: {} }), "model_unavailable"],
  ])("returns a safe failure and rejects silent model fallback", async (result, code) => {
    const f = await fixture({ plan: result as ClaudeCommandResult });
    await f.provider.connect();
    await expect(f.provider.plan(planInput())).rejects.toMatchObject({ code, message: code });
  });
});

describe("Claude process boundary", () => {
  const command = (source: string): ClaudeCommand => ({
    executable: process.execPath,
    args: ["-e", source],
    cwd: os.tmpdir(),
    env: process.env,
    timeoutMs: 5_000,
  });

  it("decodes Arabic split over stdout chunks without corruption", async () => {
    const result = await runClaudeCommand(
      command(
        "const b=Buffer.from('قهوة'); process.stdout.write(b.subarray(0,1)); setTimeout(()=>process.stdout.write(b.subarray(1)),25)",
      ),
    );
    expect(result.stdout).toBe("قهوة");
  });

  it("bounds process output", async () => {
    await expect(
      runClaudeCommand(command("process.stdout.write('x'.repeat(300000))")),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("cancels and times out subprocesses", async () => {
    const controller = new AbortController();
    const promise = runClaudeCommand({
      ...command("setTimeout(()=>{},10000)"),
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "cancelled" });
    await expect(
      runClaudeCommand({ ...command("setTimeout(()=>{},10000)"), timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "ai_timeout" });
    await expect(
      runClaudeCommand({ ...command(""), signal: controller.signal }),
    ).rejects.toBeInstanceOf(LocalAiProviderError);
  });

  it("clears API/provider overrides without clearing the native account directory", () => {
    expect(
      subscriptionEnvironment({
        NODE_ENV: "test",
        ANTHROPIC_DEFAULT_FABLE_MODEL: "bad",
        CLAUDE_CODE_USE_VERTEX: "1",
        CLAUDE_CONFIG_DIR: "/native/config",
        HOME: "/user",
      }),
    ).toEqual({ NODE_ENV: "test", CLAUDE_CONFIG_DIR: "/native/config", HOME: "/user" });
  });
});
