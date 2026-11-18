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
  // 탭이 기억하는 coding agent session 이름(GUI 제목, hook 이름, 터미널 제목)과 그 session의 id. 이름의 출처가 잠깐
  // 사라져도, 탭을 그리지 않아도, 다른 workspace의 sidebar에서도 같은 session인 동안 이 이름이 보인다.
  agent_title: z.string().min(1).max(200).optional(),
  agent_session: z.string().min(1).max(200).optional(),
  project_folder: z.string().min(1).max(4096),
  // core가 가진 터미널(`trm_…`). 앱을 다시 켜면 탭이 이 터미널이 살아 있으면 붙는다.
  terminal_ref: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,80}$/)
    .optional(),
  // 이 터미널에서 coding agent(harness id)가 돈 적이 있다. 다른 workspace의 sidebar가 저장된 layout만 보고 coding agent 터미널을 알아본다.
  harness: z
    .string()
    .regex(/^[a-z0-9_-]{1,64}$/)
    .optional(),
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
