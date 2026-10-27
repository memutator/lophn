// Shell rules 화면의 가짜 통로. core를 부르지 않고 규칙을 메모리에 둔다.
import {
  DEFAULT_SHELL_RULES_SETTING,
  type ShellRulesSetting,
} from "../../../../../../protocol/approvals/shell-rules.ts";
import { PROJECT_GROCERY, PROJECT_OFFICE } from "../../../dev-mock/ids.ts";
import { withAction, withAdded, withRemoved } from "../model.ts";
import type { ShellRulesSource } from "../source.ts";

interface FakeShellRulesOptions {
  value?: ShellRulesSetting;
  /** 쓰기가 거절되는 code. 없으면 저장된다. */
  saveCode?: string;
  readFails?: boolean;
}

const PROJECT_NAMES: Readonly<Record<string, string>> = {
  [PROJECT_GROCERY]: "Grocery budget",
  [PROJECT_OFFICE]: "Home office",
};

/** 화면 확인용 대표 값: `always`가 더한 꼴의 allow와 사람이 쓴 ask, project 하나의 allow. */
export const SAMPLE_SHELL_RULES: ShellRulesSetting = {
  global: [
    { pattern: "git push *", action: "allow" },
    { pattern: "npm publish *", action: "ask" },
  ],
  projects: {
    [PROJECT_GROCERY]: [{ pattern: "npm run *", action: "allow" }],
  },
};

export function fakeShellRules(options: FakeShellRulesOptions = {}) {
  const calls: unknown[][] = [];
  let value = options.value ?? DEFAULT_SHELL_RULES_SETTING;
  function save(next: ShellRulesSetting) {
    if (options.saveCode) {
      return Promise.resolve({ ok: false as const, code: options.saveCode });
    }
    value = next;
    return Promise.resolve({ ok: true as const, value: null });
  }
  const source: ShellRulesSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    read() {
      calls.push(["read"]);
      if (options.readFails) {
        return Promise.resolve({ ok: false, code: "unavailable" });
      }
      const ids = [
        ...new Set([
          ...Object.keys(PROJECT_NAMES),
          ...Object.keys(value.projects),
        ]),
      ];
      return Promise.resolve({
        ok: true,
        value: {
          global: value.global,
          projects: ids
            .map((id) => ({
              id,
              name: PROJECT_NAMES[id] ?? id,
              rules: value.projects[id] ?? [],
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        },
      });
    },
    add(layer, rule) {
      calls.push(["add", layer, rule]);
      return save(withAdded(value, layer, rule));
    },
    remove(layer, index) {
      calls.push(["remove", layer, index]);
      return save(withRemoved(value, layer, index));
    },
    setAction(layer, index, action) {
      calls.push(["setAction", layer, index, action]);
      return save(withAction(value, layer, index, action));
    },
  };
  return { source, calls };
}
