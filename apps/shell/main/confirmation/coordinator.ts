// 보호 창의 수명. 자동으로 띄우지 않고, 요청한 창의 사람이 연다.
// 표시와 제출은 독립 read로 고정한 같은 자료에서만 만든다.
import type {
  ConfirmationDisplay,
  ConfirmationHandleRegister,
  ConfirmationIntent,
  ConfirmationRef,
  ConfirmationRequest,
  ConfirmationResult,
} from "./types.ts";

import {
  contentBasis,
  type CoreHandlePort,
  earlierDeadline,
  type HandleClock,
  HandleTable,
  type LiveHandle,
} from "./handle.ts";
import type { HeadlessMode } from "../desktop/headless.ts";
import { decide } from "./decide.ts";
import {
  type ConfirmationHost,
  openConfirmationWindow,
  type OpenedConfirmation,
  type ParentWindow,
} from "./window.ts";

export type Gate =
  | { state: "checking" }
  | { state: "ready"; decisions: readonly string[]; second: boolean }
  | { state: "stale"; reason: string }
  | { state: "expired" }
  | { state: "submitted" }
  | { state: "unknown" };

export interface Canonical {
  readonly targetRef: string;
  readonly content: unknown;
  readonly allowed: readonly string[];
  readonly expiresAt: string | null;
  /** 위험한 결정은 영향과 scope를 다시 보이는 별도 단계가 있다. */
  readonly secondConfirm: boolean;
  /** confirmationDisplaySchema의 request. */
  readonly request: ConfirmationRequest;
  /** 종류별 표시 값. renderer는 이 값만 그린다. */
  readonly view?: Record<string, unknown>;
  /**
   * deferred면 열 때 handle을 만들지 않는다. binding이 사람이 넣은 값의 준비 증거를 담는
   * 결정(secret 입력)은 제출 때 증거를 받은 뒤에만 handle을 만든다.
   */
  readonly handle?: "now" | "deferred";
}

export interface CanonPort {
  /** 미리보기와 독립인 현재 정본. 실패·단절은 ok: false. 같은 창은 같은 windowId다. */
  read(intent: ConfirmationIntent, windowId: string): Promise<
    | { ok: true; value: Canonical }
    | { ok: false; error: { code: string; message: string } }
  >;
}

export type SubmitReceipt =
  | {
    readonly receipt: { kind: "entity"; id: string } | {
      kind: "event";
      seq: string;
    };
    /** 접수(accepted)와 결정 자체가 적용인 command의 결과를 구별한다. */
    readonly result?: ConfirmationResult;
  }
  | { readonly secret_ref: string; readonly stored: "stored" | "unchanged" };

export interface SubmitPort {
  /**
   * 고정 대상·CAS·선택 결정을 소유 command로 보낸다.
   * confirmation 원문은 여기서만 붙인다. renderer는 모른다.
   * unknown이면 결과를 모른다. 새 handle 없이 receipt를 다시 본다.
   */
  submit(input: {
    handle: LiveHandle;
    decision: string;
    commandInput: unknown;
    /** 이 handle을 만든 정본. 입력은 renderer가 아니라 이 값에서 만든다. */
    canonical: Canonical | null;
  }): Promise<
    | { ok: true; value: SubmitReceipt }
    | { ok: false; unknown: true }
    | { ok: false; unknown: false; error: { code: string; message: string } }
  >;
  /** 제출 결과가 불명일 때 같은 command의 receipt만 조회한다. */
  receipt(
    handle: LiveHandle,
    canonical: Canonical | null,
  ): Promise<SubmitReceipt | undefined>;
}

