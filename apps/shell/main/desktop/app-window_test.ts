import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AppWindowConfig,
  type AppWindowDeps,
  type AppWindowSurface,
  createAppWindows,
} from "./app-window.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const RELEASE = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";

function fakeDeps(overrides: Partial<AppWindowDeps> = {}) {
  const configs: AppWindowConfig[] = [];
  const surfaces: (AppWindowSurface & {
    resize(): void;
    closeByPerson(): void;
    revealed: number;
    closed: boolean;
    width: number;
  })[] = [];
  const opens: unknown[] = [];
  const bounds: unknown[] = [];
  const closedWindows: string[] = [];
  const deps: AppWindowDeps = {
    readApp: () =>
      Promise.resolve({
        ok: true,
        value: {
          app: {
            id: APP,
            name: "Notes",
            status: "active",
            active_release: RELEASE,
            source_path: "/home/person/apps/notes",
          },
        },
      }),
    entryScreen: (_app, release) =>
      Promise.resolve(
        release === RELEASE
          ? { ok: true, value: "main" }
          : { ok: false, error: { code: "unavailable", message: "x" } },
      ),
    create(config) {
      configs.push(config);
      let onResize = () => {};
      let onClosed = () => {};
      const surface = {
        ref: `window-${surfaces.length + 10}`,
        width: 960,
        revealed: 0,
        closed: false,
        body: () => ({ x: 0, y: 0, width: surface.width, height: 600 }),
        onResize: (listener: () => void) => void (onResize = listener),
        onClosed: (listener: () => void) => void (onClosed = listener),
        reveal: () => void surface.revealed++,
        close: () => void (surface.closed = true),
        resize: () => onResize(),
        closeByPerson: () => onClosed(),
      };
      surfaces.push(surface);
      return surface;
    },
    frame: {
      open: (value) => {
        opens.push(value);
        return Promise.resolve({
          ok: true,
          value: {
            view_session: "view-1",
            generation: 1,
            app: APP,
            release: RELEASE,
            mode: "live",
            screen: "main",
            size: "full",
            connection: "running",
          },
        } as never);
      },
      setBounds: (view_session, value) => {
        bounds.push([view_session, value]);
        return { ok: true, value: { generation: 1 } };
      },
      closeWindow: (ref) => void closedWindows.push(ref),
    },
    packaged: true,
    log: () => {},
    ...overrides,
  };
  return { deps, configs, surfaces, opens, bounds, closedWindows };
}

test("shell/desktop#R13: 앱 전용 창은 채택된 release의 screen을 live로 창 본문 전체에 열고 preload 없는 창이다", async () => {
  const fake = fakeDeps();
  const windows = createAppWindows(fake.deps);
  const opened = await windows.open(APP);
  assert.ok(opened.ok);
  assert.equal(opened.value.window, "window-10");
  assert.deepEqual(fake.opens, [{
    app: APP,
    mode: "live",
    release: RELEASE,
    screen: "main",
    size: "full",
    parentWindow: "window-10",
    bounds: { x: 0, y: 0, width: 960, height: 600 },
  }]);
  const config = fake.configs[0]!;
  assert.equal(config.title, "Notes — lophn");
  assert.equal(config.show, false);
  assert.equal("preload" in config.webPreferences, false);
  assert.equal(config.webPreferences.sandbox, true);
  assert.equal(config.webPreferences.contextIsolation, true);
  assert.equal(config.webPreferences.nodeIntegration, false);
  assert.equal(fake.surfaces[0]!.revealed, 1);

  // 창 크기가 바뀌면 view도 본문 전체로 맞춘다.
  fake.surfaces[0]!.width = 1200;
  fake.surfaces[0]!.resize();
  assert.deepEqual(fake.bounds, [[
    "view-1",
    { x: 0, y: 0, width: 1200, height: 600 },
  ]]);
});

test("shell/desktop#R14: 같은 앱을 다시 열면 새 창 없이 그 창을 앞으로 가져오고 닫힌 뒤에는 새로 연다", async () => {
  const fake = fakeDeps();
  const windows = createAppWindows(fake.deps);
  const [first, second] = await Promise.all([
    windows.open(APP),
    windows.open(APP),
  ]);
  assert.ok(first.ok && second.ok);
  assert.equal(fake.surfaces.length, 1);
  await windows.open(APP);
  assert.equal(fake.surfaces.length, 1);
  assert.equal(fake.surfaces[0]!.revealed, 2);
  fake.surfaces[0]!.closeByPerson();
  assert.deepEqual(fake.closedWindows, ["window-10"]);
  await windows.open(APP);
  assert.equal(fake.surfaces.length, 2);
});

test("shell/desktop#R14: 보관됐거나 release가 없거나 view를 열지 못한 앱은 창을 남기지 않는다", async () => {
  for (
    const app of [
      { status: "archived", active_release: RELEASE },
      { status: "active", active_release: null },
    ]
  ) {
    const fake = fakeDeps({
      readApp: () =>
        Promise.resolve({
          ok: true,
          value: { app: { id: APP, name: "Notes", ...app } },
        }),
    });
    const opened = await createAppWindows(fake.deps).open(APP);
    assert.deepEqual(opened, {
      ok: false,
      error: { code: "unavailable", message: "app is not available" },
    });
    assert.equal(fake.surfaces.length, 0);
  }
  const missing = fakeDeps({
    readApp: () =>
      Promise.resolve({
        ok: false,
        error: { code: "not_found", message: "app not found" },
      }),
  });
  assert.equal((await createAppWindows(missing.deps).open(APP)).ok, false);
  assert.equal(missing.surfaces.length, 0);

  const refused = fakeDeps();
  refused.deps.frame.open = () =>
    Promise.resolve({
      ok: false,
      error: { code: "forbidden", message: "screen size is not open" },
    });
  const opened = await createAppWindows(refused.deps).open(APP);
  assert.equal(opened.ok, false);
  assert.equal(refused.surfaces[0]!.closed, true);
  assert.equal(refused.surfaces[0]!.revealed, 0);
});
