import { type MouseEvent, useEffect, useRef } from "react";
import { t } from "@lophn/wording";

import type { LinkTarget } from "./link-picker.ts";
import styles from "./link-picker.module.css";

export interface LinkPickerProps {
  /** 이미 맞추고 정렬한 행. */
  rows: readonly LinkTarget[];
  /** 강조한 행 index. */
  active: number;
  /** `[[` 아래 자리. 편집기 좌표의 px다. */
  top: number;
  left: number;
  onPick: (row: LinkTarget) => void;
  /** 바깥 click. Escape는 편집기가 받아 닫는다. */
  onClose: () => void;
}

/**
 * `[[` 링크 고르기 320px popover·32px 행. query는 편집기에 치는 글이라
 * 이 목록에는 입력이 없다. 편집기가 focus를 지키고 화살표·Enter를 넘겨 준다. 그래서
 * overlay view로 focus를 옮기지 않고 편집 칸 위 popover 층(z 230)에 그린다.
 */
export function LinkPicker(
  { rows, active, top, left, onPick, onClose }: LinkPickerProps,
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: Event) => {
      if (
        ref.current && event.target instanceof Node &&
        !ref.current.contains(event.target)
      ) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector("[data-active]")?.scrollIntoView?.({
      block: "nearest",
    });
  }, [active, rows]);

  const choose = (event: MouseEvent, row: LinkTarget) => {
    // 편집기가 focus를 잃지 않게 mousedown에서 고른다.
    event.preventDefault();
    onPick(row);
  };

  return (
    <div
      ref={ref}
      className={styles.picker}
      style={{ top, left }}
      data-link-picker=""
    >
      <div className={styles.head}>
        {t("document.label.link-count", { count: rows.length })}
      </div>
      {rows.length === 0
        ? <p className={styles.empty}>{t("document.empty.no-links")}</p>
        : (
          <ul
            className={styles.list}
            role="listbox"
            aria-label={t("document.label.link-picker")}
          >
            {rows.map((row, index) => (
              <li
                key={row.address}
                role="option"
                aria-selected={index === active}
                data-active={index === active ? "" : undefined}
                data-link-row={row.address}
                className={styles.row}
                onMouseDown={(event) => choose(event, row)}
              >
                <span className={styles.title}>{row.title}</span>
                <span className={styles.name}>{row.name}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
