// 계약 위반 toast를 누르면 그 project의 Project Manager session으로 간다. reaction이 이미 연 session이 있으면
// 그 session의 Agent 탭을 고르고, 없으면 위반을 context chip으로 붙인 새 session 탭을 연다. 아무것도 보내지 않는다.
import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import type { ContextChipView } from "../../conversation/composer/agent-composer.tsx";
import { violationChips } from "../contexts/context-violations-model.ts";
import { openAgent } from "../kinds/agent.tsx";
import type { TabHost } from "../kinds/host.ts";
import { agentByRole } from "../sidebar/panel-sessions.ts";
import type { SidebarAgent } from "../sidebar/sidebar-agent.ts";

/** 열 때의 최신 값. 위반을 읽는 동안 작업대가 바뀌므로 값이 아니라 읽는 함수로 받는다. */
export interface ProjectManagerEnv {
  readonly project: string;
  readonly host: () => TabHost;
  readonly sessions: () => readonly SessionEntry[];
  readonly agents: () => readonly SidebarAgent[];
}

/**
 * 이 project의 열린 Project Manager session 가운데 가장 최근 것. session 정보에 reaction의 근거 seq가 없어서
 * 그 위반의 reaction이 연 session을 정확히 가리지 못한다.
 */
function openedSession(
  entries: readonly SessionEntry[],
  project: string,
): string | null {
  const found = entries.filter((entry) =>
    entry.ended === null && entry.agent?.role === "project_manager" &&
    entry.agent.project === project
  );
  return found.length === 0 ? null : found[found.length - 1].session;
}

/** toast가 가리키는 context의 위반 전부. 읽지 못하거나 없으면 context 하나만 붙인다. */
async function contextChips(
  host: TabHost,
  context: string,
  check: string,
): Promise<readonly ContextChipView[]> {
  const label = host.contexts?.titleOf(context) ?? context;
  const read = await host.contexts?.source.violations(context);
  if (read === undefined || !read.ok || read.value.violations.length === 0) {
    return [{ id: check, label }];
  }
  return violationChips(label, read.value.violations);
}

/** Project Manager를 열 수 있으면 true. 새 session 탭은 위반을 읽은 뒤에 연다. */
export function openProjectManager(
  env: ProjectManagerEnv,
  violation: { readonly context: string; readonly check: string },
): boolean {
  const row = agentByRole(env.agents(), "project_manager");
  if (row === undefined || env.host().agentView === null) return false;
  const session = openedSession(env.sessions(), env.project);
  if (session !== null) {
    openAgent(env.host(), { agent: row.assignment, name: row.name, session });
    return true;
  }
  void contextChips(env.host(), violation.context, violation.check).then(
    (chips) =>
      openAgent(env.host(), { agent: row.assignment, name: row.name, chips }),
  );
  return true;
}
