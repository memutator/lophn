// 왼쪽 sidebar가 그리는 값. 화면은 이 값과 callback만 안다(project 창, 뒤에 Home과 app workspace가 같이 쓴다).

import type {
  Copy,
  ListedProject,
} from "../desktop/workspaces/projects/machine-workspaces.ts";
import type { SessionDot } from "../parts/agent-session/activity.ts";
import type { AgentFace } from "../parts/agent-session/agent-session.tsx";
import {
  type Desk,
  groupKey,
  membersOf,
  type TabItem,
  type WorkspaceRef,
} from "./desk-model.ts";

/**
 * session 줄의 종류. lophn agent session, 첫 메시지 전이라 아직 session이 없는 lophn Agent 탭(draft),
 * 터미널 coding agent session, 사람 차례인 workflow desk, 다른 컴퓨터에서 도는 팀원(member: 부모 줄 아래에만 선다).
 */
export type SidebarSessionKind =
  | "session"
  | "draft"
  | "terminal"
  | "workflow"
  | "member";

export interface SidebarSession {
  readonly kind: SidebarSessionKind;
  /** session id, draft는 탭 key, 터미널 key, workflow 이름. */
  readonly ref: string;
  readonly title: string;
  /** 줄 앞의 agent 아이콘. workflow desk는 vendor도 profile도 없다. 다른 컴퓨터의 팀원은 이 컴퓨터의 agent가 아니라 컴퓨터 아이콘이다. */
  readonly agent:
    | AgentFace
    | { readonly kind: "workflow" }
    | { readonly kind: "member" };
  readonly dot: SessionDot | null;
  /** 줄에 hover하면 연필(Rename)과 x(Stop)가 뜬다. draft는 이름을 둘 session이 없어 x만 뜬다. */
  readonly actions: boolean;
  /** 마지막으로 움직인 때(epoch ms). Recent 줄의 상대 시각이다. 모르면 0. */
  readonly at: number;
  /** 연필(Rename)을 두지 않는다. 다른 기계의 터미널 탭은 이름을 그 기계의 core에 쓸 수 없다. */
  readonly noRename?: true;
  /** 그 workspace 줄의 기계가 아닌 기계의 터미널(이 workspace에 연 다른 기계의 터미널 탭). 줄 끝에 그 기계의 꼬리표가 붙는다. */
  readonly machine?: string;
  /** 꺼진 기계의 줄(이 실행 동안 마지막으로 본 것). 흐리고 열리지 않는다. */
  readonly offline?: true;
  /**
   * 다른 기계의 터미널 coding agent. 줄이 자기 기계와 터미널을 들고 다니므로 열고 이름 바꾸는 쪽이 줄을 읽어 기계를 고른다
   * (줄이 여는 workspace의 기계로 짐작하지 않는다). `tab`은 이 창의 그 workspace layout에 이미 있는 탭의 key이고 없으면 null이다.
   */
  readonly remote?: {
    readonly machine: string;
    readonly terminal: string;
    readonly tab: string | null;
    readonly harness: string;
  };
  /**
   * 다른 컴퓨터에서 도는 팀원(kind member). 누르면 그 컴퓨터의 session을 그 기계를 단 탭으로 열고, x는 자리를 보관한다(`stateSeq`가
   * compare다). 상태는 pending(그 컴퓨터가 꺼졌거나 mail이 아직 닿지 않음), held(그 컴퓨터의 Inbox에서 허락을 기다림), running이다.
   */
  readonly member?: {
    readonly machine: string;
    readonly computer: string;
    readonly state: "pending" | "held" | "running";
    readonly stateSeq: string;
  };
  /** 팀(spawn tree)에서 이 줄의 자식. 같은 desk 묶음 안에 부모가 있는 session 줄이 그 부모 아래로 온다. */
  readonly children?: readonly SidebarSession[];
  /** lophn session이 주인인 탭(자기 대화 탭은 빼고). 줄을 펴면 보인다. 없으면 펼침 단추가 없다. */
  readonly tabs?: readonly SidebarTab[];
}

/** 탭의 자리. 탭 줄(group 칸 포함), 펴진 float, 접힌 float, detached. */
export type OwnedTabPlace = "tab" | "float" | "minimized" | "detached";

/** session이 주인인 탭 하나. layout 하나에서 모은 값이다. */
export interface OwnedTab {
  readonly key: string;
  readonly title: string;
  readonly kind: string;
  readonly desk: string;
  readonly place: OwnedTabPlace;
}

/** session 줄 아래의 탭 줄. 탭이 있는 workspace를 단다(session 줄과 다른 workspace일 수 있다). */
export interface SidebarTab extends OwnedTab {
  readonly workspace: WorkspaceRef;
}

