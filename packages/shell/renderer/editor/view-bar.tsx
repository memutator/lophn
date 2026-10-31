// 파일 탭의 머리 조각. card 안이면 FileFrame이 이 조각들을 card 머리 줄(shell/card-head.tsx)에 올리고
// (파일 정보·저장 상태·Info는 ⋯ 앞, Delete는 ⋯ 메뉴 맨 위), card 밖(floated 패널, detached 창)이면 ViewBar
// 한 줄에 그린다. 경로는 card의 breadcrumb에 있다.
import type { ReactNode } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { Menu, MenuIcon, type MenuItem } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { editorIcons, workspaceIcons } from "../icons/mod.ts";
import type { SaveState } from "./save-state.ts";
import styles from "./view-bar.module.css";

interface ViewBarProps {
  /** 왼쪽 한 줄. */
  lead: ReactNode;
  children?: ReactNode;
}

export function ViewBar({ lead, children }: ViewBarProps) {
  return (
    <div className={styles.bar} data-view-bar="">
      <div className={styles.lead}>{lead}</div>
      <div className={styles.actions}>{children}</div>
    </div>
  );
}

interface FileMetaProps {
  outside: boolean;
  /** 파일 종류와 크기 같은 짧은 정보. */
  meta: string | null;
  /** 검색 결과로 열린 줄. */
  line?: number;
}

/** view bar 왼쪽: project 밖 표시, 파일 정보, 열린 줄. */
export function FileMeta({ outside, meta, line }: FileMetaProps) {
  return (
    <span className={styles.meta}>
      {outside ? (
        <span className={styles.outside}>{t("document.label.outside")}</span>
      ) : null}
      {meta === null ? null : <span className={styles.text}>{meta}</span>}
      {line === undefined ? null : (
        <span className={styles.lineMark}>
          {t("document.label.line", { line })}
        </span>
      )}
    </span>
  );
}

interface SaveMarkProps {
  state: SaveState;
  /** 충돌 표시를 누르면 충돌 toast를 다시 보인다. */
  onConflict?: () => void;
  onRetry?: () => void;
}

/** 저장 상태. 저장됨과 저장 중은 흐린 글, 충돌과 실패는 경고 표시다. */
function SaveMark({ state, onConflict, onRetry }: SaveMarkProps) {
  if (state === "conflict") {
    return (
      <Button variant="ghost" size="sm" onClick={onConflict}>
        <StatusMark tone="warning" label={t("document.label.conflict")} />
      </Button>
    );
  }
  if (state === "failed" || state === "unknown") {
    return (
      <Button variant="ghost" size="sm" onClick={onRetry}>
        <StatusMark tone="critical" label={t("document.label.not-saved")} />
      </Button>
    );
  }
  return (
    <span className={styles.save} data-save-state={state}>
      {state === "saving"
        ? t("document.label.saving")
        : t("document.label.saved")}
    </span>
  );
}

interface FileActionsProps {
  /** 글 파일만 저장 상태가 있다. 이미지와 pdf는 보기만 한다. */
  state: SaveState | null;
  infoOpen: boolean;
  onInfo: () => void;
  onConflict?: () => void;
  onRetry?: () => void;
}

/** 저장 상태와 Info 단추. card 머리에서는 ⋯ 앞에 놓인다. */
export function FileActions({
  state,
  infoOpen,
  onInfo,
  onConflict,
  onRetry,
}: FileActionsProps) {
  return (
    <>
      {state === null ? (
        <span className={styles.save}>{t("document.label.view-only")}</span>
      ) : (
        <SaveMark state={state} onConflict={onConflict} onRetry={onRetry} />
      )}
      <IconButton
        icon={workspaceIcons.infoPanel}
        label={t("document.button.info")}
        size="sm"
        aria-pressed={infoOpen}
        variant={infoOpen ? "secondary" : "ghost"}
        data-document-info=""
        onClick={onInfo}
      />
    </>
  );
}

/** card 머리 ⋯ 메뉴 맨 위에 올리는 항목. id는 탭 기본 항목과 겹치지 않게 접두어를 단다. */
export function fileMenuItems(): readonly MenuItem[] {
  return [
    {
      id: "file:delete",
      label: t("document.button.delete"),
      leading: <MenuIcon icon={workspaceIcons.trash} />,
    },
  ];
}

/** card 밖 view bar의 … menu. */
export function FileMenu({ onDelete }: { onDelete: () => void }) {
  return (
    <Menu
      trigger={
        <IconButton
          icon={editorIcons.menu}
          label={t("document.button.menu")}
          size="sm"
          data-document-menu=""
        />
      }
      items={fileMenuItems()}
      onSelect={(id) => {
        if (id === "file:delete") onDelete();
      }}
    />
  );
}
