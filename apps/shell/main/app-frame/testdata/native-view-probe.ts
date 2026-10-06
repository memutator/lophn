// e2e/shell/native-view_test.ts가 build해 띄우는 Electron main. 실제 shell과 같은 app-frame
// 조립(scheme 등록, electron adapter, registry, visibility)으로 앱 view를 실제 창 contentView에
// 붙인다. core 앱 통로만 가짜 connector이고 앱 화면은 테스트가 Unix socket에 띄운 가짜 앱이
// 내준다. 창은 화면에 띄우지 않는다(show:false·offscreen). 붙이기·떼기마다 창의 실제 child
// view와 bounds를 적어 겹친 frame이 있었는지 본다. 결과는 JSON 파일 하나로 쓰고 끝난다.
import {
  app,
  BrowserWindow,
  protocol,
  type View,
  WebContentsView,
} from "electron";
import { writeFileSync } from "node:fs";

import { registerViewSchemes } from "../../desktop/security.ts";
import { TOP_BAR_HEIGHT } from "../../desktop/window.ts";
import { nodeUpstream } from "../app-protocol.ts";
import { createViewDiagnostics } from "../diagnostics.ts";
import { electronAppViews } from "../electron-app-frame.ts";
import { createAppFrame, type ViewBounds } from "../registry.ts";
import { createViewVisibility, intersect } from "../visibility.ts";

interface ProbeConfig {
  userData: string;
  result: string;
  preload: string;
  release: string;
  /** app ID → 가짜 앱 socket. */
  sockets: Record<string, string>;
}

const config = JSON.parse(
  process.env.LOPHN_NATIVE_VIEW ?? "{}",
) as ProbeConfig;

registerViewSchemes(protocol);
app.setPath("userData", config.userData);

interface Shown {
  id: number;
  bounds: ViewBounds;
}

