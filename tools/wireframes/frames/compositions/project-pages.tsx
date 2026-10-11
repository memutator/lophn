// Part 2: project 화면 위의 새 설계(C1, C1b, C4, C5, C5b, C7). 고정 data만 쓴다.
import type { ReactNode } from "react";
import {
  Button,
  conversationIcons,
  Field,
  IconButton,
  Input,
  lophnSpaceIcons,
  Textarea,
  Toast,
  ToastStack,
} from "@lophn/design/components";

import {
  CHAT,
  DocumentBody,
  Mono,
  type PaneSpec,
  ProjectWindow,
  StaticMenu,
  type TabSpec,
} from "./project-window.tsx";
import styles from "./compose.module.css";

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

function SavedViews({ active }: { active?: string }) {
  const row = (label: string, selected = false) => (
    <li key={label} className={selected ? styles.selected : undefined}>
      <Button variant="ghost" size="sm" icon={lophnSpaceIcons.savedView}>
        {label}
      </Button>
    </li>
  );
  return (
    <div>
      <p className={styles.groupLabel}>eval</p>
      <ul className={styles.rows}>
        {row("Running experiments")}
        {row("Findings for C-049", active === "c-049")}
      </ul>
      <p className={styles.groupLabel}>harness</p>
      <ul className={styles.rows}>{row("Changes this week")}</ul>
    </div>
  );
}

function SearchSide({ query, active }: { query?: string; active?: string }) {
  return (
    <aside className={styles.searchSide}>
      <Field label="Search">
        <Input placeholder="Search phroner" defaultValue={query} />
      </Field>
      <SavedViews active={active} />
    </aside>
  );
}

const FINDINGS = [
  {
    id: "F-009",
    title: "읽고 멈추는 과제에서 월드 행동 시도가 사라진다",
    kind: "improvement",
    scenario: "query-leave-still",
    metric: "world_actions 3 → 0",
  },
  {
    id: "F-010",
    title: "상자 이름을 묻는 과제에서 불필요한 열기 호출이 줄었다",
    kind: "improvement",
    scenario: "query-chest-name",
    metric: "tool_calls 5 → 2",
  },
  {
    id: "F-011",
    title: "레시피 빈틈을 묻는 과제에서 오답이 늘었다",
    kind: "regression",
    scenario: "query-recipe-gap",
    metric: "answer_match 0.8 → 0.6",
  },
] as const;

function searchPane(body: ReactNode): PaneSpec {
  return {
    tabs: LEFT_TABS,
    selected: SEARCH.key,
    flush: true,
    children: <div className={styles.search}>{body}</div>,
  };
}

/** C5: Search 탭에서 연 saved view. */
export function SavedViewResults() {
  return (
    <ProjectWindow
      sidebar={{ savedActive: "c-049" }}
      crumbs={["phroner", "Search", "Findings for C-049"]}
      left={searchPane(
        <>
          <SearchSide active="c-049" />
          <div className={styles.results}>
            <div className={styles.call}>
              <code>eval.findings.find({'{ about: "C-049" }'})</code>
              <span className={styles.muted}>3 results</span>
              <span className={styles.callSpacer} />
              <Button size="sm">Open as tab per row</Button>
            </div>
            {FINDINGS.map((finding) => (
              <div key={finding.id} className={styles.hit}>
                <div className={styles.hitHead}>
                  <Mono>{finding.id}</Mono>
                  <span className={styles.hitTitle}>{finding.title}</span>
                </div>
                <div className={styles.hitMeta}>
                  <span className={styles[finding.kind]}>{finding.kind}</span>
                  <Mono>{finding.scenario}</Mono>
                  <Mono>{finding.metric}</Mono>
                </div>
              </div>
            ))}
          </div>
        </>,
      )}
    />
  );
}

const HITS = [
  {
    path: "eval/experiments/exp-008-query-tools.md",
    before: "…scored with the query-hygiene ",
    after: " r2, criteria “no world action on read-only tasks”…",
  },
  {
    path: "eval/rubrics/query-hygiene/r2.yaml",
    before: "# ",
    after:
      " for read-and-stop scenarios; criteria: no_world_action, answer_match",
  },
  {
    path: "loop/findings/F-009.md",
    before: "…the ",
    after: " flagged world_actions in 3 of 6 runs before the change…",
  },
  {
    path: "eval/experiments/exp-012-ftb-quests-021-q8.md",
    before: "…no ",
    after: " is attached yet; the scenario set is still being picked…",
  },
] as const;

/** C5b: 일반 검색어 "rubric". 일반 검색에는 [Save as view]가 없다. */
export function PlainSearchResults() {
  return (
    <ProjectWindow
      crumbs={["phroner", "Search"]}
      left={searchPane(
        <>
          <SearchSide query="rubric" />
          <div className={styles.results}>
            <div className={styles.call}>
              <span>4 documents match “rubric”</span>
              <span className={styles.callSpacer} />
              <span className={styles.muted}>
                A plain search runs each time you type.
              </span>
            </div>
            {HITS.map((hit) => (
              <div key={hit.path} className={styles.hit}>
                <Mono>{hit.path}</Mono>
                <p className={styles.snippet}>
                  {hit.before}
                  <mark>rubric</mark>
                  {hit.after}
                </p>
              </div>
            ))}
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
