// `lophn harness`: 이 컴퓨터의 harness를 감지하고 harness의 전역 설정에 hook을 놓거나 지우고 지운 skill의 옛 사본을 지운다.
// core를 부르지 않는 local 명령이라 coding token이 없어도 돈다(Settings와 shell main이 exec로 부른다).
import { err, ok } from "../../../base/mod.ts";
import {
  harnessInstallInputSchema,
  harnessStatusInputSchema,
  harnessUninstallInputSchema,
} from "../../../protocol/coding-agent/mod.ts";
import {
  runHarnessDetect,
  runHarnessInstall,
  runHarnessStatus,
  runHarnessUninstall,
} from "./harness-run.ts";
import { type CommandEntry, entryOf } from "./types.ts";

export const HARNESS_COMMANDS: readonly CommandEntry[] = [
  entryOf("harness detect", "harness 실행 파일을 찾는다", {
    run: (_input, ctx) => runHarnessDetect("detect", ctx.local),
  }),
  entryOf("harness refresh", "harness를 찾고 version을 확인한다", {
    run: (_input, ctx) => runHarnessDetect("refresh", ctx.local),
  }),
  entryOf("harness install", "hook을 놓고 지운 skill의 옛 사본을 지운다", {
    run: async (input, ctx) => {
      const checked = harnessInstallInputSchema.safeParse(input);
      if (!checked.success) {
        return err({
          code: "invalid_input",
          message: "harness·dry_run·command 입력이 맞지 않다",
        });
      }
      const done = await runHarnessInstall(
        checked.data,
        ctx.local.home,
        ctx.local.now(),
      );
      return done.ok ? ok(done.value) : done;
    },
  }),
  entryOf("harness status", "모든 harness에 hook이 놓였는지 본다", {
    run: async (input, ctx) => {
      const checked = harnessStatusInputSchema.safeParse(input);
      if (!checked.success) {
        return err({
          code: "invalid_input",
          message: "command 입력이 맞지 않다",
        });
      }
      return await runHarnessStatus(
        checked.data,
        ctx.local.home,
        ctx.local.now(),
      );
    },
  }),
  entryOf("harness uninstall", "harness 전역 설정에서 lophn hook을 지운다", {
    run: async (input, ctx) => {
      const checked = harnessUninstallInputSchema.safeParse(input);
      if (!checked.success) {
        return err({
          code: "invalid_input",
          message: "harness 입력이 맞지 않다",
        });
      }
      return await runHarnessUninstall(checked.data, ctx.local.home);
    },
  }),
];
