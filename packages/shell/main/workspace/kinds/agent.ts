// agent 탭 kind. agent 하나(built-in 또는 Operator)와 그 agent의 session 하나를 보이는 Agent 화면이다.
// layout 파일에는 agent·자리·session 참조만 남고 현재 보기에는 종류와 선택 여부만
// 간다 — 대화 내용·agent 지침은 넣지 않는다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { idOf, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("agent"),
  key: tabKey,
  agent: z.string().refine((value) => idOf("asg", value) !== null),
  // 이 layout의 project 자리다. 앱 공간의 Agent 칸은 이 layout을 쓰지 않는다.
  work_place: z.strictObject({
    kind: z.literal("project"),
    id: z.string().refine((value) => idOf("prj", value) !== null),
  }),
  // 비면 첫 말을 보내기 전의 새 session이다.
  session: z.string().refine((value) => idOf("ses", value) !== null)
    .nullable().optional(),
});

export type AgentLayout = z.infer<typeof layout>;
export type AgentHint = { kind: "agent"; key: string };
export type AgentView = { kind: "agent"; key: string; selected: boolean };

export const agentKind = defineTabKind<AgentLayout, AgentHint, AgentView>({
  kind: "agent",
  layout,
  // 없어졌거나 withdraw된 agent, 지워진 session은 다른 agent나 새 session으로 바꾸지 않고 자리표시다.
  async restore(tab, targets) {
    if (!(await targets.agent(tab.agent, tab.session ?? null))) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.agent,
        reason: "agent_missing",
      };
    }
    return { kind: "tab", tab };
  },
  hint: (_raw, key) => ({ kind: "agent", key }),
  scope: () => {},
  view(hint, selected, ctx) {
    if (!ctx.refOk(hint.key)) return null;
    return { kind: hint.kind, key: hint.key, selected };
  },
  describe: () => "agent",
});
