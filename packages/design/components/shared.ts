import { tokens } from "../tokens.ts";

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

// 개발자 ID와 code 복사는 OS clipboard를 쓴다. 테스트가 바꿔 끼우도록 인자로 받는다.
export interface Clipboard {
  writeText(text: string): Promise<void>;
}

export const systemClipboard: Clipboard = {
  writeText: (text) => navigator.clipboard.writeText(text),
};
