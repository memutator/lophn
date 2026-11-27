// 알림 줄의 action 단추. open_home_skill은 home lophn의 새 대화를 열고 `/<skill> <args>`를 사람의 첫 말로 보낸다.
// 단추를 누른 것이 사람의 명령이라 program이 스스로 session을 여는 것(event.md가 금지)이 아니다. 새 core route 없이 Agent 탭이
// 첫 말에 하는 일(session 열기 → 메시지 보내기)을 같은 source로 한다.

import type {
  Notice,
  NoticeAction,
} from "../../../../../protocol/apps/notice.ts";
import type { FollowUpItem } from "../../../../../protocol/base/follow-ups.ts";
import type { FilesApi } from "../../../../ipc/files.ts";
import { textBlocks } from "../../../../../protocol/lophn-agent/content-block.ts";
import { lophnIdOf } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { coreAgentTabSourceFactory } from "../../../conversation/agent-tab-core-source.ts";
import { newId } from "../../../prefixed-id.ts";
import type { MachineRef } from "../../machines/scope.tsx";
import type { CoreSource } from "../connection.ts";
import { runToastAction } from "../toasts/toast-actions.ts";
import { markNoticesRead } from "./history.ts";

// 받은 file 폴더를 OS 파일 관리자에서 연다. path는 그 줄을 남긴 컴퓨터의 것이라 이 컴퓨터의 줄일 때만 연다.
async function revealReceivedFiles(path: string): Promise<boolean> {
  const bridge = (globalThis as { lophnFiles?: FilesApi }).lophnFiles;
  if (bridge === undefined) return false;
  try {
    return (await bridge.reveal({ path })).ok;
  } catch {
    return false;
  }
}

/** 시작했으면 true. home skill이면 보낸 뒤 그 대화를 연다. */
export async function runNoticeAction(
  core: CoreSource,
  action: NoticeAction,
  machine: MachineRef = null,
): Promise<boolean> {
  if (action.kind === "reveal_received_files") {
    return machine === null && (await revealReceivedFiles(action.path));
  }
  // 이름 그대로 Home lophn의 새 대화다(`open_home_skill`).
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
    seen: null,
  });
  if (!sent.ok) return false;
  runToastAction({
    kind: "session",
    session,
    ...(machine === null ? {} : { machine }),
  });
  return true;
}

/** 줄의 단추를 누른 일. 시작했으면 그 줄을 읽음으로 바꾼다(휘발 줄에는 action이 없다). */
export async function applyNoticeAction(
  core: CoreSource,
  row: Notice,
  action: NoticeAction,
  machine: MachineRef = null,
): Promise<boolean> {
  const started = await runNoticeAction(core, action, machine);
  if (started && row.read_at === null) await markNoticesRead(core, [row.id]);
  return started;
}

/**
 * 열린 follow-up item을 눌렀을 때 대상 그릇(home/project/app)의 lophn 새 대화를 열고
 * 그 항목의 id·제목·본문을 첫 말로 넘겨 이어서 처리하게 한다.
 */
export async function openFollowUpSession(
  core: CoreSource,
  item: FollowUpItem,
  machine: MachineRef = null,
): Promise<boolean> {
  const workspace =
    item.workspace === null
      ? ({ kind: "global", id: "" } as const)
      : item.workspace;
  const source = coreAgentTabSourceFactory(core)({
    assignment: lophnIdOf(item.workspace),
    workspace,
  });
  const now = Date.now();
  const session = newId("ses", now);
  const opened = await source.openSession({ id: session });
  if (!opened.ok) return false;
  const message = newId("msg", now);
  const prompt = [
    `Follow-up item ${item.id}: ${item.title}`,
    "",
    item.body,
  ].join("\n");
  const sent = await source.send({
    session,
    id: message,
    key: `session-messages-send-${message}`,
    content: textBlocks(prompt),
    delivery: "next_turn",
    seen: null,
  });
  if (!sent.ok) return false;
  runToastAction({
    kind: "session",
    session,
    ...(machine === null ? {} : { machine }),
  });
  return true;
}
