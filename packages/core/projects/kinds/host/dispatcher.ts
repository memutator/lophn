// domain마다 kinds worker에 일을 보내고, 새 위반을 사람에게 알리는 조립.
//
// - `sync`: 그 domain을 훑게 한다. 같은 domain의 도는 요청은 합치고, 직전 sync가 끝난 지 2초 안이면 새로
//   요청하지 않는다(`force`는 건너뛴다). 응답의 위반을 앞 sync의 위반과 메모리에서 비교해 앞에 없던 위반이
//   있으면 `found`를 부른다(감시와 읽기 앞 sync가 같은 길이다). 켠 뒤 그 domain의 첫 sync는 기준만 둔다.
// - `ask`: sync 뒤에 get·list·check를 worker에 묻는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { domainKindsFile } from "../../../../protocol/domains/paths.ts";
import {
  kindCheck,
  kindGet,
  kindList,
  KINDS_WORK_OPS,
  type KindsSyncResponse,
  kindsSyncResponseSchema,
} from "../../../../protocol/projects/mod.ts";
import type { KindsProcess } from "./process.ts";

// 직전 sync가 끝난 뒤 새로 요청하지 않는 시간(초기 구현값)과, worker가 한 일을 끝내기를 기다리는 한도.
const KINDS_FRESH_MS = 2_000;
const KINDS_TIMEOUT_MS = 60_000;

const ASKS = {
  get: { op: KINDS_WORK_OPS.get, output: kindGet.output },
  list: { op: KINDS_WORK_OPS.list, output: kindList.output },
  check: { op: KINDS_WORK_OPS.check, output: kindCheck.output },
} as const;
export type KindsAsk = keyof typeof ASKS;

type KindsDispatchDeps = {
  process: KindsProcess;
  dataRoot: string;
  // domain 그릇의 폴더들(project면 등록 폴더, 앱이면 source 폴더). 그릇이 없거나 보관됐거나 폴더가 없으면 null이다.
  roots(domain: string): string[] | null;
  // 앞 sync에 없던 위반이 count개 있을 때 부른다.
  found(domain: string, count: number): void;
  // 단조 시계(ms). 2초 규칙만 쓴다.
  nowMs(): number;
  log?(message: string): void;
};

export type KindsDispatcher = {
  sync(
    domain: string,
    options?: { force?: boolean },
  ): Promise<Result<KindsSyncResponse>>;
  ask(
    op: KindsAsk,
    domain: string,
    extra?: Record<string, unknown>,
  ): Promise<Result<unknown>>;
};

export function createKindsDispatcher(
  deps: KindsDispatchDeps,
): KindsDispatcher {
  const inflight = new Map<string, Promise<Result<KindsSyncResponse>>>();
  const last = new Map<string, { at: number; response: KindsSyncResponse }>();
  // domain마다 앞 sync의 위반 정체성 집합. 메모리뿐이라 core를 다시 켠 뒤 첫 sync는 기준만 된다.
  const known = new Map<string, Set<string>>();

  // worker 요청 공통 꼴. roots가 없는 domain은 not_found다.
  function request(domain: string, extra: Record<string, unknown>) {
    const roots = deps.roots(domain);
    if (roots === null) {
      return err({ code: "not_found" as const, message: "domain not found" });
    }
    return ok({
      domain,
      kinds_file: domainKindsFile(deps.dataRoot, domain),
      roots,
      ...extra,
    });
  }

  async function send(
    domain: string,
    op: string,
    extra: Record<string, unknown>,
  ): Promise<Result<unknown>> {
    const built = request(domain, extra);
    if (!built.ok) return built;
    if (!(await deps.process.ensure())) {
      return err({ code: "unavailable", message: "kinds worker is down" });
    }
    return await deps.process.request(op, built.value, KINDS_TIMEOUT_MS);
  }

  function compare(domain: string, response: KindsSyncResponse) {
    const now = new Set(
      response.violations.map((v) =>
        JSON.stringify([v.source, v.kind, v.path, v.field, v.rule])
      ),
    );
    const before = known.get(domain);
    known.set(domain, now);
    if (before === undefined) return;
    let count = 0;
    for (const identity of now) if (!before.has(identity)) count++;
    if (count === 0) return;
    try {
      deps.found(domain, count);
    } catch (cause) {
      deps.log?.(`found: ${cause instanceof Error ? cause.message : cause}`);
    }
  }

  async function run(
    domain: string,
    force: boolean,
  ): Promise<Result<KindsSyncResponse>> {
    const answered = await send(
      domain,
      KINDS_WORK_OPS.sync,
      force ? { force } : {},
    );
    if (!answered.ok) return answered;
    const parsed = kindsSyncResponseSchema.safeParse(answered.value);
    if (!parsed.success) {
      return err({ code: "internal", message: "invalid kinds sync answer" });
    }
    last.set(domain, { at: deps.nowMs(), response: parsed.data });
    compare(domain, parsed.data);
    return ok(parsed.data);
  }

  async function sync(
    domain: string,
    options?: { force?: boolean },
  ): Promise<Result<KindsSyncResponse>> {
    const force = options?.force === true;
    if (force) {
      // 도는 sync는 변화 신호보다 먼저 시작했을 수 있으니 끝나기를 기다렸다가 새로 훑는다.
      last.delete(domain);
      const running = inflight.get(domain);
      if (running !== undefined) await running;
    }
    const recent = last.get(domain);
    if (recent !== undefined && deps.nowMs() - recent.at < KINDS_FRESH_MS) {
      return ok(recent.response);
    }
    let running = inflight.get(domain);
    if (running === undefined) {
      running = run(domain, force).catch((): Result<KindsSyncResponse> =>
        err({ code: "unavailable", message: "kinds sync failed" })
      ).finally(() => inflight.delete(domain));
      inflight.set(domain, running);
    }
    return await running;
  }

  return {
    sync,
    async ask(op, domain, extra = {}) {
      const synced = await sync(domain);
      if (!synced.ok) return synced;
      const answered = await send(domain, ASKS[op].op, extra);
      if (!answered.ok) return answered;
      const parsed = ASKS[op].output.safeParse(answered.value);
      return parsed.success
        ? ok(parsed.data)
        : err({ code: "internal", message: `invalid kinds ${op} answer` });
    },
  };
}
