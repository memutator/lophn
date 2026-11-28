// Source Control의 확인 창: 버리기(tracked 되돌리기와 untracked 지우기를 나눠 말한다)와 브랜치 이름 입력·지우기 확인.
import { t } from "@lophn/i18n";
import { Input } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { useState } from "react";
import { actionIcons } from "../../icons/mod.ts";
import styles from "./source-control.module.css";

export function DiscardDialog({
  name,
  tracked,
  untracked,
  onConfirm,
  onClose,
}: {
  /** 하나면 그 파일 이름, 여럿이면 null. */
  name: string | null;
  tracked: number;
  untracked: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        name === null
          ? t("source-control.title.discard-many", {
              count: tracked + untracked,
            })
          : t("source-control.title.discard", { name })
      }
      actions={
        <>
          <Button onClick={onClose}>{t("common.button.cancel")}</Button>
          <Button
            variant="danger"
            icon={actionIcons.delete}
            data-sc-discard-confirm=""
            onClick={onConfirm}
          >
            {t("source-control.button.discard-confirm")}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        {tracked > 0 ? (
          <p data-sc-discard-tracked="">
            {t("source-control.notice.discard-tracked", { count: tracked })}
          </p>
        ) : null}
        {untracked > 0 ? (
          <p className={styles.dangerText} data-sc-discard-untracked="">
            {t("source-control.notice.discard-untracked", { count: untracked })}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export function NameDialog({
  title,
  note,
  initial,
  confirm,
  error,
  onSubmit,
  onClose,
}: {
  title: string;
  note?: string;
  initial: string;
  confirm: string;
  error: string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const clean = value.trim();
  const bad = clean === "" || clean.startsWith("-") || /\s/.test(clean);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      actions={
        <>
          <Button onClick={onClose}>{t("common.button.cancel")}</Button>
          <Button
            variant="primary"
            disabled={bad}
            data-sc-name-confirm=""
            onClick={() => onSubmit(clean)}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        {note === undefined ? null : <p>{note}</p>}
        <Input
          autoFocus
          value={value}
          aria-label={t("source-control.label.branch-name")}
          placeholder={t("source-control.label.branch-name")}
          spellCheck={false}
          data-sc-name-input=""
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !bad) {
              event.preventDefault();
              onSubmit(clean);
            }
          }}
        />
        {error === null ? null : (
          <p className={styles.dangerText} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  text,
  confirm,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirm: string;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      actions={
        <>
          <Button onClick={onClose}>{t("common.button.cancel")}</Button>
          <Button
            variant="danger"
            icon={actionIcons.delete}
            onClick={onConfirm}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <p>{text}</p>
        {error === null ? null : (
          <p className={styles.dangerText} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
