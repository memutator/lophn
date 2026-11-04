import type { AcpItem, AcpMessageItem, AcpToolItem } from "./items.ts";
import type { AcpState, AcpTurn, AcpUpdate } from "./state.ts";

// 갱신을 상태에 접는 순수 함수다. 같은 갱신을 두 번 접어도 같은 상태이고(항목은 id로 한 번만 든다),
// 순번이 빠지거나 글의 offset이 맞지 않으면 `reread`를 세워 snapshot을 다시 읽게 한다.
// snapshot 이전에 일어난 갱신을 snapshot 위에 다시 접는 일을 막는 것(어디까지가 snapshot에 든 갱신인지)은 읽는 쪽의 몫이다.

export const EMPTY_ACP_STATE: AcpState = {
  seq: 0,
  items: [],
  turn: null,
  queued: [],
  pending: { approval: null, question: null },
  writing: null,
  dropped: { model_call: null, turn: null },
  reread: false,
};

/** turn 꼬리의 항목 id. turn마다 하나다. */
export function acpNoticeId(turn: string): string {
  return `end-${turn}`;
}

/**
 * 끝난 turn의 두 시간. wall은 시작부터 끝까지이고, active를 모르면(coding agent) wall을 active로 쓴다.
 * 시작도 모르면 둘 다 0이다.
 */
export function acpTurnTimes(
  startedAt: string | null,
  finishedAt: string,
  activeMs: number | null,
): { active_ms: number; waited_ms: number } {
  const wall =
    startedAt === null
      ? null
      : Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const active = activeMs ?? wall ?? 0;
  return {
    active_ms: active,
    waited_ms: wall === null ? 0 : Math.max(0, wall - active),
  };
}

const running = (turn: AcpTurn | null): turn is AcpTurn =>
  turn !== null && turn.phase !== "ended";

function known(state: AcpState, id: string): boolean {
  return (
    state.items.some(
      (item) =>
        item.id === id ||
        (item.kind === "hidden" && item.items.some((inner) => inner.id === id)),
    ) || state.queued.some((queued) => queued.id === id)
  );
}

/** 항목 하나를 순번 자리에 든다. 이미 있는 id는 무시하고, 다음 순번을 건너뛰면 다시 읽게 한다. */
function put(state: AcpState, item: AcpItem): AcpState {
  if (known(state, item.id)) return state;
  const items = [...state.items, item].sort((a, b) => a.seq - b.seq);
  return {
    ...state,
    items,
    seq: Math.max(state.seq, item.seq),
    reread: state.reread || item.seq > state.seq + 1,
  };
}

/** 사람이 답할 것이 남았으면 waiting이다. */
function settle(state: AcpState): AcpState {
  const turn = state.turn;
  if (!running(turn)) return state;
  const phase =
    state.pending.approval !== null || state.pending.question !== null
      ? "waiting"
      : "working";
  return phase === turn.phase ? state : { ...state, turn: { ...turn, phase } };
}

/** 그 model 호출의 흘러나온 글을 버린다. 늦은 조각이 새 글로 보이지 않게 기억한다. */
function dropWriting(state: AcpState, modelCall: string): AcpState {
  return {
    ...state,
    writing: state.writing?.model_call === modelCall ? null : state.writing,
    dropped: { ...state.dropped, model_call: modelCall },
  };
}

function mapTool(
  state: AcpState,
  match: (item: AcpToolItem) => boolean,
  change: (item: AcpToolItem) => AcpToolItem,
): AcpState {
  let found = false;
  const items = state.items.map((item): AcpItem => {
    if (item.kind !== "tool" || !match(item)) return item;
    found = true;
    return change(item);
  });
  return found ? { ...state, items } : state;
}

function textBlocks(text: string): AcpMessageItem["content"] {
  return text === "" ? [] : [{ type: "text", text }];
}

