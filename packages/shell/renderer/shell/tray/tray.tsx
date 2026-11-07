// tray. 작업 표시줄 오른쪽(꺼져 있으면 title bar의 panel 탭 옆)에 설치된 앱의 `tray` 화면마다(사람이 끈 것은 빼고) 항목 하나가 선다: 앱 아이콘과 앱이 낸
// 짧은 글(tone 색). 누르면 그 앱의 `tray` 화면이 항목 위(title bar면 아래)에 popup으로 뜬다. 바깥을 누르거나 창이 focus를 잃거나 Esc를 누르면 닫힌다.
// popup 머리의 pin을 켜면 바깥 누르기·창 blur·다른 항목 누르기로 닫히지 않는다(Esc와 자기 항목 다시 누르기는 닫는다). pin은 메모리에만 있다.
// popup은 자기 <webview> 그릇을 가진다: 닫으면 화면도 닫히고 다시 열면 새로 load된다.
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { t } from "@lophn/i18n";
import { Tooltip } from "@lophn/ui/overlay";
import { IconButton } from "@lophn/ui/primitives";

import type { TrayTone, TrayValue } from "../../../../protocol/apps/tray.ts";
import { AppTabIcon } from "../../app-frame/app-icon.tsx";
import {
  type AppScreens,
  type ScreensRead,
  useAppViews,
  useAppWorkspace,
} from "../../app-frame/app-views.tsx";
import {
  HeadControls,
  HeadSlotScope,
  useHeadSlot,
} from "../../app-frame/app-tab-head.tsx";
import { EmbeddedView } from "../../app-frame/embedded-view.tsx";
import {
  createWebviewHost,
  WebviewHostProvider,
  WebviewLayer,
} from "../../app-frame/webview-host.tsx";
import { shellIcons } from "../../icons/mod.ts";
import {
  byTrayOrder,
  type SidebarPanelPick,
} from "../../desktop/settings/quick-launch/source.ts";
import {
  type PopupContent,
  type PopupPlace,
  type PopupSize,
  placePopup,
} from "./popup-place.ts";
import styles from "./tray.module.css";
import { useTrayValues } from "./use-tray-values.ts";

export interface TrayItem {
  readonly key: string;
  readonly app: string;
  /** 화면을 열 때 고정하는 판. */
  readonly release: string;
  readonly screen: string;
  /** 앱 이름과 화면 이름. 값이 없을 때 title과 접근성 이름이다. */
  readonly title: string;
  readonly label: string;
  readonly text?: string;
  readonly tone?: TrayTone;
  /** 앱이 선언한 popup 크기(px). 없는 쪽은 기본값이다. */
  readonly size?: PopupSize;
}

/** 설치된 앱의 `tray` 자리 화면 가운데 사람이 끄지 않은 것을 사람이 정한 순서로. 앱이 지워졌거나 화면이 없어졌으면 빠진다. */
export function trayItems(
  off: readonly SidebarPanelPick[],
  order: readonly SidebarPanelPick[],
  screens: ScreensRead | null,
  values: readonly TrayValue[],
): readonly TrayItem[] {
  if (screens === null || !screens.ok) return [];
  const items = screens.value.flatMap((app: AppScreens) =>
    app.screens.flatMap((screen) => {
      if (!screen.places.includes("tray")) return [];
      if (
        off.some((item) => item.app === app.app && item.screen === screen.key)
      )
        return [];
      const value = values.find((item) => item.app === app.app);
      return [
        {
          key: `${app.app}:${screen.key}`,
          app: app.app,
          release: app.release,
          screen: screen.key,
          title: t("app-panel.label.screen", {
            app: app.name,
            screen: screen.label,
          }),
          label: screen.label,
          ...(screen.tray === undefined ? {} : { size: screen.tray }),
          ...(value === undefined
            ? {}
            : { text: value.text, tone: value.tone }),
        },
      ];
    }),
  );
  return byTrayOrder(items, order);
}

function PopupBody({ item }: { item: TrayItem }) {
  const deps = useAppViews();
  const workspace = useAppWorkspace();
  if (deps === null) return null;
  return (
    <EmbeddedView
      views={deps.views}
      app={item.app}
      mode="live"
      release={item.release}
      screen={item.screen}
      place="tray"
      workspace={workspace}
      label={item.label}
      tabHead
    />
  );
}

