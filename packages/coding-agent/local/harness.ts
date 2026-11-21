// `lophn harness`: 이 컴퓨터의 harness를 감지하고 harness의 전역 설정에 hook을 놓거나 지우고 지운 skill의 옛 사본을 지운다.
// core를 부르지 않는 local 명령이라 token이 없어도 돈다(Settings와 shell main이 exec로 부른다).
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { appSkills } from "../../protocol/apps/declaration/read.ts";
import {
  SHARED_APPS_SETTING_KEY,
  sharedAppsSettingSchema,
} from "../../protocol/approvals/mod.ts";
import { settingsList } from "../../protocol/config/mod.ts";
import {
  harnessInstallInputSchema,
  harnessStatusInputSchema,
  harnessUninstallInputSchema,
} from "../../protocol/coding-agent/mod.ts";
import {
  runHarnessDetect,
  runHarnessInstall,
  runHarnessStatus,
  runHarnessSyncSkills,
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
    name: "harness.sync_skills",
    summary: "Copy the shared apps' public skills into coding agent harnesses",
    description:
      "Reads the apps you gave to coding agents and copies their public skills into the skill folder of every harness whose lophn hook is installed. " +
      "While the harness extension is on, also copies the lophn-agent skill (how a harness agent replies to calls) into every harness skill folder, hook or not. " +
      "Only folders lophn wrote (they hold a .lophn-shared file) are overwritten or removed; a folder of yours with the same name is skipped. Needs lophn running.",
    input: empty,
    effect: "write",
    run: async (_input, ctx) => {
      const connected = ctx.core();
      if (!connected.ok) return connected;
      const core = connected.value;
      const setting = await core.read(settingsList, {
        keys: [SHARED_APPS_SETTING_KEY],
      });
      if (!setting.ok) return setting;
      const entry = setting.value.settings.find(
        (one) => one.key === SHARED_APPS_SETTING_KEY,
      );
      const apps = sharedAppsSettingSchema.safeParse(
        entry?.chosen ?? entry?.default ?? [],
      );
      // route 입력의 상한이다.
      const slugs = apps.success ? apps.data.slice(0, 64) : [];
      const read =
        slugs.length === 0
          ? { ok: true as const, value: { skills: [] } }
          : await core.read(appSkills, { apps: slugs });
      if (!read.ok) return read;
      return await runHarnessSyncSkills(
        {
          skills: read.value.skills,
          harness_enabled: true,
        },
        ctx.home,
        ctx.now(),
      );
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