export function reduceAcp(state: AcpState, update: AcpUpdate): AcpState {
  switch (update.type) {
    case "message_added":
      return put(state, update.item);
    case "message_queued":
      return known(state, update.queued.id)
        ? state
        : { ...state, queued: [...state.queued, update.queued] };
    case "message_removed":
      return {
        ...state,
        queued: state.queued.filter((queued) => queued.id !== update.message),
      };
    case "message_taken": {
      const turn = update.turn ?? (running(state.turn) ? state.turn.id : null);
      const queued = state.queued.find((one) => one.id === update.message);
      if (queued === undefined) {
        // 이미 대화에 든 메시지는 가져간 turn만 적는다.
        return {
          ...state,
          items: state.items.map((item) =>
            item.kind === "message" &&
            item.id === update.message &&
            item.turn === null
              ? { ...item, turn }
              : item,
          ),
        };
      }
      return put(
        {
          ...state,
          queued: state.queued.filter((one) => one.id !== queued.id),
        },
        {
          kind: "message",
          id: queued.id,
          seq: update.seq,
          at: queued.at,
          actor: "user",
          sender: null,
          call: null,
          reply_to: null,
          delivery: update.delivery,
          turn,
          content: queued.content,
          reasoning: null,
          complete: true,
        },
      );
    }
    case "turn_started": {
      if (state.turn?.id === update.turn) return state;
      const stale = state.writing;
      return {
        ...state,
        turn: {
          id: update.turn,
          phase: "working",
          started_at: update.at,
          elapsed: { active_ms: 0, at: update.at },
        },
        writing: stale !== null && stale.turn !== update.turn ? null : stale,
        dropped:
          stale !== null && stale.turn !== update.turn
            ? { ...state.dropped, model_call: stale.model_call }
            : state.dropped,
      };
    }
    case "turn_resumed":
      return state.turn?.id !== update.turn
        ? state
        : {
            ...state,
            turn: {
              ...state.turn,
              elapsed: { active_ms: update.active_ms, at: update.at },
            },
          };
    case "turn_ended": {
      const startedAt =
        state.turn?.id === update.turn ? state.turn.started_at : null;
      const times = acpTurnTimes(startedAt, update.at, update.active_ms);
      let next: AcpState = {
        ...state,
        turn: {
          id: update.turn,
          phase: "ended",
          started_at: startedAt,
          elapsed: null,
        },
        pending: { approval: null, question: null },
        writing: state.writing?.turn === update.turn ? null : state.writing,
        dropped: { ...state.dropped, turn: update.turn },
      };
      for (const { message, seq } of update.messages) {
        next = put(next, {
          kind: "message",
          id: message,
          seq,
          at: update.at,
          actor: "agent",
          sender: null,
          call: null,
          reply_to: null,
          delivery: "next_turn",
          turn: update.turn,
          content: [],
          reasoning: null,
          complete: false,
        });
      }
      next = put(next, {
        kind: "notice",
        id: acpNoticeId(update.turn),
        seq: update.seq,
        at: update.at,
        turn: update.turn,
        notice:
          update.outcome === "failed" && update.error !== null
            ? { type: "error", ...update.error }
            : { type: "turn_end", outcome: update.outcome, ...times },
      });
      // 끝난 turn의 본문을 아직 모르는 message는 snapshot이 채운다.
      const incomplete = next.items.some(
        (item) => item.kind === "message" && !item.complete,
      );
      return incomplete ? { ...next, reread: true } : next;
    }
    case "writing_streamed": {
      if (
        state.dropped.model_call === update.model_call ||
        state.dropped.turn === update.turn
      ) {
        return state;
      }
      const base =
        state.writing?.model_call === update.model_call
          ? state.writing
          : {
              turn: update.turn,
              model_call: update.model_call,
              text: "",
              reasoning: "",
              at: update.at,
            };
      const current = base[update.kind];
      // 앞 글 길이를 넘는 offset은 붙이지 않는다. 겹친 조각은 겹치지 않은 부분만 붙는다.
      if (update.offset > current.length) {
        return { ...state, writing: base, reread: true };
      }
      const end = update.offset + update.text.length;
      return {
        ...state,
        writing:
          end <= current.length
            ? base
            : {
                ...base,
                [update.kind]:
                  current + update.text.slice(current.length - update.offset),
              },
      };
    }
    case "message_recorded": {
      const writing =
        update.model_call !== null &&
        state.writing?.model_call === update.model_call
          ? state.writing
          : null;
      const after =
        update.model_call === null
          ? state
          : dropWriting(state, update.model_call);
      return put(after, {
        kind: "message",
        id: update.message,
        seq: update.seq,
        at: update.at,
        actor: "agent",
        sender: null,
        call: null,
        reply_to: null,
        delivery: "next_turn",
        turn: update.turn,
        content: textBlocks(writing?.text ?? ""),
        reasoning:
          writing === null || writing.reasoning === ""
            ? null
            : { text: writing.reasoning, duration_ms: null },
        complete: false,
      });
    }
    case "tool_started": {
      const writing = state.writing;
      const cleared =
        writing !== null && writing.turn === update.item.turn
          ? dropWriting(state, writing.model_call)
          : state;
      return put(cleared, update.item);
    }
    case "tool_ended":
      return mapTool(
        state,
        (item) => item.id === update.tool_call,
        (item) => ({
          ...item,
          state: update.state,
          duration_ms: Math.max(0, Date.parse(update.at) - Date.parse(item.at)),
          detail: update.detail ?? item.detail,
        }),
      );
    case "approval_opened":
      return settle({
        ...state,
        pending: { ...state.pending, approval: update.approval },
      });
    case "approval_closed": {
      const approval = state.pending.approval;
      if (approval?.id !== update.request) {
        // 연 갱신을 놓쳤다.
        return known(state, update.request)
          ? state
          : { ...state, reread: true };
      }
      return settle(
        put(
          { ...state, pending: { ...state.pending, approval: null } },
          {
            kind: "approval",
            id: update.request,
            seq: update.seq,
            at: update.at,
            subject: approval.subject,
            outcome: update.outcome,
            choice: update.choice,
            reason: update.reason,
          },
        ),
      );
    }
    case "question_asked": {
      if (state.pending.question?.group === update.group) return state;
      const asked = {
        group: update.group,
        tool_call: update.tool_call,
        questions: update.questions,
      };
      return settle(
        mapTool(
          { ...state, pending: { ...state.pending, question: asked } },
          (item) =>
            item.id === update.tool_call && item.detail.kind === "question",
          (item) => ({
            ...item,
            detail: {
              kind: "question",
              group: update.group,
              outcome: null,
              lines: [],
            },
          }),
        ),
      );
    }
    case "question_resolved": {
      const asked = state.pending.question;
      const lines = (
        asked?.group === update.group ? (asked.questions ?? []) : []
      ).map((question) => ({ header: question.header, answer: null }));
      const resolved = mapTool(
        state,
        (item) =>
          item.detail.kind === "question" &&
          item.detail.group === update.group &&
          item.detail.outcome === null,
        (item) =>
          item.detail.kind === "question"
            ? {
                ...item,
                detail: { ...item.detail, outcome: update.outcome, lines },
              }
            : item,
      );
      return settle(
        asked?.group === update.group
          ? { ...resolved, pending: { ...resolved.pending, question: null } }
          : resolved,
      );
    }
    case "hidden_added": {
      if (known(state, update.item.id)) return state;
      const hidden = new Set(update.item.items.map((item) => item.id));
      return put(
        {
          ...state,
          items: state.items.filter((item) => !hidden.has(item.id)),
        },
        update.item,
      );
    }
  }
}
