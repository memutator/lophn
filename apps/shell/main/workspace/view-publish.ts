// 현재 보기 상태의 relay publish·bind·unpublish transport. 창의 보기
// generation이 바뀔 때 publish하고, 닫힘·단절에는 unavailable·disconnected를
// publish한다(shell/workspace#R9, R10). 상태 조립은 current-view.ts가 한다.
// relay route와 값 제약은 contracts/shell/workspace.ts이고, shell tsc는
// packages를 보지 않으므로 호출 모양만 여기서 맞춘다.
import {
  buildPublishInput,
  type CurrentViewState,
  type ViewOmission,
} from "./current-view.ts";

export interface CoreSessionLike {
  /** memory route 호출. allowlist는 memory를 거르지 않고 main이 직접 보낸다. */
  call(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<
    { ok: true; value: unknown } | {
      ok: false;
      error: { code: string; message: string };
    }
  >;
}

export type PublishError = { code: string; message: string };

export type PublishResult =
  | { ok: true }
  | { ok: false; error: PublishError };

export type NotifiedState = {
  window_ref: string;
  availability: ViewAvailability;
  reason: string;
  omissions: ViewOmission[];
};

const VIEW_AVAILABILITY = ["current", "disconnected", "unavailable"] as const;
type ViewAvailability = (typeof VIEW_AVAILABILITY)[number];

type ViewTabMin = { key: string; selected: boolean };

/** 조립 값의 최소 모양. 테스트는 여기에 맞춘 부분 값을 끼운다. */
interface StateLike {
  window_ref: string;
  generation: number;
  observed_at: string;
  project: string | null;
  tabs: ViewTabMin[];
  focused_pane: number | null;
  selection: unknown;
  app_view: unknown;
  availability: ViewAvailability;
  omissions: ViewOmission[];
}

export interface ViewPublishDeps {
  /** 현재 연결 세션. 끊기면 publish는 실패가 아니라 disconnected 표시다. */
  session: () => CoreSessionLike | null;
  /** relay 반환을 전하기 전에 조립 상태를 갈아 끼우는 observer. 테스트가 본다. */
  onState?: (state: NotifiedState) => void;
}

/**
 * 창 하나의 publish transport. publish는 additive다 — 이전 publish를 대체하고
 * relay(core)가 session 결합을 유지한다(platform T57). 값은 relay 메모리에만
 * 있고 ledger·blob·log에 가지 않는다.
 */
export function createViewPublisher(
  deps: ViewPublishDeps,
): ViewPublisher {
  return {
    async publish(
      state: StateLike,
    ): Promise<PublishResult> {
      return await send(deps, state);
    },
    /** 창 닫힘·main 단절에 unavailable을 표시한다(shell/workspace#R9). */
    async unavailable(
      windowRef: string,
      reason: string,
    ): Promise<PublishResult> {
      return await notify(deps, {
        window_ref: windowRef,
        availability: "unavailable",
        reason,
        omissions: [],
      });
    },
    /** 단절에는 disconnected를 표시하고 온 창의 상태를 대신 쓰지 않는다. */
    async disconnected(
      windowRef: string,
      reason: string,
    ): Promise<PublishResult> {
      return await notify(deps, {
        window_ref: windowRef,
        availability: "disconnected",
        reason,
        omissions: [],
      });
    },
    /** 사람 요청·steering을 보낼 때 그 창과 session 결합을 함께 보낸다. */
    async bind(
      session: string,
      windowRef: string,
    ): Promise<PublishResult> {
      const core = deps.session();
      if (!core) return { ok: false, error: unavailableError() };
      return await relay(core, "bind", { session, window_ref: windowRef });
    },
    async unbind(windowRef: string): Promise<PublishResult> {
      const core = deps.session();
      if (!core) return { ok: false, error: unavailableError() };
      return await relay(core, "unpublish", { window_ref: windowRef });
    },
  };
}

export interface ViewPublisher {
  publish(state: StateLike): Promise<PublishResult>;
  unavailable(windowRef: string, reason: string): Promise<PublishResult>;
  disconnected(windowRef: string, reason: string): Promise<PublishResult>;
  bind(session: string, windowRef: string): Promise<PublishResult>;
  unbind(windowRef: string): Promise<PublishResult>;
}

function unavailableError(): PublishError {
  return { code: "unavailable", message: "core가 준비되지 않았다" };
}

async function send(
  deps: ViewPublishDeps,
  state: StateLike,
): Promise<PublishResult> {
  const built = buildPublishInput(state as CurrentViewState);
  const core = deps.session();
  if (!core) {
    deps.onState?.({
      window_ref: state.window_ref,
      availability: "disconnected",
      reason: "core가 준비되지 않았다",
      omissions: built.omissions,
    });
    return { ok: false, error: unavailableError() };
  }
  const result = await relay(core, "publish", built.input);
  deps.onState?.({
    window_ref: state.window_ref,
    availability: result.ok ? "current" : "unavailable",
    reason: result.ok ? "" : result.error.message,
    omissions: built.omissions,
  });
  return result;
}

async function notify(
  deps: ViewPublishDeps,
  state: NotifiedState,
): Promise<PublishResult> {
  const core = deps.session();
  if (!core) {
    deps.onState?.(state);
    return { ok: false, error: unavailableError() };
  }
  // relay는 현재 상태만 가진다. 부재 창의 publish는 not_found다 — 옛 값을
  // 지우지 않기 위해 안전한 unavailable 표시만 보낸다(T57, prompt-assemble#R28).
  const result = await relay(core, "publish", {
    window_ref: state.window_ref,
    generation: 0,
    observed_at: now(),
    summary: `${state.availability}: ${state.reason}`.slice(0, 2048),
    tab_pages: [],
  });
  deps.onState?.(state);
  return result;
}

function now(): string {
  // 관측 시각은 이 transport가 아니라 조립이 고정한다. 부재 표시의 시각은
  // 여기서 고정한다(shell/workspace#R10).
  return formatAt(Date.now());
}

function formatAt(ms: number): string {
  const pad = (n: number, width: number): string =>
    n.toString().padStart(width, "0");
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${
    pad(d.getUTCDate(), 2)
  }T${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${
    pad(d.getUTCSeconds(), 2)
  }.${pad(d.getUTCMilliseconds(), 3)}Z`;
}

async function relay(
  core: CoreSessionLike,
  method: "publish" | "bind" | "unpublish",
  body: unknown,
): Promise<PublishResult> {
  const result = await core.call("memory", "workspace", method, body);
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error };
}
