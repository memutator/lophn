// Part 2: Context 탭 본문(Overview·Searches·Violations·Glossary·Contract 하위 탭). 예시 context는 eval이고 harness는 관계로만 나온다.
// 머리에는 적용된 판과 판 목록·되돌리기가 있고, agent를 부르는 단추는 없다. 위반 목록만 Project Manager에게 넘긴다.
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
import {
  documentTab,
  experimentTab,
  findingTab,
  scenarioTab,
} from "./phroner-data.ts";
import { Mark, Mono, type TabSpec } from "./project-window.tsx";
import {
  DECLARED_SEARCHES,
  SAVED_VIEWS,
  versionsOf,
  type ViolationRow,
  VIOLATIONS,
} from "./contexts/contexts-data.ts";
import { declaredSearchTab } from "./contexts/declared-search.tsx";
import { Glossary, type GlossaryDemo } from "./contexts/glossary.tsx";
import { TabToast } from "./contexts/tab-toast.tsx";
import { pmNewTab } from "./contexts/pm-session.tsx";
import styles from "./compose.module.css";
import c from "./contexts/contexts.module.css";

function Header(
  { tab, name, current, restored, versions, onVersions }: {
    tab: SubTab;
    name: string;
    current: string;
    restored: boolean;
    versions: boolean;
    onVersions: () => void;
  },
) {
  const detail = tab === "contract";
  return (
    <div className={styles.ctxHead}>
      <div className={c.headMain}>
        <div className={c.titleRow}>
          <h1 className={c.titleText}>{name}</h1>
          <span className={styles.chip}>Context</span>
          <span className={c.spacer} />
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={versions}
            onClick={onVersions}
          >
            {versions ? "Versions ▴" : "Versions ▾"}
          </Button>
        </div>
        <p className={styles.purpose}>
          Keep experiments, scenarios, rubrics and findings of the eval loop
          findable.
        </p>
        <p className={styles.applied}>
          <Mono>Version {current}</Mono>
          <span>· applied {restored ? "just now" : "2 hours ago"} ·</span>
          <span className={styles.good}>tests passed</span>
        </p>
        {detail
          ? (
            <p className={styles.note}>
              Details of the contract this context follows
            </p>
          )
          : null}
      </div>
      {detail ? <RelationDiagram /> : null}
    </div>
  );
}

