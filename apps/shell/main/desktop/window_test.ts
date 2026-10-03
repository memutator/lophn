import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OPEN_APP_ARG,
  startSingleInstance,
  windowIntents,
} from "./single-instance.ts";
import { browserDataPath, resolveDataRoot } from "./paths.ts";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  TOP_BAR_HEIGHT,
  TRAFFIC_LIGHT_WIDTH,
  WINDOW_CONTROLS_WIDTH,
  windowConfig,
  windowTitle,
} from "./window.ts";

test("shell/desktop#R11: 같은 데이터 root의 두 번째 시작은 lock을 못 갖고 종료한다", () => {
  const locks: string[] = [];
  let quit = false;
  const result = startSingleInstance({
    dataRoot: "/home/data",
    onOpenApp: () => {},
    app: {
      requestSingleInstanceLock: (data) => {
        locks.push(data.dataRoot);
        return false;
      },
      quit: () => {
        quit = true;
      },
      on: () => {},
    },
  });
  assert.equal(result.acquired, false);
  assert.deepEqual(locks, ["/home/data"]);
  assert.equal(quit, true);
});

test("shell/desktop#R12: 두 번째 시작은 등록된 창 열기 intent만 넘기고 URL·파일·명령은 버린다", () => {
  const opened: string[] = [];
  let fire: ((...args: unknown[]) => void) | undefined;
  startSingleInstance({
    dataRoot: "/home/data",
    onOpenApp: () => opened.push("open-app"),
    app: {
      requestSingleInstanceLock: () => true,
      quit: () => {},
      on: (_event, fn) => {
        fire = fn;
      },
    },
  });
  fire?.({}, [
    "lophn",
    OPEN_APP_ARG,
    "https://evil.example/steal",
    "/etc/passwd",
    "--quit",
    "--tray",
    "rm -rf",
  ]);
  assert.deepEqual(opened, ["open-app"]);
  assert.deepEqual(
    windowIntents(["file.txt", "--tray", "--quit", "lophn://x"]),
    [],
  );
});

test("shell/desktop#R15: userData는 session 전에 데이터 root의 shell/browser로 잡는다", () => {
  const order: string[] = [];
  const root = resolveDataRoot({ LOPHN_HOME: "/data/root" }, "/unused");
  const set = (name: string) => {
    order.push(`userData:${name}`);
  };
  set(browserDataPath(root));
  order.push("session");
  assert.deepEqual(order, ["userData:/data/root/shell/browser", "session"]);
  assert.equal(resolveDataRoot({}, "/home/person"), "/home/person/.lophn");
});

test("shell/desktop#R22: 최소 창은 960×600px이다", () => {
  const config = windowConfig({
    platform: "linux",
    packaged: false,
    spaceName: "Launcher",
    preload: "preload.js",
  });
  assert.equal(config.minWidth, MIN_WINDOW_WIDTH);
  assert.equal(config.minHeight, MIN_WINDOW_HEIGHT);
  assert.equal(MIN_WINDOW_WIDTH, 960);
  assert.equal(MIN_WINDOW_HEIGHT, 600);
});

test("shell/desktop#R23: 시스템 제목 표시줄이 없고 OS별 창 조작 자리를 비운다", () => {
  const mac = windowConfig({
    platform: "darwin",
    packaged: false,
    spaceName: "Launcher",
    preload: "preload.js",
  });
  assert.equal(mac.frame, false);
  assert.deepEqual(mac.trafficLightPosition, { x: 16, y: 16 });
  assert.equal(TRAFFIC_LIGHT_WIDTH, 80);
  assert.equal(mac.titleBarOverlay, undefined);

  const linux = windowConfig({
    platform: "linux",
    packaged: true,
    spaceName: "Launcher",
    preload: "preload.js",
  });
  assert.equal(linux.frame, false);
  assert.equal(linux.titleBarOverlay?.height, TOP_BAR_HEIGHT);
  assert.equal(WINDOW_CONTROLS_WIDTH, 138);
  assert.equal(linux.trafficLightPosition, undefined);
});

test("shell/desktop#R24: 창 제목은 main이 아는 공간 이름 뒤에 — lophn을 붙인다", () => {
  assert.equal(windowTitle("Launcher"), "Launcher — lophn");
  assert.equal(
    windowConfig({
      platform: "linux",
      packaged: false,
      spaceName: "Docs",
      preload: "p.js",
    }).title,
    "Docs — lophn",
  );
});
