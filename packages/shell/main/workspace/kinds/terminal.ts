// terminal 탭 kind. 복원은 종료된 자리표시이고 PTY를 만들지 않는다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("terminal"),
  key: tabKey,
  // plain terminal의 탭 제목.
  title: z.string().min(1).max(200).optional(),
  // 사람이 탭에 붙인 이름. 있으면 자동 이름(title)과 agent의 터미널 제목보다 먼저 보인다.
  name: z.string().min(1).max(200).optional(),
  project_folder: z.string().min(1).max(4096),
});

type TerminalLayout = z.infer<typeof layout>;
export const terminalKind = defineTabKind<TerminalLayout>({
  kind: "terminal",
  layout,
  // 사람이 새로 시작하기 전까지 PTY를 만들지 않는 종료된 자리표시다.
  restore: (tab) =>
    Promise.resolve({
      kind: "placeholder",
      key: tab.key,
      origin: tab.kind,
      title: tab.project_folder,
      reason: "app_unavailable",
    }),
});
