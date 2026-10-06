// 같은 연결의 계정(flow manage-provider-accounts). 사람이 정한 순서, 상태, 사용량 한도와 확인된 리셋 시각,
// 다음 행동 하나를 보이고 교체·삭제는 보호 창으로 연다. 계정·조직·요금제는 확인한 것만 보인다.
import { useCallback, useEffect, useState } from "react";
import { Button, StatusMark } from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  accountFacts,
  accountStatus,
  billingLabel,
  blockText,
  nextAction,
  nextText,
  sortAccounts,
  statusLabel,
  statusTone,
  usageLines,
} from "../model.ts";
import type {
  AccountRow,
  ProviderRow,
  SettingsSource,
  UsageRow,
} from "../source.ts";
import styles from "../settings.module.css";
import { TestPanel } from "./test-panel.tsx";

export interface AccountListProps {
  source: SettingsSource;
  provider: ProviderRow;
  /** 계정을 바꾼 결과를 다시 읽는다. */
  onChanged: () => void;
  /** 로그인을 다시 시작한다(연결 카드가 로그인 흐름을 가진다). */
  onSignIn: () => void;
  /** 이 화면의 안내 한 줄. */
  onNotice: (notice: "window-opened" | "window-failed") => void;
}

type Usage =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly usage: UsageRow };

export function AccountList(
  { source, provider, onChanged, onSignIn, onNotice }: AccountListProps,
) {
  if (provider.accounts.length === 0) {
    return (
      <p className={styles.empty} data-accounts="none">
        {t("settings.accounts.none")}
      </p>
    );
  }
  return (
    <ul
      className={styles.accounts}
      aria-label={t("settings.label.accounts-for", { name: provider.name })}
    >
      {sortAccounts(provider.accounts).map((account) => (
        <AccountItem
          key={account.key}
          source={source}
          provider={provider}
          account={account}
          onChanged={onChanged}
          onSignIn={onSignIn}
          onNotice={onNotice}
        />
      ))}
    </ul>
  );
}

function AccountItem(
  { source, provider, account, onChanged, onSignIn, onNotice }: {
    source: SettingsSource;
    provider: ProviderRow;
    account: AccountRow;
    onChanged: () => void;
    onSignIn: () => void;
    onNotice: AccountListProps["onNotice"];
  },
) {
  const status = accountStatus(account);
  const next = nextAction(account);
  const [usage, setUsage] = useState<Usage>({ state: "loading" });
  const [testing, setTesting] = useState(false);

  const loadUsage = useCallback(async () => {
    const read = await source.usage(account.key);
    setUsage(
      read.ok ? { state: "ready", usage: read.value } : { state: "failed" },
    );
  }, [source, account.key]);

  useEffect(() => {
    if (status === "removed") return;
    void loadUsage();
  }, [loadUsage, status]);

  async function open(
    run: () => Promise<{ readonly ok: boolean }>,
  ): Promise<void> {
    const opened = await run();
    onNotice(opened.ok ? "window-opened" : "window-failed");
    if (opened.ok) onChanged();
  }

  const replace = account.way === "api_key" && status !== "removed";
  const facts = accountFacts(account);
  return (
    <li
      className={styles.account}
      data-account-row=""
      data-status={status}
      data-order={account.order}
    >
      <div className={styles.accountHead}>
        <span className={styles.accountName}>{account.label}</span>
        <StatusMark tone={statusTone(status)} label={statusLabel(status)} />
      </div>
      <p className={styles.muted}>
        {[...facts, billingLabel(account.way)].join(" · ")}
      </p>
      {next === null
        ? null
        : <p className={styles.text} data-next={next}>{nextText(account)}</p>}
      {account.modelBlocks.map((block) => (
        <p key={block.model} className={styles.text} data-model-block="">
          {blockText(block)}
        </p>
      ))}
      {status === "removed"
        ? null
        : (
          <p className={styles.muted} data-usage={usage.state}>
            {usage.state === "loading"
              ? t("settings.usage.loading")
              : usage.state === "failed"
              ? t("settings.usage.failed")
              : [t("settings.label.usage-recent"), ...usageLines(usage.usage)]
                .join(
                  " · ",
                )}
          </p>
        )}
      <div className={styles.actions}>
        {next === "sign-in"
          ? (
            <Button size="sm" data-action="sign-in-again" onClick={onSignIn}>
              {t("settings.button.sign-in-again")}
            </Button>
          )
          : null}
        {replace
          ? (
            <Button
              size="sm"
              variant={next === "replace-key" ? "primary" : "secondary"}
              data-action="replace-key"
              onClick={() =>
                void open(() => source.replaceKey(provider.id, account.key))}
            >
              {t("settings.button.replace-key")}
            </Button>
          )
          : null}
        {status === "ready"
          ? (
            <Button
              size="sm"
              variant="secondary"
              data-action="test"
              aria-expanded={testing}
              onClick={() => setTesting(!testing)}
            >
              {t("settings.button.test")}
            </Button>
          )
          : null}
        {status === "removed" ? null : (
          <Button
            size="sm"
            variant="ghost"
            data-action="remove"
            onClick={() =>
              void open(() => source.removeAccount(provider.id, account.key))}
          >
            {t("settings.button.remove")}
          </Button>
        )}
      </div>
      {testing && status === "ready"
        ? (
          <TestPanel
            source={source}
            provider={provider}
            account={account}
            onDone={() => void loadUsage()}
          />
        )
        : null}
    </li>
  );
}
