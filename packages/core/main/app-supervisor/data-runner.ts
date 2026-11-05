// 앱 전용 data worker 작업 한 번을 별도 lophn 자식(`packages/core/main/worker/data-job.ts`)으로 돌린다.
// supervisor와 core는 앱 DB를 열지 않는다: 이 자식이 종료 확인 뒤의 DB를 단독으로 연다.
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "../../../base/mod.ts";
import { decodeActivationDataJobInput } from "../../../protocol/apps/mod.ts";
import { windowsEnvironment } from "../../supervision/security/child-env.ts";
import { nodeCommand } from "../../supervision/security/node-command.ts";
import {
  killTree,
  treeSpawnOptions,
} from "../../supervision/security/tree-kill.ts";

const JOB = fileURLToPath(new URL("../worker/data-job.ts", import.meta.url));
const JOB_LIMIT_MS = 300_000;

export type DataJobRunner = {
  // 작업 입력 한 줄을 돌려 출력 한 줄을 받는다. 입력의 app이 `app`과 다르면 돌리지 않는다.
  run(app: string, line: string): Promise<Result<string>>;
};

export function createChildDataRunner(options: {
  dataRoot: string;
  limitMs?: number;
}): DataJobRunner {
  return {
    async run(app, line) {
      let input;
      try {
        input = decodeActivationDataJobInput(line);
      } catch {
        return err({ code: "invalid_input", message: "data job is invalid" });
      }
      if (input.app !== app) {
        return err({ code: "invalid_input", message: "data job is invalid" });
      }
      // env를 주면 부모 환경을 통째로 대체한다.
      const launch = nodeCommand(JOB, [options.dataRoot]);
      const child = spawn(launch.command, launch.args, {
        env: {
          ...launch.env,
          ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
          ...windowsEnvironment(),
        },
        stdio: ["pipe", "pipe", "ignore"],
        ...treeSpawnOptions(),
      });
      const timer = setTimeout(
        () => killTree(child),
        options.limitMs ?? JOB_LIMIT_MS,
      );
      try {
        const output = await new Promise<{
          stdout: Uint8Array;
          success: boolean;
        }>((resolve, reject) => {
          const chunks: Buffer[] = [];
          // spawn 실패(ENOENT 등)의 'error'를 받지 않으면 process 전체가 죽는다.
          child.on("error", reject);
          child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
          child.on("close", (code, signal) => {
            resolve({
              stdout: Buffer.concat(chunks),
              success: code === 0 && signal === null,
            });
          });
          // 자식이 입력을 다 읽기 전에 끝나면 stdin 쓰기가 EPIPE로 실패한다. 그 실패는
          // 종료 상태로 판정하고 process를 죽이지 않는다.
          child.stdin!.on("error", () => {});
          child.stdin!.end(line);
        });
        const text = new TextDecoder().decode(output.stdout).trim();
        return output.success && text !== ""
          ? ok(`${text.split("\n").at(-1)}\n`)
          : err({ code: "unavailable", message: "data job failed" });
      } catch {
        return err({ code: "unavailable", message: "data job failed" });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
