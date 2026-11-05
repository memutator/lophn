// 창 사용률과 `/status`·composer 아래 푸터가 같이 쓰는 짧은 글. panel과 푸터가 같은 식과 같은 임계값을 쓰게 한 곳에 둔다.
import { t } from "@lophn/i18n";
import type {
  AcpModelCurrent,
  AcpUsage,
} from "../../../../protocol/acp/mod.ts";

/** `/status`와 푸터가 그리는 값: session 하나의 model과 사용량(`session.model`·`session.usage`). */
export interface StatusData {
  readonly session: string;
  readonly model: AcpModelCurrent | null;
  readonly usage: AcpUsage;
}

/** 푸터와 panel 막대의 색 단계. 80%부터 경고, 90%부터 위험이다. */
export type ContextLevel = "normal" | "warning" | "critical";

/** 마지막 요청이 창을 몇 % 썼는가. 한도를 모르면 0이다. */
export function contextPercent(
  context: NonNullable<AcpUsage["context"]>,
): number {
  if (context.limit <= 0) return 0;
  return Math.round((context.tokens / context.limit) * 100);
}

export function contextLevel(percent: number): ContextLevel {
  if (percent >= 90) return "critical";
  if (percent >= 80) return "warning";
  return "normal";
}

/** 1,050,000 → 1.05M, 200,000 → 200k, 950 → 950. 한 줄에 들어가게 줄인다. */
export function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${Math.round(tokens / 10_000) / 100}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

// 금액은 통화 기호와 소수 둘로 보인다($2.06). 추정인지 보고된 값인지는 가르지 않는다.
function money(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function costText(cost: AcpUsage["costs"][number]): string {
  if (cost.kind === "subscription" || cost.kind === "free") {
    return t("conversation.label.status-cost-subscription");
  }
  if (cost.amount === null || cost.currency === null) {
    return t("conversation.label.status-cost-unknown");
  }
  return money(cost.amount, cost.currency);
}
