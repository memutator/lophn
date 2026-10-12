// 탭 kind registry. kind를 더하려면 kinds/<kind>.ts를 쓰고 아래 목록에 한 줄을 더한다.
// 타입(LayoutTab·HintTab·ViewTab)도 이 목록에서 나온다.
import type { z } from "zod";

import { agentKind } from "./agent.ts";
import { agentsKind } from "./agents.ts";
import { appPanelKind } from "./app-panel.ts";
import { contextKind } from "./context.ts";
import { contextsKind } from "./contexts.ts";
import { documentEditorKind } from "./document-editor.ts";
import { registerTabKind } from "./kind.ts";
import { searchKind } from "./search.ts";
import { terminalKind } from "./terminal.ts";

export const BUILT_IN_TAB_KINDS = [
  documentEditorKind,
  terminalKind,
  appPanelKind,
  contextsKind,
  contextKind,
  searchKind,
  agentsKind,
  agentKind,
] as const;

for (const kind of BUILT_IN_TAB_KINDS) registerTabKind(kind);

type Built = (typeof BUILT_IN_TAB_KINDS)[number];

type LayoutOf<K> = K extends { layout: z.ZodType<infer L> } ? L : never;
type HintOf<K> = K extends { hint: (...args: never[]) => infer H }
  ? NonNullable<H>
  : never;
type ViewOf<K> = K extends { view: (...args: never[]) => infer V }
  ? NonNullable<V>
  : never;

/** layout 파일의 탭. 등록된 kind의 TabLayout 합이다. */
export type LayoutTab = LayoutOf<Built>;
/** renderer 힌트의 탭. */
export type HintTab = HintOf<Built>;
/** 현재 보기의 탭. */
export type ViewTab = ViewOf<Built>;

export { registerTabKind, tabKindOf, tabKinds } from "./kind.ts";
