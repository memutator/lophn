// 프로젝트 작업대의 팔레트 행. 열린 탭·파일·bookmark·행동 순서이고
// 고르면 작업대 안의 대상(탭 고르기, 파일 탭 열기, bookmark를 새 browser 탭에서 열기, 행동)으로만 간다.
import { t } from "@lophn/wording";

import { commandLabel } from "../../../ipc/keybindings.ts";
import { tabKindLabel, tabKindOf } from "../../workspace/kinds/registry.ts";
import type {
  FloatItem,
  TabItem,
  WorkspaceView,
} from "../../workspace/model.ts";
import type { FileRow } from "../../workspace/source.ts";
import type { WindowPlatform } from "../top-bar/platform.ts";
import { windowShortcutLabel } from "./labels.ts";
import {
  type FileFound,
  type PaletteEntry,
  WORKSPACE_GROUPS,
} from "./model.ts";
import type { PaletteScope } from "./session.ts";

type WorkspaceAction =
  | "launcher"
  | "settings"
  | "terminal"
  | "float"
  | "dock"
  | "minimize";

type WorkspaceTarget =
  | { readonly kind: "tab"; readonly pane: number; readonly key: string }
  /** id는 파일의 절대 경로다. 파일 행의 문서 id는 옛 모양이라 목록에서 찾는다. */
  | {
    readonly kind: "document";
    readonly document: { readonly id: string; readonly title: string };
  }
  | { readonly kind: "bookmark"; readonly url: string }
  | { readonly kind: "action"; readonly action: WorkspaceAction };

interface WorkspaceScopeInput {
  readonly view: WorkspaceView;
  readonly files: readonly FileRow[];
  /** 읽은 bookmark. 목록을 못 읽었으면 비운다. 고르면 새 browser 탭에서 열린다. */
  readonly bookmarks: readonly {
    readonly id: string;
    readonly title: string;
    readonly url: string;
    readonly favicon?: string;
  }[];
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

/** focus 칸의 고른 탭. */
export function focusTab(view: WorkspaceView): TabItem | undefined {
  const pane = view.panes[view.focusedPane];
  return pane?.tabs.find((tab) => tab.key === pane.selected);
}

/** 가장 위의 접히지 않은 floated 패널. */
export function topFloat(view: WorkspaceView): FloatItem | undefined {
  return view.floats.findLast((item) => !item.minimized);
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
      ? [
        action(
          "terminal",
          t("common.button.palette-terminal"),
          "terminal",
          commandLabel(
            "terminal.focus",
            input.platform === "mac" ? "mac" : "other",
          ) ?? undefined,
        ),
      ]
      : []),
    action("settings", t("common.button.palette-settings"), "screen"),
    ...(focusTab(input.view)
      ? [action("float", t("common.button.palette-float-tab"), "tab")]
      : []),
    ...(topFloat(input.view)
      ? [
        action("dock", t("common.button.palette-dock-panel"), "panel"),
        action("minimize", t("common.button.palette-minimize-panel"), "panel"),
      ]
      : []),
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
      ...input.bookmarks.map((item) => ({
        group: "bookmarks" as const,
        key: `bookmark:${item.id}`,
        label: item.title,
        detail: item.url,
        icon: "bookmark" as const,
        ...(item.favicon ? { image: item.favicon } : {}),
        target: { kind: "bookmark" as const, url: item.url },
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
