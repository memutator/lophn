import assert from "node:assert/strict";
import { test } from "node:test";

import type { AppBinding, ConnectTarget, Outcome } from "./app-connection.ts";
import { createViewDiagnostics } from "./diagnostics.ts";
import {
  type AppViewContents,
  type ClosedView,
  createAppFrame,
  type ViewBounds,
} from "./registry.ts";
import {
  BOUNDS_FRAME_MS,
  createViewVisibility,
  intersect,
  toDip,
} from "./visibility.ts";

const APP_A = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const APP_B = "app_01j9yyyyyyyyyyyyyyyyyyyyyy";
const REL = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const TOP = 40;

type Step =
  | { kind: "attach"; id: number; bounds: ViewBounds }
  | { kind: "detach"; id: number }
  | { kind: "focus-shell"; window: string };

/** 실제 registry와 visibility에 가짜 창·native view·timer를 끼운다. */
function world(options: { manualLoad?: boolean } = {}) {
  const steps: Step[] = [];
  // 지금 창에 붙은 view의 사각형. 매 step 뒤 겹침을 본다.
  const shown = new Map<number, ViewBounds>();
  const overlaps: string[] = [];
  const loads = new Map<number, () => void>();
  const windows = new Map([["window-1", { width: 1280, height: 800 }], [
    "window-2",
    { width: 1280, height: 800 },
  ]]);
  const zoom = new Map<string, number>();
  const closed: ClosedView[] = [];
  const pushed: { window: string; state: unknown }[] = [];
  let focused: number | undefined;
  let nextId = 100;
  let serial = 0;
  let timers: { run(): void; ms: number }[] = [];

  function checkOverlap(): void {
    const rects = [...shown];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const cross = intersect(rects[i]![1], rects[j]![1]);
        if (cross.width > 0 && cross.height > 0) {
          overlaps.push(`${rects[i]![0]}x${rects[j]![0]}`);
        }
      }
    }
  }

  const frame = createAppFrame({
    connector: {
      connect(target: ConnectTarget): Promise<Outcome<AppBinding>> {
        return Promise.resolve({
          ok: true,
          value: {
            endpoint: `/sock/${target.app}`,
            authorization: "auth",
            release: target.release,
            bundleHash: "0".repeat(64),
            processNonce: "nonce",
            expiresAtMs: null,
          },
        });
      },
      hosts: () => Promise.resolve({ ok: true, value: [] }),
    },
    views: {
      hasWindow: (window) => windows.has(window),
      create() {
        const id = nextId++;
        const contents: AppViewContents = {
          id,
          load() {
            if (!options.manualLoad) return Promise.resolve();
            return new Promise((resolve) => loads.set(id, resolve));
          },
          destroy() {},
        };
        return contents;
      },
      attach(window, view, bounds) {
        if (!windows.has(window)) return false;
        steps.push({ kind: "attach", id: view.id, bounds });
        shown.set(view.id, bounds);
        checkOverlap();
        return true;
      },
      detach(_window, view) {
        steps.push({ kind: "detach", id: view.id });
        shown.delete(view.id);
      },
      focused: (view) => focused === view.id,
      focusShell(window) {
        focused = undefined;
        steps.push({ kind: "focus-shell", window });
      },
    },
    sessionHandle: () => ({
      denyPermissions() {},
      onDownload() {},
      onBeforeRequest() {},
      onBeforeSendHeaders() {},
      handleProtocol() {},
      clearCache: () => Promise.resolve(),
    }),
    upstream: () => Promise.reject(new Error("no upstream")),
    platformPorts: () => [],
    diagnostics: createViewDiagnostics({
      send: () => true,
      log: () => {},
      clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
    }),
    ids: {
      viewSession: () => `view-${++serial}`,
      token: () => `token-${serial}`,
    },
    clock: { nowMs: () => 0 },
    onState: (window, state) => pushed.push({ window, state }),
    closed: (view) => closed.push(view),
  });

  const visibility = createViewVisibility({
    frame,
    geometry: {
      body(window) {
        const size = windows.get(window);
        return size === undefined ? undefined : {
          x: 0,
          y: TOP,
          width: size.width,
          height: size.height - TOP,
        };
      },
      zoom: (window) => zoom.get(window) ?? 1,
    },
    timer: {
      set(callback, ms) {
        const handle = { run: callback, ms };
        timers.push(handle);
        return handle;
      },
      clear(handle) {
        timers = timers.filter((timer) => timer !== handle);
      },
    },
  });

  return {
    frame,
    visibility,
    steps,
    shown,
    overlaps,
    windows,
    zoom,
    closed,
    pushed,
    /** 지금 걸린 frame timer를 돌린다. */
    async tick() {
      const due = timers;
      timers = [];
      for (const timer of due) {
        assert.equal(timer.ms, BOUNDS_FRAME_MS);
        timer.run();
      }
      await new Promise((resolve) => setImmediate(resolve));
    },
    pendingTimers: () => timers.length,
    finishLoad(id: number) {
      loads.get(id)?.();
    },
    focus(id: number | undefined) {
      focused = id;
    },
    focused: () => focused,
    async open(app = APP_A, window = "window-1") {
      const opened = await visibility.openApp(window, {
        app,
        mode: "live",
        release: REL,
        screen: "main",
        size: "panel",
      });
      assert.equal(opened.ok, true, JSON.stringify(opened));
      await new Promise((resolve) => setImmediate(resolve));
      return (opened as { ok: true; value: { view_session: string } }).value
        .view_session;
    },
  };
}

