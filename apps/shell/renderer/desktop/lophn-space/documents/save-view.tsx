import { type FormEvent, useState } from "react";
import {
  Field,
  IconButton,
  Input,
  lophnSpaceIcons,
  Popover,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { LophnSource, SearchConditions } from "../source.ts";
import styles from "./documents.module.css";

type Saving =
  | { readonly kind: "idle" }
  | { readonly kind: "saved"; readonly name: string }
  | { readonly kind: "failed"; readonly taken: boolean };

// 지금 조건을 이름 붙여 saved view로 저장한다. 문서 사본을 만들지 않고 조건만 남긴다.
export function SaveView(
  { source, conditions, onSaved }: {
    source: LophnSource;
    conditions: SearchConditions;
    onSaved: () => void;
  },
) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState<Saving>({ kind: "idle" });
  const label = t("documents.button.save-view");
  const confirm = t("documents.button.confirm-save-view");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (name.trim() === "") return;
    const result = await source.saveView(name, conditions);
    if (!result.ok) {
      setSaving({ kind: "failed", taken: result.code === "conflict" });
      return;
    }
    setSaving({ kind: "saved", name: result.value.name });
    setName("");
    setOpen(false);
    onSaved();
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setSaving({ kind: "idle" });
        }}
        trigger={
          <IconButton
            icon={lophnSpaceIcons.saveView}
            label={label}
            data-save-view=""
          />
        }
      >
        <form
          className={styles.inline}
          onSubmit={(event) => void submit(event)}
          data-save-view-form=""
        >
          <div className={styles.grow}>
            <Field
              label={t("documents.label.view-name")}
              error={saving.kind === "failed"
                ? saving.taken
                  ? t("documents.error.view-name-taken")
                  : t("documents.error.save-view-failed")
                : undefined}
            >
              <Input
                data-view-name=""
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </div>
          <Tooltip content={confirm}>
            <IconButton
              icon={lophnSpaceIcons.savedView}
              label={confirm}
              type="submit"
              variant="secondary"
              data-save-view-submit=""
            />
          </Tooltip>
        </form>
      </Popover>
      {saving.kind === "saved"
        ? (
          <span className={styles.hint} role="status" data-view-saved="">
            {t("documents.notice.view-saved", { name: saving.name })}
          </span>
        )
        : null}
    </>
  );
}
