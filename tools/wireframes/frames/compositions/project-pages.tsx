// Part 2: project 화면 위의 새 설계. 모두 동작하는 ProjectApp 위에 고정 data로 놓는다.
import { Toast, ToastStack } from "@lophn/design/components";

import { documentTab, objectTab } from "./bodies.tsx";
import { type PaneInit, ProjectApp } from "./project-app.tsx";
import { StaticMenu, type TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";

const DOC_PATH = "eval/experiments/exp-008-query-tools.md";
const DOC = documentTab(DOC_PATH);
const context = (sub: string): TabSpec => ({
  key: "context:eval",
  kind: "context",
  title: "eval",
  sub,
});
const SEARCH = (sub?: string): TabSpec => ({
  key: "search",
  kind: "search",
  title: "phroner",
  sub,
});
const TERMINAL: TabSpec = {
  key: "terminal:1",
  kind: "terminal",
  title: "phroner",
};
const CHAT_TAB: TabSpec = { key: "chat", kind: "conversation", title: "lophn" };

const chat: PaneInit = { tabs: [CHAT_TAB], selected: CHAT_TAB.key };
const left = (selected: TabSpec, ...others: TabSpec[]): PaneInit => ({
  tabs: [DOC, ...others],
  selected: selected.key,
});

// toast가 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다.
const NO_TIMER = { set: () => 0, clear: () => {} };

/** C1: 탭 kind 확장. 문서·Context·Search·Terminal 탭과 오른쪽 칸의 대화 탭. */
export function TabKinds() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, context("overview"), SEARCH(), TERMINAL), chat]}
    >
      <ToastStack>
        <Toast
          title="Tracking is off for phroner"
          actions={[{ id: "on", label: "Turn on" }]}
          onClose={() => {}}
          timer={NO_TIMER}
        />
      </ToastStack>
    </ProjectApp>
  );
}

/** C1b: + 메뉴를 펼친 상태. New tab → Document, Terminal, Conversation ▸, Context, Search, App panel. */
export function NewTabMenu() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, context("overview"), SEARCH(), TERMINAL), chat]}
      overlay={
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
        </div>
      }
    />
  );
}

/** C2: Context 탭 · Overview(기본 탭). */
export function ContextOverview() {
  const tab = context("overview");
  return <ProjectApp panes={[left(tab, tab, SEARCH())]} />;
}

/** C2b: Context 탭 · Contract(세부, 뒤쪽 탭). */
export function ContextContract() {
  const tab = context("contract");
  return <ProjectApp panes={[left(tab, tab, SEARCH())]} />;
}

/** C3: Context 탭 · Violations. */
export function ContextViolations() {
  const tab = context("violations");
  return <ProjectApp panes={[left(tab, tab, SEARCH())]} />;
}

/** C4: 계약 위반 toast. */
export function ViolationToast() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, context("overview"), SEARCH(), TERMINAL), chat]}
    >
      <ToastStack>
        <Toast
          title="eval: 2 documents don't match the contract"
          actions={[{ id: "view", label: "View" }]}
          onClose={() => {}}
          timer={NO_TIMER}
        />
      </ToastStack>
    </ProjectApp>
  );
}

function searchPage(search: TabSpec) {
  return (
    <ProjectApp
      panes={[left(search, context("overview"), search, TERMINAL)]}
    />
  );
}

/** C5: 선언된 검색 · table 결과(14 findings, page 이동, 링크는 객체 탭을 연다). */
export function DeclaredSearchTable() {
  return searchPage(SEARCH());
}

/** C5b: 선언된 검색 · board 결과. */
export function DeclaredSearchBoard() {
  return searchPage(SEARCH("experiments"));
}

/** C8: 접힌 sidebar = 바로 가기 rail. Contexts 단추의 tooltip이 보인다. */
export function SidebarCollapsed() {
  return (
    <ProjectApp
      sidebar={{ collapsed: true, railTooltip: "contexts" }}
      panes={[left(DOC), chat]}
    />
  );
}

/** C9: Contexts 탭. 이 project의 context 목록. */
export function ContextsTab() {
  const contexts: TabSpec = {
    key: "contexts",
    kind: "contexts",
    title: "phroner",
  };
  return <ProjectApp panes={[left(contexts, contexts)]} />;
}

/** C10: 객체 탭. 검색 결과의 Finding을 눌러 새로 열린 "F-009 · Finding". */
export function ObjectTab() {
  const finding = objectTab("finding", "F-009");
  return <ProjectApp panes={[left(finding, SEARCH(), finding)]} />;
}

/** C7: 문서 정리. 문서 행의 오른쪽 클릭 메뉴와 폴더 행의 메뉴. */
export function DocumentOrganize() {
  const menuFor = "eval/experiments/exp-012-ftb-quests-021-q8.md";
  return (
    <ProjectApp
      sidebar={{
        current: DOC_PATH,
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
      panes={[left(DOC, context("overview"), SEARCH(), TERMINAL), chat]}
      overlay={
        <div className={styles.folderMenu}>
          <p className={styles.sectionTitle}>Right-click a folder row</p>
          <StaticMenu width={180} items={[{ label: "Unlink folder" }]} />
        </div>
      }
    />
  );
}
