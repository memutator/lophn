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
import { wayLabel } from "../model.ts";
import { AvailableList, useAvailable } from "./available-list.tsx";
import { ConnectDialog } from "./connect-dialog.tsx";
import { type ListedModels, useAfterConnect } from "./connect-host.tsx";
import { providerOf } from "./core-source.ts";
import { ProviderName } from "./provider-name.tsx";
import type {
  ProviderDefinitionRow,
  ProviderRow,
  ProviderSettingsSource,
} from "./settings-source.ts";
import styles from "./provider-list.module.css";

interface ProviderListProps {
  source: ProviderSettingsSource;
}

// Settings › Providers. provider는 연결과 인증만 다룬다: model 고르기·기본값 칸이 없다. 위는 연결된 provider
// (vendor 아이콘과 이름, 로그인 방법 badge, [Disconnect]; 사용량 대기나 사용 불가일 때만 그 상태와 다음 행동 한 줄)이고
// 아래는 Add a provider 목록(줄마다 [+ Connect])이다. provider 하나에는 연결 하나다. [+ Connect]는 Connect dialog를
// 연다(connect-dialog.tsx). [Disconnect]는 화면 안 Dialog로 한 번 묻는다. custom provider를 붙이면 model 목록을 읽은 결과
// ("N개 찾음" 또는 "목록 없음")가 그 줄 아래에 남고 [Manage models]나 [Add model]이 그 창을 연다.
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
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<ProviderDefinitionRow | null>(null);
  const [leaving, setLeaving] = useState<ProviderRow | null>(null);
  const afterConnect = useAfterConnect();
  const manage = useManageModels();
  // custom provider를 붙인 뒤 읽은 model 목록의 결과. 이 화면을 떠날 때까지 그 줄 아래에 둔다.
  const [listed, setListed] = useState<Readonly<Record<string, ListedModels>>>(
    {},
  );

  async function disconnect(row: ProviderRow): Promise<void> {
    setLeaving(null);
    setFailed(false);
    setListed(({ [row.id]: _, ...rest }) => rest);
    const done = await source.disconnect(row.id);
    if (!done.ok) setFailed(true);
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
                      onDisconnect={() => setLeaving(row)}
                    />
                  ),
                )}
              </ul>
            )}
          </Loading>
        )}
        {failed ? (
          <p className={styles.notice} role="status" data-notice="failed">
            {t("agents.notice.providers-disconnect-failed")}
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
        definition={target}
        onClose={() => setTarget(null)}
        onConnected={() => {
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
  onDisconnect,
}: {
  row: ProviderRow;
  listed: ListedModels | undefined;
  manage: ManageModelsApi | null;
  onDisconnect: () => void;
}): ReactNode {
  const status = statusOf(row);
  const machine = useScopeMachineItem();
  return (
    <li className={styles.item} data-provider={row.id}>
      <span className={styles.identity}>
        <ProviderName name={row.name} />
        <span className={styles.badge} data-login-methods="">
          {loginMethod(row, machine?.name)}
        </span>
      </span>
      <Button
        size="sm"
        icon={actionIcons.disconnect}
        data-action="disconnect"
        onClick={onDisconnect}
      >
        {t("settings.button.disconnect")}
      </Button>
      {status === null ? null : (
        <p className={styles.status} data-status={status.kind}>
          {status.text}
        </p>
      )}
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

/** 이 연결의 로그인 방법. 로그인한 연결은 "Signed in"이다. machine은 다른 기계의 범위이 보는 그 기계의 이름이다. */
function loginMethod(row: ProviderRow, machine: string | undefined): string {
  return row.way === "oauth"
    ? t("settings.label.login-signed-in")
    : wayLabel(row.way, machine);
}

/**
 * 쓸 수 없을 때만 그 상태와 다음 행동 한 줄을 말한다. 사용량 대기는 기다리라고, 요금제 제한은 요금제를
 * 확인하라고, 인증 문제는 Disconnect 뒤 다시 Connect하라고 한다.
 */
function statusOf(row: ProviderRow): { kind: string; text: string } | null {
  if (row.state === "available") return null;
  if (row.state === "usage_wait") {
    return { kind: "usage-limit", text: t("settings.status.usage-limit") };
  }
  if (row.reason === "plan_access") {
    return { kind: "plan-access", text: t("settings.status.plan-access") };
  }
  return {
    kind: "sign-in-problem",
    text: t("settings.status.sign-in-problem"),
  };
}
