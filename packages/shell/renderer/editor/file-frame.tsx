// 파일 탭의 틀. 조작(저장 상태·Info·Delete)은 card 머리 줄에 올리고, card 밖(floated 패널, detached 창)이면
// 본문 맨 위 view bar 한 줄에 그린다.
// 정보 panel은 그 칸 오른쪽에 뜨는 overlay이고, 파일 지우기는 화면 가운데 modal이 묻는다.
// 어느 파일이든 이 틀을 쓰고 본문과 toast만 갈아 끼운다.
import {
  type KeyboardEventHandler,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { Button } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import {
  FileInfoPanel,
  type FileInfoPanelProps,
  type InfoTabId,
} from "./info-panel/info-panel.tsx";
import { type FileKind, fileNameOf } from "./model.ts";
import { NoticeToast } from "./notices.tsx";
import type { SaveState } from "./save-state.ts";
import { useCardHead } from "../shell/card-head.tsx";
import {
  FileActions,
  FileMenu,
  FileMeta,
  fileMenuItems,
  ViewBar,
} from "./view-bar.tsx";
import styles from "./file-frame.module.css";
import { actionIcons } from "../icons/mod.ts";

interface FileFrameProps {
  path: string;
  kind: FileKind;
  outside: boolean;
  /** view bar 왼쪽의 파일 정보. */
  meta: string | null;
  /** 검색 결과로 열린 줄. */
  line?: number;
  /** 글 파일의 저장 상태. 이미지와 pdf는 null(보기만)이다. */
  state: SaveState | null;
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

export function FileFrame({
  path,
  kind,
  outside,
  meta,
  line,
  state,
  onConflict,
  onRetry,
  info,
  initialInfo,
  onDelete,
  toasts,
  onKeyDownCapture,
  children,
}: FileFrameProps) {
  const [tab, setTab] = useState<InfoTabId | null>(initialInfo ?? null);
  const [confirming, setConfirming] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const name = fileNameOf(path);
  // 머리에 올린 callback이 deps에 없는 최신 props를 읽게 한다.
  const latest = useRef({ onConflict, onRetry });
  latest.current = { onConflict, onRetry };

  const actions = (
    <FileActions
      state={state}
      infoOpen={tab !== null}
      onInfo={() => setTab(tab === null ? "info" : null)}
      onConflict={() => latest.current.onConflict?.()}
      onRetry={() => latest.current.onRetry?.()}
    />
  );
  const inCard = useCardHead(
    {
      actions: (
        <>
          {/* 파일 종류·크기 글(meta)은 좁은 칸에서 경로를 밀어내서 card 머리에서는 뺀다. 크기는 Info에 있다. */}
          <FileMeta outside={outside} meta={null} line={line} />
          {actions}
        </>
      ),
      menu: {
        items: fileMenuItems(),
        onSelect: (id) => {
          if (id === "file:delete") setConfirming(true);
        },
      },
    },
    [state, tab, outside, line],
  );

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
      {inCard ? null : (
        <ViewBar lead={<FileMeta outside={outside} meta={meta} line={line} />}>
          {actions}
          <FileMenu onDelete={() => setConfirming(true)} />
        </ViewBar>
      )}
      {toasts}
      {deleteFailed ? (
        <NoticeToast
          title={t("document.error.delete-failed")}
          onClose={() => setDeleteFailed(false)}
        />
      ) : null}
      <div className={styles.pane}>
        {children}
        {tab === null ? null : (
          <FileInfoPanel
            {...info}
            tab={tab}
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
            <Button
              variant="danger"
              icon={actionIcons.delete}
              onClick={() => void remove()}
            >
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

/** 읽는 중이거나 열지 못한 파일. 조작 없이 안내만 둔다. */
export function FileStatus({ children }: { children: ReactNode }) {
  const inCard = useCardHead({}, []);
  return (
    <div className={styles.tab} data-file-tab="status">
      {inCard ? null : <ViewBar lead={null} />}
      <div className={styles.pane}>
        <div className={styles.status}>{children}</div>
      </div>
    </div>
  );
}
