// 옛 `approvals.shell_rules` 설정을 통합 `approvals.permission_rules`(`category: "shell"`)로 옮기는 data step.
// 사람의 모든 전역·project 규칙을 결정적 id로 보존하고 옛 키를 지운다. 다시 돌아도 같다(idempotent).
import { createHash } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../base/mod.ts";
import {
  DEFAULT_PERMISSION_RULES_SETTING,
  LEGACY_SHELL_RULES_SETTING_KEY,
  PERMISSION_RULES_SETTING_KEY,
  type PermissionRule,
  type PermissionRulesSetting,
  permissionRulesSettingSchema,
  type ShellRule,
  shellRulesSettingSchema,
} from "../../../protocol/approvals/mod.ts";
import type { DataStep } from "../../storage/migration/mod.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function deterministicRuleId(
  scope: string,
  index: number,
  rule: ShellRule,
): string {
  const hash = createHash("sha256")
    .update(`${scope}\0${rule.action}\0${rule.pattern}`)
    .digest("hex")
    .slice(0, 10);
  return `migrated-shell-${scope}-${index}-${hash}`;
}

function mergeShellRules(
  existing: readonly PermissionRule[],
  incoming: readonly ShellRule[],
  scope: string,
  source: "global" | "project",
): PermissionRule[] {
  const out = [...existing];
  const usedIds = new Set(out.map((r) => r.id));

  for (let idx = 0; idx < incoming.length; idx++) {
    const legacy = incoming[idx];
    const duplicate = out.some(
      (r) =>
        r.category === "shell" &&
        r.pattern === legacy.pattern &&
        r.action === legacy.action,
    );
    if (duplicate) continue;

    let id = deterministicRuleId(scope, idx, legacy);
    let suffix = 1;
    while (usedIds.has(id)) {
      id = `${deterministicRuleId(scope, idx, legacy)}-${suffix++}`;
    }
    usedIds.add(id);
    out.push({
      id,
      category: "shell",
      pattern: legacy.pattern,
      action: legacy.action,
      source,
    });
  }

  return out;
}

export const migrateShellRulesDataStep: DataStep = {
  id: "approvals.permission-rules-migrate",
  async run(root): Promise<Result<void>> {
    const path = `${root}/settings.json`;
    try {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (thrown) {
        if (errorCode(thrown) === "ENOENT") return ok(undefined);
        throw thrown;
      }

      let settings: unknown;
      try {
        settings = JSON.parse(text);
      } catch {
        // 사람이 고칠 파일이다. 옮길 수 없으면 그대로 둔다.
        return ok(undefined);
      }
      if (!isRecord(settings)) return ok(undefined);
      if (!(LEGACY_SHELL_RULES_SETTING_KEY in settings)) return ok(undefined);

      const legacyParsed = shellRulesSettingSchema.safeParse(
        settings[LEGACY_SHELL_RULES_SETTING_KEY],
      );
      if (!legacyParsed.success) {
        // 모양이 깨진 옛 값은 버리지 않고 그대로 둔다.
        return ok(undefined);
      }

      const currentParsed = permissionRulesSettingSchema.safeParse(
        settings[PERMISSION_RULES_SETTING_KEY],
      );
      const current: PermissionRulesSetting = currentParsed.success
        ? currentParsed.data
        : DEFAULT_PERMISSION_RULES_SETTING;

      const nextGlobal = mergeShellRules(
        current.global,
        legacyParsed.data.global,
        "global",
        "global",
      );
      const nextProjects: Record<string, PermissionRule[]> = {
        ...current.projects,
      };
      for (const [projectId, projectRules] of Object.entries(
        legacyParsed.data.projects,
      )) {
        nextProjects[projectId] = mergeShellRules(
          nextProjects[projectId] ?? [],
          projectRules,
          projectId,
          "project",
        );
      }

      const nextSettings: Record<string, unknown> = { ...settings };
      nextSettings[PERMISSION_RULES_SETTING_KEY] = {
        global: nextGlobal,
        projects: nextProjects,
      };
      delete nextSettings[LEGACY_SHELL_RULES_SETTING_KEY];

      const mode = (await stat(path)).mode & 0o777;
      const tmp = `${path}.migrate.tmp`;
      await writeFile(tmp, `${JSON.stringify(nextSettings, null, 2)}\n`, {
        mode,
      });
      await rename(tmp, path);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message:
          "settings.json의 옛 shell 규칙을 permission_rules로 옮기지 못했다",
      });
    }
  },
};
