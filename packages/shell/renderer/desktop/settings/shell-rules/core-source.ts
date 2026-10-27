// ShellRulesSource를 선언 설정(`approvals.shell_rules`)의 읽기·쓰기로 만든다.
// `settings/update`에 compare가 없고 화면을 연 사이 `always`가 같은 값에 줄을 더하므로, 바꿀 때마다 저장 직전에
// 값을 다시 읽어 한 줄만 고치고 값 전체를 쓴다. 화면이 쥔 값을 통째로 쓰면 그 줄을 잃는다.
import {
  SHELL_RULES_SETTING_KEY,
  type ShellRulesSetting,
  shellRulesSettingSchema,
} from "../../../../../protocol/approvals/shell-rules.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { readProjects } from "../../launcher/projects/core-source.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import { withAction, withAdded, withRemoved } from "./model.ts";
import type { ShellRulesSource, SourceResult } from "./source.ts";

export function coreShellRulesSource(core: CoreSource): ShellRulesSource {
  async function readValue(): Promise<SourceResult<ShellRulesSetting>> {
    const read = await readEffective(core, [SHELL_RULES_SETTING_KEY]);
    if (!read.ok) return read;
    // 모르는 값을 지어내지 않는다.
    const parsed = shellRulesSettingSchema.safeParse(
      read.value.get(SHELL_RULES_SETTING_KEY),
    );
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, code: "internal" };
  }

  async function change(
    make: (value: ShellRulesSetting) => ShellRulesSetting,
  ): Promise<SourceResult<null>> {
    const current = await readValue();
    if (!current.ok) return current;
    return chooseSetting(core, SHELL_RULES_SETTING_KEY, make(current.value));
  }

  return {
    watch: (listener) => core.subscribe(listener),

    async read() {
      const value = await readValue();
      if (!value.ok) return value;
      const listed = await readProjects(core);
      if (!listed.ok) return listed;
      const named = new Map(listed.value.map((one) => [one.id, one.title]));
      const ids = [
        ...new Set([...named.keys(), ...Object.keys(value.value.projects)]),
      ];
      const projects = ids
        .map((id) => ({
          id,
          name: named.get(id) ?? id,
          rules: value.value.projects[id] ?? [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, value: { global: value.value.global, projects } };
    },

    add: (layer, rule) => change((value) => withAdded(value, layer, rule)),
    remove: (layer, index) =>
      change((value) => withRemoved(value, layer, index)),
    setAction: (layer, index, action) =>
      change((value) => withAction(value, layer, index, action)),
  };
}
