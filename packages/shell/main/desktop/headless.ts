// 개발 확인 전용 headless 실행. main만 env를 읽고, 창·view를 만드는 자리는 모두
// surfaceOptions로 옵션을 거르고 reveal로 앞에 띄운다. 변수가 없으면 옵션과 동작은
// 그대로다. renderer는 이 값을 받지 않는다(sandbox preload는 process.env를 못 본다).
import { join } from "node:path";

import type { GlobalShortcutPort } from "./global-shortcut.ts";

export interface HeadlessMode {
  readonly headless: boolean;
  /** 있으면 창마다 첫 paint와 안정된 뒤 paint를 PNG로 쓴다. */
  readonly shotDir?: string;
}

export const SHELL_OFF: HeadlessMode = { headless: false };

/** `LOPHN_SHELL_HEADLESS=1`일 때만 켠다. shot dir은 headless일 때만 본다. */
export function readHeadless(
  env: Readonly<Record<string, string | undefined>>,
): HeadlessMode {
  if (env.LOPHN_SHELL_HEADLESS !== "1") return SHELL_OFF;
  const shotDir = env.LOPHN_SHELL_SHOT_DIR;
  return {
    headless: true,
    ...(shotDir ? { shotDir } : {}),
  };
}

interface SurfaceConfig {
  show?: boolean;
  webPreferences: object;
}

/** headless면 `show: false`와 `offscreen: true`를 덮는다. 아니면 config를 그대로 돌려준다. */
export function surfaceOptions<T extends SurfaceConfig>(
  config: T,
  mode: HeadlessMode,
): T {
  if (!mode.headless) return config;
  // Electron 옵션 타입은 offscreen을 받는다. 우리 config 타입에는 없어 여기서만 넓힌다.
  return {
    ...config,
    show: false,
    webPreferences: { ...config.webPreferences, offscreen: true },
  } as T;
}

interface Revealable {
  show(): void;
  focus(): void;
  isMinimized?(): boolean;
  restore?(): void;
}

/** 창을 앞으로 가져온다. headless면 아무것도 하지 않는다. */
export function reveal(window: Revealable, mode: HeadlessMode): void {
  if (mode.headless) return;
  if (window.isMinimized?.()) window.restore?.();
  window.show();
  window.focus();
}

/** 창을 focus 없이 보인다. 이미 보이는 창은 앞으로 오지 않는다. headless면 아무것도 하지 않는다. */
export function revealInactive(
  window: { showInactive(): void },
  mode: HeadlessMode,
): void {
  if (mode.headless) return;
  window.showInactive();
}

/** focus만 옮기는 자리. headless면 아무것도 하지 않는다. */
export function focusSurface(
  target: { focus(): void },
  mode: HeadlessMode,
): void {
  if (!mode.headless) target.focus();
}

/**
 * OS 전역 단축키 adapter를 거른다. headless는 사람 장치의 OS에 아무 key도 등록하지 않는다.
 * 등록은 실패로 답해 전역 팔레트가 사용 불가가 되고, 다른 key도 차지하지 않는다.
 */
export function guardShortcuts(
  real: GlobalShortcutPort,
  mode: HeadlessMode,
  log: (message: string) => void,
): GlobalShortcutPort {
  if (!mode.headless) return real;
  return {
    register(accelerator) {
      log(`headless global-shortcut ${accelerator} not registered`);
      return false;
    },
    unregister() {},
  };
}

interface PaintImage {
  isEmpty(): boolean;
  toPNG(): Uint8Array;
}

interface PaintSource {
  on(
    event: "paint",
    listener: (event: unknown, dirty: unknown, image: PaintImage) => void,
  ): void;
}

interface ShotDeps {
  write(path: string, data: Uint8Array): void;
  timer: {
    set(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}

/** 마지막 paint 뒤 이만큼 조용하면 안정된 것으로 본다. */
const SETTLE_MS = 1500;

/**
 * offscreen `paint`로 screenshot을 쓴다. offscreen에서는 capturePage()가 실패한다.
 * `<name>-first.png`는 처음 비지 않은 paint, `<name>-settled.png`는 paint가
 * SETTLE_MS 동안 멈춘 뒤의 마지막 그림이다(다시 그려지면 덮어쓴다).
 */
export function capturePaints(
  source: PaintSource,
  name: string,
  mode: HeadlessMode,
  deps: ShotDeps,
): void {
  const dir = mode.headless ? mode.shotDir : undefined;
  if (dir === undefined) return;
  let first = false;
  let latest: PaintImage | undefined;
  let pending: unknown;
  source.on("paint", (_event, _dirty, image) => {
    if (image.isEmpty()) return;
    latest = image;
    if (!first) {
      first = true;
      deps.write(join(dir, `${name}-first.png`), image.toPNG());
    }
    if (pending !== undefined) deps.timer.clear(pending);
    pending = deps.timer.set(() => {
      pending = undefined;
      if (latest) deps.write(join(dir, `${name}-settled.png`), latest.toPNG());
    }, SETTLE_MS);
  });
}
