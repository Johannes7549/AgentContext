import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CommandAdapter, FileAdapter, filterEnv } from "../src/index.js";
import { tempDir } from "./helpers.js";

const node = process.execPath;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function setup(overrides: Partial<ConstructorParameters<typeof CommandAdapter>[0]> = {}) {
  const { dir, remove } = tempDir("agentcontext-cmd-");
  cleanups.push(remove);
  const root = join(dir, "project");
  mkdirSync(join(root, "sub"), { recursive: true });
  const adapter = new CommandAdapter({
    enabled: true,
    allowlist: [node],
    files: new FileAdapter({ allowedRoots: [root], maxFileBytes: 1024 }),
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
    ...overrides,
  });
  return { adapter, root, dir };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe("CommandAdapter — execution", () => {
  it("runs an allowlisted executable and captures stdout, stderr and exit code", async () => {
    const { adapter } = setup();
    const result = await adapter.run({
      command: node,
      args: ["-e", "console.log('out'); console.error('err'); process.exit(3)"],
    });
    expect(result).toMatchObject({
      command: basename(node),
      exitCode: 3,
      stdout: "out\n",
      stderr: "err\n",
      timedOut: false,
      truncated: false,
      cancelled: false,
    });
  });

  it("passes arguments literally without shell interpretation", async () => {
    const { adapter, root } = setup();
    const marker = join(root, "pwned.txt");
    const hostile = [
      "a; echo hacked > pwned.txt",
      "$(whoami)",
      "`id`",
      "| calc",
      "&& del *",
      "%PATH%",
    ];
    const result = await adapter.run({
      command: node,
      args: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", ...hostile],
    });
    expect(JSON.parse(result.stdout)).toEqual(hostile);
    expect(existsSync(marker)).toBe(false);
  });

  it("runs in the requested directory inside the allowed root", async () => {
    const { adapter, root } = setup();
    const result = await adapter.run({
      command: node,
      args: ["-e", "console.log(process.cwd())"],
      cwd: "sub",
    });
    // Compare resolved paths: Windows runners may report temp dirs as 8.3 short names.
    expect(result.stdout.trim().toLowerCase()).toBe(
      realpathSync.native(join(root, "sub")).toLowerCase(),
    );
  });

  it("does not pass secrets from the environment", async () => {
    const { adapter } = setup({
      env: {
        ...process.env,
        AGENTCONTEXT_TEST_API_TOKEN: "secret-value",
        MY_PASSWORD: "hunter2",
        LANG: "C",
      },
    });
    const result = await adapter.run({
      command: node,
      args: ["-e", "console.log(JSON.stringify(process.env))"],
    });
    expect(result.stdout).not.toContain("secret-value");
    expect(result.stdout).not.toContain("hunter2");
    expect(JSON.parse(result.stdout).LANG).toBe("C");
  });
});

describe("CommandAdapter — limits", () => {
  it("kills the whole process tree on timeout", async () => {
    const { adapter, root } = setup({ timeoutMs: 1_500 });
    const pidFile = join(root, "child.pid");
    const script = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
      setInterval(() => {}, 1000);
    `;
    const result = await adapter.run({ command: node, args: ["-e", script] });
    expect(result.timedOut).toBe(true);
    const childPid = Number(readFileSync(pidFile, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(() => process.kill(childPid, 0)).toThrow();
  }, 20_000);

  it("caps output and stops the process", async () => {
    const { adapter } = setup({ maxOutputBytes: 1_000 });
    const result = await adapter.run({
      command: node,
      args: ["-e", "setInterval(() => process.stdout.write('x'.repeat(10000)), 1)"],
    });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1_000);
  }, 20_000);

  it("supports cancellation", async () => {
    const { adapter } = setup();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const result = await adapter.run({
      command: node,
      args: ["-e", "setInterval(() => {}, 1000)"],
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
  }, 20_000);

  it("never lets a request extend the configured timeout", async () => {
    const { adapter } = setup({ timeoutMs: 800 });
    const result = await adapter.run({
      command: node,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 60_000,
    });
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(10_000);
  }, 20_000);
});

describe("CommandAdapter — refusals", () => {
  it("refuses everything when disabled", async () => {
    const { adapter } = setup({ enabled: false });
    expect(await code(adapter.run({ command: node }))).toBe("COMMAND_DISABLED");
  });

  it.each(["git", "node; rm -rf /", "bash -c ls", "", "cmd.exe"])(
    "refuses non-allowlisted %j",
    async (command) => {
      const { adapter } = setup();
      expect(await code(adapter.run({ command }))).toBe("COMMAND_NOT_ALLOWED");
    },
  );

  it("refuses .cmd/.bat shims even when allowlisted", async () => {
    const { dir } = setup();
    const shim = join(dir, "tool.cmd");
    writeFileSync(shim, "@echo off\necho hi\n");
    const { adapter } = setup({ allowlist: [shim] });
    expect(await code(adapter.run({ command: shim }))).toBe("COMMAND_NOT_ALLOWED");
  });

  it("refuses working directories outside the allowed roots", async () => {
    const { adapter, dir } = setup();
    expect(await code(adapter.run({ command: node, args: ["-e", "1"], cwd: dir }))).toBe(
      "PATH_NOT_ALLOWED",
    );
    expect(await code(adapter.run({ command: node, args: ["-e", "1"], cwd: "../.." }))).toBe(
      "PATH_NOT_ALLOWED",
    );
  });

  it("rejects NUL bytes and too many arguments", async () => {
    const { adapter } = setup();
    expect(await code(adapter.run({ command: node, args: ["a\0b"] }))).toBe("INVALID_INPUT");
    expect(
      await code(adapter.run({ command: node, args: Array.from({ length: 201 }, () => "x") })),
    ).toBe("INVALID_INPUT");
  });

  it("finds allowlisted names on PATH", () => {
    const { adapter } = setup({
      allowlist: ["node"],
      env: { ...process.env, PATH: join(node, ".."), Path: join(node, "..") },
    });
    expect(adapter.resolveExecutable("node").toLowerCase()).toBe(node.toLowerCase());
  });
});

describe("filterEnv", () => {
  it("keeps only allowlisted, non-secret variables", () => {
    expect(
      filterEnv({
        PATH: "/bin",
        HOME: "/h",
        LC_ALL: "C",
        GITHUB_TOKEN: "x",
        AWS_SECRET_ACCESS_KEY: "y",
        FOO: "z",
      }),
    ).toEqual({ PATH: "/bin", HOME: "/h", LC_ALL: "C" });
  });
});
