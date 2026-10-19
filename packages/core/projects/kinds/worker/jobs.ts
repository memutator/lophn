// kinds worker의 일: sync·get·list·check. 모두 먼저 scan(2초 규칙)한 뒤 index에서 답한다.
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
  project: string;
  kinds_file: string;
  roots: readonly string[];
  force?: boolean;
};

type Loaded = { status: KindsStatus; kinds: Kind[] | null; changed: boolean };

export function createKindsJobs(deps: KindsJobDeps) {
  // 직렬화: 한 project에는 일이 하나씩, 도착한 순서로 돈다. 다른 project의 일은 서로 기다리지 않는다. 아직
  // 끝나지 않은(대기 중이거나 도는) 같은 요청은 하나로 합쳐 같은 결과를 돌려준다. 끝난 요청은 기억하지 않는다.
  const tails = new Map<string, Promise<void>>();
  const pending = new Map<string, Promise<unknown>>();

  function enqueue<T>(
    project: string,
    key: string,
    run: () => T,
  ): Promise<T> {
    const joined = pending.get(key);
    if (joined !== undefined) return joined as Promise<T>;
    const turn = (tails.get(project) ?? Promise.resolve()).then(run);
    const tail = turn.then(() => {}, () => {});
    tails.set(project, tail);
    pending.set(key, turn);
    const done = () => {
      pending.delete(key);
      if (tails.get(project) === tail) tails.delete(project);
    };
    turn.then(done, done);
    return turn;
  }

  function load(request: KindsJobRequest): Result<Loaded> {
    const store = deps.store();
    const scanned = scanProject(store, {
      project: request.project,
      kinds_file: request.kinds_file,
      open: (folders) => deps.open(request.roots, folders),
      clock: deps.clock,
      force: request.force,
    });
    if (!scanned.ok) return scanned;
    const state = readState(store.sql, request.project)!;
    const applied = readApplied(store.sql, request.project);
    return ok({
      status: state.status,
      kinds: state.status.using === "none" || applied === undefined
        ? null
        : kindsOfText(applied.text),
      changed: scanned.value.changed,
    });
  }

  const job = <Req extends KindsJobRequest, T>(
    op: string,
    run: (request: Req) => Result<T>,
  ) =>
  (request: Req): Promise<Result<T>> =>
    enqueue(request.project, JSON.stringify([op, request]), () => run(request));

  return {
    sync: job("sync", (request: KindsJobRequest): Result<KindsSyncResponse> => {
      const loaded = load(request);
      if (!loaded.ok) return loaded;
      const { status, changed } = loaded.value;
      const rows = readViolations(deps.store().sql, request.project, {
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
      const loaded = load(request);
      if (!loaded.ok) return loaded;
      return ok({
        project: request.project,
        status: loaded.value.status,
        kinds: loaded.value.kinds,
      });
    }),
    list: job("list", (
      request: KindsJobRequest & { query: Parameters<typeof listItems>[3] },
    ) => {
      const loaded = load(request);
      if (!loaded.ok) return loaded;
      if (loaded.value.kinds === null) {
        return err({ code: "not_found", message: "no kinds file is in use" });
      }
      return listItems(
        deps.store().sql,
        request.project,
        loaded.value.kinds,
        request.query,
      );
    }),
    check: job("check", (
      request: KindsJobRequest & {
        query: Parameters<typeof listViolations>[2];
      },
    ) => {
      const loaded = load(request);
      if (!loaded.ok) return loaded;
      const page = listViolations(
        deps.store().sql,
        request.project,
        request.query,
      );
      return page.ok
        ? ok({ status: loaded.value.status, ...page.value })
        : page;
    }),
  };
}
