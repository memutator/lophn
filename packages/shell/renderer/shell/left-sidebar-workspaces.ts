// 왼쪽 sidebar의 workspace별 session 줄을 세운다. 순수 함수라 project 창과 뒤에 Home·app workspace가 같이 쓴다.
//
// 규칙
// - current: 이 창에 탭이 열린 session, 또는 끝나지 않았고 점이 있는 session(도는 중, 기다리는 중, 못 본 turn 끝).
//   탭이 열렸는지는 workspace마다 이 창이 아는 그 workspace의 layout에서 읽는다(`openTitles`). Agent 탭은 저장하지 않아 이 창 메모리의
//   layout뿐이다: 이 창이 연 적 없는 workspace(앱을 다시 켠 뒤 처음)는 탭이 없어 도는·못 본 session만 current다. 닫기 전에는 current에 남는다.
// - lophn session은 첫 메시지를 보낼 때 생긴다. 그 전의 Agent 탭은 이 창이 보이는 workspace의 draft 줄("New session")이다.
// - recent: 나머지(끝났거나 닫았거나 가만히 있는). 이 창이 보이는 workspace에만 둔다. 최근 7일 안에 움직인 것만, 사람이 지운 줄은 그 뒤 움직이기 전까지 뺀다.
//   시각을 모르는 줄(at 0)은 7일 경계로 지우지 않는다.
// - 터미널 coding agent session의 saved 줄과 사람 차례인 workflow desk는 이 창이 보이는 workspace의 것만 온다.
//   다른 workspace는 layout에 탭이 열렸고 창의 terminal store가 agent가 지금 돈다고 아는 터미널(`otherTerminals`)이 current로 온다.
//   draft 줄도 이 창이 보이는 workspace의 것만이다(다른 workspace의 메모리 layout에 있는 새 session 탭은 줄이 없다).
// - 줄의 연필·x(actions)는 lophn session과 터미널은 어느 workspace든 있다. draft는 x만, workflow desk는 없다.
// - current 줄의 순서는 고정이다: lophn session은 id 순(만든 순), draft, 그 뒤에 터미널은 key 순. 상태가 바뀌어도 자리를 지킨다.
//   draft는 첫 메시지 뒤 session 줄의 끝(가장 새 id)이 되어 자리가 거의 그대로다.
// - current는 그 탭이 있는 desk로 나눈다(layout의 desk 순서). 탭 없이 도는 줄은 Main desk 묶음에 둔다.
import { t } from "@lophn/i18n";

import { isLophn } from "../../../protocol/lophn-agent/workspaces.ts";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import { codingFace } from "../parts/agent-session/coding.ts";
import { lophnSessionDot } from "../parts/agent-session/lophn.ts";
import type { SidebarAgent } from "../workspace/sidebar/sidebar-agent.ts";
import type { PanelTerminal } from "../workspace/sidebar/panel-types.ts";
import { sessionOf } from "../workspace/agent/tab-fields.ts";
import { sessionRowTitle } from "./session-titles.ts";
import {
  deskTabs,
  MAIN_DESK,
  type WorkspaceLayout,
  workspaceKey,
  type WorkspaceRef,
} from "./desk-model.ts";
import type {
  SidebarDeskGroup,
  SidebarWorkspace,
  SidebarSession,
} from "./left-sidebar-model.ts";

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** session id → 제목과 마지막 활동 시각(epoch ms). agent의 session 목록에서 읽은 것이다. */
export type KnownSessions = ReadonlyMap<
  string,
  { readonly title: string | null; readonly at: number }
>;

/** workspace layout의 desk와, 줄이 가리키는 것(탭 key, Agent 탭의 session id, `workflow:<이름>`)이 있는 desk의 key. */
export interface LayoutDesks {
  readonly list: readonly { readonly key: string; readonly label: string }[];
  readonly at: ReadonlyMap<string, string>;
}

export function layoutDesks(layout: WorkspaceLayout): LayoutDesks {
  const list: { key: string; label: string }[] = [];
  const at = new Map<string, string>();
  for (const desk of Object.values(layout.desks)) {
    list.push({ key: desk.key, label: desk.label });
    if (desk.workflow !== undefined)
      at.set(`workflow:${desk.workflow}`, desk.key);
    for (const tab of deskTabs(desk)) {
      at.set(tab.key, desk.key);
      const session = tab.kind === "agent" ? sessionOf(tab) : null;
      if (session !== null) at.set(session, desk.key);
    }
  }
  return { list, at };
}

