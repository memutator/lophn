import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import type {
  JsonObject,
  Sql,
  SqlParams,
  SqlRow,
  Tx,
} from "../../contracts/platform/mod.ts";

// lophn-agent/revert의 순수 규칙. 종료한 run의 event 전체를 owner별 묶음으로 나누고, 묶음마다
// 복원 가능·유지·불가·충돌을 분류하며, 사람이 본 preview에 고정할 지문(binding_hash)을 만든다.
// 이 leaf는 다른 concern의 표를 읽지 않는다: run의 변경은 ledger의 event에서, 복원은 소유
// concern의 dispatchable command로만 한다(R5, R9). 분류와 복원 호출은 owner adapter가 맡는다.

export type Capability = "reversible" | "retained" | "irreversible" | "conflict";
export type ChangeOutcome =
  | "restored"
  | "retained"
  | "irreversible"
  | "conflict"
  | "unchanged"
  | "failure"
  | "uncertain";
export type Outcome =
  | "applying"
  | "applied"
  | "partial"
  | "uncertain"
  | "blocked";

// 분류·차단 이유는 값이 작은 코드 하나다. 이유 blob은 이 코드의 정규 JSON hash라서 가능한 값이
// 유한하다(REVERT_REASONS). 사람에게 보이는 문장은 shell이 코드로 wording을 고른다.
export const REVERT_REASON_CODES = [
  "audit_fact",
  "later_change",
  "linked_document",
  "not_agent_output",
  "title_change",
  "no_previous_version",
  "unclassified_document_event",
  "unclassified_event",
  "blocked_conflict",
  "blocked_irreversible",
  "blocked_dependency",
  "blocked_not_prepared",
  "stale_preview",
] as const;
export type ReasonCode = (typeof REVERT_REASON_CODES)[number];

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashOf(value: unknown): string {
  return sha256Text(canonicalize(value));
}

export function reasonHash(code: ReasonCode): string {
  return hashOf({ code });
}

export const REVERT_REASONS: Readonly<Record<ReasonCode, string>> = Object
  .fromEntries(
    REVERT_REASON_CODES.map((code) => [code, reasonHash(code)]),
  ) as Record<ReasonCode, string>;

export function reasonOf(blob: string): ReasonCode | undefined {
  return REVERT_REASON_CODES.find((code) => REVERT_REASONS[code] === blob);
}

export type Lookup = {
  sql: {
    get: (query: string, params: SqlParams) => SqlRow | undefined;
    all: (query: string, params: SqlParams) => SqlRow[];
  };
};

export type RunEvent = {
  seq: string;
  type: string;
  subject: string | null;
  actor: string;
  run: string | null;
  payload: unknown;
};

function eventOf(row: SqlRow): RunEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(String(row["payload"]));
  } catch {
    payload = undefined;
  }
  return {
    seq: String(row["seq"]),
    type: String(row["type"]),
    subject: row["subject"] === null ? null : String(row["subject"]),
    actor: String(row["actor"]),
    run: row["run"] === null ? null : String(row["run"]),
    payload,
  };
}

const EVENT_COLUMNS =
  "cast(seq as text) as seq, type, subject, actor, run, payload";

// 원래 run의 event 전체. envelope의 run으로만 고르고 actor·시각으로 추정하지 않는다.
export function loadRunEvents(lookup: Lookup, run: string): RunEvent[] {
  return lookup.sql.all(
    `select ${EVENT_COLUMNS} from events where run = ? order by seq`,
    [run],
  ).map(eventOf);
}

// 한 대상에 대한 모든 event. run이 아닌 주체의 변경이 끼었는지 보는 근거다.
export function subjectEvents(lookup: Lookup, subject: string): RunEvent[] {
  return lookup.sql.all(
    `select ${EVENT_COLUMNS} from events where subject = ? order by seq`,
    [subject],
  ).map(eventOf);
}

