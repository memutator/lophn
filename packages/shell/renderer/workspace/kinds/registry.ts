// 탭 kind registry. kind를 더하려면 kinds/<kind>.ts(x)를 쓰고 아래 목록에 한 줄을 더한다.
// 탭 줄·layout map·칸은 이 목록을 돈다. 새 탭(+) menu의 항목은 이 목록이 아니라
// add-tab-menu.tsx가 정한다.
import { t } from "@lophn/wording";

import { agentKind } from "./agent.tsx";
import { agentsKind } from "./agents.tsx";
import { appPanelKind } from "./app-panel.tsx";
import { contextKind } from "./context.tsx";
import { contextsKind } from "./contexts.tsx";
import { documentEditorKind } from "./document-editor.tsx";
import type { TabKindDef } from "./kind.ts";
import { searchKind } from "./search.tsx";
import { terminalKind } from "./terminal.tsx";

const BUILT_IN_TAB_KINDS = [
  documentEditorKind,
  appPanelKind,
  terminalKind,
  contextsKind,
  contextKind,
  searchKind,
  agentsKind,
  agentKind,
] as const;

const kinds = new Map<string, TabKindDef>();

/**
 * kind를 registry에 올린다. 같은 이름이 이미 있으면 거절한다. 돌려주는 함수로 내린다 — 기본
 * kind는 아래에서 올리고, 이 함수는 테스트가 가짜 kind를 끼울 때도 쓴다.
 */
function registerTabKind(kind: TabKindDef): () => void {
  if (kinds.has(kind.kind)) {
    throw new Error(`tab kind already registered: ${kind.kind}`);
  }
  kinds.set(kind.kind, kind);
  return () => {
    if (kinds.get(kind.kind) === kind) kinds.delete(kind.kind);
  };
}

for (const kind of BUILT_IN_TAB_KINDS) registerTabKind(kind);

export function tabKindOf(kind: unknown): TabKindDef | undefined {
  return typeof kind === "string" ? kinds.get(kind) : undefined;
}

/** 팔레트 탭 행이 쓰는 종류 글자. 모르는 kind는 빈 글자다. */
export function tabKindLabel(kind: string): string {
  const def = tabKindOf(kind);
  return def === undefined ? "" : t(def.labelKey);
}
