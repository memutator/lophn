// [New domain] dialog. name(slug), title, 목적 한 줄을 받는다. name은 만든 뒤 바꿀 수 없다.
// name 규칙은 core의 slug 규칙을 그대로 써서 입력에서 먼저 막고, 같은 이름(보관한 것 포함)은 core가 conflict로 거절한다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { domainNameSchema } from "../../../../protocol/domains/values.ts";
import type { DomainDraft, DomainOpResult } from "../source.ts";
import styles from "./create-domain-dialog.module.css";
import { actionIcons } from "../../icons/mod.ts";

export function CreateDomainDialog({
  onCreate,
  onClose,
}: {
  onCreate: (draft: DomainDraft) => Promise<DomainOpResult>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const nameBad = name !== "" && !domainNameSchema.safeParse(name).success;
  const ready = name !== "" && !nameBad && title.trim() !== "" && !busy;

  async function submit(): Promise<void> {
    if (!ready) return;
    setBusy(true);
    const result = await onCreate({
      name,
      title: title.trim(),
      purpose: purpose.trim(),
    });
    setBusy(false);
    if (result.ok) onClose();
    else setRefused(result.code);
  }

  const nameError = nameBad
    ? t("domain.error.name-invalid")
    : refused === "conflict"
      ? t("domain.error.name-taken")
      : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => open || onClose()}
      title={t("domain.title.create")}
      actions={
        <>
          <Button onClick={onClose}>{t("common.button.cancel")}</Button>
          <Button
            variant="primary"
            icon={actionIcons.create}
            disabled={!ready}
            onClick={() => void submit()}
          >
            {t("domain.button.create")}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field
          label={t("domain.label.name")}
          help={t("domain.note.name-help")}
          error={nameError}
        >
          <Input
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              setRefused(null);
            }}
          />
        </Field>
        <Field label={t("domain.label.title")}>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field
          label={t("domain.label.purpose")}
          help={t("domain.note.purpose-help")}
        >
          <Input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </Field>
        {refused !== null && refused !== "conflict" ? (
          <p className={styles.failed} role="alert">
            {t("domain.error.create-failed")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
