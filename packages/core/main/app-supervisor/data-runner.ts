// 앱 전용 data worker 작업 한 번을 권한을 좁힌 별도 Deno 자식(`packages/core/main/worker/data-job.ts`)으로 돌린다
// (architecture/apps 2.1). 한 앱의 데이터 영역만 쓸 수 있고 network·secret·환경·subprocess 권한이 없다.
// supervisor와 core는 앱 DB를 열지 않는다: 이 자식이 종료 확인 뒤의 DB를 단독으로 연다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { decodeDataJobInput } from "../../../protocol/apps/mod.ts";

const JOB = new URL("../worker/data-job.ts", import.meta.url).pathname;
const REPO = new URL("../../../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const JOB_LIMIT_MS = 300_000;

export type DataJobRunner = {
  // 작업 입력 한 줄을 돌려 출력 한 줄을 받는다. 입력의 app이 `app`과 다르면 돌리지 않는다.
  run(app: string, line: string): Promise<Result<string>>;
};

export function createChildDataRunner(options: {
  dataRoot: string;
  deno: () => string;
  denoDir: string;
  limitMs?: number;
}): DataJobRunner {
  return {
    async run(app, line) {
      let input;
      try {
        input = decodeDataJobInput(line);
      } catch {
        return err({ code: "invalid_input", message: "data job is invalid" });
      }
      if (input.app !== app) {
        return err({ code: "invalid_input", message: "data job is invalid" });
      }
      const appRoot = `${options.dataRoot}/apps/${app}`;
      const child = new Deno.Command(options.deno(), {
        clearEnv: true,
        env: {
          ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
          DENO_DIR: options.denoDir,
        },
        args: [
          "run",
          "--quiet",
          "--no-prompt",
          `--config=${REPO}/deno.json`,
          // 그 앱의 폴더만 읽고(bundle 사본·backup) 데이터 영역에만 쓴다.
          `--allow-read=${appRoot},${REPO},${options.denoDir}`,
          `--allow-write=${appRoot}/data`,
          JOB,
          options.dataRoot,
        ],
        stdin: "piped",
        stdout: "piped",
        stderr: "null",
      }).spawn();
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch { /* 이미 끝났다 */ }
      }, options.limitMs ?? JOB_LIMIT_MS);
      try {
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(line));
        await writer.close();
        const output = await child.output();
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
