// Context 탭의 틀: 머리(이름·Context 표시·목적·판 줄·단추)와 하위 탭 Overview · Search ·
// Violations · Glossary · Contract(shell/workspace#R17, R21). 하위 탭 본문은 부른 쪽이
// renderPanel로 넣는다. 만드는 중인 context는 ContextDrafting을 그린다. 구현은 ctx-I41.
import { type ReactNode, useEffect, useState } from "react";
import {
  Button,
  ErrorState,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import { ContextDrafting } from "./context-drafting.tsx";
import { ContextTitle } from "./context-frame-title.tsx";
import { SUB_TABS, type SubTab } from "./shared.ts";
import type {
  BundleEntry,
  CheckReport,
  ContextDetail,
  ContextsSource,
} from "./source.ts";
import styles from "./context-frame.module.css";

export interface ContextFrameProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 지금 고른 하위 탭. 바꾸는 일은 onSub로 부른 쪽이 한다. */
  readonly sub: SubTab;
  readonly onSub: (sub: SubTab) => void;
  /** 고른 하위 탭의 본문. */
  readonly renderPanel: (sub: SubTab) => ReactNode;
  /** 머리의 [Ask Context Engineer]. 하위 탭이 Overview가 아닐 때만 보인다. */
  readonly onAsk: () => void;
  /** 머리의 [History]. */
  readonly onHistory: () => void;
  /** "applied 2 hours ago"를 재는 지금. 기본은 현재 시각. */
  readonly now?: Date;
}

interface Loaded {
  readonly detail: ContextDetail;
  /** 적용된 판의 검사 보고. 적용된 판이 없거나 만드는 중이면 null. */
  readonly check: CheckReport | null;
}

type Read =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: Loaded };

function appliedCheck(
  detail: ContextDetail,
  bundles: readonly BundleEntry[],
): CheckReport | null {
  const applied = detail.applied;
  if (applied === null) return null;
  return bundles.find((entry) => entry.bundle.id === applied.id)?.check ??
    null;
}

function useFrameRead(source: ContextsSource, context: string) {
  const [read, setRead] = useState<Read>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ state: "loading" });
    void (async () => {
      const detail = await source.get(context);
      if (!detail.ok) return { state: "failed" } as const;
      if (detail.value.context.status === "drafting") {
        return {
          state: "ready",
          value: { detail: detail.value, check: null },
        } as const;
      }
      const bundles = await source.bundles(context);
      if (!bundles.ok) return { state: "failed" } as const;
      return {
        state: "ready",
        value: {
          detail: detail.value,
          check: appliedCheck(detail.value, bundles.value),
        },
      } as const;
    })().then((next) => {
      if (live) setRead(next);
    });
    return () => {
      live = false;
    };
  }, [source, context, attempt]);
  return { read, reload: () => setAttempt((count) => count + 1) };
}

function subLabel(sub: SubTab, violations: number): string {
  switch (sub) {
    case "overview":
      return t("contexts.label.sub-overview");
    case "search":
      return t("contexts.label.sub-search");
    case "violations":
      return violations > 0
        ? t("contexts.label.sub-violations-count", {
          count: String(violations),
        })
        : t("contexts.label.sub-violations");
    case "glossary":
      return t("contexts.label.sub-glossary");
    case "contract":
      return t("contexts.label.sub-contract");
  }
}

function versionLine(
  loaded: Loaded,
  now: Date,
): string | null {
  const { applied } = loaded.detail;
  const check = loaded.check;
  if (applied === null || applied.number === null || check === null) {
    return null;
  }
  const when = formatRelativeTime(
    new Date(check.finished_at ?? check.started_at),
    now,
  );
  const values = { number: String(applied.number), when };
  if (check.status === "passed") {
    return t("contexts.label.frame-version-passed", values);
  }
  if (check.status === "failed") {
    return t("contexts.label.frame-version-failed", values);
  }
  return t("contexts.label.frame-version-checking", values);
}

export function ContextFrame(props: ContextFrameProps): ReactNode {
  const { source, context, sub, onSub, renderPanel, onAsk, onHistory } = props;
  const { read, reload } = useFrameRead(source, context);
  if (read.state === "loading") return <Skeleton lines={3} />;
  if (read.state === "failed") {
    return (
      <ErrorState
        target={t("contexts.label.frame-chip")}
        onRetry={reload}
      />
    );
  }
  const loaded = read.value;
  const item = loaded.detail.context;
  if (item.status === "drafting") {
    return <ContextDrafting source={source} context={context} />;
  }
  // 판 줄과 [Ask Context Engineer]·[History]는 Contract에서만 보인다(shell/workspace#R21).
  const plain = sub !== "contract";
  const version = plain ? null : versionLine(loaded, props.now ?? new Date());
  return (
    <div className={styles.frame}>
      <div className={styles.head} data-context-head="">
        <ContextTitle name={item.title} purpose={item.purpose} />
        {plain
          ? (
            <p className={styles.line} data-kept-up-to-date="">
              {t("contexts.label.frame-kept-up-to-date")}
            </p>
          )
          : (
            <>
              {version === null
                ? null
                : <p className={styles.line} data-version="">{version}</p>}
              <div className={styles.actions}>
                <Button variant="primary" onClick={onAsk}>
                  {t("contexts.button.frame-ask")}
                </Button>
                <Button onClick={onHistory}>
                  {t("contexts.button.frame-history")}
                </Button>
              </div>
            </>
          )}
        {sub === "contract"
          ? (
            <p className={styles.note} data-note="">
              {t("contexts.label.frame-note")}
            </p>
          )
          : null}
      </div>
      <section aria-label={t("contexts.label.frame-sub-tabs")}>
        <Tabs value={sub} onValueChange={(value) => onSub(value as SubTab)}>
          <TabList>
            {SUB_TABS.map((value) => (
              <Tab key={value} value={value}>
                {subLabel(value, item.violation_mark)}
              </Tab>
            ))}
          </TabList>
          {SUB_TABS.map((value) => (
            <TabPanel key={value} value={value}>
              {value === sub ? renderPanel(value) : null}
            </TabPanel>
          ))}
        </Tabs>
      </section>
    </div>
  );
}