const LEFT: ViewBounds = { x: 0, y: TOP, width: 640, height: 760 };
const RIGHT: ViewBounds = { x: 640, y: TOP, width: 640, height: 760 };

test("shell/app-frame#R27, shell/app-frame#R28: 프로젝트 두 칸의 앱 view를 각 경계에 동시에 붙이고 서로 겹치지 않는다", async () => {
  const w = world();
  const left = await w.open(APP_A);
  const right = await w.open(APP_B);
  // bounds가 오기 전에는 어디에도 붙이지 않는다.
  assert.deepEqual(w.steps, []);
  const results = Promise.all([
    w.visibility.setBounds("window-1", left, LEFT),
    w.visibility.setBounds("window-1", right, RIGHT),
  ]);
  await w.tick();
  assert.deepEqual(await results, [
    { ok: true, value: { generation: 1 } },
    { ok: true, value: { generation: 1 } },
  ]);
  assert.deepEqual([...w.shown.values()], [LEFT, RIGHT]);
  assert.deepEqual(w.overlaps, []);
});

test("shell/app-frame#R29, shell/app-frame#R35: drag·resize 중 bounds는 모든 view를 함께 16ms마다 한 번, 마지막 값으로 적용한다", async () => {
  const w = world();
  const left = await w.open(APP_A);
  const right = await w.open(APP_B);
  void w.visibility.setBounds("window-1", left, LEFT);
  void w.visibility.setBounds("window-1", right, RIGHT);
  await w.tick();
  w.steps.length = 0;
  // pointer DTO마다 pane 경계가 움직인다. 한 frame 안에 여러 번 와도 timer는 하나다.
  const waits = [];
  for (const edge of [600, 610, 620, 630]) {
    waits.push(w.visibility.setBounds("window-1", left, {
      ...LEFT,
      width: edge,
    }));
    waits.push(w.visibility.setBounds("window-1", right, {
      ...RIGHT,
      x: edge,
      width: 1280 - edge,
    }));
  }
  assert.equal(w.pendingTimers(), 1);
  assert.deepEqual(w.steps, []);
  await w.tick();
  // 기다린 요청은 모두 그 frame의 결과로 끝난다.
  assert.equal((await Promise.all(waits)).every((result) => result.ok), true);
  // drag 중에도 view는 떼지 않는다.
  const steps: Step[] = w.steps;
  assert.equal(steps.some((step) => step.kind === "detach"), false);
  assert.deepEqual(w.steps, [
    { kind: "attach", id: 100, bounds: { ...LEFT, width: 630 } },
    { kind: "attach", id: 101, bounds: { ...RIGHT, x: 630, width: 650 } },
  ]);
  assert.deepEqual(w.overlaps, []);
});

