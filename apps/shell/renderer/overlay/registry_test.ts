import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import type {
  OverlayApi,
  OverlayEvent,
  OverlayKind,
  OverlayOpen,
  OverlaySnapshot,
  OverlaySurface,
} from "../../ipc/overlay.ts";
import { overlayRegistry } from "./registry.ts";
import { overlayConsumer } from "./consumer.ts";

function fixture() {
  const window = new Window();
  const document = window.document;
  const root = document.createElement("main");
  document.body.append(root);
  const listeners = new Set<(event: OverlayEvent) => void>();
  const results: unknown[] = [];
  const api: OverlayApi = {
    open: (input) =>
      Promise.resolve({
        ok: true,
        value: { surfaceId: input.requestId, generation: 1 },
      }),
    close: () => Promise.resolve({ ok: true, value: null }),
    result: (input) => {
      results.push(input);
      return Promise.resolve({ ok: true, value: null });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const registry = overlayRegistry(root as unknown as HTMLElement, api, {
    surface: "surface",
  }, () => {});
  function surface(kind: OverlayKind, id = kind): OverlaySurface {
    return {
      kind,
      surfaceId: id,
      requestId: id,
      generation: 1,
      anchorRect: { x: 100, y: 80, width: 200, height: 100 },
      rect: { x: 30, y: 20, width: 200, height: 100 },
      model: {
        label: "<script>not HTML</script>",
        choices: [{ id: "yes", label: "Yes" }],
      },
    };
  }
  function emit(surfaces: OverlaySurface[]) {
    const event: OverlaySnapshot = {
      generation: 1,
      bounds: { x: 70, y: 60, width: 600, height: 400 },
      surfaces,
    };
    for (const listener of listeners) listener(event);
  }
  return {
    window,
    document,
    root,
    api,
    registry,
    results,
    surface,
    emit,
    listeners,
  };
}

Deno.test("shell/design-system#R20: overlay registry renders sibling z tokens and keeps local display coordinates", () => {
  const f = fixture();
  f.emit([
    f.surface("sheet"),
    f.surface("dialog"),
    f.surface("palette"),
    f.surface("popover"),
    f.surface("notification"),
    f.surface("tooltip"),
  ]);
  assertEquals(f.root.children.length, 6);
  const expected = [
    "sheet",
    "dialog",
    "palette",
    "popover",
    "toast",
    "tooltip",
  ];
  for (let i = 0; i < 6; i++) {
    const node = f.root.children[i] as unknown as HTMLElement;
    assert(node.parentElement === f.root as unknown as HTMLElement);
    assertEquals(node.style.zIndex, `var(--z-${expected[i]})`);
    assertEquals(node.style.left, "30px");
    assertEquals(node.style.top, "20px");
  }
  assertEquals(f.root.querySelectorAll("script").length, 0);
  f.registry.dispose();
  assertEquals(f.listeners.size, 0);
});

Deno.test("shell/design-system#R2: interactive focus differs from tooltip drag notification and restores connected opener", async () => {
  const f = fixture();
  const opener = f.document.createElement("button");
  f.document.body.append(opener);
  opener.focus();
  const consumer = overlayConsumer(f.api, () => {}, () => {});
  for (const kind of ["tooltip", "drag", "notification"] as const) {
    f.emit([f.surface(kind)]);
    assert(f.document.activeElement === opener);
    assertEquals(f.root.querySelectorAll("button").length, 0);
  }
  const input: OverlayOpen = f.surface("menu");
  await consumer.open(input, opener as unknown as HTMLElement);
  f.emit([f.surface("menu")]);
  assert(f.document.activeElement === f.root.querySelector("button"));
  for (const listener of f.listeners) {
    listener({
      requestId: "menu",
      surfaceId: "menu",
      generation: 99,
      type: "closed",
    });
  }
  assert(f.document.activeElement === f.root.querySelector("button"));
  for (const listener of f.listeners) {
    listener({
      requestId: "menu",
      surfaceId: "menu",
      generation: 1,
      type: "closed",
      reason: "dismissed",
    });
  }
  assert(f.document.activeElement === opener);
  consumer.dispose();
  f.registry.dispose();
});

Deno.test("shell/design-system#R20: popup outside modal closes on focus movement and sheet dismisses outside without backdrop", () => {
  const f = fixture();
  const external = f.document.createElement("button");
  f.document.body.append(external);
  f.emit([f.surface("dialog"), f.surface("popover")]);
  external.focus();
  assert(
    f.results.some((result) =>
      (result as { surfaceId: string }).surfaceId === "popover"
    ),
  );
  f.emit([f.surface("sheet")]);
  external.dispatchEvent(
    new f.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  assert(
    f.results.some((result) =>
      (result as { surfaceId: string }).surfaceId === "sheet"
    ),
  );
  assertEquals(f.root.querySelectorAll("[data-kind=backdrop]").length, 0);
  f.registry.dispose();
});

Deno.test("shell/app-frame#R29: drag captures pointer over full body and sends finite local-to-body pointer coordinates", () => {
  const f = fixture();
  const surface = f.surface("drag");
  surface.rect = { x: 0, y: 0, width: 600, height: 400 };
  f.emit([surface]);
  const node = f.root.firstElementChild!;
  let captured = -1;
  Object.assign(node, {
    setPointerCapture: (id: number) => {
      captured = id;
    },
    hasPointerCapture: (id: number) => id === captured,
    releasePointerCapture: () => {
      captured = -1;
    },
  });
  node.dispatchEvent(
    new f.window.PointerEvent("pointerdown", { pointerId: 4 }),
  );
  node.dispatchEvent(
    new f.window.PointerEvent("pointermove", {
      pointerId: 4,
      clientX: 100,
      clientY: 100,
    }),
  );
  const result = f.results[0] as { x: number; y: number; pointerId: number };
  assertEquals(result.x, 170);
  assertEquals(result.y, 160);
  assertEquals(result.pointerId, 4);
  node.dispatchEvent(
    new f.window.PointerEvent("pointerup", {
      pointerId: 4,
      clientX: 200,
      clientY: 150,
    }),
  );
  assertEquals(f.results[1], {
    type: "drag-end",
    surfaceId: "drag",
    generation: 1,
    pointerId: 4,
    x: 270,
    y: 210,
    bounds: { x: 100, y: 80, width: 170, height: 130 },
  });
  assertEquals(captured, -1);
  node.dispatchEvent(
    new f.window.PointerEvent("pointerdown", { pointerId: 5 }),
  );
  node.dispatchEvent(
    new f.window.PointerEvent("pointercancel", { pointerId: 5 }),
  );
  assertEquals(f.results[2], {
    type: "drag-cancel",
    surfaceId: "drag",
    generation: 1,
  });
  assertEquals(captured, -1);
  f.registry.dispose();
});

Deno.test("shell/app-frame#R24: consumer cleans rejected or thrown open for retry and never revives disposed requests", async () => {
  const f = fixture();
  const opener = f.document.createElement("button");
  f.document.body.append(opener);
  const errors: unknown[] = [];
  const consumer = overlayConsumer(
    f.api,
    () => {},
    (error) => errors.push(error),
  );
  const input = f.surface("menu");
  const original = f.api.open;
  for (
    const failed of [() => Promise.reject(new Error("secret")), () => {
      throw new Error("secret");
    }]
  ) {
    f.api.open = failed;
    const result = await consumer.open(input, opener as unknown as HTMLElement);
    assert(!result.ok);
    assert(!JSON.stringify(result).includes("secret"));
    f.api.open = original;
    assert((await consumer.open(input, opener as unknown as HTMLElement)).ok);
    for (const listener of f.listeners) {
      listener({
        requestId: "menu",
        surfaceId: "menu",
        generation: 1,
        type: "closed",
      });
    }
  }
  consumer.dispose();
  assert(!(await consumer.open(input, opener as unknown as HTMLElement)).ok);
  f.registry.dispose();
});

Deno.test("shell/app-frame#R24: registry result rejection is observed sanitized and same choice can retry", async () => {
  const f = fixture();
  const errors: unknown[] = [];
  f.registry.dispose();
  const registry = overlayRegistry(
    f.root as unknown as HTMLElement,
    f.api,
    {},
    (error) => errors.push(error),
  );
  f.api.result = () => Promise.reject(new Error("credential secret"));
  registry.update({
    generation: 1,
    bounds: { x: 0, y: 0, width: 500, height: 500 },
    surfaces: [f.surface("menu")],
  });
  const button = f.root.querySelector("button")!;
  button.click();
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(errors.length, 1);
  assert(!JSON.stringify(errors).includes("secret"));
  f.api.result = () => Promise.resolve({ ok: true, value: null });
  button.click();
  await Promise.resolve();
  assertEquals(errors.length, 1);
  assertEquals(button.getAttribute("role"), "menuitem");
  registry.update({
    generation: 1,
    bounds: { x: 0, y: 0, width: 500, height: 500 },
    surfaces: [f.surface("tooltip")],
  });
  assertEquals(f.root.firstElementChild?.getAttribute("role"), "tooltip");
  registry.dispose();
});

Deno.test("shell/app-frame#R24: observers receive ready errors and disposal suppresses late open and result callbacks", async () => {
  const f = fixture();
  f.registry.dispose();
  const errors: unknown[] = [];
  const completions: unknown[] = [];
  let readyError = (_error: unknown) => {};
  f.api.subscribe = (listener, onError) => {
    readyError = onError as typeof readyError;
    f.listeners.add(listener);
    return () => {
      f.listeners.delete(listener);
    };
  };
  const consumer = overlayConsumer(
    f.api,
    (event) => completions.push(event),
    (error) => errors.push(error),
  );
  const error = { code: "unavailable", message: "Overlay is unavailable" };
  readyError(error);
  assertEquals(errors, [error]);
  let resolveOpen: (value: Awaited<ReturnType<OverlayApi["open"]>>) => void =
    () => {};
  f.api.open = () =>
    new Promise((resolve) => {
      resolveOpen = resolve;
    });
  const opener = f.document.createElement("button");
  f.document.body.append(opener);
  const opening = consumer.open(
    f.surface("menu"),
    opener as unknown as HTMLElement,
  );
  consumer.dispose();
  resolveOpen({ ok: true, value: { surfaceId: "menu", generation: 1 } });
  await opening;
  assertEquals(f.listeners.size, 0);
  assertEquals(completions, []);
  assert(
    !(await consumer.open(f.surface("menu"), opener as unknown as HTMLElement))
      .ok,
  );
  let rejectResult = (_reason: unknown) => {};
  f.api.result = () =>
    new Promise((_resolve, reject) => {
      rejectResult = reject;
    });
  const registry = overlayRegistry(
    f.root as unknown as HTMLElement,
    f.api,
    {},
    (failure) => errors.push(failure),
  );
  f.emit([f.surface("menu")]);
  f.root.querySelector("button")!.click();
  registry.dispose();
  rejectResult(new Error("secret"));
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(errors, [error]);
});
