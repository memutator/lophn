// 자동 match를 언제 돌리나. 이 기계의 project 목록이 바뀌면 늘 돌고, 다른 컴퓨터의 목록이나 명단이 바뀌었다는 알림에는 그
// 입력(명단의 컴퓨터와 그 목록)이 지난번과 다를 때만 돈다: 다른 기계의 앱 기록이 바뀔 때마다 ledger 전체를 다시 읽지 않게.
// 한 번에 하나만 돌고 도는 사이 부르면 끝난 뒤 한 번 더 돈다. id를 바꿨으면 기록을 다시 쓰게 하고 한 번 더 돈다.
import type { Result } from "../../../base/mod.ts";
import type { SharedProject } from "../../../protocol/folder/mod.ts";
import { type MatchAction, matchActions, type MatchProject } from "./match.ts";

export type MatcherDeps = {
  // 이 기계의 project. 읽지 못하면 null이다.
  local(): MatchProject[] | null;
  // 다른 컴퓨터가 `computers` 폴더로 보낸 기록의 목록.
  peers(): { machine: string; projects: SharedProject[] }[];
  // 명단의 다른 컴퓨터. remote가 꺼져 명단이 없으면 빈 것이다.
  roster(): ReadonlySet<string>;
  isPrivate(project: string): boolean;
  write(action: MatchAction): Promise<Result<unknown>>;
  // 이 기계의 기록을 다시 쓰게 한다.
  publish(): void;
  warn(message: string): void;
  stopping(): boolean;
};

export function createMatcher(deps: MatcherDeps) {
  let running: Promise<void> | null = null;
  let again = false;
  let force = false;
  let seen: string | null = null;

  async function once(forced: boolean): Promise<boolean> {
    const roster = deps.roster();
    if (roster.size === 0) return false;
    const peers = deps
      .peers()
      .filter((peer) => roster.has(peer.machine))
      .sort((a, b) => (a.machine < b.machine ? -1 : 1));
    const input = JSON.stringify(peers);
    if (!forced && input === seen) return false;
    const local = deps.local();
    if (local === null) return false;
    seen = input;
    let changed = false;
    for (const action of matchActions(local, peers, roster, deps.isPrivate)) {
      if (deps.stopping()) return false;
      const done = await deps.write(action);
      // conflict는 계산한 뒤 project가 바뀐 것이다. 다음 계기가 다시 본다.
      if (done.ok) changed = true;
      else if (done.error.code !== "conflict") {
        deps.warn(`project ${action.project}: ${done.error.message}`);
      }
    }
    return changed;
  }

  function run(forced: boolean): Promise<void> {
    force ||= forced;
    if (running !== null) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          const forcedNow = force;
          force = false;
          if (await once(forcedNow)) {
            deps.publish();
            again = true;
            force = true;
          }
        } while (again && !deps.stopping());
      } catch (thrown) {
        deps.warn(thrown instanceof Error ? thrown.message : String(thrown));
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    // 이 기계의 project 목록이 바뀌었다.
    localChanged: () => run(true),
    // 다른 컴퓨터의 기록이나 명단이 바뀌었을 수 있다.
    peersChanged: () => run(false),
    idle: () => running ?? Promise.resolve(),
  };
}

export type Matcher = ReturnType<typeof createMatcher>;
