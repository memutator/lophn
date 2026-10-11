// Part 2: project 화면 위의 새 설계. 모두 동작하는 ProjectApp 위에 고정 data로 놓는다.
import { Toast, ToastStack } from "@lophn/design/components";

import {
  CHAT_TAB,
  ENGINEER_TAB,
  type PaneInit,
  ProjectApp,
} from "./project-app.tsx";
import { draftTab, RELEASE_NOTES_DRAFT } from "./context-drafting.tsx";
import { documentTab, findingTab } from "./phroner-data.ts";
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

const CONTEXTS: TabSpec = {
  key: "contexts",
  kind: "contexts",
  title: "phroner",
};

const chat: PaneInit = { tabs: [CHAT_TAB], selected: CHAT_TAB.key };
const left = (selected: TabSpec, ...others: TabSpec[]): PaneInit => ({
  tabs: [DOC, ...others],
  selected: selected.key,
});

// toast가 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다.
const NO_TIMER = { set: () => 0, clear: () => {} };

/** C1: 탭 kind 확장. 문서·Context·Search·Terminal 탭과 오른쪽 칸의 Agent 탭. */
export function TabKinds() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, context("overview"), SEARCH(), TERMINAL), chat]}
    />
  );
}

/** C1b: + 메뉴를 펼친 상태. New tab → Document, Terminal, Agent ▸, Context, Search, App panel. */
export function NewTabMenu() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, context("overview"), SEARCH(), TERMINAL), chat]}
      overlay={
        <div className={styles.menus}>
          <StaticMenu
            head="New tab"
            highlighted="Agent"
            items={[
              { label: "Document" },
              { label: "Terminal" },
              { label: "Agent", more: true },
              { label: "Context" },
              { label: "Search" },
              { label: "App panel" },
            ]}
          />
          <StaticMenu
            head="Agent"
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

/** C4: 계약 위반 toast. [View]는 그 context의 Violations를 연다. */
export function ViolationToast() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, context("overview"), SEARCH(), TERMINAL), chat]}
      violationToast
    />
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
  return <ProjectApp panes={[left(CONTEXTS, CONTEXTS)]} />;
}

/** C12: Context Engineer와 대화한 뒤. release-notes의 Context 탭이 만드는 중으로 열리고 오른쪽 칸 대화가 막힌 곳을 묻는다. */
export function NewContextDrafting() {
  const draft = draftTab("release-notes", RELEASE_NOTES_DRAFT);
  return (
    <ProjectApp
      panes={[
        left(draft, CONTEXTS, draft),
        { tabs: [ENGINEER_TAB], selected: ENGINEER_TAB.key },
      ]}
    />
  );
}

/** C14: 문서 탭(새 모양). 본문이 탭 바로 아래부터 시작하고 조작은 탭 줄 오른쪽 끝 icon이다. 오류는 toast다. */
export function DocumentTabPage() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, findingTab("F-009"))]}
    >
      <ToastStack>
        <Toast
          title="This action couldn't be completed. Try again."
          tone="error"
          onClose={() => {}}
          timer={NO_TIMER}
        />
      </ToastStack>
    </ProjectApp>
  );
}

/** C15: 문서 탭에서 info를 열었다. 그 칸 오른쪽에 붙고 Contexts가 열려 있다. */
export function DocumentTabInfo() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, findingTab("F-009"))]}
      info={{ tab: DOC.key, panel: "contexts" }}
    />
  );
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
