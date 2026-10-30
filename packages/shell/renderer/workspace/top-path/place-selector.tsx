// 상단 바 왼쪽의 place switcher. trigger는 두 줄이다: 윗줄에 종류(Project 또는 App), 아랫줄에 지금 place 이름.
// 누르면 Projects와 Apps 두 묶음이 열리고, 묶음 안은 최근에 연 순서다(같은 place가 두 번 나오지 않는다).
// 목록 줄 앞에는 place 표식(PlaceMark)이 붙는다. 상단 바 trigger에는 표식이 없다.
// 고르면 그 place를 이 창에서 연다(공간 이동은 부르는 쪽 몫).

import { t } from "@lophn/i18n";
import { Menu, type MenuItem } from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import { commonIcons, conversationIcons } from "../../icons/mod.ts";
import { PlaceMark } from "../../parts/place-mark/place-mark.tsx";
import styles from "./desk-selector.module.css";
import type { PlaceRef } from "./recent-places.ts";

export interface PlaceOption {
  /** prj_… 또는 app_… */
  readonly id: string;
  /** 사람이 보는 이름. */
  readonly label: string;
  /** 이미지 src(favicon 등). 없으면 첫 글자와 색 배경이다. */
  readonly icon?: string;
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
  /** 최근에 연 place, 최근 것부터. 묶음 안의 순서를 정한다. 여기 없는 place는 뒤에 목록 순서로 온다. */
  readonly recent?: readonly PlaceRef[];
  readonly onSelect: (place: PlaceRef) => void;
  /** menu가 열리고 닫힐 때. 열 때 목록을 다시 읽는 데 쓴다. */
  readonly onOpenChange?: (open: boolean) => void;
}

const pixels = iconPixels("small");

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
  const name =
    known[active.kind].find((item) => item.id === active.id)?.label ??
    activeName ??
    "";
  // 최근에 연 것이 위로. 최근 목록에 없는 place는 뒤에서 목록 순서를 지킨다(정렬이 안정적이다).
  const rank = (kind: PlaceKind, id: string) => {
    const at = recent.findIndex(
      (place) => place.kind === kind && place.id === id,
    );
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  // menu 항목 id는 줄마다 달라야 한다.
  const items: MenuItem[] = [];
  for (const kind of ["project", "app"] as const) {
    const group = [...known[kind]].sort(
      (a, b) => rank(kind, a.id) - rank(kind, b.id),
    );
    for (const [index, item] of group.entries()) {
      items.push({
        id: `place-${items.length}`,
        textValue: item.label,
        data: { "data-place-option": `${kind}:${item.id}` },
        leading: (
          <PlaceMark
            kind={kind}
            id={item.id}
            name={item.label}
            {...(item.icon === undefined ? {} : { icon: item.icon })}
          />
        ),
        label: (
          <span className={styles.item}>
            <span className={styles.name}>{item.label}</span>
            {kind === active.kind && item.id === active.id ? (
              <Icon icon={conversationIcons.current} pixels={pixels} />
            ) : null}
          </span>
        ),
        ...(index === 0
          ? {
              heading:
                kind === "project"
                  ? t("common.heading.projects")
                  : t("common.heading.apps"),
              separatorBefore: items.length > 0,
            }
          : {}),
      });
    }
  }
  return (
    <Menu
      trigger={
        <button
          type="button"
          className={`${styles.trigger} ${styles.place}`}
          aria-label={t("project-workspace.label.place-selector")}
          data-path-selector="place"
          data-place-kind={active.kind}
        >
          <span className={styles.placeText}>
            <span className={styles.kind}>
              {active.kind === "project"
                ? t("project-workspace.label.place-project")
                : t("project-workspace.label.place-app")}
            </span>
            <span className={styles.name}>{name}</span>
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
