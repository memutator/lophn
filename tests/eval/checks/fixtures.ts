// case 작성자가 right/wrong fixture를 짧게 쓰는 builder. 기록은 zod를 통과시키지 않고 type으로 한 번 cast한다.
import type {
  AgentCallRecord,
  AgentRef,
  CallFailReason,
  CallReply,
  ToolCall,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import type {
  CollectedToolCall,
  Participant,
  PlaceName,
  SentCall,
  SessionRecord,
  TrialRecord,
} from "../types.ts";

const AT = "2026-01-01T00:00:00.000Z";

export type FixtureCall = {
  to: Participant;
  reply: CallReply;
  fail?: "denied" | "not_found" | "not_allowed" | "closed";
  body?: string;
};

export type FxStep =
  | {
    tool: string;
    effect?: "read" | "write" | "external";
    outcome?: "success" | "failure" | "not_executed";
    code?: string;
    input?: unknown;
    output?: unknown;
  }
  | { call: FixtureCall };

function placeName(p: Participant): PlaceName | null {
  const place = p.place;
  if (place === undefined) return null;
  if ("app" in place) {
    return { kind: "app", id: `app_fx_${place.app}`, name: place.app };
  }
  return {
    kind: "project",
    id: `prj_fx_${place.project}`,
    name: place.project,
  };
}

function refOf(p: Participant): AgentRef {
  const place = placeName(p);
  switch (p.role) {
    case "lophn":
      return { role: "lophn" };
    case "project_manager":
      return { role: "project_manager", project: place!.id } as AgentRef;
    case "operator":
      return { role: "operator", agent: `agt_fx_${p.name ?? ""}` } as AgentRef;
    case "app_engineer":
      return { role: "app_engineer", app: place!.id } as AgentRef;
  }
}

function sessionOf(p: Participant): string {
  return `ses_fx_${p.role}_${placeName(p)?.name ?? p.name ?? ""}`;
}

export function fixtureTrial(sessions: SessionRecord[]): TrialRecord {
  return {
    index: 0,
    started_at: AT,
    finished_at: AT,
    settle: { kind: "idle", unstarted: [] },
    sessions,
    metrics: {
      tokens: {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        reasoning: 0,
        unknown_calls: 0,
      },
      input_total: 0,
      cache_hit_rate: null,
      cost_usd: 0,
      unpriced_calls: 0,
      time_ms: { turns: 0, model_calls: 0 },
      tools: {
        counted: 0,
        excluded: 0,
        format: 0,
        success: 0,
        blocked: 0,
        repeated_calls: 0,
        repeat_groups: 0,
        max_repeat: 0,
        repeated_failure_turns: 0,
      },
      truncated_calls: 0,
      agent_calls: [],
    },
  };
}

export function fixtureAppCreate(name: string): FxStep {
  return {
    tool: "app.create",
    effect: "write",
    input: { name, purpose: `${name} fixture` },
    output: { status: "success", content: { id: `app_fx_${name}` } },
  };
}

// id는 steps 순서로 매긴다. 한 session 안에서 id 순이 시간 순이다.
export function fixtureSession(
  agent: Participant,
  steps: FxStep[],
): SessionRecord {
  const session = sessionOf(agent);
  const tool_calls: CollectedToolCall[] = [];
  const sent_calls: SentCall[] = [];

  const toolCall = (
    i: number,
    f: {
      tool: string;
      effect: "read" | "write" | "external";
      kind: "success" | "failure" | "not_executed";
      code: string;
    },
  ): ToolCall =>
    ({
      id: `tcl_fx_${String(i).padStart(4, "0")}`,
      turn: "trn_fx",
      model_call: "mcl_fx",
      response_key: `fx_${i}`,
      response_order: 0,
      tool: f.tool,
      definition_revision: "fx",
      effect: f.effect,
      app_tool: null,
      confirm: false,
      extension: null,
      input: "fx",
      output: f.kind === "not_executed" ? null : "fx",
      retry_of: null,
      attempt: 0,
      retry_at: null,
      decision: null,
      state: "finished",
      started_at: AT,
      finished_at: AT,
      duration_ms: 0,
      outcome: { kind: f.kind, code: f.code },
    }) as ToolCall;

  steps.forEach((step, i) => {
    if (!("call" in step)) {
      const kind = step.outcome ?? "success";
      tool_calls.push({
        call: toolCall(i, {
          tool: step.tool,
          effect: step.effect ?? "read",
          kind,
          code: step.code ??
            (kind === "success"
              ? "ok"
              : kind === "failure"
              ? "failed"
              : "denied"),
        }),
        input: step.input ?? null,
        output: step.output ?? null,
        body_truncated: false,
      });
      return;
    }

    const { to, reply, fail, body = "fixture" } = step.call;
    const input = { to, reply, body, refs: [] };
    const base = { tool: "call", effect: "read" as const };
    const receiver = refOf(to);
    const sent = {
      tool_call: `tcl_fx_${String(i).padStart(4, "0")}`,
      order: sent_calls.length,
      to,
      reply,
      body,
    };
    const record = (
      state: "accepted" | "failed",
      reason: CallFailReason | null,
    ) =>
      ({
        call: `cal_fx_${i}`,
        from: { kind: "agent", session },
        to: { kind: "new_session", agent: receiver },
        receiver_session: state === "failed" ? null : `ses_fx_to_${i}`,
        reply,
        state,
        fail_reason: reason,
        dedup: null,
        created_at: AT,
        state_changed_at: AT,
      }) as AgentCallRecord;
    const done = (
      kind: "success" | "failure" | "not_executed",
      code: string,
      output: unknown,
    ) =>
      tool_calls.push({
        call: toolCall(i, { ...base, kind, code }),
        input,
        output,
        body_truncated: false,
      });

    if (fail === "denied") {
      done("not_executed", "denied", null);
      sent_calls.push({
        ...sent,
        outcome: { kind: "not_executed", code: "denied" },
        call: null,
        state: null,
        fail_reason: null,
        record: null,
        receiver: null,
        receiver_session: null,
        receiver_place: null,
      });
    } else if (fail === "not_found") {
      done("failure", "not_found", null);
      sent_calls.push({
        ...sent,
        outcome: { kind: "failure", code: "not_found" },
        call: null,
        state: null,
        fail_reason: null,
        record: null,
        receiver: null,
        receiver_session: null,
        receiver_place: null,
      });
    } else {
      const failed = fail !== undefined;
      const state = failed ? "failed" : "accepted";
      const reason = failed ? fail : null;
      const rec = record(state, reason);
      done("success", "ok", {
        status: "success",
        content: { call: rec.call, state, fail_reason: reason },
      });
      sent_calls.push({
        ...sent,
        outcome: { kind: "success", code: "ok" },
        call: rec.call,
        state,
        fail_reason: reason,
        record: rec,
        receiver: failed ? null : receiver,
        receiver_session: rec.receiver_session,
        receiver_place: failed ? null : placeName(to),
      });
    }
  });

  return {
    session,
    agent: refOf(agent),
    place: placeName(agent),
    turns: [],
    model_calls: [],
    tool_calls,
    sent_calls,
  };
}
