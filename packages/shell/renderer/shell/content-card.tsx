// 가운데 둥근 card. 머리 줄(← →, 경로, 상태, ⋯ tab 메뉴)과 본문이고, split이면 반쪽마다 자기 머리 줄을 가진다.
// tab이 하나도 없으면 빈 desk 안내를 보인다. 본문은 호출자가 그려 넣는다.
import {
  Fragment,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { Menu } from "@lophn/ui/overlay";

import { shellIcons } from "../icons/mod.ts";
import { PATH_DRAG_TYPE } from "../workspace/drag.ts";
import {
  CardHeadContext,
  type CardHeadSetter,
  type CardHeadSpec,
} from "./card-head.tsx";
import styles from "./content-card.module.css";
import { clampSplitRatio, type SplitDir } from "./desk-model.ts";
import {
  type TabAction,
  type TabMenuState,
  tabMenuItems,
} from "./tab-menu.tsx";
import type { Side } from "./tab-strip.tsx";

export type { TabAction };

const DEFAULT_MENU: TabMenuState = {
  renamable: false,
  preview: false,
  file: false,
  canDetach: true,
  split: null,
  canSplit: true,
  hasOthers: true,
  hasRight: true,
};

export interface CardPane {
  /** tab key. */
  readonly key: string;
  /** 머리 줄의 경로. 마지막이 강조된다. */
  readonly crumbs: readonly string[];
  /** 경로 뒤 상태 글(예: "Ready"). 있으면 점이 붙는다. */
  readonly status?: string;
  /** ⋯ 메뉴가 이 tab에 보이는 항목. 주지 않으면 기본 항목이다. */
  readonly menu?: TabMenuState;
  readonly body: ReactNode;
}

export interface ContentCardProps {
  /** 0이면 빈 desk, 1이면 한 tab, 2면 split(a, b 차례). */
  panes: readonly CardPane[];
  /** split에서 강조할 쪽. */
  focus: Side;
  /** split의 방향. row는 좌우, column은 위아래. 주지 않으면 row다. */
  splitDir?: SplitDir;
  /** split에서 a의 몫(0.15~0.85). 주지 않으면 반반이다. */
  splitRatio?: number;
  /** 나누는 선을 끌어 놓았다. 끄는 동안은 card가 자기 몫을 그리고 놓을 때 한 번 부른다. */
  onSplitRatio?: (ratio: number) => void;
  /** 빈 desk 안내의 제목으로 쓰는 desk 이름. */
  deskLabel: string;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** split에서 반쪽을 눌렀다. */
  onFocus: (side: Side) => void;
  onAction: (action: TabAction, side: Side) => void;
  /** 빈 desk의 단추. */
  onEmptyAction: (action: "new-session" | "open-file") => void;
  /** Explorer의 파일을 card 위에 놓았다. 주지 않으면 받지 않는다. */
  onDropPath?: (path: string) => void;
}

export function ContentCard({
  panes,
  focus,
  splitDir = "row",
  splitRatio = 0.5,
  onSplitRatio,
  deskLabel,
  canBack,
  canForward,
  onBack,
  onForward,
  onFocus,
  onAction,
  onEmptyAction,
  onDropPath,
}: ContentCardProps) {
  const split = panes.length === 2;
  const [dropping, setDropping] = useState(false);
  const splitBox = useRef<HTMLDivElement>(null);
  // 끄는 동안의 몫. 놓을 때 onSplitRatio로 한 번만 저장한다.
  const [live, setLive] = useState<number | null>(null);
  const ratio = live ?? splitRatio;
  const dragRatio = (event: PointerEvent<HTMLElement>) => {
    const box = splitBox.current?.getBoundingClientRect();
    if (box === undefined) return null;
    return clampSplitRatio(
      splitDir === "row"
        ? (event.clientX - box.left) / box.width
        : (event.clientY - box.top) / box.height,
    );
  };
  // 본문이 올린 머리 줄(card-head.tsx). 칸 key별이고 본문이 사라지면 비워진다.
  const [heads, setHeads] = useState<Readonly<Record<string, CardHeadSpec>>>(
    {},
  );
  const setHead = useCallback((key: string, spec: CardHeadSpec | null) => {
    setHeads((now) => {
      if (spec === null) {
        if (!(key in now)) return now;
        const { [key]: _gone, ...rest } = now;
        return rest;
      }
      return { ...now, [key]: spec };
    });
  }, []);
  const body = (pane: CardPane) => (
    <HeadScope paneKey={pane.key} onHead={setHead}>
      {pane.body}
    </HeadScope>
  );
  const head = (pane: CardPane, side: Side) => (
    <CardHead
      pane={pane}
      spec={heads[pane.key]}
      canBack={canBack}
      canForward={canForward}
      onBack={onBack}
      onForward={onForward}
      onAction={(action) => onAction(action, side)}
    />
  );
  return (
    <div
      className={styles.card}
      data-drop={dropping || undefined}
      onDragOver={(event) => {
        if (!onDropPath || !event.dataTransfer.types.includes(PATH_DRAG_TYPE)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDropping(false);
        }
      }}
      onDrop={(event) => {
        setDropping(false);
        const path = event.dataTransfer.getData(PATH_DRAG_TYPE);
        if (!onDropPath || path === "") return;
        event.preventDefault();
        onDropPath(path);
      }}
    >
      {panes.length === 0 ? (
        <EmptyDesk label={deskLabel} onAction={onEmptyAction} />
      ) : split ? (
        <div
          ref={splitBox}
          className={styles.split}
          data-dir={splitDir}
          data-resizing={live !== null || undefined}
        >
          {panes.map((pane, index) => {
            const side: Side = index === 0 ? "a" : "b";
            return (
              <Fragment key={pane.key}>
                {index === 1 ? (
                  <div
                    className={styles.handle}
                    role="separator"
                    aria-orientation={
                      splitDir === "row" ? "vertical" : "horizontal"
                    }
                    aria-label={t("shell.label.split-resize")}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setLive(dragRatio(event));
                    }}
                    onPointerMove={(event) => {
                      if (live !== null) setLive(dragRatio(event));
                    }}
                    onPointerUp={(event) => {
                      if (live === null) return;
                      const done = dragRatio(event) ?? live;
                      setLive(null);
                      onSplitRatio?.(done);
                    }}
                    onPointerCancel={() => setLive(null)}
                    onDoubleClick={() => onSplitRatio?.(0.5)}
                  />
                ) : null}
                <section
                  className={styles.half}
                  style={{ flexGrow: index === 0 ? ratio : 1 - ratio }}
                  data-focused={focus === side || undefined}
                  onPointerDown={() => onFocus(side)}
                >
                  {head(pane, side)}
                  <div className={styles.body}>{body(pane)}</div>
                </section>
              </Fragment>
            );
          })}
        </div>
      ) : (
        <>
          {head(panes[0]!, "a")}
          <div className={styles.body}>{body(panes[0]!)}</div>
        </>
      )}
    </div>
  );
}