test("shell/app-frame#R29: 탭 전환은 옛 view를 먼저 숨기고 새 view는 bounds와 준비가 모두 된 뒤에 붙여 겹친 frame이 없다", async () => {
  const w = world({ manualLoad: true });
  const old = await w.open(APP_A);
  w.finishLoad(100);
  await new Promise((resolve) => setImmediate(resolve));
  void w.visibility.setBounds("window-1", old, LEFT);
  await w.tick();
  assert.deepEqual([...w.shown.keys()], [100]);
  // renderer의 전환: 옛 view 숨김 → 새 view 열기 → 새 view bounds.
  assert.deepEqual(w.visibility.hide("window-1", [old]), {
    ok: true,
    value: { generation: 2 },
  });
  assert.deepEqual([...w.shown.keys()], []);
  const next = await w.open(APP_B);
  const placed = w.visibility.setBounds("window-1", next, LEFT);
  await w.tick();
  assert.deepEqual(await placed, { ok: true, value: { generation: 1 } });
  // 준비 전에는 붙이지 않는다.
  assert.deepEqual([...w.shown.keys()], []);
  // 준비 전에 온 마지막 bounds로 붙인다.
  void w.visibility.setBounds("window-1", next, { ...LEFT, width: 600 });
  await w.tick();
  w.finishLoad(101);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...w.shown], [[101, { ...LEFT, width: 600 }]]);
  assert.deepEqual(w.steps.map((step) => step.kind), [
    "attach",
    "detach",
    "attach",
  ]);
  assert.deepEqual(w.overlaps, []);
  // 숨김은 그 frame에 기다리던 bounds보다 앞선다.
  const late = w.visibility.setBounds("window-1", old, RIGHT);
  w.visibility.hide("window-1", [old]);
  assert.deepEqual(await late, { ok: true, value: { generation: 2 } });
  await w.tick();
  assert.deepEqual([...w.shown.keys()], [101]);
});

test("shell/app-frame#R35: 창 본문 밖으로 나간 부분은 잘라 붙이고 스크롤 밖 카드는 떼며 다시 들어오면 붙인다", async () => {
  const w = world();
  const card = await w.open(APP_A);
  void w.visibility.setBounds("window-1", card, {
    x: 100,
    y: 10,
    width: 300,
    height: 200,
  });
  await w.tick();
  // 상단 바(크롬)를 덮지 않는다.
  assert.deepEqual(w.shown.get(100), {
    x: 100,
    y: TOP,
    width: 300,
    height: 170,
  });
  void w.visibility.setBounds("window-1", card, {
    x: 100,
    y: 900,
    width: 300,
    height: 200,
  });
  await w.tick();
  assert.equal(w.shown.has(100), false);
  assert.equal(w.frame.state(card) !== undefined, true);
  void w.visibility.setBounds("window-1", card, {
    x: 100,
    y: 500,
    width: 300,
    height: 200,
  });
  await w.tick();
  assert.deepEqual(w.shown.get(100), {
    x: 100,
    y: 500,
    width: 300,
    height: 200,
  });
  assert.deepEqual(w.steps.map((step) => step.kind), [
    "attach",
    "detach",
    "attach",
  ]);
});

test("shell/app-frame#R25, shell/app-frame#R26, shell/app-frame#R36: page zoom을 창 DIP로 맞추고 좁은 창에서 패널이 덮은 만큼 줄였다가 닫으면 원래 bounds로 돌아온다", async () => {
  assert.deepEqual(toDip({ x: 10, y: 41, width: 101, height: 33 }, 1.5), {
    x: 15,
    y: 62,
    width: 152,
    height: 49,
  });
  const w = world();
  w.windows.set("window-1", { width: 900, height: 700 });
  const view = await w.open(APP_A);
  const full = { x: 0, y: TOP, width: 900, height: 660 };
  void w.visibility.setBounds("window-1", view, full);
  await w.tick();
  // renderer가 덮인 영역을 뺀 사각형을 보낸다. view는 숨기지 않고 줄인다.
  void w.visibility.setBounds("window-1", view, { ...full, width: 540 });
  await w.tick();
  void w.visibility.setBounds("window-1", view, full);
  await w.tick();
  assert.deepEqual(w.steps, [
    { kind: "attach", id: 100, bounds: full },
    { kind: "attach", id: 100, bounds: { ...full, width: 540 } },
    { kind: "attach", id: 100, bounds: full },
  ]);
  w.zoom.set("window-1", 1.25);
  void w.visibility.setBounds("window-1", view, {
    x: 0,
    y: 32,
    width: 400,
    height: 400,
  });
  await w.tick();
  assert.deepEqual(w.shown.get(100), { x: 0, y: 40, width: 500, height: 500 });
});