function Popup({
  item,
  place,
  side,
  pinned,
  onPin,
  onClose,
  onContent,
  anchor,
}: {
  item: TrayItem;
  place: PopupPlace;
  /** 앱 page가 알린 내용 크기에 머리 줄을 더한 popup 전체의 내용 크기. 범위로 선언한 쪽이 이것을 따른다. */
  onContent: (content: PopupContent) => void;
  side: "above" | "below";
  pinned: boolean;
  onPin: (pinned: boolean) => void;
  onClose: () => void;
  /** 항목 단추들의 묶음. 여기를 누르는 것은 바깥이 아니다(단추가 열고 닫는다). */
  anchor: HTMLElement | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  // popup마다 자기 그릇을 가진다. 닫으면 그릇과 안의 화면이 함께 사라진다.
  const host = useMemo(() => createWebviewHost(), []);
  // 앱 화면이 useTabHead로 올린 머리 줄은 제목과 pin 사이에 그린다(card 칸이 없는 자리라 여기가 받는다).
  const [head, setHead] = useHeadSlot();
  const headRow = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      host.onContentSize((size) =>
        onContent({
          // 지금 너비에 모자란 만큼을 더한다. 넘치지 않으면 지금 너비 그대로라 줄지 않는다.
          width: (box.current?.offsetWidth ?? 0) + size.overflow,
          height: size.height + (headRow.current?.offsetHeight ?? 0),
        }),
      ),
    [host, onContent],
  );
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (pinned) return;
      const target = event.target as Node;
      if (!box.current?.contains(target) && !anchor?.contains(target))
        onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // 다른 화면의 <webview> 안을 누르면 DOM pointer event가 오지 않고 focus만 옮겨 간다.
    const blur = () =>
      setTimeout(() => {
        if (pinned) return;
        if (!box.current?.contains(document.activeElement)) onClose();
      }, 0);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", blur);
    };
  }, [anchor, onClose, pinned]);
  return createPortal(
    <div
      ref={box}
      className={styles.popup}
      role="dialog"
      aria-label={item.title}
      data-tray-popup={item.key}
      data-side={side}
      style={place}
    >
      <div ref={headRow} className={styles.head}>
        <span className={styles.title}>{item.title}</span>
        {head?.center === undefined ? <span className={styles.grow} /> : null}
        <HeadControls spec={head} />
        <IconButton
          icon={shellIcons.pin}
          label={t(
            pinned ? "shell.button.tray-unpin" : "shell.button.tray-pin",
          )}
          size="sm"
          aria-pressed={pinned}
          data-tray-pin=""
          onClick={() => onPin(!pinned)}
        />
      </div>
      <WebviewHostProvider value={host}>
        <div className={styles.body}>
          <HeadSlotScope set={setHead} actionsOnly>
            <PopupBody item={item} />
          </HeadSlotScope>
        </div>
        <WebviewLayer host={host} />
      </WebviewHostProvider>
    </div>,
    document.body,
  );
}

export function Tray({
  items,
  side,
  iconOnly = false,
  open: initialOpen = null,
}: {
  items: readonly TrayItem[];
  /** popup이 항목 위(작업 표시줄)에 뜨는지 아래(title bar)에 뜨는지. */
  side: "above" | "below";
  /** title bar는 좁아서 글 없이 아이콘만 그린다. 글은 접근성 이름에 남는다. */
  iconOnly?: boolean;
  /** 처음부터 열려 있는 항목의 key(gallery). */
  open?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [place, setPlace] = useState<PopupPlace | null>(null);
  // 열린 항목의 앱 page가 알린 내용 크기. 다른 항목을 열면 버린다.
  const [content, setContent] = useState<{
    key: string;
    size: PopupContent;
  } | null>(null);
  const [pinned, setPinned] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const close = () => {
    setOpen(null);
    setPinned(false);
  };
  const current = items.find((item) => item.key === open) ?? null;
  const fitted =
    content !== null && content.key === current?.key ? content.size : undefined;
  const onContent = useCallback(
    (size: PopupContent) => {
      if (open === null) return;
      setContent((was) =>
        was?.key === open &&
        was.size.width === size.width &&
        was.size.height === size.height
          ? was
          : { key: open, size },
      );
    },
    [open],
  );
  // 열 때와 창 크기가 바뀔 때 항목의 가로 자리를 다시 잰다.
  useEffect(() => {
    const button =
      current === null ? undefined : buttons.current.get(current.key);
    if (button === undefined) {
      setPlace(null);
      return;
    }
    const measure = () =>
      setPlace(
        placePopup(
          button.getBoundingClientRect(),
          { width: window.innerWidth },
          current?.size,
          fitted,
        ),
      );
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [current, fitted]);
  if (items.length === 0) return null;
  return (
    <div
      ref={row}
      className={styles.tray}
      role="group"
      aria-label={t("shell.label.tray")}
      data-tray=""
    >
      {items.map((item) => (
        <Tooltip key={item.key} content={item.title}>
          <button
            ref={(node) => {
              if (node === null) buttons.current.delete(item.key);
              else buttons.current.set(item.key, node);
            }}
            type="button"
            className={styles.item}
            aria-label={
              item.text === undefined
                ? item.title
                : t("shell.label.tray-item", {
                    title: item.title,
                    text: item.text,
                  })
            }
            aria-expanded={open === item.key}
            data-tray-item={item.app}
            onClick={() => {
              // pin한 popup은 자기 항목으로만 닫는다. 다른 항목은 눌러도 바꾸지 않는다.
              if (open === item.key) close();
              else if (!pinned) setOpen(item.key);
            }}
          >
            <AppTabIcon app={item.app} />
            {item.text === undefined || iconOnly ? null : (
              <span className={styles.text} data-tone={item.tone}>
                {item.text}
              </span>
            )}
          </button>
        </Tooltip>
      ))}
      {current === null || place === null ? null : (
        <Popup
          key={current.key}
          item={current}
          place={place}
          side={side}
          anchor={row.current}
          pinned={pinned}
          onPin={setPinned}
          onClose={close}
          onContent={onContent}
        />
      )}
    </div>
  );
}

/** event로 값을 읽어 그리는 tray. 보일 화면이 없으면 아무것도 읽지 않는다. */
function ConnectedTray(props: TrayHostProps) {
  const values = useTrayValues();
  return (
    <Tray
      items={trayItems(props.off, props.order, props.screens, values)}
      side={props.side}
      iconOnly={props.side === "below"}
    />
  );
}

interface TrayHostProps {
  /** 사람이 끈 tray 화면. */
  off: readonly SidebarPanelPick[];
  /** 사람이 정한 tray 항목 순서. */
  order: readonly SidebarPanelPick[];
  screens: ScreensRead | null;
  /** 작업 표시줄이면 above, title bar면 below. */
  side: "above" | "below";
}

export function TrayHost(props: TrayHostProps): ReactNode {
  const items = trayItems(props.off, props.order, props.screens, []);
  return items.length === 0 ? null : <ConnectedTray {...props} />;
}