/** handle을 제출 때 만드는 결정(secret 입력). 값은 commandInput에만 있다. */
export interface DeferredPort {
  submit(input: {
    windowId: string;
    canonical: Canonical;
    decision: string;
    commandInput: unknown;
    /** 준비 증거를 넣은 binding으로 이 창의 handle을 만든다. */
    register(
      request: Omit<ConfirmationHandleRegister, "type" | "window_id">,
    ): Promise<
      | { ok: true; confirmation: ConfirmationRef }
      | { ok: false; error: { code: string; message: string } }
    >;
  }): Promise<
    | { ok: true; value: SubmitReceipt }
    | { ok: false; error: { code: string; message: string } }
  >;
}

export interface OpenRequest {
  readonly intent: ConfirmationIntent;
  readonly parent: ParentWindow;
  /** 사람이 [Review]를 누른 창. event만 도착해서는 열지 않는다. */
  readonly requestedByPerson: boolean;
}

export interface CoordinatorOptions {
  host: ConfirmationHost;
  canon: CanonPort;
  handles: CoreHandlePort;
  submit: SubmitPort;
  /** 없으면 deferred 결정은 unavailable이다. */
  deferred?: DeferredPort;
  /** 창이 닫히면 종류별로 그 창에 고정한 값을 버린다. */
  forget?(windowId: string): void;
  clock: HandleClock;
  preload: string;
  packaged: boolean;
  /** 개발 확인 전용 headless. entry가 env에서 읽어 넘긴다. */
  headless?: HeadlessMode;
  /** hello로 받은 epoch. 바뀌면 옛 handle을 버린다. */
  epoch(): string;
  /** core 구독이 살아 있는지. 단절이면 제출을 막는다. */
  connected(): boolean;
}

export interface OpenedView {
  readonly windowId: string;
  readonly displayId: string;
  readonly gate: Gate;
  readonly request: ConfirmationRequest | null;
}

interface LiveWindow {
  readonly opened: OpenedConfirmation;
  readonly parentId: string;
  readonly intent: ConfirmationIntent;
  readonly windowId: string;
  displayId: string;
  basis: string;
  gate: Gate;
  request: ConfirmationRequest | null;
  canonical: Canonical | null;
  secondPending: boolean;
}

const STALE = "대상이 바뀌었거나 연결을 확인할 수 없다";

/** renderer로 나가는 표시. gate 원문·handle은 넣지 않고 상태 이름과 결정만 싣는다. */
function displayOf(live: {
  displayId: string;
  request: ConfirmationRequest | null;
  canonical: Canonical | null;
  gate: Gate;
}): ConfirmationDisplay | null {
  if (live.request === null || live.displayId === "") return null;
  const view = live.canonical?.view;
  const state = live.gate.state === "checking" ? "ready" : live.gate.state;
  return {
    displayId: live.displayId,
    request: live.request,
    ...(view === undefined ? {} : { view }),
    state,
    decisions: live.gate.state === "ready" ? [...live.gate.decisions] : [],
    second: live.gate.state === "ready" ? live.gate.second : false,
  };
}

/**
 * 창 하나 = display 하나 = handle 하나.
 * 같은 창에서 다른 대상을 열면 옛 handle을 먼저 무효로 한다.
 */
