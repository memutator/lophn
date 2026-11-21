// 한 창의 목록: 이 컴퓨터와 명단의 다른 기계의 project·앱·Home을 기계마다 줄로 세운다. 순수 함수라 sidebar, Home의
// Workspaces panel, palette, gallery가 같이 쓴다.
//
// 규칙
// - 줄은 기계를 건너 합치지 않는다. 기계마다 Home, project, 앱 순서이고 이 컴퓨터가 맨 앞이다. sidebar는 기계마다 묶음으로 나눠
//   그린다. 이유: 합친 줄은 어느 기계의 것을 여는지 숨기고, 다른 기계의 session이 이 컴퓨터의 workspace 사이에 끼었다.
// - 같은 project(기계를 건너는 id `pri_`가 같다. 같은 저장소면 core가 id를 맞춘다)인 다른 기계의 줄은 `also`에 적는다.
//   composer가 기계를 고르고 Home의 panel이 "also on"을 쓴다.
// - 보관한 project·앱은 줄이 아니다.
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

/** 다른 기계의 같은 project. `key`는 그 기계 안의 project id다. */
export interface Copy {
  readonly machine: MachineRef;
  readonly key: string;
}

export interface MachineWorkspace {
  /** 줄이 여는 workspace. 다른 기계의 것이면 `machine`이 있다. */
  readonly ref: WorkspaceRef;
  readonly name: string;
  /** 같은 project인 다른 기계의 project. project만 있다. */
  readonly also: readonly Copy[];
  /** project 줄의 목록 값. 이 컴퓨터에 같은 project가 없을 때 가져오는 길(clone, 잇기)이 쓴다. */
  readonly listed?: ListedProject;
  /** 그 기계가 꺼져 있다. 줄은 흐리고 열리지 않는다. */
  readonly offline: boolean;
}

const refOn = (
  machine: MachineRef,
  workspace: { kind: "project" | "app"; id: string },
): WorkspaceRef => (machine === null ? workspace : { ...workspace, machine });

/** `lists`는 이 컴퓨터가 맨 앞이고 그 뒤가 명단 순서다. */
export function machineWorkspaces(
  lists: readonly MachineLists[],
  homeName: (machineName: string | null) => string,
): MachineWorkspace[] {
  // 같은 project의 묶음. identity가 같은 줄이 한 묶음이다. 한 기계에 같은 identity가 둘이면 앞의 것만 든다.
  type Member = { readonly machine: MachineRef; readonly item: ListedProject };
  const groups = new Map<string, Member[]>();
  const groupOf = new Map<ListedProject, Member[]>();
  for (const list of lists) {
    for (const item of list.projects) {
      if (item.archived || item.identity === null) continue;
      const group = groups.get(item.identity) ?? [];
      if (group.some((one) => one.machine === list.machine)) continue;
      groups.set(item.identity, group);
      group.push({ machine: list.machine, item });
      groupOf.set(item, group);
    }
  }

  return lists.flatMap((list): MachineWorkspace[] => {
    const offline = !list.live;
    const home: MachineWorkspace = {
      ref:
        list.machine === null
          ? { kind: "home" }
          : { kind: "home", machine: list.machine },
      name: homeName(list.machine === null ? null : list.name),
      also: [],
      offline,
    };
    const projects = list.projects
      .filter((item) => !item.archived)
      .map(
        (item): MachineWorkspace => ({
          ref: refOn(list.machine, { kind: "project", id: item.id }),
          name: item.title,
          also: (groupOf.get(item) ?? [])
            .filter((one) => one.machine !== list.machine)
            .map((one) => ({ machine: one.machine, key: one.item.id })),
          listed: item,
          offline,
        }),
      );
    const apps = list.apps
      .filter((item) => !item.archived)
      .map(
        (item): MachineWorkspace => ({
          ref: refOn(list.machine, { kind: "app", id: item.id }),
          name: item.name,
          also: [],
          offline,
        }),
      );
    return [home, ...projects, ...apps];
  });
}
