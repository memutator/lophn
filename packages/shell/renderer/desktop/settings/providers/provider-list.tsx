import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Dialog } from "@lophn/ui/overlay";
import { commonIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { wayLabel } from "../model.ts";
import { ConnectDialog } from "./connect-dialog.tsx";
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

type Loaded<Row> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly rows: readonly Row[] };

// Settings › Providers. provider는 연결과 인증만 다룬다: model 고르기·기본값 칸이 없다. 위는 연결된 provider
// (vendor 아이콘과 이름, 로그인 방법 badge, [Disconnect]; 사용량 대기나 사용 불가일 때만 그 상태와 다음 행동 한 줄)이고
// 아래는 Add a provider 목록(줄마다 [+ Connect])이다. provider 하나에는 연결 하나다. [+ Connect]는 Connect dialog를
// 연다(connect-dialog.tsx). [Disconnect]는 화면 안 Dialog로 한 번 묻는다.
export function ProviderList({ source }: ProviderListProps): ReactNode {
  const [connected, setConnected] = useState<Loaded<ProviderRow>>({
    state: "loading",
  });
  const [available, setAvailable] = useState<Loaded<ProviderDefinitionRow>>({
    state: "loading",
  });
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<ProviderDefinitionRow | null>(null);
  const [leaving, setLeaving] = useState<ProviderRow | null>(null);

  // 다시 읽다 실패해도 이미 보이는 목록은 지우지 않는다(처음 읽기만 실패를 보인다).
  const loadConnected = useCallback(async (): Promise<void> => {
    const read = await source.connected();
    setConnected((previous) =>
      read.ok
        ? { state: "ready", rows: read.value }
        : previous.state === "ready"
        ? previous
        : { state: "failed" }
    );
  }, [source]);
  const loadAvailable = useCallback(async (): Promise<void> => {
    const read = await source.available();
    setAvailable((previous) =>
      read.ok
        ? { state: "ready", rows: read.value }
        : previous.state === "ready"
        ? previous
        : { state: "failed" }
    );
  }, [source]);
  const reload = useCallback((): void => {
    void loadConnected();
    void loadAvailable();
  }, [loadConnected, loadAvailable]);

  // 보호 창은 닫혀도 결과가 이 화면으로 오지 않으므로 사람이 창에서 돌아오면 다시 읽는다.
  useEffect(() => {
    reload();
    globalThis.addEventListener?.("focus", reload);
    return () => globalThis.removeEventListener?.("focus", reload);
  }, [reload]);

  async function disconnect(row: ProviderRow): Promise<void> {
    setLeaving(null);
    setFailed(false);
    const done = await source.disconnect(row.id);
    if (!done.ok) setFailed(true);
    reload();
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("settings.label.tab-providers")}</h1>
      <p className={styles.lead}>{t("settings.notice.provider-lead")}</p>
      <section>
        <h2 className={styles.sectionTitle}>
          {t("settings.heading.connected")}
        </h2>
        {connected.state === "failed"
          ? (
            <ErrorState
              target={t("settings.label.providers-target")}
              onRetry={() => {
                setConnected({ state: "loading" });
                void loadConnected();
              }}
            />
          )
          : (
            <Loading
              loading={connected.state === "loading"}
              placeholder={<Skeleton lines={3} />}
            >
              {connected.state === "ready" && connected.rows.length === 0
                ? (
                  <p className={styles.empty}>
                    {t("settings.notice.none-connected")}
                  </p>
                )
                : (
                  <ul className={styles.group}>
                    {(connected.state === "ready" ? connected.rows : []).map((
                      row,
                    ) => (
                      <ConnectedItem
                        key={row.id}
                        row={row}
                        onDisconnect={() => setLeaving(row)}
                      />
                    ))}
                  </ul>
                )}
            </Loading>
          )}
        {failed
          ? (
            <p className={styles.notice} role="status" data-notice="failed">
              {t("agents.notice.providers-disconnect-failed")}
            </p>
          )
          : null}
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t("settings.heading.add-provider")}
        </h2>
        {available.state === "failed"
          ? (
            <ErrorState
              target={t("settings.label.available-target")}
              onRetry={() => {
                setAvailable({ state: "loading" });
                void loadAvailable();
              }}
            />
          )
          : (
            <Loading
              loading={available.state === "loading"}
              placeholder={<Skeleton lines={3} />}
            >
              <ul className={styles.group}>
                {(available.state === "ready" ? available.rows : []).map((
                  definition,
                ) => (
                  <li
                    key={definition.key}
                    className={styles.item}
                    data-available={definition.key}
                  >
                    <span className={styles.identity}>
                      <ProviderName name={definition.name} />
                      {definition.hint === null
                        ? null
                        : (
                          <span className={styles.hint} data-hint="">
                            {definition.hint}
                          </span>
                        )}
                    </span>
                    <Button
                      size="sm"
                      icon={commonIcons.add}
                      data-action="connect"
                      onClick={() => setTarget(definition)}
                    >
                      {t("settings.button.connect")}
                    </Button>
                  </li>
                ))}
              </ul>
            </Loading>
          )}
      </section>
      <ConnectDialog
        source={source}
        definition={target}
        onClose={() => setTarget(null)}
        onConnected={reload}
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

function ConnectedItem(
  { row, onDisconnect }: { row: ProviderRow; onDisconnect: () => void },
): ReactNode {
  const status = statusOf(row);
  return (
    <li className={styles.item} data-provider={row.id}>
      <span className={styles.identity}>
        <ProviderName name={row.name} />
        <span className={styles.badge} data-login-methods="">
          {loginMethod(row)}
        </span>
      </span>
      <Button size="sm" data-action="disconnect" onClick={onDisconnect}>
        {t("settings.button.disconnect")}
      </Button>
      {status === null
        ? null
        : (
          <p className={styles.status} data-status={status.kind}>
            {status.text}
          </p>
        )}
    </li>
  );
}

/** 이 연결의 로그인 방법. 로그인한 연결은 "Signed in"이다. */
function loginMethod(row: ProviderRow): string {
  return row.way === "oauth"
    ? t("settings.label.login-signed-in")
    : wayLabel(row.way);
}

/**
 * 쓸 수 없을 때만 그 상태와 다음 행동 한 줄을 말한다. 사용량 대기는 기다리라고, 요금제 제한은 요금제를
 * 확인하라고, 인증 문제는 Disconnect 뒤 다시 Connect하라고 한다.
 */
function statusOf(
  row: ProviderRow,
): { kind: string; text: string } | null {
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
