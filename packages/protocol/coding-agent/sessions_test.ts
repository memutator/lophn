import { assert, assertEquals } from "@std/assert";
import { commandRequestSchema } from "../base/envelope.ts";
import { routePath } from "../base/route.ts";
import { type At, atSchema } from "../base/values.ts";
import { connectionPrincipal } from "./connections.ts";
import {
  codingAgentSessionSummary,
  codingAgentSessionSummaryOutputSchema,
  CodingAgentSessionSummarySchema,
  EVIDENCE_SOURCES,
  FRESHNESS,
  harnessSessionObservationSchema,
  LOPHN_CONNECTION,
  LOPHN_TERMINAL_OBSERVE,
  OBSERVATION_ORIGINS,
  observeEnvelopeSchema,
  providerSessionMetadataSchema,
  SESSION_ROUTES,
  SESSION_STATES,
  sessionStateSchema,
} from "./sessions.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const TKT = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
const AT: At = "2026-10-05T00:00:00.000Z";
const META = { as_of_seq: "4", next_cursor: null };

const allScope = { kind: "all" as const, app: null };

const observation = {
  harness_id: "claude",
  environment: { kind: "host" as const, identity: "work" },
  profile_id: null,
  catalog_revision: "rev-1",
  adapter_revision: "rev-1",
  origin: "lophn_terminal" as const,
  runtime_ref: "term-1",
  connection: CAC,
  ticket: TKT,
  cwd: "/work/app",
  provider_session: {
    kind: "claude_code",
    id: "sess-1",
    transcript_path: "/home/u/.claude/sess-1.jsonl",
    source: "hook" as const,
    acquired_at: AT,
  },
  state: "ready" as const,
  observed_at: AT,
  evidence_source: "hook" as const,
  evidence_ref: "hook/session_start",
  freshness: "fresh" as const,
  reason: null,
};

Deno.test(
  "coding-agent/sessions#R6, coding-agent/sessions#R7: 상태·출처·freshness는 문서 여섯·일곱·둘과 같다",
  () => {
    assertEquals(SESSION_STATES, [
      "starting",
      "ready",
      "working",
      "waiting_input",
      "ended",
      "unknown",
    ]);
    assertEquals(OBSERVATION_ORIGINS, ["lophn_terminal", "external_terminal"]);
    assertEquals(EVIDENCE_SOURCES, [
      "hook",
      "plugin",
      "extension",
      "protocol",
      "output",
      "process",
      "launch",
    ]);
    assertEquals(FRESHNESS, ["fresh", "stale"]);
    assertEquals(sessionStateSchema.safeParse("claiming").success, false);
  },
);

Deno.test(
  "coding-agent/sessions#R6: 예시 observation이 통과하고 unknown에는 이유가 필수다",
  () => {
    assertEquals(
      harnessSessionObservationSchema.parse(observation).state,
      "ready",
    );
    const lost = harnessSessionObservationSchema.parse({
      ...observation,
      provider_session: null,
      connection: null,
      ticket: null,
      cwd: null,
      runtime_ref: null,
      state: "unknown",
      reason: "collection lost after restart",
    });
    assertEquals(lost.connection, null);
    assert(
      !harnessSessionObservationSchema.safeParse({
        ...observation,
        state: "unknown",
        reason: null,
      }).success,
    );
    assert(
      !harnessSessionObservationSchema.safeParse({
        ...observation,
        evidence_source: "guess",
      }).success,
    );
    assert(atSchema.safeParse(observation.observed_at).success);
  },
);

Deno.test(
  "coding-agent/sessions#R7: provider session metadata는 evidence에서만 얻는다",
  () => {
    assertEquals(
      providerSessionMetadataSchema.parse(observation.provider_session).id,
      "sess-1",
    );
    assert(!providerSessionMetadataSchema.safeParse("").success);
    assert(
      !providerSessionMetadataSchema.safeParse({
        ...observation.provider_session,
        id: "",
      }).success,
    );
    assert(
      !providerSessionMetadataSchema.safeParse({
        ...observation.provider_session,
        id: "-leading dash",
      }).success,
    );
    assert(
      !providerSessionMetadataSchema.safeParse({
        ...observation.provider_session,
        id: "bad\u0000control",
      }).success,
    );
    assert(
      !providerSessionMetadataSchema.safeParse({
        ...observation.provider_session,
        id: "-".repeat(1_025),
      }).success,
    );
  },
);

Deno.test(
  "coding-agent/sessions#R6: 관측 socket envelope은 host가 runtime_ref·generation을 붙인다",
  () => {
    const envelope = observeEnvelopeSchema.parse({
      runtime_ref: "term-1",
      generation: 3,
      observation,
    });
    assertEquals(envelope.generation, 3);
    assert(
      !observeEnvelopeSchema.safeParse({ generation: 3, observation }).success,
    );
    assert(
      !observeEnvelopeSchema.safeParse({
        runtime_ref: "term-1",
        generation: -1,
        observation,
      }).success,
    );
    assertEquals(LOPHN_TERMINAL_OBSERVE, "LOPHN_TERMINAL_OBSERVE");
    assertEquals(LOPHN_CONNECTION, "LOPHN_CONNECTION");
  },
);

Deno.test(
  "coding-agent/sessions#R3: summary route와 출력은 architecture 5.3과 같다",
  () => {
    assertEquals(
      SESSION_ROUTES.map((route) => [route.kind, routePath(route)]),
      [["read", "/v1/coding_agent_sessions/summary"]],
    );
    assertEquals(codingAgentSessionSummary.actors, ["coding_agent"]);
    assertEquals(codingAgentSessionSummary.errors, [
      "invalid_input",
      "unauthorized",
      "forbidden",
      "not_found",
      "unavailable",
    ]);
    const summary = CodingAgentSessionSummarySchema.parse({
      connection: CAC,
      scope: allScope,
      observed_seq: "12",
      observed_at: AT,
      problems: [],
      tickets: [],
      claims: [],
      remaining_checks: [],
      project: PRJ,
      folder: "/work/app",
      claim_rule: "claim only the ticket the human named",
      next_cursor: null,
    });
    assertEquals(
      "summary" in codingAgentSessionSummaryOutputSchema.shape,
      true,
    );
    const output = codingAgentSessionSummaryOutputSchema.parse({
      ...META,
      summary,
    });
    assert("summary" in output);
    const request = commandRequestSchema(codingAgentSessionSummary).parse({
      input: { app: APP, cursor: "next-1" },
      idempotency_key: "summary-1",
      compare: {},
      prepared: [],
    });
    assertEquals(request.input.app, APP);
    assertEquals(connectionPrincipal(CAC), `coding_agent:${CAC}`);
  },
);
