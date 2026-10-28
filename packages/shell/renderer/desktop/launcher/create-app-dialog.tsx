import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { AppsSource } from "../../apps/source.ts";
import { usableTitle } from "./model.ts";
import styles from "./register-dialog.module.css";

interface CreateAppDialogProps {
  open: boolean;
  source: AppsSource;
  onClose: () => void;
  onCreated: (created: { id: string }) => void;
}

// 새 앱 창: 이름과 한 줄 목적. 만들면 그 앱 place의 lophn 새 session으로 이어서 시작한다.
export function CreateAppDialog({
  open,
  source,
  onClose,
  onCreated,
}: CreateAppDialogProps) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setPurpose("");
    setTouched(false);
    setBusy(false);
    setFailure(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async () => {
    setTouched(true);
    if (!usableTitle(name) || !usableTitle(purpose) || busy) return;
    setBusy(true);
    setFailure(null);
    const result = await source.create({
      name: name.trim(),
      description: purpose.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setFailure(
        result.code === "conflict"
          ? t("launcher.error.app-name-taken", { name: name.trim() })
          : t("launcher.error.app-create-failed", { name: name.trim() }),
      );
      return;
    }
    reset();
    onCreated(result.value);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={t("launcher.title.new-app")}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy}
            data-create-app=""
          >
            {t("launcher.button.create-app")}
          </Button>
        </>
      }
    >
      <div className={styles.form} data-new-app-form="">
        <p className={styles.note}>{t("launcher.dialog.new-app-note")}</p>
        <Field
          label={t("launcher.label.name")}
          error={
            touched && !usableTitle(name)
              ? t("launcher.error.name-required")
              : undefined
          }
        >
          <Input
            value={name}
            autoFocus
            data-field="name"
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        <Field
          label={t("launcher.label.purpose")}
          help={t("launcher.field.app-purpose-help")}
          error={
            touched && !usableTitle(purpose)
              ? t("launcher.error.purpose-required")
              : undefined
          }
        >
          <Input
            value={purpose}
            data-field="purpose"
            onChange={(event) => setPurpose(event.currentTarget.value)}
          />
        </Field>
        {failure !== null ? (
          <p className={styles.error} role="alert" data-create-failed="">
            {failure}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