/** 적용된 판의 목록. 판마다 시각과 바뀐 것 한 줄이 있고, 옛 판 줄의 [Restore]로 되돌린다. */
function VersionList(
  { name, current, onRestore }: {
    name: string;
    current: string;
    onRestore: (id: string) => void;
  },
) {
  return (
    <section className={c.versions} aria-label="Versions">
      <h2>Versions</h2>
      {versionsOf(name).map((version) => (
        <div key={version.id} className={c.version}>
          <span className={c.versionName}>{version.id}</span>
          <span className={c.versionWhen}>{version.when}</span>
          <span className={c.versionChange}>{version.change}</span>
          {version.id === current
            ? <span className={c.chip}>Current</span>
            : (
              <Button
                size="sm"
                onClick={() => onRestore(version.id)}
              >
                Restore
              </Button>
            )}
        </div>
      ))}
    </section>
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

/** 위반 목록: 읽기, 파일 열기, Project Manager에게 넘기기. 위반 근거(파일과 규칙)가 붙어 간다. */
function Violations({ open }: { open: ContextBodyProps["open"] }) {
  const send = (rows: readonly ViolationRow[]) => open(pmNewTab(rows), true);
  return (
    <>
      <div className={c.bulk}>
        <span className={c.note}>
          {VIOLATIONS.length} documents don't match this context
        </span>
        <Button variant="primary" onClick={() => send(VIOLATIONS)}>
          Send all to Project Manager
        </Button>
      </div>
      {VIOLATIONS.map((row) => (
        <div key={row.path} className={c.violation}>
          <div>
            <p>
              <Link
                onClick={() => open(documentTab(row.path))}
              >
                <span className={c.violationFile}>{row.path}</span>
              </Link>{" "}
              · {row.what}
            </p>
            <p className={c.rule}>rule: {row.rule}</p>
          </div>
          <Button onClick={() => send([row])}>Send to Project Manager</Button>
        </div>
      ))}
    </>
  );
}

/** 이 context에 선언된 검색과 saved view. 누르면 Search 탭이 열린다. */
function Searches({ open }: { open: ContextBodyProps["open"] }) {
  return (
    <>
      <section>
        <h2 className={c.sectionTitle}>Declared searches</h2>
        <ul className={c.entries}>
          {DECLARED_SEARCHES.map((search, index) => (
            <li key={search.id} className={c.entry}>
              <span>
                {search.title} <Mono>{search.id}</Mono>
              </span>
              <Button
                size="sm"
                onClick={() =>
                  open(
                    declaredSearchTab(index === 1 ? "experiments" : "findings"),
                  )}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className={c.sectionTitle}>Saved views</h2>
        <ul className={c.entries}>
          {SAVED_VIEWS.map((view) => (
            <li key={view} className={c.entry}>
              <Link onClick={() => open(declaredSearchTab("findings"))}>
                {view}
              </Link>
            </li>
          ))}
        </ul>
      </section>
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

export interface ContextBodyProps {
  readonly name?: string;
  readonly initial?: SubTab;
  /** 판 목록을 펼친 채 시작한다. */
  readonly versionsOpen?: boolean;
  /** 옛 판(r2)으로 되돌린 직후 상태로 시작한다. */
  readonly restoredDemo?: boolean;
  /** 용어집의 더하기·고치기·지우기 확인 중 하나를 연 채 시작한다. */
  readonly glossaryDemo?: GlossaryDemo;
  readonly open: (tab: TabSpec, other?: boolean) => void;
}

/** Context 탭 본문. 하위 탭을 누르면 머리와 본문이 바뀐다. 열 때 읽고, 열려 있는 동안 다시 읽지 않는다. */
export function ContextBody(
  {
    name = "eval",
    initial = "overview",
    versionsOpen = false,
    restoredDemo = false,
    glossaryDemo,
    open,
  }: ContextBodyProps,
) {
  const [tab, setTab] = useState<SubTab>(initial);
  const [versions, setVersions] = useState(versionsOpen || restoredDemo);
  const list = versionsOf(name);
  const [current, setCurrent] = useState(
    restoredDemo ? list[1].id : list[0].id,
  );
  const [restored, setRestored] = useState(restoredDemo);
  const [toast, setToast] = useState(restoredDemo);
  const harness = name === "harness";
  return (
    <div className={c.column}>
      {toast
        ? (
          <TabToast
            title={`Restored version ${current}`}
            body="Its contract and searches apply again."
            onClose={() => setToast(false)}
          />
        )
        : null}
      <Header
        tab={tab}
        name={name}
        current={current}
        restored={restored}
        versions={versions}
        onVersions={() => setVersions(!versions)}
      />
      {versions
        ? (
          <VersionList
            name={name}
            current={current}
            onRestore={(id) => {
              setCurrent(id);
              setRestored(true);
              setToast(true);
            }}
          />
        )
        : null}
      <Tabs value={tab} onValueChange={(value) => setTab(value as SubTab)}>
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="search">Searches</Tab>
          <Tab value="violations">
            {harness ? "Violations" : `Violations (${VIOLATIONS.length})`}
          </Tab>
          <Tab value="glossary">Glossary</Tab>
          <Tab value="contract">Contract</Tab>
        </TabList>
        <TabPanel value="overview">
          {harness ? <HarnessOverview /> : <Overview open={open} />}
        </TabPanel>
        <TabPanel value="search">
          <Searches open={open} />
        </TabPanel>
        <TabPanel value="violations">
          {harness
            ? <p className={styles.note}>No violations.</p>
            : <Violations open={open} />}
        </TabPanel>
        <TabPanel value="glossary">
          <Glossary demo={glossaryDemo} />
        </TabPanel>
        <TabPanel value="contract">
          <Contract />
        </TabPanel>
      </Tabs>
    </div>
  );
}
