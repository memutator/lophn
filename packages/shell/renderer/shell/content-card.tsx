// 가운데 둥근 card. 머리 줄(← →, 경로, 상태, ⋯ tab 메뉴)과 본문이고, group이면 leaf마다 자기 머리 줄을 가진다.
// tab이 하나도 없으면 빈 desk 안내를 보인다. 본문은 호출자가 그려 넣는다.
//
// 칸(pane)은 tab key로 key를 준 평평한 absolute 상자이고 자리는 group tree에서 계산한다(group-geometry.ts). tree가
// 바뀌어도 칸의 React 부모가 같아 본문이 다시 mount되지 않는다. DOM 순서도 tab key 순으로 고정해 옮겨지지 않는다.
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { t } from "@lophn/i18n";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { Menu, Popover } from "@lophn/ui/overlay";

import { shellIcons } from "../icons/mod.ts";
import { PATH_DRAG_TYPE } from "../workspace/drag.ts";
import {
  CardHeadContext,
  type CardHeadSetter,
  type CardHeadSpec,
} from "./card-head.tsx";
import styles from "./content-card.module.css";
import { useTabDrag } from "./tab-drag.tsx";
import { type GroupNode, type NodePath, setNodeRatio } from "./desk-model.ts";
import { dragRatio, FULL, placeGroup } from "./group-geometry.ts";
import {
  type TabAction,
  type TabMenuState,
  tabMenuItems,
} from "./tab-menu.tsx";

export type { TabAction };

const DEFAULT_MENU: TabMenuState = {
  renamable: false,
  preview: false,
  file: false,
  canDetach: true,
  group: 0,
  canSplit: true,
  hasOthers: true,
  hasRight: true,
};

export interface CardPane {
  /** tab key. */
  readonly key: string;
  /** 머리 줄의 경로. 마지막이 강조된다. */
  readonly crumbs: readonly string[];
  /** 주면 crumbs[i]를 눌러 dirs[i] 폴더를 둘러보는 popover가 뜬다(길이는 crumbs와 같다). panel이 popover 안을 그린다. */
  readonly browse?: {
    readonly dirs: readonly string[];
    readonly panel: (dir: string, close: () => void) => ReactNode;
  };
  /** 경로 뒤 상태 글(예: "Ready"). 있으면 점이 붙는다. */
  readonly status?: string;
  /** ⋯ 메뉴가 이 tab에 보이는 항목. 주지 않으면 기본 항목이다. */
  readonly menu?: TabMenuState;
  readonly body: ReactNode;
}

export interface ContentCardProps {
  /** 0이면 빈 desk, 1이면 한 tab, group이면 leaf마다 하나(순서는 상관없다). */
  panes: readonly CardPane[];
  /** group의 배치 tree. panes가 둘 이상일 때만 쓴다. */
  layout?: GroupNode;
  /** group에서 강조할 칸의 tab key. */
  focus: string | null;
  /** 나누는 선을 끌어 놓았다. 끄는 동안은 card가 자기 몫을 그리고 놓을 때 한 번 부른다. */
  onSplitRatio?: (path: NodePath, ratio: number) => void;
  /** 빈 desk 안내의 제목으로 쓰는 desk 이름. */
  deskLabel: string;
  /** 저장된 배치를 아직 읽는 중이다. panes가 없어도 빈 desk 안내 대신 빈 card를 둔다. */
  pending?: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** group에서 칸을 눌렀다. */
  onFocus: (key: string) => void;
  onAction: (action: TabAction, key: string) => void;
  /** 빈 desk의 단추. */
  onEmptyAction: (action: "new-session" | "open-file") => void;
  /** Explorer의 파일을 card 위에 놓았다. 주지 않으면 받지 않는다. */
  onDropPath?: (path: string) => void;
}

// 나누는 선의 두께. content-card.module.css의 .handle과 같다.
const GAP = "var(--space-3)";

