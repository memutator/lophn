// 다른 컴퓨터의 agent가 남긴 handoff note를 읽고, 사람이 누르면 그 note를 첫 말로 새 session을 연다. note는 이 컴퓨터 core의
// `handoff/list`가 낸다(창이 다른 기계의 범위를 보고 있어도 이 컴퓨터의 것이다). sidebar는 context로 받아 그리므로 gallery도 같은 줄을 그린다.
import { createContext, useContext, useEffect, useState } from "react";

import {
  type HandoffNote,
  handoffList,
} from "../../../../../protocol/lophn-agent/handoff.ts";
import { textBlocks } from "../../../../../protocol/lophn-agent/content-block.ts";
import { lophnIdOf } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { coreAgentTabSourceFactory } from "../../../conversation/agent-tab-core-source.ts";
import { newId } from "../../../prefixed-id.ts";
import type { CoreSource } from "../../connection/connection.ts";
import {
  followRead,
  type Read,
  readRoute,
} from "../../connection/core-read.ts";
import type { EventClient } from "../../connection/events/client.ts";
import { runToastAction } from "../../connection/toasts/toast-actions.ts";

const REREAD_MS = 5 * 60 * 1000;
const NO_NOTES: readonly HandoffNote[] = [];

export interface Handoffs {
  readonly notes: readonly HandoffNote[];
  /** 그 note를 첫 말로 새 session을 연다. */
  open(note: HandoffNote): void;
}

const HandoffContext = createContext<Handoffs | null>(null);
export const HandoffProvider = HandoffContext.Provider;

/** provider가 없으면(note를 읽지 않는 화면) null이다. */
export function useHandoffs(): Handoffs | null {
  return useContext(HandoffContext);
}

// route가 없거나(옛 core) 이 창이 못 부르면 note가 없는 것이다.
async function readNotes(core: CoreSource): Read<readonly HandoffNote[]> {
  const read = await readRoute(core, handoffList, {});
  if (read.ok) return { ok: true, value: read.value.notes };
  return read.code === "not_found" || read.code === "forbidden"
    ? { ok: true, value: NO_NOTES }
    : read;
}

/** 창을 열 때, 다른 기계의 file이 왔을 때(`carry_files`), 5분마다 다시 읽는다. */
export function useHandoffNotes(events: EventClient): readonly HandoffNote[] {
  const [notes, setNotes] = useState(NO_NOTES);
  useEffect(() => {
    const follow = followRead(
      events,
      readNotes,
      ["carry_files"],
      (loaded) => {
        if (loaded.state === "ready") setNotes(loaded.value);
      },
      () => new Date(),
    );
    const timer = setInterval(follow.reload, REREAD_MS);
    return () => {
      clearInterval(timer);
      follow.stop();
    };
  }, [events]);
  return notes;
}

// 첫 말은 model이 읽는 글이라 catalog에 두지 않는다.
function firstMessage(note: HandoffNote): string {
  const where = [
    ...(note.branch === null ? [] : [`branch ${note.branch}`]),
    ...(note.commit === null ? [] : [`commit ${note.commit}`]),
    `written ${note.written_at}`,
  ].join(", ");
  return `Continue the work handed off from ${note.computer} (${where}). The note below was written by an agent there; bring the code over with git first if this computer does not have that commit.\n\n${note.text}`;
}

/**
 * 누른 것이 사람의 명령이라 그 project의 lophn에서 새 session을 열고 note를 첫 말로 보낸 뒤 그 session 탭으로 간다
 * (알림 줄의 `runNoticeAction`과 같은 길). 보냈으면 true.
 */
export async function continueHandoff(
  core: CoreSource,
  note: HandoffNote,
): Promise<boolean> {
  const workspace = { kind: "project", id: note.project } as const;
  const source = coreAgentTabSourceFactory(core)({
    assignment: lophnIdOf(workspace),
    workspace,
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
    content: textBlocks(firstMessage(note)),
    delivery: "next_turn",
    seen: null,
  });
  if (!sent.ok) return false;
  runToastAction({ kind: "session", session });
  return true;
}
