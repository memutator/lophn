// browser 탭의 머리: 뒤로·앞으로·새로 고침, 주소 칸, 별, bookmark menu, [Open in browser], DevTools menu.
// card 안이면 이것을 card 머리 줄에 올린다(shell/card-head.tsx). ← → ⟳는 card의 nav, 주소 칸이 경로 자리,
// 별·bookmark·Open in browser가 ⋯ 앞, DevTools(Inspector, 열려 있으면 자리 고르기와 닫기)가 ⋯ 메뉴의 맨 위 묶음이다.
// card 밖(floated 탭, detached 창)이면 탭 본문 위에 줄로 그리고 DevTools menu는 그 줄의 ⋮다. 아이콘은 icons/browser.ts만 쓴다.
// Ctrl/Cmd+D는 focus가 page에 있으면 main이 event로 보내고(`bookmarkKey`), 머리에 있으면 여기서 받는다.
import {
  type KeyboardEvent,
  type MouseEventHandler,
  useId,
  useRef,
  useState,
} from "react";
import { FieldContext, Input } from "@lophn/ui/input";
import { IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import type { BrowserViewState, LophnBrowserApi } from "../../ipc/browser.ts";
import type { DevtoolsPlace } from "../workspace/kinds/browser-devtools.tsx";
import { currentPlatform } from "../desktop/top-bar/platform.ts";
import { browserIcons } from "../icons/mod.ts";
import { useCardHead } from "../shell/card-head.tsx";
import { BookmarkMenu } from "./bookmark-menu.tsx";
import { BookmarkStar } from "./bookmark-star.tsx";
import { useInDetachedWindow } from "./detached-window.ts";
import type { Bookmarks } from "./bookmarks.ts";
import { useOverlayMenu } from "./overlay-menu.ts";
import styles from "./browser-tab.module.css";

interface BrowserChromeProps {
  browser: LophnBrowserApi;
  /** view가 아직 안 열렸으면 null이다. 단추와 주소 칸은 잠긴다. */
  viewSession: string | null;
  state: Pick<
    BrowserViewState,
    "url" | "title" | "favicon" | "canGoBack" | "canGoForward"
  >;
  bookmarks: Bookmarks;
  /** main이 page에서 받은 Ctrl/Cmd+D의 횟수. */
  bookmarkKey: number;
  /** 별이 알릴 거절 문장. 탭이 머리 아래에 띄운다. */
  onNotice(text: string): void;
  /** 이 탭에서 주소로 간다(bookmark menu). */
  onNavigate(url: string): void;
  /** 열 때 주소 칸에 focus를 둔다(빈 주소로 연 새 탭). */
  focusAddress: boolean;
  /** DOM menu와 별 popover가 열려 있는 동안 native view가 가리지 않도록 탭이 view를 숨긴다. overlay menu는 view 위에 그려져 부르지 않는다. */
  onMenuOpenChange(open: boolean): void;
  /** 크기 준 popup의 native view 탭. DOM popover가 page 밑에 깔리므로 별 popover를 overlay로 연다. */
  native: boolean;
  /** 지금 DevTools 자리. null이면 닫혀 있다. */
  devtools: DevtoolsPlace | null;
  onDevtools(action: DevtoolsPlace | "open" | "close"): void;
  /** 다른 workspace에 가도 이 탭의 page를 다시 load하지 않고 살려 두는지(사람이 켠다). */
  keepAlive: boolean;
  onKeepAlive(on: boolean): void;
}

type DevtoolsAction = DevtoolsPlace | "open" | "close";

const KEEP_ALIVE_ITEM = "keep-alive";

const DEVTOOLS_ITEMS = [
  {
    id: "right",
    label: "browser.button.devtools-right",
    icon: browserIcons.devtoolsRight,
  },
  {
    id: "bottom",
    label: "browser.button.devtools-bottom",
    icon: browserIcons.devtoolsBottom,
  },
  {
    id: "float",
    label: "browser.button.devtools-float",
    icon: browserIcons.devtoolsFloat,
  },
  {
    id: "window",
    label: "browser.button.devtools-window",
    icon: browserIcons.devtoolsWindow,
  },
  {
    id: "close",
    label: "browser.button.devtools-close",
    icon: browserIcons.devtoolsClose,
  },
] as const;

function isBookmarkKey(event: KeyboardEvent): boolean {
  const mac = currentPlatform() === "mac";
  return (
    event.key.toLowerCase() === "d" &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

// 주소 칸. 고치는 글(draft)은 이 칸이 든다. null이면 현재 url을 그대로 보인다.
function AddressField(props: {
  url: string;
  disabled: boolean;
  autoFocus: boolean;
  onSubmit(input: string): Promise<void>;
  onBookmarkKey(): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div
      className={styles.address}
      data-browser-address=""
      onKeyDown={(event) => {
        if (!isBookmarkKey(event)) return;
        event.preventDefault();
        props.onBookmarkKey();
      }}
    >
      {/* 글머리 label 없이 한 줄에 놓으므로 Field 대신 context만 준다. 이름은 aria-label이 맡는다. */}
      <FieldContext.Provider value={{ id, invalid: false }}>
        <Input
          size="sm"
          type="text"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          autoFocus={props.autoFocus}
          aria-label={t("browser.label.address")}
          placeholder={t("browser.label.address-placeholder")}
          disabled={props.disabled}
          value={draft ?? props.url}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft !== null) {
              // 거절이면 현재 url로 되돌린다. 받아들이면 state push가 새 url을 준다.
              void props.onSubmit(draft).finally(() => setDraft(null));
            } else if (event.key === "Escape") setDraft(null);
          }}
        />
      </FieldContext.Provider>
    </div>
  );
}

