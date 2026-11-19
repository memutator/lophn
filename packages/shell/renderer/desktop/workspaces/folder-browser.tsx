// 다른 기계의 범위에서 그 기계의 폴더를 고르는 dialog. OS의 폴더 고르기 창은 이 컴퓨터의 폴더를 보이므로 그 창에서는 쓰지 않는다.
// 목록은 그 기계의 core가 읽고(`projects/browse`, 사람의 home 아래만) home부터 연다. 폴더를 누르면 들어가고 [Up]이 위로,
// [Choose]가 지금 폴더를 고른다. 폴더를 고르는 화면(등록 dialog, project 폴더, skill 폴더)은 OS 선택기와 같은 통로(`pick`)로
// 이 dialog를 부르므로 그 화면들은 어느 창인지 모른다.
import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { t } from "@lophn/i18n";
import { ErrorState, Skeleton, useDelayedLoading } from "@lophn/ui/feedback";
import { Dialog } from "@lophn/ui/overlay";
import { Button, FileIcon } from "@lophn/ui/primitives";

import type {
  FolderPickerApi,
  FolderPickReply,
} from "../../../ipc/folder-picker.ts";
import { projectBrowse } from "../../../../protocol/projects/add-api.ts";
import { actionIcons } from "../../icons/mod.ts";
import type { SourceResult } from "../../source-result.ts";
import type { CoreSource } from "../connection/connection.ts";
import { useScopeMachineItem } from "../machines/context.tsx";
import styles from "./folder-browser.module.css";

/** 폴더 하나를 읽은 것. path는 모두 그 기계의 realpath이고 home에서는 parent가 null이다. */
export interface FolderListing {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: readonly { readonly name: string; readonly path: string }[];
  /** 500개에서 끊었다. */
  readonly truncated: boolean;
}

/** path가 없으면 home이다. */
export type BrowseFolders = (
  path?: string,
) => Promise<SourceResult<FolderListing>>;

export function coreBrowseFolders(core: CoreSource): BrowseFolders {
  return async (path) => {
    const reply = await core.call({
      kind: "memory",
      resource: projectBrowse.resource,
      method: projectBrowse.method,
      body: path === undefined ? {} : { path },
    });
    return reply.ok
      ? { ok: true, value: reply.value as FolderListing }
      : { ok: false, code: reply.error?.code ?? "internal" };
  };
}

interface FolderBrowseDialogProps {
  open: boolean;
  browse: BrowseFolders;
  onChoose: (path: string) => void;
  onClose: () => void;
}

export function FolderBrowseDialog({
  open,
  browse,
  onChoose,
  onClose,
}: FolderBrowseDialogProps) {
  const machine = useScopeMachineItem();
  // 열 때마다 home부터다. 폴더를 옮기는 동안은 앞 목록을 남겨 깜빡임을 막는다.
  const [at, setAt] = useState<string | undefined>(undefined);
  const [read, setRead] = useState<
    | { readonly state: "loading"; readonly previous: FolderListing | null }
    | { readonly state: "failed" }
    | { readonly state: "ready"; readonly value: FolderListing }
  >({ state: "loading", previous: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) {
      setAt(undefined);
      setRead({ state: "loading", previous: null });
      return;
    }
    let live = true;
    setRead((now) => ({
      state: "loading",
      previous:
        now.state === "ready"
          ? now.value
          : now.state === "loading"
            ? now.previous
            : null,
    }));
    void browse(at).then((result) => {
      if (live) {
        setRead(
          result.ok
            ? { state: "ready", value: result.value }
            : { state: "failed" },
        );
      }
    });
    return () => {
      live = false;
    };
  }, [open, at, browse, attempt]);

  const readyListing = read.state === "ready" ? read.value : null;
  const listing =
    read.state === "ready"
      ? read.value
      : read.state === "loading"
        ? read.previous
        : null;
  const showInitialLoading = useDelayedLoading(
    read.state === "loading" && listing === null,
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("machines.title.choose-folder", {
        name: machine?.name ?? t("machines.label.unknown-name"),
      })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={actionIcons.confirm}
            disabled={readyListing === null}
            data-choose-folder=""
            onClick={() => readyListing !== null && onChoose(readyListing.path)}
          >
            {t("machines.button.choose-folder")}
          </Button>
        </>
      }
    >
      <div className={styles.body} data-folder-browser="">
        <div className={styles.head}>
          <span className={styles.path} data-folder-path="">
            {listing?.path ?? ""}
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={actionIcons.moveUp}
            disabled={readyListing?.parent == null}
            data-folder-up=""
            onClick={() =>
              readyListing?.parent != null && setAt(readyListing.parent)
            }
          >
            {t("machines.button.folder-up")}
          </Button>
        </div>
        {read.state === "failed" ? (
          <ErrorState
            target={t("machines.label.folders")}
            onRetry={() => setAttempt(attempt + 1)}
          />
        ) : listing === null ? (
          showInitialLoading ? (
            <Skeleton lines={4} />
          ) : null
        ) : listing.entries.length === 0 ? (
          <p className={styles.note} data-folders-none="">
            {t("machines.empty.no-folders")}
          </p>
        ) : (
          <ul className={styles.list}>
            {listing.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className={styles.row}
                  data-folder-entry={entry.name}
                  onClick={() => setAt(entry.path)}
                >
                  <FileIcon name={entry.name} folder />
                  <span className={styles.name}>{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {listing?.truncated === true ? (
          <p className={styles.note}>
            {t("machines.notice.folders-truncated")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * OS 폴더 선택기 대신 쓰는 고르기 통로와 그 dialog를 그리는 자리. `pick`은 dialog를 열고 사람이 고르거나 닫을 때 끝난다.
 * 그 기계의 파일 하나를 고르는 길은 없다. 자리(`Host`)는 창에 한 번 둔다.
 */
export function createFolderBrowser(browse: BrowseFolders): {
  picker: FolderPickerApi;
  Host: () => ReactNode;
} {
  let pending: ((path: string | null) => void) | null = null;
  const listeners = new Set<() => void>();
  const finish = (path: string | null) => {
    const resolve = pending;
    pending = null;
    for (const listener of listeners) listener();
    resolve?.(path);
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function Host() {
    const open = useSyncExternalStore(subscribe, () => pending !== null);
    const close = useCallback(() => finish(null), []);
    return (
      <FolderBrowseDialog
        open={open}
        browse={browse}
        onChoose={finish}
        onClose={close}
      />
    );
  }
  return {
    picker: {
      pick() {
        // 앞의 고르기가 남아 있으면 그만둔 것으로 끝낸다.
        finish(null);
        return new Promise<FolderPickReply>((resolve) => {
          pending = (path) => resolve({ ok: true, path });
          for (const listener of listeners) listener();
        });
      },
      pickFile: () => Promise.resolve({ ok: false, code: "unavailable" }),
      pathForFile: () => null,
    },
    Host,
  };
}
