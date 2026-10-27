// kinds worker의 일: sync·get·list·check. scan(2초 규칙)은 sync만 한다. get·list·check는 index를 있는 그대로
// 읽는다. core의 dispatcher가 읽기 앞에 늘 sync를 보내므로 읽기는 최대 2초 묵은 것이고, 모든 scan의 결과가 sync
// 답을 지나야 core가 앞 결과와 비교해 새 위반을 사람에게 알린다. 아직 sync가 없던 domain(kinds_state 행이 없음)는 kinds
// 파일이 없는 domain으로 답한다.
import {
  canonicalize,
  type Clock,
  err,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import {
  type Kind,
  KINDS_VIOLATION_CAP,
  type KindsStatus,
  type KindsSyncResponse,
  type KindWatchFolder,
} from "../../../../protocol/projects/mod.ts";
import { kindsOfText } from "../check/kinds-file.ts";
import { sha256Text } from "../index/hash.ts";
import { type IndexFiles, scanProject } from "../index/scan.ts";
import {
  type IndexStore,
  readApplied,
  readState,
  readViolations,
} from "../index/store.ts";
import { listItems, listViolations } from "../query/list.ts";

export type KindsJobDeps = {
  store(): IndexStore;
  open(roots: readonly string[], folders: KindWatchFolder[]): IndexFiles;
  clock: Clock;
};

export type KindsJobRequest = {
  domain: string;
  kinds_file: string;
  roots: readonly string[];
  force?: boolean;
};

type Loaded = { status: KindsStatus; kinds: Kind[] | null; changed: boolean };

export function createKindsJobs(deps: KindsJobDeps) {
  // 직렬화: 한 domain에는 일이 하나씩, 도착한 순서로 돈다. 다른 domain의 일은 서로 기다리지 않는다. 아직
  // 끝나지 않은(대기 중이거나 도는) 같은 요청은 하나로 합쳐 같은 결과를 돌려준다. 끝난 요청은 기억하지 않는다.
  const tails = new Map<string, Promise<void>>();
  const pending = new Map<string, Promise<unknown>>();

  function enqueue<T>(domain: string, key: string, run: () => T): Promise<T> {
    const joined = pending.get(key);
    if (joined !== undefined) return joined as Promise<T>;
    const turn = (tails.get(domain) ?? Promise.resolve()).then(run);
    const tail = turn.then(
      () => {},
      () => {},
    );
    tails.set(domain, tail);
    pending.set(key, turn);
    const done = () => {
      pending.delete(key);
      if (tails.get(domain) === tail) tails.delete(domain);
    };
    turn.then(done, done);
    return turn;
  }

  // index에 있는 그대로 읽는다. 아직 scan한 적이 없으면 kinds 파일이 없는 domain과 같다.
  function read(request: KindsJobRequest, changed: boolean): Loaded {
    const sql = deps.store().sql;
    const state = readState(sql, request.domain);
    if (state === undefined) {
      return {
        status: {
          file: request.kinds_file,
          state: "none",
          using: "none",
          errors: [],
          applied_hash: null,
        },
        kinds: null,
        changed,
      };
    }
    const applied = readApplied(sql, request.domain);
    return {
      status: state.status,
      kinds:
        state.status.using === "none" || applied === undefined
          ? null
          : kindsOfText(applied.text),
      changed,
    };
  }

  function scan(request: KindsJobRequest): Result<Loaded> {
    const scanned = scanProject(deps.store(), {
      domain: request.domain,
      kinds_file: request.kinds_file,
      open: (folders) => deps.open(request.roots, folders),
      clock: deps.clock,
      force: request.force,
    });
    return scanned.ok ? ok(read(request, scanned.value.changed)) : scanned;
  }

  const job =
    <Req extends KindsJobRequest, T>(
      op: string,
      run: (request: Req) => Result<T>,
    ) =>
    (request: Req): Promise<Result<T>> =>
      enqueue(request.domain, JSON.stringify([op, request]), () =>
        run(request),
      );

  return {
    sync: job("sync", (request: KindsJobRequest): Result<KindsSyncResponse> => {
      const scanned = scan(request);
      if (!scanned.ok) return scanned;
      const { status, changed } = scanned.value;
      const rows = readViolations(deps.store().sql, request.domain, {
        limit: KINDS_VIOLATION_CAP + 1,
      });
      const violations = rows.slice(0, KINDS_VIOLATION_CAP);
      return ok({
        status,
        violations,
        truncated: rows.length > KINDS_VIOLATION_CAP,
        violations_hash: sha256Text(
          canonicalize({ errors: status.errors, violations }),
        ),
        changed,
      });
    }),
    get: job("get", (request: KindsJobRequest) => {
      const loaded = read(request, false);
      return ok({
        domain: request.domain,
        status: loaded.status,
        kinds: loaded.kinds,
      });
    }),
    list: job(
      "list",
      (
        request: KindsJobRequest & { query: Parameters<typeof listItems>[3] },
      ) => {
        const loaded = read(request, false);
        if (loaded.kinds === null) {
          return err({ code: "not_found", message: "no kinds file is in use" });
        }
        return listItems(
          deps.store().sql,
          request.domain,
          loaded.kinds,
          request.query,
        );
      },
    ),
    check: job(
      "check",
      (
        request: KindsJobRequest & {
          query: Parameters<typeof listViolations>[2];
        },
      ) => {
        const loaded = read(request, false);
        const page = listViolations(
          deps.store().sql,
          request.domain,
          request.query,
        );
        return page.ok ? ok({ status: loaded.status, ...page.value }) : page;
      },
    ),
  };
}
