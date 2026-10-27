import { tokens } from "../../tokens.ts";

export type ControlSize = "sm" | "md" | "lg";
export type IconSize = keyof typeof tokens.icon.size;

// Lucide는 숫자 px를 받는다. token 문자열을 그대로 읽어 임의 값을 만들지 않는다.
export function pixels(value: string): number {
  return Number.parseFloat(value);
}

export function milliseconds(value: string): number {
  return Number.parseFloat(value);
}

export function iconPixels(size: IconSize): number {
  return pixels(tokens.icon.size[size]);
}

export function controlIconPixels(size: ControlSize): number {
  return pixels(tokens.control[size].icon);
}

// annotation이 가리킨 요소에서 "어느 SDK component인가"를 읽는 표시. 읽는 쪽은 이 속성 하나만 본다.
// 호출자의 `...rest`가 덮지 못하도록 root 요소의 `{...rest}` 뒤에 둔다.
export function componentMark(name: string): {
  "data-lophn-component": string;
} {
  return { "data-lophn-component": name };
}

export function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

// loading 지연을 테스트가 바꿔 끼우도록 timer는 인자로 받는다. handle은 환경마다 달라 열어 보지 않는다.
export interface Timer {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const systemTimer: Timer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// toast 남은 시간을 재는 현재 시각(ms). 테스트가 timer와 같은 시계로 바꿔 끼운다.
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

// 개발자 ID와 code 복사는 OS clipboard를 쓴다. 테스트가 바꿔 끼우도록 인자로 받는다.
export interface Clipboard {
  writeText(text: string): Promise<void>;
}

export const systemClipboard: Clipboard = {
  writeText: (text) => navigator.clipboard.writeText(text),
};

// beside: trigger 옆에 간격을 두고 화면 안으로 뒤집으며, 창 가장자리에서도 같은 간격을 띄운다. corner: trigger의
// 왼쪽 아래 꼭짓점에서 간격·뒤집기 없이 그린다. overlay view는 표면 rect 왼쪽 위에 크기 없는 anchor를 두어 native
// rect 안에 그린다.
export type Placement = "beside" | "corner";

export function placementProps(placement: Placement) {
  return placement === "corner"
    ? ({ align: "start", sideOffset: 0, avoidCollisions: false } as const)
    : ({
        align: "start",
        sideOffset: pixels(tokens.space[2]),
        collisionPadding: pixels(tokens.space[2]),
      } as const);
}
