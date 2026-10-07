// 연결 하나(flow connect-provider). contract가 알려 준 인증 방식(API key, 공식 로그인, 이 컴퓨터)만
// 보이고 과금·구독 한도·모르는 금액을 구별한다. key는 이 화면이 받지 않고 보호 창이 받는다.
// 공식 로그인 단추는 확인 창 없이 OS browser로 연다(shell/app-frame#R7).
import { useState } from "react";
import { Button, Card, Field, Input } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { AccountList } from "../accounts/account-list.tsx";
import { billingLabel, timeText, wayLabel } from "../model.ts";
import type { ProviderRow, SettingsSource, SignIn } from "../source.ts";
import styles from "../settings.module.css";

export interface ProviderCardProps {
  source: SettingsSource;
  provider: ProviderRow;
  onChanged: () => void;
}

type Flow =
  | { readonly state: "idle" }
  | { readonly state: "starting" }
  | {
    readonly state: "waiting";
    readonly signIn: SignIn;
    readonly opened: boolean;
  }
  | { readonly state: "absent" }
  | { readonly state: "failed" };

type Notice = "window-opened" | "window-failed" | null;

export function ProviderCard(
  { source, provider, onChanged }: ProviderCardProps,
) {
  const [flow, setFlow] = useState<Flow>({ state: "idle" });
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  async function signIn(): Promise<void> {
    setFlow({ state: "starting" });
    const begun = await source.beginSignIn(provider.id);
    if (!begun.ok) {
      setFlow({ state: begun.code === "not_found" ? "absent" : "failed" });
      return;
    }
    const opened = begun.value.url === null
      ? false
      : await source.openLink(begun.value.url);
    setFlow({ state: "waiting", signIn: begun.value, opened });
  }

  async function cancelSignIn(login: string): Promise<void> {
    await source.cancelSignIn(provider.id, login);
    setFlow({ state: "idle" });
  }

  async function addKey(): Promise<void> {
    const name = label.trim();
    if (name === "") return;
    const opened = await source.connectKey(provider.id, name);
    setNotice(opened.ok ? "window-opened" : "window-failed");
    if (opened.ok) {
      setAdding(false);
      setLabel("");
      onChanged();
    }
  }

  async function enterResponse(): Promise<void> {
    const opened = await source.enterSignInResponse(provider.id, provider.name);
    setNotice(opened.ok ? "window-opened" : "window-failed");
  }

  const checked = provider.lastCheck;
  return (
    <Card>
      <div className={styles.cardHead}>
        <h2 className={styles.heading}>{provider.name}</h2>
        {provider.enabled
          ? null
          : <span className={styles.tag}>{t("settings.label.off")}</span>}
      </div>
      <ul
        className={styles.ways}
        aria-label={t("settings.label.ways")}
        data-provider-ways=""
      >
        {provider.ways.map((way) => (
          <li key={way} className={styles.way} data-way={way}>
            <span className={styles.wayText}>
              <span className={styles.subheading}>{wayLabel(way)}</span>
              <span className={styles.muted}>{billingLabel(way)}</span>
              {way === "oauth" && provider.signIn?.verified === false
                ? (
                  <span className={styles.muted} data-sign-in="unverified">
                    {t("settings.providers.sign-in-unverified")}
                  </span>
                )
                : null}
            </span>
            {way === "oauth"
              ? (
                <Button
                  size="sm"
                  data-action="sign-in"
                  disabled={provider.signIn?.verified !== true ||
                    flow.state === "starting" || flow.state === "waiting"}
                  onClick={() => void signIn()}
                >
                  {t("settings.button.sign-in", { name: provider.name })}
                </Button>
              )
              : null}
            {way === "api_key"
              ? (
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="add-key"
                  aria-expanded={adding}
                  onClick={() => setAdding(!adding)}
                >
                  {t("settings.button.add-key")}
                </Button>
              )
              : null}
          </li>
        ))}
      </ul>
      {adding
        ? (
          <form
            className={styles.form}
            data-add-key=""
            onSubmit={(event) => {
              event.preventDefault();
              void addKey();
            }}
          >
            <Field
              label={t("settings.label.account-name")}
              help={t("settings.providers.account-name-help")}
            >
              <Input
                value={label}
                autoComplete="off"
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
            </Field>
            <div className={styles.actions}>
              <Button
                size="sm"
                type="submit"
                data-action="continue-key"
                disabled={label.trim() === ""}
              >
                {t("settings.button.continue")}
              </Button>
            </div>
          </form>
        )
        : null}
      {flow.state === "waiting"
        ? (
          <div className={styles.form} data-sign-in="waiting">
            <p className={styles.text}>
              {flow.signIn.url === null
                ? t("settings.sign-in.no-page")
                : flow.opened
                ? t("settings.sign-in.waiting")
                : t("settings.sign-in.not-opened")}
            </p>
            {flow.signIn.code === null
              ? null
              : (
                <p className={styles.text} data-sign-in-code="">
                  {t("settings.sign-in.code", { code: flow.signIn.code })}
                </p>
              )}
            <div className={styles.actions}>
              {flow.signIn.url !== null && !flow.opened
                ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    data-action="open-again"
                    onClick={() => {
                      void source.openLink(flow.signIn.url!).then((opened) =>
                        setFlow({ ...flow, opened })
                      );
                    }}
                  >
                    {t("settings.button.open-again")}
                  </Button>
                )
                : null}
              {flow.signIn.paste
                ? (
                  <Button
                    size="sm"
                    data-action="enter-response"
                    onClick={() => void enterResponse()}
                  >
                    {t("settings.button.enter-response")}
                  </Button>
                )
                : null}
              <Button
                size="sm"
                variant="ghost"
                data-action="cancel-sign-in"
                onClick={() => void cancelSignIn(flow.signIn.login)}
              >
                {t("settings.button.cancel-sign-in")}
              </Button>
            </div>
          </div>
        )
        : null}
      {flow.state === "absent"
        ? (
          <p className={styles.notice} role="status" data-sign-in="absent">
            {t("settings.sign-in.absent", { name: provider.name })}
          </p>
        )
        : null}
      {flow.state === "failed"
        ? (
          <p className={styles.notice} role="status" data-sign-in="failed">
            {t("settings.sign-in.failed", { name: provider.name })}
          </p>
        )
        : null}
      {notice === null
        ? null
        : (
          <p className={styles.notice} role="status" data-notice={notice}>
            {notice === "window-opened"
              ? t("settings.notice.window-opened")
              : t("settings.error.window")}
          </p>
        )}
      <AccountList
        source={source}
        provider={provider}
        onChanged={onChanged}
        onSignIn={() => void signIn()}
        onNotice={setNotice}
      />
      <p className={styles.muted} data-last-check={checked?.result ?? "never"}>
        {checked === null
          ? t("settings.providers.never-tested")
          : checked.result === "success"
          ? t("settings.providers.tested-ok", {
            time: timeText(checked.at),
          })
          : t("settings.providers.tested-failed", {
            time: timeText(checked.at),
          })}
      </p>
    </Card>
  );
}
