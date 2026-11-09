// 빠른 실행 단추 줄(Terminal · Browser · App · Search와 고정 앱 panel). 앞 셋은 hover 목록이 있다.
// 작업 표시줄이 켜져 있으면 작업 표시줄 왼쪽 끝에, 꺼져 있으면 왼쪽 sidebar 맨 아래에 선다.
import { t } from "@lophn/i18n";
import { Popover, PopoverRow, Tooltip } from "@lophn/ui/overlay";
import { Icon, IconButton } from "@lophn/ui/primitives";
import type { LucideIcon } from "lucide-react";
import { Fragment, type ReactElement, type ReactNode } from "react";

import { useAppIcon } from "../app-frame/app-icon.tsx";
import { IconImage } from "../parts/icon-upload/icon-image.tsx";
import { useKeyLabel } from "../commands/react.tsx";
import { appPanelBindingId } from "../../ipc/keybindings.ts";
import { browserIcons, shellIcons, workspaceIcons } from "../icons/mod.ts";
import { type HoverSection, Keyed, sectionHeading } from "./agent-sections.tsx";
import styles from "./quick-launch.module.css";

/** 고정한 앱 panel 단추. id는 `order`의 id다. */
export interface QuickPinButton {
  id: string;
  app: string;
  /** 단추가 여는 앱 panel 화면. 사람이 단 단축키(`appPanelBindingId`)를 찾는 데 쓴다. */
  surface: string;
  label: string;
  onOpen: () => void;
}

/** 빠른 실행 단추에 hover하면 뜨는 목록의 한 줄. 누르면 바로 연다. */
export interface QuickHoverItem {
  id: string;
  label: string;
  /** 줄 앞 아이콘(앱 icon, favicon, vendor 아이콘). */
  leading: ReactNode;
  onSelect: () => void;
}

/** 맨 아래 줄의 빠른 실행. 핸들러·항목이 없는 단추는 그리지 않는다. */
export interface QuickLaunch {
  /** 단추 id(terminal · browser · app · search · 고정 id)의 순서. 없으면 기본 순서에 고정 없음이다. 모르는 id는 건너뛴다. */
  order?: readonly string[];
  pins?: readonly QuickPinButton[];
  onTerminal?: () => void;
  /** Terminal hover: 즐겨찾기한 coding agent. 누르면 그 명령어로 새 터미널이다. */
  terminalItems?: readonly QuickHoverItem[];
  /** Terminal hover: project의 명령. coding agent 묶음 다음의 "Commands" 묶음이다. */
  terminalCommands?: readonly QuickHoverItem[];
  onBrowser?: () => void;
  /** Browser hover: bookmark. 누르면 그 주소로 새 browser 탭이다. */
  browserItems?: readonly QuickHoverItem[];
  /** Search 탭(project) 또는 팔레트(Home 등 검색 탭이 없는 workspace). */
  onSearch?: () => void;
  /** App 단추 누르기: 앱을 고르는 앱 panel 탭. */
  onApp?: () => void;
  /** App hover: 앱 화면(앱 workspace)과 앱 panel 화면. 둘 다 없으면 단추가 없다. */
  appItems?: readonly QuickHoverItem[];
}

function QuickPin({ pin }: { pin: QuickPinButton }) {
  // 앱이 선언한 icon이 없으면 기본 앱 panel 아이콘이다.
  const icon = useAppIcon(pin.app);
  const keys = useKeyLabel()(appPanelBindingId(pin.app, pin.surface));
  return (
    <Tooltip
      content={
        keys === null ? pin.label : <Keyed label={pin.label} keys={keys} />
      }
    >
      <button
        type="button"
        className={styles.quickPin}
        aria-label={pin.label}
        data-quick-pin={pin.app}
        onClick={pin.onOpen}
      >
        {icon === undefined ? (
          <Icon icon={workspaceIcons.appPanel} pixels={16} />
        ) : (
          <IconImage src={icon} size={16} />
        )}
      </button>
    </Tooltip>
  );
}

