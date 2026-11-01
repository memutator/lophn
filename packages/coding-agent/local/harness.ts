// `lophn harness`: 이 컴퓨터의 harness를 감지하고 harness의 전역 설정에 hook을 놓거나 지우고 지운 skill의 옛 사본을 지운다.
// core를 부르지 않는 local 명령이라 token이 없어도 돈다(Settings와 shell main이 exec로 부른다).
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  harnessInstallInputSchema,
  harnessStatusInputSchema,
  harnessUninstallInputSchema,
} from "../../protocol/coding-agent/mod.ts";
import {
  runHarnessDetect,
  runHarnessInstall,
  runHarnessStatus,
  runHarnessUninstall,
} from "./harness-run.ts";
import type { LocalCommand } from "./types.ts";

const empty = z.strictObject({});

export const HARNESS_COMMANDS: readonly LocalCommand[] = [
  {
    name: "harness.detect",
    summary: "Find harness executables on this computer",
    description:
      "Looks for each supported harness executable without running it. Nothing is saved.",
    input: empty,
    effect: "read",
    run: (_input, ctx) => runHarnessDetect("detect", ctx),
  },
  {
    name: "harness.refresh",
    summary: "Find harnesses and check their versions",
    description:
      "Like detect, and also runs each harness once to read its version. Nothing is saved.",
    input: empty,
    effect: "read",
    run: (_input, ctx) => runHarnessDetect("refresh", ctx),
  },
  {
    name: "harness.install",
    summary: "Place the lophn hook and remove old skill copies",
    description:
      "Writes the lophn hook into a harness's global settings and removes copies of skills lophn no longer ships. With --dry-run nothing is written; the result says what is missing.",
    input: harnessInstallInputSchema,
    effect: "write",
    run: async (input, ctx) => {
      const checked = harnessInstallInputSchema.safeParse(input);
      if (!checked.success) {
        return err({
          code: "invalid_input",
          message: "harness, dry_run or command input is not valid",
        });
      }
      const done = await runHarnessInstall(checked.data, ctx.home, ctx.now());
      return done.ok ? ok(done.value) : done;
    },
  },
  {
    name: "harness.status",
    summary: "Check whether every harness has the hook placed",
    description:
      "Runs install --dry-run for every harness in one process and lists the results.",
    input: harnessStatusInputSchema,
    effect: "read",
    run: async (input, ctx) => {
      const checked = harnessStatusInputSchema.safeParse(input);
      if (!checked.success) {
        return err({
          code: "invalid_input",
          message: "command input is not valid",
        });
      }
      return await runHarnessStatus(checked.data, ctx.home, ctx.now());
    },
  },
  {
    name: "harness.uninstall",
    summary: "Remove the lophn hook from a harness's global settings",
    description:
      "Removes only lophn's own entries from the harness's global settings.",
    input: harnessUninstallInputSchema,
    effect: "write",
    run: async (input, ctx) => {
      const checked = harnessUninstallInputSchema.safeParse(input);
      if (!checked.success) {
        return err({
          code: "invalid_input",
          message: "harness input is not valid",
        });
      }
      return await runHarnessUninstall(checked.data, ctx.home);
    },
  },
];
