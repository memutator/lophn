// Part 2: project 화면 위의 새 설계(C1, C1b, C4, C5, C5b, C7). 고정 data만 쓴다.
import type { ReactNode } from "react";
import {
  Card,
  conversationIcons,
  IconButton,
  lophnSpaceIcons,
  Textarea,
  Toast,
  ToastStack,
} from "@lophn/design/components";
import { Button, Field, Select } from "@lophn/ui-control";
import { DataTable, type TableColumn } from "@lophn/ui-table";

import fieldStyles from "../../../../packages/design/components/field/field.module.css";

import {
  CHAT,
  DocumentBody,
  type PaneSpec,
  ProjectWindow,
  StaticMenu,
  type TabSpec,
} from "./project-window.tsx";
import styles from "./compose.module.css";

const NOW = new Date("2026-10-11T12:00:00Z");
const DOC: TabSpec = {
  key: "exp-008",
  kind: "document",
  title: "exp-008-query-tools.md",
};
const CONTEXT: TabSpec = { key: "eval", kind: "context", title: "eval" };
const SEARCH: TabSpec = { key: "search", kind: "search", title: "phroner" };
const TERMINAL: TabSpec = {
  key: "terminal",
  kind: "terminal",
  title: "phroner",
};
const LEFT_TABS = [DOC, CONTEXT, SEARCH, TERMINAL] as const;
const CHAT_TAB: TabSpec = {
  key: "chat",
  kind: "conversation",
  title: "lophn",
};

function Conversation() {
  return (
    <div className={styles.chat}>
      <div className={styles.turns}>
        {CHAT.map((turn, index) => (
          <div
            key={index}
            className={`${styles.turn} ${
              turn.who === "You" ? styles.mine : ""
            }`}
          >
            <span className={styles.who}>{turn.who}</span>
            <p className={styles.said}>{turn.text}</p>
          </div>
        ))}
      </div>
      <div className={styles.composer}>
        <Field label="Message">
          <Textarea rows={2} placeholder="Message lophn" />
        </Field>
        <IconButton
          icon={conversationIcons.send}
          label="Send"
          variant="secondary"
        />
      </div>
    </div>
  );
}

const CRUMBS = ["phroner", "eval", "experiments", "exp-008-query-tools.md"];
const DOC_SELECTED = "eval/experiments/exp-008-query-tools.md";

function chatPane(): PaneSpec {
  return {
    tabs: [CHAT_TAB],
    selected: CHAT_TAB.key,
    focused: false,
    flush: true,
    children: <Conversation />,
  };
}

function documentPane(overlay?: PaneSpec["overlay"]): PaneSpec {
  return {
    tabs: LEFT_TABS,
    selected: DOC.key,
    children: <DocumentBody />,
    overlay,
  };
}

/** C1: 탭 kind 확장. 문서·Context·Search·Terminal 탭과 오른쪽 칸의 대화 탭. */
export function TabKinds() {
  return (
    <ProjectWindow
      sidebar={{ current: DOC_SELECTED }}
      crumbs={CRUMBS}
      left={documentPane()}
      right={chatPane()}
    >
      <ToastStack>
        <Toast
          title="Tracking is off for phroner"
          actions={[{ id: "on", label: "Turn on" }]}
          onClose={() => {}}
          timer={NO_TIMER}
        />
      </ToastStack>
    </ProjectWindow>
  );
}

// toast가 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다.
const NO_TIMER = { set: () => 0, clear: () => {} };

/** C1b: + 메뉴를 펼친 상태. New tab → Document, Terminal, Conversation ▸, Context, Search, App panel. */
export function NewTabMenu() {
  return (
    <ProjectWindow
      sidebar={{ current: DOC_SELECTED }}
      crumbs={CRUMBS}
      left={documentPane(
        <div className={styles.menus}>
          <StaticMenu
            head="New tab"
            highlighted="Conversation"
            items={[
              { label: "Document" },
              { label: "Terminal" },
              { label: "Conversation", more: true },
              { label: "Context" },
              { label: "Search" },
              { label: "App panel" },
            ]}
          />
          <StaticMenu
            head="Conversation with"
            width={180}
            items={[
              { label: "lophn" },
              { label: "Context Engineer" },
              { label: "Operator…" },
            ]}
          />
        </div>,
      )}
      right={chatPane()}
    />
  );
}

/** C4: 계약 위반 toast. */
export function ViolationToast() {
  return (
    <ProjectWindow
      sidebar={{ current: DOC_SELECTED }}
      crumbs={CRUMBS}
      left={documentPane()}
      right={chatPane()}
    >
      <ToastStack>
        <Toast
          title="eval: 2 documents don't match the contract"
          actions={[{ id: "view", label: "View" }]}
          onClose={() => {}}
          timer={NO_TIMER}
        />
      </ToastStack>
    </ProjectWindow>
  );
}

