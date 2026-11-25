// ShellRulesSource를 선언 설정(`approvals.permission_rules`)의 쓰기로 만든다. 화면은 설정과 project 목록을 useCoreRead로
// 읽고 shellRulesViewOf로 푼다.
// `settings/update`에 compare가 없고 화면을 연 사이 `always`가 같은 값에 줄을 더하므로, 바꿀 때마다 저장 직전에
// 값을 다시 읽어 한 줄만 고치고 값 전체를 쓴다. 화면이 쥔 값을 통째로 쓰면 그 줄을 잃는다.
import {
  PERMISSION_RULES_SETTING_KEY,
  type PermissionRulesSetting,
  permissionRulesSettingSchema,
} from "../../../../../protocol/approvals/permission-rules.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import { withAction, withAdded, withRemoved } from "./model.ts";
import type {
  ShellRulesSource,
  ShellRulesView,
  SourceResult,
} from "./source.ts";

/** 저장된 값과 project 목록으로 화면의 층을 만든다. 설정에만 남은 project는 이름이 id다. 모르는 값은 null이다. */
export function shellRulesViewOf(
  stored: unknown,
  projects: readonly { readonly id: string; readonly title: string }[],
): ShellRulesView | null {
  // 모르는 값을 지어내지 않는다.
  const parsed = permissionRulesSettingSchema.safeParse(stored);
  if (!parsed.success) return null;
  const value = parsed.data;
  const named = new Map(projects.map((one) => [one.id, one.title]));
  const ids = [...new Set([...named.keys(), ...Object.keys(value.projects)])];
  return {
    global: value.global,
    projects: ids
      .map((id) => ({
        id,
        name: named.get(id) ?? id,
        rules: value.projects[id] ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function coreShellRulesSource(core: CoreSource): ShellRulesSource {
  async function readValue(): Promise<SourceResult<PermissionRulesSetting>> {
    const read = await readEffective(core, [PERMISSION_RULES_SETTING_KEY]);
    if (!read.ok) return read;
    // 모르는 값을 지어내지 않는다.
    const parsed = permissionRulesSettingSchema.safeParse(
      read.value.get(PERMISSION_RULES_SETTING_KEY),
    );
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, code: "internal" };
  }

  async function change(
    make: (value: PermissionRulesSetting) => PermissionRulesSetting,
  ): Promise<SourceResult<null>> {
    const current = await readValue();
    if (!current.ok) return current;
    return chooseSetting(
      core,
      PERMISSION_RULES_SETTING_KEY,
      make(current.value),
    );
  }

  return {
    add: (layer, rule) => change((value) => withAdded(value, layer, rule)),
    remove: (layer, index) =>
      change((value) => withRemoved(value, layer, index)),
    setAction: (layer, index, action) =>
      change((value) => withAction(value, layer, index, action)),
  };
}
