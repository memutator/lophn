// release 준비 한 번을 별도 lophn 자식(`packages/core/main/worker/release-job.ts`)으로 돌린다.
// 자식은 build 뒤에 의존성과 migration 검사도 돈다(앱이 쓴 migration SQL은 core에서 돌리지 않는다).
// 취소·종료는 자식 트리를 SIGKILL하고 끝난 것을 확인한 뒤에야 돌려준다. 끊긴 준비가 남긴 staging은 지운다.
import { type ChildProcess, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  appFolder,
  RELEASE_PREPARATION_LIMIT_MS,
} from "../../../protocol/apps/mod.ts";
import type {
  PreparationFailure,
  PreparationJob,
  PreparationOutcome,
  PreparationRunner,
} from "../../apps/releases/preparation.ts";
import { childEnvironment } from "../../apps/releases/prepare/environment.ts";
import { nodeCommand } from "../../supervision/security/node-command.ts";
import {
  killTree,
  treeSpawnOptions,
} from "../../supervision/security/tree-kill.ts";

const JOB = fileURLToPath(new URL("../worker/release-job.ts", import.meta.url));

export function createChildPreparationRunner(options: {
  dataRoot: string;
  limitMs?: number;
}): PreparationRunner {
  return {
    async run(job: PreparationJob, signal: AbortSignal) {
      const appRoot = appFolder(options.dataRoot, job.app);
      // 자식은 lophn의 준비 code만 돌고 앱 source는 준비 안의 자식에서만 실행된다. 환경은 npm이 쓰는
      // HOME·PATH·TMPDIR만 넘긴다. env를 주면 부모 환경을 통째로 대체한다.
      const env = childEnvironment(tmpdir());
      const launch = nodeCommand(JOB, [
        JSON.stringify({
          dataRoot: options.dataRoot,
          app: job.app,
          sourceRoot: job.source_path,
          commit: job.commit,
          previousSchema: job.previous_schema,
        }),
      ]);
      const child = spawn(launch.command, launch.args, {
        env: { ...env, ...launch.env },
        stdio: ["ignore", "pipe", "ignore"],
        ...treeSpawnOptions(),
      });
      let stopped = false;
      const stop = () => {
        stopped = true;
        killTree(child);
      };
      if (signal.aborted) stop();
      signal.addEventListener("abort", stop, { once: true });
      const timer = setTimeout(
        stop,
        options.limitMs ?? RELEASE_PREPARATION_LIMIT_MS,
      );
      try {
        const stdout = await collectStdout(child);
        if (stopped) {
          await rm(`${appRoot}/staging`, { recursive: true }).catch(
            () => undefined,
          );
          return err({
            stage: "build",
            reason: "the preparation was stopped (time limit)",
          });
        }
        return readOutcome(new TextDecoder().decode(stdout));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      }
    },
  };
}

// 자식이 끝날 때까지 stdout을 모은다. 'error'를 받지 않으면 spawn 실패(ENOENT 등)가 process를 죽인다.
function collectStdout(child: ChildProcess): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => resolve(Buffer.concat(chunks)));
  });
}

const FAILURE_STAGES = ["build", "dependencies", "migration"] as const;

function readOutcome(
  stdout: string,
): Result<PreparationOutcome, PreparationFailure> {
  try {
    const line = stdout.trim().split("\n").at(-1) ?? "";
    const parsed = JSON.parse(line) as {
      ok?: boolean;
      bundle_hash?: string;
      declaration_hash?: string;
      stage?: string;
      reason?: string;
    };
    if (
      parsed.ok === true &&
      typeof parsed.bundle_hash === "string" &&
      typeof parsed.declaration_hash === "string"
    ) {
      return ok({
        bundle_hash: parsed.bundle_hash,
        declaration_hash: parsed.declaration_hash,
      });
    }
    if (parsed.ok === false && typeof parsed.reason === "string") {
      const stage = FAILURE_STAGES.find((known) => known === parsed.stage);
      return err({ stage: stage ?? "build", reason: parsed.reason });
    }
  } catch {
    /* 결과 줄이 없다 */
  }
  return err({ stage: "build", reason: "the preparation process failed" });
}
