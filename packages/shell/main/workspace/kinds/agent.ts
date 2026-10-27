// agent 탭 kind. place에 놓인 agent 하나와 그 agent의 session 하나를 보이는 Agent 화면이다.
// layout 파일에는 agent·place·session 참조만 남는다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { idOf, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("agent"),
  key: tabKey,
  // place에 놓인 agent의 id.
  agent: z.string().min(1).max(128),
  // 이 layout의 project place다. 앱 공간의 Agent 칸은 이 layout을 쓰지 않는다.
  work_place: z.strictObject({
    kind: z.literal("project"),
    id: z.string().refine((value) => idOf("prj", value) !== null),
  }),
  // 비면 첫 말을 보내기 전의 새 session이다.
  session: z
    .string()
    .refine((value) => idOf("ses", value) !== null)
    .nullable()
    .optional(),
});

type AgentLayout = z.infer<typeof layout>;

export const agentKind = defineTabKind<AgentLayout>({
  kind: "agent",
  layout,
  // 없어진 agent나 지워진 session은 탭이 열릴 때 안내한다. 복원이 막을 일은 아니다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
