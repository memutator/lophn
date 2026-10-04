import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { appScreenRequestSchema } from "../apps/channel.ts";
import {
  APP_FRAME_ERRORS,
  APP_FRAME_IPC,
  APP_FRAME_PUSH,
  appFrameCloseSchema,
  appFrameOpenSchema,
  appFrameReplaceSchema,
  appFrameViewStateSchema,
  appHostLabel,
  appViewUrlSchema,
  documentHostLabel,
  documentPartition,
  documentViewUrlSchema,
  livePartition,
  type LophnShellViews,
  previewPartition,
  SHELL_PARTITION,
  VIEW_CONNECTION_STATES,
  VIEW_SCHEMES,
  viewBoundsSchema,
} from "./app-frame.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const HASH = "ab".repeat(32);

const bounds = { x: 0, y: 48, width: 800, height: 600 };

const open = {
  app: APP,
  mode: "live" as const,
  release: REL,
  screen: "usage",
  size: "full" as const,
  parentWindow: "win-1",
  bounds,
};

Deno.test(
  "shell/app-frame#R22: open·replace·close와 출력은 같은 view 식별을 쓰고 AppScreenRequest 이름을 재사용한다",
  () => {
    const opened = appFrameOpenSchema.parse(open);
    assertEquals(opened.screen, "usage");
    const screen = appScreenRequestSchema.parse({
      screen: opened.screen,
      size: opened.size,
      view_session: "view-1",
    });
    assertEquals(screen.view_session, "view-1");
    const replaced = appFrameReplaceSchema.parse({
      view_session: "view-1",
      target: { ...open, size: "panel" },
    });
    assertEquals(replaced.target.size, "panel");
    assert(appFrameCloseSchema.safeParse({ view_session: "view-1" }).success);
    const state = appFrameViewStateSchema.parse({
      view_session: "view-1",
      app: APP,
      release: REL,
      mode: "live",
      screen: "usage",
      size: "full",
      connectionState: "running",
    });
    assertEquals(state.connectionState, "running");
    assertEquals([...VIEW_CONNECTION_STATES], [
      "preparing",
      "stopped",
      "running",
      "unavailable",
    ]);
    for (const code of APP_FRAME_ERRORS) assert(ERROR_CODES.includes(code));
  },
);

Deno.test(
  "shell/app-frame#R12, shell/app-frame#R22: 열기 입력은 모르는 field와 틀린 ID 접두사를 거절한다",
  () => {
    assert(!appFrameOpenSchema.safeParse({ ...open, actor: "user" }).success);
    assert(
      !appFrameOpenSchema.safeParse({
        ...open,
        app: "rel_01arz3ndektsv4rrffq69g5fav",
      }).success,
    );
    assert(
      !appFrameOpenSchema.safeParse({
        ...open,
        release: "app_01arz3ndektsv4rrffq69g5fav",
      }).success,
    );
    assert(!appFrameOpenSchema.safeParse({ ...open, release: null }).success);
    assert(
      appFrameOpenSchema.safeParse({ ...open, mode: "preview", release: null })
        .success,
    );
    assert(
      !appFrameReplaceSchema.safeParse({
        view_session: "view-1",
        target: open,
        claimed_app: APP,
      }).success,
    );
    assert(
      !viewBoundsSchema.safeParse({ x: 1.5, y: 0, width: 10, height: 10 })
        .success,
    );
  },
);

Deno.test(
  "shell/app-frame#R1, shell/app-frame#R8, shell/app-frame#R11, shell/app-frame#R33: scheme·host label·partition은 앱과 문서 판을 나눈다",
  () => {
    assertEquals([...VIEW_SCHEMES], [
      "lophn-shell",
      "lophn-app",
      "lophn-document",
    ]);
    const appUrl = `lophn-app://${appHostLabel(APP)}/usage`;
    assert(appViewUrlSchema.safeParse(appUrl).success);
    assert(!appViewUrlSchema.safeParse(`lophn-app://${APP}/usage`).success);
    assert(
      !appViewUrlSchema.safeParse(`lophn-app://APP-${APP.slice(4)}/usage`)
        .success,
    );
    const documentUrl = `lophn-document://${documentHostLabel(VER)}/body`;
    assert(documentViewUrlSchema.safeParse(documentUrl).success);
    assert(
      !documentViewUrlSchema.safeParse(`lophn-document://${VER}/body`).success,
    );
    assertEquals(livePartition(APP), `persist:app-${APP}:live`);
    assertEquals(
      previewPartition(APP, HASH),
      `persist:app-${APP}:preview-${HASH}`,
    );
    assert(livePartition(APP) !== previewPartition(APP, HASH));
    assertEquals(SHELL_PARTITION, "persist:shell");
    assert(
      documentPartition(VER, "view-1").startsWith(`document-${VER}-`),
    );
  },
);

Deno.test(
  "shell/app-frame#R13, shell/app-frame#R14, shell/app-frame#R34: preload IPC는 열기·bounds·숨김·닫기와 상태 push만 받는다",
  () => {
    assertEquals(Object.keys(APP_FRAME_IPC), [
      "shell:view-open-app",
      "shell:view-open-document",
      "shell:view-bounds",
      "shell:views-hidden",
      "shell:view-close",
    ]);
    assertEquals(Object.keys(APP_FRAME_PUSH), ["shell:view-state"]);
    const views: LophnShellViews = {
      openApp: () => Promise.reject(new Error("x")),
      openDocumentView: () => Promise.reject(new Error("x")),
      setViewBounds: () => Promise.reject(new Error("x")),
      setViewsHidden: () => Promise.reject(new Error("x")),
      closeView: () => Promise.reject(new Error("x")),
    };
    assertEquals(Object.keys(views), [
      "openApp",
      "openDocumentView",
      "setViewBounds",
      "setViewsHidden",
      "closeView",
    ]);
    assert(
      APP_FRAME_IPC["shell:view-open-app"].safeParse({
        app: APP,
        mode: "preview",
        screen: "usage",
        size: "card",
      }).success,
    );
    assert(
      !APP_FRAME_IPC["shell:view-open-app"].safeParse({
        app: APP,
        mode: "live",
        screen: "usage",
        size: "full",
        token: "secret",
      }).success,
    );
    assert(
      !APP_FRAME_IPC["shell:view-open-document"].safeParse({
        version: "doc_01arz3ndektsv4rrffq69g5fav",
      }).success,
    );
    assert(
      APP_FRAME_IPC["shell:view-bounds"].safeParse({
        view_session: "view-1",
        bounds,
      }).success,
    );
    assert(
      !APP_FRAME_IPC["shell:views-hidden"].safeParse({ view_sessions: [] })
        .success,
    );
  },
);
