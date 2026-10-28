// 알림 규칙 하나. 터미널 안 coding agent와 lophn Agent session이 같은 규칙을 쓰고, 결정은 shell main 한
// 곳에서 해서 창이 여럿이어도 한 번만 알린다. Electron을 모르고 deps로만 일한다.

import type { UnseenSession } from "../../ipc/notice.ts";

export type NoticeRoute = "none" | "toast" | "os";

/**
 * 사람이 그 탭을 보고 있으면(focus를 가진 창에 보인다) 알리지 않는다. 아니면 toast를 띄울 수 있는 창에
 * focus가 있을 때는 그 창의 toast, 아니면 OS 알림이다.
 */
export function routeNotice(input: {
  looking: boolean;
  toastable: boolean;
}): NoticeRoute {
  if (input.looking) return "none";
  return input.toastable ? "toast" : "os";
}

export type SessionNotice = {
  kind: "finished" | "failed" | "permission";
  /** agent 이름과 얼굴, session 이름. 알림 제목과 앞의 그림, Finished 줄이 같은 값을 쓴다. */
  who: UnseenSession;
  /** 마지막 응답의 앞부분, 권한 물음의 요약, 실패 까닭. */
  body?: string;
};

/** Bus event 중 이 module이 읽는 칸. */
export type SessionEvent = {
  type: string;
  session?: string;
  payload?: unknown;
};

export type SessionNoticesDeps = {
  /** lophn agent session의 agent와 session 이름. 모르는 session은 null이다. */
  who(session: string): Promise<UnseenSession | null>;
  /** 알림 본문. 모르면 없다. */
  bodyOf(
    kind: SessionNotice["kind"],
    event: SessionEvent,
  ): Promise<string | undefined>;
  /** 그 session 탭이 focus를 가진 창에 보인다. */
  looking(session: string): boolean;
  /** 알림을 내보낸다. 알렸으면(none이 아니면) true다. */
  notify(notice: SessionNotice): boolean;
  /** 못 본 turn 끝이 있는 session 목록이 바뀌었다. */
  publish(unseen: UnseenSession[]): void;
};

export type SessionNotices = {
  event(event: SessionEvent): Promise<void>;
  /** 보이게 된 탭이나 focus를 받은 창이 있을 수 있다. 보고 있는 session의 못 본 것을 지운다. */
  recheck(): void;
  unseen(): UnseenSession[];
};

/**
 * 못 본 turn 끝(finished 점)과 알림. 완료·실패한 turn 끝과 권한 물음·질문을 알리고, 사람이 끊은 turn은
 * 알리지 않는다. 못 본 것은 그 탭이 보일 때, 다음 turn이 시작할 때, session이 끝날 때 지운다.
 */
export function createSessionNotices(deps: SessionNoticesDeps): SessionNotices {
  const unseen = new Map<string, UnseenSession>();
  // 읽기가 끝나는 순서가 event 순서를 뒤집지 않게 한 줄로 처리한다.
  let queue: Promise<void> = Promise.resolve();

  const publish = () => deps.publish([...unseen.values()]);

  function forget(session: string): void {
    if (unseen.delete(session)) publish();
  }

  async function handle(event: SessionEvent): Promise<void> {
    const session = event.session;
    if (session === undefined) return;
    if (event.type === "TurnStarted" || event.type === "SessionEnded") {
      forget(session);
      return;
    }
    const kind =
      event.type === "TurnEnded"
        ? turnEndKind(event.payload)
        : event.type === "TurnRequestOpened" || event.type === "QuestionAsked"
          ? "permission"
          : null;
    if (kind === null) return;
    const who = await deps.who(session);
    if (who === null) return;
    const notified = deps.notify({
      kind,
      who,
      // 보고 있으면 알리지 않으니 본문을 읽지 않는다.
      body: deps.looking(session) ? undefined : await deps.bodyOf(kind, event),
    });
    if (notified && kind !== "permission") {
      unseen.set(session, who);
      publish();
    }
  }

  return {
    event(event) {
      queue = queue.then(() => handle(event)).catch(() => {});
      return queue;
    },
    recheck() {
      for (const session of [...unseen.keys()]) {
        if (deps.looking(session)) forget(session);
      }
    },
    unseen: () => [...unseen.values()],
  };
}

// TurnEnded의 outcome은 `{ kind, reason }`이다(protocol lophn-agent/turn-values.ts `turnOutcomeOutputSchema`).
function turnEndKind(payload: unknown): "finished" | "failed" | null {
  const kind = (payload as { outcome?: { kind?: string } } | undefined)?.outcome
    ?.kind;
  return kind === "completed"
    ? "finished"
    : kind === "failed"
      ? "failed"
      : null;
}

/** 창마다 보이는 Agent session 탭 표. 탭 화면이 보이고 사라질 때 알린다. */
export class SessionVisibility {
  readonly #by = new Map<number, Set<string>>();

  set(contentsId: number, session: string, visible: boolean): void {
    const sessions = this.#by.get(contentsId) ?? new Set<string>();
    if (visible) sessions.add(session);
    else sessions.delete(session);
    if (sessions.size === 0) this.#by.delete(contentsId);
    else this.#by.set(contentsId, sessions);
  }

  /** 창이 닫혔다. */
  forget(contentsId: number): void {
    this.#by.delete(contentsId);
  }

  isVisible(contentsId: number, session: string): boolean {
    return this.#by.get(contentsId)?.has(session) ?? false;
  }

  /** 그 session 탭이 보이는 창의 webContents id. 어디에도 안 보이면 undefined다. */
  owner(session: string): number | undefined {
    for (const [contentsId, sessions] of this.#by) {
      if (sessions.has(session)) return contentsId;
    }
    return undefined;
  }
}
