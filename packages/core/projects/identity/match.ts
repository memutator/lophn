// 같은 저장소의 project를 사람의 컴퓨터들 사이에서 자동으로 같은 id로 맞춘다. 순수 함수다: 이 기계의 project와 명단의 다른
// 컴퓨터가 기계 기록에 실은 목록을 받아 바꿀 것을 낸다. 적는 것은 command `project.match_identity`가 조건을 다시 보고 한다.
//
// 규칙(architecture `project-identity` "자동 match")
// - id는 더 작은 쪽(ULID라 먼저 만든 것)으로만 바뀐다. 그래서 몇 대가 어느 순서로 만나도 같은 저장소의 묶음은 그 묶음의 가장 작은
//   id에서 멈추고 오가지 않는다.
// - 한쪽에 같은 remote key의 project가 둘 이상이면(나눈 것은 빼고) 그 key는 그쪽과 맞추지 않는다. 어느 쪽인지 모른다.
// - 사람이 나눈 project는 어느 쪽에서도 맞추지 않는다. 나눈 project의 id를 가진 project(그것을 clone했다)도 나눈 것이 된다.
// - project를 자기 옛 id로 돌려보내지 않고, 이 기계의 다른 project가 지금이나 옛 identity로 가진 id로 바꾸지 않는다.
import {
  SHARED_PROJECT_KEY_MAX,
  SHARED_PROJECTS_MAX,
  type SharedProject,
} from "../../../protocol/folder/mod.ts";
import type { Project } from "../registry/model.ts";

export type MatchProject = Pick<
  Project,
  "id" | "identity" | "former_identities" | "status" | "repo" | "separated"
> & { remote: { key: string } | null };

export type MatchAction =
  | { project: string; from: string; identity: string }
  | { project: string; from: string; separated: true };

const keyOf = (project: MatchProject): string | null =>
  project.status === "active" &&
  project.repo === "git" &&
  project.remote !== null &&
  project.remote.key.length <= SHARED_PROJECT_KEY_MAX
    ? project.remote.key
    : null;

// 이 기계가 기계 기록에 싣는 목록. 나눈 것도 싣는다: 받은 쪽이 그 id를 clone한 project를 나눈 것으로 안다.
export function sharedProjects(
  projects: readonly MatchProject[],
): SharedProject[] {
  return projects
    .flatMap((project) => {
      const key = keyOf(project);
      return key === null
        ? []
        : [
            {
              identity: project.identity,
              remote_key: key,
              separated: project.separated,
            },
          ];
    })
    .sort((a, b) => (a.identity < b.identity ? -1 : 1))
    .slice(0, SHARED_PROJECTS_MAX);
}

// records는 폴더로 받은 다른 기계의 기록에 실린 목록이다. 명단(roster, 이 컴퓨터는 빼고)에 든 컴퓨터의 것만 쓴다: 명단에서
// 빠진 기계의 옛 기록이 project를 끌고 가지 않게.
export function matchActions(
  local: readonly MatchProject[],
  records: readonly {
    machine: string;
    projects: readonly SharedProject[];
  }[],
  roster: ReadonlySet<string>,
): MatchAction[] {
  const peers = records
    .filter((record) => roster.has(record.machine))
    .map((record) => record.projects);
  const candidates = local.filter(
    (project) => keyOf(project) !== null && !project.separated,
  );
  const localCount = new Map<string, number>();
  for (const project of candidates) {
    const key = keyOf(project)!;
    localCount.set(key, (localCount.get(key) ?? 0) + 1);
  }
  const separatedIds = new Set(
    peers.flat().flatMap((entry) => (entry.separated ? [entry.identity] : [])),
  );
  const actions: MatchAction[] = [];
  for (const project of candidates) {
    if (separatedIds.has(project.identity)) {
      actions.push({
        project: project.id,
        from: project.identity,
        separated: true,
      });
      continue;
    }
    const key = keyOf(project)!;
    if (localCount.get(key) !== 1) continue;
    const held = (identity: string) =>
      project.former_identities.includes(identity) ||
      local.some(
        (other) =>
          other.id !== project.id &&
          (other.identity === identity ||
            other.former_identities.includes(identity)),
      );
    let best = project.identity;
    for (const peer of peers) {
      const same = peer.filter(
        (entry) => entry.remote_key === key && !entry.separated,
      );
      if (same.length !== 1) continue;
      const identity = same[0]!.identity;
      if (identity < best && !held(identity)) best = identity;
    }
    if (best !== project.identity) {
      actions.push({
        project: project.id,
        from: project.identity,
        identity: best,
      });
    }
  }
  return actions;
}
