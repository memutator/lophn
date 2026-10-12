import { assertEquals } from "@std/assert";

import {
  APP_FRAME_IPC,
  APP_FRAME_PUSH,
} from "../../../packages/protocol/shell/app-frame.ts";
import {
  appFrameViewStateSchema,
  appViewOpenSchema,
  VIEW_BOUNDS_CHANNEL,
  VIEW_CLOSE_CHANNEL,
  VIEW_OPEN_APP_CHANNEL,
  VIEW_STATE_CHANNEL,
  viewBoundsRequestSchema,
  viewCloseRequestSchema,
  VIEWS_HIDDEN_CHANNEL,
  viewsHiddenSchema,
} from "./app-frame.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const REL = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const CARD = { message: "msg_01j9zzzzzzzzzzzzzzzzzzzzzz", block: "usage" };

type Schema = { safeParse(value: unknown): { success: boolean } };

function same(name: string, ours: Schema, theirs: Schema, values: unknown[]) {
  for (const value of values) {
    assertEquals(
      ours.safeParse(value).success,
      theirs.safeParse(value).success,
      `${name}: ${JSON.stringify(value)}`,
    );
  }
}

Deno.test("shell/app-frame#R23: shell IPC 사본은 contracts의 view channel 이름과 받는 값·거절하는 값이 같다", () => {
  const open = {
    app: APP,
    mode: "live",
    release: REL,
    screen: "main",
    size: "panel",
  };
  same(
    VIEW_OPEN_APP_CHANNEL,
    appViewOpenSchema,
    APP_FRAME_IPC[VIEW_OPEN_APP_CHANNEL],
    [
      open,
      { ...open, release: undefined, mode: "preview" },
      { ...open, app: "app_x" },
      { ...open, size: "wide" },
      { ...open, screen: " " },
      { ...open, screen: "a\u0007" },
      { ...open, parentWindow: "window-1" },
      { ...open, size: "card", card: CARD },
      { ...open, size: "card" },
      { ...open, card: CARD },
      { ...open, size: "card", card: { ...CARD, block: "Bad Key" } },
      { ...open, size: "card", card: { ...CARD, message: "msg_x" } },
      { ...open, size: "card", card: { ...CARD, input: {} } },
    ],
  );
  const bounds = { x: 0, y: 40, width: 640, height: 600 };
  same(
    VIEW_BOUNDS_CHANNEL,
    viewBoundsRequestSchema,
    APP_FRAME_IPC[VIEW_BOUNDS_CHANNEL],
    [
      { view_session: "view-1", bounds },
      { view_session: "", bounds },
      { view_session: "view-1", bounds: { ...bounds, width: -1 } },
      { view_session: "view-1", bounds: { ...bounds, x: 0.5 } },
      { view_session: "view-1", bounds: { ...bounds, z: 1 } },
    ],
  );
  same(
    VIEWS_HIDDEN_CHANNEL,
    viewsHiddenSchema,
    APP_FRAME_IPC[VIEWS_HIDDEN_CHANNEL],
    [
      { view_sessions: ["view-1", "view-2"] },
      { view_sessions: [] },
      { view_sessions: ["view\u0000"] },
    ],
  );
  same(
    VIEW_CLOSE_CHANNEL,
    viewCloseRequestSchema,
    APP_FRAME_IPC[VIEW_CLOSE_CHANNEL],
    [
      { view_session: "view-1" },
      { view_session: "view-1", force: true },
    ],
  );
  const state = {
    view_session: "view-1",
    app: APP,
    release: REL,
    mode: "live",
    screen: "main",
    size: "full",
    connectionState: "running",
  };
  same(
    VIEW_STATE_CHANNEL,
    appFrameViewStateSchema,
    APP_FRAME_PUSH[VIEW_STATE_CHANNEL],
    [
      state,
      { ...state, release: null },
      { ...state, release: null, mode: "preview" },
      { ...state, connectionState: "paused" },
    ],
  );
});
