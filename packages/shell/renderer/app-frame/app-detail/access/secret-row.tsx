// Access 탭의 secret 줄. 값과 token은 어디에도 그리지 않는다. 값은 보호된 입력 창이 받는다(source가 연다).
// plain secret은 [Set value], OAuth secret은 client id·client secret·[Sign in]과 상태를 가진다.
import { type ReactNode, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import { oauthStatus } from "../model.ts";
import { Mono, Pill } from "../parts.tsx";
import type { SecretInfo } from "../source.ts";
import appDetail from "../app-detail.module.css";
import styles from "./secret-row.module.css";

type OAuth = NonNullable<SecretInfo["oauth"]>;

export interface SecretActions {
  setValue(): void;
  setClientId(clientId: string): void;
  setClientSecret(): void;
  signIn(): void;
  cancelSignIn(): void;
}

/** 이름 줄. [Revoke]는 오른쪽 끝에 그대로 있고 plain 줄의 [Set value]가 그 왼쪽에 붙는다. */
function Head(
  { name, hint, steps, revoke, children }: {
    name: string;
    hint: ReactNode;
    steps: ReactNode;
    revoke: ReactNode;
    children?: ReactNode;
  },
) {
  return (
    <div className={styles.line}>
      <div className={appDetail.rowText}>
        <span className={appDetail.rowTitle}>
          <Pill>{t("app-detail.label.resource-secret")}</Pill>{" "}
          <Mono>{name}</Mono>
        </span>
        <span className={appDetail.muted}>{hint}</span>
        {steps}
      </div>
      <div className={appDetail.actions}>
        {children}
        {revoke}
      </div>
    </div>
  );
}

/** 설정 한 칸. 왼쪽에 이름과 값, 오른쪽 끝 열에 행동. */
function Setting(
  { label, children, action, below, alignEnd }: {
    label?: string;
    children: ReactNode;
    action: ReactNode;
    below?: string;
    alignEnd?: boolean;
  },
) {
  return (
    <div className={styles.setting}>
      <div className={styles.line}>
        <div className={styles.settingText}>
          {label === undefined
            ? null
            : <span className={styles.caption}>{label}</span>}
          {children}
        </div>
        <div
          className={`${appDetail.actions} ${alignEnd ? styles.alignEnd : ""}`}
        >
          {action}
        </div>
      </div>
      {below === undefined
        ? null
        : <span className={appDetail.muted}>{below}</span>}
    </div>
  );
}

function ClientId(
  { value, onSave }: { value: string | null; onSave: (id: string) => void },
) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (value === null || editing) {
    return (
      <Setting
        alignEnd
        action={
          <>
            {value === null
              ? null
              : (
                <Button size="sm" onClick={() => setEditing(false)}>
                  {t("app-detail.button.cancel")}
                </Button>
              )}
            <Button
              size="sm"
              disabled={text.trim() === ""}
              onClick={() => {
                onSave(text.trim());
                setEditing(false);
              }}
            >
              {t("app-detail.button.save-client-id")}
            </Button>
          </>
        }
      >
        <Field label={t("app-detail.label.client-id")}>
          <Input
            size="sm"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
      </Setting>
    );
  }
  return (
    <Setting
      label={t("app-detail.label.client-id")}
      action={
        <Button
          size="sm"
          onClick={() => {
            setText(value);
            setEditing(true);
          }}
        >
          {t("app-detail.button.change-client-id")}
        </Button>
      }
    >
      <span className={styles.clientId}>
        <Mono>{value}</Mono>
      </span>
    </Setting>
  );
}

function ClientSecret({ set, onSet }: { set: boolean; onSet: () => void }) {
  return (
    <Setting
      label={t("app-detail.label.client-secret")}
      action={
        <Button size="sm" onClick={onSet}>
          {set
            ? t("app-detail.button.change-client-secret")
            : t("app-detail.button.set-client-secret")}
        </Button>
      }
    >
      <span className={appDetail.muted}>
        {set
          ? t("app-detail.label.secret-set")
          : t("app-detail.label.client-secret-optional")}
      </span>
    </Setting>
  );
}

function SignIn(
  { oauth, actions }: { oauth: OAuth; actions: SecretActions },
) {
  const { state, clientId } = oauth;
  const action = state === "in_progress"
    ? (
      <Button size="sm" onClick={actions.cancelSignIn}>
        {t("app-detail.button.cancel")}
      </Button>
    )
    : state === "none"
    ? (
      <Button
        size="sm"
        variant="primary"
        disabled={clientId === null}
        onClick={actions.signIn}
      >
        {t("app-detail.button.sign-in")}
      </Button>
    )
    : (
      <Button size="sm" onClick={actions.signIn}>
        {t("app-detail.button.sign-in-again")}
      </Button>
    );
  const below = state !== "none"
    ? undefined
    : clientId === null
    ? t("app-detail.note.oauth-needs-client-id")
    : t("app-detail.note.oauth-opens-browser");
  const status = oauthStatus(state, oauth.reason);
  return (
    <Setting action={action} below={below}>
      <StatusMark tone={status.tone} label={status.label} />
    </Setting>
  );
}

/**
 * revoke는 줄 오른쪽 끝의 [Revoke]나 거두기 상태, steps는 거두기 단계다. 거두기를 접수한 줄은 설정 칸을 보이지 않는다.
 */
export function SecretRow(
  { name, info, actions, revoke, steps }: {
    name: string;
    info: SecretInfo;
    actions: SecretActions;
    revoke: ReactNode;
    steps: ReactNode;
  },
) {
  const { oauth } = info;
  const revoking = steps !== null;
  if (oauth === null) {
    return (
      <li className={appDetail.item} data-secret={name}>
        <div className={styles.stack}>
          <Head
            name={name}
            hint={info.configured
              ? t("app-detail.label.secret-set")
              : t("app-detail.label.secret-not-set")}
            steps={steps}
            revoke={revoke}
          >
            {revoking ? null : (
              <Button size="sm" onClick={actions.setValue}>
                {info.configured
                  ? t("app-detail.button.change-value")
                  : t("app-detail.button.set-value")}
              </Button>
            )}
          </Head>
        </div>
      </li>
    );
  }
  return (
    <li className={appDetail.item} data-secret={name} data-oauth="">
      <div className={styles.stack}>
        <Head
          name={name}
          hint={t("app-detail.label.oauth-sign-in-at", {
            host: oauth.authorizeHost,
            scopes: oauth.scopes.join(", "),
          })}
          steps={steps}
          revoke={revoke}
        />
        {revoking ? null : (
          <>
            <ClientId value={oauth.clientId} onSave={actions.setClientId} />
            <ClientSecret
              set={oauth.clientSecretSet}
              onSet={actions.setClientSecret}
            />
            <SignIn oauth={oauth} actions={actions} />
          </>
        )}
      </div>
    </li>
  );
}