interface Snapshot {
  step: string;
  shown: Shown[];
  overlayOnTop: boolean;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(
  what: string,
  check: () => boolean,
  state: () => unknown,
  ms = 10_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out: ${what} ${JSON.stringify(state())}`);
    }
    await wait(10);
  }
}

async function run(): Promise<unknown> {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 760,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  // shell overlay view 자리. 떠 있는 UI와 경계 drag pointer를 받는 맨 위 층이다.
  const overlay = new WebContentsView({ webPreferences: { offscreen: true } });
  window.contentView.addChildView(overlay);
  overlay.setBounds({ x: 0, y: TOP_BAR_HEIGHT, width: 1000, height: 712 });
  const appViews = (): View[] =>
    window.contentView.children.filter((child) => child !== overlay);
  const idOf = (view: View) => (view as WebContentsView).webContents.id;

  const timeline: Snapshot[] = [];
  const overlaps: string[] = [];
  function snapshot(step: string): void {
    const shown = appViews().map((view) => ({
      id: idOf(view),
      bounds: view.getBounds(),
    }));
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        const cross = intersect(shown[i]!.bounds, shown[j]!.bounds);
        if (cross.width > 0 && cross.height > 0) {
          overlaps.push(`${step}: ${shown[i]!.id}x${shown[j]!.id}`);
        }
      }
    }
    const children = window.contentView.children;
    timeline.push({
      step,
      shown,
      overlayOnTop: children[children.length - 1] === overlay,
    });
  }

  const adapter = electronAppViews({
    windowOf: (ref) => ref === "window-1" ? window : undefined,
    preload: config.preload,
    packaged: false,
    headless: { headless: true },
    raise: (target) => target.contentView.addChildView(overlay),
  });
  let nativeMoves = 0;
  // 첫 load가 끝나기 전에 붙인 view 수. 0이어야 한다.
  let attachedBeforeReady = 0;
  const loaded = new Set<number>();
  let serial = 0;
  const frame = createAppFrame({
    connector: {
      connect: (target) =>
        Promise.resolve({
          ok: true,
          value: {
            endpoint: config.sockets[target.app]!,
            authorization: `probe ${target.app}`,
            release: target.release,
            bundleHash: "0".repeat(64),
            processNonce: "probe",
            expiresAtMs: null,
          },
        }),
      hosts: () => Promise.resolve({ ok: true, value: [] }),
    },
    views: {
      ...adapter.views,
      create(input) {
        const contents = adapter.views.create(input);
        const load = contents.load;
        contents.load = (url) =>
          load(url).finally(() => loaded.add(contents.id));
        return contents;
      },
      attach(ref, view, bounds) {
        if (!loaded.has(view.id)) attachedBeforeReady += 1;
        const attached = adapter.views.attach(ref, view, bounds);
        nativeMoves += 1;
        snapshot(`attach ${view.id}`);
        return attached;
      },
      detach(ref, view) {
        adapter.views.detach(ref, view);
        snapshot(`detach ${view.id}`);
      },
    },
    sessionHandle: adapter.sessionHandle,
    upstream: nodeUpstream,
    platformPorts: () => [],
    diagnostics: createViewDiagnostics({
      send: () => true,
      log: () => {},
      clock: { nowIso: () => new Date().toISOString() },
    }),
    ids: {
      viewSession: () => `view-${++serial}`,
      token: () => `token-${Math.random().toString(36).slice(2)}`,
    },
    clock: { nowMs: () => Date.now() },
  });
  const visibility = createViewVisibility({
    frame,
    geometry: {
      body() {
        const [width = 0, height = 0] = window.getContentSize();
        return {
          x: 0,
          y: TOP_BAR_HEIGHT,
          width,
          height: height - TOP_BAR_HEIGHT,
        };
      },
      zoom: () => window.webContents.getZoomFactor(),
    },
    timer: {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
  });

  async function open(appId: string): Promise<string> {
    const opened = await visibility.openApp("window-1", {
      app: appId,
      mode: "live",
      release: config.release,
      screen: "main",
      size: "panel",
    });
    if (!opened.ok) throw new Error(`open failed: ${opened.error.message}`);
    return opened.value.view_session;
  }
  const shownIds = () => appViews().map(idOf);
  const boundsOf = (id: number) =>
    appViews().find((view) => idOf(view) === id)?.getBounds();
  const body = { x: 0, y: TOP_BAR_HEIGHT, width: 1000, height: 712 };
  const left = { ...body, width: 500 };
  const right = { ...body, x: 500, width: 500 };

  // 1. 프로젝트 두 칸에 두 앱 view를 동시에 붙인다.
  const a = await open(Object.keys(config.sockets)[0]!);
  const b = await open(Object.keys(config.sockets)[1]!);
  const beforeBounds = shownIds().length;
  await Promise.all([
    visibility.setBounds("window-1", a, left),
    visibility.setBounds("window-1", b, right),
  ]);
  const state = () => ({ shown: shownIds(), loaded: [...loaded], timeline });
  await until("two views", () => shownIds().length === 2, state);
  const [idA, idB] = appViews().map(idOf) as [number, number];
  const twoViews = {
    contentSize: window.getContentSize(),
    beforeBounds,
    shown: shownIds().length,
    a: boundsOf(idA),
    b: boundsOf(idB),
    loaded: [loaded.has(idA), loaded.has(idB)],
  };

  // 2. 칸 경계 drag. pointer DTO마다 bounds가 오지만 적용은 16ms마다 한 번이다.
  const dragMark = timeline.length;
  const movesBefore = nativeMoves;
  const started = Date.now();
  const pending: Promise<unknown>[] = [];
  for (let edge = 500; edge >= 300; edge -= 2) {
    pending.push(
      visibility.setBounds("window-1", a, { ...left, width: edge }),
    );
    pending.push(
      visibility.setBounds("window-1", b, {
        ...right,
        x: edge,
        width: 1000 - edge,
      }),
    );
    await wait(4);
  }
  await Promise.all(pending);
  const dragMs = Date.now() - started;
  const drag = {
    updates: 101,
    ms: dragMs,
    nativeMoves: nativeMoves - movesBefore,
    detached: timeline.slice(dragMark).some((step) =>
      step.step.startsWith("detach")
    ),
    alwaysBoth: timeline.slice(dragMark).every((step) =>
      step.shown.length === 2
    ),
    a: boundsOf(idA),
    b: boundsOf(idB),
  };

  // 3. 왼쪽 칸 탭 전환: 옛 view를 먼저 숨기고 새 view는 준비된 뒤 붙인다.
  const switchMark = timeline.length;
  visibility.hide("window-1", [a]);
  const c = await open(Object.keys(config.sockets)[2]!);
  void visibility.setBounds("window-1", c, { ...left, width: 300 });
  await until(
    "tab switch",
    () => shownIds().length === 2 && !shownIds().includes(idA),
    state,
  );
  const idC = shownIds().find((id) => id !== idB)!;
  const tabSwitch = {
    steps: timeline.slice(switchMark).map((step) => step.step),
    c: boundsOf(idC),
  };

  // 4. 좁은 창. 대화 도크(360px)가 본문 오른쪽을 덮으면 renderer가 남은 폭을 보낸다.
  visibility.hide("window-1", [c]);
  window.setContentSize(900, 700);
  await wait(50);
  const narrowBody = { x: 0, y: TOP_BAR_HEIGHT, width: 900, height: 652 };
  await visibility.setBounds("window-1", b, narrowBody);
  const narrowFull = boundsOf(idB);
  await visibility.setBounds("window-1", b, {
    ...narrowBody,
    width: 540,
  });
  const narrowCovered = boundsOf(idB);
  const coveredShown = shownIds().includes(idB);
  await visibility.setBounds("window-1", b, narrowBody);
  const narrowRestored = boundsOf(idB);
  // 창보다 큰 요청도 창 본문 밖으로 나가지 않는다.
  await visibility.setBounds("window-1", b, {
    x: 0,
    y: 0,
    width: 2000,
    height: 2000,
  });
  const clamped = boundsOf(idB);

  const overlayAlwaysOnTop = timeline.every((step) =>
    step.shown.length === 0 || step.overlayOnTop
  );
  visibility.dispose();
  frame.dispose();
  return {
    twoViews,
    drag,
    tabSwitch,
    narrow: {
      full: narrowFull,
      covered: narrowCovered,
      coveredShown,
      restored: narrowRestored,
      clamped,
    },
    overlaps,
    overlayAlwaysOnTop,
    attachedBeforeReady,
  };
}

run().then(
  (result) => {
    writeFileSync(config.result, JSON.stringify({ ok: true, result }));
    app.exit(0);
  },
  (error: unknown) => {
    writeFileSync(
      config.result,
      JSON.stringify({ ok: false, error: String(error) }),
    );
    app.exit(1);
  },
);
