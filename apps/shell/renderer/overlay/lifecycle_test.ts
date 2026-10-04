import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import type {
  OverlayApi,
  OverlayError,
  OverlayEvent,
  OverlayIdentity,
  OverlayKind,
  OverlayReply,
  OverlaySnapshot,
  OverlaySurface,
} from "../../ipc/overlay.ts";
import { overlayConsumer } from "./consumer.ts";
import { overlayRegistry, type SurfaceActions } from "./registry.ts";

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
  const mounts: string[] = [];
  const registry = overlayRegistry(
    f.root as unknown as HTMLElement,
    f.api,
    {},
    (error) => errors.push(error),
    () => {
      mounts.push("mount");
      return () => mounts.push("unmount");
    },
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
  assertEquals(mounts, []);
  assertEquals(errors, []);
  assertEquals(f.listeners.length, 2);
  assertEquals(f.releases, 2);
});

Deno.test("shell/app-frame#R24: same generation update keeps the mounted surface and removal, regeneration and dispose unmount without results", () => {
  const f = fixture();
  const results: unknown[] = [];
  f.api.result = (input) => {
    results.push(input);
    return Promise.resolve({ ok: true, value: null });
  };
  const log: string[] = [];
  const mounted = new Map<string, SurfaceActions>();
  const registry = overlayRegistry(
    f.root as unknown as HTMLElement,
    f.api,
    {},
    () => {},
    (_host, surface, actions) => {
      const id = `${surface.surfaceId}@${surface.generation}`;
      mounted.set(surface.surfaceId, actions);
      log.push(`mount ${id}`);
      return () => log.push(`unmount ${id}`);
    },
  );
  const surface = (kind: OverlayKind, generation = 1): OverlaySurface => ({
    ...f.identity,
    surfaceId: kind,
    generation,
    kind,
    anchorRect: f.input.anchorRect,
    rect: f.input.anchorRect,
    model: { label: "Menu", choices: [{ id: "yes", label: "Yes" }] },
  });
  const emit = (surfaces: OverlaySurface[]) => {
    for (const listener of f.listeners) {
      listener({
        generation: 1,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        surfaces,
      });
    }
  };
  emit([surface("menu"), surface("drag")]);
  const host = f.root.firstElementChild;
  emit([{ ...surface("menu"), rect: { x: 4, y: 5, width: 20, height: 10 } }]);
  assert(f.root.firstElementChild === host, "same generation remounted");
  assertEquals((host as unknown as HTMLElement).style.left, "4px");
  assertEquals(log, ["mount menu@1"]);
  const stale = mounted.get("menu")!;
  emit([surface("menu", 2)]);
  assertEquals(log, ["mount menu@1", "unmount menu@1", "mount menu@2"]);
  stale.select("yes");
  stale.close();
  const fresh = mounted.get("menu")!;
  emit([]);
  assertEquals(f.root.children.length, 0);
  fresh.close();
  emit([surface("dialog")]);
  const dialog = mounted.get("dialog")!;
  registry.dispose();
  dialog.close();
  assertEquals(log.slice(3), [
    "unmount menu@2",
    "mount dialog@1",
    "unmount dialog@1",
  ]);
  assertEquals(results, []);
  assertEquals(f.root.children.length, 0);
});

function terminalFixture() {
  const f = fixture();
  const sent: unknown[] = [];
  const errors: OverlayError[] = [];
  const replies: {
    resolve: (reply: OverlayReply<null>) => void;
    reject: (reason: unknown) => void;
  }[] = [];
  f.api.result = (input) => {
    sent.push(input);
    return new Promise((resolve, reject) => replies.push({ resolve, reject }));
  };
  let actions!: SurfaceActions;
  const registry = overlayRegistry(
    f.root as unknown as HTMLElement,
    f.api,
    {},
    (error) => errors.push(error),
    (_host, _surface, next) => {
      actions = next;
      return () => {};
    },
  );
  const surface = (generation = 1): OverlaySurface => ({
    ...f.identity,
    generation,
    kind: "notification",
    anchorRect: f.input.anchorRect,
    rect: f.input.anchorRect,
    model: { label: "Notice", choices: [{ id: "view", label: "View" }] },
  });
  const show = (surfaces: OverlaySurface[]) =>
    registry.update({
      generation: 1,
      bounds: f.input.anchorRect,
      surfaces,
    });
  show([surface()]);
  const settled = async () => {
    for (let round = 0; round < 3; round++) await Promise.resolve();
  };
  return {
    registry,
    sent,
    errors,
    get actions() {
      return actions;
    },
    reply: (value: OverlayReply<null>) => replies.at(-1)!.resolve(value),
    throw: () => replies.at(-1)!.reject(new Error("credential secret")),
    surface,
    show,
    settled,
  };
}

const failed: OverlayReply<null> = {
  ok: false,
  error: { code: "unavailable", message: "Overlay is unavailable" },
};

Deno.test("shell/app-frame#R24: terminal select·close is single-flight while pending and consumed after an accepted result", async () => {
  const f = terminalFixture();
  const actions = f.actions;
  actions.select("view");
  actions.select("view");
  actions.close();
  assertEquals(f.sent.length, 1);
  f.reply({ ok: true, value: null });
  await f.settled();
  actions.close();
  actions.select("view");
  assertEquals(f.sent.length, 1);
  assertEquals(f.errors, []);
  f.registry.dispose();
});

Deno.test("shell/app-frame#R24: failed or thrown terminal result reports once and allows one explicit retry on the same live surface", async () => {
  const f = terminalFixture();
  const actions = f.actions;
  actions.select("view");
  f.reply(failed);
  await f.settled();
  assertEquals(f.errors.length, 1);
  actions.select("view");
  actions.close();
  assertEquals(f.sent.length, 2);
  f.reply({ ok: true, value: null });
  await f.settled();
  f.registry.dispose();
  const g = terminalFixture();
  g.actions.close();
  g.throw();
  await g.settled();
  assertEquals(g.errors, [failed.error]);
  g.actions.close();
  g.actions.close();
  assertEquals(g.sent.length, 2);
  g.registry.dispose();
});

Deno.test("shell/app-frame#R24: late replies for replaced, removed or disposed surfaces publish no error", async () => {
  for (const end of ["replaced", "removed", "disposed"] as const) {
    const f = terminalFixture();
    f.actions.select("view");
    if (end === "replaced") f.show([f.surface(2)]);
    else if (end === "removed") f.show([]);
    else f.registry.dispose();
    f.reply(failed);
    await f.settled();
    assertEquals(f.errors, [], end);
    f.registry.dispose();
  }
});
