import assert from "node:assert/strict";
import {
  createOverlay,
  type OverlayContents,
  type OverlayView,
} from "../overlay.ts";
import { ContentsRegistry, type IpcEvent } from "../../desktop/ipc-guard.ts";
import type { OverlayEvent, OverlayOpen, Rect } from "../../../ipc/overlay.ts";
export function fixture() {
  let next = 1;
  const registry = new ContentsRegistry();
  function contents(host: string) {
    const frame = { parent: null, url: `lophn-shell://${host}/index.html` };
    const messages: OverlayEvent[] = [];
    let destroyed = false;
    let focuses = 0;
    const urls: string[] = [];
    let reject: (reason: Error) => void = () => {};
    const object: OverlayContents = {
      id: next++,
      mainFrame: frame,
      isDestroyed: () => destroyed,
      loadURL: (url) => {
        urls.push(url);
        return new Promise<void>((_resolve, no) => {
          reject = no;
        });
      },
      send: (_channel, event) => messages.push(event),
      focus: () => {
        focuses++;
      },
      close: () => {
        destroyed = true;
      },
    };
    return {
      object,
      urls,
      messages,
      frame,
      focuses: () => focuses,
      reject: () => reject(new Error("failed")),
    };
  }
  const shell = contents("desktop");
  registry.register({
    contents: shell.object,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  const views: {
    view: OverlayView;
    wc: ReturnType<typeof contents>;
    fail(reason: "crashed" | "load_failed"): void;
    bounds: Rect[];
    visible: boolean[];
    color: string;
    config: unknown;
    released: boolean;
  }[] = [];
  const order: OverlayView[] = [];
  const timers = new Map<number, () => void>();
  let clock = 0;
  const body = { x: 10, y: 48, width: 900, height: 600 };
  const controller = createOverlay({
    shell: shell.object,
    registry,
    preload: "installed-preload",
    packaged: true,
    body: () => body,
    host: {
      addChildView(view) {
        const i = order.indexOf(view);
        if (i >= 0) order.splice(i, 1);
        order.push(view);
      },
      removeChildView(view) {
        order.splice(order.indexOf(view), 1);
      },
    },
    create(config) {
      const wc = contents("overlay");
      let failure: (reason: "crashed" | "load_failed") => void = () => {};
      const item = {
        wc,
        bounds: [] as Rect[],
        visible: [] as boolean[],
        color: "",
        config,
        released: false,
        fail: (reason: "crashed" | "load_failed") => failure(reason),
        view: undefined as unknown as OverlayView,
      };
      item.view = {
        webContents: wc.object,
        setBounds: (b) => item.bounds.push(b),
        setVisible: (v) => item.visible.push(v),
        setBackgroundColor: (c) => {
          item.color = c;
        },
        onFailure: (fn) => {
          failure = fn;
          return () => {
            item.released = true;
          };
        },
      };
      views.push(item);
      return item.view;
    },
    timer: {
      set(fn, ms) {
        assert.equal(ms, 16);
        timers.set(++clock, fn);
        return clock;
      },
      clear(handle) {
        timers.delete(handle as number);
      },
    },
  });
  const event = (object: OverlayContents): IpcEvent => ({
    sender: object,
    senderFrame: object.mainFrame,
  });
  const input = (
    kind: OverlayOpen["kind"] = "menu",
    requestId = "request",
  ): OverlayOpen => ({
    requestId,
    kind,
    anchorRect: { x: 100, y: 80, width: 200, height: 100 },
    model: {
      label: "label",
      choices: [{ id: "yes", label: "Yes" }, {
        id: "no",
        label: "No",
        disabled: true,
      }],
    },
  });
  function open(kind: OverlayOpen["kind"] = "menu", requestId = "request") {
    const result = controller.open(event(shell.object), input(kind, requestId));
    assert(result.ok);
    return result.value;
  }
  return {
    controller,
    shell,
    views,
    order,
    timers,
    get applied() {
      return shell.messages.filter((event) =>
        "type" in event && event.type === "pointer"
      ).map((event) => (event as { bounds: Rect }).bounds);
    },
    body,
    registry,
    contents,
    event,
    input,
    open,
  };
}
