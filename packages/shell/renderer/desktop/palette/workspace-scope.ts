// 프로젝트 작업대의 팔레트 행. 열린 탭·파일·컨텍스트·행동 순서이고
// 고르면 작업대 안의 대상(탭 고르기, 파일 탭 열기, Context 탭 열기, 행동)으로만 간다.
import { t } from "@lophn/wording";

import {
  CONTEXT_PALETTE_PREFIX,
  contextPaletteItems,
} from "../../workspace/contexts/context-palette-group.ts";
import type { ContextListItem } from "../../workspace/contexts/source.ts";
import { tabKindLabel, tabKindOf } from "../../workspace/kinds/registry.ts";
import type { WorkspaceView } from "../../workspace/model.ts";
import type { FileRow } from "../../workspace/source.ts";
import type { WindowPlatform } from "../top-bar/platform.ts";
import { windowShortcutLabel } from "./labels.ts";
import {
  type FileFound,
  type PaletteEntry,
  WORKSPACE_GROUPS,
} from "./model.ts";
import type { PaletteScope } from "./session.ts";

export type WorkspaceAction = "launcher" | "lophn" | "terminal";

export type WorkspaceTarget =
  | { readonly kind: "tab"; readonly pane: number; readonly key: string }
  /** id는 파일의 절대 경로다. 파일 행의 문서 id는 옛 모양이라 목록에서 찾는다. */
  | {
    readonly kind: "document";
    readonly document: { readonly id: string; readonly title: string };
  }
  | { readonly kind: "context"; readonly id: string }
  | { readonly kind: "action"; readonly action: WorkspaceAction };

export interface WorkspaceScopeInput {
  readonly view: WorkspaceView;
  readonly files: readonly FileRow[];
  /** 이 프로젝트의 context. 고르면 그 Context 탭이 열린다. */
  readonly contexts: readonly ContextListItem[];
  /** 터미널 통로가 있을 때만 터미널 열기 행이 있다. */
  readonly terminal: boolean;
  readonly platform: WindowPlatform;
  /** 이 프로젝트의 키워드 검색. */
  readonly search?: (query: string) => Promise<readonly FileFound[]>;
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
    action("lophn", t("common.button.palette-lophn"), "screen"),
  ];
}

export function workspaceScope(
  input: WorkspaceScopeInput,
): PaletteScope<WorkspaceTarget> {
  const search = input.search;
  return {
    title: t("common.title.palette-workspace"),
    order: WORKSPACE_GROUPS,
    entries: () => [
      ...tabs(input.view),
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
      // 항목의 이름·보조 글·id는 Contexts 묶음(contextPaletteItems)이 정한 그대로다.
      ...contextPaletteItems(input.contexts).map((item) => ({
        group: "contexts" as const,
        key: item.id,
        label: item.label,
        ...(item.detail ? { detail: item.detail } : {}),
        icon: "context" as const,
        target: {
          kind: "context" as const,
          id: item.id.slice(CONTEXT_PALETTE_PREFIX.length),
        },
      })),
      ...actions(input),
    ],
    search: search
      ? async (query) =>
        (await search(query)).map((hit) => ({
          group: "files" as const,
          key: `file:${hit.file}:${hit.line}`,
          label: `${hit.path}:${hit.line}`,
          detail: hit.text,
          icon: "file" as const,
          found: true,
          target: {
            kind: "document" as const,
            document: { id: hit.file, title: hit.path },
          },
        }))
      : undefined,
    choose: input.go,
  };
}
