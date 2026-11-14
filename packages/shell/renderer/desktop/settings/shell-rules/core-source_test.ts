import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SHELL_RULES_SETTING_KEY,
  type ShellRulesSetting,
} from "../../../../../protocol/approvals/shell-rules.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { PROJECT_GROCERY, PROJECT_OFFICE } from "../../dev-mock/ids.ts";
import { coreShellRulesSource } from "./core-source.ts";

// 저장된 값 하나를 가진 core. `settings/update`가 받은 값을 그대로 저장하고 기록한다.
function fakeCore(stored: { value: ShellRulesSetting }) {
  const updates: unknown[] = [];
  const core: CoreSource = {
    subscribe: () => () => {},
    call: ({ method, body }) => {
      if (method === "list") {
        return Promise.resolve({
          ok: true,
          value: {
            settings: [
              {
                key: SHELL_RULES_SETTING_KEY,
                type: {},
                chosen: stored.value,
              },
            ],
          },
        });
      }
      const change = (body as { changes: { value: ShellRulesSetting }[] })
        .changes[0]!;
      updates.push(change.value);
      stored.value = change.value;
      return Promise.resolve({
        ok: true,
        value: { changed: [SHELL_RULES_SETTING_KEY], rejected: [] },
      });
    },
  };
  return { core, updates };
}

test("규칙 하나를 더하면 저장 직전에 다시 읽은 값에 그 줄만 더한다: 화면을 연 뒤 `always`가 더한 줄과 다른 층, 다른 project의 줄이 남는다", async () => {
  const stored = {
    value: {
      global: [],
      projects: { [PROJECT_GROCERY]: [{ pattern: "a *", action: "allow" }] },
    } as ShellRulesSetting,
  };
  const { core, updates } = fakeCore(stored);
  const source = coreShellRulesSource(core);

  // 화면이 연 뒤에 `always`가 전역과 같은 project, 다른 project에 줄을 더한다.
  stored.value = {
    global: [{ pattern: "git push *", action: "allow" }],
    projects: {
      [PROJECT_GROCERY]: [
        { pattern: "a *", action: "allow" },
        { pattern: "b *", action: "allow" },
      ],
      [PROJECT_OFFICE]: [{ pattern: "npm test *", action: "allow" }],
    },
  };

  const saved = await source.add(
    { kind: "project", project: PROJECT_GROCERY },
    { pattern: "npm publish *", action: "ask" },
  );

  assert.deepStrictEqual(saved.ok, true);
  assert.deepStrictEqual(updates, [
    {
      global: [{ pattern: "git push *", action: "allow" }],
      projects: {
        [PROJECT_GROCERY]: [
          { pattern: "a *", action: "allow" },
          { pattern: "b *", action: "allow" },
          { pattern: "npm publish *", action: "ask" },
        ],
        [PROJECT_OFFICE]: [{ pattern: "npm test *", action: "allow" }],
      },
    },
  ]);
});
