// release 준비 한 번을 권한을 좁힌 별도 Deno 자식(`packages/core/main/worker/release-job.ts`)으로 돌린다.
// supervisor는 data root를 쓰지 못하므로 쓰기는 이 자식이 그 앱의 폴더(`apps/<app>`)에만
// 한다. 자식은 build 뒤에 의존성과 migration 검사도 돈다(앱이 쓴 migration SQL은 core에서 돌리지 않는다).
// 취소·종료는 자식을 SIGKILL하고 끝난 것을 확인한 뒤에야 돌려준다. 끊긴 준비가 남긴 staging은 지운다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  PreparationFailure,
  PreparationJob,
  PreparationOutcome,
  PreparationRunner,
} from "../../apps/releases/preparation.ts";
import {
  buildEnvironment,
  cacheBuildTools,
  esbuildBinaries,
} from "../../apps/releases/ui-build/binaries.ts";
import {
  appFolder,
  RELEASE_PREPARATION_LIMIT_MS,
} from "../../../protocol/apps/mod.ts";

const JOB = new URL("../worker/release-job.ts", import.meta.url).pathname;
const REPO = new URL("../../../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

export function createChildPreparationRunner(options: {
  dataRoot: string;
  deno: () => string;
  denoDir: string;
  limitMs?: number;
}): PreparationRunner {
  return {
    async run(job: PreparationJob, signal: AbortSignal) {
      const appRoot = appFolder(options.dataRoot, job.app);
      const deno = options.deno();
      // 자식은 시작할 때 이미 받아 둔 esbuild 실행 파일만 `--allow-run`에 담을 수 있다. 빈 deno-dir(새 기계)에서는
      // 아직 없으므로 자식을 띄우기 전에 build 도구를 받아 둔다.
      const env = buildEnvironment(Deno.env.get("TMPDIR") ?? "/tmp");
      if (!await cacheBuildTools(deno, env, signal)) {
        return err({ stage: "build", reason: "build tools are unavailable" });
      }
      // 자식은 git·deno·esbuild만 실행하고 환경은 몇 개 이름만 갖는다. 앱 source는 실행되지 않는다.
      const programs = ["git", deno, ...await esbuildBinaries(options.denoDir)];
      const child = new Deno.Command(deno, {
        clearEnv: true,
        env,
        args: [
          "run",
          "--quiet",
          "--no-prompt",
          `--config=${REPO}/deno.json`,
          `--allow-read=${job.source_path},${options.dataRoot}/sdk,${appRoot},${REPO},${options.denoDir}`,
          `--allow-write=${appRoot}`,
          // esbuild의 node 호환 spawn이 환경 전체 접근을 요구한다. 자식 환경이 이미 최소다.
          "--allow-env",
          `--allow-run=${programs.join(",")}`,
          JOB,
          JSON.stringify({
            dataRoot: options.dataRoot,
            app: job.app,
            sourceRoot: job.source_path,
            commit: job.commit,
            previousSchema: job.previous_schema,
          }),
        ],
        stdin: "null",
        stdout: "piped",
        stderr: "null",
      }).spawn();
      let stopped = false;
      const stop = () => {
        stopped = true;
        try {
          child.kill("SIGKILL");
        } catch { /* 이미 끝났다 */ }
      };
      if (signal.aborted) stop();
      signal.addEventListener("abort", stop, { once: true });
      const timer = setTimeout(
        stop,
        options.limitMs ?? RELEASE_PREPARATION_LIMIT_MS,
      );
      try {
        const output = await child.output();
        if (stopped) {
          await Deno.remove(`${appRoot}/staging`, { recursive: true }).catch(
            () => undefined,
          );
          return err({
            stage: "build",
            reason: "the preparation was stopped (time limit)",
          });
        }
        return readOutcome(new TextDecoder().decode(output.stdout));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      }
    },
  };
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
      blueprint_hash?: string;
      stage?: string;
      reason?: string;
    };
    if (
      parsed.ok === true && typeof parsed.bundle_hash === "string" &&
      typeof parsed.blueprint_hash === "string"
    ) {
      return ok({
        bundle_hash: parsed.bundle_hash,
        blueprint_hash: parsed.blueprint_hash,
      });
    }
    if (parsed.ok === false && typeof parsed.reason === "string") {
      const stage = FAILURE_STAGES.find((known) => known === parsed.stage);
      return err({ stage: stage ?? "build", reason: parsed.reason });
    }
  } catch { /* 결과 줄이 없다 */ }
  return err({ stage: "build", reason: "the preparation process failed" });
}
