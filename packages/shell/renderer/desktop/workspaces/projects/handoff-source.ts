// 다른 컴퓨터의 agent가 남긴 handoff note를 읽고, 사람이 누르면 그 note를 첫 말로 새 session을 연다. note는 이 컴퓨터 core의
// `handoff/list`가 낸다(창이 다른 기계의 범위를 보고 있어도 이 컴퓨터의 것이다). sidebar는 context로 받아 그리므로 gallery도 같은 줄을 그린다.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

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
  /** 이 컴퓨터에서 숨기지 않은 note. */
  readonly notes: readonly HandoffNote[];
  /** 그 note를 첫 말로 새 session을 연다. 열었으면 note는 목록에서 빠지고, 못 열었으면 알리고 그대로 둔다. */
  open(note: HandoffNote): Promise<void>;
  /** 열지 않고 이 컴퓨터의 목록에서만 뺀다. */
  dismiss(note: HandoffNote): void;
}

const HandoffContext = createContext<Handoffs | null>(null);
export const HandoffProvider = HandoffContext.Provider;

/** provider가 없으면(note를 읽지 않는 화면) null이다. */
export function useHandoffs(): Handoffs | null {
  return useContext(HandoffContext);
}

interface NotesRead {
  readonly notes: readonly HandoffNote[];
  /** route가 답한 목록이다. 오류 답(아래)에서 만든 빈 목록이면 false라 숨김 key를 버리지 않는다. */
  readonly answered: boolean;
}

// route가 없거나(옛 core) 이 창이 못 부르면 보일 note가 없는 것이다.
async function readNotes(core: CoreSource): Read<NotesRead> {
  const read = await readRoute(core, handoffList, {});
  if (read.ok)
    return { ok: true, value: { notes: read.value.notes, answered: true } };
  return read.code === "not_found" || read.code === "forbidden"
    ? { ok: true, value: { notes: NO_NOTES, answered: false } }
    : read;
}

// 숨긴 note는 이 컴퓨터(localStorage)에만 기억한다. 키에 written_at이 들어 있어 agent가 note를 다시 쓰면 다시 보인다.
const HIDDEN_KEY = "lophn.handoff.hidden";

export const noteKey = (note: HandoffNote) =>
  `${note.machine}:${note.session}:${note.written_at}`;

function loadHidden(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(
      globalThis.localStorage?.getItem(HIDDEN_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((key): key is string => typeof key === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function saveHidden(keys: ReadonlySet<string>) {
  try {
    globalThis.localStorage?.setItem(HIDDEN_KEY, JSON.stringify([...keys]));
  } catch {
    // 저장을 못 해도 이 창에서는 숨긴다.
  }
}

/**
 * 창을 열 때, 다른 기계의 file이 왔을 때(`carry_files`), 5분마다 다시 읽는다. 읽은 목록에 없는 숨김 key는 버려
 * 집합이 자라지 않는다.
 */
export function useHandoffNotes(events: EventClient): {
  readonly notes: readonly HandoffNote[];
  hide(note: HandoffNote): void;
} {
  const [read, setRead] = useState(NO_NOTES);
  const [hidden, setHidden] = useState(loadHidden);
  useEffect(() => {
    const follow = followRead(
      events,
      readNotes,
      ["carry_files"],
      (loaded) => {
        if (loaded.state !== "ready") return;
        setRead(loaded.value.notes);
        if (!loaded.value.answered) return;
        setHidden((now) => {
          const present = new Set(loaded.value.notes.map(noteKey));
          const kept = new Set([...now].filter((key) => present.has(key)));
          if (kept.size === now.size) return now;
          saveHidden(kept);
          return kept;
        });
      },
      () => new Date(),
    );
    const timer = setInterval(follow.reload, REREAD_MS);
    return () => {
      clearInterval(timer);
      follow.stop();
    };
  }, [events]);
  const hide = useCallback((note: HandoffNote) => {
    setHidden((now) => {
      const next = new Set(now).add(noteKey(note));
      saveHidden(next);
      return next;
    });
  }, []);
  const notes = useMemo(
    () => read.filter((note) => !hidden.has(noteKey(note))),
    [read, hidden],
  );
  return { notes, hide };
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
