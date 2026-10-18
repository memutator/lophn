// toolbar의 bookmark 단추. 목록 순서대로 title이고, 고르면 지금 탭에서 그 주소로 간다.
import { IconButton } from "@lophn/ui/primitives";
import { Menu } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import { browserIcons } from "../icons/mod.ts";
import type { Bookmarks } from "./bookmarks.ts";

interface BookmarkMenuProps {
  bookmarks: Bookmarks;
  /** 아직 view가 안 열렸으면 null이다. 단추는 잠긴다. */
  viewSession: string | null;
  open(url: string): void;
  onOpenChange(open: boolean): void;
}

export function BookmarkMenu(props: BookmarkMenuProps) {
  const { bookmarks } = props;
  const items = bookmarks.state === "corrupt"
    ? [{
      id: "corrupt",
      label: t("settings.error.bookmarks-corrupt"),
      disabled: true,
    }]
    : bookmarks.state === "unavailable"
    ? [{
      id: "unavailable",
      label: t("settings.error.bookmarks-load-failed"),
      disabled: true,
    }]
    : bookmarks.bookmarks.length === 0
    ? [{
      id: "empty",
      label: t("browser.notice.no-bookmarks"),
      disabled: true,
    }]
    : bookmarks.bookmarks.map((item) => ({
      id: item.id,
      label: item.title,
      textValue: item.title,
    }));
  return (
    <Menu
      items={items}
      onSelect={(id) => {
        const picked = bookmarks.bookmarks.find((item) => item.id === id);
        if (picked !== undefined) props.open(picked.url);
      }}
      onOpenChange={props.onOpenChange}
      placement="beside"
      trigger={
        <IconButton
          icon={browserIcons.bookmarks}
          label={t("browser.button.bookmarks")}
          size="sm"
          disabled={props.viewSession === null || bookmarks.state === "loading"}
        />
      }
    />
  );
}
