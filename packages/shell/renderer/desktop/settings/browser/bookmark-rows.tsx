// Settings › Browser의 bookmark 목록. 더한 순서대로 줄마다 title, URL, [Edit], [Remove]다.
// 파일이 깨져 있으면 목록 대신 오류만 보인다. 고치기·지우기를 막고 덮어쓰는 길은 두지 않는다.
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import type { Bookmark } from "../../../../ipc/browser.ts";
import { Favicon } from "../../../browser/favicon.tsx";
import styles from "../settings.module.css";
import type { BookmarkList, BrowserSettingsSource } from "./source.ts";

type Loaded = BookmarkList | { state: "failed" } | null;

function reasonText(code: string): string {
  switch (code) {
    case "url":
      return t("settings.error.bookmark-url");
    case "title":
      return t("settings.error.bookmark-title");
    case "duplicate":
      return t("settings.error.bookmark-duplicate");
    default:
      return t("settings.error.bookmark-failed");
  }
}

export function BookmarkRows({ source }: { source: BrowserSettingsSource }) {
  const [loaded, setLoaded] = useState<Loaded>(null);

  const load = useCallback(() => {
    void source.bookmarks().then((read) =>
      setLoaded((was) =>
        read.ok
          ? read.value
          // 다시 읽다 실패해도 보이던 목록은 그대로 둔다.
          : was?.state === "ok" || was?.state === "corrupt"
          ? was
          : { state: "failed" }
      )
    );
  }, [source]);
  useEffect(() => {
    load();
    return source.watchBookmarks(load);
  }, [source, load]);

  if (loaded === null) return null;
  if (loaded.state === "failed") {
    return (
      <p className={styles.notice} data-bookmarks="failed">
        {t("settings.error.bookmarks-load-failed")}
      </p>
    );
  }
  if (loaded.state === "corrupt") {
    return (
      <p className={styles.rejected} role="alert" data-bookmarks="corrupt">
        {t("settings.error.bookmarks-corrupt")}
      </p>
    );
  }
  if (loaded.bookmarks.length === 0) {
    return (
      <p className={styles.notice} data-bookmarks="empty">
        {t("settings.notice.bookmarks-empty")}
      </p>
    );
  }
  return (
    <ul className={styles.lines} data-bookmarks="ok">
      {loaded.bookmarks.map((bookmark) => (
        <BookmarkLine
          key={bookmark.id}
          bookmark={bookmark}
          source={source}
          onChanged={load}
        />
      ))}
    </ul>
  );
}

interface BookmarkLineProps {
  bookmark: Bookmark;
  source: BrowserSettingsSource;
  onChanged: () => void;
}

function BookmarkLine({ bookmark, source, onChanged }: BookmarkLineProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  const [error, setError] = useState<string | null>(null);

  function edit(): void {
    setTitle(bookmark.title);
    setUrl(bookmark.url);
    setError(null);
    setEditing(true);
  }

  async function save(): Promise<void> {
    const done = await source.updateBookmark({ id: bookmark.id, title, url });
    if (done.ok) {
      setEditing(false);
      onChanged();
    } else setError(reasonText(done.code));
  }

  async function remove(): Promise<void> {
    const done = await source.removeBookmark(bookmark.id);
    if (done.ok) onChanged();
    else setError(reasonText(done.code));
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void save();
    else if (event.key === "Escape") setEditing(false);
  };

  const errorLine = error === null
    ? null
    : <p className={styles.rejected} role="alert">{error}</p>;

  if (editing) {
    return (
      <li className={styles.line} data-bookmark={bookmark.id} data-editing="">
        <div className={styles.lineMain}>
          <Field label={t("settings.label.bookmark-title")}>
            <Input
              value={title}
              autoFocus
              onChange={(event) =>
                setTitle(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </Field>
          <Field label={t("settings.label.bookmark-url")}>
            <Input
              value={url}
              spellCheck={false}
              onChange={(event) =>
                setUrl(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </Field>
          {errorLine}
        </div>
        <div className={styles.lineControl}>
          <div className={styles.actions}>
            <Button
              variant="primary"
              data-bookmark-save=""
              onClick={() =>
                void save()}
            >
              {t("settings.button.bookmark-save")}
            </Button>
            <Button onClick={() => setEditing(false)}>
              {t("settings.button.cancel")}
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className={styles.line} data-bookmark={bookmark.id}>
      <div className={styles.lineMain}>
        <span className={styles.productName}>
          <Favicon src={bookmark.favicon} />
          {bookmark.title}
        </span>
        <span
          className={`${styles.lineHelp} ${styles.mono}`}
          style={{ overflowWrap: "anywhere" }}
        >
          {bookmark.url}
        </span>
        {errorLine}
      </div>
      <div className={styles.lineControl}>
        <div className={styles.actions}>
          <Button data-bookmark-edit="" onClick={edit}>
            {t("settings.button.bookmark-edit")}
          </Button>
          <Button data-bookmark-remove="" onClick={() => void remove()}>
            {t("settings.button.bookmark-remove")}
          </Button>
        </div>
      </div>
    </li>
  );
}
