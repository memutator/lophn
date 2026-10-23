// Access 탭의 secret 줄 wireframe. 줄 모양은 지금 Access 탭의 "Outside resources" 목록을 따른다.
// 값과 token은 어디에도 그리지 않는다. 값은 보호된 입력 창이 받는다(여기서 그리지 않는다).
import type { ReactNode } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import {
  Mono,
  Note,
  Pill,
  Section,
} from "../../../../packages/shell/renderer/app-frame/app-detail/parts.tsx";
import appDetail from "../../../../packages/shell/renderer/app-frame/app-detail/app-detail.module.css";
import type { OAuthReason, OAuthState, SecretRowData } from "./data.ts";
import styles from "./secret-rows.module.css";

type OAuth = NonNullable<SecretRowData["oauth"]>;

const FAILED_NOTE = {
  callback_timeout: () => t("app-detail.note.oauth-failed-callback-timeout"),
  state_mismatch: () => t("app-detail.note.oauth-failed-state-mismatch"),
  exchange_failed: () => t("app-detail.note.oauth-failed-exchange-failed"),
  refresh_rejected: () => t("app-detail.note.oauth-failed-refresh-rejected"),
  expired: () => t("app-detail.note.oauth-failed-expired"),
  store_failed: () => t("app-detail.note.oauth-failed-store-failed"),
} satisfies Record<OAuthReason, () => string>;

/** 이름 줄. [Revoke]는 오른쪽 끝에 그대로 있고 plain 줄의 [Set value]가 그 왼쪽에 붙는다. */
function Head(
  { row, children, hint }: {
    row: SecretRowData;
    children?: ReactNode;
    hint: ReactNode;
  },
) {
  return (
    <div className={styles.line}>
      <div className={appDetail.rowText}>
        <span className={appDetail.rowTitle}>
          <Pill>{t("app-detail.label.resource-secret")}</Pill>{" "}
          <Mono>{row.name}</Mono>
        </span>
        <span className={appDetail.muted}>{hint}</span>
      </div>
      <div className={appDetail.actions}>
        {children}
        <Button size="sm">{t("app-detail.button.revoke")}</Button>
      </div>
    </div>
  );
}

/** 설정 한 칸. 왼쪽에 이름과 값, 오른쪽 끝 열에 행동. */
function Setting(
  { label, children, action, below }: {
    label?: string;
    children: ReactNode;
    action: ReactNode;
    below?: string;
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
        <div className={appDetail.actions}>{action}</div>
      </div>
      {below === undefined
        ? null
        : <span className={appDetail.muted}>{below}</span>}
    </div>
  );
}

function ClientId({ value }: { value: string | null }) {
  if (value === null) {
    return (
      <div className={styles.line}>
        <div className={styles.settingText}>
          <Field label={t("app-detail.label.client-id")}>
            <Input size="sm" />
          </Field>
        </div>
        <div className={`${appDetail.actions} ${styles.alignEnd}`}>
          <Button size="sm">{t("app-detail.button.save-client-id")}</Button>
        </div>
      </div>
    );
  }
  return (
    <Setting
      label={t("app-detail.label.client-id")}
      action={
        <Button size="sm">{t("app-detail.button.change-client-id")}</Button>
      }
    >
      <span className={styles.clientId}>
        <Mono>{value}</Mono>
      </span>
    </Setting>
  );
}

function ClientSecret({ set }: { set: boolean }) {
  return (
    <Setting
      label={t("app-detail.label.client-secret")}
      action={
        <Button size="sm">
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

function stateMark(state: OAuthState, reason: OAuthReason | null) {
  switch (state) {
    case "none":
      return (
        <StatusMark
          tone="neutral"
          label={t("app-detail.label.oauth-not-signed-in")}
        />
      );
    case "in_progress":
      return (
        <StatusMark
          tone="warning"
          label={t("app-detail.label.oauth-waiting")}
        />
      );
    case "signed_in":
      return (
        <StatusMark
          tone="good"
          label={t("app-detail.label.oauth-signed-in")}
        />
      );
    case "failed":
      return (
        <StatusMark
          tone="critical"
          label={FAILED_NOTE[reason ?? "store_failed"]()}
        />
      );
  }
}

function SignIn({ oauth }: { oauth: OAuth }) {
  const { state, clientId } = oauth;
  const action = state === "in_progress"
    ? <Button size="sm">{t("app-detail.button.cancel")}</Button>
    : state === "none"
    ? (
      <Button size="sm" variant="primary" disabled={clientId === null}>
        {t("app-detail.button.sign-in")}
      </Button>
    )
    : <Button size="sm">{t("app-detail.button.sign-in-again")}</Button>;
  const below = state !== "none"
    ? undefined
    : clientId === null
    ? t("app-detail.note.oauth-needs-client-id")
    : t("app-detail.note.oauth-opens-browser");
  return (
    <Setting action={action} below={below}>
      {stateMark(state, oauth.reason)}
    </Setting>
  );
}

export function SecretRow({ row }: { row: SecretRowData }) {
  const { oauth } = row;
  if (oauth === null) {
    return (
      <li className={appDetail.item} data-secret={row.name}>
        <div className={styles.stack}>
          <Head
            row={row}
            hint={row.configured
              ? t("app-detail.label.secret-set")
              : t("app-detail.label.secret-not-set")}
          >
            <Button size="sm">
              {row.configured
                ? t("app-detail.button.change-value")
                : t("app-detail.button.set-value")}
            </Button>
          </Head>
        </div>
      </li>
    );
  }
  return (
    <li className={appDetail.item} data-secret={row.name} data-oauth="">
      <div className={styles.stack}>
        <Head
          row={row}
          hint={t("app-detail.label.oauth-sign-in-at", {
            host: oauth.authorizeHost,
            scopes: oauth.scopes.join(", "),
          })}
        />
        <ClientId value={oauth.clientId} />
        <ClientSecret set={oauth.clientSecretSet} />
        <SignIn oauth={oauth} />
      </div>
    </li>
  );
}

/** Access 탭 모양: 안내 + "Outside resources" 목록. 실제 탭에서는 file, network 줄이 같은 목록에 있다. */
export function SecretRows({ rows }: { rows: readonly SecretRowData[] }) {
  return (
    <div className={styles.tab} data-tab-body="access">
      <Note>{t("app-detail.note.access-intro-secrets")}</Note>
      <Section title={t("app-detail.heading.outside-resources")}>
        <ul className={appDetail.list} data-resources="">
          {rows.map((row) => <SecretRow key={row.name} row={row} />)}
        </ul>
        <p className={appDetail.muted}>
          {t("app-detail.note.resource-secret")}
        </p>
      </Section>
    </div>
  );
}
