// `lophn harness`: 이 컴퓨터의 harness를 감지하고 harness의 전역 설정에 skill과 hook을 놓는다. core를 부르지
// 않는 local 명령이라 coding token이 없어도 돈다(Settings와 shell main이 exec로 부른다).
import { err, ok } from "../../../base/mod.ts";
import { harnessInstallInputSchema } from "../../../protocol/coding-agent/mod.ts";
import { runHarnessDetect, runHarnessInstall } from "./harness-run.ts";
import { type CommandEntry, entryOf } from "./types.ts";

export const HARNESS_COMMANDS: readonly CommandEntry[] = [
  entryOf("harness detect", "harness 실행 파일을 찾는다", {
    run: (_input, ctx) => runHarnessDetect("detect", ctx.local),
  }),
  entryOf("harness refresh", "harness를 찾고 version·login을 확인한다", {
    run: (_input, ctx) => runHarnessDetect("refresh", ctx.local),
  }),
  entryOf("harness install", "harness의 전역 설정에 hook과 skill을 놓는다", {
    run: async (input, ctx) => {
      const checked = harnessInstallInputSchema.safeParse(input);
      if (!checked.success) {
        return err({
          code: "invalid_input",
          message: "harness·dry_run 입력이 맞지 않다",
        });
      }
      const done = await runHarnessInstall(checked.data, ctx.local.home);
      return done.ok ? ok(done.value) : done;
    },
  }),
];
