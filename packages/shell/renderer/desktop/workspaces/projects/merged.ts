// 한 창의 목록: 이 컴퓨터와 명단의 다른 기계의 project·앱·Home을 줄로 합친다. 순수 함수라 sidebar, Home의 Workspaces panel,
// gallery가 같이 쓴다.
//
// 규칙
// - Home은 합치지 않는다: 이 컴퓨터의 "Home" 다음에 다른 기계마다 "Home · <이름>" 줄이다.
// - project는 기계를 건너는 id(`pri_`)가 같으면(`matchProjects`의 same) 한 줄이다. 줄이 여는 workspace는 이 컴퓨터에 있으면 이
//   컴퓨터의 것, 없으면 명단 순서의 첫 connected 기계의 것이다(고르는 화면 없이 한 줄을 연다). 그런 기계가 없으면 첫 기계의 것이고
//   줄은 꺼짐이다.
// - 이 컴퓨터에 없는 project는 git이면 clone하고, git이 아니면 이 컴퓨터의 project와 잇는다(`away`).
// - 앱은 id가 기계를 건너 같아 id로 한 줄이다. 여는 workspace는 project와 같은 규칙이다.
// - 보관한 project·앱은 줄이 아니다.
import {
  matchProjects,
  type ProjectKeys,
} from "../../../../../protocol/projects/identity.ts";
import type { WorkspaceRef } from "../../../shell/desk-model.ts";
import type { MachineRef } from "../../machines/scope.tsx";

/** `project.list` 줄에서 목록이 쓰는 칸. */
export interface ListedProject {
  readonly id: string;
  readonly title: string;
  readonly archived: boolean;
  readonly identity: string | null;
  readonly repo: "git" | "none" | null;
  readonly remote: { readonly key: string; readonly url: string } | null;
}

