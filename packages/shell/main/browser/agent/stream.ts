// 사람이 다른 기기에서 보는 browser 탭의 frame을 core로 밀고(`page_frame`), 그 기기의 입력을 page에 넣는다(`page_input`).
// 보는 쪽이 있는지는 core의 `page_stream`이 정한다(lease). 입력 허락도 core가 이미 봤다.
// frame은 CDP screencast다(켤 때 첫 frame을 낸다). core가 앞 frame을 읽었다고(`page_read`) 알리기 전에는 다음 frame을 보내지 않고
// 마지막 하나만 들고 있는다. CDP ack도 core로 보낼 때 보내서 느린 보는 쪽에서는 Chromium이 다음 frame을 만들지 않는다.
// 창 없는 page host도 그대로 쓰도록 Electron을 import하지 않는다.
import type { HostFrame } from "../../../../protocol/host-link/mod.ts";
import type {
  HostRequest,
  HostToolOutput,
} from "../../../../protocol/lophn-agent/host-queue.ts";
import {
  PAGE_FRAME_MAX_BYTES,
  type PageInput,
} from "../../../../protocol/lophn-agent/page-view.ts";
import { decideNavigation } from "../navigation.ts";
import type { ControlState, TabControl } from "./control.ts";
import { type DriverInput, sendKeys, withInput } from "./input.ts";
import { type KeyEvent, pressEvents, typeEvents } from "./keys.ts";
import type { Page } from "./page.ts";

// 보내기 사이의 최소 간격(10 fps). spike에서 screencast 10 fps가 core 하나의 약 16%였다.
export const FRAME_MIN_MS = 100;
// 켜거나 깨운 뒤 이만큼 frame이 없으면 그리지 않는 것으로 본다. Wayland에서 최소화했다 되살린 창은 보인다고 답하면서 그리지 않는다.
export const PAINT_WAIT_MS = 2000;

// core는 계약(`pageFrameSchema`)에 맞지 않는 frame을 버린다. 그런 frame은 보내지 않고 ack만 해 다음 frame을 받는다.
const BASE64_MAX = Math.ceil(PAGE_FRAME_MAX_BYTES / 3) * 4;

const SCREENCAST = {
  format: "jpeg",
  quality: 60,
  maxWidth: 1280,
  maxHeight: 800,
};

type Payload<K extends HostRequest["kind"]> = Extract<
  HostRequest,
  { kind: K }
>["payload"];

export interface PageStreamDeps {
  /** 그 탭의 page. 없으면 undefined다. */
  page(tab: string): Page | undefined;
  control: TabControl;
  /** host-link `send`. 연결이 받지 않으면 false다. */
  send(frame: HostFrame): boolean;
  nowMs(): number;
  /** run을 ms 뒤 부르고 취소 함수를 돌려준다. */
  schedule(run: () => void, ms: number): () => void;
  /** 입력을 넣는 동안 page를 표시하는 곳(driver.ts). 창이 없는 곳은 주지 않는다. */
  input?: DriverInput;
}

interface Stream {
  page: Page;
  /** core가 마지막으로 보낸 frame을 읽었다(보낸 것이 없어도 true). */
  read: boolean;
  /** 마지막으로 보낸 seq. */
  sent: number;
  lastSentMs: number;
  /** 아직 보내지 않은 마지막 frame. */
  latest: { data: string; width: number; height: number } | undefined;
  /** 보낼 때 같이 ack할 screencast frame의 sessionId. */
  acks: number[];
  /** FRAME_MIN_MS가 지나기를 기다리는 보내기. */
  cancelSend: (() => void) | undefined;
  painting: boolean;
  /** 켜거나 깨운 뒤 frame이 왔다. */
  framed: boolean;
  cancelPaint: (() => void) | undefined;
}

const OK: HostToolOutput = { content: [{ type: "text", text: "ok" }] };
const failure = (
  code: "not_found" | "conflict" | "invalid_input" | "unavailable",
  message: string,
): HostToolOutput => ({ error: { code, message } });
const NOT_FOUND = failure(
  "not_found",
  "This browser page is not open in lophn's browser on that machine (a lophn window's tab, or the windowless browser on a computer without a display).",
);
const NOT_STREAMING = failure(
  "conflict",
  "This browser page is not being watched; watch it before sending input.",
);

