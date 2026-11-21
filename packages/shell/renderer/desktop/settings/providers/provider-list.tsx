import { type ReactNode, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../../icons/mod.ts";

import {
  type ManageModelsApi,
  useManageModels,
} from "../../../conversation/model-picker/manage-context.ts";
import { providerList } from "../../../../../protocol/lophn-agent/providers.ts";
import {
  readRoute,
  readsOf,
  useFollowedRead,
} from "../../connection/core-read.ts";
import { useScopeMachineItem } from "../../machines/context.tsx";
import { wayLabel, waysOf } from "../model.ts";
import { AvailableList, useAvailable } from "./available-list.tsx";
import { ConnectDialog } from "./connect-dialog.tsx";
import { type ListedModels, useAfterConnect } from "./connect-host.tsx";
import { providerOf } from "./core-source.ts";
import { ProviderName } from "./provider-name.tsx";
import type {
  CredentialRow,
  ProviderDefinitionRow,
  ProviderRow,
  ProviderSettingsSource,
} from "./settings-source.ts";
import styles from "./provider-list.module.css";

interface ProviderListProps {
  source: ProviderSettingsSource;
}

// Settings › Providers. provider는 연결과 인증만 다룬다: model 고르기·기본값 칸이 없다.
// 위는 연결된 provider 목록으로, 각 provider 아래에 등록된 credential(OAuth 계정·API key)이 나열된다.
// 각 줄에는 방식·이메일/키 마스킹 힌트·Active 표시가 있고, 비활성 줄은 [Use], 2개 이상이면 [Remove]가 붙는다.
// provider마다 [+ Add account or key]로 연결을 끊지 않고 계정·키를 추가할 수 있고, [Disconnect]는 확인 창을 거쳐 전체를 끊는다.
export function ProviderList({ source }: ProviderListProps): ReactNode {
  // 다른 창이나 core가 이은·끊은 provider도 바로 보인다. 다시 읽다 실패해도 보이던 목록은 그대로다.
  const { loaded: connected, reload: reloadConnected } = useFollowedRead(
    async (core) => {
      const listed = await readRoute(core, providerList, {});
      return listed.ok
        ? { ok: true as const, value: listed.value.providers.map(providerOf) }
        : listed;
    },
    readsOf(providerList, {}),
    "",
  );
  const { available, retry: retryAvailable } = useAvailable();
  const [failed, setFailed] = useState<"disconnect" | "credential" | null>(
    null,
  );
  const [target, setTarget] = useState<ProviderDefinitionRow | null>(null);
  const [adding, setAdding] = useState<{
    providerId: string;
    definition: ProviderDefinitionRow;
  } | null>(null);
  const [leaving, setLeaving] = useState<ProviderRow | null>(null);
  const [busyCredential, setBusyCredential] = useState<string | null>(null);
  const afterConnect = useAfterConnect();
  const manage = useManageModels();
  // custom provider를 붙인 뒤 읽은 model 목록의 결과. 이 화면을 떠날 때까지 그 줄 아래에 둔다.
  const [listed, setListed] = useState<Readonly<Record<string, ListedModels>>>(
    {},
  );

  async function disconnect(row: ProviderRow): Promise<void> {
    setLeaving(null);
    setFailed(null);
    setListed(({ [row.id]: _, ...rest }) => rest);
    const done = await source.disconnect(row.id);
    if (!done.ok) setFailed("disconnect");
  }

  async function activateCredential(
    providerId: string,
    credentialId: string,
  ): Promise<void> {
    if (busyCredential !== null) return;
    setBusyCredential(credentialId);
    setFailed(null);
    const done = await source.activateCredential(providerId, credentialId);
    setBusyCredential(null);
    if (!done.ok) setFailed("credential");
  }

  async function removeCredential(
    providerId: string,
    credentialId: string,
  ): Promise<void> {
    if (busyCredential !== null) return;
    setBusyCredential(credentialId);
    setFailed(null);
    const done = await source.removeCredential(providerId, credentialId);
    setBusyCredential(null);
    if (!done.ok) setFailed("credential");
  }

  function startAddCredential(row: ProviderRow): void {
    const ways = waysOf(row.ways);
    if (ways.length === 0) return;
    setAdding({
      providerId: row.id,
      definition: {
        key: row.definition,
        name: row.name,
        hint: null,
        ways,
        signIn: row.signIn,
        custom: false,
      },
    });
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("settings.label.tab-providers")}</h1>
      <p className={styles.lead}>{t("settings.notice.provider-lead")}</p>
      <section>
        <h2 className={styles.sectionTitle}>
          {t("settings.heading.connected")}
        </h2>
        {connected.state === "failed" ? (
          <ErrorState
            target={t("settings.label.providers-target")}
            onRetry={reloadConnected}
          />
        ) : (
          <Loading
            loading={connected.state === "loading"}
            placeholder={<Skeleton lines={3} />}
          >
            {connected.state === "ready" && connected.value.length === 0 ? (
              <p className={styles.empty}>
                {t("settings.notice.none-connected")}
              </p>
            ) : (
              <ul className={styles.group}>
                {(connected.state === "ready" ? connected.value : []).map(
                  (row) => (
                    <ConnectedItem
                      key={row.id}
                      row={row}
                      listed={listed[row.id]}
                      manage={manage}
                      busyCredential={busyCredential}
                      onAddCredential={() => startAddCredential(row)}
                      onUseCredential={(credentialId) =>
                        void activateCredential(row.id, credentialId)
                      }
                      onRemoveCredential={(credentialId) =>
                        void removeCredential(row.id, credentialId)
                      }
                      onDisconnect={() => setLeaving(row)}
                    />
                  ),
                )}
              </ul>
            )}
          </Loading>
        )}
        {failed !== null ? (
          <p className={styles.notice} role="status" data-notice="failed">
            {t(
              failed === "disconnect"
                ? "agents.notice.providers-disconnect-failed"
                : "settings.error.credential-action-failed",
            )}
          </p>
        ) : null}
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t("settings.heading.add-provider")}
        </h2>
        <AvailableList
          available={available}
          onRetry={retryAvailable}
          onChoose={setTarget}
        />
      </section>
      <ConnectDialog
        source={source}
        definition={adding?.definition ?? target}
        addingProviderId={adding?.providerId ?? null}
        onClose={() => {
          setAdding(null);
          setTarget(null);
        }}
        onConnected={() => {
          if (adding !== null) return;
          afterConnect(
            connected.state === "ready"
              ? connected.value.map((row) => row.id)
              : [],
            (id, result) => setListed((now) => ({ ...now, [id]: result })),
          );
        }}
      />
      <Dialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title={t("agents.title.providers-disconnect", {
          name: leaving?.name ?? "",
        })}
        actions={
          <>
            <Button onClick={() => setLeaving(null)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.disconnect}
              data-action="confirm-disconnect"
              onClick={() => leaving !== null && void disconnect(leaving)}
            >
              {t("settings.button.disconnect")}
            </Button>
          </>
        }
      >
        <p>
          {t("agents.notice.providers-disconnect-body", {
            name: leaving?.name ?? "",
          })}
        </p>
      </Dialog>
    </div>
  );
}

