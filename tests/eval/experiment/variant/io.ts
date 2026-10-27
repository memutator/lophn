import { spawn } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { constants } from "node:os";
import { errorCode } from "../../../../packages/base/mod.ts";

// 파일 시스템과 subprocess를 인자로 받는다. test가 가짜를 넣는다.
export type RunOutput = { code: number; stdout: string; stderr: string };

export type VariantIo = {
  realPath(path: string): Promise<string>;
  /** git이 그 폴더의 최상위라고 답한 경로. git checkout이 아니면 null */
  gitToplevel(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  /** 폴더이고 안에 뭐가 하나라도 있다. */
  nonEmpty(path: string): Promise<boolean>;
  run(
    cmd: string[],
    cwd: string,
    env?: Record<string, string>,
  ): Promise<RunOutput>;
};

export const realIo: VariantIo = {
  realPath: (path) => realpath(path),
  async gitToplevel(path) {
    const out = await realIo
      .run(["git", "-C", path, "rev-parse", "--show-toplevel"], path)
      .catch(() => null);
    return out === null || out.code !== 0 ? null : out.stdout.trim();
  },
  async exists(path) {
    try {
      await lstat(path);
      return true;
    } catch (e) {
      if (errorCode(e) === "ENOENT") return false;
      throw e;
    }
  },
  async nonEmpty(path) {
    try {
      return (await readdir(path)).length > 0;
    } catch (e) {
      if (errorCode(e) !== "ENOENT") throw e;
    }
    return false;
  },
  async run(cmd, cwd, env) {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd,
      // 부모 env를 그대로 물려주고 준 값만 덮는다.
      env: env ? { ...process.env, ...env } : undefined,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      // close는 stdout·stderr를 다 읽은 뒤 온다. 신호로 죽으면 128+signal로 답한다.
      child.on("close", (exitCode, signal) =>
        resolve(
          signal === null
            ? (exitCode ?? 0)
            : 128 + (constants.signals[signal] ?? 0),
        ),
      );
    });
    const text = new TextDecoder();
    return {
      code,
      stdout: text.decode(Buffer.concat(stdout)),
      stderr: text.decode(Buffer.concat(stderr)),
    };
  },
};
