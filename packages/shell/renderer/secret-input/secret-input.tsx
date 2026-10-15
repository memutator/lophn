import { useState } from "react";
import { t } from "@lophn/wording";
import { Button, Field, Input } from "@lophn/design/components";

import type {
  SecretInputPurpose,
  SecretInputSubmitReply,
} from "../../ipc/secret-input.ts";
import styles from "./secret-input.module.css";

export interface SecretInputProps {
  purpose: SecretInputPurpose;
  /** 대상 이름: 앱, provider, MCP server. */
  subject: string;
  /** 저장할 secret 이름. */
  name: string;
  /** 이미 값이 있다. 저장하면 값을 바꾼다. */
  configured: boolean;
  /** 칸에 값을 넣은 채 시작한다(gallery용). 점으로만 보인다. */
  initialValue?: string;
  onSubmit?: (value: string) => Promise<SecretInputSubmitReply>;
  onCancel?: () => void;
}

/**
 * secret 값을 받는 작은 창의 내용. 값은 이 칸에서 main으로 한 번 가고 화면 상태에 남기지 않는다
 * (보내기 전에 칸을 비운다). 저장되면 main이 창을 닫는다.
 */
export function SecretInput(
  {
    purpose,
    subject,
    name,
    configured,
    initialValue = "",
    onSubmit,
    onCancel,
  }: SecretInputProps,
) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"invalid" | "unavailable" | null>(null);
  const save = async () => {
    if (value === "" || busy || onSubmit === undefined) return;
    const sent = value;
    // 보내기 전에 칸을 비운다. 값은 이 호출의 인자로만 main에 간다.
    setValue("");
    setError(null);
    setBusy(true);
    try {
      const reply = await onSubmit(sent);
      if (!reply.ok) {
        setError(reply.code === "invalid_input" ? "invalid" : "unavailable");
      }
    } catch {
      setError("unavailable");
    } finally {
      setBusy(false);
    }
  };
  const title = t(`secret-input.title.${purpose}`);
  return (
    <div className={styles.root} role="dialog" aria-label={title}>
      <div className={styles.bar}>{t("secret-input.title.bar")}</div>
      <div className={styles.body}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.text}>
          <span>{t(`secret-input.label.subject-${purpose}`, { subject })}</span>
          <span className={styles.name}>
            {t("secret-input.label.saved-as", { name })}
          </span>
          {configured ? <span>{t("secret-input.help.configured")}</span> : null}
        </p>
        <Field
          label={t(`secret-input.label.field-${purpose}`)}
          help={t("secret-input.help.value")}
          {...(error === null
            ? {}
            : { error: t(`secret-input.error.${error}`) })}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-secret="input"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </Field>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onCancel}>
            {t("secret-input.button.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || value === ""}
            onClick={() => void save()}
          >
            {t("secret-input.button.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
