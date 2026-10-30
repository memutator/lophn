// `/status`가 대화 화면 안 panel로 여는 session 요약. Codex `/status`처럼 session id와 model, 계정, 창을
// 얼마나 썼는지, 이 session이 쓴 token과 금액을 이름·값 두 열로 보인다. core가 모르는 값(구독 남은 한도)은 줄을 두지 않는다.
import type { ReactElement } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { formatDate, t } from "@lophn/i18n";
import { workspaceIcons } from "../../icons/mod.ts";
import type { StatusView as StatusData } from "../agent-tab-source.ts";
import styles from "./status-view.module.css";

interface StatusViewProps {
  status: StatusData;
  onClose: () => void;
}

function Row(props: { name: string; children: ReactElement | string }) {
  return (
    <>
      <dt className={styles.name}>{props.name}</dt>
      <dd className={styles.value}>{props.children}</dd>
    </>
  );
}

function providerText(provider: NonNullable<StatusData["provider"]>): string {
  const name = { provider: provider.name };
  switch (provider.state) {
    case "available":
      return t("conversation.label.status-provider-available", name);
    case "usage_wait":
      return t("conversation.label.status-provider-wait", {
        ...name,
        time:
          provider.until === null ? "" : formatDate(new Date(provider.until)),
      });
    case "rejected":
      return t("conversation.label.status-provider-rejected", name);
    case "revoked":
      return t("conversation.label.status-provider-revoked", name);
  }
}

function costText(cost: StatusData["costs"][number]): string {
  if (cost.kind === "subscription" || cost.kind === "free") {
    return t("conversation.label.status-cost-subscription");
  }
  if (cost.amount === null || cost.currency === null) {
    return t("conversation.label.status-cost-unknown");
  }
  const money = { amount: cost.amount, currency: cost.currency };
  return cost.kind === "estimated"
    ? t("conversation.label.status-cost-estimated", money)
    : t("conversation.label.status-cost-reported", money);
}

export function StatusView({ status, onClose }: StatusViewProps): ReactElement {
  const { context } = status;
  const percent =
    context === null ? 0 : Math.round((context.tokens / context.limit) * 100);
  return (
    <section
      className={styles.panel}
      aria-label={t("conversation.label.status-of")}
      data-status-view=""
    >
      <header className={styles.head}>
        <span className={styles.title}>{t("conversation.title.status")}</span>
        <IconButton
          icon={workspaceIcons.close}
          label={t("common.button.close")}
          size="sm"
          onClick={onClose}
        />
      </header>
      <dl className={styles.body}>
        <Row name={t("conversation.label.status-session")}>
          <span className={styles.mono}>{status.session}</span>
        </Row>
        {status.model === null ? null : (
          <Row name={t("conversation.label.status-model")}>
            {[status.model.name, ...Object.values(status.model.options)].join(
              " · ",
            )}
          </Row>
        )}
        {status.provider === null ? null : (
          <Row name={t("conversation.label.status-provider")}>
            {providerText(status.provider)}
          </Row>
        )}
        {status.provider?.account == null ? null : (
          <Row name={t("conversation.label.status-account")}>
            {status.provider.account}
          </Row>
        )}
        {context === null ? null : (
          <Row name={t("conversation.label.status-context")}>
            <>
              <span>
                {t("conversation.label.status-context-value", {
                  used: context.tokens,
                  limit: context.limit,
                  percent,
                })}
              </span>
              <div className={styles.bar} aria-hidden="true">
                <div
                  className={styles.fill}
                  style={{ width: `${Math.min(100, percent)}%` }}
                />
              </div>
            </>
          </Row>
        )}
        <Row name={t("conversation.label.status-turns")}>
          {t("conversation.label.status-turns-value", {
            turns: status.turns,
            calls: status.calls,
          })}
        </Row>
        {status.inputTokens === null || status.outputTokens === null ? null : (
          <Row name={t("conversation.label.status-tokens")}>
            {status.cacheReadTokens === null
              ? t("conversation.label.status-tokens-value-uncached", {
                  input: status.inputTokens,
                  output: status.outputTokens,
                })
              : t("conversation.label.status-tokens-value", {
                  input: status.inputTokens + status.cacheReadTokens,
                  cached: status.cacheReadTokens,
                  output: status.outputTokens,
                })}
          </Row>
        )}
        {status.costs.length === 0 ? null : (
          <Row name={t("conversation.label.status-cost")}>
            {status.costs.map(costText).join(" · ")}
          </Row>
        )}
      </dl>
    </section>
  );
}
