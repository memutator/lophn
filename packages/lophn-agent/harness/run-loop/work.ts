import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  assignmentList,
  runList,
  runRead,
  type RunRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  eventsList,
  type ReadRoute,
  routePath,
} from "../../../protocol/platform/mod.ts";
import { predecessorAllows } from "./model.ts";
import type { CoreRead } from "./startup.ts";

// run selector(requirements lophn-agent/harness/run-loop R4). accepted run은
// ledger가 정본이고 이 selector는 읽기만 한다. 고른 run의 시작은 StartRun이 다시
// 검사한다(session당 하나, session 없는 run은 assignment당 하나, 선행 정책, 앞선 접수). 메모리에는 event cursor와 최근
// 시작 목록뿐이고 재시작하면 RunStarted event에서 다시 만든다. 새 queue entity는 없다.

// 우선순위 칸. 숫자가 작을수록 먼저다. 주기 일의 칸은 없다(scheduling 보류).
//   1 사람이 지금 기다리는 요청: 대화에서 사람이 입력한 요청(message 출처).
//   2 사람의 한 번짜리 일: handoff, 보존했다가 사람이 다시 맡긴 요청(continued_from).
export type Tier = 1 | 2;

// 상위 일을 이만큼 연속으로 시작한 뒤에는 가장 오래 기다린 하위 후보에 자리를 준다.
export const YIELD_AFTER = 8;

export function tierOf(
  run: Pick<RunRecord, "source" | "continued_from">,
): Tier {
  return run.source.kind === "message" && run.continued_from === null ? 1 : 2;
}

// run이 줄 서는 곳. session이 있으면 session, 없으면 assignment의 session 없는 run들이다.
// 같은 곳에서는 진행 중·사람 기다림 run이 하나뿐이고 접수 순서로 시작한다(R3).
export function queueKeyOf(
  run: Pick<RunRecord, "assignment" | "session">,
): string {
  return run.session === null
    ? `assignment:${run.assignment}`
    : `session:${run.session}`;
}

export type Candidate = {
  run: string;
  assignment: string;
  session: string | null;
  tier: Tier;
  acceptedSeq: bigint;
  stateSeq: string;
};

export type RecentStart = { seq: bigint; tier: Tier };

export type Selection = {
  run: string;
  assignment: string;
  session: string | null;
  // StartRun의 compare.state_seq.
  stateSeq: string;
  // priority는 우선순위 순서 그대로, yield는 8개 연속 뒤 하위에 준 자리다.
  reason: "priority" | "yield";
};

// 순수 선택. candidates는 줄(session)마다 시작 가능한 맨 앞 후보 하나씩이다.
// recent는 RunStarted seq 오름차순이다.
export function pickCandidate(
  candidates: readonly Candidate[],
  recent: readonly RecentStart[],
): Selection | undefined {
  const byAge = (a: Candidate, b: Candidate) =>
    a.acceptedSeq < b.acceptedSeq ? -1 : a.acceptedSeq > b.acceptedSeq ? 1 : 0;
  const ordered = [...candidates].sort((a, b) =>
    a.tier - b.tier || byAge(a, b)
  );
  const first = ordered[0];
  if (first === undefined) return undefined;
  const select = (candidate: Candidate, reason: Selection["reason"]) => ({
    run: candidate.run,
    assignment: candidate.assignment,
    session: candidate.session,
    stateSeq: candidate.stateSeq,
    reason,
  });
  // 하위 칸의 가장 오래된 후보가 그 접수 뒤 상위 일 8개를 연속으로 기다렸는지 본다.
  // 하위 칸의 시작이 끼면 연속이 끊긴다. 후보가 없는 칸과 막힌 session의 후보는
  // 여기 오지 못하므로 양보를 쓰지 않는다.
  if (first.tier === 1) {
    const oldest = ordered.filter((item) => item.tier === 2).sort(byAge)[0];
    if (oldest !== undefined) {
      let overtaken = 0;
      for (let i = recent.length - 1; i >= 0; i--) {
        const start = recent[i]!;
        if (start.seq <= oldest.acceptedSeq || start.tier >= oldest.tier) break;
        overtaken++;
      }
      if (overtaken >= YIELD_AFTER) return select(oldest, "yield");
    }
  }
  return select(first, "priority");
}

// 시작 가능한 맨 앞 후보를 줄(session, session 없는 run은 assignment)마다 하나 고른다.
// 멈춘·withdrawn assignment, 진행·대기 run이 있는 줄, 선행이 허락하지 않은 run은
// 후보가 아니다. live는 진행·대기 run의 queueKeyOf 값이다.
export function startableCandidates(input: {
  accepted: readonly RunRecord[];
  enabled: ReadonlySet<string>;
  live: ReadonlySet<string>;
  predecessor: (
    run: string,
  ) => Pick<RunRecord, "state" | "outcome"> | undefined;
}): Candidate[] {
  const byQueue = new Map<string, RunRecord[]>();
  for (const run of input.accepted) {
    if (run.state !== "accepted") continue;
    const key = queueKeyOf(run);
    if (!input.enabled.has(run.assignment) || input.live.has(key)) continue;
    const list = byQueue.get(key) ?? [];
    list.push(run);
    byQueue.set(key, list);
  }
  const result: Candidate[] = [];
  for (const runs of byQueue.values()) {
    runs.sort((a, b) =>
      BigInt(a.accepted_seq) < BigInt(b.accepted_seq) ? -1 : 1
    );
    const head = runs.find((run) => {
      const before = run.start_after === null
        ? undefined
        : input.predecessor(run.start_after);
      return predecessorAllows(
        {
          start_after: run.start_after,
          start_confirmed_seq: run.start_confirmed_seq,
        },
        before === undefined ? undefined : {
          state: before.state,
          outcome_kind: before.outcome?.kind ?? null,
        },
      );
    });
    if (head === undefined) continue;
    result.push({
      run: head.id,
      assignment: head.assignment,
      session: head.session,
      tier: tierOf(head),
      acceptedSeq: BigInt(head.accepted_seq),
      stateSeq: head.state_seq,
    });
  }
  return result;
}