/** 탭 줄의 group(bundle·split)이나 같은 workflow step으로 묶인 session 줄 묶음. 2개 이상일 때만 묶인다. */
export interface SidebarTabGroup {
  readonly kind: "group";
  /** workspace·desk 안에서 묶음을 구분하는 key. */
  readonly key: string;
  /** group 이름(없으면 대표 구성원 제목). */
  readonly label: string;
  /** 구성원들의 상태 점(waiting > working > finished > ended). */
  readonly dot: SessionDot | null;
  /** 묶음 안의 session 줄(팀 자식 tree 적용 후). */
  readonly items: readonly SidebarSession[];
}

export type SidebarDeskItem = SidebarSession | SidebarTabGroup;

/** 줄(또는 group 묶음)과 그 팀 자식 줄 전부(위에서 아래 순서). */
export const withChildren = (item: SidebarDeskItem): SidebarSession[] =>
  item.kind === "group"
    ? item.items.flatMap(withChildren)
    : [item, ...(item.children ?? []).flatMap(withChildren)];

export const sessionKey = (item: Pick<SidebarSession, "kind" | "ref">) =>
  `${item.kind}:${item.ref}`;

/** desk 안의 탭 group(`desk.groups`). sidebar가 같은 group의 session 줄을 한 묶음으로 접어 보인다. */
export interface LayoutTabGroup {
  /** desk 안에서 group을 구분하는 key(`group.groupId ?? groupKey(group)`). */
  readonly key: string;
  /** group의 이름. 없으면 대표 구성원 제목을 쓴다. */
  readonly label?: string;
  /** 탭 줄의 focus tab에 해당하는 ref(session id 또는 tab key). */
  readonly focusRef?: string;
  /** 이 group에 속한 tab key와 session id(`membersOf` 순서). */
  readonly refs: readonly string[];
}

/** desk의 `groups`에서 sidebar 묶음에 필요한 key·이름·구성원 ref 목록을 뽑는다. */
export function deskTabGroups(
  desk: Desk,
  sessionOfTab: (tab: TabItem) => string | null,
): LayoutTabGroup[] {
  if (desk.groups.length === 0) return [];
  const tabByKey = new Map(desk.tabs.map((tab) => [tab.key, tab]));
  const refForTab = (tabKey: string): string => {
    const tab = tabByKey.get(tabKey);
    const session = tab?.kind === "agent" ? sessionOfTab(tab) : null;
    return session ?? tabKey;
  };
  return desk.groups.map((group) => {
    const refs: string[] = [];
    for (const tabKey of membersOf(group.layout)) {
      refs.push(tabKey);
      const tab = tabByKey.get(tabKey);
      const session = tab?.kind === "agent" ? sessionOfTab(tab) : null;
      if (session !== null && session !== tabKey) refs.push(session);
    }
    const label = group.label?.trim();
    return {
      key: group.groupId ?? groupKey(group),
      ...(label ? { label } : {}),
      focusRef: refForTab(group.focus),
      refs,
    };
  });
}

const DOT_PRIORITY: readonly SessionDot[] = [
  "waiting",
  "working",
  "finished",
  "ended",
];

function highestDot(items: readonly SidebarSession[]): SessionDot | null {
  let best = DOT_PRIORITY.length;
  for (const one of items.flatMap(withChildren)) {
    if (one.dot === null) continue;
    const rank = DOT_PRIORITY.indexOf(one.dot);
    if (rank >= 0 && rank < best) best = rank;
  }
  return best < DOT_PRIORITY.length ? DOT_PRIORITY[best]! : null;
}

/**
 * 같은 탭 group(`desk.groups`)이나 같은 workflow step(`workflowGroupOf`)에 속한 맨 위 줄이 2개 이상이면
 * 하나의 접히는 묶음(`SidebarTabGroup`)으로 모은다. 1개뿐이면 묶지 않고 그대로 둔다.
 */