const SEARCHES = [
  "Findings about a change",
  "Experiments by status",
  "Scenarios using a rubric",
] as const;

// 왼쪽 칸: context 고르기, 선언된 검색 이름들, saved view.
function SearchSide({ active }: { active: (typeof SEARCHES)[number] }) {
  const row = (
    label: string,
    selected: boolean,
    icon?: typeof lophnSpaceIcons.savedView,
  ) => (
    <li key={label} className={selected ? styles.selected : undefined}>
      <Button variant="ghost" size="sm" icon={icon}>
        {label}
      </Button>
    </li>
  );
  return (
    <aside className={styles.searchSide}>
      <Field label="Context">
        <Select
          options={[{ value: "eval", label: "eval" }, {
            value: "harness",
            label: "harness",
          }]}
          defaultValue="eval"
        />
      </Field>
      <div>
        <p className={styles.groupLabel}>Searches</p>
        <ul className={styles.rows}>
          {SEARCHES.map((name) => row(name, name === active))}
        </ul>
      </div>
      <div>
        <p className={styles.groupLabel}>Saved views</p>
        <ul className={styles.rows}>
          {row("Findings for C-049", false, lophnSpaceIcons.savedView)}
          {row("Running experiments", false, lophnSpaceIcons.savedView)}
        </ul>
      </div>
    </aside>
  );
}

function searchPane(body: ReactNode): PaneSpec {
  return {
    tabs: LEFT_TABS,
    selected: SEARCH.key,
    flush: true,
    children: <div className={styles.search}>{body}</div>,
  };
}

// 입력 칸 한 줄의 이름. 실제 Field와 같은 label 모양이다.
function Legend({ children }: { children: ReactNode }) {
  return <span className={fieldStyles.label}>{children}</span>;
}

interface Finding {
  id: string;
  title: string;
  kind: string;
  scenario: string;
  effect: string;
  experiment: string;
}

const FINDINGS: readonly Finding[] = [
  {
    id: "F-009",
    title: "읽고 멈추는 과제에서 월드 행동 시도가 사라진다",
    kind: "improvement",
    scenario: "query-leave-still",
    effect: "world_actions 3 → 0",
    experiment: "exp-008",
  },
  {
    id: "F-010",
    title: "상자 이름을 묻는 과제에서 불필요한 열기 호출이 줄었다",
    kind: "improvement",
    scenario: "query-chest-name",
    effect: "tool_calls 5 → 2",
    experiment: "exp-008",
  },
  {
    id: "F-011",
    title: "레시피 빈틈을 묻는 과제에서 오답이 늘었다",
    kind: "regression",
    scenario: "query-recipe-gap",
    effect: "answer_match 0.8 → 0.6",
    experiment: "exp-008",
  },
];

// 선언된 table 결과. DataTable은 text·number·time 열만 그려서 링크와 상태 pill은 글자로 둔다.
const FINDING_COLUMNS: readonly TableColumn<Finding>[] = [
  {
    id: "finding",
    header: "Finding",
    kind: "text",
    value: (row) => `${row.id} · ${row.title}`,
  },
  { id: "kind", header: "Kind", kind: "text", value: (row) => row.kind },
  {
    id: "scenario",
    header: "Scenario",
    kind: "text",
    value: (row) => row.scenario,
  },
  { id: "effect", header: "Effect", kind: "text", value: (row) => row.effect },
  {
    id: "experiment",
    header: "Experiment",
    kind: "text",
    value: (row) => row.experiment,
  },
];

const DECLARATION = `search: findings-about-change
title: Findings about a change
inputs:
  change: { type: pick, of: harness.Change }
  kind:   { type: choose-many, of: Finding.kind }
  metric: { type: choose-one, of: Finding.effects.metric, optional: true }
result:
  view: table
  columns: [finding, kind, scenario, effect, experiment]`;