/** 사람이 Recent에서 지운 줄의 key → 지운 때(epoch ms). */
export type HiddenRecent = ReadonlyMap<string, number>;

export interface WorkspacesInput {
  readonly now: number;
  /** 이 창이 보이는 workspace. */
  readonly current: WorkspaceRef;
  readonly projects: readonly { readonly id: string; readonly title: string }[];
  readonly apps: readonly { readonly id: string; readonly name: string }[];
  readonly entries: readonly SessionEntry[];
  readonly agents: readonly SidebarAgent[];
  /** lophn agent id → 이름. 다른 workspace의 lophn 이름이다. */
  readonly lophnNames: Readonly<Record<string, string>>;
  readonly known: KnownSessions;
  /** workspace key → 이 창이 아는 그 workspace의 layout에 탭이 열린 session id → 그 탭의 제목. 열렸는지만 본다. */
  readonly openTitles: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** workspace key → 그 workspace layout의 desk. 없으면 그 workspace의 줄은 desk 없는 묶음 하나다. */
  readonly desks: ReadonlyMap<string, LayoutDesks>;
  /** 이 창의 아직 session이 없는 Agent 탭. */
  readonly drafts: readonly { readonly key: string; readonly agent: string }[];
  /** 이 창이 보이는 workspace의 터미널 coding agent session. */
  readonly terminals: readonly PanelTerminal[];
  /** workspace key → 그 workspace의 layout에 탭이 열렸고 agent가 지금 도는 터미널(이 창이 보이지 않는 workspace). */
  readonly otherTerminals: ReadonlyMap<string, readonly PanelTerminal[]>;
  /** 이 창이 보이는 workspace에서 사람 차례를 기다리는 workflow 이름. */
  readonly workflows: readonly string[];
  readonly hidden: HiddenRecent;
}

const workspaceKeyOfEntry = (entry: SessionEntry) =>
  entry.workspace === null ? "home" : entry.workspace.id;

function recentVisible(
  key: string,
  at: number,
  hidden: HiddenRecent,
  now: number,
): boolean {
  const hiddenAt = hidden.get(key);
  if (hiddenAt !== undefined && at <= hiddenAt) return false;
  return at === 0 || now - at <= RECENT_WINDOW_MS;
}

