// 왼쪽 sidebar의 workspace별 session 줄을 세운다. 순수 함수라 project 창과 뒤에 Home·app workspace가 같이 쓴다.
// 줄 하나의 자리(current, recent)와 순서의 규칙은 `parts/agent-session/activity.ts`이고 폰 sidebar도 그것을 쓴다.
//
// 규칙
// - current: 이 창에 탭이 열린 session, 또는 끝나지 않았고 점이 있는 session(도는 중, 기다리는 중, 못 본 turn 끝).
//   탭이 열렸는지는 workspace마다 이 창이 아는 그 workspace의 layout에서 읽는다(`openTitles`). Agent 탭은 저장하지 않아 이 창 메모리의
//   layout뿐이다: 이 창이 연 적 없는 workspace(앱을 다시 켠 뒤 처음)는 탭이 없어 도는·못 본 session만 current다. 닫기 전에는 current에 남는다.
// - lophn session은 첫 메시지를 보낼 때 생긴다. 그 전의 Agent 탭은 이 창이 보이는 workspace의 draft 줄("New session")이다.
// - recent: 나머지(끝났거나 닫았거나 가만히 있는). 이 창이 보이는 workspace에만 둔다(다른 workspace까지 두면 목록이 끝난 줄로 찬다). 최근 7일 안에 움직인 것만, 사람이 지운 줄은 그 뒤 움직이기 전까지 뺀다.
//   시각을 모르는 줄(at 0)은 7일 경계로 지우지 않는다.
// - 터미널 coding agent session의 saved 줄과 사람 차례인 workflow desk는 이 창이 보이는 workspace의 것만 온다.
//   다른 workspace는 layout에 탭이 열렸고 창의 terminal store가 agent가 지금 돈다고 아는 터미널(`otherTerminals`)이 current로 온다.
//   draft 줄도 이 창이 보이는 workspace의 것만이다(다른 workspace의 메모리 layout에 있는 새 session 탭은 줄이 없다).
// - 다른 기계의 터미널 coding agent(`remoteTerminals`)는 그 기계의 `coding_sessions/list`에서 와서 그 기계의 화면에서 시작한 것도 선다.
//   project가 든 줄에 서고 이 창에 탭이 있으면(`attached`) 그 탭의 줄이다. 같은 터미널이 위 두 길로 이미 줄이 되었으면 한 줄만 남긴다.
// - 줄의 연필·x(actions)는 lophn session과 터미널은 어느 workspace든 있다. draft는 x만, workflow desk는 없다.
// - current 줄의 순서는 고정이다: lophn session은 id 순(만든 순), draft, 그 뒤에 터미널은 key 순. 상태가 바뀌어도 자리를 지킨다.
//   draft는 첫 메시지 뒤 session 줄의 끝(가장 새 id)이 되어 자리가 거의 그대로다.
// - current는 그 탭이 있는 desk로 나눈다(layout의 desk 순서). 탭 없이 도는 줄은 Main desk 묶음에 둔다.
// - 팀(spawn tree): desk 묶음마다 부모(`spawnedBy`)가 같은 묶음에 있는 session 줄은 그 부모 줄 아래(`children`)로 간다. 부모가 다른
//   desk·workspace에 있거나 끝났으면 자기 묶음의 맨 위 단계다. 순서 규칙은 단계마다 그대로다. 묶음을 건너 옮기면 desk 묶음의 뜻이 흐려진다.
// - lophn session 줄의 `tabs`는 그 session이 주인인 탭이다(`TabItem.owner`). 이 창이 아는 모든 workspace layout에서 자리(탭 줄, float,
//   접힌 float, detached)와 상관없이 모으고 그 session의 대화 탭은 뺀다(줄 자체가 그 탭이다).
// - 줄(workspace)은 기계마다 따로다(`desktop/workspaces/projects/machine-workspaces.ts`). session은 자기 기계의 workspace 줄에 선다.
//   꺼진 기계의 session은 마지막으로 본 대로 흐리게 남는다.
// - lophn 이름(`lophn_home`, `lophn_<app id>`)은 기계마다 같은 id라 이 컴퓨터의 session에만 쓴다.
import { t } from "@lophn/i18n";

