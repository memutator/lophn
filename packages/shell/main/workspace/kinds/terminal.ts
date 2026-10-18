// terminal 탭 kind. 복원은 종료된 자리표시이고 PTY를 만들지 않는다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { idOf, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("terminal"),
  key: tabKey,
  // plain terminal의 탭 제목. coding 탭은 `coding.title`을 쓴다.
  title: z.string().min(1).max(200).optional(),
  project_folder: z.string().min(1).max(4096),
  // lophn(core 요청)이 연 coding 터미널 탭의 표지. 없으면 사람이 연 shell 탭이다.
  coding: z.strictObject({
    session: z.string().refine((value) => idOf("ses", value) !== null),
    product: z.string().min(1).max(80),
    title: z.string().min(1).max(200).optional(),
  }).optional(),
});

type TerminalLayout = z.infer<typeof layout>;
export const terminalKind = defineTabKind<TerminalLayout>({
  kind: "terminal",
  layout,
  // 사람이 새로 시작하기 전까지 PTY를 만들지 않는 종료된 자리표시다. coding session도 lophn이 꺼지면 끝난다.
  restore: (tab) =>
    Promise.resolve({
      kind: "placeholder",
      key: tab.key,
      origin: tab.kind,
      title: tab.project_folder,
      reason: "app_unavailable",
    }),
});
