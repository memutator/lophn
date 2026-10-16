// sidebar 파일 tree의 Rename·Delete 확인. Delete는 화면 가운데 modal이 한 번 묻고, Rename은 새 이름을 받는다.
// 실제로 디스크를 바꾸는 일과 열린 탭 정리는 부르는 쪽(window)이 한다.
import { useState } from "react";
import { Button, Dialog, Field, Input } from "@lophn/design/components";
import { t } from "@lophn/wording";

export type FileDialogState =
  | { readonly action: "delete" | "rename"; readonly path: string }
  | null;

type RenameResult = "ok" | "exists" | "failed";

interface FileActionDialogProps {
  state: FileDialogState;
  onClose: () => void;
  /** 지웠으면 true. */
  onDelete: (path: string) => Promise<boolean>;
  onRename: (path: string, name: string) => Promise<RenameResult>;
}

const nameOf = (path: string) => path.split("/").at(-1) ?? path;

export function FileActionDialog(
  { state, onClose, onDelete, onRename }: FileActionDialogProps,
) {
  if (state === null) return null;
  return state.action === "delete"
    ? <DeleteDialog path={state.path} onClose={onClose} onDelete={onDelete} />
    : <RenameDialog path={state.path} onClose={onClose} onRename={onRename} />;
}

function DeleteDialog(
  { path, onClose, onDelete }: {
    path: string;
    onClose: () => void;
    onDelete: (path: string) => Promise<boolean>;
  },
) {
  const [failed, setFailed] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("project-workspace.title.file-delete", { name: nameOf(path) })}
      actions={
        <>
          <Button onClick={onClose}>{t("common.button.cancel")}</Button>
          <Button
            variant="danger"
            onClick={() =>
              void onDelete(path).then((ok) => {
                if (ok) onClose();
                else setFailed(true);
              })}
          >
            {t("project-workspace.button.file-delete")}
          </Button>
        </>
      }
    >
      {failed
        ? t("project-workspace.error.file-action-failed")
        : t("project-workspace.notice.file-delete")}
    </Dialog>
  );
}

function RenameDialog(
  { path, onClose, onRename }: {
    path: string;
    onClose: () => void;
    onRename: (path: string, name: string) => Promise<RenameResult>;
  },
) {
  const [name, setName] = useState(nameOf(path));
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    const next = name.trim();
    if (next === "" || next === nameOf(path)) {
      onClose();
      return;
    }
    void onRename(path, next).then((result) => {
      if (result === "ok") onClose();
      else {
        setError(
          result === "exists"
            ? t("project-workspace.error.file-exists")
            : t("project-workspace.error.file-action-failed"),
        );
      }
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("project-workspace.title.file-rename", { name: nameOf(path) })}
      actions={
        <>
          <Button onClick={onClose}>{t("common.button.cancel")}</Button>
          <Button variant="primary" onClick={submit}>
            {t("project-workspace.button.file-rename")}
          </Button>
        </>
      }
    >
      <Field
        label={t("project-workspace.label.file-new-name")}
        error={error}
      >
        <Input
          value={name}
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </Field>
    </Dialog>
  );
}
