// 가운데 둥근 card. 머리 줄(← →, 경로, 상태, ⋯ tab 메뉴)과 본문이고, split이면 반쪽마다 자기 머리 줄을 가진다.
// tab이 하나도 없으면 빈 desk 안내를 보인다. 본문은 호출자가 그려 넣는다.
import { type ReactNode, useState } from "react";
import { t } from "@lophn/i18n";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { Menu } from "@lophn/ui/overlay";

import { shellIcons } from "../icons/mod.ts";
import { PATH_DRAG_TYPE } from "../workspace/drag.ts";
import styles from "./content-card.module.css";
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
  inSplit: false,
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
  const head = (pane: CardPane, side: Side) => (
    <CardHead
      pane={pane}
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
        <div className={styles.split}>
          {panes.map((pane, index) => {
            const side: Side = index === 0 ? "a" : "b";
            return (
              <section
                key={pane.key}
                className={styles.half}
                data-focused={focus === side || undefined}
                onPointerDown={() => onFocus(side)}
              >
                {head(pane, side)}
                <div className={styles.body}>{pane.body}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <>
          {head(panes[0]!, "a")}
          <div className={styles.body}>{panes[0]!.body}</div>
        </>
      )}
    </div>
  );
}

function CardHead({
  pane,
  canBack,
  canForward,
  onBack,
  onForward,
  onAction,
}: {
  pane: CardPane;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onAction: (action: TabAction) => void;
}) {
  return (
    <div className={styles.head}>
      <IconButton
        icon={shellIcons.back}
        label={t("shell.button.back")}
        size="sm"
        disabled={!canBack}
        onClick={onBack}
      />
      <IconButton
        icon={shellIcons.forward}
        label={t("shell.button.forward")}
        size="sm"
        disabled={!canForward}
        onClick={onForward}
      />
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
      <Menu
        placement="corner"
        onSelect={(id) => onAction(id as TabAction)}
        items={tabMenuItems(pane.menu ?? DEFAULT_MENU)}
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
