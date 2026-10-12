import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  Button,
  ErrorState,
  IconButton,
  Loading,
  lophnSpaceIcons,
  Skeleton,
  Switch,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { sortAccounts, wayLabel, waysOf } from "../model.ts";
import { ConnectDialog } from "./connect-dialog.tsx";
import type {
  AccountRow,
  AuthWay,
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

/** provider 줄 밑의 한 줄 안내. 다음 run부터 적용된다는 말과 바꾸지 못했다는 말. */
type Note = "next-run" | "reorder-failed" | "enabled-failed";

type Window = "window-opened" | "window-failed" | null;

// Settings › Providers(shell/desktop#R49). provider는 계정과 인증만 다룬다: model 고르기·기본값
// 칸이 없다. 위는 연결된 provider(이름, 로그인 방법, [Disconnect]; 펼치면 계정 목록과 위아래 순서·
// 사용 끄기)이고 아래는 Add a provider 목록(줄마다 [+ Connect])이다. [+ Connect]는 Connect dialog를
// 연다(connect-dialog.tsx). 옛 Connections 카드는 이 화면으로 바뀌어 없다.
export function ProviderList({ source }: ProviderListProps): ReactNode {
  const [connected, setConnected] = useState<Loaded<ProviderRow>>({
    state: "loading",
  });
  const [available, setAvailable] = useState<Loaded<ProviderDefinitionRow>>({
    state: "loading",
  });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState<Readonly<Record<string, Note>>>({});
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

  function setNote(provider: string, note: Note): void {
    setNotes((previous) => ({ ...previous, [provider]: note }));
  }

  function toggle(provider: string): void {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(provider)) next.add(provider);
      return next;
    });
  }

  async function disconnect(provider: string): Promise<void> {
    const opened = await source.disconnect(provider);
    setWindow(opened.ok ? "window-opened" : "window-failed");
  }

  async function reorder(
    row: ProviderRow,
    from: number,
    to: number,
  ): Promise<void> {
    const keys = sortAccounts(row.accounts).map((account) => account.key);
    const [moved] = keys.splice(from, 1);
    keys.splice(to, 0, moved!);
    const result = await source.reorderAccounts(row.id, keys);
    if (!result.ok) {
      setNote(row.id, "reorder-failed");
      return;
    }
    setNote(row.id, "next-run");
    await loadConnected();
  }

  async function setEnabled(
    row: ProviderRow,
    account: AccountRow,
    enabled: boolean,
  ): Promise<void> {
    const result = await source.setAccountEnabled(row.id, account.key, enabled);
    if (!result.ok) {
      setNote(row.id, "enabled-failed");
      return;
    }
    setNote(row.id, "next-run");
    await loadConnected();
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
                        open={expanded.has(row.id)}
                        note={notes[row.id] ?? null}
                        onToggle={() => toggle(row.id)}
                        onDisconnect={() => void disconnect(row.id)}
                        onMove={(from, to) => void reorder(row, from, to)}
                        onEnabled={(account, enabled) =>
                          void setEnabled(row, account, enabled)}
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
  { row, open, note, onToggle, onDisconnect, onMove, onEnabled }: {
    row: ProviderRow;
    open: boolean;
    note: Note | null;
    onToggle: () => void;
    onDisconnect: () => void;
    onMove: (from: number, to: number) => void;
    onEnabled: (account: AccountRow, enabled: boolean) => void;
  },
): ReactNode {
  const accounts = sortAccounts(row.accounts);
  return (
    <li className={styles.item} data-provider={row.id}>
      <div className={styles.row}>
        <span className={styles.identity}>
          <IconButton
            icon={open ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
            label={t("settings.label.accounts-for", { name: row.name })}
            size="sm"
            data-action="expand"
            aria-expanded={open}
            onClick={onToggle}
          />
          <span className={styles.name} data-provider-name="">{row.name}</span>
          <span className={styles.methods} data-login-methods="">
            {loginMethods(row)}
          </span>
        </span>
        <Button size="sm" data-action="disconnect" onClick={onDisconnect}>
          {t("settings.button.disconnect")}
        </Button>
      </div>
      {open
        ? (
          accounts.length === 0
            ? (
              <p className={styles.empty} data-accounts="none">
                {t("settings.accounts.none")}
              </p>
            )
            : (
              <ul className={styles.accounts} data-accounts="">
                {accounts.map((account, index) => (
                  <li
                    key={account.key}
                    className={styles.account}
                    data-account={account.key}
                  >
                    <span className={styles.accountText}>
                      <span
                        className={styles.accountName}
                        data-account-label=""
                      >
                        {account.label}
                      </span>
                      <span className={styles.hint}>
                        {accountWay(account)}
                      </span>
                    </span>
                    <span className={styles.accountControls}>
                      <IconButton
                        icon={lophnSpaceIcons.previous}
                        label={t("settings.label.move-account-up", {
                          name: account.label,
                        })}
                        size="sm"
                        disabled={index === 0}
                        onClick={() => onMove(index, index - 1)}
                      />
                      <IconButton
                        icon={lophnSpaceIcons.next}
                        label={t("settings.label.move-account-down", {
                          name: account.label,
                        })}
                        size="sm"
                        disabled={index === accounts.length - 1}
                        onClick={() => onMove(index, index + 1)}
                      />
                      <Switch
                        label={t("settings.label.use-account", {
                          name: account.label,
                        })}
                        size="sm"
                        checked={account.enabled}
                        onCheckedChange={(enabled) =>
                          onEnabled(account, enabled)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )
        )
        : null}
      {note === "next-run"
        ? (
          <p className={styles.note} data-note="next-run">
            {t("settings.notice.next-run")}
          </p>
        )
        : null}
      {note === "reorder-failed" || note === "enabled-failed"
        ? (
          <p className={styles.notice} role="status" data-notice={note}>
            {note === "reorder-failed"
              ? t("settings.error.reorder")
              : t("settings.error.account-enabled")}
          </p>
        )
        : null}
    </li>
  );
}

/** 계정이 쓰는 로그인 방법을 정해진 순서로 "·"로 잇는다. 로그인한 계정은 확인한 요금제를 붙인다. */
function loginMethods(row: ProviderRow): string {
  const live = row.accounts.filter((account) => account.state !== "revoked");
  const ways: readonly AuthWay[] = live.length === 0
    ? row.ways
    : live.map((account) => account.way);
  const plan = live.find((account) => account.way === "oauth")?.plan ?? null;
  return waysOf(ways).map((way) => {
    if (way === "oauth") {
      return plan === null
        ? t("settings.label.login-signed-in")
        : t("settings.label.login-signed-in-plan", { plan });
    }
    return wayLabel(way);
  }).join(" · ");
}

function accountWay(account: AccountRow): string {
  return account.way === "oauth"
    ? account.plan === null
      ? t("settings.label.login-signed-in")
      : t("settings.label.login-signed-in-plan", { plan: account.plan })
    : wayLabel(account.way);
}
