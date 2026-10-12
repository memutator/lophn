// 상단 검색(Ctrl+K) 팔레트의 "Contexts" 묶음. context 이름이 후보가 되고
// 고르면 그 Context 탭을 연다. 팔레트 자체는 design의 Palette이고 이 함수가 그 항목을 만든다.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 이 파일은 아래 key만 t()로 쓴다:
//   contexts.label.palette-detail
//   common.heading.palette-contexts
// 묶음 이름은 common.heading.palette-contexts다.
import type { PaletteItem } from "@lophn/design/components";
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { ContextListItem } from "./source.ts";

/** 항목 id는 `context:<ctx ID>`다. 호출자가 이 id로 어떤 context를 열지 안다. */
export const CONTEXT_PALETTE_PREFIX = "context:";

/** 목록 순서를 그대로 따라 context마다 항목 하나를 만든다. */
export function contextPaletteItems(
  contexts: readonly ContextListItem[],
): readonly PaletteItem[] {
  return contexts.map((context) => ({
    id: `${CONTEXT_PALETTE_PREFIX}${context.id}`,
    label: context.title,
    group: t("common.heading.palette-contexts"),
    detail: t("contexts.label.palette-detail"),
    icon: workspaceIcons.context,
  }));
}
