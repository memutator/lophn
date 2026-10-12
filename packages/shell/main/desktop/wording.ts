// main이 OS에 그리는 고정 문구(tray menu, 끄기 확인). 값은 packages/design의 en
// catalog에서만 읽는다. main은 ICU formatter를 묶지 않으므로 placeholder 없는 key만 받는다.
import { en, type MessageKey } from "../../../design/wording/en.ts";
import type { PlaceholderKinds } from "../../../design/wording/placeholders.ts";

/** placeholder가 없는 key. 이 key의 en 값은 그대로 완성된 문구다. */
export type PlainKey = {
  [K in MessageKey]: [keyof PlaceholderKinds[K]] extends [never] ? K : never;
}[MessageKey];

export function word(key: PlainKey): string {
  return en[key];
}
