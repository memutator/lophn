// browser 탭 위쪽 줄: 뒤로·앞으로·새로 고침, 주소 칸, 별, bookmark menu, [Open in browser], overflow menu.
// 단추는 오른쪽 끝 고정 열에 둔다. 아이콘은 icons/browser.ts만 쓴다.
// Ctrl/Cmd+D는 focus가 page에 있으면 main이 event로 보내고(`bookmarkKey`), toolbar에 있으면 여기서 받는다.
import { useId, useState } from "react";
import { FieldContext, Input } from "@lophn/ui/input";
import { IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { BrowserViewState, LophnBrowserApi } from "../../ipc/browser.ts";
import { currentPlatform } from "../desktop/top-bar/platform.ts";
import { browserIcons } from "../icons/mod.ts";
import { BookmarkMenu } from "./bookmark-menu.tsx";
import { BookmarkStar } from "./bookmark-star.tsx";
import type { Bookmarks } from "./bookmarks.ts";
import styles from "./browser-tab.module.css";

interface BrowserToolbarProps {
  browser: LophnBrowserApi;
  /** view가 아직 안 열렸으면 null이다. 단추와 주소 칸은 잠긴다. */
  viewSession: string | null;
  state: Pick<
    BrowserViewState,
    "url" | "title" | "canGoBack" | "canGoForward"
  >;
  bookmarks: Bookmarks;
  /** main이 page에서 받은 Ctrl/Cmd+D의 횟수. */
  bookmarkKey: number;
  /** 별이 알릴 거절 문장. 탭이 toolbar 아래에 띄운다. */
  onNotice(text: string): void;
  /** 이 탭에서 주소로 간다(bookmark menu). */
  onNavigate(url: string): void;
  /** 열 때 주소 칸에 focus를 둔다(빈 주소로 연 새 탭). */
  focusAddress: boolean;
  /** menu와 별 popover가 열려 있는 동안 native view가 가리지 않도록 탭이 view를 숨긴다. */
  onMenuOpenChange(open: boolean): void;
}

export function BrowserToolbar(props: BrowserToolbarProps) {
  const { browser, viewSession, state } = props;
  const id = useId();
  // null이면 사람이 고치는 중이 아니라 현재 url을 그대로 보인다.
  const [draft, setDraft] = useState<string | null>(null);
  const [keyPresses, setKeyPresses] = useState(0);

  const command = (name: "back" | "forward" | "reload" | "inspect") => {
    if (viewSession === null) return;
    void browser.command({ view_session: viewSession, command: name })
      .catch(() => {});
  };
  const submit = () => {
    if (viewSession === null || draft === null) return;
    // 거절이면 현재 url로 되돌린다. 받아들이면 state push가 새 url을 준다.
    void browser.navigate({ view_session: viewSession, input: draft })
      .catch(() => {})
      .finally(() => setDraft(null));
  };
  const openExternal = () => {
    const shell = (globalThis as {
      lophnShell?: { openExternal?(url: string): Promise<unknown> };
    }).lophnShell;
    void shell?.openExternal?.(state.url);
  };

  return (
    <div
      className={styles.toolbar}
      data-browser-toolbar=""
      onKeyDown={(event) => {
        const mac = currentPlatform() === "mac";
        if (
          event.key.toLowerCase() === "d" &&
          (mac
            ? event.metaKey && !event.ctrlKey
            : event.ctrlKey && !event.metaKey) &&
          !event.altKey && !event.shiftKey
        ) {
          event.preventDefault();
          setKeyPresses((count) => count + 1);
        }
      }}
    >
      <IconButton
        icon={browserIcons.back}
        label={t("browser.button.back")}
        size="sm"
        disabled={viewSession === null || !state.canGoBack}
        onClick={() => command("back")}
      />
      <IconButton
        icon={browserIcons.forward}
        label={t("browser.button.forward")}
        size="sm"
        disabled={viewSession === null || !state.canGoForward}
        onClick={() => command("forward")}
      />
      <IconButton
        icon={browserIcons.reload}
        label={t("browser.button.reload")}
        size="sm"
        disabled={viewSession === null}
        onClick={() => command("reload")}
      />
      <div className={styles.address}>
        {/* 글머리 label 없이 한 줄에 놓으므로 Field 대신 context만 준다. 이름은 aria-label이 맡는다. */}
        <FieldContext.Provider value={{ id, invalid: false }}>
          <Input
            size="sm"
            type="text"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            autoFocus={props.focusAddress}
            aria-label={t("browser.label.address")}
            placeholder={t("browser.label.address-placeholder")}
            disabled={viewSession === null}
            value={draft ?? state.url}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={() => setDraft(null)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
              else if (event.key === "Escape") setDraft(null);
            }}
          />
        </FieldContext.Provider>
      </div>
      <BookmarkStar
        bookmarks={props.bookmarks}
        url={state.url}
        title={state.title}
        presses={props.bookmarkKey + keyPresses}
        onNotice={props.onNotice}
        onOpenChange={props.onMenuOpenChange}
      />
      <BookmarkMenu
        bookmarks={props.bookmarks}
        viewSession={viewSession}
        open={props.onNavigate}
        onOpenChange={props.onMenuOpenChange}
      />
      <IconButton
        icon={browserIcons.openExternal}
        label={t("browser.button.open-external")}
        size="sm"
        disabled={state.url === ""}
        onClick={openExternal}
      />
      <Menu
        items={[{
          id: "inspect",
          label: t("browser.button.inspect"),
          leading: <MenuIcon icon={browserIcons.inspect} />,
          disabled: viewSession === null,
        }]}
        onSelect={() => command("inspect")}
        onOpenChange={props.onMenuOpenChange}
        placement="beside"
        trigger={
          <IconButton
            icon={browserIcons.more}
            label={t("browser.button.more")}
            size="sm"
          />
        }
      />
    </div>
  );
}
