// context 화면의 gallery page. 모두 동작하는 ProjectApp 위에 고정 data로 놓는다. 탭을 열면(ProjectHost) 그 탭이 든 칸으로 다시 시작한다.
import { ContextBody, type SubTab } from "../context-body.tsx";
import type { GlossaryDemo } from "./glossary.tsx";
import type { PaneInit } from "../project-app.tsx";
import { contextTab, documentTab } from "../phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";
import { ContextHead, contextsTab } from "./contexts-list.tsx";
import { declaredSearchTab } from "./declared-search.tsx";
import { ProjectHost } from "./host.tsx";
import { useOpenTab } from "./open-tab.ts";
import { pmNewTab, pmWorkingTab } from "./pm-session.tsx";
import { ViolationToast } from "./violation-toast.tsx";

const DOC_PATH = "eval/experiments/exp-008-query-tools.md";
const DOC = documentTab(DOC_PATH);

// 문서 탭 하나 뒤에 이 탭들을 열고 selected를 고른 한 칸.
const left = (selected: TabSpec, ...others: TabSpec[]): PaneInit => ({
  tabs: [DOC, ...others],
  selected: selected.key,
});

// 둘째 칸에 이 탭 하나를 연 모양(open(tab, true)가 여는 칸).
const right = (tab: TabSpec): PaneInit => ({
  tabs: [tab],
  selected: tab.key,
});

// Context 탭 본문을 직접 준다. 여기서 여는 탭(위반 목록의 [Send to …], 검색)도 ProjectHost를 거치게 한다.
interface EvalOptions {
  readonly glossaryDemo?: GlossaryDemo;
}

function HostedContext(
  { initial, ...options }: { initial: SubTab } & EvalOptions,
) {
  const open = useOpenTab();
  return <ContextBody name="eval" initial={initial} open={open} {...options} />;
}

const evalTab = (initial: SubTab, options: EvalOptions = {}): TabSpec => ({
  ...contextTab("eval", initial),
  body: <HostedContext initial={initial} {...options} />,
});

function contextPage(sub: SubTab, options: EvalOptions = {}) {
  const tab = evalTab(sub, options);
  return <ProjectHost panes={[left(tab, tab)]} />;
}

// renderer의 Context 탭 본문(`ContextTabBody`)을 fake 통로로 그린 탭.
function headPage(options: { versions?: boolean; restore?: boolean }) {
  const tab: TabSpec = {
    ...contextTab("eval", "overview"),
    body: <ContextHead {...options} />,
  };
  return <ProjectHost panes={[left(tab, tab)]} />;
}

/** Contexts 탭. 카드마다 [Open]과 [Archive]. [New context]가 없다. */
export function ContextsTabPage() {
  const tab = contextsTab();
  return <ProjectHost panes={[left(tab, tab)]} />;
}

/** Contexts 탭에서 보관한 context를 펼친 상태. */
export function ContextsArchivedPage() {
  const tab = contextsTab(true);
  return <ProjectHost panes={[left(tab, tab)]} />;
}

/** Context 탭 · Overview(처음 보이는 하위 탭). */
export const ContextOverviewPage = () => contextPage("overview");
/** Context 탭 · 선언된 검색과 saved view. */
export const ContextSearchesPage = () => contextPage("search");
/** Context 탭 · 위반 목록. 각 줄과 위 [Send all …]이 Project Manager에게 넘긴다. */
export const ContextViolationsPage = () => contextPage("violations");
/** Context 탭 · 용어집. 사람이 용어를 더하고, 고치고, 지운다. */
export const ContextGlossaryPage = () => contextPage("glossary");
/** 용어집 · [Add term]을 눌러 새 용어 form이 열린 상태. */
export const ContextGlossaryAddPage = () =>
  contextPage("glossary", { glossaryDemo: "add" });
/** 용어집 · 한 줄의 [Edit]을 눌러 그 줄이 form으로 바뀐 상태. */
export const ContextGlossaryEditPage = () =>
  contextPage("glossary", { glossaryDemo: "edit" });
/** 용어집 · [Delete]를 눌러 화면 가운데에 지우기 확인이 뜬 상태. */
export const ContextGlossaryDeletePage = () =>
  contextPage("glossary", { glossaryDemo: "delete" });
/** Context 탭 · Contract(세부, 뒤쪽 탭). */
export const ContextContractPage = () => contextPage("contract");

/** Context 탭 머리의 판 목록을 펼친 상태. 옛 판 줄의 [Restore]로 되돌린다. */
export const ContextVersionsPage = () => headPage({ versions: true });
/** 옛 판(r2)으로 되돌린 직후. 탭 위쪽에 toast가 뜨고 머리의 판이 바뀐다. */
export const ContextRestoredPage = () => headPage({ restore: true });

/** 위반 toast. 문서 탭을 보고 있어도 창 위에 뜬다. */
export function ViolationToastPage() {
  return (
    <ProjectHost
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC)]}
    >
      <ViolationToast />
    </ProjectHost>
  );
}

/** [Ask Project Manager]를 누른 뒤, reaction이 꺼져 있어 새로 연 session. 위반 chip이 붙고 입력칸은 비어 있다. */
export function ViolationSessionNewPage() {
  return (
    <ProjectHost
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC), right(pmNewTab())]}
    />
  );
}

/** [Ask Project Manager]를 누른 뒤, reaction이 이미 연 session. Project Manager가 위반을 받아 일하는 대화다. */
export function ViolationSessionOpenPage() {
  return (
    <ProjectHost
      sidebar={{ current: DOC_PATH }}
      panes={[left(DOC), right(pmWorkingTab())]}
    />
  );
}

function searchPage(initial: "findings" | "experiments") {
  const search = declaredSearchTab(initial);
  const ctx = evalTab("overview");
  return <ProjectHost panes={[left(search, ctx, search)]} />;
}

/** 선언된 검색 · table 결과(14 findings, page 이동, 링크는 객체 탭을 연다). */
export const DeclaredSearchTablePage = () => searchPage("findings");
/** 선언된 검색 · board 결과. */
export const DeclaredSearchBoardPage = () => searchPage("experiments");