export interface ListedApp {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

/** 기계 하나의 목록. 꺼진 기계는 이 실행 동안 마지막으로 본 목록이다. */
export interface MachineLists {
  readonly machine: MachineRef;
  /** 명단의 이름. 이 컴퓨터는 빈 글이다. */
  readonly name: string;
  /** 연결되어 열 수 있다. 이 컴퓨터는 늘 true다. */
  readonly live: boolean;
  readonly projects: readonly ListedProject[];
  readonly apps: readonly ListedApp[];
}

/** 이 컴퓨터에 없는 project를 가져오는 길. 줄이 여는 기계의 project다. */
export type Away =
  /** git project. `url`이 null이면 그 기계의 저장소에 clone할 remote가 없다. */
  | {
      readonly kind: "clone";
      readonly machine: string;
      readonly identity: string;
      readonly title: string;
      readonly url: string | null;
    }
  /** git이 아닌 project. 이 컴퓨터의 git이 아닌 project에 그 id를 적어 잇는다. */
  | {
      readonly kind: "link";
      readonly machine: string;
      readonly identity: string;
      readonly title: string;
    };

/** 줄 하나가 묶은 기계 하나의 workspace. `key`는 그 기계 안의 workspace key(`home` | project id | app id)다. */
export interface Copy {
  readonly machine: MachineRef;
  readonly key: string;
}

export interface MergedWorkspace {
  /** 줄이 여는 workspace. 다른 기계의 것이면 `machine`이 있다. */
  readonly ref: WorkspaceRef;
  readonly name: string;
  /** 줄이 묶은 모든 기계의 workspace. 여는 것이 맨 앞이다. */
  readonly copies: readonly Copy[];
  /** 이 컴퓨터에 없는 project만 있다. */
  readonly away: Away | null;
  /** 여는 기계가 꺼져 있다. 줄은 흐리고 열리지 않는다. */
  readonly offline: boolean;
}

/** session이 든 workspace를 줄 key(`workspaceKey(row.ref)`)로 찾는 열쇠. */
export const copyKey = (machine: MachineRef, key: string) =>
  `${machine ?? ""}\0${key}`;

type Member<T> = { readonly list: MachineLists; readonly item: T };

// 이 컴퓨터가 있으면 그것, 없으면 연결된 첫 기계, 그것도 없으면 첫 기계.
function opener<T>(members: readonly Member<T>[]): Member<T> {
  return (
    members.find((one) => one.list.machine === null) ??
    members.find((one) => one.list.live) ??
    members[0]!
  );
}

function ordered<T>(members: readonly Member<T>[], first: Member<T>) {
  return [first, ...members.filter((one) => one !== first)];
}

const refOn = (
  machine: MachineRef,
  workspace: { kind: "project" | "app"; id: string },
): WorkspaceRef => (machine === null ? workspace : { ...workspace, machine });

function awayOf(open: Member<ListedProject>): Away | null {
  const { list, item } = open;
  if (list.machine === null || item.identity === null) return null;
  if (item.repo === "git") {
    return {
      kind: "clone",
      machine: list.machine,
      identity: item.identity,
      title: item.title,
      url: item.remote?.url ?? null,
    };
  }
  if (item.repo === "none") {
    return {
      kind: "link",
      machine: list.machine,
      identity: item.identity,
      title: item.title,
    };
  }
  return null;
}

/** `lists`는 이 컴퓨터가 맨 앞이고 그 뒤가 명단 순서다. */
export function mergeWorkspaces(
  lists: readonly MachineLists[],
  homeName: (machineName: string | null) => string,
): MergedWorkspace[] {
  const homes = lists.map(
    (list): MergedWorkspace => ({
      ref:
        list.machine === null
          ? { kind: "home" }
          : { kind: "home", machine: list.machine },
      name: homeName(list.machine === null ? null : list.name),
      copies: [{ machine: list.machine, key: "home" }],
      away: null,
      offline: !list.live,
    }),
  );

  // 기계마다 그 목록을 지금까지의 묶음(같은 `pri_`의 project들)과 맞춘다.
  const groups: Member<ListedProject>[][] = [];
  for (const list of lists) {
    const rows = list.projects.filter((item) => !item.archived);
    const keys = (items: readonly { identity: string | null }[], at: string) =>
      items.map(
        (item, index): ProjectKeys => ({
          id: `${at}${index}`,
          identity: item.identity,
          remote_key: null,
        }),
      );
    const { same } = matchProjects(
      keys(
        groups.map((group) => group[0]!.item),
        "g",
      ),
      keys(rows, "r"),
    );
    const joined = new Map<number, number>();
    for (const [left, right] of same) {
      const row = Number(right.id.slice(1));
      if (!joined.has(row)) joined.set(row, Number(left.id.slice(1)));
    }
    rows.forEach((item, index) => {
      const group = joined.get(index);
      if (group === undefined) groups.push([{ list, item }]);
      else groups[group]!.push({ list, item });
    });
  }
  const projects = groups.map((members): MergedWorkspace => {
    const open = opener(members);
    return {
      ref: refOn(open.list.machine, { kind: "project", id: open.item.id }),
      name: open.item.title,
      copies: ordered(members, open).map((one) => ({
        machine: one.list.machine,
        key: one.item.id,
      })),
      away: awayOf(open),
      offline: !open.list.live,
    };
  });

  const apps = new Map<string, Member<ListedApp>[]>();
  for (const list of lists) {
    for (const item of list.apps) {
      if (item.archived) continue;
      apps.set(item.id, [...(apps.get(item.id) ?? []), { list, item }]);
    }
  }
  const appRows = [...apps.values()].map((members): MergedWorkspace => {
    const open = opener(members);
    return {
      ref: refOn(open.list.machine, { kind: "app", id: open.item.id }),
      name: open.item.name,
      copies: ordered(members, open).map((one) => ({
        machine: one.list.machine,
        key: one.item.id,
      })),
      away: null,
      offline: !open.list.live,
    };
  });

  return [...homes, ...projects, ...appRows];
}