export function compareSeq(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortSeqs(seqs: readonly string[]): string[] {
  return [...seqs].sort(compareSeq);
}

const TARGET = /^[a-z]{3}_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

export function targetOf(subject: string | null): string | null {
  return subject !== null && TARGET.test(subject) ? subject : null;
}

// owner가 판정한 묶음. 정렬·번호·이유 hash는 engine이 붙인다.
export type GroupDraft = {
  owner: string;
  target: string | null;
  source_seqs: string[];
  capability: Capability;
  reason: ReasonCode | null;
  comparison: JsonObject | null;
  before_ref: JsonObject | null;
  dependencies: { owner: string; target: string; comparison: JsonObject }[];
};

export type RevertGroup = {
  ordinal: number;
  owner: string;
  target: string | null;
  source_seqs: string[];
  capability: Capability;
  reason_blob: string | null;
  comparison: JsonObject | null;
  before_ref: JsonObject | null;
  dependencies: { owner: string; target: string; comparison: JsonObject }[];
  app_revert: null;
};

// 사람이 적용할 때 owner에게 주는 입력 한 묶음(contracts RevertRun의 groups 항목).
export type RevertRunGroup = {
  source_seqs: string[];
  comparison: JsonObject;
  prepared_ref: string | null;
};

export type OwnerContext = {
  run: string;
  events: readonly RunEvent[];
  lookup: Lookup;
};

// 소유 concern마다 하나. claims는 이 owner가 판정하는 event type이고, classify는 그 event들을
// 묶음으로 나눠 분류한다. restore는 분류가 reversible인 묶음을 소유 concern의 새 변경으로
// 되돌린다(같은 Tx의 `tx.call`, 새 transaction 없음). ready는 적용 전 사전 검사로, 복원에 필요한
// 준비가 없으면 차단 이유를 돌려준다(복원 준비 불충족은 blocked다).
export type RevertOwner = {
  readonly concern: string;
  claims(type: string): boolean;
  classify(input: OwnerContext): GroupDraft[];
  ready?(group: RevertGroup, input: RevertRunGroup): Result<ReasonCode | null>;
  restore(
    tx: Tx,
    group: RevertGroup,
    input: RevertRunGroup,
  ): Result<void>;
};

export const UNCLASSIFIED_OWNER = "unclassified";

// 어느 owner도 맡지 않은 event는 누락하지 않고 복원 불가로 남긴다(R9). 안전하다고 가정하지 않는다.
function unclassifiedDrafts(events: readonly RunEvent[]): GroupDraft[] {
  const bySubject = new Map<string, string[]>();
  for (const event of events) {
    const key = event.subject ?? "";
    const list = bySubject.get(key) ?? [];
    list.push(event.seq);
    bySubject.set(key, list);
  }
  return [...bySubject.entries()].map(([subject, seqs]) => ({
    owner: UNCLASSIFIED_OWNER,
    target: targetOf(subject === "" ? null : subject),
    source_seqs: sortSeqs(seqs),
    capability: "irreversible" as const,
    reason: "unclassified_event" as const,
    comparison: null,
    before_ref: null,
    dependencies: [],
  }));
}

// run의 event 전체를 묶음으로 나눈다. 묶음의 source는 서로 겹치지 않고 event를 빠짐없이 덮는다.
export function buildGroups(
  lookup: Lookup,
  run: string,
  owners: readonly RevertOwner[],
): RevertGroup[] {
  const events = loadRunEvents(lookup, run);
  const buckets = new Map<RevertOwner, RunEvent[]>();
  const orphans: RunEvent[] = [];
  for (const event of events) {
    const owner = owners.find((candidate) => candidate.claims(event.type));
    if (owner === undefined) {
      orphans.push(event);
      continue;
    }
    const list = buckets.get(owner) ?? [];
    list.push(event);
    buckets.set(owner, list);
  }
  const drafts: GroupDraft[] = [];
  for (const [owner, own] of buckets) {
    drafts.push(...owner.classify({ run, events: own, lookup }));
  }
  drafts.push(...unclassifiedDrafts(orphans));
  // 어느 묶음에도 없는 event는 owner가 빠뜨린 것이다. 남기지 않고 복원 불가로 설명한다.
  const covered = new Set(drafts.flatMap((draft) => draft.source_seqs));
  const missing = events.filter((event) => !covered.has(event.seq));
  drafts.push(...unclassifiedDrafts(missing));
  // event 하나는 한 묶음에만 속한다. 겹치면 먼저 나온 묶음이 갖는다.
  const owned = new Set<string>();
  const unique: GroupDraft[] = [];
  for (const draft of drafts) {
    const seqs = sortSeqs(draft.source_seqs).filter((seq) => !owned.has(seq));
    if (seqs.length === 0) continue;
    for (const seq of seqs) owned.add(seq);
    unique.push({ ...draft, source_seqs: seqs });
  }
  unique.sort((a, b) => compareSeq(a.source_seqs[0], b.source_seqs[0]));
  return unique.map((draft, ordinal) => ({
    ordinal,
    owner: draft.owner,
    target: draft.target,
    source_seqs: draft.source_seqs,
    capability: draft.capability,
    reason_blob: draft.reason === null ? null : REVERT_REASONS[draft.reason],
    comparison: draft.comparison,
    before_ref: draft.before_ref,
    dependencies: draft.dependencies,
    app_revert: null,
  }));
}

// 사람 결정에 고정하는 지문. run·전체 source seq·owner CAS·복원 기준·분류·남는 영향·의존이
// 하나라도 달라지면 달라진다. 준비 결과는 사람이 본 내용이 아니라서 넣지 않는다.
export function bindingHash(run: string, groups: readonly RevertGroup[]): string {
  return hashOf({
    run,
    groups: groups.map((group) => ({
      ordinal: group.ordinal,
      owner: group.owner,
      target: group.target,
      source_seqs: group.source_seqs,
      capability: group.capability,
      reason_blob: group.reason_blob,
      comparison: group.comparison,
      before_ref: group.before_ref,
      dependencies: group.dependencies,
    })),
  });
}

export function sourceKey(seqs: readonly string[]): string {
  return seqs.join(",");
}

// 입력의 묶음이 현재 판정과 같은 묶음 전체인지 본다. 준비 결과(`prepared`)는 owner의 복원
// 입력이라 비교 기준에서 뺀다.
export function stripPrepared(comparison: JsonObject): JsonObject {
  const rest: JsonObject = {};
  for (const [key, value] of Object.entries(comparison)) {
    if (key !== "prepared") rest[key] = value;
  }
  return rest;
}

export function matchInput(
  groups: readonly RevertGroup[],
  input: readonly RevertRunGroup[],
): Result<Map<string, RevertRunGroup>> {
  const byKey = new Map<string, RevertRunGroup>();
  for (const item of input) {
    const key = sourceKey(item.source_seqs);
    if (byKey.has(key)) {
      return err({
        code: "invalid_input",
        message: "a source group is sent twice",
      });
    }
    byKey.set(key, item);
  }
  if (byKey.size !== groups.length) {
    return err({
      code: "invalid_input",
      message: "the groups are not the whole run",
    });
  }
  for (const group of groups) {
    const item = byKey.get(sourceKey(group.source_seqs));
    if (
      item === undefined ||
      canonicalize(stripPrepared(item.comparison)) !==
        canonicalize(group.comparison ?? {})
    ) {
      return err({
        code: "invalid_input",
        message: "the groups do not match the previewed run",
      });
    }
  }
  return ok(byKey);
}

export type Decision =
  | { kind: "apply" }
  | { kind: "blocked"; reason: ReasonCode };

// 전체 사전 검사다. 충돌 하나, 동의 없는 복원 불가 영향, 의존 위반, 준비 불충족이 하나라도
// 있으면 어느 변경도 시작하지 않는다(R4, R7). allow_partial은 충돌·강제 병합의 허락이 아니다.
export function decide(
  groups: readonly RevertGroup[],
  allowPartial: boolean,
  readiness: ReadonlyMap<number, ReasonCode | null>,
): Decision {
  if (groups.some((group) => group.capability === "conflict")) {
    return { kind: "blocked", reason: "blocked_conflict" };
  }
  const irreversible = groups.filter((group) =>
    group.capability === "irreversible"
  );
  if (irreversible.length > 0 && !allowPartial) {
    return { kind: "blocked", reason: "blocked_irreversible" };
  }
  const left = new Set(
    irreversible.map((group) => `${group.owner}\u0000${group.target ?? ""}`),
  );
  for (const group of groups) {
    if (group.capability !== "reversible") continue;
    for (const dependency of group.dependencies) {
      if (left.has(`${dependency.owner}\u0000${dependency.target}`)) {
        return { kind: "blocked", reason: "blocked_dependency" };
      }
    }
  }
  for (const group of groups) {
    if (group.capability !== "reversible") continue;
    const reason = readiness.get(group.ordinal) ?? null;
    if (reason !== null) return { kind: "blocked", reason };
  }
  return { kind: "apply" };
}

export function hasRestorable(groups: readonly RevertGroup[]): boolean {
  return groups.some((group) => group.capability === "reversible");
}

export type ChangeResult = {
  ordinal: number;
  owner: string;
  target: string | null;
  source_seqs: string[];
  capability: Capability;
  result: ChangeOutcome;
  reason_blob: string | null;
  restored_seqs: string[];
  app_revert: null;
};

// 적용한 결과. 복원한 묶음은 restored이고 나머지는 분류 그대로다. 복원할 수 있었지만 전체가
// 막힌 묶음은 업무 변경으로 남아 있다는 뜻의 unchanged다(R3, R6).
export function resultsOf(
  groups: readonly RevertGroup[],
  restored: ReadonlyMap<number, string[]>,
  blocked: ReasonCode | null,
): ChangeResult[] {
  return groups.map((group) => {
    const base = {
      ordinal: group.ordinal,
      owner: group.owner,
      target: group.target,
      source_seqs: group.source_seqs,
      capability: group.capability,
      app_revert: null,
    };
    if (group.capability === "reversible") {
      const seqs = restored.get(group.ordinal);
      if (blocked === null && seqs !== undefined) {
        return {
          ...base,
          result: "restored" as const,
          reason_blob: null,
          restored_seqs: seqs,
        };
      }
      return {
        ...base,
        result: "unchanged" as const,
        reason_blob: REVERT_REASONS[blocked ?? "blocked_not_prepared"],
        restored_seqs: [],
      };
    }
    return {
      ...base,
      result: group.capability,
      reason_blob: group.reason_blob ?? REVERT_REASONS.unclassified_event,
      restored_seqs: [],
    };
  });
}

export function resultsHash(changes: readonly ChangeResult[]): string {
  return hashOf(changes);
}

export function headSeq(sql: Pick<Sql, "get">): string {
  const row = sql.get("select cast(coalesce(max(seq), 0) as text) as seq from events", []);
  return row === undefined ? "0" : String(row["seq"]);
}

export function seqsBetween(
  sql: Pick<Sql, "all">,
  after: string,
): string[] {
  return sql.all(
    "select cast(seq as text) as seq from events where seq > ? order by seq",
    [BigInt(after)],
  ).map((row) => String(row["seq"]));
}

export type RevertRecordRow = {
  id: string;
  run: string;
  allow_partial: boolean;
  outcome: Outcome;
  preview_hash: string;
  created_seq: string;
  state_seq: string;
  result_seq: string | null;
};

export function revertColumns(alias = ""): string {
  const prefix = alias === "" ? "" : `${alias}.`;
  return [
    `${prefix}id as id`,
    `${prefix}run as run`,
    `${prefix}allow_partial as allow_partial`,
    `${prefix}outcome as outcome`,
    `${prefix}preview_hash as preview_hash`,
    `cast(${prefix}created_seq as text) as created_seq`,
    `cast(${prefix}state_seq as text) as state_seq`,
    `cast(${prefix}result_seq as text) as result_seq`,
  ].join(", ");
}

export function revertRowOf(row: SqlRow): RevertRecordRow {
  return {
    id: String(row["id"]),
    run: String(row["run"]),
    allow_partial: Number(row["allow_partial"]) === 1,
    outcome: String(row["outcome"]) as Outcome,
    preview_hash: String(row["preview_hash"]),
    created_seq: String(row["created_seq"]),
    state_seq: String(row["state_seq"]),
    result_seq: row["result_seq"] === null ? null : String(row["result_seq"]),
  };
}

export function loadRevert(
  lookup: Lookup,
  id: string,
): RevertRecordRow | undefined {
  const row = lookup.sql.get(
    `select ${revertColumns()} from reverts where id = ?`,
    [id],
  );
  return row === undefined ? undefined : revertRowOf(row);
}

export function activeRevert(
  lookup: Lookup,
  run: string,
): RevertRecordRow | undefined {
  const row = lookup.sql.get(
    `select ${revertColumns()} from reverts where run = ?
       and outcome in ('applying', 'applied', 'partial', 'uncertain')`,
    [run],
  );
  return row === undefined ? undefined : revertRowOf(row);
}

export type RunRef = { id: string; assignment: string; state: string };

export function loadRunRef(lookup: Lookup, id: string): RunRef | undefined {
  const row = lookup.sql.get(
    "select id, assignment, state from runs where id = ?",
    [id],
  );
  return row === undefined ? undefined : {
    id: String(row["id"]),
    assignment: String(row["assignment"]),
    state: String(row["state"]),
  };
}
