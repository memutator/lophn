// 알림 규칙 하나. 터미널 안 coding agent와 lophn Agent session이 같은 규칙을 쓰고, 결정은 shell main 한
// 곳에서 해서 창이 여럿이어도 한 번만 알린다. Electron을 모르고 deps로만 일한다.

import type { AvatarFace } from "../../ipc/overlay.ts";

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

/** 알림이 가리키는 lophn Agent session과 그 agent. */
export type SessionWho = {
  session: string;
  /** agent의 이름과 얼굴(알림을 낼 때 읽은 값). */
  agent: string;
  profile: AvatarFace;
  /** 그 Agent 탭의 session 이름. 아직 이름이 없으면 없다. */
  title?: string;
};

export type SessionNotice = {
  kind: "finished" | "failed" | "permission";
  /** agent 이름과 얼굴, session 이름. 알림 제목과 앞의 그림이 같은 값을 쓴다. */
  who: SessionWho;
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
  who(session: string): Promise<SessionWho | null>;
  /** 알림 본문. 모르면 없다. */
  bodyOf(
    kind: SessionNotice["kind"],
    event: SessionEvent,
  ): Promise<string | undefined>;
  /** 그 session을 사람이 보고 있다: 그 session 탭이나 그 session을 가진 앱 화면이 focus를 가진 창에 보인다. */
  looking(session: string): boolean;
  /**
   * 앱이 연 session이다(core의 `opened_by_app`). 앱이 turn마다 agent를 부려 쓰므로 turn 끝(완료·실패)은 알리지 않는다.
   * 승인·질문은 사람이 가야 풀리므로 그대로 알린다.
   */
  appSession(session: string): Promise<boolean>;
  /** 알림을 내보낸다. 어디에 띄울지(보고 있으면 없음)는 부르는 쪽이 정한다. */
  notify(notice: SessionNotice): void;
};

export type SessionNotices = {
  event(event: SessionEvent): Promise<void>;
};

/**
 * lophn Agent session의 알림. 완료·실패한 turn 끝과 권한 물음·질문을 알리고, 사람이 끊은 turn과 앱 화면이 연 session의
 * turn 끝은 알리지 않는다. 못 본 turn 끝(finished 점)은 core가 든다(`unseen`).
 */
export function createSessionNotices(deps: SessionNoticesDeps): SessionNotices {
  // 읽기가 끝나는 순서가 event 순서를 뒤집지 않게 한 줄로 처리한다.
  let queue: Promise<void> = Promise.resolve();

  async function handle(event: SessionEvent): Promise<void> {
    const session = event.session;
    if (session === undefined) return;
    const kind =
      event.type === "TurnEnded"
        ? turnEndKind(event.payload)
        : (event.type === "TurnRequestOpened" ||
              event.type === "QuestionAsked") &&
            !goesToParent(event)
          ? "permission"
          : null;
    if (kind === null) return;
    if (kind !== "permission" && (await deps.appSession(session))) return;
    const who = await deps.who(session);
    if (who === null) return;
    deps.notify({
      kind,
      who,
      // 보고 있으면 알리지 않으니 본문을 읽지 않는다.
      body: deps.looking(session) ? undefined : await deps.bodyOf(kind, event),
    });
  }

  return {
    event(event) {
      queue = queue.then(() => handle(event)).catch(() => {});
      return queue;
    },
  };
}

// 팀 자식의 요청과 질문은 부모가 푼다. 사람에게 알리지 않는다.
function goesToParent(event: SessionEvent): boolean {
  const payload = event.payload as
    | { request?: { to_parent?: boolean }; to_parent?: boolean }
    | undefined;
  return (payload?.request?.to_parent ?? payload?.to_parent) === true;
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

// 기계마다 session id를 따로 센다. machine이 없으면 이 컴퓨터다(`mch_` id와 겹치지 않는 빈 칸).
const keyOf = (machine: string | undefined, session: string) =>
  `${machine ?? ""}\u0000${session}`;

/**
 * 창마다 보이는 Agent session 표. 대화 화면이 보이고 사라질 때 알린다. 같은 창에 같은 session이 두 곳(탭과
 * float 같은) 보일 수 있어 수를 센다. 하나가 사라져도 남은 곳은 계속 보인다. 다른 기계의 session은 그 기계(`machine`)와 함께 센다.
 */
export class SessionVisibility {
  readonly #by = new Map<number, Map<string, number>>();

  set(
    contentsId: number,
    session: string,
    visible: boolean,
    machine?: string,
  ): void {
    const key = keyOf(machine, session);
    const sessions = this.#by.get(contentsId) ?? new Map<string, number>();
    const count = (sessions.get(key) ?? 0) + (visible ? 1 : -1);
    if (count > 0) sessions.set(key, count);
    else sessions.delete(key);
    if (sessions.size === 0) this.#by.delete(contentsId);
    else this.#by.set(contentsId, sessions);
  }

  /** 창이 닫혔다. */
  forget(contentsId: number): void {
    this.#by.delete(contentsId);
  }

  /** 그 창에 보이는 그 기계의 session(앱 화면이면 view_session) 모두. 기계를 주지 않으면 이 컴퓨터다. */
  visibleIn(contentsId: number, machine?: string): string[] {
    const prefix = keyOf(machine, "");
    return [...(this.#by.get(contentsId)?.keys() ?? [])]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  isVisible(contentsId: number, session: string, machine?: string): boolean {
    return this.#by.get(contentsId)?.has(keyOf(machine, session)) ?? false;
  }

  /** 그 session이 보이는 창의 webContents id. 어디에도 안 보이면 undefined다. */
  owner(session: string, machine?: string): number | undefined {
    const key = keyOf(machine, session);
    for (const [contentsId, sessions] of this.#by) {
      if (sessions.has(key)) return contentsId;
    }
    return undefined;
  }
}