// 별·bookmark menu·[Open in browser]. menu는 native view가 있는 창에서는 overlay로 연다.
function PageActions(props: {
  chrome: BrowserChromeProps;
  presses: number;
  onBookmarkKey(): void;
}) {
  const { viewSession, state } = props.chrome;
  const openMenu = useOverlayMenu();
  const openExternal = () => {
    const shell = (
      globalThis as {
        lophnShell?: { openExternal?(url: string): Promise<unknown> };
      }
    ).lophnShell;
    void shell?.openExternal?.(state.url);
  };
  return (
    <div
      className={styles.actions}
      onKeyDown={(event) => {
        if (!isBookmarkKey(event)) return;
        event.preventDefault();
        props.onBookmarkKey();
      }}
    >
      <BookmarkStar
        bookmarks={props.chrome.bookmarks}
        url={state.url}
        title={state.title}
        favicon={state.favicon}
        presses={props.presses}
        onNotice={props.chrome.onNotice}
        openOverlay={props.chrome.native ? openMenu : null}
        onOpenChange={props.chrome.onMenuOpenChange}
      />
      <BookmarkMenu
        bookmarks={props.chrome.bookmarks}
        viewSession={viewSession}
        openMenu={openMenu}
        open={props.chrome.onNavigate}
        onOpenChange={props.chrome.onMenuOpenChange}
      />
      <IconButton
        icon={browserIcons.openExternal}
        label={t("browser.button.open-external")}
        size="sm"
        disabled={state.url === ""}
        onClick={openExternal}
      />
    </div>
  );
}