export function groupDeskSessions(input: {
  readonly roots: readonly SidebarSession[];
  readonly layoutGroups: readonly LayoutTabGroup[];
  readonly workflowGroupOf?: (
    item: SidebarSession,
  ) => { readonly key: string; readonly label: string } | null;
}): SidebarDeskItem[] {
  const { roots, layoutGroups, workflowGroupOf } = input;
  const groupByKey = new Map(layoutGroups.map((one) => [one.key, one]));
  const groupByRef = new Map<string, LayoutTabGroup>();
  for (const lg of layoutGroups) {
    for (const r of lg.refs) groupByRef.set(r, lg);
  }
  type Bucket = {
    readonly key: string;
    readonly label?: string;
    readonly focusRef?: string;
    readonly refs?: readonly string[];
    readonly items: SidebarSession[];
  };
  const buckets = new Map<string, Bucket>();
  const assigned = new Map<SidebarSession, string>();
  for (const item of roots) {
    let groupKeyForItem: string | undefined;
    let meta: LayoutTabGroup | undefined = groupByRef.get(item.ref);
    let fallbackLabel: string | undefined;
    if (meta !== undefined) {
      groupKeyForItem = meta.key;
    } else if (workflowGroupOf !== undefined) {
      const wf = workflowGroupOf(item);
      if (wf !== null) {
        meta = groupByKey.get(wf.key);
        groupKeyForItem = wf.key;
        fallbackLabel = wf.label;
      }
    }
    if (groupKeyForItem === undefined) continue;
    assigned.set(item, groupKeyForItem);
    const existing = buckets.get(groupKeyForItem);
    if (existing === undefined) {
      buckets.set(groupKeyForItem, {
        key: groupKeyForItem,
        ...(meta?.label !== undefined
          ? { label: meta.label }
          : fallbackLabel !== undefined
            ? { label: fallbackLabel }
            : {}),
        ...(meta?.focusRef === undefined ? {} : { focusRef: meta.focusRef }),
        ...(meta === undefined ? {} : { refs: meta.refs }),
        items: [item],
      });
    } else {
      existing.items.push(item);
    }
  }
  const emitted = new Set<string>();
  const result: SidebarDeskItem[] = [];
  for (const item of roots) {
    const gKey = assigned.get(item);
    if (gKey === undefined) {
      result.push(item);
      continue;
    }
    const bucket = buckets.get(gKey)!;
    if (bucket.items.length < 2) {
      result.push(item);
      continue;
    }
    if (emitted.has(gKey)) continue;
    emitted.add(gKey);
    const ordered =
      bucket.refs === undefined
        ? bucket.items
        : [...bucket.items].sort((a, b) => {
            const ia = bucket.refs!.indexOf(a.ref);
            const ib = bucket.refs!.indexOf(b.ref);
            return (
              (ia < 0 ? Number.MAX_SAFE_INTEGER : ia) -
              (ib < 0 ? Number.MAX_SAFE_INTEGER : ib)
            );
          });
    const focused =
      bucket.focusRef === undefined
        ? undefined
        : ordered.find((one) => one.ref === bucket.focusRef);
    result.push({
      kind: "group",
      key: bucket.key,
      label: bucket.label || focused?.title || ordered[0]!.title,
      dot: highestDot(ordered),
      items: ordered,
    });
  }
  return result;
}

/** current 줄을 그 탭이 있는 desk로 나눈 묶음. */
export interface SidebarDeskGroup {
  /** 줄이 속한 desk. 탭 없는 줄도 Main desk에 든다. layout을 아직 못 읽은 workspace의 묶음 하나만 null이다. */
  readonly desk: { readonly key: string; readonly label: string } | null;
  /** 팀 tree와 탭 group 묶음을 적용한 맨 위 단계 줄. 자식 줄은 `children`에 든다. */
  readonly items: readonly SidebarDeskItem[];
}

export interface SidebarCommand {
  readonly key: string;
  readonly name: string;
  readonly status: "running" | "failed" | "timed_out";
  readonly exitCode: number | null;
  /** 다른 컴퓨터(같은 `pri_`)에서 도는 명령이면 그 컴퓨터 이름. */
  readonly machineName?: string;
  readonly previewUrl: string | null;
  /** 이 창에서 선택된 탭(`selected`)과 비교할 `sessionKey`. */
  readonly selectedKey: string;
  readonly onOpen: () => void;
  readonly onRestart: () => void;
  readonly onDismiss: () => void;
  readonly onPreview?: () => void;
}

export interface SidebarWorkspace {
  readonly ref: WorkspaceRef;
  readonly name: string;
  /** 지금 열려 있거나 도는 session을 desk로 나눈 것. layout의 desk 순서다. 빈 묶음은 없다. */
  readonly current: readonly SidebarDeskGroup[];
  /** 끝났거나 닫은 session. 접힌 줄 하나로 시작한다. */
  readonly recent: readonly SidebarSession[];
  /** 같은 project인 다른 기계의 project. */
  readonly also?: readonly Copy[];
  /** project 줄의 목록 값. 다른 기계의 project를 이 컴퓨터로 가져오는 menu가 쓴다. */
  readonly listed?: ListedProject;
  /** 여는 기계가 꺼져 있다. 줄은 흐리고 열리지 않는다. */
  readonly offline?: true;
}
