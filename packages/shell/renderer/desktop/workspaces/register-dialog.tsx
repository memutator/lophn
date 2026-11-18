import { useEffect, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Field, Input, Switch, Textarea } from "@lophn/ui/input";
import { Dialog, Tooltip } from "@lophn/ui/overlay";
import { actionIcons, commonIcons, homeIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import { addFolder, missingFolder, usableTitle } from "./model.ts";
import type { FolderDraft, FolderMatch, RegisterSource } from "./source.ts";
import styles from "./register-dialog.module.css";

interface RegisterDialogProps {
  open: boolean;
  source: RegisterSource;
  onClose: () => void;
  onRegistered: (created: { id: string }) => void;
}

// 프로젝트 등록 창: 이름, 목적, 폴더 목록과 폴더 추가, 오른쪽 아래 등록. 폴더는 OS 선택기로만 고르고
// 0개여도 등록한다(앱 data만 있는 project). 런처와 Projects의 + 단추가 같이 쓴다.
// 첫 폴더를 읽어(match) 폴더 목록 아래에 저장소의 상태를 한 줄로 알린다. 읽지 못하면 줄 없이 등록한다.
export function RegisterDialog({
  open,
  source,
  onClose,
  onRegistered,
}: RegisterDialogProps) {
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [folders, setFolders] = useState<readonly FolderDraft[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [match, setMatch] = useState<FolderMatch | null>(null);
  const [share, setShare] = useState(true);
  const [relinkFailed, setRelinkFailed] = useState(false);

  const firstPath = folders[0]?.path;
  useEffect(() => {
    setMatch(null);
    setShare(true);
    setRelinkFailed(false);
    if (firstPath === undefined) return;
    let stale = false;
    void source.match(firstPath).then((read) => {
      if (!stale) setMatch(read.ok ? read.value : null);
    });
    return () => {
      stale = true;
    };
  }, [firstPath, source]);

  // id file이 없는 git 폴더만 켬 줄이 선다.
  const canShare =
    match !== null &&
    match.repo === "git" &&
    match.file === "none" &&
    match.same === null;
  const lost = match?.suggestions.find(
    (project) => !project.archived && missingFolder(project) !== undefined,
  );

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
      title: name,
      purpose: purpose.trim(),
      folders: folders.map((folder) => ({
        path: folder.path,
        description: folder.description.trim(),
      })),
      shareIdentity: canShare && share,
    });
    setBusy(false);
    if (!result.ok) {
      setFailure(name);
      return;
    }
    reset();
    onRegistered(result.value);
  };

  // 폴더를 잃은 project에 이 저장소의 폴더를 이어 주고 닫는다. 새 project는 만들지 않는다.
  const relink = async () => {
    const folder = lost === undefined ? undefined : missingFolder(lost);
    if (lost === undefined || folder === undefined || firstPath === undefined) {
      return;
    }
    setBusy(true);
    setRelinkFailed(false);
    const result = await source.relinkFolder(lost, folder.path, firstPath);
    setBusy(false);
    if (!result.ok) {
      setRelinkFailed(true);
      return;
    }
    close();
  };

  const nameError =
    touched && !usableTitle(title) ? t("home.error.name-required") : undefined;
  const addLabel = t("home.button.add-folder");
  const removeLabel = t("home.button.remove-folder");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={t("home.title.register")}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={actionIcons.add}
            onClick={() => void submit()}
            disabled={busy}
            data-register=""
          >
            {t("home.button.register")}
          </Button>
        </>
      }
    >
      <div className={styles.form} data-register-form="">
        <p className={styles.note}>{t("home.dialog.register-note")}</p>
        <Field label={t("home.label.name")} error={nameError}>
          <Input
            value={title}
            autoFocus
            data-field="name"
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </Field>
        <Field
          label={t("home.label.purpose")}
          help={t("home.field.purpose-help")}
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
              {t("home.label.folders")}
            </span>
            <Tooltip content={addLabel}>
              <IconButton
                icon={homeIcons.addFolder}
                label={addLabel}
                size="sm"
                data-add-folder=""
                onClick={() => void pick()}
              />
            </Tooltip>
          </div>
          {folders.length === 0 ? (
            <p className={styles.empty} data-folders-empty="">
              {t("home.empty.no-folders")}
            </p>
          ) : (
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
                        icon={homeIcons.remove}
                        label={removeLabel}
                        size="sm"
                        data-remove-folder=""
                        onClick={() =>
                          setFolders(folders.filter((_, at) => at !== index))
                        }
                      />
                    </Tooltip>
                  </div>
                  <Field label={t("home.label.folder-description")}>
                    <Input
                      size="sm"
                      value={folder.description}
                      data-folder-description=""
                      onChange={(event) => {
                        const description = event.currentTarget.value;
                        setFolders(
                          folders.map((item, at) =>
                            at === index ? { ...item, description } : item,
                          ),
                        );
                      }}
                    />
                  </Field>
                </li>
              ))}
            </ul>
          )}
          {pickFailed ? (
            <p className={styles.error} role="alert" data-pick-failed="">
              {t("home.error.picker-failed")}
            </p>
          ) : null}
        </section>
        {match === null ? null : (
          <div className={styles.identity} data-identity="">
            {match.repo === "none" ? (
              <p className={styles.note} data-identity-note="not-git">
                {t("home.note.identity-not-git")}
              </p>
            ) : null}
            {match.same === null ? null : (
              <>
                <p className={styles.note} data-identity-note="registered">
                  {t("home.note.identity-registered", {
                    title: match.same.title,
                  })}
                </p>
                <p className={styles.note} data-identity-note="another-copy">
                  {t("home.note.identity-another-copy")}
                </p>
              </>
            )}
            {match.repo === "git" &&
            match.same === null &&
            match.file !== "none" &&
            match.file !== "unreadable" ? (
              <p className={styles.note} data-identity-note="existing">
                {t("home.note.identity-existing")}
              </p>
            ) : null}
            {lost === undefined ? null : (
              <div className={styles.line} data-identity-note="relink">
                <p className={styles.note}>
                  {t("home.note.identity-relink", { title: lost.title })}
                </p>
                <Button
                  size="sm"
                  icon={commonIcons.openLink}
                  disabled={busy}
                  data-relink=""
                  onClick={() => void relink()}
                >
                  {t("home.button.identity-relink", { title: lost.title })}
                </Button>
              </div>
            )}
            {relinkFailed ? (
              <p className={styles.error} role="alert" data-relink-failed="">
                {t("home.error.relink-failed")}
              </p>
            ) : null}
            {canShare ? (
              <div data-identity-note="share">
                <div className={styles.line}>
                  <span className={styles.shareLabel}>
                    {t("home.label.share-identity")}
                  </span>
                  <span className={styles.toggleCell}>
                    <Switch
                      label={t("home.label.share-identity")}
                      checked={share}
                      onCheckedChange={setShare}
                    />
                  </span>
                </div>
                <p className={styles.note}>
                  {t("home.note.identity-adds-file")}
                </p>
              </div>
            ) : null}
          </div>
        )}
        {failure !== null ? (
          <p className={styles.error} role="alert" data-register-failed="">
            {t("home.error.register-failed", { name: failure })}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
