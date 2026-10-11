// 프로젝트 작업대의 팔레트 행. 열린 탭·문서·파일·컨텍스트·행동 순서이고(desktop#R30)
// 고르면 작업대 안의 대상(탭 고르기, 문서 탭 열기, 정보 패널 컨텍스트, 행동)으로만 간다.
import { t } from "@lophn/wording";

import { tabKindLabel, tabKindOf } from "../../workspace/kinds/registry.ts";
import type { WorkspaceView } from "../../workspace/model.ts";
import type {
  ContextRow,
  DocumentRow,
  FileRow,
} from "../../workspace/source.ts";
import type { WindowPlatform } from "../top-bar/platform.ts";
import { windowShortcutLabel } from "./labels.ts";
import {
  type DocumentFound,
  type PaletteEntry,
  WORKSPACE_GROUPS,
} from "./model.ts";
import type { PaletteScope } from "./session.ts";

export type WorkspaceAction = "launcher" | "lophn" | "terminal" | "info-panel";

export type WorkspaceTarget =
  | { readonly kind: "tab"; readonly pane: number; readonly key: string }
  | { readonly kind: "document"; readonly document: DocumentRow }
  | { readonly kind: "context"; readonly id: string }
  | { readonly kind: "action"; readonly action: WorkspaceAction };

export interface WorkspaceScopeInput {
  readonly view: WorkspaceView;
  readonly documents: readonly DocumentRow[];
  readonly files: readonly FileRow[];
  readonly contexts: readonly ContextRow[];
  /** 터미널 통로가 있을 때만 터미널 열기 행이 있다. */
  readonly terminal: boolean;
  readonly platform: WindowPlatform;
  /** 이 프로젝트 자리의 문서 검색. */
  readonly search?: (query: string) => Promise<readonly DocumentFound[]>;
  readonly go: (target: WorkspaceTarget) => void;
}

function tabs(view: WorkspaceView): PaletteEntry<WorkspaceTarget>[] {
  const split = view.panes.length > 1;
  return view.panes.flatMap((pane, index) =>
    pane.tabs.map((tab) => {
      const kind = tabKindLabel(tab.kind);
      const side = index === 0
        ? t("common.label.palette-left-pane")
        : t("common.label.palette-right-pane");
      return {
        group: "tabs" as const,
        key: `tab:${index}:${tab.key}`,
        label: tab.title,
        detail: split
          ? t("common.label.palette-tab-detail", { kind, pane: side })
          : kind,
        icon: tabKindOf(tab.kind)?.paletteIcon ?? "tab" as const,
        target: { kind: "tab" as const, pane: index, key: tab.key },
      };
    })
  );
}

function actions(
  input: WorkspaceScopeInput,
): PaletteEntry<WorkspaceTarget>[] {
  const action = (
    name: WorkspaceAction,
    label: string,
    icon: PaletteEntry<WorkspaceTarget>["icon"],
    hint?: string,
  ): PaletteEntry<WorkspaceTarget> => ({
    group: "actions",
    key: `action:${name}`,
    label,
    icon,
    ...(hint ? { hint } : {}),
    target: { kind: "action", action: name },
  });
  return [
    action(
      "launcher",
      t("common.button.palette-launcher"),
      "launcher",
      windowShortcutLabel("launcher", input.platform),
    ),
    ...(input.terminal
      ? [action("terminal", t("common.button.palette-terminal"), "terminal")]
      : []),
    action("info-panel", t("common.button.palette-info-panel"), "panel"),
    action("lophn", t("common.button.palette-lophn"), "screen"),
  ];
}

export function workspaceScope(
  input: WorkspaceScopeInput,
): PaletteScope<WorkspaceTarget> {
  const documentEntry = (
    row: DocumentRow,
    detail?: string,
    found = false,
  ): PaletteEntry<WorkspaceTarget> => ({
    group: "documents",
    key: `document:${row.id}`,
    label: row.title,
    ...(detail ? { detail } : {}),
    icon: "document",
    target: { kind: "document", document: row },
    ...(found ? { found } : {}),
  });
  const search = input.search;
  return {
    title: t("common.title.palette-workspace"),
    order: WORKSPACE_GROUPS,
    entries: () => [
      ...tabs(input.view),
      ...input.documents.map((row) => documentEntry(row)),
      ...input.files.map((file) => ({
        group: "files" as const,
        key: `file:${file.path}`,
        label: file.path.split("/").at(-1) ?? file.path,
        detail: file.path,
        icon: "file" as const,
        target: {
          kind: "document" as const,
          document: { id: file.document, title: file.title },
        },
      })),
      ...input.contexts.map((row) => ({
        group: "contexts" as const,
        key: `context:${row.id}`,
        label: row.title,
        icon: "context" as const,
        target: { kind: "context" as const, id: row.id },
      })),
      ...actions(input),
    ],
    search: search
      ? async (query) =>
        (await search(query)).map((hit) =>
          documentEntry(
            { id: hit.document, title: hit.title },
            hit.detail,
            true,
          )
        )
      : undefined,
    choose: input.go,
  };
}