function HeadScope({
  paneKey,
  onHead,
  children,
}: {
  paneKey: string;
  onHead: (key: string, spec: CardHeadSpec | null) => void;
  children: ReactNode;
}) {
  const set = useMemo<CardHeadSetter>(
    () => (spec) => onHead(paneKey, spec),
    [paneKey, onHead],
  );
  return (
    <CardHeadContext.Provider value={set}>{children}</CardHeadContext.Provider>
  );
}

function CardHead({
  pane,
  spec,
  canBack,
  canForward,
  onBack,
  onForward,
  onAction,
}: {
  pane: CardPane;
  spec: CardHeadSpec | undefined;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onAction: (action: TabAction) => void;
}) {
  const nav = spec?.nav ?? { canBack, canForward, onBack, onForward };
  const extra = spec?.menu;
  return (
    <div className={styles.head}>
      <IconButton
        icon={shellIcons.back}
        label={t("shell.button.back")}
        size="sm"
        disabled={!nav.canBack}
        onClick={nav.onBack}
      />
      <IconButton
        icon={shellIcons.forward}
        label={t("shell.button.forward")}
        size="sm"
        disabled={!nav.canForward}
        onClick={nav.onForward}
      />
      {nav.onReload === undefined ? null : (
        <IconButton
          icon={shellIcons.reload}
          label={t("shell.button.reload")}
          size="sm"
          disabled={nav.reloadDisabled}
          onClick={nav.onReload}
        />
      )}
      {spec?.center === undefined ? (
        <>
          <span className={styles.crumbs}>
            {pane.crumbs.map((crumb, index) => (
              <span key={index} className={styles.crumb}>
                {index > 0 ? <span className={styles.sep}>/</span> : null}
                {crumb}
              </span>
            ))}
          </span>
          {pane.status === undefined ? null : (
            <span className={styles.status}>
              <span className={styles.ready} aria-hidden />
              {pane.status}
            </span>
          )}
          <span className={styles.grow} />
        </>
      ) : (
        <span className={styles.center}>{spec.center}</span>
      )}
      {spec?.actions}
      <Menu
        placement="corner-end"
        onOpenChange={extra?.onOpenChange}
        onSelect={(id) => {
          if (extra?.items.some((item) => item.id === id)) extra.onSelect(id);
          else onAction(id as TabAction);
        }}
        items={tabMenuItems(pane.menu ?? DEFAULT_MENU, extra?.items)}
        trigger={
          <IconButton
            icon={shellIcons.more}
            label={t("shell.button.tab-menu")}
            size="sm"
            data-tab-menu=""
          />
        }
      />
    </div>
  );
}

function EmptyDesk({
  label,
  onAction,
}: {
  label: string;
  onAction: (action: "new-session" | "open-file") => void;
}) {
  return (
    <div className={styles.empty}>
      <Icon icon={shellIcons.desk} pixels={24} />
      <p className={styles.emptyTitle}>{label}</p>
      <p className={styles.emptyText}>{t("shell.label.empty-desk")}</p>
      <span className={styles.emptyActions}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onAction("new-session")}
        >
          <Icon icon={shellIcons.newSession} pixels={14} />
          {t("shell.button.empty-new-session")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onAction("open-file")}
        >
          <Icon icon={shellIcons.folder} pixels={14} />
          {t("shell.button.empty-open-file")}
        </Button>
      </span>
    </div>
  );
}
