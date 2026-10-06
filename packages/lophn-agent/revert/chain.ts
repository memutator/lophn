import { err, ok, type Result } from "../../base/mod.ts";
import type {
  CommandRoute,
  JsonObject,
  Tx,
} from "../../contracts/platform/mod.ts";
import {
  compareSeq,
  type GroupDraft,
  type ReasonCode,
  type RunEvent,
  sortSeqs,
} from "./model.ts";

// context·term처럼 revision CAS로 변경을 쌓는 대상의 복원 규칙이다(documents/contexts, documents/terms).
// 대상 하나의 run event는 한 묶음이다. 보상은 그 event를 거꾸로 되돌리는 owner command 호출의 열(step)이고,
// 열 전체가 묶음의 비교 기준(comparison)에 실려 사람이 본 판이 곧 적용 내용이 된다. 적용은 열을 같은 Tx에서
// 차례로 부르며 매 호출은 직전 호출이 돌려준 revision을 기준으로 한다. 어느 호출이 거절하면 이 transaction의
// 모든 복원이 함께 취소된다. run 뒤 이 run이 아닌 변경이 하나라도 있으면 충돌이다(값이 같아도 충돌이고 덮어쓰는
// 동의는 없다).

export type Step = JsonObject & { op: string };

export function draftOf(
  owner: string,
  target: string | null,
  seqs: readonly string[],
  capability: GroupDraft["capability"],
  reason: ReasonCode | null,
  comparison: JsonObject | null,
  beforeRef: JsonObject | null,
): GroupDraft {
  return {
    owner,
    target,
    source_seqs: sortSeqs(seqs),
    capability,
    reason,
    comparison,
    before_ref: beforeRef,
    dependencies: [],
  };
}

// 구성을 바꾸는 event 중 가장 나중 것이 현재 revision이다(documents의 revision은 마지막 변경 seq).
export function currentRevision(
  all: readonly RunEvent[],
  configTypes: ReadonlySet<string>,
): string {
  let revision = "0";
  for (const event of all) {
    if (configTypes.has(event.type) && compareSeq(event.seq, revision) > 0) {
      revision = event.seq;
    }
  }
  return revision;
}

// 처음 변경 뒤에 이 run이 아닌 구성 변경이 끼었거나 뒤따랐는가.
export function hasForeignChange(
  own: readonly RunEvent[],
  all: readonly RunEvent[],
  configTypes: ReadonlySet<string>,
): boolean {
  const ownSet = new Set(own.map((event) => event.seq));
  const first = own[0].seq;
  return all.some((event) =>
    configTypes.has(event.type) && !ownSet.has(event.seq) &&
    compareSeq(event.seq, first) > 0
  );
}

export function bySubject(
  events: readonly RunEvent[],
): { subject: string; own: RunEvent[] }[] {
  const grouped = new Map<string, RunEvent[]>();
  for (const event of events) {
    const key = event.subject ?? "";
    const list = grouped.get(key) ?? [];
    list.push(event);
    grouped.set(key, list);
  }
  return [...grouped.entries()].map(([subject, own]) => ({ subject, own }));
}

// 열의 한 호출이다. route와 입력은 owner가 풀어 준다.
export type Call = (
  tx: Tx,
  step: Step,
  base: string,
) => Result<{ revision: string }>;

export function applySteps(
  tx: Tx,
  comparison: JsonObject | null,
  call: Call,
): Result<void> {
  const steps = comparison?.["steps"];
  const first = comparison?.["base_revision"];
  if (!Array.isArray(steps) || typeof first !== "string") {
    return err({
      code: "invalid_input",
      message: "this group has nothing to restore",
    });
  }
  let base = first;
  for (const step of steps as Step[]) {
    const done = call(tx, step, base);
    if (!done.ok) return err(done.error);
    base = done.value.revision;
  }
  return ok(undefined);
}

export function callOf(
  tx: Tx,
  route: CommandRoute,
  input: unknown,
  base: string,
): Result<{ revision: string }> {
  const done = tx.call(route as never, input as never, {
    base_revision: base,
  } as never) as Result<{ revision: unknown }>;
  return done.ok
    ? ok({ revision: String(done.value.revision) })
    : err(done.error);
}