export function sidebarWorkspaces(input: WorkspacesInput): SidebarWorkspace[] {
  const here = workspaceKey(input.current);
  const agents = new Map(
    input.agents.map((agent) => [agent.assignment, agent]),
  );
  // 다른 workspace의 session은 그 workspace의 lophn이 한다. 이 workspace의 목록에는 없어도 lophn의 얼굴은 같다(profile이 고정이다).
  const lophnRow = input.agents.find((agent) => isLophn(agent.assignment));
  const agentOf = (id: string) =>
    agents.get(id) ?? (isLophn(id) ? lophnRow : undefined);
  const current = new Map<string, SidebarSession[]>();
  const recent = new Map<string, SidebarSession[]>();
  const add = (
    map: Map<string, SidebarSession[]>,
    workspace: string,
    item: SidebarSession,
  ) => map.set(workspace, [...(map.get(workspace) ?? []), item]);

  for (const entry of input.entries) {
    const agent = entry.agent === null ? undefined : agentOf(entry.agent);
    if (agent === undefined || entry.archived) continue;
    const workspace = workspaceKeyOfEntry(entry);
    const read = input.known.get(entry.session);
    const tabTitle = input.openTitles.get(workspace)?.get(entry.session);
    const dot = lophnSessionDot(input.entries, entry.session);
    const item: SidebarSession = {
      kind: "session",
      ref: entry.session,
      // 이름은 session 제목이다. 탭 제목은 쓰지 않는다: 그려지기 전의 탭은 agent 이름이라, 탭을
      // 따르면 고르지 않은 session이 agent 이름으로 보인다. 제목이 아직 없는 열린 session만 탭 줄처럼 agent 이름이다.
      title: sessionRowTitle({
        title: read?.title,
        open: tabTitle !== undefined,
        agentName:
          (entry.agent === null ? "" : input.lophnNames[entry.agent]) ||
          agent.name,
        untitled: t("left-sidebar.label.untitled"),
      }),
      agent: { kind: "lophn", profile: agent.profile },
      dot,
      actions: true,
      at: read?.at ?? 0,
    };
    if (tabTitle !== undefined || (dot !== null && dot !== "ended")) {
      add(current, workspace, item);
    } else if (recentVisible(entry.session, item.at, input.hidden, input.now)) {
      add(recent, workspace, item);
    }
  }

  for (const draft of input.drafts) {
    const agent = agents.get(draft.agent);
    if (agent === undefined) continue;
    add(current, here, {
      kind: "draft",
      ref: draft.key,
      title: t("left-sidebar.label.new-session"),
      agent: { kind: "lophn", profile: agent.profile },
      dot: null,
      actions: true,
      at: 0,
    });
  }

  for (const terminal of input.terminals) {
    const item: SidebarSession = {
      kind: "terminal",
      ref: terminal.key,
      title: terminal.title,
      agent: codingFace(terminal.harness),
      dot: terminal.dot,
      actions: true,
      at: terminal.at,
    };
    if (terminal.live !== null) add(current, here, item);
    else if (recentVisible(terminal.key, item.at, input.hidden, input.now)) {
      add(recent, here, item);
    }
  }

  for (const [workspace, terminals] of input.otherTerminals) {
    for (const terminal of terminals) {
      add(current, workspace, {
        kind: "terminal",
        ref: terminal.key,
        title: terminal.title,
        agent: codingFace(terminal.harness),
        dot: terminal.dot,
        actions: true,
        at: 0,
      });
    }
  }

  const byNewest = (a: SidebarSession, b: SidebarSession) => b.at - a.at;
  // session id는 시각 순이라 만든 순이 된다. 새 줄은 끝에 붙고 다시 시작해도 같다.
  const order = { session: 0, draft: 1, terminal: 2, workflow: 3 };
  const stable = (a: SidebarSession, b: SidebarSession) =>
    a.kind === b.kind
      ? a.ref < b.ref
        ? -1
        : a.ref > b.ref
          ? 1
          : 0
      : order[a.kind] - order[b.kind];
  const workspace = (ref: WorkspaceRef, name: string): SidebarWorkspace => {
    const key = workspaceKey(ref);
    const waiting: SidebarSession[] =
      key === here
        ? input.workflows.map((workflow) => ({
            kind: "workflow",
            ref: workflow,
            title: workflow,
            agent: { kind: "workflow" },
            dot: "waiting",
            actions: false,
            at: 0,
          }))
        : [];
    const items = [...waiting, ...(current.get(key) ?? []).sort(stable)];
    const desks = input.desks.get(key);
    // 탭이 없는 줄(host 요청을 잃었거나 사람이 안 보고 닫은 것)은 Main desk의 줄과 같이 둔다. "탭 없음" 묶음은 없다.
    const main = desks?.list.find((desk) => desk.key === MAIN_DESK);
    const deskOf = (item: SidebarSession) =>
      desks?.at.get(
        item.kind === "workflow" ? `workflow:${item.ref}` : item.ref,
      ) ??
      main?.key ??
      null;
    // layout을 아직 못 읽은 workspace는 desk 이름 없는 묶음 하나다(묶음이 하나면 이름 줄을 그리지 않는다).
    const groups: SidebarDeskGroup[] =
      desks === undefined || desks.list.length === 0
        ? [{ desk: null, items }]
        : desks.list.map((desk) => ({
            desk,
            items: items.filter((item) => deskOf(item) === desk.key),
          }));
    return {
      ref,
      name,
      current: groups.filter((group) => group.items.length > 0),
      recent: key === here ? (recent.get(key) ?? []).sort(byNewest) : [],
    };
  };

  return [
    workspace({ kind: "home" }, t("left-sidebar.label.home")),
    ...input.projects.map((item) =>
      workspace({ kind: "project", id: item.id }, item.title),
    ),
    ...input.apps.map((item) =>
      workspace({ kind: "app", id: item.id }, item.name),
    ),
  ];
}