export type PageStream = ReturnType<typeof createPageStream>;

export function createPageStream(deps: PageStreamDeps) {
  const streams = new Map<string, Stream>();
  // 탭마다 이 process가 사는 동안 오르는 frame 번호다. 다시 켜도 0으로 돌아가지 않는다.
  const seqs = new Map<string, number>();
  // Page.subscribe는 부를 때마다 listener를 더하므로 page마다 한 번만 듣는다.
  const subscribed = new WeakSet<Page>();

  const tabOf = (page: Page): string | undefined => {
    for (const [tab, stream] of streams) if (stream.page === page) return tab;
    return undefined;
  };

  function state(
    tab: string,
    stream: Stream,
    control: ControlState = deps.control.current(tab) ?? {
      agent: false,
      held: false,
    },
  ): void {
    deps.send({
      type: "page_state",
      tab,
      painting: stream.painting,
      agent: control.agent,
      held: control.held,
    });
  }

  function setPainting(tab: string, stream: Stream, painting: boolean): void {
    if (stream.painting === painting) return;
    stream.painting = painting;
    state(tab, stream);
  }

  function flush(tab: string, stream: Stream): void {
    if (
      stream.latest === undefined ||
      !stream.read ||
      stream.cancelSend !== undefined
    ) {
      return;
    }
    const wait = stream.lastSentMs + FRAME_MIN_MS - deps.nowMs();
    if (wait > 0) {
      stream.cancelSend = deps.schedule(() => {
        stream.cancelSend = undefined;
        flush(tab, stream);
      }, wait);
      return;
    }
    const seq = (seqs.get(tab) ?? 0) + 1;
    seqs.set(tab, seq);
    const { data, width, height } = stream.latest;
    stream.latest = undefined;
    // 연결이 받지 않았으면 core가 읽을 frame도 없다. 다시 붙으면 core가 다시 켠다(reset).
    if (
      deps.send({
        type: "page_frame",
        tab,
        seq,
        frame: { media_type: "image/jpeg", data_base64: data, width, height },
      })
    ) {
      stream.read = false;
      stream.sent = seq;
    }
    stream.lastSentMs = deps.nowMs();
    for (const sessionId of stream.acks.splice(0)) {
      void stream.page
        .send("Page.screencastFrameAck", { sessionId })
        .catch(() => {});
    }
  }

  function onFrame(tab: string, params: Record<string, unknown>): void {
    const stream = streams.get(tab);
    if (stream === undefined) return;
    const { data, metadata, sessionId } = params as {
      data: string;
      metadata: { deviceWidth: number; deviceHeight: number };
      sessionId: number;
    };
    const width = Math.round(metadata.deviceWidth);
    const height = Math.round(metadata.deviceHeight);
    if (
      data.length === 0 ||
      data.length > BASE64_MAX ||
      width < 1 ||
      height < 1
    ) {
      void stream.page
        .send("Page.screencastFrameAck", { sessionId })
        .catch(() => {});
      return;
    }
    stream.acks.push(sessionId);
    stream.latest = { data, width, height };
    stream.framed = true;
    setPainting(tab, stream, true);
    flush(tab, stream);
  }

  function listen(page: Page): void {
    if (subscribed.has(page)) return;
    subscribed.add(page);
    page.subscribe({
      cdp(method, params) {
        if (method !== "Page.screencastFrame") return;
        const tab = tabOf(page);
        if (tab !== undefined) onFrame(tab, params);
      },
      // debugger가 떨어지면(page가 죽음, DevTools) frame이 더 오지 않는다.
      detached() {
        const tab = tabOf(page);
        const stream = tab === undefined ? undefined : streams.get(tab);
        if (tab !== undefined && stream !== undefined) {
          setPainting(tab, stream, false);
        }
      },
      devtoolsOpened() {},
    });
  }

  // screencast를 (다시) 켠다. 켜면 첫 frame이 온다. PAINT_WAIT_MS 안에 오지 않으면 그리지 않는 것이다.
  async function start(tab: string, stream: Stream): Promise<void> {
    stream.cancelPaint?.();
    stream.framed = false;
    stream.latest = undefined;
    stream.acks = [];
    stream.cancelPaint = deps.schedule(() => {
      stream.cancelPaint = undefined;
      if (!stream.framed) setPainting(tab, stream, false);
    }, PAINT_WAIT_MS);
    stream.page.attach("stream");
    await stream.page.send("Page.enable");
    await stream.page.send("Page.stopScreencast");
    await stream.page.send("Page.startScreencast", SCREENCAST);
  }

  function stop(tab: string): void {
    const stream = streams.get(tab);
    if (stream === undefined) return;
    streams.delete(tab);
    stream.cancelPaint?.();
    stream.cancelSend?.();
    if (stream.page.isDestroyed()) return;
    void stream.page.send("Page.stopScreencast").catch(() => {});
    stream.page.detach("stream");
  }

  async function mouse(page: Page, params: Record<string, unknown>) {
    const press = () => page.send("Input.dispatchMouseEvent", params);
    await (deps.input?.mouse(page.id, press) ?? press());
  }

  // page가 받지 않은 key 뒤로는 보내지 않는다.
  const keys = (page: Page, strokes: KeyEvent[][]): HostToolOutput =>
    sendKeys(page, deps.input, strokes)
      ? OK
      : failure("unavailable", "The page did not take the input.");

  const wait = (ms: number) =>
    new Promise<void>((resolve) => void deps.schedule(resolve, ms));

  async function put(page: Page, input: PageInput): Promise<HostToolOutput> {
    switch (input.type) {
      case "pointer": {
        await mouse(page, {
          type: {
            down: "mousePressed",
            move: "mouseMoved",
            up: "mouseReleased",
          }[input.phase],
          x: input.x,
          y: input.y,
          button: "left",
          clickCount: 1,
        });
        return OK;
      }
      case "scroll":
        await mouse(page, {
          type: "mouseWheel",
          x: input.x,
          y: input.y,
          deltaX: input.dx,
          deltaY: input.dy,
        });
        return OK;
      case "text":
        return keys(page, typeEvents(input.text));
      case "key": {
        const events = pressEvents(input.key);
        return events === undefined
          ? failure("invalid_input", `unknown key: ${input.key}`)
          : keys(page, [events]);
      }
      case "navigate": {
        const decision = decideNavigation({
          url: input.url,
          isMainFrame: true,
        });
        if (!decision.allow) {
          return failure(
            "invalid_input",
            `the url is not allowed: ${decision.reason}`,
          );
        }
        const { errorText } = await page.send<{ errorText?: string }>(
          "Page.navigate",
          { url: input.url },
        );
        return errorText === undefined
          ? OK
          : failure("unavailable", "The navigation failed.");
      }
      case "back": {
        const { currentIndex, entries } = await page.send<{
          currentIndex: number;
          entries: { id: number }[];
        }>("Page.getNavigationHistory");
        const entry = entries[currentIndex - 1];
        if (entry !== undefined) {
          await page.send("Page.navigateToHistoryEntry", { entryId: entry.id });
        }
        return OK;
      }
      case "reload":
        // CDP `Page.reload`는 webview guest가 아니라 그것을 품은 shell 창을 다시 load한다(emulation.ts). page 안에서 부른다.
        await page.send("Runtime.evaluate", {
          expression: "location.reload()",
        });
        return OK;
    }
  }

  // 켠다. 이미 켠 탭이면 다시 켜고, 탭의 page가 바뀌었으면 옛 page에서 끄고 새 page에서 켠다.
  async function turnOn(tab: string): Promise<HostToolOutput> {
    const page = deps.page(tab);
    if (page === undefined || page.isDestroyed()) return NOT_FOUND;
    const known = streams.get(tab);
    if (known !== undefined && known.page !== page) stop(tab);
    const stream: Stream = streams.get(tab) ?? {
      page,
      read: true,
      sent: 0,
      lastSentMs: -FRAME_MIN_MS,
      latest: undefined,
      acks: [],
      cancelSend: undefined,
      painting: true,
      framed: false,
      cancelPaint: undefined,
    };
    // 이미 켠 탭을 다시 켜면 core가 지금 frame을 바라는 것이다. 앞 frame의 읽음을 기다리지 않는다.
    stream.read = true;
    streams.set(tab, stream);
    listen(page);
    try {
      await start(tab, stream);
    } catch {
      stop(tab);
      return failure(
        "unavailable",
        "The browser page could not be streamed: another debugger may be attached or the page is gone.",
      );
    }
    state(tab, stream);
    return OK;
  }

  return {
    async stream(payload: Payload<"page_stream">): Promise<HostToolOutput> {
      if (payload.on) return await turnOn(payload.tab);
      stop(payload.tab);
      return OK;
    },

    async read(payload: Payload<"page_read">): Promise<HostToolOutput> {
      const stream = streams.get(payload.tab);
      if (stream !== undefined && payload.seq >= stream.sent) {
        stream.read = true;
        flush(payload.tab, stream);
      }
      return OK;
    },

    // 사람의 입력이라 take control을 보지 않는다(그 기계 사람의 손 입력과 같다).
    async input(payload: Payload<"page_input">): Promise<HostToolOutput> {
      const stream = streams.get(payload.tab);
      if (stream === undefined) return NOT_STREAMING;
      if (stream.page.isDestroyed()) return NOT_FOUND;
      const { page } = stream;
      const { input } = payload;
      // 키와 누르기는 driver처럼 page가 답하고 잠시 뒤까지 표시한다(창 focus 되돌리기, menu 단축키 끄기). move·up·scroll은
      // focus도 menu도 건드리지 않고 끌기 중에 초당 30번 오므로 기다리지 않는다.
      const settles =
        input.type === "key" ||
        input.type === "text" ||
        (input.type === "pointer" && input.phase === "down");
      try {
        return settles
          ? await withInput(deps.input, page, () => put(page, input), wait)
          : await put(page, input);
      } catch {
        return failure("unavailable", "The page did not take the input.");
      }
    },

    // 그 기계의 [Take control]·[Hand back]과 같은 상태다. agent가 다룬 적 없는 탭은 그대로다(control.ts).
    async control(payload: Payload<"page_control">): Promise<HostToolOutput> {
      if (deps.page(payload.tab) === undefined) return NOT_FOUND;
      if (payload.held) deps.control.take(payload.tab);
      else deps.control.release(payload.tab);
      return OK;
    },

    /** take control 상태가 바뀌었다(그 기계에서든 멀리서든). */
    controlChanged(tab: string, control: ControlState): void {
      const stream = streams.get(tab);
      if (stream !== undefined) state(tab, stream, control);
    },
    /** 창이 최소화되거나 숨겨졌다. 그리지 않는다. */
    blank(tab: string): void {
      const stream = streams.get(tab);
      if (stream === undefined) return;
      stream.cancelPaint?.();
      stream.cancelPaint = undefined;
      setPainting(tab, stream, false);
    },
    /** 창이 되살아났다. screencast를 다시 켜 첫 frame을 받는다. */
    wake(tab: string): void {
      const stream = streams.get(tab);
      if (stream !== undefined) void start(tab, stream).catch(() => {});
    },
    /** 탭이 다른 view에 다시 bind됐다. 켠 탭이면 frame과 입력이 새 page를 따라가게 다시 켠다. */
    rebind(tab: string): void {
      const stream = streams.get(tab);
      const page = deps.page(tab);
      if (stream !== undefined && page !== undefined && page !== stream.page) {
        void turnOn(tab);
      }
    },
    /** 탭이 닫혔다. */
    forget: stop,
    /** 연결이 다시 열렸다. core가 살아 있는 lease마다 다시 켠다. */
    reset(): void {
      for (const tab of [...streams.keys()]) stop(tab);
    },
  };
}
