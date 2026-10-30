// 상단 바 왼쪽의 place switcher. 지금 place(project 또는 app) 이름과 chevron 단추 하나를 두고, 누르면
// 최근에 연 place(Recent)가 먼저, 그 아래 전체 project와 app 목록이 구분선으로 갈려 열린다. 고르면 그
// place를 이 창에서 연다(공간 이동은 부르는 쪽 몫).
import type { LucideIcon } from "lucide-react";
import { Menu, type MenuItem, MenuIcon } from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import {
  appSpaceIcons,
  commonIcons,
  conversationIcons,
} from "../../icons/mod.ts";
import styles from "./desk-selector.module.css";
import type { PlaceRef } from "./recent-places.ts";

export interface PlaceOption {
  /** prj_… 또는 app_… */
  readonly id: string;
  /** 사람이 보는 이름. */
  readonly label: string;
}

export type PlaceKind = PlaceRef["kind"];

export interface PlaceSwitcherProps {
  /** 지금 place. */
  readonly active: PlaceRef;
  /** 목록에서 active를 못 찾았을 때 trigger에 쓸 이름. 읽기 전이면 빈 글이다. */
  readonly activeName?: string;
  /** 고를 수 있는 project. 비면 project 묶음이 없다. */
  readonly projects: readonly PlaceOption[];
  /** 고를 수 있는 app. 비면 app 묶음이 없다. */
  readonly apps: readonly PlaceOption[];
  /** 최근에 연 place, 최근 것부터. 목록에 없는 것은 빼고 보인다. */
  readonly recent?: readonly PlaceRef[];
  readonly onSelect: (place: PlaceRef) => void;
  /** menu가 열리고 닫힐 때. 열 때 목록을 다시 읽는 데 쓴다. */
  readonly onOpenChange?: (open: boolean) => void;
}

const pixels = iconPixels("small");

const PLACE_ICONS: Readonly<Record<PlaceKind, LucideIcon>> = {
  project: commonIcons.projects,
  app: appSpaceIcons.app,
};

export function PlaceSwitcher({
  active,
  activeName,
  projects,
  apps,
  recent = [],
  onSelect,
  onOpenChange,
}: PlaceSwitcherProps) {
  const known: Readonly<Record<PlaceKind, readonly PlaceOption[]>> = {
    project: projects,
    app: apps,
  };
  const nameOf = (place: PlaceRef) =>
    known[place.kind].find((item) => item.id === place.id)?.label;
  // menu 항목 id는 줄마다 달라야 한다. 같은 place가 Recent와 전체 목록에 같이 나온다.
  const items: MenuItem[] = [];
  const add = (place: PlaceRef, label: string, marks: Marks) => {
    items.push({
      id: `place-${items.length}`,
      textValue: label,
      data: { "data-place-option": `${place.kind}:${place.id}` },
      leading: <MenuIcon icon={PLACE_ICONS[place.kind]} />,
      label: (
        <span className={styles.item}>
          <span className={styles.name}>{label}</span>
          {place.kind === active.kind && place.id === active.id ? (
            <Icon icon={conversationIcons.current} pixels={pixels} />
          ) : null}
        </span>
      ),
      ...(marks.heading === undefined ? {} : { heading: marks.heading }),
      ...(marks.separatorBefore === true ? { separatorBefore: true } : {}),
    });
  };
  const recentRows = recent.flatMap((place) => {
    const label = nameOf(place);
    return label === undefined ? [] : [{ place, label }];
  });
  for (const [index, { place, label }] of recentRows.entries()) {
    add(place, label, {
      heading: index === 0 ? t("project-workspace.label.recent") : undefined,
    });
  }
  for (const [index, item] of projects.entries()) {
    add({ kind: "project", id: item.id }, item.label, {
      heading: index === 0 ? t("common.heading.projects") : undefined,
      separatorBefore: index === 0 && recentRows.length > 0,
    });
  }
  const divided = recentRows.length > 0 || projects.length > 0;
  for (const [index, item] of apps.entries()) {
    add({ kind: "app", id: item.id }, item.label, {
      heading: index === 0 ? t("common.heading.apps") : undefined,
      separatorBefore: index === 0 && divided,
    });
  }
  return (
    <Menu
      trigger={
        <button
          type="button"
          className={styles.trigger}
          aria-label={t("project-workspace.label.place-selector")}
          data-path-selector="place"
          data-place-kind={active.kind}
        >
          <span className={styles.name}>
            {nameOf(active) ?? activeName ?? ""}
          </span>
          <Icon icon={commonIcons.collapse} pixels={pixels} />
        </button>
      }
      items={items}
      onSelect={(id) => {
        const picked = items.find((item) => item.id === id)?.data?.[
          "data-place-option"
        ];
        if (picked === undefined) return;
        const at = picked.indexOf(":");
        const kind = picked.slice(0, at);
        if (kind === "project" || kind === "app") {
          onSelect({ kind, id: picked.slice(at + 1) });
        }
      }}
      onOpenChange={onOpenChange}
    />
  );
}

interface Marks {
  readonly heading?: string;
  readonly separatorBefore?: boolean;
}
