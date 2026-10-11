// 만드는 중 상태(C12). Context Engineer와 대화한 뒤 새 context의 탭이 이 모양으로 열린다.
import { useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/design/components";

import type { TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";

/** 만드는 중인 context의 탭. 이름·목적·읽은 자료 수는 대화에서 정해진다. */
export const draftTab = (
  name: string,
  draft: NonNullable<TabSpec["draft"]>,
): TabSpec => ({
  key: `context:${name}`,
  kind: "context",
  title: name,
  sub: "overview",
  draft,
});

export const RELEASE_NOTES_DRAFT = {
  purpose:
    "Keep release notes, changelogs and the issues they close findable, so an Operator can draft the next release note.",
  places: 3,
  documents: 24,
} as const;

type SubTab = "overview" | "search" | "violations" | "glossary" | "contract";

/** C12: 만드는 중인 context 탭. 진행 표시와 아직 확정 아닌 초안. 막히면 오른쪽 대화로 묻는다. */
export function ContextDrafting(
  { name, draft }: { name: string; draft: NonNullable<TabSpec["draft"]> },
) {
  const [tab, setTab] = useState<SubTab>("overview");
  const steps = [
    {
      state: "done",
      text: `Read ${draft.places} places (${draft.documents} documents)`,
    },
    { state: "now", text: "Drafting overview and searches" },
    { state: "later", text: "Run checks" },
    { state: "later", text: "Apply" },
  ] as const;
  const marks = { done: "✓", now: "●", later: "○" } as const;
  return (
    <>
      <div className={styles.ctxHead}>
        <div>
          <div className={styles.ctxTitle}>
            <h1>{name}</h1>
            <span className={styles.chip}>Context</span>
          </div>
          <p className={styles.purpose}>{draft.purpose}</p>
          <p className={styles.applied}>
            <span className={styles.drafting}>
              Context Engineer is drafting · step 2 of 4
            </span>
          </p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as SubTab)}>
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="search">Search</Tab>
          <Tab value="violations">Violations</Tab>
          <Tab value="glossary">Glossary</Tab>
          <Tab value="contract">Contract</Tab>
        </TabList>
        <TabPanel value="overview">
          <ol className={styles.steps} aria-label="Progress">
            {steps.map((step) => (
              <li key={step.text} className={styles[`step_${step.state}`]}>
                <span className={styles.stepMark}>{marks[step.state]}</span>
                {step.text}
              </li>
            ))}
          </ol>
          <section className={styles.fns}>
            <h2>
              Draft overview <span className={styles.chip}>Draft</span>
            </h2>
            <div className={styles.draftRow}>
              <div className={styles.draftCard}>
                <h3>Changelog entry</h3>
                <span className={styles.chip}>Draft</span>
              </div>
              <span className={styles.draftArrow}>
                <span>mentions</span>→
              </span>
              <div className={styles.draftCard}>
                <h3>Release</h3>
                <span className={styles.chip}>Draft</span>
              </div>
              <span className={styles.draftArrow}>
                <span>closes</span>→
              </span>
              <div className={styles.draftCard}>
                <h3>Issue</h3>
                <span className={styles.chip}>Draft</span>
              </div>
            </div>
            <p className={styles.note}>
              Not final. Context Engineer applies it when the checks pass.
            </p>
          </section>
        </TabPanel>
        {(["search", "violations", "glossary", "contract"] as const).map((
          value,
        ) => (
          <TabPanel key={value} value={value}>
            <p className={styles.note}>
              Available after Context Engineer applies the first version.
            </p>
          </TabPanel>
        ))}
      </Tabs>
    </>
  );
}
