import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { gitAt } from "../../versions/mod.ts";
import type { GateDeps } from "./mod.ts";

// child의 exit code와 stdout/stderr를 모은다. abort되면 'error'로 끝나 reject한다.
function outputOf(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> | undefined,
  signal: AbortSignal,
): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    child.stdout.on("data", (chunk: Uint8Array) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }),
    );
  });
}

export function defaultGateDeps(
  base: Pick<GateDeps, "validateFixtures" | "dryRun" | "catalogRoot">,
  checkout: string,
): GateDeps {
  return {
    ...base,
    async run(cmd, cwd, timeoutMs, env) {
      const out = await outputOf(
        cmd[0],
        cmd.slice(1),
        cwd,
        env,
        AbortSignal.timeout(timeoutMs),
      );
      const dec = new TextDecoder();
      return {
        code: out.code,
        output: dec.decode(out.stdout) + dec.decode(out.stderr),
      };
    },
    git: gitAt(checkout),
    readText: (path) => readFile(path, "utf8"),
    async listFiles(dir) {
      const names: string[] = [];
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isFile()) names.push(e.name);
      }
      return names;
    },
    now: () => Date.now(),
  };
}
