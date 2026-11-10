// 프로젝트 작업대의 팔레트 행. 열린 탭·파일·bookmark·행동 순서이고
// 고르면 작업대 안의 대상(탭 고르기, 파일 탭 열기, bookmark를 새 browser 탭에서 열기, 행동)으로만 간다.
import { t } from "@lophn/i18n";

import {
  type Command,
  commandLabel,
  type KeyOverrides,
} from "../../../../protocol/shell/keybindings.ts";
import { tabKindLabel, tabKindOf } from "../../workspace/kinds/registry.ts";
import {
  type Desk,
  type FloatTab,
  type TabItem,
} from "../../shell/desk-model.ts";
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
  | "home"
  | "settings"
  | "project-settings"
  | "terminal"
  | "float"
  | "dock"
  | "minimize";

type WorkspaceTarget =
  | { readonly kind: "tab"; readonly key: string }
  /** id는 파일의 절대 경로다. 파일 행의 문서 id는 옛 모양이라 목록에서 찾는다. */
  | {
      readonly kind: "document";
      readonly document: { readonly id: string; readonly title: string };
    }
  | { readonly kind: "bookmark"; readonly url: string }
  | { readonly kind: "action"; readonly action: WorkspaceAction };

interface WorkspaceScopeInput {
  /** 보이는 desk. */
  readonly desk: Desk;
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
  /** 사람이 바꾼 키. hint가 바뀐 키를 보인다. */
  readonly keys: KeyOverrides;
  /** Home이면 project 설정 행이 없다. */
  readonly home?: boolean;
  /** 이 프로젝트의 키워드 검색. */
  readonly search?: (query: string) => Promise<readonly FileFound[]>;
  readonly go: (target: WorkspaceTarget) => void;
}

function tabs(desk: Desk): PaletteEntry<WorkspaceTarget>[] {
  return desk.tabs.map((tab) => ({
    group: "tabs" as const,
    key: `tab:${tab.key}`,
    label: tab.title,
    detail: tabKindLabel(tab.kind),
    icon: tabKindOf(tab.kind)?.paletteIcon ?? ("tab" as const),
    target: { kind: "tab" as const, key: tab.key },
  }));
}

/** focus가 있는 탭. group이면 focus leaf이고 그 tab이 selected다. */
export function focusTab(desk: Desk): TabItem | undefined {
  return desk.tabs.find((tab) => tab.key === desk.selected);
}

/** 가장 위의 접히지 않은 floated 패널. */
export function topFloat(desk: Desk): FloatTab | undefined {
  return desk.floats.findLast((item) => !item.minimized);
}

function actions(input: WorkspaceScopeInput): PaletteEntry<WorkspaceTarget>[] {
  const keyOf = (command: Command) =>
    commandLabel(
      command,
      input.platform === "mac" ? "mac" : "other",
      undefined,
      input.keys,
    ) ?? undefined;
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
      "home",
      t("common.button.palette-home"),
      "home",
      windowShortcutLabel("home.open", input.platform, input.keys) ?? undefined,
    ),
    ...(input.terminal
      ? [
          action(
            "terminal",
            t("common.button.palette-terminal"),
            "terminal",
            keyOf("new.terminal"),
          ),
        ]
      : []),
    action(
      "settings",
      t("common.button.palette-settings"),
      "screen",
      keyOf("settings.open"),
    ),
    ...(input.home === true
      ? []
      : [
          action(
            "project-settings",
            t("common.button.palette-project-settings"),
            "screen",
          ),
        ]),
    ...(focusTab(input.desk)
      ? [
          action(
            "float",
            t("common.button.palette-float-tab"),
            "tab",
            keyOf("tab.float"),
          ),
        ]
      : []),
    ...(topFloat(input.desk)
      ? [
          action(
            "dock",
            t("common.button.palette-dock-panel"),
            "panel",
            keyOf("float.dock"),
          ),
          action(
            "minimize",
            t("common.button.palette-minimize-panel"),
            "panel",
            keyOf("float.minimize"),
          ),
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
      ...tabs(input.desk),
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
