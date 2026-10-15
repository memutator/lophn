// 파일 탭의 틀. 본문이 탭 바로 아래부터 시작하고 조작은 탭 안 맨 위의 view bar 한 줄에 있다.
// 정보 panel은 그 칸 오른쪽에 뜨는 overlay이고, 파일 지우기는 화면 가운데 modal이 묻는다.
// 어느 파일이든 이 틀을 쓰고 본문과 toast만 갈아 끼운다.
import { type KeyboardEventHandler, type ReactNode, useState } from "react";
import { Button, Dialog } from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  FileInfoPanel,
  type FileInfoPanelProps,
  type InfoTabId,
} from "./info-panel/info-panel.tsx";
import { type FileKind, fileNameOf } from "./model.ts";
import { NoticeToast } from "./notices.tsx";
import type { SaveState } from "./save-state.ts";
import { FileActions, FileMeta, ViewBar } from "./view-bar.tsx";
import styles from "./file-frame.module.css";

export interface FileFrameProps {
  path: string;
  kind: FileKind;
  outside: boolean;
  /** view bar 왼쪽의 파일 정보. */
  meta: string | null;
  /** 검색 결과로 열린 줄. */
  line?: number;
  /** 글 파일의 저장 상태. 이미지와 pdf는 null(보기만)이다. */
  state: SaveState | null;
  editing?: boolean;
  onEditing?: () => void;
  onConflict?: () => void;
  onRetry?: () => void;
  /** 정보 panel의 내용. onTab·tab은 틀이 가진다. */
  info: Omit<FileInfoPanelProps, "tab" | "onTab" | "path" | "outside">;
  /** 처음부터 열어 둘 정보 panel 탭. */
  initialInfo?: InfoTabId;
  /** 지운 뒤 탭을 닫는 일은 부른 쪽이 한다. 지우지 못하면 false다. */
  onDelete: () => Promise<boolean>;
  /** 탭 위쪽 toast. */
  toasts?: ReactNode;
  /** 열려 있는 동안 본문 칸에 낄 modal이 없는 키 처리. */
  onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}

export function FileFrame(
  {
    path,
    kind,
    outside,
    meta,
    line,
    state,
    editing = false,
    onEditing = () => {},
    onConflict,
    onRetry,
    info,
    initialInfo,
    onDelete,
    toasts,
    onKeyDownCapture,
    children,
  }: FileFrameProps,
) {
  const [tab, setTab] = useState<InfoTabId | null>(initialInfo ?? null);
  const [confirming, setConfirming] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const name = fileNameOf(path);

  const remove = async () => {
    setConfirming(false);
    setDeleteFailed(!(await onDelete()));
  };

  return (
    <div
      className={styles.tab}
      data-file-tab={kind}
      onKeyDownCapture={onKeyDownCapture}
    >
      <ViewBar lead={<FileMeta outside={outside} meta={meta} line={line} />}>
        <FileActions
          kind={kind}
          state={state}
          editing={editing}
          infoOpen={tab !== null}
          onEditing={onEditing}
          onInfo={() => setTab(tab === null ? "info" : null)}
          onDelete={() => setConfirming(true)}
          onConflict={onConflict}
          onRetry={onRetry}
        />
      </ViewBar>
      {toasts}
      {deleteFailed
        ? (
          <NoticeToast
            title={t("document.error.delete-failed")}
            onClose={() => setDeleteFailed(false)}
          />
        )
        : null}
      <div className={styles.pane}>
        {children}
        {tab === null ? null : (
          <FileInfoPanel
            {...info}
            tab={info.contexts === undefined && tab === "contexts"
              ? "info"
              : tab}
            onTab={setTab}
            path={path}
            outside={outside}
          />
        )}
      </div>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("document.title.delete", { name })}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>
              {t("common.button.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void remove()}>
              {t("document.button.delete")}
            </Button>
          </>
        }
      >
        {t("document.dialog.delete-body")}
      </Dialog>
    </div>
  );
}

/** 읽는 중이거나 열지 못한 파일. 조작 없이 view bar 한 줄 아래에 안내만 둔다. */
export function FileStatus({ children }: { children: ReactNode }) {
  return (
    <div className={styles.tab} data-file-tab="status">
      <ViewBar lead={null} />
      <div className={styles.pane}>
        <div className={styles.status}>{children}</div>
      </div>
    </div>
  );
}
