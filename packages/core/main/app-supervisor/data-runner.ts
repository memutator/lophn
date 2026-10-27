// 앱 전용 data worker 작업 한 번을 별도 Deno 자식(`packages/core/main/worker/data-job.ts`)으로 돌린다.
// lophn 자신의 코드라 권한을 좁히지 않는다: 좁힌 flag는 막는 것이 없고, Deno의 `node:*`가 권한을 더 요구하면
// 이 자식만 깨진다. supervisor와 core는 앱 DB를 열지 않는다: 이 자식이 종료 확인 뒤의 DB를 단독으로 연다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { decodeActivationDataJobInput } from "../../../protocol/apps/mod.ts";

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
        input = decodeActivationDataJobInput(line);
      } catch {
        return err({ code: "invalid_input", message: "data job is invalid" });
      }
      if (input.app !== app) {
        return err({ code: "invalid_input", message: "data job is invalid" });
      }
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
          "--allow-all",
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
