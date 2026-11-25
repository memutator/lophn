// Permission rules 화면의 가짜 통로. 규칙은 가짜 core의 설정에 두고 project 이름은 가짜 core의 project 목록이다.
import {
  DEFAULT_PERMISSION_RULES_SETTING,
  PERMISSION_RULES_SETTING_KEY,
  type PermissionRulesSetting,
} from "../../../../../../protocol/approvals/permission-rules.ts";
import { PROJECT_GROCERY } from "../../../dev-mock/ids.ts";
import { type FakeCore, fakeCore } from "../../testdata/fake-core.ts";
import { withAction, withAdded, withRemoved } from "../model.ts";
import type { ShellRulesSource } from "../source.ts";

interface FakeShellRulesOptions {
  value?: PermissionRulesSetting;
  /** 쓰기가 거절되는 code. 없으면 저장된다. */
  saveCode?: string;
  /** 규칙을 둘 가짜 core. 없으면 새로 만든다. */
  core?: FakeCore;
}

/** 화면 확인용 대표 값: `always`가 더한 꼴의 allow와 사람이 쓴 ask, project 하나의 allow. */
export const SAMPLE_SHELL_RULES: PermissionRulesSetting = {
  global: [
    {
      id: "rul_sample_1",
      category: "shell",
      pattern: "git push *",
      action: "allow",
    },
    {
      id: "rul_sample_2",
      category: "shell",
      pattern: "npm publish *",
      action: "ask",
    },
    {
      id: "rul_sample_3",
      category: "file",
      pattern: "~/.ssh/*",
      action: "deny",
    },
  ],
  projects: {
    [PROJECT_GROCERY]: [
      {
        id: "rul_sample_4",
        category: "shell",
        pattern: "npm run *",
        action: "allow",
      },
    ],
  },
};

export function fakeShellRules(options: FakeShellRulesOptions = {}) {
  const calls: unknown[][] = [];
  const core = options.core ?? fakeCore();
  let value = options.value ?? DEFAULT_PERMISSION_RULES_SETTING;
  core.set(PERMISSION_RULES_SETTING_KEY, value);
  function save(next: PermissionRulesSetting) {
    if (options.saveCode) {
      return Promise.resolve({ ok: false as const, code: options.saveCode });
    }
    value = next;
    core.set(PERMISSION_RULES_SETTING_KEY, next);
    core.changed("settings");
    return Promise.resolve({ ok: true as const, value: null });
  }
  const source: ShellRulesSource = {
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
  return { source, calls, core };
}
