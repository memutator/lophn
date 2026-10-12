// lophn 공간의 팔레트 행. 프로젝트·문서·앱·행동 순서이고(desktop#R30) 고르면
// 지금 탐색 대상(프로젝트 작업대, 여섯 형제 화면, documents 화면의 읽기)으로만 간다.
// 없어진 거처·분류 전·시리즈 전용 목적지는 만들지 않는다.
import { t } from "@lophn/wording";

import { LOPHN_SCREENS, type LophnScreen } from "../lophn-space/model.ts";
import { screenLabel } from "../lophn-space/screens.ts";
import type { Catalog } from "../lophn-space/source.ts";
import type { WindowPlatform } from "../top-bar/platform.ts";
import { windowShortcutLabel } from "./labels.ts";
import {
  type DocumentFound,
  LOPHN_GROUPS,
  type PaletteEntry,
} from "./model.ts";
import type { PaletteScope } from "./session.ts";

export type LophnTarget =
  | { readonly kind: "project"; readonly id: string }
  | {
    readonly kind: "document";
    readonly document: string;
    readonly version: string;
  }
  | { readonly kind: "app"; readonly id: string }
  | { readonly kind: "screen"; readonly screen: LophnScreen }
  | { readonly kind: "launcher" };

export interface LophnScopeInput {
  readonly catalog: Catalog;
  readonly platform: WindowPlatform;
  readonly search?: (query: string) => Promise<readonly DocumentFound[]>;
  readonly go: (target: LophnTarget) => void;
}

function actions(platform: WindowPlatform): PaletteEntry<LophnTarget>[] {
  return [
    {
      group: "actions",
      key: "action:launcher",
      label: t("common.button.palette-launcher"),
      hint: windowShortcutLabel("launcher", platform),
      icon: "launcher",
      target: { kind: "launcher" },
    },
    ...LOPHN_SCREENS.map((screen) => ({
      group: "actions" as const,
      key: `action:${screen}`,
      label: t("common.button.palette-go-to", { screen: screenLabel(screen) }),
      icon: "screen" as const,
      target: { kind: "screen" as const, screen },
    })),
  ];
}

export function lophnScope(input: LophnScopeInput): PaletteScope<LophnTarget> {
  const search = input.search;
  return {
    title: t("common.title.palette-lophn"),
    order: LOPHN_GROUPS,
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
        (await search(query)).map((hit) => ({
          group: "documents" as const,
          key: `document:${hit.document}`,
          label: hit.title,
          ...(hit.detail ? { detail: hit.detail } : {}),
          icon: "document" as const,
          found: true,
          target: {
            kind: "document" as const,
            document: hit.document,
            version: hit.version,
          },
        }))
      : undefined,
    choose: input.go,
  };
}
