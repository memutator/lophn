// Settings › Browser의 Logins 구역. site login(label, origin, username, note)을 browser profile마다 묶어 보이고(기본이 먼저)
// 더하고 고치고 지우고, password와 TOTP seed는 보호 입력 창으로 넣는다. 값은 이 화면에 없고 있는지만 안다.
// login은 만든 profile에 속하고 다른 profile로 옮기지 못한다.
import { Fragment, useMemo, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";
import { Field, Input } from "@lophn/ui/input";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../../icons/mod.ts";

import { loginsList } from "../../../../../protocol/secrets/logins.ts";
import { secretStatus } from "../../../../../protocol/secrets/secret-file.ts";
import { browserProfilesList } from "../../../../../protocol/secrets/browser-vault.ts";
import {
  type Loaded,
  readRoute,
  readsOf,
  useCoreRead,
  useFollowedRead,
} from "../../connection/core-read.ts";
import { ProfileMark } from "../../../browser/browser-chrome.tsx";
import styles from "../settings.module.css";
import type {
  BrowserProfile,
  BrowserSettingsSource,
  LoginForm,
  LoginRow,
} from "./source.ts";
import { useDeletesSpread } from "./share-row.tsx";
import { loginRowsOf } from "./window-source.ts";

const EMPTY: LoginForm = { label: "", origin: "", username: "", note: "" };

/** 사람이 친 주소에서 origin만 남긴다. 해석되지 않거나 origin이 없으면 null이다. */
function originOf(input: string): string | null {
  const text = input.trim();
  if (!URL.canParse(text)) return null;
  const { origin } = new URL(text);
  return origin === "null" ? null : origin;
}

/** 저장 login 전체(모든 profile). Profiles 구역도 지울 login을 세려고 쓴다. */
export function useLoginRows(): Loaded<readonly LoginRow[]> {
  return useFollowedRead<readonly LoginRow[]>(
    async (core) => {
      const [logins, secrets] = await Promise.all([
        readRoute(core, loginsList, {}),
        readRoute(core, secretStatus, {}),
      ]);
      return logins.ok && secrets.ok
        ? { ok: true as const, value: loginRowsOf(logins.value, secrets.value) }
        : { ok: false as const };
    },
    [...readsOf(loginsList, {}), ...readsOf(secretStatus, {})],
    "",
  ).loaded;
}

// 묶음 하나. profile이 null이면 기본 profile이다.
interface Group {
  readonly profile: BrowserProfile | null;
  readonly logins: readonly LoginRow[];
}

export function LoginRows({ source }: { source: BrowserSettingsSource }) {
  const loaded = useLoginRows();
  const spreads = useDeletesSpread();
  const profileRead = useCoreRead(browserProfilesList, {}).loaded;
  const profiles = useMemo(
    () => (profileRead.state === "ready" ? profileRead.value.profiles : null),
    [profileRead],
  );
  // 고치는 줄의 id. 새로 더하는 줄은 "new:<profile id>"이고 기본 profile이면 "new:"다.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<LoginForm>(EMPTY);
  const [error, setError] = useState<"invalid" | "failed" | null>(null);
  const [deleting, setDeleting] = useState<LoginRow | null>(null);
  const [failed, setFailed] = useState(false);

  if (loaded.state === "loading" || profileRead.state === "loading") {
    return null;
  }
  if (loaded.state === "failed") {
    return (
      <p className={styles.notice} data-logins="failed">
        {t("settings.error.logins-load-failed")}
      </p>
    );
  }
  if (profiles === null) {
    return (
      <p className={styles.notice} data-logins="failed">
        {t("settings.error.profiles-load-failed")}
      </p>
    );
  }
  const groups: readonly Group[] = [null, ...profiles].map((profile) => ({
    profile,
    logins: loaded.value.filter(
      (login) => login.profile === (profile?.id ?? null),
    ),
  }));

  function open(id: string, next: LoginForm): void {
    setForm(next);
    setError(null);
    setEditing(id);
  }

  async function submit(): Promise<void> {
    const origin = originOf(form.origin);
    if (origin === null || form.label.trim() === "") return setError("invalid");
    const adding = editing!.startsWith("new:");
    const saved = await source.saveLogin({
      ...(adding ? { profile: editing!.slice(4) || null } : { id: editing! }),
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
      {groups.map(({ profile, logins }) => {
        const adding = `new:${profile?.id ?? ""}`;
        return (
          <div
            key={profile?.id ?? "default"}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              marginTop: "var(--space-5)",
            }}
            data-login-group={profile?.id ?? "default"}
          >
            <span className={styles.productName}>
              {profile === null ? null : <ProfileMark profile={profile} />}
              {profile?.name ?? t("settings.label.profile-default")}
            </span>
            {logins.length === 0 && editing !== adding ? (
              <p className={styles.notice} data-logins="empty">
                {t("settings.notice.logins-empty")}
              </p>
            ) : (
              <ul className={styles.lines} data-logins="ok">
                {logins.map((login) =>
                  editing === login.id ? (
                    <Fragment key={login.id}>{editor}</Fragment>
                  ) : (
                    <li
                      key={login.id}
                      className={styles.line}
                      data-login={login.id}
                    >
                      <div className={styles.lineMain}>
                        <span className={styles.productName}>
                          {login.label}
                        </span>
                        <span
                          className={`${styles.lineHelp} ${styles.mono}`}
                          style={{ overflowWrap: "anywhere" }}
                        >
                          {login.origin}
                        </span>
                        {login.username === "" ? null : (
                          <span className={styles.lineHelp}>
                            {login.username}
                          </span>
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
                {editing === adding ? editor : null}
              </ul>
            )}
            {editing === null ? (
              <div className={styles.actions}>
                <Button
                  icon={actionIcons.add}
                  data-login-add=""
                  onClick={() => open(adding, EMPTY)}
                >
                  {t("settings.button.login-add")}
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
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
        <p>
          {t("settings.note.login-delete-confirm", {
            label: deleting?.label ?? "",
          })}
        </p>
        {spreads ? (
          <p data-login-delete-shared="">{t("settings.note.delete-shared")}</p>
        ) : null}
      </Dialog>
    </>
  );
}
