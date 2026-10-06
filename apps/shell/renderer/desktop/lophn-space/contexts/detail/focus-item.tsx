import { useState } from "react";
import {
  Button,
  Icon,
  iconPixels,
  lophnSpaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { type Gap, gapsOf, type WatchState } from "../model.ts";
import type { FocusItem } from "../source.ts";
import { type Tone, WatchDetail, watchLabel } from "../watch/watch-note.tsx";
import styles from "../contexts.module.css";

const GAP_KEYS = {
  "unreadable": "contexts.notice.gap-unreadable",
  "no-version": "contexts.notice.gap-no-version",
  "section-missing": "contexts.notice.gap-section-missing",
  "section-unverified": "contexts.notice.gap-section-unverified",
  "unsupported": "contexts.notice.gap-unsupported",
} as const satisfies Record<Gap, string>;

export interface FocusItemRowProps {
  item: FocusItem;
  /** Follow changes 항목의 상태. 다른 관점은 null이다. */
  watch: WatchState | null;
  onRead: (
    document: string,
    version: string | null,
    section: string | null,
  ) => void;
}

// 항목 한 줄. 지금 필요한 이름과 읽을 수 있는지를 먼저 보이고, 선택 이유·부족한 자료·바뀐 판은
// 펼쳐야 보인다(flow build-context 3).
export function FocusItemRow({ item, watch, onRead }: FocusItemRowProps) {
  const [open, setOpen] = useState(false);
  const gaps = gapsOf(item);
  const target = item.target;
  const state: { text: string; tone: Tone } | null = watch !== null
    ? watchLabel(watch)
    : gaps.length > 0
    ? { text: t("contexts.label.gaps"), tone: "warning" }
    : null;
  const title = item.title === ""
    ? t("contexts.label.untitled")
    : target.kind === "app_command"
    ? t("contexts.label.export-app", { title: item.title })
    : item.title;
  return (
    <li data-item={item.perspective} data-item-open={open ? "" : undefined}>
      <button
        type="button"
        className={styles.itemHead}
        aria-expanded={open}
        onClick={() =>
          setOpen(!open)}
      >
        <Icon
          icon={open ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
          pixels={iconPixels("small")}
          className={styles.itemIcon}
        />
        <span className={styles.itemTitle}>
          {title}
          {target.kind === "document" && target.section !== null
            ? (
              <span className={styles.itemSection}>
                {" · "}
                {t("contexts.label.section", { section: target.section })}
              </span>
            )
            : null}
        </span>
        {state !== null && state.text !== ""
          ? (
            <span
              className={styles.state}
              data-tone={state.tone}
              data-item-state={watch?.kind ?? "gaps"}
            >
              {state.text}
            </span>
          )
          : null}
      </button>
      {open
        ? (
          <div className={styles.itemBody} data-item-body="">
            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                {t("contexts.label.reason")}
              </span>
              <p className={styles.fieldValue} data-item-reason="">
                {item.reason}
              </p>
            </div>
            {gaps.length > 0
              ? (
                <div className={styles.field} data-item-gaps="">
                  <span className={styles.fieldLabel}>
                    {t("contexts.label.gaps")}
                  </span>
                  {gaps.map((gap) => (
                    <p key={gap} className={styles.notice} data-gap={gap}>
                      {t(GAP_KEYS[gap])}
                    </p>
                  ))}
                </div>
              )
              : null}
            {watch !== null
              ? (
                <WatchDetail
                  state={watch}
                  target={target.kind === "document" ? target : null}
                  onRead={(version, section) =>
                    target.kind === "document" &&
                    onRead(target.document, version, section)}
                />
              )
              : null}
            {target.kind === "document" && item.readable &&
                item.version !== null
              ? (
                <div className={styles.buttons}>
                  <Button
                    size="sm"
                    data-open-item=""
                    onClick={() =>
                      onRead(target.document, item.version, target.section)}
                  >
                    {t("contexts.button.open")}
                  </Button>
                </div>
              )
              : null}
          </div>
        )
        : null}
    </li>
  );
}
