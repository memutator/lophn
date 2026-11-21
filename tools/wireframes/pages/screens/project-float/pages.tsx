// 떠 있는 탭(floats)과 접힌 탭. 실제 Workspace가 floats를 가진 layout을 읽어 그린다. agent가 연 탭은 주인(mock/tab-owners.ts)을
// 지녀 float bar 제목 앞에 주인이 서고, 접힌 것은 주인마다 chip 하나로 묶인다.
import type { ReactNode } from "react";

import { BrowserProfilesProvider } from "../../../../../packages/shell/renderer/browser/profiles.tsx";
import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { APP_BUDGET } from "../../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import { OwnerProvider } from "../../../../../packages/shell/renderer/parts/agent-session/owner.tsx";
import {
  type FloatSpec,
  MockDesktop,
  type PaneSpec,
  PROJECT_GROCERY,
} from "../../../mock/mock-desktop.tsx";
import {
  mockOwners,
  RESEARCHER,
  REVIEWER,
  WORK_PROFILE,
} from "../../../mock/tab-owners.ts";

// gallery의 주인 표와 profile 목록. 앱에서는 session·agent 목록과 설정이 준다.
function Owned({ children }: { children: ReactNode }) {
  return (
    <OwnerProvider lookup={mockOwners}>
      <BrowserProfilesProvider profiles={[WORK_PROFILE]}>
        {children}
      </BrowserProfilesProvider>
    </OwnerProvider>
  );
}

const NOTES = {
  key: "/home/mina/Documents/grocery/notes.md",
  kind: "document_editor",
  title: "notes.md",
} as const;
const PLAN = {
  key: "/home/mina/Documents/grocery/plan.md",
  kind: "document_editor",
  title: "plan.md",
} as const;
const TERM_1 = {
  key: "term_1",
  kind: "terminal",
  title: "grocery",
  owner: RESEARCHER,
} as const;
const TERM_2 = {
  key: "term_2",
  kind: "terminal",
  title: "Fix the budget total",
  owner: RESEARCHER,
} as const;
const TERM_3 = {
  key: "term_3",
  kind: "terminal",
  title: "Add receipts page",
  owner: RESEARCHER,
} as const;
// agent(Reviewer)가 Work profile로 연 browser 탭. 탭 줄에서 주인 avatar와 profile 점이 아이콘 옆에 붙는다.
const BOARD = {
  key: "browser-board",
  kind: "browser",
  title: "Sprint board",
  url: "https://linear.app/",
  owner: REVIEWER,
  profile: WORK_PROFILE.id,
} as const;
// 고른 탭의 경로가 상단 bar 왼쪽을 길게 차지해야 접힌 칸이 셋만 남는다.
const LONG_NOTES = {
  key: "/home/mina/Documents/grocery/weekly-grocery-budget-notes.md",
  kind: "document_editor",
  title: "weekly-grocery-budget-notes.md",
} as const;
const BUDGET = {
  key: "app-panel-budget",
  kind: "app_panel",
  title: "Grocery budget",
  app: APP_BUDGET,
  screen: "home",
} as const;
const README = {
  key: "/home/mina/Documents/grocery/README.md",
  kind: "document_editor",
  title: "README.md",
} as const;

const DOCUMENT_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, PLAN, BOARD], selected: NOTES.key },
];
const APP_PANES: readonly PaneSpec[] = [
  { tabs: [BUDGET, NOTES], selected: BUDGET.key },
];

const TERMINAL_FLOAT: FloatSpec = {
  tab: TERM_1,
  rect: { x: 420, y: 240, width: 520, height: 320 },
};

export function FloatTerminal() {
  return (
    <Owned>
      <MockDesktop
        route={openProject(PROJECT_GROCERY)}
        panes={DOCUMENT_PANES}
        floats={[TERMINAL_FLOAT]}
        openTerminal="term_1"
      />
    </Owned>
  );
}

// floats 배열은 아래가 먼저라 마지막 항목이 맨 위(active)다.
const STACK: readonly FloatSpec[] = [
  {
    tab: README,
    rect: { x: 120, y: 80, width: 520, height: 320 },
  },
  {
    tab: TERM_1,
    rect: { x: 360, y: 200, width: 520, height: 320 },
  },
];

export function FloatStack() {
  return (
    <Owned>
      <MockDesktop
        route={openProject(PROJECT_GROCERY)}
        panes={DOCUMENT_PANES}
        floats={STACK}
        openTerminal="term_1"
      />
    </Owned>
  );
}

const AT = { x: 40, y: 40, width: 360, height: 240 };
const TODO = {
  key: "/home/mina/Documents/grocery/todo.md",
  kind: "document_editor",
  title: "todo.md",
} as const;
const MINIMIZED: readonly FloatSpec[] = [
  { tab: README, rect: AT, minimized: true },
  { tab: TERM_2, rect: AT, minimized: true },
  { tab: PLAN, rect: AT, minimized: true },
  { tab: TERM_3, rect: AT, minimized: true },
  { tab: { ...NOTES, owner: REVIEWER }, rect: AT, minimized: true },
  { tab: TODO, rect: AT, minimized: true },
];

export function FloatMinimized() {
  return (
    <Owned>
      <MockDesktop
        route={openProject(PROJECT_GROCERY)}
        panes={[{ tabs: [LONG_NOTES], selected: LONG_NOTES.key }]}
        floats={MINIMIZED}
      />
    </Owned>
  );
}

export function FloatOverApp() {
  return (
    <Owned>
      <MockDesktop
        route={openProject(PROJECT_GROCERY)}
        panes={APP_PANES}
        floats={[TERMINAL_FLOAT]}
        openTerminal="term_1"
      />
    </Owned>
  );
}