import type { CodingSession } from "../../../protocol/coding-agent/relay.ts";
import {
  codingBuiltinOf,
  isLophn,
} from "../../../protocol/lophn-agent/workspaces.ts";
import { LOPHN_AGENT_NAME } from "../../../protocol/lophn-agent/agent-values.ts";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import type { OnMachine } from "../desktop/machines/data.ts";
import type { MachineWorkspace } from "../desktop/workspaces/projects/machine-workspaces.ts";
import {
  activityDot,
  byCreated,
  byNewest,
  recentVisible,
  sessionPlace,
} from "../parts/agent-session/activity.ts";
import { codingFace } from "../parts/agent-session/coding.ts";
import { lophnSessionDot } from "../parts/agent-session/lophn.ts";
import type { SidebarAgent } from "../workspace/sidebar/sidebar-agent.ts";
import type { PanelTerminal } from "../workspace/sidebar/panel-types.ts";
import { sessionOf } from "../workspace/agent/tab-fields.ts";
import { codingFaceOf } from "../workspace/agents/coding-face.ts";
import { sessionRowTitle } from "./session-titles.ts";
import {
  MAIN_DESK,
  type TabItem,
  type WorkspaceLayout,
  workspaceKey,
  type WorkspaceRef,
} from "./desk-model.ts";
import type {
  OwnedTab,
  SidebarDeskGroup,
  SidebarSession,
  SidebarTab,
  SidebarWorkspace,
} from "./left-sidebar-model.ts";

// lophn의 기본 얼굴(core의 `LOPHN_PROFILE`과 같다).
const LOPHN_FACE = {
  kind: "character",
  shape: "square",
  color: "coral",
} as const;

/** session id → 제목과 마지막 활동 시각(epoch ms). agent의 session 목록에서 읽은 것이다. */
export type KnownSessions = ReadonlyMap<
  string,
  { readonly title: string | null; readonly at: number }
>;

/** 다른 기계(`machine`)의 터미널에서 도는 coding agent. */
export type RemoteTerminal = CodingSession & { readonly machine: string };

/**
 * workspace layout의 desk와, 줄이 가리키는 것(탭 key, Agent 탭의 session id, `workflow:<이름>`)이 있는 desk의 key.
 * `owned`는 session id → 그 session이 주인인 탭(그 session의 대화 탭은 빼고)이다.
 */
export interface LayoutDesks {
  readonly list: readonly { readonly key: string; readonly label: string }[];
  readonly at: ReadonlyMap<string, string>;
  readonly owned: ReadonlyMap<string, readonly OwnedTab[]>;
}

export function layoutDesks(layout: WorkspaceLayout): LayoutDesks {
  const list: { key: string; label: string }[] = [];
  const at = new Map<string, string>();
  const owned = new Map<string, OwnedTab[]>();
  for (const desk of Object.values(layout.desks)) {
    list.push({ key: desk.key, label: desk.label });
    if (desk.workflow !== undefined)
      at.set(`workflow:${desk.workflow}`, desk.key);
    const places: { tab: TabItem; place: OwnedTab["place"] }[] = [
      ...desk.tabs.map((tab) => ({ tab, place: "tab" as const })),
      ...desk.floats.map((item) => ({
        tab: item.tab,
        place: item.minimized ? ("minimized" as const) : ("float" as const),
      })),
      ...desk.detached.map((item) => ({
        tab: item.tab,
        place: "detached" as const,
      })),
    ];
    for (const { tab, place } of places) {
      at.set(tab.key, desk.key);
      const session = tab.kind === "agent" ? sessionOf(tab) : null;
      if (session !== null) at.set(session, desk.key);
      if (tab.owner === undefined || tab.owner === session) continue;
      owned.set(tab.owner, [
        ...(owned.get(tab.owner) ?? []),
        {
          key: tab.key,
          title: tab.title,
          kind: tab.kind,
          desk: desk.key,
          place,
        },
      ]);
    }
  }
  return { list, at, owned };
}

/** 사람이 Recent에서 지운 줄의 key → 지운 때(epoch ms). */
export type HiddenRecent = ReadonlyMap<string, number>;

export interface WorkspacesInput {
  readonly now: number;
  /** 이 창이 보이는 workspace. */
  readonly current: WorkspaceRef;
  /** 기계마다의 줄(Home, project, 앱). */
  readonly rows: readonly MachineWorkspace[];
  /** 모든 기계의 session. */
  readonly entries: readonly OnMachine<SessionEntry>[];
  /** 꺼진 기계. 그 session은 마지막으로 본 줄이다. */
  readonly offline: ReadonlySet<string>;
  readonly agents: readonly SidebarAgent[];
  /** 이 컴퓨터의 lophn agent id → 이름. 다른 workspace의 lophn 이름이다. */
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
  /** 다른 기계의 터미널 coding agent. 그 기계의 화면에서 시작한 것도 든다. */
  readonly remoteTerminals: readonly RemoteTerminal[];
  /** workspace key → 터미널 참조 → 그 workspace의 layout에 열린 그 터미널의 탭 key. */
  readonly attached: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** 이 창이 보이는 workspace에서 사람 차례를 기다리는 workflow 이름. */
  readonly workflows: readonly string[];
  readonly hidden: HiddenRecent;
}

