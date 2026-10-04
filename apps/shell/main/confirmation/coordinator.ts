// 보호 창의 수명. 자동으로 띄우지 않고, 요청한 창의 사람이 연다.
// 표시와 제출은 독립 read로 고정한 같은 자료에서만 만든다.
import type {
  ConfirmationIntent,
  ConfirmationRef,
  ConfirmationRequest,
} from "./types.ts";

import {
  contentBasis,
  type CoreHandlePort,
  earlierDeadline,
  type HandleClock,
  HandleTable,
  type LiveHandle,
} from "./handle.ts";
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
}

export interface CanonPort {
  /** 미리보기와 독립인 현재 정본. 실패·단절은 ok: false. */
  read(intent: ConfirmationIntent): Promise<
    | { ok: true; value: Canonical }
    | { ok: false; error: { code: string; message: string } }
  >;
}

export interface SubmitReceipt {
  readonly receipt: { kind: "entity"; id: string } | {
    kind: "event";
    seq: string;
  };
}

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
  }): Promise<
    | { ok: true; value: SubmitReceipt }
    | { ok: false; unknown: true }
    | { ok: false; unknown: false; error: { code: string; message: string } }
  >;
  /** 제출 결과가 불명일 때 같은 command의 receipt만 조회한다. */
  receipt(handle: LiveHandle): Promise<SubmitReceipt | undefined>;
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
  clock: HandleClock;
  preload: string;
  packaged: boolean;
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
  displayId: string;
  basis: string;
  gate: Gate;
  request: ConfirmationRequest | null;
  secondPending: boolean;
}

const STALE = "대상이 바뀌었거나 연결을 확인할 수 없다";

/**
 * 창 하나 = display 하나 = handle 하나.
 * 같은 창에서 다른 대상을 열면 옛 handle을 먼저 무효로 한다.
 */
export function createCoordinator(options: CoordinatorOptions) {
  const table = new HandleTable();
  const windows = new Map<string, LiveWindow>();
  let displaySerial = 0;

  const publish = (live: LiveWindow) => {
    if (live.opened.window.isDestroyed()) return;
    if (live.request === null || live.displayId === "") return;
    live.opened.window.webContents.send("confirmation:display", {
      displayId: live.displayId,
      request: live.request,
    });
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
    const read = await options.canon.read(live.intent);
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
      publish(live);
      return { ok: false, error: { code: "conflict", message: STALE } };
    }
    const current = table.find(live.displayId);
    if (
      current !== undefined && !current.spent &&
      current.epoch === options.epoch() &&
      current.expiresAtMs > options.clock.now()
    ) {
      live.request = read.value.request;
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
        displayId: "",
        basis: "",
        gate: { state: "checking" },
        request: null,
        secondPending: false,
      };
      windows.set(opened.windowId, live);
      const fixed = await fix(live);
      if (!fixed.ok) {
        return {
          ok: true,
          value: {
            windowId: opened.windowId,
            displayId: live.displayId,
            gate: live.gate,
            request: live.request,
          },
        };
      }
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
      return decide({
        request: input,
        live: windows.get(input.windowId),
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

    async cancel(windowId: string): Promise<{ outcome: "dismissed" }> {
      const live = windows.get(windowId);
      if (live !== undefined) await invalidate(live, "cancelled");
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