export type RunSelector = {
  // 지금 시작할 run 하나. 없으면 null이다. 읽기만 하고 ledger를 바꾸지 않는다.
  next(): Promise<Result<Selection | null>>;
};

// selector가 core에 묻는 read. runtime이 이 route만 loopback으로 연다.
export const SELECTOR_READ_ROUTES = [
  runList,
  runRead,
  assignmentList,
  eventsList,
] as const;

type Page = { next_cursor: string | null };

export function createRunSelector(deps: { read: CoreRead }): RunSelector {
  // RunStarted를 훑은 위치와 최근 시작 목록. 재시작 때 0에서 다시 만든다.
  let cursor = "0";
  let recent: { run: string; seq: bigint }[] = [];
  const tiers = new Map<string, Tier>();
  const settled = new Map<string, Pick<RunRecord, "state" | "outcome">>();

  async function call<R extends ReadRoute>(
    route: R,
    body: unknown,
  ): Promise<Result<z.output<R["output"]>>> {
    const result = await deps.read(routePath(route), body);
    if (!result.ok) return result;
    const parsed = route.output.safeParse(result.value);
    if (!parsed.success) {
      return err({ code: "unavailable", message: "unexpected read shape" });
    }
    return ok(parsed.data as z.output<R["output"]>);
  }

  async function pages<T>(
    load: (cursor: string | undefined) => Promise<
      Result<{ items: T[]; page: Page }>
    >,
  ): Promise<Result<T[]>> {
    const all: T[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await load(after);
      if (!page.ok) return page;
      all.push(...page.value.items);
      if (page.value.page.next_cursor === null) return ok(all);
      after = page.value.page.next_cursor;
    }
  }

  function runs(state: "accepted" | "running" | "waiting_user") {
    return pages<RunRecord>(async (after) => {
      const listed = await call(runList, {
        state,
        ...(after === undefined ? {} : { cursor: after }),
      });
      if (!listed.ok) return listed;
      return ok({
        items: listed.value.runs,
        page: { next_cursor: listed.value.next_cursor },
      });
    });
  }

  // 새 RunStarted를 cursor 뒤로 읽어 최근 시작 목록을 이어 만든다.
  async function refreshStarts(): Promise<Result<void>> {
    for (;;) {
      const listed = await call(eventsList, {
        after_seq: cursor,
        types: ["RunStarted"],
      });
      if (!listed.ok) return listed;
      for (const event of listed.value.events) {
        if (event.subject === null) continue;
        recent.push({ run: event.subject, seq: BigInt(event.seq) });
      }
      // 한도 하나로 충분한 만큼만 둔다. 더 오래된 시작은 연속을 끊을 수 없다.
      if (recent.length > YIELD_AFTER * 4) {
        recent = recent.slice(recent.length - YIELD_AFTER * 4);
      }
      const advanced = listed.value.scanned_through_seq;
      if (BigInt(advanced) <= BigInt(cursor)) return ok(undefined);
      cursor = advanced;
      if (BigInt(cursor) >= BigInt(listed.value.head_seq)) return ok(undefined);
    }
  }

  async function startedTiers(): Promise<Result<RecentStart[]>> {
    const started: RecentStart[] = [];
    for (const item of recent) {
      let tier = tiers.get(item.run);
      if (tier === undefined) {
        const read = await call(runRead, { run: item.run });
        if (!read.ok) return read;
        tier = tierOf(read.value.run);
        tiers.set(item.run, tier);
      }
      started.push({ seq: item.seq, tier });
    }
    return ok(started);
  }

  return {
    async next() {
      const accepted = await runs("accepted");
      if (!accepted.ok) return accepted;
      if (accepted.value.length === 0) return ok(null);
      const assignments = await pages<{ id: string }>(async (after) => {
        const listed = await call(assignmentList, {
          state: "enabled",
          ...(after === undefined ? {} : { cursor: after }),
        });
        if (!listed.ok) return listed;
        return ok({
          items: listed.value.assignments,
          page: { next_cursor: listed.value.next_cursor },
        });
      });
      if (!assignments.ok) return assignments;
      const live = new Set<string>();
      for (const state of ["running", "waiting_user"] as const) {
        const active = await runs(state);
        if (!active.ok) return active;
        for (const run of active.value) live.add(queueKeyOf(run));
      }
      // 선행이 accepted 목록에 없으면 따로 읽는다. 끝난 선행 결과는 바뀌지 않아 보관한다.
      const known = new Map(accepted.value.map((run) => [run.id, run]));
      for (const run of accepted.value) {
        const link = run.start_after;
        if (link === null || known.has(link) || settled.has(link)) continue;
        const read = await call(runRead, { run: link });
        if (!read.ok) {
          if (read.error.code === "not_found") continue;
          return read;
        }
        const before = read.value.run;
        if (before.state === "finished") {
          settled.set(link, { state: before.state, outcome: before.outcome });
        } else known.set(link, before);
      }
      const candidates = startableCandidates({
        accepted: accepted.value,
        enabled: new Set(assignments.value.map((item) => item.id)),
        live,
        predecessor: (id) => known.get(id) ?? settled.get(id),
      });
      if (candidates.length === 0) return ok(null);
      const refreshed = await refreshStarts();
      if (!refreshed.ok) return refreshed;
      const started = await startedTiers();
      if (!started.ok) return started;
      return ok(pickCandidate(candidates, started.value) ?? null);
    },
  };
}
