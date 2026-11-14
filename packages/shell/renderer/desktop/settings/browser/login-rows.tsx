// Settings › Browser의 Logins 구역. site login(label, origin, username, note)을 더하고 고치고 지우고,
// password와 TOTP seed는 보호 입력 창으로 넣는다. 값은 이 화면에 없고 있는지만 안다.
import { Fragment, useMemo, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";
import { Field, Input } from "@lophn/ui/input";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../../icons/mod.ts";

import { loginsList } from "../../../../../protocol/secrets/logins.ts";
import { secretStatus } from "../../../../../protocol/secrets/secret-file.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { bothLoaded } from "../loaded.ts";
import styles from "../settings.module.css";
import type { BrowserSettingsSource, LoginForm, LoginRow } from "./source.ts";
import { loginRowsOf } from "./window-source.ts";

const EMPTY: LoginForm = { label: "", origin: "", username: "", note: "" };

/** 사람이 친 주소에서 origin만 남긴다. 해석되지 않거나 origin이 없으면 null이다. */
function originOf(input: string): string | null {
  const text = input.trim();
  if (!URL.canParse(text)) return null;
  const { origin } = new URL(text);
  return origin === "null" ? null : origin;
}

export function LoginRows({ source }: { source: BrowserSettingsSource }) {
  const logins = useCoreRead(loginsList, {});
  const secrets = useCoreRead(secretStatus, {});
  const loaded = useMemo(
    () => bothLoaded(logins.loaded, secrets.loaded, loginRowsOf),
    [logins.loaded, secrets.loaded],
  );
  // 고치는 줄의 id. 새로 더하는 줄은 "new"다.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<LoginForm>(EMPTY);
  const [error, setError] = useState<"invalid" | "failed" | null>(null);
  const [deleting, setDeleting] = useState<LoginRow | null>(null);
  const [failed, setFailed] = useState(false);

  if (loaded.state === "loading") return null;
  if (loaded.state === "failed") {
    return (
      <p className={styles.notice} data-logins="failed">
        {t("settings.error.logins-load-failed")}
      </p>
    );
  }
  const list: readonly LoginRow[] = loaded.value;

  function open(id: string, next: LoginForm): void {
    setForm(next);
    setError(null);
    setEditing(id);
  }

  async function submit(): Promise<void> {
    const origin = originOf(form.origin);
    if (origin === null || form.label.trim() === "") return setError("invalid");
    const saved = await source.saveLogin({
      ...(editing === "new" ? {} : { id: editing! }),
      label: form.label.trim(),
      origin,
      username: form.username,
      note: form.note,
    });
    if (saved.ok) setEditing(null);
    else setError(saved.code === "invalid_input" ? "invalid" : "failed");
  }

  async function enter(
    login: LoginRow,
    field: "password" | "totp",
  ): Promise<void> {
    const done = await source.enterLoginSecret(login, field);
    setFailed(!done.ok);
  }

  async function remove(login: LoginRow): Promise<void> {
    setDeleting(null);
    const done = await source.deleteLogin(login.id);
    setFailed(!done.ok);
  }

  const set = (patch: Partial<LoginForm>) => setForm({ ...form, ...patch });
  const editor = (
    <li className={styles.line} data-login-form="">
      <div className={styles.lineMain}>
        <Field label={t("settings.label.login-label")}>
          <Input
            value={form.label}
            autoFocus
            onChange={(event) => set({ label: event.target.value })}
          />
        </Field>
        <Field
          label={t("settings.label.login-origin")}
          help={t("settings.note.login-origin")}
        >
          <Input
            value={form.origin}
            spellCheck={false}
            onChange={(event) => set({ origin: event.target.value })}
          />
        </Field>
        <Field label={t("settings.label.login-username")}>
          <Input
            value={form.username}
            spellCheck={false}
            onChange={(event) => set({ username: event.target.value })}
          />
        </Field>
        <Field label={t("settings.label.login-note")}>
          <Input
            value={form.note}
            onChange={(event) => set({ note: event.target.value })}
          />
        </Field>
        {error === null ? null : (
          <p className={styles.rejected} role="alert" data-login-error="">
            {error === "invalid"
              ? t("settings.error.login-invalid")
              : t("settings.error.login-failed")}
          </p>
        )}
      </div>
      <div className={styles.lineControl}>
        <div className={styles.actions}>
          <Button onClick={() => setEditing(null)}>
            {t("settings.button.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={actionIcons.save}
            data-login-save=""
            onClick={() => void submit()}
          >
            {t("settings.button.login-save")}
          </Button>
        </div>
      </div>
    </li>
  );

  return (
    <>
      {failed ? (
        <p className={styles.rejected} role="alert" data-login-error="">
          {t("settings.error.login-failed")}
        </p>
      ) : null}
      {list.length === 0 && editing === null ? (
        <p className={styles.notice} data-logins="empty">
          {t("settings.notice.logins-empty")}
        </p>
      ) : (
        <ul className={styles.lines} data-logins="ok">
          {list.map((login) =>
            editing === login.id ? (
              <Fragment key={login.id}>{editor}</Fragment>
            ) : (
              <li key={login.id} className={styles.line} data-login={login.id}>
                <div className={styles.lineMain}>
                  <span className={styles.productName}>{login.label}</span>
                  <span
                    className={`${styles.lineHelp} ${styles.mono}`}
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {login.origin}
                  </span>
                  {login.username === "" ? null : (
                    <span className={styles.lineHelp}>{login.username}</span>
                  )}
                  <span className={styles.lineHelp} data-login-state="">
                    {t("settings.text.login-state", {
                      password: login.password ? "yes" : "no",
                      totp: login.totp ? "yes" : "no",
                    })}
                  </span>
                </div>
                <div className={styles.lineControl}>
                  <div className={styles.actions}>
                    <Button
                      data-login-password=""
                      onClick={() => void enter(login, "password")}
                    >
                      {t("settings.button.login-set-password")}
                    </Button>
                    <Button
                      data-login-totp=""
                      onClick={() => void enter(login, "totp")}
                    >
                      {t("settings.button.login-set-totp")}
                    </Button>
                    <Button
                      icon={actionIcons.edit}
                      data-login-edit=""
                      onClick={() =>
                        open(login.id, {
                          label: login.label,
                          origin: login.origin,
                          username: login.username,
                          note: login.note,
                        })
                      }
                    >
                      {t("settings.button.login-edit")}
                    </Button>
                    <Button
                      variant="secondary"
                      icon={actionIcons.delete}
                      data-login-delete=""
                      onClick={() => setDeleting(login)}
                    >
                      {t("settings.button.login-delete")}
                    </Button>
                  </div>
                </div>
              </li>
            ),
          )}
          {editing === "new" ? editor : null}
        </ul>
      )}
      {editing === null ? (
        <div className={styles.actions}>
          <Button
            icon={actionIcons.add}
            data-login-add=""
            onClick={() => open("new", EMPTY)}
          >
            {t("settings.button.login-add")}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={t("settings.title.login-delete")}
        actions={
          <>
            <Button onClick={() => setDeleting(null)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.delete}
              data-login-delete-confirm=""
              onClick={() => void remove(deleting!)}
            >
              {t("settings.button.login-delete-confirm")}
            </Button>
          </>
        }
      >
        {t("settings.note.login-delete-confirm", {
          label: deleting?.label ?? "",
        })}
      </Dialog>
    </>
  );
}
