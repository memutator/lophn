// 작업대 밖(런처·Settings 창, 전역 팔레트)의 팔레트 행. 프로젝트·앱·파일·행동 순서이고 고르면
// 지금 탐색 대상(프로젝트 창, 앱 공간, 런처, Settings, project 창에서 파일 열기)으로만 간다.
import { t } from "@lophn/wording";

import type { WindowPlatform } from "../top-bar/platform.ts";
import type { Catalog } from "./catalog.ts";
import { windowShortcutLabel } from "./labels.ts";
import { DESKTOP_GROUPS, type FileFound, type PaletteEntry } from "./model.ts";
import type { PaletteScope } from "./session.ts";

/** project 창에서 열 파일. path는 디스크의 절대 경로다. */
export interface FileOpen {
  readonly path: string;
  readonly line: number;
}

export type DesktopTarget =
  | { readonly kind: "project"; readonly id: string }
  | {
      readonly kind: "file";
      readonly project: string;
      readonly file: FileOpen;
    }
  | { readonly kind: "app"; readonly id: string }
  | { readonly kind: "settings" }
  | { readonly kind: "launcher" };

interface DesktopScopeInput {
  readonly catalog: Catalog;
  readonly platform: WindowPlatform;
  readonly search?: (query: string) => Promise<readonly FileFound[]>;
  readonly go: (target: DesktopTarget) => void;
}

function actions(platform: WindowPlatform): PaletteEntry<DesktopTarget>[] {
  return [
    {
      group: "actions",
      key: "action:launcher",
      label: t("common.button.palette-launcher"),
      hint: windowShortcutLabel("launcher", platform),
      icon: "launcher",
      target: { kind: "launcher" },
    },
    {
      group: "actions",
      key: "action:settings",
      label: t("common.button.palette-settings"),
      icon: "screen",
      target: { kind: "settings" },
    },
  ];
}

export function desktopScope(
  input: DesktopScopeInput,
): PaletteScope<DesktopTarget> {
  const search = input.search;
  return {
    title: t("common.title.palette-desktop"),
    order: DESKTOP_GROUPS,
    entries: () => [
      ...input.catalog.projects.map((row) => ({
        group: "projects" as const,
        key: `project:${row.id}`,
        label: row.title,
        icon: "project" as const,
        target: { kind: "project" as const, id: row.id },
      })),
      ...input.catalog.apps.map((row) => ({
        group: "apps" as const,
        key: `app:${row.id}`,
        label: row.title,
        icon: "app" as const,
        target: { kind: "app" as const, id: row.id },
      })),
      ...actions(input.platform),
    ],
    search: search
      ? async (query) =>
          (await search(query)).map((hit) => {
            const title = input.catalog.projects.find(
              (row) => row.id === hit.project,
            )?.title;
            return {
              group: "files" as const,
              key: `file:${hit.project}:${hit.file}:${hit.line}`,
              label: `${hit.path}:${hit.line}`,
              detail: title === undefined ? hit.text : `${title} · ${hit.text}`,
              icon: "file" as const,
              found: true,
              target: {
                kind: "file" as const,
                project: hit.project,
                file: { path: hit.file, line: hit.line },
              },
            };
          })
      : undefined,
    choose: input.go,
  };
}
