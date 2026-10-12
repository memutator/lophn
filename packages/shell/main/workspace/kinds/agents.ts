// agents 탭 kind. project의 agent 목록과 그 안에서 연 editor를 보이는 탭이라 현재 보기에는 대상이 없다
// (shell/workspace#R36). layout 파일만 열어 둔 agent를 기억한다(R6).
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { idOf, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("agents"),
  key: tabKey,
  agent: z.string().refine((value) => idOf("asg", value) !== null).optional(),
});

export type AgentsLayout = z.infer<typeof layout>;
export type AgentsHint = { kind: "agents"; key: string };
export type AgentsView = { kind: "agents"; key: string; selected: boolean };

export const agentsKind = defineTabKind<AgentsLayout, AgentsHint, AgentsView>({
  kind: "agents",
  layout,
  // 열어 둔 agent가 없어졌는지는 탭이 열릴 때 목록을 읽어 보고 목록으로 돌아간다. 복원이 막을 일은 아니다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
  hint: (_raw, key) => ({ kind: "agents", key }),
  scope: () => {},
  view(hint, selected, ctx) {
    if (!ctx.refOk(hint.key)) return null;
    return { kind: hint.kind, key: hint.key, selected };
  },
  describe: () => "agents",
});
