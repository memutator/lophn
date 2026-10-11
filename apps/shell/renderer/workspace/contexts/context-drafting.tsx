// 만드는 중(drafting) context의 탭 본문: "Context Engineer is drafting · step n of 4", 단계 목록,
// 흐린 초안 개체(shell/workspace#R30). 하위 탭은 같은 다섯 개이고 첫 판이 적용되기 전에는
// Overview 밖이 안내 글만 보인다. 구현은 ctx-I41.
import { Fragment, type ReactNode, useEffect, useState } from "react";
import {
  ErrorState,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { ContextTitle } from "./context-frame-title.tsx";
import { SUB_TABS, type SubTab } from "./shared.ts";
import type { ContextDetail, ContextsSource, DraftProgress } from "./source.ts";
import styles from "./context-drafting.module.css";

export interface ContextDraftingProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
}

interface Loaded {
  readonly detail: ContextDetail;
  readonly progress: DraftProgress;
}

type Read =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: Loaded };

function subLabel(sub: SubTab): string {
  switch (sub) {
    case "overview":
      return t("contexts.label.sub-overview");
    case "search":
      return t("contexts.label.sub-search");
    case "violations":
      return t("contexts.label.sub-violations");
    case "glossary":
      return t("contexts.label.sub-glossary");
    case "contract":
      return t("contexts.label.sub-contract");
  }
}

const STEP_MARKS = { done: "✓", now: "●", later: "○" } as const;
type StepState = keyof typeof STEP_MARKS;

function stepTexts(progress: DraftProgress): readonly string[] {
  return [
    progress.read === null
      ? t("contexts.label.drafting-reading")
      : t("contexts.label.drafting-read", progress.read),
    t("contexts.label.drafting-draft"),
    t("contexts.label.drafting-checks"),
    t("contexts.label.drafting-apply"),
  ];
}

function Steps({ progress }: { progress: DraftProgress }): ReactNode {
  return (
    <ol
      className={styles.steps}
      aria-label={t("contexts.label.drafting-progress")}
    >
      {stepTexts(progress).map((text, index) => {
        const number = index + 1;
        const state: StepState = number < progress.step
          ? "done"
          : number === progress.step
          ? "now"
          : "later";
        return (
          <li
            key={text}
            className={styles[state]}
            data-step-state={state}
            aria-current={state === "now" ? "step" : undefined}
          >
            <span className={styles.mark} data-step-mark="" aria-hidden="true">
              {STEP_MARKS[state]}
            </span>
            {text}
          </li>
        );
      })}
    </ol>
  );
}

function DraftChip(): ReactNode {
  return (
    <span className={styles.chip} data-draft-chip="">
      {t("contexts.label.drafting-chip")}
    </span>
  );
}

function DraftOverview({ progress }: { progress: DraftProgress }): ReactNode {
  const { types, relations } = progress;
  // 이웃한 두 개체 사이의 관계는 화살표로 잇고, 그 밖의 관계는 목록으로 보인다.
  const between = types.slice(0, -1).map((from, index) =>
    relations.filter((relation) =>
      relation.from === from && relation.to === types[index + 1]
    )
  );
  const inline = new Set(between.flat());
  const rest = relations.filter((relation) => !inline.has(relation));
  return (
    <section className={styles.section}>
      <div data-draft-heading="">
        <h2>
          {t("contexts.heading.drafting-overview")} <DraftChip />
        </h2>
      </div>
      <div className={styles.row}>
        {types.map((name, index) => (
          <Fragment key={name}>
            <div className={styles.card} data-draft-entity="">
              <h3>{name}</h3>
              <DraftChip />
            </div>
            {(between[index] ?? []).map((relation) => (
              <span
                key={relation.label}
                className={styles.arrow}
                data-draft-relation=""
              >
                <span>{relation.label}</span>→
              </span>
            ))}
          </Fragment>
        ))}
      </div>
      {rest.length === 0 ? null : (
        <ul className={styles.relations}>
          {rest.map((relation) => (
            <li
              key={`${relation.from}:${relation.label}:${relation.to}`}
              data-draft-relation=""
            >
              {relation.from} {relation.label} → {relation.to}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.note} data-draft-note="">
        {t("contexts.note.drafting-not-final")}
      </p>
    </section>
  );
}

export function ContextDrafting(
  { source, context }: ContextDraftingProps,
): ReactNode {
  const [read, setRead] = useState<Read>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<SubTab>("overview");
  useEffect(() => {
    let live = true;
    setRead({ state: "loading" });
    void Promise.all([source.get(context), source.draft(context)]).then(
      ([detail, progress]) => {
        if (!live) return;
        setRead(
          detail.ok && progress.ok && progress.value !== null
            ? {
              state: "ready",
              value: { detail: detail.value, progress: progress.value },
            }
            : { state: "failed" },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [source, context, attempt]);

  if (read.state === "loading") return <Skeleton lines={3} />;
  if (read.state === "failed") {
    return (
      <ErrorState
        target={t("contexts.label.frame-chip")}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }
  const { detail, progress } = read.value;
  return (
    <div>
      <div className={styles.head} data-context-head="">
        <ContextTitle
          name={detail.context.title}
          purpose={detail.context.purpose}
        />
        <p className={styles.drafting} data-drafting="">
          {t("contexts.label.drafting-status", { step: String(progress.step) })}
        </p>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as SubTab)}>
        <TabList>
          {SUB_TABS.map((value) => (
            <Tab key={value} value={value}>
              {subLabel(value)}
            </Tab>
          ))}
        </TabList>
        <TabPanel value="overview">
          <Steps progress={progress} />
          <DraftOverview progress={progress} />
        </TabPanel>
        {SUB_TABS.filter((value) => value !== "overview").map((value) => (
          <TabPanel key={value} value={value}>
            <p className={styles.note}>{t("contexts.note.drafting-later")}</p>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
