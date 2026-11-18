import { useState } from "react";
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";

import { actionIcons } from "../icons/mod.ts";
import type {
  SecretInputPurpose,
  SecretInputSubmitReply,
} from "../../ipc/secret-input.ts";
import styles from "./secret-input.module.css";

interface SecretInputProps {
  purpose: SecretInputPurpose;
  /** 대상 이름: 앱, provider, MCP server. */
  subject: string;
  /** 저장할 secret 이름. */
  name: string;
  /** 이미 값이 있다. 저장하면 값을 바꾼다. */
  configured: boolean;
  /** 다른 기계의 범위에서 열었으면 값이 갈 그 기계의 이름. */
  machine?: string;
  /** 칸에 값을 넣은 채 시작한다(gallery용). 점으로만 보인다. */
  initialValue?: string;
  onSubmit?: (value: string) => Promise<SecretInputSubmitReply>;
  onCancel?: () => void;
}

const loginKind = (name: string) =>
  name.endsWith(".totp") ? "login-totp" : "login-password";

/**
 * secret 값을 받는 작은 창의 내용. 값은 이 칸에서 main으로 한 번 가고 화면 상태에 남기지 않는다
 * (보내기 전에 칸을 비운다). 저장되면 main이 창을 닫는다.
 */
export function SecretInput({
  purpose,
  subject,
  name,
  configured,
  machine,
  initialValue = "",
  onSubmit,
  onCancel,
}: SecretInputProps) {
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
  // login은 같은 purpose에서 password와 TOTP seed를 이름 끝으로 가른다.
  const kind = purpose === "login" ? loginKind(name) : purpose;
  const title = t(`secret-input.title.${kind}`);
  return (
    <div className={styles.root} role="dialog" aria-label={title}>
      <div className={styles.bar}>{t("secret-input.title.bar")}</div>
      <div className={styles.body}>
        <h1 className={styles.title}>{title}</h1>
        {/* 이 컴퓨터가 아닌 곳에 넣는다는 것을 사람이 알아야 한다. */}
        {machine === undefined ? null : (
          <p className={styles.machine} data-secret-machine="">
            {t("secret-input.label.goes-to", { name: machine })}
          </p>
        )}
        {purpose === "login" ? (
          // 값이 갈 site다. 속아서 넣는 것을 사람이 origin으로 거른다.
          <div className={styles.site} data-secret-origin="">
            <span className={styles.siteLabel}>
              {t("secret-input.label.login-site")}
            </span>
            <span className={styles.origin}>{subject}</span>
            {configured ? (
              <span className={styles.text}>
                {t("secret-input.help.configured")}
              </span>
            ) : null}
          </div>
        ) : (
          <p className={styles.text}>
            <span>
              {t(`secret-input.label.subject-${purpose}`, { subject })}
            </span>
            {/* 새 provider를 잇는 창은 이름이 없다: core가 id를 정한다. */}
            {name === "" ? null : (
              <span className={styles.name}>
                {t("secret-input.label.saved-as", { name })}
              </span>
            )}
            {configured ? (
              <span>{t("secret-input.help.configured")}</span>
            ) : null}
          </p>
        )}
        <Field
          label={t(`secret-input.label.field-${kind}`)}
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
            icon={actionIcons.save}
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