function ConnectedItem({
  row,
  listed,
  manage,
  busyCredential,
  onAddCredential,
  onUseCredential,
  onRemoveCredential,
  onDisconnect,
}: {
  row: ProviderRow;
  listed: ListedModels | undefined;
  manage: ManageModelsApi | null;
  busyCredential: string | null;
  onAddCredential: () => void;
  onUseCredential: (credentialId: string) => void;
  onRemoveCredential: (credentialId: string) => void;
  onDisconnect: () => void;
}): ReactNode {
  const machine = useScopeMachineItem();
  const canAdd = waysOf(row.ways).length > 0;
  const canRemove = row.credentials.length > 1;
  return (
    <li className={styles.item} data-provider={row.id}>
      <div className={styles.header}>
        <span className={styles.identity}>
          <ProviderName name={row.name} />
        </span>
        <span className={styles.headerActions}>
          {canAdd ? (
            <Button
              size="sm"
              icon={actionIcons.add}
              data-action="add-credential"
              onClick={onAddCredential}
            >
              {t("settings.button.add-credential")}
            </Button>
          ) : null}
          <Button
            size="sm"
            icon={actionIcons.disconnect}
            data-action="disconnect"
            onClick={onDisconnect}
          >
            {t("settings.button.disconnect")}
          </Button>
        </span>
      </div>
      <ul className={styles.credentials} data-credentials="">
        {row.credentials.map((cred) => {
          const status = statusOf(cred);
          const detail = credentialDetail(cred);
          return (
            <li
              key={cred.id}
              className={styles.credentialRow}
              data-credential={cred.id}
              data-active={cred.active ? "true" : "false"}
            >
              <span className={styles.credentialInfo}>
                <span className={styles.badge} data-login-methods="">
                  {credentialWayLabel(row, cred, machine?.name)}
                </span>
                {detail === null ? null : (
                  <span
                    className={styles.credentialDetail}
                    data-credential-detail=""
                  >
                    {detail}
                  </span>
                )}
                {cred.active ? (
                  <span
                    className={styles.activeBadge}
                    data-credential-active=""
                  >
                    {t("settings.label.active")}
                  </span>
                ) : null}
              </span>
              <span className={styles.credentialActions}>
                {!cred.active ? (
                  <Button
                    size="sm"
                    disabled={busyCredential !== null}
                    data-action="use-credential"
                    onClick={() => onUseCredential(cred.id)}
                  >
                    {t("settings.button.use")}
                  </Button>
                ) : null}
                {canRemove ? (
                  <Button
                    size="sm"
                    disabled={busyCredential !== null}
                    data-action="remove-credential"
                    onClick={() => onRemoveCredential(cred.id)}
                  >
                    {t("settings.button.remove")}
                  </Button>
                ) : null}
              </span>
              {status === null ? null : (
                <p className={styles.status} data-status={status.kind}>
                  {status.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {listed === undefined ? null : (
        <div
          className={styles.result}
          data-models-result={listed.count > 0 ? "found" : "empty"}
        >
          <p className={styles.resultText}>
            {listed.count > 0
              ? t("conversation.notice.models-found", {
                  count: listed.count,
                  provider: listed.name,
                })
              : t("conversation.notice.models-not-listed", {
                  provider: listed.name,
                })}
          </p>
          {manage === null ? null : (
            <Button
              size="sm"
              icon={listed.count > 0 ? undefined : actionIcons.add}
              trailingIcon={listed.count > 0 ? actionIcons.open : undefined}
              data-action={listed.count > 0 ? "manage-models" : "add-model"}
              onClick={() =>
                manage.open(
                  listed.count > 0
                    ? { first: row.id }
                    : {
                        first: row.id,
                        addModel: {
                          provider: row.id,
                          lead: t("conversation.notice.models-not-listed", {
                            provider: listed.name,
                          }),
                        },
                      },
                )
              }
            >
              {listed.count > 0
                ? t("conversation.button.manage-models")
                : t("conversation.button.add-model")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** credential의 인증 방식 이름. OAuth는 제품명(예: Claude OAuth, ChatGPT OAuth)을 함께 보인다. */
function credentialWayLabel(
  row: ProviderRow,
  cred: CredentialRow,
  machine: string | undefined,
): string {
  if (cred.way === "oauth") {
    return row.signIn !== null
      ? t("settings.label.login-oauth", { product: row.signIn.product })
      : t("settings.label.login-signed-in");
  }
  return wayLabel(cred.way, machine);
}

/** credential의 식별 정보(OAuth 이메일·조직, API key 마스킹 힌트·라벨). */
function credentialDetail(cred: CredentialRow): string | null {
  const parts: string[] = [];
  if (cred.label !== null) parts.push(cred.label);
  if (cred.way === "oauth" && cred.account !== null) {
    if (cred.account.email !== null) parts.push(cred.account.email);
    if (cred.account.organizationName !== null) {
      parts.push(`(${cred.account.organizationName})`);
    }
  } else if (cred.way === "api_key" && cred.keyHint !== null) {
    parts.push(cred.keyHint);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * 쓸 수 없을 때만 그 상태와 다음 행동 한 줄을 말한다. 사용량 대기는 기다리라고, 요금제 제한은 요금제를
 * 확인하라고, 인증 문제는 다시 연결하라고 한다.
 */
function statusOf(
  cred: Pick<CredentialRow, "state" | "reason">,
): { kind: string; text: string } | null {
  if (cred.state === "available") return null;
  if (cred.state === "usage_wait") {
    return { kind: "usage-limit", text: t("settings.status.usage-limit") };
  }
  if (cred.reason === "plan_access") {
    return { kind: "plan-access", text: t("settings.status.plan-access") };
  }
  return {
    kind: "sign-in-problem",
    text: t("settings.status.sign-in-problem"),
  };
}
