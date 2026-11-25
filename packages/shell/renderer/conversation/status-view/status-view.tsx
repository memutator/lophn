// `/status`가 대화 화면 안 panel로 여는 session 요약. Codex `/status`처럼 session id와 model, 계정, 창을
// 얼마나 썼는지, 이 session이 쓴 token과 금액을 이름·값 두 열로 보인다. core가 모르는 값(구독 남은 한도)은 줄을 두지 않는다.

import { formatDate, formatNumber, t } from "@lophn/i18n";
import { CopyButton, IconButton } from "@lophn/ui/primitives";
import { systemClipboard } from "@lophn/ui/shared";
import { type ReactElement, useEffect, useRef } from "react";
import { workspaceIcons } from "../../icons/mod.ts";
import type { AcpUsage } from "../../../../protocol/acp/mod.ts";
import {
  compactTokens,
  contextLevel,
  contextPercent,
  costText,
  type StatusData,
} from "./status-summary.ts";
import styles from "./status-view.module.css";

export type StatusPanelKind = "status" | "usage" | "context";

interface StatusViewProps {
  status: StatusData;
  kind?: StatusPanelKind;
  refreshing?: boolean;
  /** `/usage`에서 plan 한도가 비었을 때 안내 줄을 보일지 여부(harness session). */
  showEmptyLimits?: boolean;
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

/** `/context`의 분해: 항목마다 이름 · token · 창 대비 %. */
function ContextParts({
  context,
}: {
  context: NonNullable<AcpUsage["context"]>;
}): ReactElement | null {
  if (context.parts.length === 0) return null;
  return (
    <ul className={styles.parts} data-context-parts="">
      {context.parts.map((part) => (
        <li key={part.label} className={styles.part}>
          <span className={styles.partName}>{part.label}</span>
          <span>{compactTokens(part.tokens)}</span>
          <span className={styles.partPercent}>
            {context.limit <= 0
              ? ""
              : `${Math.round((part.tokens / context.limit) * 100)}%`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 사용 한도 한 줄: 이름 · 막대(모르면 남은 글) · 풀리는 시각. 막대 색은 창 사용률과 같은 80/90% 단계다. */
function LimitLine({
  limit,
}: {
  limit: AcpUsage["limits"][number];
}): ReactElement {
  const percent = limit.used_percent;
  return (
    <div className={styles.limit} data-limit={limit.id}>
      <span className={styles.limitLabel}>{limit.label}</span>
      {percent === null ? (
        <span className={styles.limitLeft}>{limit.left ?? "—"}</span>
      ) : (
        <>
          <div className={styles.bar} aria-hidden="true">
            <div
              className={styles.fill}
              data-level={contextLevel(percent)}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
          <span className={styles.limitLeft}>
            {limit.left ?? `${Math.round(percent)}%`}
          </span>
        </>
      )}
      {limit.resets_at === null ? null : (
        <span className={styles.limitResets}>
          {t("conversation.label.status-limit-resets", {
            time: formatDate(new Date(limit.resets_at)),
          })}
        </span>
      )}
    </div>
  );
}

const PANEL_TITLE = {
  status: "conversation.title.status",
  usage: "conversation.title.usage",
  context: "conversation.title.context",
} as const;

const PANEL_ARIA = {
  status: "conversation.label.status-of",
  usage: "conversation.label.usage-of",
  context: "conversation.label.context-of",
} as const;

export function StatusView({
  status,
  kind = "status",
  refreshing = false,
  showEmptyLimits = false,
  onClose,
}: StatusViewProps): ReactElement {
  const { model, usage } = status;
  const { context } = usage;
  const percent = context === null ? 0 : contextPercent(context);
  const level = contextLevel(percent);
  const panel = useRef<HTMLElement>(null);
  // 다른 곳을 누르면 닫는다. status footer는 스스로 여닫으므로 빼야 눌렀을 때 닫혔다 다시 열리지 않는다.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (panel.current?.contains(target)) return;
      if (target.closest?.("[data-status-footer]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);

  const limitsRow =
    usage.limits.length > 0 ? (
      <Row name={t("conversation.label.status-limits")}>
        <>
          {usage.limits.map((limit) => (
            <LimitLine key={limit.id} limit={limit} />
          ))}
        </>
      </Row>
    ) : kind === "usage" && (refreshing || showEmptyLimits) ? (
      <Row name={t("conversation.label.status-limits")}>
        <span className={styles.limitEmpty}>
          {t(
            refreshing
              ? "conversation.label.usage-loading"
              : "conversation.label.usage-no-limits",
          )}
        </span>
      </Row>
    ) : null;

  const contextRow =
    context !== null ? (
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
          <ContextParts context={context} />
        </>
      </Row>
    ) : kind === "context" ? (
      <Row name={t("conversation.label.status-context")}>
        <span className={styles.limitEmpty}>
          {t(
            refreshing
              ? "conversation.label.usage-loading"
              : "conversation.label.context-unavailable",
          )}
        </span>
      </Row>
    ) : null;

  const providerRows = (
    <>
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
    </>
  );

  const sessionStatsRows = (
    <>
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
    </>
  );

  return (
    <section
      ref={panel}
      className={styles.panel}
      aria-label={t(PANEL_ARIA[kind])}
      data-status-view={kind}
    >
      <header className={styles.head}>
        <span className={styles.title}>{t(PANEL_TITLE[kind])}</span>
        <IconButton
          icon={workspaceIcons.close}
          label={t("common.button.close")}
          size="sm"
          onClick={onClose}
        />
      </header>
      <dl className={styles.body}>
        {kind === "usage" ? (
          <>
            {limitsRow}
            {providerRows}
            {sessionStatsRows}
          </>
        ) : kind === "context" ? (
          <>
            {model === null ? null : (
              <Row name={t("conversation.label.status-model")}>
                {[model.label, ...Object.values(model.options)].join(" · ")}
              </Row>
            )}
            {contextRow}
            {usage.input_tokens === null ||
            usage.output_tokens === null ? null : (
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
          </>
        ) : (
          <>
            <Row name={t("conversation.label.status-session")}>
              <span className={styles.session}>
                <span className={styles.mono}>{status.session}</span>
                <CopyButton
                  text={status.session}
                  label={t("common.button.copy-id")}
                  clipboard={systemClipboard}
                />
              </span>
            </Row>
            {model === null ? null : (
              <Row name={t("conversation.label.status-model")}>
                {[model.label, ...Object.values(model.options)].join(" · ")}
              </Row>
            )}
            {providerRows}
            {contextRow}
            {limitsRow}
            {sessionStatsRows}
          </>
        )}
      </dl>
    </section>
  );
}
