// Part 2: Context 탭 본문(Overview·Contract·Violations 하위 탭). 예시 context는 eval이고 harness는 관계로만 나온다.
import { type ReactNode, useState } from "react";
import {
  Button,
  Card,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tree,
  type TreeNode,
} from "@lophn/design/components";

import { Link } from "./link.tsx";
import { experimentTab, findingTab, scenarioTab } from "./phroner-data.ts";
import { Mark, Mono, type TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";

function Header({ tab, name }: { tab: SubTab; name: string }) {
  const detail = tab === "contract";
  return (
    <div className={styles.ctxHead}>
      <div>
        <div className={styles.ctxTitle}>
          <h1>{name}</h1>
          <span className={styles.chip}>Context</span>
        </div>
        <p className={styles.purpose}>
          Keep experiments, scenarios, rubrics and findings of the eval loop
          findable.
        </p>
        {tab === "overview"
          ? (
            <p className={styles.applied}>
              Kept up to date by Context Engineer
            </p>
          )
          : (
            <>
              <p className={styles.applied}>
                <Mono>Version r3</Mono>
                <span>· applied 2 hours ago ·</span>
                <span className={styles.good}>tests passed</span>
              </p>
              <div className={styles.actions}>
                <Button variant="primary">Ask Context Engineer</Button>
                <Button>History</Button>
              </div>
            </>
          )}
        {detail
          ? (
            <p className={styles.note}>
              Details for Context Engineer and the curious
            </p>
          )
          : null}
      </div>
      {detail ? <RelationDiagram /> : null}
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

const DECLARED = [
  { id: "findings-about-change", title: "Findings about a change" },
  { id: "experiments-by-status", title: "Experiments by status" },
  { id: "scenarios-by-rubric", title: "Scenarios using a rubric" },
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
        <h2>Declared searches</h2>
        {DECLARED.map((search) => (
          <div key={search.id} className={styles.fnRow}>
            <span>
              {search.title} <Mono>{search.id}</Mono>
            </span>
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
      <div className={styles.violation}>
        <div>
          <p>
            <span className={styles.violationFile}>reports/weekly-12.md</span>
            {" "}
            · section <Mono>Findings</Mono> is missing
          </p>
          <p className={styles.rule}>rule: Report.sections requires Findings</p>
        </div>
      </div>
      <div className={styles.violation}>
        <div>
          <p>
            <span className={styles.violationFile}>reports/weekly-13.md</span>
            {" "}
            · name doesn't match <Mono>reports/weekly-{"{n}"}.md</Mono>
          </p>
          <p className={styles.rule}>
            rule: Report.path = reports/weekly-{"{n}"}.md
          </p>
        </div>
      </div>
    </>
  );
}

const ENTITIES: readonly {
  key: string;
  name: string;
  from?: string;
  meaning: string;
  count?: number;
  has?: string;
  example: string;
  /** 예시에서 문서로 가는 링크. id를 눌러 그 문서를 연다. */
  link?: { id: string; tab: () => TabSpec; rest: string };
  x: number;
  y: number;
}[] = [
  {
    key: "experiment",
    name: "Experiment",
    meaning: "Tests whether one change helps, on a set of scenarios.",
    count: 13,
    has: "has a status (draft, running, reported), a question, a baseline",
    example: "e.g. ",
    link: {
      id: "exp-008",
      tab: () => experimentTab("exp-008"),
      rest: " · query tools · running",
    },
    x: 0,
    y: 165,
  },
  {
    key: "scenario",
    name: "Scenario",
    meaning: "One task the agent is asked to do, with stages that score it.",
    count: 34,
    has: "has tags, stages",
    example: "e.g. ",
    link: {
      id: "query-leave-still",
      tab: () => scenarioTab("query-leave-still"),
      rest: "",
    },
    x: 360,
    y: 0,
  },
  {
    key: "rubric",
    name: "Rubric",
    meaning: "How a judge scores the work.",
    count: 2,
    has: "has criteria",
    example: "e.g. schedule-quality",
    x: 720,
    y: 0,
  },
  {
    key: "finding",
    name: "Finding",
    meaning: "What an experiment showed about a change.",
    count: 14,
    has: "has a kind (improvement, regression), effects on metrics",
    example: "e.g. ",
    link: {
      id: "F-009",
      tab: () => findingTab("F-009"),
      rest: " · world actions dropped on read-only tasks",
    },
    x: 360,
    y: 330,
  },
  {
    key: "change",
    name: "Change",
    from: "from harness",
    meaning: "A change to the harness being evaluated.",
    example: "e.g. C-049",
    x: 720,
    y: 330,
  },
];

const W = 240;
const H = 210;

// 화살표 라벨은 선 위에 바탕 사각형을 깔아 읽히게 한다.
function Edge(
  { d, label, at }: { d: string; label: string; at: [number, number] },
) {
  const width = label.length * 8 + 16;
  return (
    <g>
      <path className={styles.edge} d={d} markerEnd="url(#domain-arrow)" />
      <rect
        className={styles.edgeLabelBox}
        x={at[0] - width / 2}
        y={at[1] - 11}
        width={width}
        height={22}
        rx={4}
      />
      <text className={styles.edgeLabel} x={at[0]} y={at[1]}>{label}</text>
    </g>
  );
}

function DomainDiagram({ open }: { open: (tab: TabSpec) => void }) {
  return (
    <div className={styles.domain}>
      <svg width={960} height={580} viewBox="0 0 960 580" aria-hidden="true">
        <defs>
          <marker
            id="domain-arrow"
            markerWidth="9"
            markerHeight="9"
            refX="8"
            refY="4.5"
            orient="auto"
          >
            <path className={styles.arrow} d="M0,0 L9,4.5 L0,9 z" />
          </marker>
        </defs>
        <Edge d="M240,230 L358,105" label="runs on" at={[299, 168]} />
        <Edge d="M600,105 L718,105" label="graded by" at={[660, 105]} />
        <Edge d="M240,310 L358,435" label="produces" at={[299, 372]} />
        <Edge d="M600,435 L718,435" label="about" at={[660, 435]} />
        <Edge
          d="M120,375 L120,562 L840,562 L840,542"
          label="checks"
          at={[480, 562]}
        />
      </svg>
      {ENTITIES.map((entity) => (
        <div
          key={entity.key}
          className={`${styles.entity} ${
            entity.from ? styles.entityOuter : ""
          }`}
          style={{ left: entity.x, top: entity.y, width: W, height: H }}
        >
          <div className={styles.entityHead}>
            <h3>{entity.name}</h3>
            {entity.count === undefined
              ? <span className={styles.from}>{entity.from}</span>
              : <span className={styles.muted}>{entity.count}</span>}
          </div>
          <p>{entity.meaning}</p>
          {entity.has === undefined
            ? null
            : <p className={styles.entityHas}>{entity.has}</p>}
          <p className={styles.entityEg}>
            {entity.example}
            {entity.link === undefined ? null : (
              <>
                <Link onClick={() => open(entity.link!.tab())}>
                  {entity.link.id}
                </Link>
                {entity.link.rest}
              </>
            )}
          </p>
          {entity.count === undefined
            ? null
            : <p className={styles.entityLink}>See all {entity.count} →</p>}
        </div>
      ))}
    </div>
  );
}

// 그림 아래 Composition: context가 무엇으로 이루어졌는지 트리로. 경로는 보이고 계약 말(kind·public·함수)은 쓰지 않는다.
const COMPOSITION: readonly TreeNode[] = [
  {
    id: "eval",
    label: "eval",
    children: [
      {
        id: "experiment",
        label:
          "Experiment — 13 documents in eval/experiments, numbered (exp-001 …)",
        children: [
          {
            id: "experiment/has",
            label:
              "has: status · question (from section “질문”) · baseline (from section “기준선”)",
          },
          {
            id: "experiment/links",
            label:
              "links: checks → Change (harness) · runs on → Scenario · produces → Finding",
          },
        ],
      },
      {
        id: "scenario",
        label:
          "Scenario — 34 folders in eval/scenarios, one per scenario, with versions (r1, r2 …)",
        children: [
          { id: "scenario/has", label: "has: tags · stages" },
          { id: "scenario/links", label: "links: graded by → Rubric" },
        ],
      },
      {
        id: "rubric",
        label: "Rubric — 2 folders in eval/rubrics, with versions",
        children: [{ id: "rubric/has", label: "has: criteria" }],
      },
      {
        id: "finding",
        label: "Finding — 14 documents in loop/findings, numbered (F-001 …)",
        children: [
          { id: "finding/has", label: "has: kind · effects" },
          {
            id: "finding/links",
            label: "links: about → Change (harness) · from → Scenario",
          },
        ],
      },
      { id: "harness", label: "uses from harness: Change" },
    ],
  },
];

const COMPOSITION_OPEN = new Set([
  "eval",
  "experiment",
  "scenario",
  "rubric",
  "finding",
]);

function Overview({ open }: { open: (tab: TabSpec) => void }) {
  return (
    <>
      <DomainDiagram open={open} />
      <section className={styles.fns}>
        <h2>Composition</h2>
        <Tree
          nodes={COMPOSITION}
          expanded={COMPOSITION_OPEN}
          onExpandedChange={() => {}}
          label="Composition"
        />
      </section>
    </>
  );
}

export type SubTab =
  | "overview"
  | "search"
  | "violations"
  | "glossary"
  | "contract";

/** harness context의 Overview: 개체 둘만 있어 그림 없이 카드로 보인다. */
function HarnessOverview() {
  return (
    <div className={styles.cards}>
      {[
        {
          name: "Change",
          meaning: "A change to the harness being evaluated.",
          count: 52,
          example: "e.g. C-049",
        },
        {
          name: "Component",
          meaning: "A part of the harness a change touches.",
          count: 18,
          example: "e.g. world loader",
        },
      ].map((entity) => (
        <Card key={entity.name}>
          <div className={styles.cardHead}>
            <h3>{entity.name}</h3>
            <span className={styles.muted}>{entity.count}</span>
          </div>
          <p className={styles.note}>{entity.meaning}</p>
          <p className={styles.note}>{entity.example}</p>
        </Card>
      ))}
    </div>
  );
}

/** Context 탭 본문. 하위 탭을 누르면 머리와 본문이 바뀐다. */
export function ContextBody(
  { name = "eval", initial = "overview", open }: {
    name?: string;
    initial?: SubTab;
    open: (tab: TabSpec) => void;
  },
) {
  const [tab, setTab] = useState<SubTab>(initial);
  const harness = name === "harness";
  return (
    <>
      <Header tab={tab} name={name} />
      <Tabs value={tab} onValueChange={(value) => setTab(value as SubTab)}>
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="search">Search</Tab>
          <Tab value="violations">
            {harness ? "Violations" : "Violations (2)"}
          </Tab>
          <Tab value="glossary">Glossary</Tab>
          <Tab value="contract">Contract</Tab>
        </TabList>
        <TabPanel value="overview">
          {harness ? <HarnessOverview /> : <Overview open={open} />}
        </TabPanel>
        <TabPanel value="search">
          <p className={styles.note}>
            Searches declared in this context open in the Search tab.
          </p>
        </TabPanel>
        <TabPanel value="violations">
          {harness
            ? <p className={styles.note}>No violations.</p>
            : <Violations />}
        </TabPanel>
        <TabPanel value="glossary">{null}</TabPanel>
        <TabPanel value="contract">
          <Contract />
        </TabPanel>
      </Tabs>
    </>
  );
}
