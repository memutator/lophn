import type { TurnTrace } from "../../../protocol/lophn-agent/mod.ts";

// trace는 저장하지 않는다. 조회 때 읽은 원본 사실(turn·event·ModelCall·ToolCall·message 참조)에서
// 순수하게 조립한다. IO와 SQL은 reads.ts가 한다. 본문·오류 원문·추론은 입력에 없고 따라서
// 출력에도 없다.

export type EventFacts = { seq: string };

export type ModelFacts = {
  id: string;
  attempt_order: number;
  state: "started" | "finished";
  outcome_kind:
    | "complete"
    | "partial"
    | "failed"
    | "cancelled"
    | "uncertain"
    | null;
  duration_ms: number | null;
  first_output_ms: number | null;
  input: string;
  context_basis: string;
  output: string | null;
};

export type ToolFacts = {
  id: string;
  state: "requested" | "started" | "finished";
  outcome_kind: "success" | "failure" | "not_executed" | "uncertain" | null;
  decision: "allow" | "ask" | "deny" | null;
  external: boolean;
  duration_ms: number | null;
  input: string;
  output: string | null;
};

export type MessageFacts = { id: string; body: string };

// 시작·상태·종료 확인은 turn 하나를 기준으로 할 때만 있다. 독립 호출 trace에는 turn 사실이 없다.
export type TurnFacts = {
  id: string;
  session: string;
  state: "running" | "finished";
  basis: string | null;
  started_at: string | null;
  finished_at: string | null;
  outcome: TurnTrace["reason"];
  result: string | null;
  // CheckpointTurn이 남긴 단조 누적값이다.
  elapsed_active_ms: number;
};

type TraceInput = {
  turn: TurnFacts | null;
  // turn 없이 호출 하나를 기준으로 할 때의 실제 연결(없으면 null). 가짜 turn·session을 만들지 않는다.
  call: { turn: string | null; session: string | null };
  events: readonly EventFacts[];
  messages: readonly MessageFacts[];
  models: readonly ModelFacts[];
  tools: readonly ToolFacts[];
  // `${owner_key}\u0000${hash}` 형태의 등록된 영구 참조.
  refs: ReadonlySet<string>;
  // 시작 event는 있지만 기록 행이 없는 호출.
  unrecorded: { models: readonly string[]; tools: readonly string[] };
};

export function refKey(ownerKey: string, hash: string): string {
  return `${ownerKey}\u0000${hash}`;
}

