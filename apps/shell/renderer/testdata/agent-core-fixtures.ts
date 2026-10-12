// Agent view core source test의 fixture. 값은 lophn-agent contract가 낸 모양이고 contractCore가 응답을
// output schema로 검사한다(sessions·messages·runs·questions·approvals·assignments·agents).
import { META } from "./contract-core.ts";

/** 모든 id는 `<접두사>_01k6q` 뒤에 번호를 붙인 26글자다. */
export const id = (prefix: string, n: number): string =>
  `${prefix}_01k6q${String(n).padStart(21, "0")}`;

export const PROJECT = id("prj", 1);
export const APP = id("app", 1);
export const LOPHN = id("asg", 1);
export const OPERATOR = id("asg", 2);
export const PROVIDER = id("pvd", 1);
export const SESSION = id("ses", 1);
export const SESSION_OTHER = id("ses", 2);

export const WORK_PLACE = { kind: "project", id: PROJECT } as const;

export function at(seconds: number): string {
  return new Date(Date.parse("2026-10-06T09:00:00.000Z") + seconds * 1000)
    .toISOString();
}

export const SONNET = {
  provider: PROVIDER,
  model_name: "Sonnet 5.5",
  option_values: { effort: "medium" },
};
export const HAIKU = {
  provider: PROVIDER,
  model_name: "Haiku 5.5",
  option_values: {},
};

export function assignment(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: LOPHN,
    role: "lophn",
    scope: { kind: "all", id: null },
    state: "enabled",
    pause_reason: null,
    revision: 3,
    ...over,
  };
}

export function session(
  n: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: id("ses", n),
    assignment: LOPHN,
    work_place: WORK_PLACE,
    title: null,
    archived: false,
    state: "open",
    forked_from: null,
    opening_context: null,
    model_selection: null,
    compaction: null,
    closed_reason: null,
    closed_at: null,
    state_seq: String(10 * n),
    ...over,
  };
}

export function message(
  n: number,
  over: Record<string, unknown> = {},
  created = 20 + n,
): Record<string, unknown> {
  const actor = (over.actor as string | undefined) ?? "user";
  return {
    message: {
      id: id("msg", n),
      session: SESSION,
      actor,
      body: String(n).padStart(64, "a"),
      run: id("run", 1),
      mode: actor === "user" ? "request" : null,
      applied_at_call: null,
      links: [],
      copied_from: null,
      ...over,
    },
    created_seq: String(created),
    state_seq: String(created),
  };
}

export function run(
  n: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const finished = over.state === "finished";
  return {
    id: id("run", n),
    assignment: LOPHN,
    session: SESSION,
    source: { kind: "message", message: id("msg", n) },
    continued_from: null,
    start_after: null,
    start_confirmed_seq: null,
    state: "running",
    basis: "b".repeat(64),
    waiting_on: null,
    started_at: at(0),
    limits: { model_attempts: 30, stall_ms: 300000, active_ms: 1800000 },
    elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
    finished_at: finished ? at(18) : null,
    outcome: finished
      ? { kind: "completed", reason: "answer_completed" }
      : null,
    result: finished ? "c".repeat(64) : null,
    state_seq: String(30 + n),
    accepted_seq: String(20 + n),
    ...over,
  };
}

export function questionGroup(
  n: number,
  over: Record<string, unknown> = {},
  question: Record<string, unknown> = {},
): Record<string, unknown> {
  const group = id("qgr", n);
  return {
    id: group,
    run: id("run", 1),
    session: SESSION,
    expires_at: null,
    status: "pending",
    closed_reason: null,
    closed_reason_blob: null,
    created_seq: String(40 + n),
    closed_seq: null,
    questions: [{
      id: id("qst", n),
      group,
      position: 1,
      prompt_blob: "d".repeat(64),
      reason_blob: "e".repeat(64),
      options: [
        {
          key: "weekly",
          label: "Weekly",
          evidence: [],
          adoption: null,
          action: null,
          description_blob: "f".repeat(64),
        },
        {
          key: "daily",
          label: "Daily",
          evidence: [],
          adoption: null,
          action: null,
          description_blob: "1".repeat(64),
        },
      ],
      recommendation: {
        option_key: "weekly",
        explanation_blob: "2".repeat(64),
      },
      answer: null,
      applied: false,
      ...question,
    }],
    ...over,
  };
}

export function questionText(n: number, answerText: string | null = null) {
  return {
    group: id("qgr", n),
    questions: [{
      question: id("qst", n),
      prompt: "How often should the report run?",
      reason: "The schedule decides when it is written.",
      options: [
        { key: "weekly", description: "Every Monday" },
        { key: "daily", description: "Every morning" },
      ],
      recommendation: {
        option_key: "weekly",
        explanation: "Matches the team.",
      },
      answer_text: answerText,
    }],
    closed_reason_text: null,
    ...META,
  };
}

export function approval(
  n: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: id("apr", n),
    requester: "machine",
    run: id("run", 1),
    reason_blob: "3".repeat(64),
    effect: {
      changes_blob: "4".repeat(64),
      external_blob: null,
      reversible: true,
      reversibility_blob: "5".repeat(64),
    },
    action: {
      concern: "lophn-agent",
      command: "document.save_version",
      caller: `agent:${LOPHN}`,
      targets: [id("doc", 1)],
      input: { kind: "inline", value: {} },
      input_hash: "6".repeat(64),
      comparison: {},
      binding_hash: "7".repeat(64),
    },
    expires_at: null,
    session_grantable: true,
    status: "pending",
    grant_scope: null,
    grant_session: null,
    closed_reason_blob: null,
    created_seq: String(50 + n),
    closed_seq: null,
    ...over,
  };
}

export function toolCall(
  n: number,
  tool: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: id("tcl", n),
    run: id("run", 1),
    model_call: id("mcl", 1),
    response_key: `r${n}`,
    response_order: n,
    tool,
    definition_revision: "1",
    effect: "read",
    app_command: null,
    confirm: false,
    extension: null,
    input: "8".repeat(64),
    output: "9".repeat(64),
    retry_of: null,
    attempt: 0,
    retry_at: null,
    decision: null,
    state: "finished",
    started_at: at(n),
    finished_at: at(n + 1),
    duration_ms: 1000,
    outcome: { kind: "success", code: "ok" },
    ...over,
  };
}

export function listed<K extends string>(key: K, rows: readonly unknown[]) {
  return { [key]: rows, ...META } as
    & Record<K, readonly unknown[]>
    & typeof META;
}