export function ContentCard({
  panes,
  layout,
  focus,
  onSplitRatio,
  deskLabel,
  pending = false,
  canBack,
  canForward,
  onBack,
  onForward,
  onFocus,
  onAction,
  onEmptyAction,
  onDropPath,
}: ContentCardProps) {
  const grouped = panes.length > 1 && layout !== undefined;
  const { start: startDrag } = useTabDrag();
  const [dropping, setDropping] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  // 끄는 동안의 선과 몫. 놓을 때 onSplitRatio로 한 번만 저장한다.
  const [live, setLive] = useState<{
    readonly path: NodePath;
    readonly ratio: number;
  } | null>(null);
  const shownLayout =
    grouped && live !== null
      ? setNodeRatio(layout, live.path, live.ratio)
      : layout;
  const placed = grouped ? placeGroup(shownLayout!, GAP) : null;
  const dragTo = (
    event: PointerEvent<HTMLElement>,
    path: NodePath,
  ): number | null => {
    const box = area.current?.getBoundingClientRect();
    if (box === undefined || !grouped) return null;
    const handle = event.currentTarget.getBoundingClientRect();
    const dir = placed?.splits.find((split) => sameWay(split.path, path))?.dir;
    const ratio = dragRatio(
      layout,
      path,
      { x: event.clientX - box.left, y: event.clientY - box.top },
      { w: box.width, h: box.height },
      dir === "column" ? handle.height : handle.width,
    );
    return ratio === null ? null : Math.min(0.85, Math.max(0.15, ratio));
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
  // DOM 순서는 key 순으로 고정한다. leaf가 자리를 바꿔도 요소가 옮겨지지 않는다.
  const ordered = [...panes].sort((a, b) => (a.key < b.key ? -1 : 1));
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
        pending ? null : (
          <EmptyDesk label={deskLabel} onAction={onEmptyAction} />
        )
      ) : (
        <div
          ref={area}
          className={styles.area}
          data-grouped={grouped || undefined}
        >
          {ordered.map((pane) => {
            const box = placed?.leaves.get(pane.key) ?? FULL;
            return (
              <section
                key={pane.key}
                className={styles.pane}
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                data-pane={pane.key}
                data-dim={(grouped && focus !== pane.key) || undefined}
                data-focused={(grouped && focus === pane.key) || undefined}
                onPointerDown={() => {
                  if (grouped) onFocus(pane.key);
                }}
              >
                <CardHead
                  pane={pane}
                  spec={heads[pane.key]}
                  canBack={canBack}
                  canForward={canForward}
                  onBack={onBack}
                  onForward={onForward}
                  onAction={(action) => onAction(action, pane.key)}
                  onDragStart={
                    grouped
                      ? (event) =>
                          startDrag(
                            event,
                            { key: pane.key, whole: false },
                            "pane",
                          )
                      : undefined
                  }
                />
                <div className={styles.body}>
                  <HeadScope paneKey={pane.key} onHead={setHead}>
                    {pane.body}
                  </HeadScope>
                </div>
              </section>
            );
          })}
          {placed?.splits.map((split) => (
            <div
              key={`handle:${split.path.join("")}`}
              className={styles.handle}
              style={{
                left: split.box.x,
                top: split.box.y,
                width: split.box.w,
                height: split.box.h,
              }}
              role="separator"
              aria-orientation={split.dir === "row" ? "vertical" : "horizontal"}
              aria-label={t("shell.label.split-resize")}
              data-dir={split.dir}
              data-resizing={
                (live !== null && sameWay(live.path, split.path)) || undefined
              }
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                const ratio = dragTo(event, split.path);
                if (ratio !== null) setLive({ path: split.path, ratio });
              }}
              onPointerMove={(event) => {
                if (live === null) return;
                const ratio = dragTo(event, split.path);
                if (ratio !== null) setLive({ path: split.path, ratio });
              }}
              onPointerUp={(event) => {
                if (live === null) return;
                const done = dragTo(event, split.path) ?? live.ratio;
                setLive(null);
                onSplitRatio?.(split.path, done);
              }}
              onPointerCancel={() => setLive(null)}
              onDoubleClick={() => onSplitRatio?.(split.path, 0.5)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const sameWay = (a: NodePath, b: NodePath) => a.join("") === b.join("");

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
  onDragStart,
}: {
  pane: CardPane;
  spec: CardHeadSpec | undefined;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onAction: (action: TabAction) => void;
  /** group의 칸이면 머리 줄을 눌러 끌어 옮길 수 있다. */
  onDragStart: ((event: PointerEvent<HTMLElement>) => void) | undefined;
}) {
  const nav = spec?.nav ?? { canBack, canForward, onBack, onForward };
  const extra = spec?.menu;
  return (
    <div
      className={styles.head}
      data-draggable={onDragStart === undefined ? undefined : ""}
      onPointerDown={(event) => {
        // 단추와 입력은 제 일을 한다.
        if ((event.target as HTMLElement).closest("button, input, a")) return;
        onDragStart?.(event);
      }}
    >
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
                {pane.browse === undefined ? (
                  crumb
                ) : (
                  <CrumbButton
                    label={crumb}
                    panel={(close) =>
                      pane.browse!.panel(pane.browse!.dirs[index], close)
                    }
                  />
                )}
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

function CrumbButton({
  label,
  panel,
}: {
  label: string;
  panel: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="beside"
      trigger={
        <button type="button" className={styles.crumbButton}>
          {label}
        </button>
      }
    >
      {panel(() => setOpen(false))}
    </Popover>
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
