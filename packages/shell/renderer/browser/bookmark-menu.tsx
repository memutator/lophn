// toolbar의 bookmark 단추. 목록 순서대로 title이고, 고르면 지금 탭에서 그 주소로 간다.
import type { ReactNode } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import { browserIcons } from "../icons/mod.ts";
import type { Bookmarks } from "./bookmarks.ts";
import { Favicon } from "./favicon.tsx";
import type { OpenMenu } from "./overlay-menu.ts";

interface BookmarkMenuProps {
  bookmarks: Bookmarks;
  /** 아직 view가 안 열렸으면 null이다. 단추는 잠긴다. */
  viewSession: string | null;
  /** overlay로 연다. 없는 창이면 null이고 DOM Menu로 그린다. */
  openMenu: OpenMenu | null;
  open(url: string): void;
  /** DOM Menu가 열린 동안만 부른다. */
  onOpenChange(open: boolean): void;
}

export function BookmarkMenu(props: BookmarkMenuProps) {
  const { bookmarks } = props;
  const items: {
    id: string;
    label: string;
    textValue?: string;
    disabled?: boolean;
    favicon?: string;
    leading?: ReactNode;
  }[] = bookmarks.state === "corrupt"
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
      favicon: item.favicon,
      leading: (
        <MenuIcon>
          <Favicon src={item.favicon} />
        </MenuIcon>
      ),
    }));
  const label = t("browser.button.bookmarks");
  const disabled = props.viewSession === null || bookmarks.state === "loading";
  const pick = (id: string | null) => {
    const picked = bookmarks.bookmarks.find((item) => item.id === id);
    if (picked !== undefined) props.open(picked.url);
  };
  const { openMenu } = props;
  if (openMenu !== null) {
    return (
      <IconButton
        icon={browserIcons.bookmarks}
        label={label}
        size="sm"
        disabled={disabled}
        onClick={(event) => {
          // 한도를 넘는 항목은 overlay가 받지 못한다. openMenu가 앞의 64개만 보내고, 나머지는 palette와 새 탭 목록에서 연다.
          void openMenu(
            event.currentTarget,
            label,
            items.map((item) => ({
              id: item.id,
              label: item.label.slice(0, 256),
              disabled: item.disabled,
              ...(item.favicon === undefined ? {} : { image: item.favicon }),
            })),
          ).then(pick);
        }}
      />
    );
  }
  return (
    <Menu
      items={items}
      onSelect={pick}
      onOpenChange={props.onOpenChange}
      placement="beside"
      trigger={
        <IconButton
          icon={browserIcons.bookmarks}
          label={label}
          size="sm"
          disabled={disabled}
        />
      }
    />
  );
}