export function createCoordinator(options: CoordinatorOptions) {
  const table = new HandleTable();
  const windows = new Map<string, LiveWindow>();
  // 열 때의 첫 고정. 창이 그보다 먼저 표시를 물으면 끝날 때까지 기다린다.
  const first = new Map<string, Promise<unknown>>();
  let displaySerial = 0;

  const publish = (live: LiveWindow) => {
    if (live.opened.window.isDestroyed()) return;
    const display = displayOf(live);
    if (display === null) return;
    live.opened.window.webContents.send("confirmation:display", display);
  };

  const invalidate = async (
    live: LiveWindow,
    reason: "closed" | "cancelled" | "crashed" | "disconnected" | "replaced",
  ) => {
    const handle = table.drop(live.displayId);
    if (handle !== undefined && !handle.spent) {
      await options.handles.closeWindow(handle.windowId);
    }
    live.gate = { state: "stale", reason };
    if (reason === "closed" || reason === "cancelled" || reason === "crashed") {
      windows.delete(live.opened.windowId);
      options.forget?.(live.opened.windowId);
    }
  };

  async function fix(
    live: LiveWindow,
  ): Promise<
    { ok: true } | { ok: false; error: { code: string; message: string } }
  > {
    if (!options.connected()) {
      live.gate = { state: "stale", reason: STALE };
      publish(live);
      return { ok: false, error: { code: "unavailable", message: STALE } };
    }
    const read = await options.canon.read(live.intent, live.windowId);
    if (!read.ok) {
      live.gate = { state: "stale", reason: read.error.message };
      publish(live);
      return read;
    }
    const basis = contentBasis(read.value.content);
    const deadline = earlierDeadline(options.clock.now(), read.value.expiresAt);
    if (deadline === null) {
      await invalidate(live, "replaced");
      live.gate = { state: "expired" };
      publish(live);
      return {
        ok: false,
        error: { code: "conflict", message: "확인 기한이 지났다" },
      };
    }
    if (live.basis !== "" && live.basis !== basis) {
      await invalidate(live, "replaced");
      live.gate = { state: "stale", reason: STALE };
      live.request = read.value.request;
      live.canonical = read.value;
      publish(live);
      return { ok: false, error: { code: "conflict", message: STALE } };
    }
    // 고를 결정이 없거나 값을 받은 뒤에만 handle을 만드는 결정은 지금 등록하지 않는다.
    if (read.value.allowed.length === 0 || read.value.handle === "deferred") {
      if (live.displayId === "") live.displayId = `dsp_${++displaySerial}`;
      live.basis = basis;
      live.request = read.value.request;
      live.canonical = read.value;
      live.secondPending = read.value.secondConfirm;
      live.gate = {
        state: "ready",
        decisions: read.value.allowed,
        second: read.value.secondConfirm,
      };
      publish(live);
      return { ok: true };
    }
    const current = table.find(live.displayId);
    if (
      current !== undefined && !current.spent &&
      current.epoch === options.epoch() &&
      current.expiresAtMs > options.clock.now()
    ) {
      live.request = read.value.request;
      live.canonical = read.value;
      live.gate = {
        state: "ready",
        decisions: read.value.allowed,
        second: read.value.secondConfirm,
      };
      publish(live);
      return { ok: true };
    }
    const epoch = options.epoch();
    const registered = await options.handles.register({
      type: "confirmation_handle_register",
      window_id: live.opened.windowId,
      target_ref: read.value.targetRef,
      content_hash: basis,
      allowed_decisions: [...read.value.allowed],
      expires_at: new Date(deadline).toISOString(),
    });
    if (!registered.ok) {
      live.gate = { state: "stale", reason: registered.error.message };
      publish(live);
      return registered;
    }
    live.displayId = `dsp_${++displaySerial}`;
    live.basis = basis;
    live.request = read.value.request;
    live.canonical = read.value;
    live.secondPending = read.value.secondConfirm;
    live.gate = {
      state: "ready",
      decisions: read.value.allowed,
      second: read.value.secondConfirm,
    };
    table.remember({
      ref: registered.confirmation,
      windowId: live.opened.windowId,
      displayId: live.displayId,
      targetRef: read.value.targetRef,
      contentHash: basis,
      allowed: read.value.allowed,
      epoch,
      expiresAtMs: deadline,
      spent: false,
      unknown: false,
    });
    publish(live);
    return { ok: true };
  }

  /**
   * 값을 받은 뒤에만 handle을 만드는 결정. 제출 직전 정본을 다시 읽어 같을 때만 보내고,
   * 같은 표시에서 두 번 보내지 않는다. 값은 commandInput에만 있고 여기 남기지 않는다.
   */
  async function submitDeferred(
    live: LiveWindow,
    input: { displayId: string; decision: string; commandInput?: unknown },
  ): Promise<
    | { ok: true; value: SubmitReceipt }
    | { ok: false; error: { code: string; message: string } }
  > {
    if (live.displayId !== input.displayId) {
      return {
        ok: false,
        error: { code: "forbidden", message: "이 창의 표시가 아니다" },
      };
    }
    if (live.gate.state !== "ready") {
      return { ok: false, error: { code: "conflict", message: "확인이 무효다" } };
    }
    if (!options.connected() || options.deferred === undefined) {
      live.gate = { state: "stale", reason: STALE };
      publish(live);
      return { ok: false, error: { code: "unavailable", message: STALE } };
    }
    live.gate = { state: "checking" };
    const read = await options.canon.read(live.intent, live.windowId);
    if (
      !read.ok || contentBasis(read.value.content) !== live.basis ||
      !read.value.allowed.includes(input.decision)
    ) {
      live.gate = { state: "stale", reason: STALE };
      if (read.ok) {
        live.request = read.value.request;
        live.canonical = read.value;
      }
      publish(live);
      return { ok: false, error: { code: "conflict", message: STALE } };
    }
    const canonical = read.value;
    const epoch = options.epoch();
    const sent = await options.deferred.submit({
      windowId: live.windowId,
      canonical,
      decision: input.decision,
      commandInput: input.commandInput ?? {},
      register: async (request) => {
        const deadline = earlierDeadline(
          options.clock.now(),
          canonical.expiresAt,
        );
        if (deadline === null || options.epoch() !== epoch) {
          return {
            ok: false,
            error: { code: "conflict", message: "확인 기한이 지났다" },
          };
        }
        const asked = Date.parse(request.expires_at);
        const registered = await options.handles.register({
          type: "confirmation_handle_register",
          window_id: live.windowId,
          target_ref: request.target_ref,
          content_hash: request.content_hash,
          allowed_decisions: [...request.allowed_decisions],
          expires_at: new Date(
            Number.isFinite(asked) ? Math.min(deadline, asked) : deadline,
          ).toISOString(),
        });
        return registered.ok
          ? { ok: true, confirmation: registered.confirmation }
          : registered;
      },
    });
    if (!sent.ok) {
      // 값은 이미 버렸다. 다시 넣어 보낼 수 있게 같은 표시를 남긴다.
      live.gate = {
        state: "ready",
        decisions: canonical.allowed,
        second: canonical.secondConfirm,
      };
      publish(live);
      return sent;
    }
    live.gate = { state: "submitted" };
    publish(live);
    return sent;
  }

  return {
    /** event 도착은 기록만 한다. 창은 사람이 열 때만 만든다. */
    noteRequest(_intent: ConfirmationIntent): void {},

    async open(request: OpenRequest): Promise<
      | { ok: true; value: OpenedView }
      | { ok: false; error: { code: string; message: string } }
    > {
      if (!request.requestedByPerson) {
        return {
          ok: false,
          error: {
            code: "forbidden",
            message: "사람이 연 요청만 확인 창을 띄운다",
          },
        };
      }
      for (const existing of windows.values()) {
        if (existing.parentId === request.parent.id) {
          await invalidate(existing, "replaced");
          existing.opened.releaseInputBlock();
          if (!existing.opened.window.isDestroyed()) {
            existing.opened.window.close();
          }
          windows.delete(existing.opened.windowId);
        }
      }
      table.dropEpoch(options.epoch());
      const opened = openConfirmationWindow({
        host: options.host,
        parent: request.parent,
        preload: options.preload,
        packaged: options.packaged,
        ...(options.headless ? { headless: options.headless } : {}),
        onClosed: () => {
          const live = windows.get(opened.windowId);
          if (live !== undefined) void invalidate(live, "closed");
        },
        onCrashed: () => {
          const live = windows.get(opened.windowId);
          if (live !== undefined) void invalidate(live, "crashed");
        },
      });
      const live: LiveWindow = {
        opened,
        parentId: request.parent.id,
        intent: request.intent,
        windowId: opened.windowId,
        displayId: "",
        basis: "",
        gate: { state: "checking" },
        request: null,
        canonical: null,
        secondPending: false,
      };
      windows.set(opened.windowId, live);
      const fixing = fix(live);
      first.set(opened.windowId, fixing);
      await fixing;
      first.delete(opened.windowId);
      return {
        ok: true,
        value: {
          windowId: opened.windowId,
          displayId: live.displayId,
          gate: live.gate,
          request: live.request,
        },
      };
    },

    /** 제출 직전 정본을 다시 읽는다. 바뀌었으면 옛 버튼을 없앤다. */
    submit(input: {
      windowId: string;
      displayId: string;
      decision: string;
      commandInput?: unknown;
      confirmedSecond?: boolean;
    }) {
      const live = windows.get(input.windowId);
      if (live?.canonical?.handle === "deferred") {
        return submitDeferred(live, input);
      }
      return decide({
        request: input,
        live,
        table,
        canon: options.canon,
        submit: options.submit,
        now: options.clock.now(),
        epoch: options.epoch(),
        connected: options.connected(),
        publish,
        invalidate: (window) => {
          const current = windows.get(input.windowId);
          if (current !== undefined) return invalidate(current, "replaced");
          void window;
          return Promise.resolve();
        },
      });
    },

    /** 최신 내용 열기. 같은 창에서 정본을 다시 읽어 새 표시를 고정한다. */
    async refresh(windowId: string): Promise<ConfirmationDisplay | null> {
      const live = windows.get(windowId);
      if (live === undefined) return null;
      if (live.gate.state === "submitted") return displayOf(live);
      await invalidate(live, "replaced");
      live.basis = "";
      live.gate = { state: "checking" };
      await fix(live);
      return displayOf(live);
    },

    /** 열 때의 첫 고정이 끝날 때까지 기다린다. */
    async settled(windowId: string): Promise<void> {
      await first.get(windowId);
    },

    /** 이 창의 지금 표시. 아직 고정 전이면 null이다. */
    display(windowId: string): ConfirmationDisplay | null {
      const live = windows.get(windowId);
      return live === undefined ? null : displayOf(live);
    },

    /** IPC를 보낸 webContents가 어느 보호 창인지. 다른 창이면 undefined다. */
    windowOf(contentsId: number): string | undefined {
      for (const live of windows.values()) {
        if (
          !live.opened.window.isDestroyed() &&
          live.opened.window.webContents.id === contentsId
        ) return live.windowId;
      }
      return undefined;
    },

    async cancel(windowId: string): Promise<{ outcome: "dismissed" }> {
      const live = windows.get(windowId);
      if (live !== undefined) {
        await invalidate(live, "cancelled");
        live.opened.releaseInputBlock();
        if (!live.opened.window.isDestroyed()) live.opened.window.close();
      }
      return { outcome: "dismissed" };
    },

    /** core epoch가 바뀌면 열린 handle을 전부 무효로 한다. */
    async onEpoch(epoch: string): Promise<void> {
      await options.handles.clear();
      table.clear();
      for (const live of windows.values()) {
        live.gate = { state: "stale", reason: "core가 다시 시작되었다" };
        publish(live);
      }
      void epoch;
    },

    /** 테스트가 현재 gate를 본다. */
    gate(windowId: string): Gate | undefined {
      return windows.get(windowId)?.gate;
    },

    /** 테스트가 handle 참조가 renderer로 나가지 않는지 본다. */
    exposed(windowId: string): { displayId: string; ref?: ConfirmationRef } {
      const live = windows.get(windowId);
      return { displayId: live?.displayId ?? "" };
    },
  };
}

export type Coordinator = ReturnType<typeof createCoordinator>;
