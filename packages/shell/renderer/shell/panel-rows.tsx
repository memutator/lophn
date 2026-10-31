// 오른쪽 sidebar panel들이 같이 쓰는 줄 모양. 구역 머리(PanelSection), 줄(PanelRow: 아이콘 칸, 제목, 아래 줄, 오른쪽 끝 칸),
// 비었음 글(PanelEmpty). 줄 하나가 누르는 단추이고 오른쪽 끝 칸은 그 밖에 있어 단추 안에 단추를 넣지 않는다.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import { commonIcons } from "../icons/mod.ts";
import styles from "./panel-rows.module.css";

/** 구역 머리. 접을 수 있으면 `folded`와 `onToggle`을 같이 준다. */
export function PanelSection({
  title,
  count,
  actions,
  folded,
  onToggle,
  children,
  ...data
}: {
  title: string;
  count?: number;
  /** 머리 오른쪽 끝 단추. */
  actions?: ReactNode;
  folded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
  "data-section"?: string;
}) {
  const label = (
    <>
      {onToggle === undefined ? null : (
        <Icon
          icon={folded ? commonIcons.expand : commonIcons.collapse}
          pixels={iconPixels("small")}
        />
      )}
      <span className={styles.sectionTitle}>{title}</span>
      {count === undefined ? null : (
        <span className={styles.count}>{count}</span>
      )}
    </>
  );
  return (
    <section className={styles.section} {...data}>
      <div className={styles.sectionHead}>
        {onToggle === undefined ? (
          <span className={styles.sectionLabel}>{label}</span>
        ) : (
          <button
            type="button"
            className={styles.sectionLabel}
            data-toggle=""
            aria-expanded={!folded}
            onClick={onToggle}
          >
            {label}
          </button>
        )}
        {actions === undefined ? null : (
          <span className={styles.sectionActions}>{actions}</span>
        )}
      </div>
      {folded ? null : children}
    </section>
  );
}

/** 줄 앞의 아이콘 칸. 표식(PlaceMark)은 칸 없이 `leading`에 바로 준다. */
export function TileIcon({
  icon,
  tone,
}: {
  icon: LucideIcon;
  tone?: "critical";
}) {
  return (
    <span className={styles.tile} data-tone={tone}>
      <Icon icon={icon} pixels={iconPixels("base")} />
    </span>
  );
}

export function PanelRow({
  leading,
  title,
  tag,
  meta,
  metaTone,
  wrapMeta,
  active,
  trailing,
  hoverTrailing,
  onClick,
  ...data
}: {
  leading?: ReactNode;
  title: string;
  /** 제목 옆의 짧은 이름(mono). */
  tag?: string;
  meta?: ReactNode;
  metaTone?: "critical" | "warning";
  /** true면 아래 줄을 두 줄까지 보인다. 아니면 한 줄에서 자른다. */
  wrapMeta?: boolean;
  active?: boolean;
  /** 오른쪽 끝 고정 칸. */
  trailing?: ReactNode;
  /** true면 trailing을 줄에 마우스를 올리거나 focus가 들어올 때만 보인다. */
  hoverTrailing?: boolean;
  onClick?: () => void;
  [key: `data-${string}`]: string | undefined;
}) {
  const body = (
    <>
      {leading}
      <span className={styles.text}>
        <span className={styles.titleLine}>
          <span className={styles.title}>{title}</span>
          {tag === undefined ? null : <span className={styles.tag}>{tag}</span>}
        </span>
        {meta === undefined ? null : (
          <span
            className={styles.meta}
            data-tone={metaTone}
            data-wrap={wrapMeta || undefined}
          >
            {meta}
          </span>
        )}
      </span>
    </>
  );
  return (
    <div
      role="listitem"
      className={styles.row}
      data-active={active || undefined}
      {...data}
    >
      {onClick === undefined ? (
        <div className={styles.main}>{body}</div>
      ) : (
        <button type="button" className={styles.main} onClick={onClick}>
          {body}
        </button>
      )}
      {trailing === undefined ? null : (
        <span
          className={styles.trailing}
          data-hover={hoverTrailing ? "" : undefined}
        >
          {trailing}
        </span>
      )}
    </div>
  );
}

export function PanelRows({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.rows} role="list" aria-label={label}>
      {children}
    </div>
  );
}

export function PanelEmpty({
  children,
  role,
}: {
  children: ReactNode;
  role?: "alert";
}) {
  return (
    <p className={styles.empty} role={role}>
      {children}
    </p>
  );
}
