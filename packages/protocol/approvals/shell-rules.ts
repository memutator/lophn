import { z } from "zod";
import { idSchema } from "../base/ids.ts";

// shell 명령 규칙. 구현은 `packages/core/approvals/gate/shell-match.ts`(Gate)다.
//
// pattern 뜻:
// - `*`는 아무 글자(없는 것 포함)에 맞는다.
// - `\*`는 글자 그대로의 `*`다. `*`가 아니라 이것으로만 쓴 pattern은 `*`가 없는 것과 같다.
// - `*`가 없는 pattern은 그 명령과 똑같을 때만 맞는다.
// - 끝이 ` *`인 pattern은 그 앞까지만 있어도 맞는다(`git push *`는 `git push`에도 맞는다).
// - 맞추기 전에 명령과 pattern의 앞뒤 공백을 자르고 이어진 공백을 하나로 본다.
//
// 판정 순서: 명령 전체와, `&&`·`||`·`;`·`|`·줄바꿈으로 나눈 조각 각각에 규칙을 댄다.
// 하나에 대는 순서는 floor에 맞으면 deny, 아니면 layers(제품 기본 ask, 전역, project 순)를 이어 본
// 가운데 마지막에 맞은 규칙, 맞는 것이 없으면 allow다. 전체와 조각의 결과 가운데 가장 엄한 것
// (deny > ask > allow)이 명령의 결과다. floor deny는 어느 층도 덮지 못한다.
export const SHELL_RULE_ACTIONS = ["allow", "ask", "deny"] as const;

// 한 줄이다. 사람이 쓰므로 길이만 막는다.
export const shellPatternSchema = z.string().min(1).max(500).refine(
  (value) => value.trim() !== "" && !/[\r\n]/.test(value),
  { message: "shell pattern is one non-blank line" },
);

export const shellRuleSchema = z.strictObject({
  pattern: shellPatternSchema,
  action: z.enum(SHELL_RULE_ACTIONS),
});
export type ShellRule = z.infer<typeof shellRuleSchema>;

// Gate가 받는 규칙 층. 값은 core가 조립한다.
export type ShellRuleLayers = {
  floor: readonly ShellRule[];
  layers: readonly (readonly ShellRule[])[];
};

const deny = (pattern: string): ShellRule => ({ pattern, action: "deny" });
const ask = (pattern: string): ShellRule => ({ pattern, action: "ask" });

// floor는 사람도 덮지 못하므로 좁게 둔다. `rm -rf /*`처럼 `*`로 쓰면 `rm -rf /tmp/x`까지 막혀
// 일을 못 하므로, 글자 그대로의 `/*`·`~/*`만 floor에 둔다(`\*`). 나머지 rm -r은 ask가 attended에서 잡는다.
// 맞추기는 글자 그대로라 flag 순서(`-fr`, `-r -f`)와 `sudo` 앞붙임을 따로 적는다. 빠뜨리면 사람 없는
// run에서 flag 순서만 다른 `rm -fr ~`가 그대로 돈다.
// fork bomb은 조각으로 나누면 보이지 않아 명령 전체로만 맞는다.
// `git push`의 force는 `--force`가 앞이든 뒤든 잡게 `*`를 가운데 둔다. `git push*-f*`로 쓰지 않는 것은
// `git push origin feature-fix`가 맞지 않게 하려는 것이다.
const RM_FLAGS = ["-rf", "-fr", "-r -f", "-f -r"];
const RM_EVERYTHING = ["/", "~", "~/", "/\\*", "~/\\*"];

export const PRODUCT_SHELL_RULES: { floor: ShellRule[]; ask: ShellRule[] } = {
  floor: [
    ...["", "sudo "].flatMap((sudo) => [
      ...RM_FLAGS.flatMap((flags) =>
        RM_EVERYTHING.map((target) => `${sudo}rm ${flags} ${target}`)
      ),
      `${sudo}mkfs*`,
      `${sudo}dd * of=/dev/*`,
    ]),
    ":(){ :|:& };:",
  ].map(deny),
  ask: [
    "rm -r*",
    "rm -fr*",
    "rm -f -r*",
    "git push*--force*",
    "git push* -f*",
    "git reset --hard*",
    "curl * | sh *",
    "curl * | bash *",
    "wget * | sh *",
    "wget * | bash *",
  ].map(ask),
};

// Settings key `approvals.shell_rules`의 값. `declareSetting`은 core가 한다.
export const SHELL_RULES_SETTING_KEY = "approvals.shell_rules";

export const shellRulesSettingSchema = z.strictObject({
  global: z.array(shellRuleSchema),
  projects: z.record(idSchema("prj"), z.array(shellRuleSchema)),
});
export type ShellRulesSetting = z.infer<typeof shellRulesSettingSchema>;

export const DEFAULT_SHELL_RULES_SETTING: ShellRulesSetting = {
  global: [],
  projects: {},
};
