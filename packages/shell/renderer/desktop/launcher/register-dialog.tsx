import { useState } from "react";
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  Textarea,
  Tooltip,
} from "@lophn/design/components";
import { launcherIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { newId } from "../lophn-space/model.ts";
import {
  addFolder,
  type RegisterFailure,
  registerFailure,
  shortNameOf,
  usableTitle,
} from "./model.ts";
import type { FolderDraft, LauncherSource, ProjectCard } from "./source.ts";
import styles from "./register-dialog.module.css";

export interface RegisterDialogProps {
  open: boolean;
  source: LauncherSource;
  /** 이미 쓰는 안쪽 짧은 이름. 겹치지 않는 이름을 고른다. */
  takenNames: readonly string[];
  onClose: () => void;
  onRegistered: (card: ProjectCard) => void;
  /** id의 시각과 무작위. 테스트가 고정한다. */
  newProjectId?: () => string;
}

// 이전 lophn 프로젝트 등록 창의 배치: 이름, 목적, 폴더 목록과 폴더 추가, 오른쪽 아래 등록.
// 폴더는 OS 선택기로만 고르고 없이도 등록한다. 등록은 추적을 켜지 않는다(documents/projects#R1–R3).
export function RegisterDialog(
  {
    open,
    source,
    takenNames,
    onClose,
    onRegistered,
    newProjectId = () => newId("prj"),
  }: RegisterDialogProps,
) {
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [folders, setFolders] = useState<readonly FolderDraft[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const [failure, setFailure] = useState<
    { kind: RegisterFailure; name: string } | null
  >(null);

  const reset = () => {
    setTitle("");
    setPurpose("");
    setFolders([]);
    setTouched(false);
    setBusy(false);
    setPickFailed(false);
    setFailure(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const pick = async () => {
    setPickFailed(false);
    const chosen = await source.pickFolder();
    if (!chosen.ok) {
      setPickFailed(true);
      return;
    }
    if (chosen.path !== null) setFolders(addFolder(folders, chosen.path));
  };

  const submit = async () => {
    setTouched(true);
    if (!usableTitle(title) || busy) return;
    setBusy(true);
    setFailure(null);
    const name = title.trim();
    const result = await source.register({
      id: newProjectId(),
      name: shortNameOf(name, takenNames),
      title: name,
      purpose: purpose.trim(),
      folders: folders.map((folder) => ({
        path: folder.path,
        description: folder.description.trim(),
      })),
    });
    setBusy(false);
    if (!result.ok) {
      setFailure({ kind: registerFailure(result.code), name });
      return;
    }
    reset();
    onRegistered(result.value);
  };

  const nameError = touched && !usableTitle(title)
    ? t("launcher.error.name-required")
    : failure?.kind === "name-taken"
    ? t("launcher.error.name-taken")
    : undefined;
  const addLabel = t("launcher.button.add-folder");
  const removeLabel = t("launcher.button.remove-folder");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={t("launcher.title.register")}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy}
            data-register=""
          >
            {t("launcher.button.register")}
          </Button>
        </>
      }
    >
      <div className={styles.form} data-register-form="">
        <p className={styles.note}>{t("launcher.dialog.register-note")}</p>
        <Field label={t("launcher.label.name")} error={nameError}>
          <Input
            value={title}
            autoFocus
            data-field="name"
            onChange={(event) => {
              setTitle(event.currentTarget.value);
              if (failure?.kind === "name-taken") setFailure(null);
            }}
          />
        </Field>
        <Field
          label={t("launcher.label.purpose")}
          help={t("launcher.field.purpose-help")}
        >
          <Textarea
            value={purpose}
            rows={3}
            data-field="purpose"
            onChange={(event) => setPurpose(event.currentTarget.value)}
          />
        </Field>
        <section className={styles.folders} data-folders="">
          <div className={styles.foldersHead}>
            <span className={styles.foldersLabel}>
              {t("launcher.label.folders")}
            </span>
            <Tooltip content={addLabel}>
              <IconButton
                icon={launcherIcons.addFolder}
                label={addLabel}
                size="sm"
                data-add-folder=""
                onClick={() => void pick()}
              />
            </Tooltip>
          </div>
          {folders.length === 0
            ? (
              <p className={styles.empty} data-folders-empty="">
                {t("launcher.empty.no-folders")}
              </p>
            )
            : (
              <ul className={styles.folderList}>
                {folders.map((folder, index) => (
                  <li
                    key={folder.path}
                    className={styles.folder}
                    data-folder={folder.path}
                  >
                    <div className={styles.folderHead}>
                      <span className={styles.path}>{folder.path}</span>
                      <Tooltip content={removeLabel}>
                        <IconButton
                          icon={launcherIcons.remove}
                          label={removeLabel}
                          size="sm"
                          data-remove-folder=""
                          onClick={() =>
                            setFolders(
                              folders.filter((_, at) => at !== index),
                            )}
                        />
                      </Tooltip>
                    </div>
                    <Field label={t("launcher.label.folder-description")}>
                      <Input
                        size="sm"
                        value={folder.description}
                        onChange={(event) => {
                          const description = event.currentTarget.value;
                          setFolders(
                            folders.map((item, at) =>
                              at === index ? { ...item, description } : item
                            ),
                          );
                        }}
                      />
                    </Field>
                  </li>
                ))}
              </ul>
            )}
          {pickFailed
            ? (
              <p className={styles.error} role="alert" data-pick-failed="">
                {t("launcher.error.picker-failed")}
              </p>
            )
            : null}
        </section>
        {failure?.kind === "failed"
          ? (
            <p className={styles.error} role="alert" data-register-failed="">
              {t("launcher.error.register-failed", { name: failure.name })}
            </p>
          )
          : null}
      </div>
    </Dialog>
  );
}
