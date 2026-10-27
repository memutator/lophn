// 앱 화면과 artifact page의 annotate mode main 쪽. view마다 상태(켬·끔, 고른 목록, 보내는 중)를 메모리에 쥐고,
// renderer(켜기·지우기·보내기)와 view의 페이지(고른 목록·Esc·capture 준비)를 이어 준다.
// 페이지는 자기가 무엇인지 모른다. 신원(target: 앱·release·화면 또는 artifact)은 sender view에서 정한다.
// 보내기는 annotation마다 screenshot을 만들어 올리고 묶음 하나를 core에 보낸다.
import { createHash } from "node:crypto";
import type { ZodType } from "zod";

import {
  ANNOTATE_MODE_CHANNEL,
  ANNOTATE_PAGE_CAPTURE_READY,
  ANNOTATE_PAGE_EXIT,
  ANNOTATE_PAGE_ITEMS,
  ANNOTATE_PAGE_REMOVE,
  ANNOTATE_PAGE_SET_MODE,
  ANNOTATE_REMOVE_CHANNEL,
  ANNOTATE_SEND_CHANNEL,
  type AnnotateErrorCode,
  annotateModeRequestSchema,
  annotatePageCaptureReadySchema,
  annotatePageItemsSchema,
  annotateRemoveRequestSchema,
  type AnnotateReply,
  annotateSendRequestSchema,
  type AnnotateSendResult,
  type AnnotateState,
  type AnnotateViewPort,
  type PickedItem,
} from "../../ipc/annotation.ts";
import {
  type CallerContents,
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import { createCapturer, type CropAndFit } from "./capture.ts";

type CoreResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

interface AnnotateDeps {
  registry: ContentsRegistry;
  /** sender 본문이 desktop 창이면 그 창. 아니면 undefined다. */
  windowOf(sender: CallerContents): string | undefined;
  /** view가 붙는 창. */
  owner(view_session: string): string | undefined;
  view(view_session: string): AnnotateViewPort | undefined;
  /** 페이지(앱 또는 artifact view)의 sender. 살아 있는 view가 아니면 undefined다. */
  senderView(contentsId: number): AnnotateViewPort | undefined;
  /** 그 창의 renderer에 상태를 민다. */
  pushState(window: string, state: AnnotateState): void;
  core: {
    call(
      kind: string,
      resource: string,
      method: string,
      body: unknown,
    ): Promise<CoreResult>;
    upload(
      resource: string,
      method: string,
      body: unknown,
      bytes: Uint8Array,
    ): Promise<CoreResult>;
  };
  cropAndFit: CropAndFit;
}

type Item = { picked: PickedItem; release: string | null };
type ViewState = {
  on: boolean;
  phase: "idle" | "sending";
  items: Item[];
  /** 번호가 처음 생길 때의 release(artifact는 늘 null). 페이지가 번호를 쥐고 있어 번호로 찾는다. */
  releases: Map<number, string | null>;
};

const DESKTOP_HOST = "desktop";

function fail(code: AnnotateErrorCode, message: string): AnnotateReply<never> {
  return { ok: false, error: { code, message } };
}

function labelOf({ component, element, kind }: PickedItem): string {
  if (component !== null) return component;
  if (element.role !== null && element.name !== null) {
    return `${element.role} "${element.name}"`;
  }
  return element.role ?? element.name ?? kind;
}

const releaseOf = (port: AnnotateViewPort) =>
  port.target.kind === "app" ? port.target.release : null;

const KNOWN_CODES = ["invalid_input", "forbidden", "conflict", "unavailable"];

export function createAnnotate(deps: AnnotateDeps) {
  const states = new Map<string, ViewState>();
  const capturer = createCapturer({ cropAndFit: deps.cropAndFit });

  function stateOf(view_session: string): ViewState {
    let state = states.get(view_session);
    if (state === undefined) {
      state = { on: false, phase: "idle", items: [], releases: new Map() };
      states.set(view_session, state);
    }
    return state;
  }

  function snapshot(view_session: string, state: ViewState): AnnotateState {
    return {
      view_session,
      on: state.on,
      phase: state.phase,
      items: state.items.map(({ picked }) => ({
        n: picked.n,
        kind: picked.kind,
        note: picked.note,
        label: labelOf(picked),
      })),
    };
  }

  function push(view_session: string, state: ViewState): AnnotateState {
    const value = snapshot(view_session, state);
    const window = deps.owner(view_session);
    if (window !== undefined) deps.pushState(window, value);
    return value;
  }

  // renderer 요청: sender가 desktop 창 본문이고 view가 그 창의 view여야 한다.
  function guard<T extends { view_session: string }>(
    event: IpcEvent,
    schema: ZodType<T>,
    input: unknown,
  ): AnnotateReply<{ input: T; port: AnnotateViewPort; state: ViewState }> {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return caller;
    const window =
      caller.value.origin.host === DESKTOP_HOST
        ? deps.windowOf(event.sender)
        : undefined;
    if (window === undefined) {
      return fail("forbidden", "caller is not a desktop window");
    }
    const checked = checkInput(schema, input);
    if (!checked.ok) return checked;
    const port = deps.view(checked.value.view_session);
    if (port === undefined || deps.owner(port.view_session) !== window) {
      states.delete(checked.value.view_session);
      return fail("forbidden", "view is not in this window");
    }
    return {
      ok: true,
      value: {
        input: checked.value,
        port,
        state: stateOf(port.view_session),
      },
    };
  }

  // 페이지 쪽 메시지: 살아 있는 view의 main frame일 때만 받는다.
  function pageView(event: IpcEvent): AnnotateViewPort | undefined {
    if (!event.senderFrame || event.senderFrame.parent !== null) {
      return undefined;
    }
    return deps.senderView(event.sender.id);
  }

  function lost(code: string, message: string): AnnotateReply<never> {
    const known = KNOWN_CODES.includes(code);
    return fail(known ? (code as AnnotateErrorCode) : "unavailable", message);
  }

  async function uploadShot(png: Uint8Array): Promise<unknown | null> {
    try {
      const blob = await deps.core.upload(
        "annotations",
        "upload_screenshot",
        {
          blob_hash: createHash("sha256").update(png).digest("hex"),
          bytes: png.length,
        },
        png,
      );
      return blob.ok ? blob.value : null;
    } catch {
      return null;
    }
  }

  return {
    mode(event: IpcEvent, input: unknown): AnnotateReply<AnnotateState> {
      const checked = guard(event, annotateModeRequestSchema, input);
      if (!checked.ok) return checked;
      const { input: request, port, state } = checked.value;
      if (state.phase === "sending") {
        return fail("conflict", "annotations are being sent");
      }
      // 끄면 mode만 끈다. 모은 목록은 둔다.
      state.on = request.on;
      port.send(ANNOTATE_PAGE_SET_MODE, { on: request.on });
      return { ok: true, value: push(port.view_session, state) };
    },

    remove(event: IpcEvent, input: unknown): AnnotateReply<AnnotateState> {
      const checked = guard(event, annotateRemoveRequestSchema, input);
      if (!checked.ok) return checked;
      const { input: request, port, state } = checked.value;
      if (state.phase === "sending") {
        return fail("conflict", "annotations are being sent");
      }
      port.send(ANNOTATE_PAGE_REMOVE, { n: request.n });
      state.items =
        request.n === "all"
          ? []
          : state.items.filter(({ picked }) => picked.n !== request.n);
      for (const n of [...state.releases.keys()]) {
        if (!state.items.some(({ picked }) => picked.n === n)) {
          state.releases.delete(n);
        }
      }
      return { ok: true, value: push(port.view_session, state) };
    },

    async send(
      event: IpcEvent,
      input: unknown,
    ): Promise<AnnotateReply<AnnotateSendResult>> {
      const checked = guard(event, annotateSendRequestSchema, input);
      if (!checked.ok) return checked;
      const { input: request, port, state } = checked.value;
      if (state.phase === "sending") {
        return fail("conflict", "annotations are being sent");
      }
      if (state.items.length === 0) {
        return fail("invalid_input", "there is nothing to send");
      }
      if (
        port.target.kind === "app" &&
        state.items.some((item) => item.release === null)
      ) {
        return fail("invalid_input", "view has no release");
      }
      const items = [...state.items].sort((a, b) => a.picked.n - b.picked.n);
      state.phase = "sending";
      push(port.view_session, state);
      let reply: AnnotateReply<AnnotateSendResult>;
      try {
        const annotations = [];
        for (const [i, { picked, release }] of items.entries()) {
          // screenshot이 안 되면 그 annotation만 없이 보낸다(목록과 메모는 잃지 않는다).
          const png = await capturer.shoot(port, picked.n);
          const screenshot = png === null ? null : await uploadShot(png);
          annotations.push({
            // core는 묶음 안 번호가 1..N 순서이기를 요구한다. 지운 번호는 여기서 메운다.
            n: i + 1,
            kind: picked.kind,
            note: picked.note,
            screenshot,
            component: picked.component,
            element: picked.element,
            rect: picked.rect,
            view: {
              screen: port.target.kind === "app" ? port.target.screen : null,
              path: picked.path,
            },
            release,
          });
        }
        const { target } = port;
        const sent = await deps.core.call("memory", "annotations", "send", {
          target:
            target.kind === "app" ? { kind: "app", app: target.app } : target,
          session: request.session,
          annotations,
        });
        reply = sent.ok
          ? {
              ok: true,
              value: {
                sent: annotations.length,
                session: (sent.value as { session: string }).session,
              },
            }
          : lost(sent.error.code, sent.error.message);
      } catch {
        reply = fail("unavailable", "annotations could not be sent");
      }
      state.phase = "idle";
      if (reply.ok) {
        state.on = false;
        state.items = [];
        state.releases.clear();
        port.send(ANNOTATE_PAGE_SET_MODE, { on: false });
        port.send(ANNOTATE_PAGE_REMOVE, { n: "all" });
      }
      push(port.view_session, state);
      return reply;
    },

    // 페이지가 고른 목록 전체를 보냈다. 새 번호에는 그 view의 release를 적어 둔다.
    items(event: IpcEvent, input: unknown): void {
      const port = pageView(event);
      if (port === undefined) return;
      const parsed = annotatePageItemsSchema.safeParse(input);
      if (!parsed.success) return;
      const state = stateOf(port.view_session);
      if (state.phase === "sending") return;
      const releases = new Map<number, string | null>();
      for (const { n } of parsed.data.items) {
        releases.set(n, state.releases.get(n) ?? releaseOf(port));
      }
      state.releases = releases;
      state.items = parsed.data.items.map((picked) => ({
        picked,
        release: releases.get(picked.n) ?? null,
      }));
      push(port.view_session, state);
    },

    // Esc. mode만 끈다.
    exit(event: IpcEvent): void {
      const port = pageView(event);
      if (port === undefined) return;
      const state = stateOf(port.view_session);
      state.on = false;
      push(port.view_session, state);
    },

    captureReady(event: IpcEvent, input: unknown): void {
      const port = pageView(event);
      if (port === undefined) return;
      const parsed = annotatePageCaptureReadySchema.safeParse(input);
      if (parsed.success) capturer.ready(port.view_session, parsed.data);
    },
  };
}

interface AnnotateIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown> | unknown,
  ): void;
  on(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => void,
  ): void;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): void;
}

const HANDLES = [
  [ANNOTATE_MODE_CHANNEL, "mode"],
  [ANNOTATE_REMOVE_CHANNEL, "remove"],
  [ANNOTATE_SEND_CHANNEL, "send"],
] as const;

const LISTENS = [
  [ANNOTATE_PAGE_ITEMS, "items"],
  [ANNOTATE_PAGE_EXIT, "exit"],
  [ANNOTATE_PAGE_CAPTURE_READY, "captureReady"],
] as const;

export function registerAnnotateIpc(
  ipc: AnnotateIpcMain,
  deps: AnnotateDeps,
): void {
  const annotate = createAnnotate(deps);
  for (const [channel, method] of HANDLES) {
    ipc.handle(channel, (event, input) => annotate[method](event, input));
  }
  for (const [channel, method] of LISTENS) {
    ipc.on(channel, (event, input) => annotate[method](event, input));
  }
}

export function removeAnnotateIpc(
  ipc: Pick<AnnotateIpcMain, "removeHandler" | "removeAllListeners">,
): void {
  for (const [channel] of HANDLES) ipc.removeHandler(channel);
  for (const [channel] of LISTENS) ipc.removeAllListeners(channel);
}