/** pointer를 올리면 묶음 목록이 뜨는 단추. 누르기는 단추 자기 일이다. 빈 묶음은 그리지 않는다. */
export function HoverList({
  id,
  trigger,
  sections,
  tip,
}: {
  id: string;
  trigger: ReactElement;
  sections: readonly HoverSection[];
  /** 목록이 없을 때 trigger의 tooltip. */
  tip?: ReactNode;
}) {
  const shown = sections.filter((section) => section.items.length > 0);
  if (shown.length === 0) {
    return tip == null ? trigger : <Tooltip content={tip}>{trigger}</Tooltip>;
  }
  return (
    <Popover hover trigger={trigger}>
      {shown.map((section, index) => (
        <Fragment key={section.id}>
          {index === 0 ? null : <div className={styles.quickHoverDivider} />}
          <div className={styles.quickHoverHead} data-quick-hover={id}>
            {sectionHeading(section)}
          </div>
          {section.items.map((item) => (
            <PopoverRow key={item.id} onSelect={item.onSelect}>
              <span className={styles.quickHoverIcon}>{item.leading}</span>
              <span className={styles.quickHoverLabel}>{item.label}</span>
            </PopoverRow>
          ))}
        </Fragment>
      ))}
    </Popover>
  );
}

/** 빠른 실행 단추. hover 목록이 있으면 pointer를 올릴 때 그 목록이 뜬다. */
function QuickButton({
  id,
  icon,
  label,
  keys,
  items,
  moreSections = [],
  onClick,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  keys?: string | null;
  items?: readonly QuickHoverItem[];
  moreSections?: readonly HoverSection[];
  onClick?: () => void;
}) {
  return (
    <HoverList
      id={id}
      trigger={
        <IconButton
          icon={icon}
          label={label}
          size="sm"
          data-quick={id}
          onClick={onClick}
        />
      }
      sections={[
        { id, heading: label, keys, items: items ?? [] },
        ...moreSections,
      ]}
      tip={keys == null ? null : <Keyed label={label} keys={keys} />}
    />
  );
}

const DEFAULT_QUICK = ["terminal", "browser", "app", "search"] as const;

export function QuickLaunchRow({ quick }: { quick?: QuickLaunch }) {
  const keyLabel = useKeyLabel();
  const quickButtons: Record<string, ReactNode> = {
    terminal:
      quick?.onTerminal === undefined ? null : (
        <QuickButton
          id="terminal"
          keys={keyLabel("new.terminal")}
          icon={workspaceIcons.terminal}
          label={t("left-sidebar.button.quick-terminal")}
          items={quick.terminalItems}
          moreSections={[
            {
              id: "terminal-commands",
              heading: t("left-sidebar.heading.commands"),
              items: quick.terminalCommands ?? [],
            },
          ]}
          onClick={quick.onTerminal}
        />
      ),
    browser:
      quick?.onBrowser === undefined ? null : (
        <QuickButton
          id="browser"
          keys={keyLabel("new.browser")}
          icon={browserIcons.globe}
          label={t("left-sidebar.button.quick-browser")}
          items={quick.browserItems}
          onClick={quick.onBrowser}
        />
      ),
    app:
      quick?.onApp === undefined &&
      (quick?.appItems ?? []).length === 0 ? null : (
        <QuickButton
          id="app"
          icon={workspaceIcons.appPanel}
          label={t("left-sidebar.button.quick-app")}
          items={quick?.appItems}
          onClick={quick?.onApp}
        />
      ),
    search:
      quick?.onSearch === undefined ? null : (
        <QuickButton
          id="search"
          keys={keyLabel("search.open")}
          icon={shellIcons.search}
          label={t("left-sidebar.button.quick-search")}
          onClick={quick.onSearch}
        />
      ),
    ...Object.fromEntries(
      (quick?.pins ?? []).map((pin) => [pin.id, <QuickPin pin={pin} />]),
    ),
  };
  return (
    <>
      {(quick?.order ?? DEFAULT_QUICK).map((id) => (
        <Fragment key={id}>{quickButtons[id] ?? null}</Fragment>
      ))}
    </>
  );
}