test("shell/app-frame#R28: 숨기거나 닫은 view가 focus를 가졌으면 shell로 돌리고 다른 view의 focus는 건드리지 않는다", async () => {
  const w = world();
  const left = await w.open(APP_A);
  const right = await w.open(APP_B);
  void w.visibility.setBounds("window-1", left, LEFT);
  void w.visibility.setBounds("window-1", right, RIGHT);
  await w.tick();
  w.focus(101);
  w.visibility.hide("window-1", [left]);
  assert.equal(w.focused(), 101);
  assert.equal(w.steps.some((step) => step.kind === "focus-shell"), false);
  w.visibility.hide("window-1", [right]);
  assert.equal(w.focused(), undefined);
  void w.visibility.setBounds("window-1", left, LEFT);
  await w.tick();
  w.focus(100);
  w.visibility.close("window-1", left);
  assert.deepEqual(w.steps.filter((step) => step.kind === "focus-shell"), [
    { kind: "focus-shell", window: "window-1" },
    { kind: "focus-shell", window: "window-1" },
  ]);
});

test("shell/app-frame#R27: 다른 창의 view는 없는 view와 같은 답이고 숨김 묶음에 하나라도 섞이면 아무것도 하지 않는다", async () => {
  const w = world();
  const mine = await w.open(APP_A, "window-1");
  const other = await w.open(APP_B, "window-2");
  void w.visibility.setBounds("window-1", mine, LEFT);
  void w.visibility.setBounds("window-2", other, LEFT);
  await w.tick();
  const notOpen = {
    ok: false,
    error: { code: "invalid_input", message: "view is not open" },
  };
  assert.deepEqual(
    await w.visibility.setBounds("window-1", other, RIGHT),
    notOpen,
  );
  assert.deepEqual(w.visibility.hide("window-1", [mine, other]), notOpen);
  assert.deepEqual(w.visibility.close("window-1", other), notOpen);
  assert.deepEqual(w.visibility.hide("window-1", ["view-404"]), notOpen);
  assert.deepEqual([...w.shown.keys()], [100, 101]);
});

test("apps/agent-context#R2, apps/agent-context#R5: 폐기하거나 다른 앱으로 교체한 view만 그 앱에서 닫혔다고 알린다", async () => {
  const w = world();
  const view = await w.open(APP_A);
  const input = (app: string) => ({
    app,
    mode: "live",
    release: REL,
    screen: "main",
    size: "panel",
    parentWindow: "window-1",
    bounds: LEFT,
  });
  // 같은 앱의 교체는 같은 view_session이 그 runtime에서 이어진다.
  assert.equal((await w.frame.replace(view, input(APP_A))).ok, true);
  assert.deepEqual(w.closed, []);
  assert.equal((await w.frame.replace(view, input(APP_B))).ok, true);
  assert.deepEqual(w.closed, [{
    app: APP_A,
    mode: "live",
    release: REL,
    view_session: view,
  }]);
  w.visibility.close("window-1", view);
  assert.deepEqual(w.closed.at(-1), {
    app: APP_B,
    mode: "live",
    release: REL,
    view_session: view,
  });
  // 창이 닫혀 폐기된 view도 알린다.
  const other = await w.open(APP_A, "window-2");
  const closed: ClosedView[] = w.closed;
  const before = closed.length;
  w.visibility.closeWindow("window-2");
  w.frame.closeWindow("window-2");
  assert.deepEqual(closed.slice(before).map((view) => view.view_session), [
    other,
  ]);
});
