// Part 2: project 화면 위의 새 설계. 모두 동작하는 ProjectApp 위에 고정 data로 놓는다.
import { CHAT_TAB, type PaneInit, ProjectApp } from "./project-app.tsx";
import { documentTab, findingTab } from "../../mock/phroner-data.ts";
import type { TabSpec } from "./project-window.tsx";

const DOC_PATH = "eval/experiments/exp-008-query-tools.md";
const DOC = documentTab(DOC_PATH);
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

/** 탭 kind. 문서(md)·text 파일·키워드 검색·Terminal 탭과 Agent 탭. */
export function TabKinds() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, JSON_FILE, FILES_SEARCH, TERMINAL), chat]}
    />
  );
}

/** 편집기 탭 줄(VS Code 느낌). 바탕은 editor보다 어둡고, 고른 탭은 editor 바탕으로 이어지며 위에 강조선이 있다. 탭 사이에 구분선이 있고, 이름이 italic인 탭은 preview(Explorer 한 번 클릭), 닫기 자리에 ●가 있는 탭은 저장 안 된 변경이 있는 탭이다. 닫기 ×는 고른 탭과 hover한 탭에만 보인다. */
export function EditorTabs() {
  const notes = documentTab("docs/notes.md");
  const dirty = {
    ...documentTab("eval/rubrics/query-hygiene.json"),
    unsaved: true,
  };
  const preview = { ...documentTab("loop/findings/F-009.md"), preview: true };
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[
        {
          tabs: [DOC, preview, dirty, notes, FILES_SEARCH, TERMINAL],
          selected: DOC.key,
        },
        chat,
      ]}
    />
  );
}

/** + 메뉴를 펼친 상태. New tab → Document, Terminal, Agent ▸, Agents, Search, App panel. Agent ▸는 같은 menu가 agent 목록으로 바뀐다. Agents는 이 workspace의 Agents(관리) 탭을 연다. */
export function NewTabMenu() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, FILES_SEARCH, TERMINAL), chat]}
      newTabOpen
    />
  );
}

/** 문서 탭. 본문이 탭 바로 아래부터 시작하고, 조작은 card 머리 줄에 있다(경로, 오른쪽에 저장 상태·Info·…). 판 번호와 형식 문제 표시는 없다. */
export function DocumentTabPage() {
  return (
    <ProjectApp
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC, findingTab("F-009"))]}
    />
  );
}

/** 문서 탭에서 info를 열었다. 탭 오른쪽에 붙고 Info(경로·크기·바뀐 시각)와 Outline이 보인다. */
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
