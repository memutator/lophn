// 알림 줄의 action 단추. open_home_skill은 home lophn의 새 대화를 열고 `/<skill> <args>`를 사람의 첫 말로 보낸다.
// 단추를 누른 것이 사람의 명령이라 program이 스스로 session을 여는 것(event.md가 금지)이 아니다. 새 core route 없이 Agent 탭이
// 첫 말에 하는 일(session 열기 → 메시지 보내기)을 같은 source로 한다.

import type {
  Notice,
  NoticeAction,
} from "../../../../../protocol/apps/notice.ts";
import { textBlocks } from "../../../../../protocol/lophn-agent/content-block.ts";
import { lophnIdOf } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { coreAgentTabSourceFactory } from "../../../conversation/agent-tab-core-source.ts";
import { newId } from "../../../prefixed-id.ts";
import type { CoreSource } from "../connection.ts";
import { runToastAction } from "../toasts/toast-actions.ts";
import { markNoticesRead } from "./history.ts";

/** 보냈으면 true. 보낸 뒤 그 대화를 연다. */
export async function runNoticeAction(
  core: CoreSource,
  action: NoticeAction,
): Promise<boolean> {
  const source = coreAgentTabSourceFactory(core)({
    assignment: lophnIdOf(null),
    workspace: { kind: "global", id: "" },
  });
  const now = Date.now();
  const session = newId("ses", now);
  const opened = await source.openSession({ id: session });
  if (!opened.ok) return false;
  const message = newId("msg", now);
  const sent = await source.send({
    session,
    id: message,
    key: `session-messages-send-${message}`,
    content: textBlocks(`/${action.skill} ${action.args}`.trim()),
    delivery: "next_turn",
  });
  if (!sent.ok) return false;
  runToastAction({ kind: "session", session });
  return true;
}

/** 줄의 단추를 누른 일. 시작했으면 그 줄을 읽음으로 바꾼다(휘발 줄에는 action이 없다). */
export async function applyNoticeAction(
  core: CoreSource,
  row: Notice,
  action: NoticeAction,
): Promise<boolean> {
  const started = await runNoticeAction(core, action);
  if (started && row.read_at === null) await markNoticesRead(core, [row.id]);
  return started;
}
