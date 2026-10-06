// `appFrame.open`의 입력 검사. contracts#T38 appFrameOpenSchema와 같은 검사를 main tsc 안에서
// 한다(shell main은 contracts package를 import하지 않는다). 모르는 field도 거절한다.
import type { ConnectTarget, ScreenSize, ViewMode } from "./app-connection.ts";

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppFrameOpen {
  app: string;
  mode: ViewMode;
  release: string | null;
  screen: string;
  size: ScreenSize;
  parentWindow: string;
  bounds: ViewBounds;
}

const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const RELEASE_ID = /^rel_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const SIZES: readonly string[] = ["full", "panel", "card"];
const MODES: readonly string[] = ["live", "preview"];
const SAFE_TEXT = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 &&
  !/\p{Cc}/u.test(value);

export function boundsValid(value: unknown): value is ViewBounds {
  if (typeof value !== "object" || value === null) return false;
  const bounds = value as Record<string, unknown>;
  const keys = Object.keys(bounds).sort().join(",");
  return keys === "height,width,x,y" &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger) &&
    (bounds.width as number) >= 0 && (bounds.height as number) >= 0;
}

/** 넓이가 없는 bounds다. 붙일 자리가 없으니 보이지 않는 view로 둔다. */
export function boundsEmpty(bounds: ViewBounds): boolean {
  return bounds.width <= 0 || bounds.height <= 0;
}

export function checkOpen(value: unknown): AppFrameOpen | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(",");
  if (keys !== "app,bounds,mode,parentWindow,release,screen,size") return;
  if (
    typeof input.app !== "string" || !APP_ID.test(input.app) ||
    !MODES.includes(input.mode as string) ||
    !(input.release === null ||
      (typeof input.release === "string" && RELEASE_ID.test(input.release))) ||
    (input.mode === "live" && input.release === null) ||
    !SAFE_TEXT(input.screen) || !SIZES.includes(input.size as string) ||
    !SAFE_TEXT(input.parentWindow) || !boundsValid(input.bounds)
  ) {
    return undefined;
  }
  return input as unknown as AppFrameOpen;
}

export function targetOf(input: AppFrameOpen): ConnectTarget {
  return {
    app: input.app,
    mode: input.mode,
    release: input.release,
    screen: input.screen,
    size: input.size,
  };
}
