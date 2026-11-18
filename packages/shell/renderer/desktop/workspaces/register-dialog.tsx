import { useEffect, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Field, Input, Select, Switch, Textarea } from "@lophn/ui/input";
import { Dialog, Tooltip } from "@lophn/ui/overlay";
import { actionIcons, commonIcons, homeIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import { useMachineGrant, useScopeMachineItem } from "../machines/context.tsx";
import { addFolder, missingFolder, usableTitle } from "./model.ts";
import type { FolderDraft, FolderMatch, RegisterSource } from "./source.ts";
import styles from "./register-dialog.module.css";

/** 이 컴퓨터의 창에서 project를 등록할 수 있는 다른 기계. 그 기계가 사람의 route를 허락했을 때만 고를 수 있다. */
export interface RegisterTarget {
  readonly machine: string;
  readonly name: string;
  /** 그 기계의 등록 통로. 폴더는 그 기계의 폴더 목록 dialog에서 고른다. */
  readonly source: RegisterSource;
  grant(): Promise<boolean>;
}

interface RegisterDialogProps {
  open: boolean;
  source: RegisterSource;
  /** 연결된 다른 기계. 허락한 기계가 있으면 맨 위에 기계 고르기가 선다. */
  targets?: readonly RegisterTarget[];
  onClose: () => void;
  /** `machine`은 다른 기계에 등록했을 때 그 기계다. */
  onRegistered: (created: { id: string }, machine?: string) => void;
}

const HERE = "";

// 프로젝트 등록 창: 이름, 목적, 폴더 목록과 폴더 추가, 오른쪽 아래 등록. 폴더는 source의 고르기로만 고르고(이 컴퓨터의 창은
// OS 선택기, 다른 기계의 범위은 그 기계의 폴더 목록 dialog) 0개여도 등록한다(앱 data만 있는 project). 런처와 Projects의 + 단추가 같이 쓴다.
// 첫 폴더를 읽어(match) 폴더 목록 아래에 저장소의 상태를 한 줄로 알린다. 읽지 못하면 줄 없이 등록한다.
// 다른 기계의 범위이 그 기계에서 사람의 route를 허락받지 못했으면 form 대신 그 까닭과 허락을 켜는 곳을 한 줄로 보인다.
// 이 컴퓨터의 창은 연결되어 허락한 다른 기계를 맨 위에서 골라 그 기계에 등록한다.
export function RegisterDialog({
  open,
  source: hereSource,
  targets,
  onClose,
  onRegistered,
}: RegisterDialogProps) {
  // 허락을 물어 고를 수 있는 기계. 허락은 사람이 아무 기계에서나 바꾸므로 열 때마다 묻는다.
  const [granted, setGranted] = useState<readonly RegisterTarget[]>([]);
  const [on, setOn] = useState(HERE);
  useEffect(() => {
    setOn(HERE);
    setGranted([]);
    if (!open || targets === undefined || targets.length === 0) return;
    let live = true;
    void Promise.all(
      targets.map(async (target) => ((await target.grant()) ? [target] : [])),
    ).then((rows) => {
      if (live) setGranted(rows.flat());
    });
    return () => {
      live = false;
    };
  }, [open, targets]);
  const target = granted.find((one) => one.machine === on);
  const source = target?.source ?? hereSource;
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
  const machine = useScopeMachineItem();
  const denied = useMachineGrant(open) === "denied";

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
    onRegistered(result.value, target?.machine);
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
            disabled={busy || denied}
            data-register=""
          >
            {t("home.button.register")}
          </Button>
        </>
      }
    >
      {denied ? (
        <p className={styles.note} data-register-no-grant="">
          {t("machines.notice.settings-no-grant", {
            name: machine?.name ?? "",
          })}
        </p>
      ) : (
        <div className={styles.form} data-register-form="">
          <p className={styles.note}>{t("home.dialog.register-note")}</p>
          {granted.length === 0 ? null : (
            <Field label={t("machines.label.computer")}>
              <Select
                value={on}
                options={[
                  { value: HERE, label: t("machines.button.this-computer") },
                  ...granted.map((one) => ({
                    value: one.machine,
                    label: one.name,
                  })),
                ]}
                onValueChange={(next) => {
                  // 폴더는 기계마다의 경로라 기계를 바꾸면 비운다.
                  setOn(next);
                  setFolders([]);
                  setPickFailed(false);
                }}
              />
            </Field>
          )}
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
      )}
    </Dialog>
  );
}
