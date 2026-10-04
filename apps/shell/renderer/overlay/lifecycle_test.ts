import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import type {
  OverlayApi,
  OverlayError,
  OverlayEvent,
  OverlayIdentity,
  OverlayReply,
  OverlaySnapshot,
} from "../../ipc/overlay.ts";
import { overlayConsumer } from "./consumer.ts";
import { overlayRegistry } from "./registry.ts";

function fixture() {
  const dom = new Window();
  const root = dom.document.createElement("main");
  const opener = dom.document.createElement("button");
  dom.document.body.append(root, opener);
  const listeners: ((event: OverlayEvent) => void)[] = [];
  const observers: ((error: OverlayError) => void)[] = [];
  let releases = 0;
  let resolveOpen: (reply: OverlayReply<OverlayIdentity>) => void = () => {};
  const api: OverlayApi = {
    open: () =>
      new Promise((resolve) => {
        resolveOpen = resolve;
      }),
    close: () => Promise.resolve({ ok: true, value: null }),
    result: () => Promise.resolve({ ok: true, value: null }),
    subscribe(listener, observer) {
      listeners.push(listener);
      observers.push(observer);
      return () => {
        releases++;
      };
    },
  };
  const input = {
    requestId: "early",
    kind: "drag" as const,
    anchorRect: { x: 0, y: 0, width: 20, height: 20 },
    model: { label: "Drag", choices: [] },
  };
  const identity = { requestId: "early", surfaceId: "surface", generation: 1 };
  const pointer = (width: number) => ({
    ...identity,
    type: "pointer" as const,
    bounds: { x: 0, y: 0, width, height: 20 },
  });
  const terminal = {
    ...identity,
    type: "closed" as const,
    reason: "completed" as const,
  };
  return {
    dom,
    root,
    opener,
    api,
    input,
    identity,
    pointer,
    terminal,
    listeners,
    observers,
    resolve: (value: OverlayIdentity) => resolveOpen({ ok: true, value }),
    get releases() {
      return releases;
    },
  };
}

Deno.test("shell/app-frame#R29: delayed open drains bounded latest pointer before completed and ignores terminal late events", async () => {
  const f = fixture();
  const received: OverlayEvent[] = [];
  const consumer = overlayConsumer(
    f.api,
    (event) => received.push(event),
    () => {},
  );
  const opening = consumer.open(f.input, f.opener as unknown as HTMLElement);
  const emit = f.listeners[0];
  for (let width = 1; width <= 1000; width++) emit(f.pointer(width));
  emit(f.terminal);
  emit(f.pointer(2000));
  emit({ ...f.terminal, reason: "cancelled" });
  f.resolve(f.identity);
  assert((await opening).ok);
  assertEquals(received, [f.pointer(1000), f.terminal]);
  emit(f.pointer(3000));
  emit(f.terminal);
  assertEquals(received.length, 2);
  consumer.dispose();
});

Deno.test("shell/app-frame#R24: pending pointer and terminal validate returned identity and generation independently", async () => {
  for (const mismatch of [{ surfaceId: "wrong" }, { generation: 99 }]) {
    for (const wrong of ["pointer", "terminal", "both"]) {
      const f = fixture();
      const received: OverlayEvent[] = [];
      const consumer = overlayConsumer(
        f.api,
        (event) => received.push(event),
        () => {},
      );
      const opening = consumer.open(
        f.input,
        f.opener as unknown as HTMLElement,
      );
      const pointer = f.pointer(40);
      const emit = f.listeners[0];
      emit(wrong !== "terminal" ? { ...pointer, ...mismatch } : pointer);
      emit(wrong !== "pointer" ? { ...f.terminal, ...mismatch } : f.terminal);
      f.resolve(f.identity);
      await opening;
      assertEquals(
        received,
        wrong === "both" ? [] : wrong === "pointer" ? [f.terminal] : [pointer],
      );
      emit(f.terminal);
      assertEquals(received.at(-1), f.terminal);
      consumer.dispose();
    }
  }
});

Deno.test("shell/app-frame#R24: disposed consumer ignores captured callback ready error and unresolved open completion", async () => {
  const f = fixture();
  const received: OverlayEvent[] = [];
  const errors: OverlayError[] = [];
  const consumer = overlayConsumer(
    f.api,
    (event) => received.push(event),
    (error) => errors.push(error),
  );
  const opening = consumer.open(f.input, f.opener as unknown as HTMLElement);
  f.listeners[0](f.pointer(50));
  f.listeners[0](f.terminal);
  consumer.dispose();
  f.resolve(f.identity);
  await opening;
  f.listeners[0](f.pointer(80));
  f.observers[0]({ code: "unavailable", message: "Overlay is unavailable" });
  assertEquals(received, []);
  assertEquals(errors, []);
  assertEquals(f.releases, 1);
});

Deno.test("shell/app-frame#R24: disposed registry blocks stale subscription public update ready error and retry resubscription", () => {
  const f = fixture();
  const errors: OverlayError[] = [];
  const registry = overlayRegistry(
    f.root as unknown as HTMLElement,
    f.api,
    {},
    (error) => errors.push(error),
  );
  const state: OverlaySnapshot = {
    generation: 1,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    surfaces: [{
      ...f.identity,
      kind: "menu",
      anchorRect: f.input.anchorRect,
      rect: f.input.anchorRect,
      model: { label: "Menu", choices: [{ id: "yes", label: "Yes" }] },
    }],
  };
  registry.retryReady();
  assertEquals(f.listeners.length, 2);
  registry.dispose();
  f.opener.focus();
  for (const listener of f.listeners) listener(state);
  for (const observer of f.observers) {
    observer({ code: "unavailable", message: "Overlay is unavailable" });
  }
  registry.update(state);
  registry.retryReady();
  registry.dispose();
  assertEquals(f.root.children.length, 0);
  assert(f.dom.document.activeElement === f.opener);
  assertEquals(errors, []);
  assertEquals(f.listeners.length, 2);
  assertEquals(f.releases, 2);
});