export function BrowserChrome(props: BrowserChromeProps) {
  const { browser, viewSession, state } = props;
  const [keyPresses, setKeyPresses] = useState(0);
  // 머리에 올린 spec의 callback은 deps에 없는 최신 props를 읽는다.
  const latest = useRef(props);
  latest.current = props;
  // overlay가 없는 창(dev mock, gallery)이면 null이고, menu는 DOM으로 그린다.
  const openMenu = useOverlayMenu();
  const detached = useInDetachedWindow();

  const command = (name: "back" | "forward" | "reload") => {
    if (viewSession === null) return;
    void browser
      .command({ view_session: viewSession, command: name })
      .catch(() => {});
  };
  const bookmarkKey = () => setKeyPresses((count) => count + 1);

  // DevTools가 닫혀 있으면 열기 하나, 열려 있으면 자리 고르기와 닫기. 지금 자리는 잠근다.
  const devtoolsItems =
    props.devtools === null
      ? [
          {
            id: "open" as DevtoolsAction,
            label: t("browser.button.inspect"),
            icon: browserIcons.inspect,
            disabled: viewSession === null,
          },
        ]
      : DEVTOOLS_ITEMS.filter((item) => !detached || item.id !== "float").map(
          (item) => ({
            id: item.id as DevtoolsAction,
            label: t(item.label),
            icon: item.icon,
            disabled: item.id === props.devtools,
          }),
        );
  // DevTools 항목 아래에 두는 탭 설정. 끌 수 있어야 하므로 켜져 있어도 늘 누를 수 있다.
  const menuItems = [
    ...devtoolsItems,
    {
      id: KEEP_ALIVE_ITEM as string,
      label: t(
        props.keepAlive
          ? "browser.button.keep-alive-on"
          : "browser.button.keep-alive",
      ),
      icon: browserIcons.keepAlive,
      disabled: false,
      separatorBefore: true,
    },
  ];
  const pick = (id: string) => {
    if (id === KEEP_ALIVE_ITEM) {
      latest.current.onKeepAlive(!latest.current.keepAlive);
      return;
    }
    const found = devtoolsItems.find((item) => item.id === id);
    if (found !== undefined && !found.disabled) {
      latest.current.onDevtools(found.id);
    }
  };

  const address = (
    <AddressField
      url={state.url}
      disabled={viewSession === null}
      autoFocus={props.focusAddress}
      onSubmit={(input) => {
        const session = latest.current.viewSession;
        if (session === null) return Promise.resolve();
        return latest.current.browser
          .navigate({ view_session: session, input })
          .then(
            () => {},
            () => {},
          );
      }}
      onBookmarkKey={bookmarkKey}
    />
  );
  const actions = (
    <PageActions
      chrome={props}
      presses={props.bookmarkKey + keyPresses}
      onBookmarkKey={bookmarkKey}
    />
  );

  const inCard = useCardHead(
    {
      nav: {
        canBack: viewSession !== null && state.canGoBack,
        canForward: viewSession !== null && state.canGoForward,
        onBack: () => command("back"),
        onForward: () => command("forward"),
        onReload: () => command("reload"),
        reloadDisabled: viewSession === null,
      },
      center: address,
      actions,
      menu: {
        // id는 탭 기본 항목(close, float)과 겹치지 않게 접두어를 단다.
        items: menuItems.map((item) => ({
          id: `devtools:${item.id}`,
          label: item.label,
          leading: <MenuIcon icon={item.icon} />,
          disabled: item.disabled,
          ...("separatorBefore" in item ? { separatorBefore: true } : {}),
        })),
        onSelect: (id) => pick(id.slice("devtools:".length)),
        onOpenChange: props.onMenuOpenChange,
      },
    },
    [
      browser,
      viewSession,
      state.url,
      state.title,
      state.favicon,
      state.canGoBack,
      state.canGoForward,
      props.bookmarks,
      props.bookmarkKey,
      keyPresses,
      props.devtools,
      props.keepAlive,
      props.focusAddress,
      props.native,
      detached,
    ],
  );
  if (inCard) return null;

  const moreButton = (onClick?: MouseEventHandler<HTMLButtonElement>) => (
    <IconButton
      icon={browserIcons.more}
      label={t("browser.button.more")}
      size="sm"
      onClick={onClick}
    />
  );
  return (
    <div className={styles.toolbar} data-browser-toolbar="">
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
      {address}
      {actions}
      {openMenu === null ? (
        <Menu
          items={menuItems.map((item) => ({
            id: item.id,
            label: item.label,
            leading: <MenuIcon icon={item.icon} />,
            disabled: item.disabled,
            ...("separatorBefore" in item ? { separatorBefore: true } : {}),
          }))}
          onSelect={pick}
          onOpenChange={props.onMenuOpenChange}
          placement="beside"
          trigger={moreButton()}
        />
      ) : (
        moreButton((event) => {
          void openMenu(
            event.currentTarget,
            t("browser.button.more"),
            menuItems.map((item) => ({
              id: item.id,
              label: item.label,
              disabled: item.disabled,
            })),
          ).then((picked) => {
            if (picked !== null) pick(picked);
          });
        })
      )}
    </div>
  );
}