function sum(values: readonly (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function activityOf(
  models: readonly ModelFacts[],
  tools: readonly ToolFacts[],
): TurnTrace["activity"] {
  const ids = (picked: readonly { id: string }[]) => picked.map((m) => m.id);
  const byOutcome = (kind: ModelFacts["outcome_kind"]) =>
    ids(
      models.filter((m) => m.state === "finished" && m.outcome_kind === kind),
    );
  const finishedTools = tools.filter((t) => t.state === "finished");
  const byKind = (kind: ToolFacts["outcome_kind"]) =>
    finishedTools.filter((t) => t.outcome_kind === kind);
  // 거절은 판정이 deny인 미실행이다. 사람이 거절·만료한 승인과 재검사 실패는 판정이 deny가 아니므로
  // 그냥 미실행이다. 끝났다는 사실만으로는 성공으로 세지 않는다.
  const notExecuted = byKind("not_executed");
  return {
    model: {
      attempts: models.length,
      failed: byOutcome("failed"),
      partial: byOutcome("partial"),
      cancelled: byOutcome("cancelled"),
      uncertain: byOutcome("uncertain"),
      unfinished: ids(models.filter((m) => m.state !== "finished")),
    },
    tools: {
      steps: tools.length,
      succeeded: byKind("success").length,
      failed: ids(byKind("failure")),
      denied: ids(notExecuted.filter((t) => t.decision === "deny")),
      not_executed: ids(notExecuted.filter((t) => t.decision !== "deny")),
      uncertain: ids(byKind("uncertain")),
      unfinished: ids(tools.filter((t) => t.state !== "finished")),
      external: ids(tools.filter((t) => t.external)),
    },
  };
}

function missingOf(input: TraceInput): TurnTrace["missing"] {
  const missing: TurnTrace["missing"] = [];
  const record = (reference: string, reason: string) =>
    missing.push({ kind: "record", reference, reason });
  const body = (owner: string, field: string, hash: string | null) => {
    if (hash !== null && !input.refs.has(refKey(owner, hash))) {
      missing.push({
        kind: "body",
        reference: `${owner}:${field}`,
        reason: "reference_not_registered",
      });
    }
  };
  const { turn } = input;
  if (turn !== null) {
    if (turn.state !== "finished") record(turn.id, "end_not_confirmed");
    body(turn.id, "basis", turn.basis);
    body(turn.id, "result", turn.result);
    // 시도 번호는 1부터 빈틈이 없다. 빈 번호는 기록 누락이다.
    const seen = new Set(input.models.map((m) => m.attempt_order));
    const last = Math.max(0, ...seen);
    for (let order = 1; order <= last; order++) {
      if (!seen.has(order)) {
        record(`${turn.id}#attempt-${order}`, "attempt_record_absent");
      }
    }
  }
  for (const id of input.unrecorded.models) record(id, "model_call_absent");
  for (const id of input.unrecorded.tools) record(id, "tool_call_absent");
  for (const model of input.models) {
    if (model.state !== "finished") record(model.id, "result_not_recorded");
    body(model.id, "input", model.input);
    body(model.id, "context_basis", model.context_basis);
    body(model.id, "output", model.output);
  }
  for (const tool of input.tools) {
    if (tool.state !== "finished") record(tool.id, "result_not_recorded");
    body(tool.id, "input", tool.input);
    body(tool.id, "output", tool.output);
  }
  for (const message of input.messages) body(message.id, "body", message.body);
  return missing;
}

export function assembleTrace(input: TraceInput): TurnTrace {
  const { turn, models, tools } = input;
  const modelMs = sum(models.map((m) => m.duration_ms));
  const toolMs = sum(tools.map((t) => t.duration_ms));
  // active는 사람 기다림을 뺀 누적값이고, wall은 시작부터 끝까지다. 끝나지 않은 turn은 wall을 모른다.
  const active = turn === null ? modelMs + toolMs : turn.elapsed_active_ms;
  const wall =
    turn !== null &&
    turn.state === "finished" &&
    turn.started_at !== null &&
    turn.finished_at !== null
      ? Math.max(0, Date.parse(turn.finished_at) - Date.parse(turn.started_at))
      : active;
  const firstOutput =
    [...models]
      .sort((a, b) => a.attempt_order - b.attempt_order)
      .find((m) => m.first_output_ms !== null)?.first_output_ms ?? null;
  return {
    turn: turn?.id ?? input.call.turn,
    session: turn?.session ?? input.call.session,
    state: turn?.state ?? null,
    started_at: turn?.started_at ?? null,
    finished_at: turn?.finished_at ?? null,
    basis: turn?.basis ?? null,
    events: input.events.map((event) => event.seq),
    messages: input.messages.map((message) => message.id),
    model_calls: models.map((m) => m.id),
    tool_calls: tools.map((t) => t.id),
    // 지금 turn 표에는 handoff 보낸 쪽을 가리키는 열이 없어 연결을 만들 수 없다.
    handoff_links: [],
    activity: activityOf(models, tools),
    times: {
      wall_ms: wall,
      active_ms: active,
      model_ms: modelMs,
      first_output_ms: firstOutput,
      tool_ms: toolMs,
    },
    // 종료 확인이 없으면 null이다. 정상 종료로 올리지 않는다.
    reason: turn?.state === "finished" ? turn.outcome : null,
    missing: missingOf(input),
  };
}

// session 하나의 turn trace들을 한 묶음으로 합친다. turn·종료는 하나가 아니므로 비운다.
export function mergeTraces(
  session: string,
  traces: readonly TurnTrace[],
): TurnTrace {
  const seqs = new Set<string>();
  for (const trace of traces) for (const seq of trace.events) seqs.add(seq);
  const all = <T>(pick: (trace: TurnTrace) => readonly T[]): T[] =>
    traces.flatMap(pick);
  const sumTimes = (key: keyof TurnTrace["times"]) =>
    sum(traces.map((trace) => trace.times[key]));
  const finished = traces.every((trace) => trace.finished_at !== null);
  return {
    turn: null,
    session,
    state: null,
    started_at:
      traces.find((trace) => trace.started_at !== null)?.started_at ?? null,
    finished_at:
      finished && traces.length > 0
        ? traces[traces.length - 1]!.finished_at
        : null,
    basis: null,
    events: [...seqs].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)),
    messages: all((t) => t.messages),
    model_calls: all((t) => t.model_calls),
    tool_calls: all((t) => t.tool_calls),
    handoff_links: [],
    activity: {
      model: {
        attempts: sum(traces.map((t) => t.activity.model.attempts)),
        failed: all((t) => t.activity.model.failed),
        partial: all((t) => t.activity.model.partial),
        cancelled: all((t) => t.activity.model.cancelled),
        uncertain: all((t) => t.activity.model.uncertain),
        unfinished: all((t) => t.activity.model.unfinished),
      },
      tools: {
        steps: sum(traces.map((t) => t.activity.tools.steps)),
        succeeded: sum(traces.map((t) => t.activity.tools.succeeded)),
        failed: all((t) => t.activity.tools.failed),
        denied: all((t) => t.activity.tools.denied),
        not_executed: all((t) => t.activity.tools.not_executed),
        uncertain: all((t) => t.activity.tools.uncertain),
        unfinished: all((t) => t.activity.tools.unfinished),
        external: all((t) => t.activity.tools.external),
      },
    },
    times: {
      wall_ms: sumTimes("wall_ms"),
      active_ms: sumTimes("active_ms"),
      model_ms: sumTimes("model_ms"),
      first_output_ms:
        traces.find((trace) => trace.times.first_output_ms !== null)?.times
          .first_output_ms ?? null,
      tool_ms: sumTimes("tool_ms"),
    },
    reason: null,
    missing: all((t) => t.missing),
  };
}
