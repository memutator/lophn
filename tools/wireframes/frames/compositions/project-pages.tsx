// Part 2: project 화면 위의 새 설계. 모두 동작하는 ProjectApp 위에 고정 data로 놓는다.
import { CHAT_TAB, type PaneInit, ProjectApp } from "./project-app.tsx";
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
const FILES_SEARCH: TabSpec = {
  key: "search:files",
  kind: "search",
  title: "phroner",
  sub: "files",
};
const JSON_FILE = documentTab("eval/rubrics/query-hygiene.json");
const TERMINAL: TabSpec = {
  key: "terminal:1",
  kind: "terminal",
  title: "phroner",
};

const chat: PaneInit = { tabs: [CHAT_TAB], selected: CHAT_TAB.key };
const left = (selected: TabSpec, ...others: TabSpec[]): PaneInit => ({
  tabs: [DOC, ...others],
  selected: selected.key,
});

/** 탭 kind. 문서(md)·text 파일·키워드 검색·Context·Terminal 탭과 오른쪽 칸의 Agent 탭. */
export function TabKinds() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[
        left(DOC, JSON_FILE, FILES_SEARCH, context("overview"), TERMINAL),
        chat,
      ]}
    />
  );
}

/** + 메뉴를 펼친 상태. New tab → Document, Terminal, Agent ▸, Context, Search, App panel. Agents(관리 탭)와 New context는 없다. */
export function NewTabMenu() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, FILES_SEARCH, TERMINAL), chat]}
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
              { label: "Project Manager" },
              { label: "Operator…" },
            ]}
          />
        </div>
      }
    />
  );
}

/** 접힌 sidebar = 바로 가기 rail. 위에서부터 펼치기·Terminal·Contexts·Saved views·Agent·Search이고, Search의 tooltip이 보인다. */
export function SidebarCollapsed() {
  return (
    <ProjectApp
      sidebar={{ collapsed: true, railTooltip: "search" }}
      panes={[left(DOC), chat]}
    />
  );
}

/** 문서 탭. 본문이 탭 바로 아래부터 시작하고, 조작은 탭 안 view bar에 있다(왼쪽 경로, 오른쪽 저장 상태·Edit·Info·…). 판 번호와 형식 문제 표시는 없다. */
export function DocumentTabPage() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, findingTab("F-009"))]}
    />
  );
}

/** 문서 탭에서 info를 열었다. 그 칸 오른쪽에 붙고 Info(경로·크기·바뀐 시각)와 Outline이 보인다. 탭은 Info와 Contexts 둘이다. */
export function DocumentTabInfo() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, findingTab("F-009"))]}
      info={{ tab: DOC.key, panel: "info" }}
    />
  );
}

/** 파일 tree의 평범한 파일 동작(Open·Rename·Delete). 보관·이동·폴더 연결 해제는 없어졌다. */
export { FileActionsMenu as DocumentOrganize } from "./project-files/pages.tsx";