export function sidebarWorkspaces(input: WorkspacesInput): SidebarWorkspace[] {
  const here = workspaceKey(input.current);
  const agents = new Map(
    input.agents.map((agent) => [agent.assignment, agent]),
  );
  // 다른 workspace나 다른 기계의 agent 목록은 읽지 않았다. 내장 coding agent는 제품 아이콘으로, 그 밖은 이 workspace의 lophn 얼굴로
  // 보인다. 이 workspace의 목록을 아직 못 읽었으면(다른 기계의 workspace를 처음 열었다) lophn의 기본 얼굴이다. 목록에 없다고 줄을
  // 빼지 않는다: 도는 session이 지금 보는 workspace에 따라 사라졌다.
  const lophnRow = input.agents.find((agent) => isLophn(agent.assignment)) ?? {
    assignment: "",
    name: LOPHN_AGENT_NAME,
    profile: LOPHN_FACE,
    waiting: false,
  };
  const agentOf = (id: string): SidebarAgent => {
    const known = agents.get(id);
    if (known !== undefined) return known;
    const coding = codingBuiltinOf(id);
    if (coding !== null) {
      const face = codingFaceOf(id);
      if (face !== undefined) {
        return {
          assignment: id,
          name: coding.label,
          profile: face,
          waiting: false,
        };
      }
    }
    return lophnRow;
  };
  // 기계의 workspace → 그 줄.
  const copyKey = (machine: string | null, key: string) =>
    `${machine ?? ""}\0${key}`;
  const rowOf = new Map<string, MachineWorkspace>();
  const byKey = new Map(input.rows.map((row) => [workspaceKey(row.ref), row]));
  for (const row of input.rows) {
    rowOf.set(
      copyKey(
        row.ref.machine ?? null,
        row.ref.kind === "home" ? "home" : row.ref.id,
      ),
      row,
    );
  }
  // session id → 그 session이 주인인 탭. 이 창이 아는 모든 workspace의 layout에서 모은다.
  const owned = new Map<string, SidebarTab[]>();
  for (const [key, desks] of input.desks) {
    const ref = byKey.get(key)?.ref;
    if (ref === undefined) continue;
    for (const [session, tabs] of desks.owned) {
      owned.set(session, [
        ...(owned.get(session) ?? []),
        ...tabs.map((tab) => ({ ...tab, workspace: ref })),
      ]);
    }
  }
  const spawnedBy = new Map(
    input.entries.map((entry) => [entry.session, entry.spawnedBy]),
  );
  const current = new Map<string, SidebarSession[]>();
  const recent = new Map<string, SidebarSession[]>();
  const add = (
    map: Map<string, SidebarSession[]>,
    workspace: string,
    item: SidebarSession,
  ) => map.set(workspace, [...(map.get(workspace) ?? []), item]);

  for (const entry of input.entries) {
    const row = rowOf.get(
      copyKey(entry.machine, entry.workspace?.id ?? "home"),
    );
    if (row === undefined || entry.archived) continue;
    const own = workspaceKey(row.ref);
    // 탭을 다른 workspace로 옮겼으면 줄도 탭이 있는 workspace 아래다. 자기 workspace에도 탭이 있으면 자기 자리다.
    const moved = input.openTitles.get(own)?.has(entry.session)
      ? undefined
      : [...input.openTitles].find(
          ([key, open]) => open.has(entry.session) && byKey.has(key),
        )?.[0];
    const workspace = moved ?? own;
    const shownOn = moved === undefined ? row : byKey.get(moved)!;
    if (entry.agent === null) continue;
    const agent = agentOf(entry.agent);
    // 줄이 선 workspace의 기계가 아닌 session은 그 기계의 꼬리표를 달고 그 기계를 단 탭으로 열린다.
    const machine =
      entry.machine === (shownOn.ref.machine ?? null) || entry.machine === null
        ? {}
        : { machine: entry.machine };
    const offline =
      entry.machine !== null && input.offline.has(entry.machine)
        ? { offline: true as const }
        : {};
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
          (entry.agent === null || entry.machine !== null
            ? ""
            : input.lophnNames[entry.agent]) || agent.name,
        untitled: t("left-sidebar.label.untitled"),
      }),
      agent: { kind: "lophn", profile: agent.profile },
      dot,
      actions: offline.offline === undefined,
      at: read?.at ?? 0,
      ...machine,
      ...offline,
    };
    const place = sessionPlace({
      dot,
      open: tabTitle !== undefined,
      at: item.at,
      now: input.now,
      hiddenAt: input.hidden.get(entry.session),
    });
    const tabs = owned.get(entry.session);
    if (place === "current") {
      add(current, workspace, tabs === undefined ? item : { ...item, tabs });
    } else if (place === "recent" && workspace === here)
      add(recent, here, item);
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
      ...(terminal.machine === undefined ? {} : { machine: terminal.machine }),
      ...(terminal.machine === undefined && input.current.machine === undefined
        ? {}
        : { noRename: true as const }),
    };
    if (terminal.live !== null) add(current, here, item);
    else if (
      recentVisible(item.at, input.now, input.hidden.get(terminal.key))
    ) {
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
        ...(terminal.machine === undefined
          ? {}
          : { machine: terminal.machine }),
      });
    }
  }

  // 같은 터미널이 위 두 길로 이미 줄이 되었으면 다른 기계의 목록에서는 더하지 않는다.
  const shown = new Set([
    ...input.terminals.flatMap((one) =>
      one.live === null || one.terminalRef === undefined
        ? []
        : [one.terminalRef],
    ),
    ...[...input.otherTerminals.values()].flatMap((list) =>
      list.flatMap((one) =>
        one.terminalRef === undefined ? [] : [one.terminalRef],
      ),
    ),
  ]);
  for (const terminal of input.remoteTerminals) {
    const row = rowOf.get(copyKey(terminal.machine, terminal.project));
    if (row === undefined || shown.has(terminal.terminal)) continue;
    const workspace = workspaceKey(row.ref);
    const tab = input.attached.get(workspace)?.get(terminal.terminal) ?? null;
    add(current, workspace, {
      kind: "terminal",
      ref: tab ?? terminal.terminal,
      title: terminal.title ?? terminal.label,
      agent: codingFace(terminal.harness),
      dot: activityDot({
        state: terminal.state,
        unseen: false,
        ended: false,
      }),
      // 이름 바꾸기와 닫기는 그 기계의 입력 허락이 있어야 한다. 이 줄은 보기와 열기만 한다.
      actions: false,
      at: Date.parse(terminal.last_active_at ?? "") || 0,
      ...(input.offline.has(terminal.machine)
        ? { offline: true as const }
        : {}),
      remote: {
        machine: terminal.machine,
        terminal: terminal.terminal,
        tab,
        harness: terminal.harness,
      },
    });
  }

  // 부모가 같은 묶음에 있는 session 줄을 그 부모 아래로 옮긴다. `items`의 순서를 단계마다 지킨다.
  const teamTree = (items: readonly SidebarSession[]): SidebarSession[] => {
    const inGroup = new Set(
      items.flatMap((item) => (item.kind === "session" ? [item.ref] : [])),
    );
    const parentOf = (item: SidebarSession) => {
      const parent =
        item.kind === "session" ? spawnedBy.get(item.ref) : undefined;
      return parent != null && inGroup.has(parent) ? parent : null;
    };
    const children = new Map<string, SidebarSession[]>();
    for (const item of items) {
      const parent = parentOf(item);
      if (parent !== null)
        children.set(parent, [...(children.get(parent) ?? []), item]);
    }
    const grow = (item: SidebarSession): SidebarSession => {
      const kids = item.kind === "session" ? children.get(item.ref) : undefined;
      return kids === undefined ? item : { ...item, children: kids.map(grow) };
    };
    return items.filter((item) => parentOf(item) === null).map(grow);
  };

  // 종류 안에서는 만든 순이다. 새 줄은 끝에 붙고 다시 시작해도 같다.
  const order = { session: 0, draft: 1, terminal: 2, workflow: 3 };
  const stable = (a: SidebarSession, b: SidebarSession) =>
    a.kind === b.kind ? byCreated(a.ref, b.ref) : order[a.kind] - order[b.kind];
  const workspace = (row: MachineWorkspace): SidebarWorkspace => {
    const { ref, name } = row;
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
      current: groups
        .filter((group) => group.items.length > 0)
        .map((group) => ({ ...group, items: teamTree(group.items) })),
      recent: (recent.get(key) ?? []).sort(byNewest),
      also: row.also,
      ...(row.listed === undefined ? {} : { listed: row.listed }),
      ...(row.offline ? { offline: true as const } : {}),
    };
  };

  return input.rows.map(workspace);
}

/** Home 줄의 이름. 이 컴퓨터는 "Home", 다른 기계는 "Home · <이름>"이다. */
export const homeName = (machineName: string | null) =>
  machineName === null
    ? t("left-sidebar.label.home")
    : t("left-sidebar.label.home-on", { machine: machineName });
