import { useEffect, useState } from "react";
import { formatNumber, t } from "@lophn/wording";

import { CALL_OUTCOME_LABEL } from "../labels.ts";
import { type CostLabel, costLabel, tokenParts } from "../model.ts";
import type { ModelAttempt, RolesSource, UsageTotals } from "../source.ts";
import { Disclose } from "./disclose.tsx";
import styles from "../roles.module.css";

const TOKEN_LABEL = {
  input: "roles.label.review-tokens-input",
  output: "roles.label.review-tokens-output",
  "cache-read": "roles.label.review-tokens-cache-read",
  "cache-write": "roles.label.review-tokens-cache-write",
} as const;

export function costText(label: CostLabel): string {
  switch (label.kind) {
    case "billed":
      return t("roles.label.review-cost-billed", { amount: label.text });
    case "estimated":
      return t("roles.label.review-cost-estimated", { amount: label.text });
    case "subscription":
      return t("roles.label.review-cost-subscription");
    case "free":
      return t("roles.label.review-cost-free");
    case "unknown":
      return t("roles.label.review-cost-unknown");
  }
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
    readonly kind: "ready";
    readonly attempts: readonly ModelAttempt[];
    readonly totals: UsageTotals | null;
  };

// 호출별 사용량과 비용. 실제 청구·추정·구독 포함·확인된 무료·모름을 구별하고, 보고되지 않은 사용량이나
// 금액은 0이 아니라 모름이다(harness/usage#R6~R8).
export function UsageSection(
  { source, work }: { source: RolesSource; work: string },
) {
  return (
    <Disclose name="usage" label={t("roles.label.review-usage")}>
      <Usage source={source} work={work} />
    </Disclose>
  );
}

function Usage({ source, work }: { source: RolesSource; work: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void Promise.all([source.attempts(work), source.usage(work)]).then(
      ([attempts, totals]) => {
        if (!live) return;
        setLoaded(
          attempts.ok
            ? {
              kind: "ready",
              attempts: attempts.value,
              totals: totals.ok ? totals.value : null,
            }
            : { kind: "failed" },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [source, work]);
  if (loaded.kind === "failed") {
    return <p className={styles.problem}>{t("roles.review.usage-failed")}</p>;
  }
  if (loaded.kind === "loading") return null;
  if (loaded.attempts.length === 0) {
    return <p className={styles.muted}>{t("roles.review.no-calls")}</p>;
  }
  return (
    <div className={styles.usage} data-usage="">
      <ol className={styles.calls}>
        {loaded.attempts.map((call) => {
          const shown = tokenParts(call.usage).filter((part) =>
            part.count !== null
          );
          return (
            <li key={call.id} className={styles.call} data-call={call.id}>
              <span className={styles.itemText}>
                {t("roles.label.review-call-line", {
                  number: call.order,
                  model: call.model,
                })}
              </span>
              <span className={styles.muted}>
                {t(CALL_OUTCOME_LABEL[call.outcome])}
              </span>
              <span className={styles.muted} data-tokens="">
                {shown.length === 0
                  ? t("roles.review.tokens-unknown")
                  : shown.map((part) =>
                    t(TOKEN_LABEL[part.part], {
                      count: formatNumber(part.count ?? 0, "en", {
                        notation: "standard",
                      }),
                    })
                  ).join(" · ")}
              </span>
              <span data-cost={costLabel(call.cost).kind}>
                {costText(costLabel(call.cost))}
              </span>
            </li>
          );
        })}
      </ol>
      {loaded.totals === null
        ? null
        : (
          <div className={styles.totals} data-usage-total="">
            <span className={styles.itemText}>
              {t("roles.label.review-total-calls", {
                count: loaded.totals.calls,
              })}
            </span>
            {loaded.totals.costs.map((cost) => (
              <span
                key={`${cost.kind}-${cost.currency ?? ""}`}
                data-total={cost.kind}
              >
                {t("roles.label.review-total-line", {
                  cost: costText(costLabel(cost)),
                  count: cost.calls,
                })}
              </span>
            ))}
            {loaded.totals.complete
              ? null
              : (
                <span className={styles.muted} data-usage-incomplete="">
                  {t("roles.review.usage-incomplete")}
                </span>
              )}
          </div>
        )}
    </div>
  );
}
