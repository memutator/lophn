// 탭 안 맨 위의 view bar 한 줄. 왼쪽에는 짧은 정보(project 밖 표시, 파일 정보, 열린 줄)만 두고
// 경로는 위쪽 breadcrumb에 있다. 오른쪽에는 저장 상태, Edit·Read(md만), Info, … menu가 있다.
import type { ReactNode } from "react";
import {
  Button,
  IconButton,
  Kbd,
  Menu,
  MenuIcon,
  StatusMark,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { currentPlatform } from "../desktop/top-bar/platform.ts";
import { editorIcons, workspaceIcons } from "../icons/mod.ts";
import type { FileKind } from "./model.ts";
import type { SaveState } from "./save-state.ts";
import styles from "./view-bar.module.css";

/** CommandOrControl+E를 이 OS의 글자로 보인다. */
function editShortcut(): readonly string[] {
  return currentPlatform() === "mac" ? ["⌘", "E"] : ["Ctrl", "E"];
}

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
      {outside
        ? <span className={styles.outside}>{t("document.label.outside")}</span>
        : null}
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
export function SaveMark({ state, onConflict, onRetry }: SaveMarkProps) {
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
  kind: FileKind;
  /** 글 파일만 저장 상태가 있다. 이미지와 pdf는 보기만 한다. */
  state: SaveState | null;
  editing: boolean;
  infoOpen: boolean;
  onEditing: () => void;
  onInfo: () => void;
  onDelete: () => void;
  onConflict?: () => void;
  onRetry?: () => void;
}

/** view bar 오른쪽의 조작. */
export function FileActions(
  {
    kind,
    state,
    editing,
    infoOpen,
    onEditing,
    onInfo,
    onDelete,
    onConflict,
    onRetry,
  }: FileActionsProps,
) {
  const editLabel = editing
    ? t("document.button.read")
    : t("document.button.edit");
  return (
    <>
      {state === null
        ? <span className={styles.save}>{t("document.label.view-only")}</span>
        : <SaveMark state={state} onConflict={onConflict} onRetry={onRetry} />}
      {kind === "markdown"
        ? (
          <Tooltip
            content={
              <span className={styles.tip}>
                {editLabel}
                <Kbd keys={editShortcut()} />
              </span>
            }
          >
            <IconButton
              icon={editing ? editorIcons.read : editorIcons.edit}
              label={editLabel}
              size="sm"
              aria-pressed={editing}
              aria-keyshortcuts="Control+E Meta+E"
              data-edit-toggle=""
              onClick={onEditing}
            />
          </Tooltip>
        )
        : null}
      <IconButton
        icon={workspaceIcons.infoPanel}
        label={t("document.button.info")}
        size="sm"
        aria-pressed={infoOpen}
        variant={infoOpen ? "secondary" : "ghost"}
        data-document-info=""
        onClick={onInfo}
      />
      <Menu
        trigger={
          <IconButton
            icon={editorIcons.menu}
            label={t("document.button.menu")}
            size="sm"
            data-document-menu=""
          />
        }
        items={[{
          id: "delete",
          label: t("document.button.delete"),
          leading: <MenuIcon icon={workspaceIcons.trash} />,
        }]}
        onSelect={(id) => {
          if (id === "delete") onDelete();
        }}
      />
    </>
  );
}
