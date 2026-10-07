// checker 한 번의 일(coding-agent/tickets#R18, R19, R20). 보고된 ticket의 사실을 읽고
// 판정해 record_checks로 낸다. 재시작 뒤 이어하기와 event 뒤 다시 비교하기가 같은 함수다:
// 정본 비교만 하며 model 호출은 없다. fetch를 모르고 CheckerClient만 부른다.
import { ok, type Result } from "../../../base/mod.ts";
import { type CheckWork, checkWorkSchema } from "./work.ts";
import { type ConditionDecision, judgeTicket } from "./judge.ts";

export type RecordChecksCall = {
  ticket: string;
  completion_seq: string;
  base_revision: string;
  checks: {
    condition: number;
    result: "pass" | "fail" | "inconclusive";
    reason: string;
    verification: string | null;
    targets: ConditionDecision["targets"];
  }[];
};

export type CheckerClient = {
  // 보고된 ticket의 사실. cursor가 없으면 처음부터다.
  work(input: {
    ticket?: string;
    cursor?: string;
  }): Promise<Result<{ works: unknown[]; next_cursor: string | null }>>;
  record(call: RecordChecksCall): Promise<Result<{ state: string }>>;
};

export type CheckSweep = {
  // 사실을 읽고 판정한 ticket 수.
  examined: number;
  // 새 결과를 기록한 ticket 수.
  recorded: number;
  // 읽은 뒤 정본이 바뀌어 기록이 거절된 수(conflict). 다음 비교가 이어받는다.
  conflicts: number;
  // 기록 요청 자체가 실패한 수.
  failed: number;
};

function same(work: CheckWork, decisions: readonly ConditionDecision[]) {
  // 이미 같은 결과가 기록돼 있으면 쓰지 않는다. state는 이미 그 결과로 정해졌다.
  if (work.recorded.length !== decisions.length) return false;
  return decisions.every((decision) =>
    work.recorded.some((row) =>
      row.condition === decision.condition && row.result === decision.result
    )
  );
}

export async function checkOne(
  client: CheckerClient,
  work: CheckWork,
): Promise<Result<{ state: string } | null>> {
  const decisions = judgeTicket(work);
  if (same(work, decisions)) return ok(null);
  return await client.record({
    ticket: work.ticket,
    completion_seq: work.completion.seq,
    base_revision: work.revision,
    checks: decisions,
  });
}

// 보고된 ticket 전부(또는 하나)를 비교한다. 한 ticket의 실패가 나머지를 막지 않는다.
export async function checkReported(
  client: CheckerClient,
  only?: string,
): Promise<Result<CheckSweep>> {
  const sweep: CheckSweep = {
    examined: 0,
    recorded: 0,
    conflicts: 0,
    failed: 0,
  };
  let cursor: string | undefined;
  do {
    const read = await client.work({
      ...(only === undefined ? {} : { ticket: only }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!read.ok) return read;
    for (const raw of read.value.works) {
      const parsed = checkWorkSchema.safeParse(raw);
      if (!parsed.success) {
        sweep.failed++;
        continue;
      }
      sweep.examined++;
      let done = await checkOne(client, parsed.data);
      if (!done.ok && done.error.code === "conflict") {
        // 읽은 뒤 정본이 바뀌었다. 한 번만 그 ticket을 새로 읽어 다시 비교한다.
        const again = await client.work({ ticket: parsed.data.ticket });
        const fresh = again.ok
          ? checkWorkSchema.safeParse(again.value.works[0])
          : undefined;
        if (fresh?.success) done = await checkOne(client, fresh.data);
      }
      if (!done.ok) {
        if (done.error.code === "conflict") sweep.conflicts++;
        else sweep.failed++;
      } else if (done.value !== null) {
        sweep.recorded++;
      }
    }
    cursor = read.value.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return ok(sweep);
}
