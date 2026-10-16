// agents 탭 kind. project의 agent 목록과 그 안에서 연 editor를 보이는 탭이다.
// layout 파일만 열어 둔 agent를 기억한다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("agents"),
  key: tabKey,
  agent: z.string().min(1).max(128).optional(),
});

type AgentsLayout = z.infer<typeof layout>;

export const agentsKind = defineTabKind<AgentsLayout>({
  kind: "agents",
  layout,
  // 열어 둔 agent가 없어졌는지는 탭이 열릴 때 목록을 읽어 보고 목록으로 돌아간다. 복원이 막을 일은 아니다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
