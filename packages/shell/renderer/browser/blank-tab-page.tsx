// 빈 주소 칸으로 연 탭에서 native view 대신 그리는 bookmark 목록. 누르면 이 탭에서 열고
// Ctrl/Cmd-click이나 가운데 click은 새 탭에서 연다.
import type { MouseEvent } from "react";
import { t } from "@lophn/i18n";

import { type Bookmarks, hostOf } from "./bookmarks.ts";
import { Favicon } from "./favicon.tsx";
import styles from "./bookmark.module.css";

interface BlankTabPageProps {
  bookmarks: Bookmarks;
  onOpen(url: string): void;
  onOpenInNewTab(url: string): void;
}

export function BlankTabPage({
  bookmarks,
  onOpen,
  onOpenInNewTab,
}: BlankTabPageProps) {
  if (bookmarks.state === "loading") return null;
  if (bookmarks.state === "corrupt") {
    return (
      <p className={styles.note} role="alert">
        {t("settings.error.bookmarks-corrupt")}
      </p>
    );
  }
  if (bookmarks.state === "unavailable") {
    return (
      <p className={styles.note}>{t("settings.error.bookmarks-load-failed")}</p>
    );
  }
  if (bookmarks.bookmarks.length === 0) {
    return (
      <p className={styles.note}>{t("settings.notice.bookmarks-empty")}</p>
    );
  }
  return (
    <ul className={styles.list} data-new-tab="">
      {bookmarks.bookmarks.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className={styles.row}
            onClick={(event: MouseEvent) =>
              (event.ctrlKey || event.metaKey ? onOpenInNewTab : onOpen)(
                item.url,
              )
            }
            onAuxClick={(event) => {
              if (event.button === 1) onOpenInNewTab(item.url);
            }}
          >
            <Favicon src={item.favicon} />
            <span className={styles.text}>
              <span className={styles.title}>{item.title}</span>
              <span className={styles.host}>{hostOf(item.url)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
