// domain마다 kinds worker에 일을 보내고, 위반을 problem으로 올리는 조립.
//
// - `sync`: 그 domain을 훑게 한다. 같은 domain의 도는 요청은 합치고, 직전 sync가 끝난 지 2초 안이면 새로
//   요청하지 않는다(`force`는 건너뛴다). 응답의 위반 hash가 마지막으로 올린 값과 다르면 `problem.sync_domain`
//   command를 낸다. 위반은 이 길로만 올라간다(감시와 읽기 앞 sync가 같은 길이다).
// - `ask`: sync 뒤에 get·list·check를 worker에 묻는다. 읽기만으로는 problem을 올리지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { domainKindsFile } from "../../../../protocol/domains/paths.ts";
import { problemSyncDomain } from "../../../../protocol/problems/mod.ts";
import {
  kindCheck,
  kindGet,
  kindList,
  KINDS_WORK_OPS,
  type KindsSyncResponse,
  kindsSyncResponseSchema,
} from "../../../../protocol/projects/mod.ts";
import type { CommandEnvelope } from "../../../storage/ledger/mod.ts";
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
  // 좁은 machine 자격으로 command를 낸다.
  command(envelope: CommandEnvelope): Promise<Result<unknown>>;
  newId(prefix: string): string;
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
  // 마지막으로 problem에 올린 위반 hash. 메모리뿐이라 core를 다시 켠 뒤 첫 sync는 늘 올린다.
  const reported = new Map<string, string>();

  // worker 요청 공통 꼴. roots가 없는 domain은 not_found다.
  function request(domain: string, extra: Record<string, unknown>) {
    const roots = deps.roots(domain);
    if (roots === null) {
      return err({ code: "not_found" as const, message: "domain not found" });
    }
    return ok({
      reads: [...roots, domainKindsFile(deps.dataRoot, domain)],
      payload: {
        domain,
        kinds_file: domainKindsFile(deps.dataRoot, domain),
        roots,
        ...extra,
      },
    });
  }

  async function send(
    domain: string,
    op: string,
    extra: Record<string, unknown>,
  ): Promise<Result<unknown>> {
    const built = request(domain, extra);
    if (!built.ok) return built;
    if (!(await deps.process.ensure(built.value.reads))) {
      return err({ code: "unavailable", message: "kinds worker is down" });
    }
    return await deps.process.request(
      op,
      built.value.payload,
      KINDS_TIMEOUT_MS,
    );
  }

  async function report(domain: string, response: KindsSyncResponse) {
    if (reported.get(domain) === response.violations_hash) return;
    const input = {
      domain,
      violations: response.violations.map((violation) => ({
        id: deps.newId("prb"),
        violation,
      })),
      truncated: response.truncated,
    };
    const sent = await deps.command({
      command: problemSyncDomain.name,
      input,
      idempotency_key: `kinds-dispatch/sync/${crypto.randomUUID()}`,
      compare: {},
      prepared: [],
    });
    if (sent.ok) reported.set(domain, response.violations_hash);
    else {
      // 기억하지 않으므로 다음 sync가 다시 올린다.
      deps.log?.(
        `${problemSyncDomain.name}: ${sent.error.code}: ${sent.error.message}`,
      );
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
    await report(domain, parsed.data);
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
