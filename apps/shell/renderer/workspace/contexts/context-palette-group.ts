// 상단 검색(Ctrl+K) 팔레트의 "Contexts" 묶음(shell/workspace#R31). context 이름이 후보가 되고
// 고르면 그 Context 탭을 연다. 팔레트 자체는 design의 Palette이고 이 함수가 그 항목을 만든다.
// 구현은 ctx-I52.
import type { PaletteItem } from "@lophn/design/components";

import type { ContextListItem } from "./source.ts";

/** 항목 id는 `context:<ctx ID>`다. 호출자가 이 id로 어떤 context를 열지 안다. */
export const CONTEXT_PALETTE_PREFIX = "context:";

export function contextPaletteItems(
  _contexts: readonly ContextListItem[],
): readonly PaletteItem[] {
  return [];
}
