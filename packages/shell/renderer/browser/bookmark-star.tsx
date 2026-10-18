// 주소 칸 끝의 별. 빈 별은 눌러 더하고, 채운 별은 눌러 popover를 연다.
// 보통 탭(<webview>)은 DOM popover에서 title을 고치고 [Remove]할 수 있다. page가 DOM이라 popover가 위에 뜬다.
// native popup 탭은 DOM popover가 view 밑에 깔리므로 overlay view(title과 [Remove])로 연다. 글 입력 칸은 없다.
// Ctrl/Cmd+D는 `presses`가 올라 별을 누른 것과 같은 동작을 한다.
import { useEffect, useRef, useState } from "react";
import { Field, Input } from "@lophn/ui/input";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Popover } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { Bookmark } from "../../ipc/browser.ts";
import type { OpenMenu } from "./overlay-menu.ts";
import { browserIcons } from "../icons/mod.ts";
import { bookmarkReasonText, type Bookmarks, hostOf } from "./bookmarks.ts";
import styles from "./bookmark.module.css";

interface BookmarkStarProps {
  bookmarks: Bookmarks;
  /** 지금 page의 정규화한 주소. 비면 별은 잠긴다. */
  url: string;
  /** 지금 page의 title. 비면 url의 host로 더한다. */
  title: string;
  /** 지금 page의 favicon(data URL). 있으면 bookmark에 같이 저장한다. */
  favicon?: string;
  /** 올라갈 때마다 별을 누른 것과 같은 동작을 한다(Ctrl/Cmd+D). */
  presses: number;
  onNotice(text: string): void;
  /** native popup 탭의 overlay popover. 보통 탭과 overlay api가 없는 창이면 null이고 DOM popover를 쓴다. */
  openOverlay: OpenMenu | null;
  /** DOM popover가 열려 있는 동안 탭이 native view(DevTools, popup)를 숨긴다. <webview> page는 숨기지 않는다. */
  onOpenChange(open: boolean): void;
}

export function BookmarkStar(props: BookmarkStarProps) {
  const { bookmarks, url, title, onNotice } = props;
  const existing = bookmarks.bookmarks.find((item) => item.url === url);
  const disabled = url === "" || bookmarks.state !== "ok";
  const [open, setOpen] = useState(false);
  // 채운 별의 감싸는 span은 display: contents라 상자가 없다. overlay에는 별 단추의 상자를 anchor로 보낸다.
  const anchor = useRef<HTMLButtonElement>(null);
  const shown = open && existing !== undefined;

  const change = (next: boolean) => {
    setOpen(next);
    props.onOpenChange(next);
  };
  const add = () =>
    bookmarks.add({
      title: title || hostOf(url),
      url,
      ...(props.favicon === undefined ? {} : { favicon: props.favicon }),
    }).catch((error) => onNotice(bookmarkReasonText(error)));
  const press = () => {
    if (disabled) return;
    if (existing === undefined) void add();
    else if (props.openOverlay !== null && anchor.current !== null) {
      const { id } = existing;
      void props.openOverlay(
        anchor.current,
        existing.title || hostOf(existing.url),
        [{ id: "remove", label: t("settings.button.bookmark-remove") }],
        "popover",
      ).then((picked) => {
        if (picked !== "remove") return;
        bookmarks.remove(id).catch((error) =>
          onNotice(bookmarkReasonText(error))
        );
      });
    } else change(true);
  };
  const latest = useRef(press);
  latest.current = press;
  useEffect(() => {
    if (props.presses > 0) latest.current();
  }, [props.presses]);

  // 이 page의 bookmark가 사라지면(지움, 다른 창, 이동) 열린 채 남지 않게 닫는다.
  useEffect(() => {
    if (open && existing === undefined) change(false);
  }, [open, existing === undefined]);

  return (
    <span
      className={existing === undefined ? undefined : styles.filled}
    >
      <Popover
        open={shown}
        // 채우기 전의 누름은 trigger onClick이 더한다. 열고 닫기는 채운 별만 한다.
        onOpenChange={(next) => {
          if (existing === undefined) return;
          // native popup 탭이면 DOM popover를 열지 않고 overlay popover를 연다.
          if (next && props.openOverlay !== null) press();
          else change(next);
        }}
        trigger={
          <IconButton
            ref={anchor}
            icon={browserIcons.star}
            label={existing === undefined
              ? t("browser.button.bookmark-add")
              : t("browser.button.bookmark-edit")}
            size="sm"
            disabled={disabled}
            onClick={existing === undefined ? () => void add() : undefined}
          />
        }
      >
        {existing === undefined ? null : (
          <StarPopover
            key={existing.id}
            bookmark={existing}
            bookmarks={bookmarks}
            onNotice={onNotice}
            onClose={() => change(false)}
          />
        )}
      </Popover>
    </span>
  );
}

interface StarPopoverProps {
  bookmark: Bookmark;
  bookmarks: Bookmarks;
  onNotice(text: string): void;
  onClose(): void;
}

function StarPopover(
  { bookmark, bookmarks, onNotice, onClose }: StarPopoverProps,
) {
  const [draft, setDraft] = useState(bookmark.title);
  const sent = useRef(bookmark.title);
  // 닫히며 지워질 때도 마지막 값을 보내려고 최신 값을 ref에 둔다.
  const latest = useRef({ draft, bookmarks, onNotice });
  latest.current = { draft, bookmarks, onNotice };

  const commit = () => {
    const { draft: value, bookmarks: list, onNotice: notice } = latest.current;
    if (value === sent.current) return;
    const before = sent.current;
    sent.current = value;
    list.update({ id: bookmark.id, title: value }).catch((error) => {
      sent.current = before;
      notice(bookmarkReasonText(error));
    });
  };
  useEffect(() => commit, []);

  return (
    <div className={styles.popover}>
      <Field label={t("settings.label.bookmark-title")}>
        <Input
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            commit();
            onClose();
          }}
        />
      </Field>
      <div className={styles.actions}>
        <Button
          onClick={() => {
            // 지우는 중이라 고친 title은 보내지 않는다.
            sent.current = latest.current.draft;
            bookmarks.remove(bookmark.id).catch((error) =>
              onNotice(bookmarkReasonText(error))
            );
            onClose();
          }}
        >
          {t("settings.button.bookmark-remove")}
        </Button>
        <Button onClick={onClose}>{t("common.button.close")}</Button>
      </div>
    </div>
  );
}
