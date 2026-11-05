// `/status`가 대화 화면 안 panel로 여는 session 요약. Codex `/status`처럼 session id와 model, 계정, 창을
// 얼마나 썼는지, 이 session이 쓴 token과 금액을 이름·값 두 열로 보인다. core가 모르는 값(구독 남은 한도)은 줄을 두지 않는다.

import { formatDate, formatNumber, t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import type { ReactElement } from "react";
import { workspaceIcons } from "../../icons/mod.ts";
import type { AcpUsage } from "../../../../protocol/acp/mod.ts";
import {
  contextLevel,
  contextPercent,
  costText,
  type StatusData,
} from "./status-summary.ts";
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

function providerText(provider: NonNullable<AcpUsage["provider"]>): string {
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

interface TokenSegment {
  id: "input" | "cached" | "output";
  label: string;
  count: number;
}

function tokenSegments(
  input: number,
  cached: number | null,
  output: number,
): TokenSegment[] {
  const segments: TokenSegment[] = [
    {
      id: "input",
      label: t("conversation.label.status-tokens-input"),
      count: input,
    },
  ];
  if (cached !== null) {
    segments.push({
      id: "cached",
      label: t("conversation.label.status-tokens-cached"),
      count: cached,
    });
  }
  segments.push({
    id: "output",
    label: t("conversation.label.status-tokens-output"),
    count: output,
  });
  return segments;
}

// `inputTokens`는 cache 읽기·쓰기를 뺀 입력이다. cache에 쓴 입력은 입력 칸에 더해 세 칸이 겹치지 않고 전체 입력을 덮는다.
function TokenBreakdown({
  segments,
}: {
  segments: readonly TokenSegment[];
}): ReactElement {
  const total = segments.reduce((sum, one) => sum + one.count, 0);
  return (
    <>
      <div className={styles.split} aria-hidden="true">
        {segments.map((one) =>
          one.count === 0 || total === 0 ? null : (
            <div
              key={one.id}
              className={styles.splitPart}
              data-part={one.id}
              style={{ flexGrow: one.count }}
            />
          ),
        )}
      </div>
      <ul className={styles.legend}>
        {segments.map((one) => (
          <li key={one.id} className={styles.legendItem}>
            <span
              className={styles.swatch}
              data-part={one.id}
              aria-hidden="true"
            />
            {one.label} {formatNumber(one.count)}
          </li>
        ))}
      </ul>
    </>
  );
}

export function StatusView({ status, onClose }: StatusViewProps): ReactElement {
  const { model, usage } = status;
  const { context } = usage;
  const percent = context === null ? 0 : contextPercent(context);
  const level = contextLevel(percent);
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
        {model === null ? null : (
          <Row name={t("conversation.label.status-model")}>
            {[model.label, ...Object.values(model.options)].join(" · ")}
          </Row>
        )}
        {usage.provider === null ? null : (
          <Row name={t("conversation.label.status-provider")}>
            {providerText(usage.provider)}
          </Row>
        )}
        {usage.provider?.account == null ? null : (
          <Row name={t("conversation.label.status-account")}>
            {usage.provider.account}
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
                  data-level={level}
                  style={{ width: `${Math.min(100, percent)}%` }}
                />
              </div>
            </>
          </Row>
        )}
        {usage.turns === null ? null : (
          <Row name={t("conversation.label.status-turns")}>
            {t("conversation.label.status-turns-value", {
              turns: usage.turns,
            })}
          </Row>
        )}
        {usage.input_tokens === null || usage.output_tokens === null ? null : (
          <Row name={t("conversation.label.status-tokens")}>
            <TokenBreakdown
              segments={tokenSegments(
                usage.input_tokens + (usage.cache_write_tokens ?? 0),
                usage.cache_read_tokens,
                usage.output_tokens,
              )}
            />
          </Row>
        )}
        {usage.costs.length === 0 ? null : (
          <Row name={t("conversation.label.status-cost")}>
            {usage.costs.map(costText).join(" · ")}
          </Row>
        )}
      </dl>
    </section>
  );
}
