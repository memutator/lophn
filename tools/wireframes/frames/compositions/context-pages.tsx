// Part 2: Context 탭(C2 Contract, C3 Violations). 예시 context는 eval이고 harness는 관계로만 나온다.
import type { ReactNode } from "react";
import {
  Button,
  Card,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@lophn/design/components";

import { Mark, Mono, ProjectWindow, type TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";

const TABS: readonly TabSpec[] = [
  { key: "doc", kind: "document", title: "exp-008-query-tools.md" },
  { key: "eval", kind: "context", title: "eval" },
  { key: "search", kind: "search", title: "phroner" },
];

function Header({ tab }: { tab: "contract" | "violations" }) {
  return (
    <div className={styles.ctxHead}>
      <div>
        <div className={styles.ctxTitle}>
          <h1>eval</h1>
          <span className={styles.chip}>Context</span>
        </div>
        <p className={styles.purpose}>
          Keep experiments, scenarios, rubrics and findings of the eval loop
          findable.
        </p>
        <p className={styles.applied}>
          <Mono>Version r3</Mono>
          <span>· applied 2 hours ago ·</span>
          <span className={styles.good}>tests passed</span>
        </p>
        <div className={styles.actions}>
          <Button variant="primary">Ask Context Engineer</Button>
          <Button>History</Button>
        </div>
      </div>
      {tab === "contract" ? <RelationDiagram /> : null}
    </div>
  );
}

/** Experiment → Scenario → Rubric, Experiment → Finding, 점선은 harness.Change로 가는 public 관계. */
function RelationDiagram() {
  const node = (
    x: number,
    y: number,
    w: number,
    label: string,
    outer = false,
  ) => (
    <g>
      <rect
        className={outer ? styles.nodeOuter : styles.node}
        x={x}
        y={y}
        width={w}
        height={30}
        rx={6}
      />
      <text className={styles.nodeText} x={x + w / 2} y={y + 15}>{label}</text>
    </g>
  );
  return (
    <svg
      className={styles.diagram}
      width={380}
      height={160}
      viewBox="0 0 380 160"
      role="img"
      aria-label="Experiment links to Scenario and Finding, Scenario links to Rubric, dashed links go to harness.Change"
    >
      <defs>
        <marker
          id="rel-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
        >
          <path className={styles.arrow} d="M0,0 L8,4 L0,8 z" />
        </marker>
      </defs>
      <path
        className={styles.edge}
        d="M100,70 L150,25"
        markerEnd="url(#rel-arrow)"
      />
      <path
        className={styles.edge}
        d="M240,25 L268,25"
        markerEnd="url(#rel-arrow)"
      />
      <path
        className={styles.edge}
        d="M100,80 L150,115"
        markerEnd="url(#rel-arrow)"
      />
      <path
        className={`${styles.edge} ${styles.edgeDashed}`}
        d="M55,85 L55,148 L315,148 L315,132"
        markerEnd="url(#rel-arrow)"
      />
      <path
        className={`${styles.edge} ${styles.edgeDashed}`}
        d="M240,115 L258,115"
        markerEnd="url(#rel-arrow)"
      />
      {node(10, 55, 90, "Experiment")}
      {node(150, 10, 90, "Scenario")}
      {node(270, 10, 90, "Rubric")}
      {node(150, 100, 90, "Finding")}
      {node(260, 100, 110, "harness.Change", true)}
    </svg>
  );
}

function TypeCard(
  { name, isPublic, kind, path, count, fields, relations }: {
    name: string;
    isPublic?: boolean;
    kind: string;
    path: string;
    count: number;
    fields: ReactNode;
    relations?: ReactNode;
  },
) {
  return (
    <Card>
      <div className={styles.cardHead}>
        <h3>{name}</h3>
        {isPublic ? <Mark>public</Mark> : null}
        <span className={styles.chip}>
          kind&nbsp;<Mono>{kind}</Mono>
        </span>
        <span className={styles.muted}>{count} documents</span>
      </div>
      <p className={styles.cardPath}>{path}</p>
      <p className={styles.cardLabel}>Fields</p>
      <ul className={styles.rows}>{fields}</ul>
      {relations === undefined ? null : (
        <>
          <p className={styles.cardLabel}>Relations</p>
          <ul className={styles.rows}>{relations}</ul>
        </>
      )}
    </Card>
  );
}

const FUNCTIONS = [
  "experiments.find(status?, about?, scenario?)",
  "findings.find(about?, metric?)",
  "scenarios.byRubric(rubric)",
] as const;

function Contract() {
  return (
    <>
      <div className={styles.cards}>
        <TypeCard
          name="Experiment"
          isPublic
          kind="series"
          path="eval/experiments/exp-*.md"
          count={13}
          fields={
            <>
              <li>
                <Mono>status</Mono> draft | running | reported{" "}
                <Mark>public</Mark>
              </li>
              <li>
                <Mono>metrics</Mono>
              </li>
              <li>
                <Mono>question</Mono> = section <Mono>## 질문</Mono>
              </li>
              <li>
                <Mono>baseline</Mono> = section <Mono>## 기준선</Mono>
              </li>
            </>
          }
          relations={
            <>
              <li>
                <Mono>about</Mono> → harness.Change <Mark>public</Mark>
              </li>
              <li>
                <Mono>scenarios</Mono> → Scenario@rev
              </li>
              <li>
                <Mono>findings</Mono> → Finding
              </li>
            </>
          }
        />
        <TypeCard
          name="Finding"
          isPublic
          kind="series"
          path="loop/findings/F-*.md"
          count={14}
          fields={
            <>
              <li>
                <Mono>kind</Mono>
              </li>
              <li>
                <Mono>effects</Mono>
              </li>
            </>
          }
          relations={
            <>
              <li>
                <Mono>about</Mono> → harness.Change
              </li>
              <li>
                <Mono>scenarios</Mono> → Scenario
              </li>
            </>
          }
        />
        <TypeCard
          name="Scenario"
          kind="folder"
          path="eval/scenarios/<id>/rN.yaml"
          count={34}
          fields={
            <>
              <li>
                <Mono>tags</Mono>
              </li>
              <li>
                <Mono>stages</Mono>
              </li>
            </>
          }
          relations={
            <li>
              <Mono>rubric</Mono> → Rubric@rev
            </li>
          }
        />
        <TypeCard
          name="Rubric"
          kind="folder"
          path="eval/rubrics/<id>/rN.yaml"
          count={2}
          fields={
            <li>
              <Mono>criteria</Mono>
            </li>
          }
        />
      </div>
      <section className={styles.fns}>
        <h2>Search functions</h2>
        {FUNCTIONS.map((signature) => (
          <div key={signature} className={styles.fnRow}>
            <Mono>{signature}</Mono>
            <span className={styles.good}>✓ 6 examples pass</span>
          </div>
        ))}
      </section>
    </>
  );
}

function Violations() {
  return (
    <>
      <div className={styles.bulk}>
        <Button>Send all to Context Engineer</Button>
      </div>
      <div className={styles.violation}>
        <div>
          <p>
            <span className={styles.violationFile}>
              exp-012-ftb-quests-021-q8.md
            </span>{" "}
            · <Mono>about</Mono> is missing
          </p>
          <p className={styles.rule}>rule: Experiment.about required</p>
        </div>
        <Button>Send to Context Engineer</Button>
      </div>
      <div className={styles.violation}>
        <div>
          <p>
            <span className={styles.violationFile}>F-014.md</span> · scenario
            {" "}
            <Mono>sched-x</Mono> doesn't exist
          </p>
          <p className={styles.rule}>rule: Finding.scenarios → Scenario</p>
        </div>
        <span className={styles.status}>Context Engineer is on it</span>
      </div>
    </>
  );
}

function ContextWindow({ tab }: { tab: "contract" | "violations" }) {
  return (
    <ProjectWindow
      sidebar={{}}
      crumbs={["phroner", "eval", "Context"]}
      left={{
        tabs: TABS,
        selected: "eval",
        children: (
          <>
            <Header tab={tab} />
            <Tabs defaultValue={tab}>
              <TabList>
                <Tab value="contract">Contract</Tab>
                <Tab value="violations">Violations (2)</Tab>
                <Tab value="views">Saved views</Tab>
                <Tab value="glossary">Glossary</Tab>
              </TabList>
              <TabPanel value="contract">
                <Contract />
              </TabPanel>
              <TabPanel value="violations">
                <Violations />
              </TabPanel>
              <TabPanel value="views">{null}</TabPanel>
              <TabPanel value="glossary">{null}</TabPanel>
            </Tabs>
          </>
        ),
      }}
    />
  );
}

/** C2: Context 탭 · 계약. */
export function ContextContract() {
  return <ContextWindow tab="contract" />;
}

/** C3: Context 탭 · Violations. */
export function ContextViolations() {
  return <ContextWindow tab="violations" />;
}
