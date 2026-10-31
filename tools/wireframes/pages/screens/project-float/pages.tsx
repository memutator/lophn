// 떠 있는 탭(floats)과 접힌 탭. 실제 Workspace가 floats를 가진 layout을 읽어 그린다.
import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { APP_BUDGET } from "../../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import {
  type FloatSpec,
  MockDesktop,
  type PaneSpec,
  PROJECT_GROCERY,
} from "../../../mock/mock-desktop.tsx";

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
const TERM_1 = { key: "term_1", kind: "terminal", title: "grocery" } as const;
const TERM_2 = {
  key: "term_2",
  kind: "terminal",
  title: "Fix the budget total",
} as const;
const TERM_3 = {
  key: "term_3",
  kind: "terminal",
  title: "Add receipts page",
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
  { tabs: [NOTES, PLAN], selected: NOTES.key },
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
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={DOCUMENT_PANES}
      floats={[TERMINAL_FLOAT]}
      openTerminal="term_1"
    />
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
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={DOCUMENT_PANES}
      floats={STACK}
      openTerminal="term_1"
    />
  );
}

const AT = { x: 40, y: 40, width: 360, height: 240 };
const MINIMIZED: readonly FloatSpec[] = [
  { tab: README, rect: AT, minimized: true },
  { tab: TERM_2, rect: AT, minimized: true },
  { tab: PLAN, rect: AT, minimized: true },
  { tab: TERM_3, rect: AT, minimized: true },
  { tab: NOTES, rect: AT, minimized: true },
];

export function FloatMinimized() {
  return (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={[{ tabs: [LONG_NOTES], selected: LONG_NOTES.key }]}
      floats={MINIMIZED}
    />
  );
}

export function FloatOverApp() {
  return (
    <MockDesktop
      route={openProject(PROJECT_GROCERY)}
      panes={APP_PANES}
      floats={[TERMINAL_FLOAT]}
      openTerminal="term_1"
    />
  );
}
