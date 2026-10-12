import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  Button,
  ErrorState,
  Loading,
  Skeleton,
} from "@lophn/design/components";
import { lophnSpaceIcons } from "../../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { wayLabel } from "../model.ts";
import { ConnectDialog } from "./connect-dialog.tsx";
import type {
  ProviderDefinitionRow,
  ProviderRow,
  ProviderSettingsSource,
} from "./settings-source.ts";
import styles from "./provider-list.module.css";

export interface ProviderListProps {
  source: ProviderSettingsSource;
}

type Loaded<Row> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly rows: readonly Row[] };

type Window = "window-opened" | "window-failed" | null;

// Settings › Providers. provider는 연결과 인증만 다룬다: model 고르기·기본값
// 칸이 없다. 위는 연결된 provider(이름, 로그인 방법, [Disconnect]; 사용량 대기나 사용 불가일 때만 그
// 상태와 다음 행동 한 줄)이고 아래는 Add a provider 목록(줄마다 [+ Connect])이다. provider 하나에는
// 연결 하나라 계정 목록·순서·끄기·연결 테스트는 없다. [+ Connect]는 Connect dialog를 연다
// (connect-dialog.tsx).
export function ProviderList({ source }: ProviderListProps): ReactNode {
  const [connected, setConnected] = useState<Loaded<ProviderRow>>({
    state: "loading",
  });
  const [available, setAvailable] = useState<Loaded<ProviderDefinitionRow>>({
    state: "loading",
  });
  const [window, setWindow] = useState<Window>(null);
  const [target, setTarget] = useState<ProviderDefinitionRow | null>(null);

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

  async function disconnect(provider: string): Promise<void> {
    const opened = await source.disconnect(provider);
    setWindow(opened.ok ? "window-opened" : "window-failed");
  }

  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t("settings.notice.provider-lead")}</p>
      <section className={styles.section}>
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
                        onDisconnect={() => void disconnect(row.id)}
                      />
                    ))}
                  </ul>
                )}
            </Loading>
          )}
        {window === null ? null : (
          <p
            className={styles.notice}
            role="status"
            data-notice={window}
          >
            {window === "window-opened"
              ? t("settings.notice.window-opened")
              : t("settings.error.window")}
          </p>
        )}
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
                    <div className={styles.row}>
                      <span className={styles.identity}>
                        <span className={styles.name} data-provider-name="">
                          {definition.name}
                        </span>
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
                        icon={lophnSpaceIcons.add}
                        data-action="connect"
                        onClick={() => setTarget(definition)}
                      >
                        {t("settings.button.connect")}
                      </Button>
                    </div>
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
    </div>
  );
}

function ConnectedItem(
  { row, onDisconnect }: { row: ProviderRow; onDisconnect: () => void },
): ReactNode {
  const status = statusOf(row);
  return (
    <li className={styles.item} data-provider={row.id}>
      <div className={styles.row}>
        <span className={styles.identity}>
          <span className={styles.name} data-provider-name="">{row.name}</span>
          <span className={styles.methods} data-login-methods="">
            {loginMethod(row)}
          </span>
        </span>
        <Button size="sm" data-action="disconnect" onClick={onDisconnect}>
          {t("settings.button.disconnect")}
        </Button>
      </div>
      {status === null
        ? null
        : <p className={styles.note} data-status={status.kind}>{status.text}
        </p>}
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
