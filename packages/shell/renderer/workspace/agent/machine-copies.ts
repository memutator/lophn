// 같은 project(`pri_` identity)가 있는 기계들. Agent 탭의 composer가 새 session을 어느 기계에서 돌릴지 고르는 데 쓴다.
// sidebar의 목록 모양과 떼어 두어(필요한 칸만 받는다) 목록을 어떻게 그리든 이 계산은 그대로다.
/** 기계 하나의 project 목록. `null`이 이 컴퓨터다. */
export interface MachineProjects {
  readonly machine: string | null;
  /** 명단의 이름. 이 컴퓨터는 빈 글이다. */
  readonly name: string;
  readonly live: boolean;
  readonly projects: readonly {
    readonly id: string;
    readonly identity: string | null;
    readonly archived: boolean;
  }[];
}

/** 같은 project의 한 기계 쪽 사본. `project`는 그 기계의 project id다. */
export interface ProjectCopy {
  readonly machine: string | null;
  readonly name: string;
  readonly live: boolean;
  readonly project: string;
}

/**
 * `machine`의 `project`와 같은 project를 가진 기계들(자기 자신 포함). 이 컴퓨터가 맨 앞이고 나머지는 목록 순서다.
 * identity가 없거나 목록에서 못 찾으면 빈 목록이다(어느 사본과도 같다고 말할 수 없다).
 */
export function copiesOfProject(
  lists: readonly MachineProjects[],
  machine: string | null,
  project: string,
): readonly ProjectCopy[] {
  const mine = lists
    .find((list) => list.machine === machine)
    ?.projects.find((item) => item.id === project);
  if (mine === undefined || mine.identity === null) return [];
  const copies: ProjectCopy[] = [];
  for (const list of lists) {
    // 지금 project 자신은 보관했어도 사본으로 센다. 한 기계에 같은 identity가 둘이면 자기 것이 먼저고, 아니면 목록의 첫 것이다.
    const rows = list.projects.filter(
      (item) =>
        !item.archived || (list.machine === machine && item.id === project),
    );
    const found = rows
      .filter((item) => item.identity === mine.identity)
      .map((item) => item.id);
    const id =
      found.includes(project) && list.machine === machine ? project : found[0];
    if (id === undefined) continue;
    copies.push({
      machine: list.machine,
      name: list.name,
      live: list.live,
      project: id,
    });
  }
  return copies.sort(
    (a, b) => Number(b.machine === null) - Number(a.machine === null),
  );
}
