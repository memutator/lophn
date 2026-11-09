import { useState } from "react";
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";

import { actionIcons } from "../icons/mod.ts";
import type {
  SecretInputSubmit,
  SecretInputSubmitReply,
} from "../../ipc/secret-input.ts";
import styles from "./secret-input.module.css";

interface LoginRequestFormProps {
  mode: "save" | "once";
  /** agent가 제안한 이름이다. 사람이 고친다. */
  label: string;
  /** shell main이 잰 origin이다. */
  origin: string;
  onSubmit?: (input: SecretInputSubmit) => Promise<SecretInputSubmitReply>;
  onCancel?: () => void;
}

/**
 * agent의 login 요청을 받는 창의 내용. save는 이름·username·password·선택 TOTP 칸이고 once는 값 한 칸이다.
 * 값은 이 칸들에서 main으로 한 번 가고 화면 상태에 남기지 않는다(보내기 전에 칸을 비운다).
 */
export function LoginRequestForm({
  mode,
  label,
  origin,
  onSubmit,
  onCancel,
}: LoginRequestFormProps) {
  const [name, setName] = useState(label);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"invalid" | "unavailable" | null>(null);
  const ready =
    password !== "" && (mode === "once" || name.trim() !== "") && !busy;
  const send = async () => {
    if (!ready || onSubmit === undefined) return;
    const input: SecretInputSubmit =
      mode === "once"
        ? { value: password }
        : {
            login: {
              label: name.trim(),
              username,
              password,
              ...(totp === "" ? {} : { totp }),
            },
          };
    setPassword("");
    setTotp("");
    setError(null);
    setBusy(true);
    try {
      const reply = await onSubmit(input);
      if (!reply.ok) {
        setError(reply.code === "invalid_input" ? "invalid" : "unavailable");
      }
    } catch {
      setError("unavailable");
    } finally {
      setBusy(false);
    }
  };
  const title = t(`secret-input.title.request-${mode}`);
  return (
    <div className={styles.root} role="dialog" aria-label={title}>
      <div className={styles.bar}>{t("secret-input.title.bar")}</div>
      <div className={styles.body}>
        <h1 className={styles.title}>{title}</h1>
        {/* 값이 갈 page다. 속아서 넣는 것을 사람이 origin으로 거른다. */}
        <div className={styles.site} data-secret-origin="">
          <span className={styles.siteLabel}>
            {t("secret-input.label.login-site")}
          </span>
          <span className={styles.origin}>{origin}</span>
        </div>
        {mode === "save" ? (
          <>
            <Field label={t("secret-input.label.request-label")}>
              <Input
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </Field>
            <Field label={t("secret-input.label.request-username")}>
              <Input
                autoComplete="off"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
              />
            </Field>
          </>
        ) : null}
        <Field
          label={t(
            mode === "once"
              ? "secret-input.label.request-once"
              : "secret-input.label.field-login-password",
          )}
          help={t(
            mode === "once"
              ? "secret-input.help.request-once"
              : "secret-input.help.value",
          )}
          {...(error === null
            ? {}
            : { error: t(`secret-input.error.${error}`) })}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-secret="input"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </Field>
        {mode === "save" ? (
          <Field label={t("secret-input.label.request-totp")}>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              data-secret="input"
              value={totp}
              onChange={(event) => setTotp(event.currentTarget.value)}
            />
          </Field>
        ) : null}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onCancel}>
            {t("secret-input.button.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={actionIcons.save}
            disabled={!ready}
            onClick={() => void send()}
          >
            {t(
              mode === "once"
                ? "secret-input.button.request-once"
                : "secret-input.button.save",
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