function Kind({ label, on }: { label: string; on: boolean }) {
  return (
    <Button
      variant={on ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={on}
    >
      {on ? `✓ ${label}` : label}
    </Button>
  );
}

const CHANGES = [
  {
    value: "c-049",
    label: "C-049 · 행동 전에 로드된 월드와 등록 정보를 조회한다",
  },
  { value: "c-050", label: "C-050 · 읽기 전용 과제에서 월드 행동을 막는다" },
];

/** C5: 선언된 검색 · table 결과. 입력 form과 table은 SDK ui-control·ui-table로 그린다. */
export function DeclaredSearchTable() {
  return (
    <ProjectWindow
      sidebar={{}}
      crumbs={["phroner", "Search", "Findings about a change"]}
      left={searchPane(
        <>
          <SearchSide active="Findings about a change" />
          <div className={styles.results}>
            <h1 className={styles.searchTitle}>Findings about a change</h1>
            <div className={styles.form}>
              <Field label="Change">
                <Select options={CHANGES} defaultValue="c-049" />
              </Field>
              <div className={styles.formGroup}>
                <Legend>Kind</Legend>
                <div className={styles.chips}>
                  <Kind label="improvement" on />
                  <Kind label="regression" on />
                  <Kind label="neutral" on={false} />
                </div>
              </div>
              <Field label="Metric">
                <Select
                  options={[
                    { value: "any", label: "Any metric" },
                    { value: "world_actions", label: "world_actions" },
                    { value: "tool_calls", label: "tool_calls" },
                    { value: "answer_match", label: "answer_match" },
                  ]}
                  defaultValue="any"
                />
              </Field>
              <div className={styles.actions}>
                <Button variant="primary">Search</Button>
                <Button>Save as view</Button>
              </div>
            </div>
            <p className={styles.resultCount}>3 findings</p>
            <DataTable
              columns={FINDING_COLUMNS}
              rows={FINDINGS}
              rowKey={(row) => row.id}
              now={NOW}
              loading={false}
              onRetry={() => {}}
              empty={{
                message: "No findings.",
                action: { label: "Reset", onSelect: () => {} },
              }}
            />
            <div className={styles.declaration}>
              <span className={styles.declarationHead}>Show declaration ▾</span>
              <pre className={styles.code}>{DECLARATION}</pre>
              <p className={styles.note}>
                Written by Context Engineer. lophn draws the form and the table
                from it with the shared parts.
              </p>
            </div>
          </div>
        </>,
      )}
    />
  );
}

const BOARD = [
  {
    title: "Draft",
    cards: [
      { id: "exp-013", name: "ftb quests 2", meta: "4 scenarios" },
      { id: "exp-014", name: "route planner", meta: "2 scenarios" },
    ],
  },
  {
    title: "Running",
    cards: [
      { id: "exp-008", name: "query tools", meta: "6 scenarios · 3 findings" },
      { id: "exp-011", name: "chest names", meta: "3 scenarios" },
      { id: "exp-012", name: "ftb quests 021 q8", meta: "5 scenarios" },
    ],
  },
  {
    title: "Reported",
    count: 8,
    cards: [
      {
        id: "exp-007",
        name: "recipe lookup",
        meta: "5 scenarios · 4 findings",
      },
      {
        id: "exp-006",
        name: "inventory read",
        meta: "6 scenarios · 2 findings",
      },
      {
        id: "exp-005",
        name: "schedule tools",
        meta: "4 scenarios · 1 finding",
      },
    ],
  },
] as const;

/** C5b: 선언된 검색 · board 결과. 입력은 개체 고르기 둘이다. */
export function DeclaredSearchBoard() {
  const any = [{ value: "any", label: "Any" }, {
    value: "q",
    label: "query-leave-still",
  }];
  return (
    <ProjectWindow
      sidebar={{}}
      crumbs={["phroner", "Search", "Experiments by status"]}
      left={searchPane(
        <>
          <SearchSide active="Experiments by status" />
          <div className={styles.results}>
            <h1 className={styles.searchTitle}>Experiments by status</h1>
            <div className={styles.formRow}>
              <Field label="Scenario">
                <Select options={any} defaultValue="any" />
              </Field>
              <Field label="About change">
                <Select
                  options={[{ value: "any", label: "Any" }, ...CHANGES]}
                  defaultValue="any"
                />
              </Field>
            </div>
            <div className={styles.board}>
              {BOARD.map((column) => (
                <section key={column.title} className={styles.boardColumn}>
                  <h2 className={styles.boardHead}>
                    {column.title}{" "}
                    <span className={styles.muted}>
                      {"count" in column ? column.count : column.cards.length}
                    </span>
                  </h2>
                  {column.cards.map((card) => (
                    <Card key={card.id}>
                      <strong>{card.id}</strong> · {card.name}
                      <p className={styles.note}>{card.meta}</p>
                    </Card>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </>,
      )}
    />
  );
}

/** C7: 문서 정리. 문서 행의 오른쪽 클릭 메뉴와 폴더 행의 메뉴. */
export function DocumentOrganize() {
  const menuFor = "eval/experiments/exp-012-ftb-quests-021-q8.md";
  return (
    <ProjectWindow
      sidebar={{
        current: DOC_SELECTED,
        menuFor,
        menu: (
          <div
            className={styles.contextMenu}
            style={{
              top: "calc(var(--tree-row) * 5)",
              left: "var(--space-11)",
            }}
          >
            <StaticMenu
              width={180}
              highlighted="Open"
              items={[
                { label: "Open" },
                { label: "Open read-only" },
                { label: "Rename" },
                { label: "Move…" },
                { label: "Archive" },
                { label: "Stop tracking" },
              ]}
            />
          </div>
        ),
      }}
      crumbs={CRUMBS}
      left={documentPane(
        <div className={styles.folderMenu}>
          <p className={styles.sectionTitle}>Right-click a folder row</p>
          <StaticMenu width={180} items={[{ label: "Unlink folder" }]} />
        </div>,
      )}
      right={chatPane()}
    />
  );
}
