// lophn-agent/harness/run-loop: 수정 입력의 처음 반영(ApplyMessages)은 ModelCall 시작과 같은 transaction이다
// (Q30). 실제 core(임시 LOPHN_HOME, 실제 ledger)에서 시작이 반영과 함께 남거나 함께 남지 않는지 본다.
import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import { call, command, count, inspect } from "./testing/approvals-fixture.ts";
import {
  acceptCredential,
  context,
  openWaitingWorld,
} from "./testing/waiting-world.ts";

const PVD = "pvd_01arz3ndektsv4rrffq69g5fav";
const MACHINE = "m".repeat(43);
const USER = "n".repeat(43);

function modelCall(run: string, session: string, id: string) {
  return {
    id,
    run,
    session,
    model_use: "judgment",
    agent_hash: "ab".repeat(32),
    purpose: "judgment",
    attempt_kind: "initial",
    attempt_order: 1,
    retry_of: null,
    model: {
      provider: PVD,
      name: "fixture-model",
      protocol: "anthropic-messages",
      credential_revision: null,
      options: {},
      option_values: { requested: {}, applied: {} },
      limits: {
        context_limit: 1000,
        input_limit: 900,
        output_limit: 100,
        supports_tools: true,
      },
      catalog_basis: {},
      price_basis: null,
      billing_route: "api",
    },
    input: "a".repeat(64),
    context_basis: "b".repeat(64),
    output: null,
    state: "started",
    started_at: "2024-01-01T00:00:00.000Z",
    finished_at: null,
    duration_ms: null,
    first_output_ms: null,
    outcome: null,
    usage: {
      input: null,
      output: null,
      cache_read: null,
      cache_write: null,
      reasoning: null,
      cache_in_input: null,
      reasoning_in_output: null,
      definition_revision: "usage-1",
    },
    cost: {
      kind: "unknown",
      amount: null,
      currency: null,
      basis: null,
      confirmed_at: null,
    },
  };
}

Deno.test("lophn-agent/harness/run-loop#R10: 수정 입력의 처음 반영은 ModelCall 시작과 같은 transaction이고 반영이 거절되면 시작 기록도 남지 않는다", async () => {
  const world = await openWaitingWorld();
  try {
    await acceptCredential(
      world.core,
      context("machine", ["StartModelCall"], {}, "calls"),
      MACHINE,
    );
    await acceptCredential(
      world.core,
      context(
        "user",
        ["RegisterProvider", "ReceiveMessage", "ReadSession"],
        {},
        "u2",
      ) as AuthenticatedContext,
      USER,
    );
    const registered = await call(
      world.server,
      "providers/register",
      USER,
      command({
        id: PVD,
        name: "fixture",
        definition: {
          key: "anthropic",
          display_name: "Anthropic",
          protocols: ["anthropic-messages"],
          auth_kinds: ["none"],
          models_endpoint: null,
          oauth: null,
          revision: "2026-01-01",
        },
        endpoint: "http://127.0.0.1:9",
        protocol: "anthropic-messages",
        credential: { kind: "none", preparation: null },
      }),
    );
    assertEquals(registered.status, 200, JSON.stringify(registered.body));
    const seat = world.lophn;
    const state = await call(world.server, "sessions/read", USER, {
      session: seat.session,
    });
    const correction = "msg_01arz3ndektsv4rrffq69g5faw";
    const sent = await call(
      world.server,
      "messages/receive",
      USER,
      command({
        id: correction,
        session: seat.session,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: "Please also check apps." }],
        },
        mode: "correction",
        run: seat.run,
      }, {
        compare: {
          session_state: "open",
          session_state_seq:
            (state.body as { session: { state_seq: string } }).session
              .state_seq,
          assignment_revision: seat.assignment.revision,
          assignment_state: "enabled",
        },
      }),
    );
    assertEquals(sent.status, 200, JSON.stringify(sent.body));
    const start = (id: string, applied: string[]) =>
      call(
        world.server,
        "model-calls/start",
        MACHINE,
        command({
          call: modelCall(seat.run, seat.session, id),
          applied_messages: applied,
          state_seq: "1",
        }, { compare: { state_seq: "1" } }),
      );
    const unapplied =
      `select count(*) as n from messages where run = '${seat.run}' and mode = 'correction' and applied_at_call is null`;
    assertEquals(count(world.server, unapplied), 1);
    // 반영이 거절되는 시작(없는 메시지)은 시작 기록도 남기지 않는다.
    const refused = await start("mcl_01arz3ndektsv4rrffq69g5fax", [
      "msg_01arz3ndektsv4rrffq69g5fzz",
    ]);
    assert(refused.status !== 200);
    assertEquals(
      count(world.server, "select count(*) as n from model_calls"),
      0,
    );
    assertEquals(count(world.server, unapplied), 1);
    const first = "mcl_01arz3ndektsv4rrffq69g5fay";
    const applied = await start(first, [correction]);
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(count(world.server, unapplied), 0);
    assertEquals(
      inspect(
        world.server,
        "select applied_at_call from messages where id = ?",
        [correction],
      )[0]!["applied_at_call"],
      first,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("platform/blob-store#R4: 준비하지 않은 hash는 영구 참조가 되지 못하고 기록 command가 통째로 거절된다", async () => {
  const world = await openWaitingWorld();
  try {
    await acceptCredential(
      world.core,
      context(
        "machine",
        ["StartModelCall", "RecordToolRequest"],
        {},
        "calls",
      ),
      MACHINE,
    );
    await acceptCredential(
      world.core,
      context("user", ["RegisterProvider"], {}, "u2") as AuthenticatedContext,
      USER,
    );
    const registered = await call(
      world.server,
      "providers/register",
      USER,
      command({
        id: PVD,
        name: "fixture",
        definition: {
          key: "anthropic",
          display_name: "Anthropic",
          protocols: ["anthropic-messages"],
          auth_kinds: ["none"],
          models_endpoint: null,
          oauth: null,
          revision: "2026-01-01",
        },
        endpoint: "http://127.0.0.1:9",
        protocol: "anthropic-messages",
        credential: { kind: "none", preparation: null },
      }),
    );
    assertEquals(registered.status, 200, JSON.stringify(registered.body));
    const seat = world.lophn;
    const started = await call(
      world.server,
      "model-calls/start",
      MACHINE,
      command({
        call: modelCall(
          seat.run,
          seat.session,
          "mcl_01arz3ndektsv4rrffq69g5faz",
        ),
        applied_messages: [],
        // 이 hash를 준비한 적이 없다.
        blob_sizes: { input: 10, context_basis: 10 },
        state_seq: "1",
      }, { compare: { state_seq: "1" } }),
    );
    assert(started.status !== 200, JSON.stringify(started.body));
    assertEquals(
      count(world.server, "select count(*) as n from model_calls"),
      0,
    );
    const requested = await call(
      world.server,
      "tool-calls/request",
      MACHINE,
      command({
        id: "tcl_01arz3ndektsv4rrffq69g5fav",
        run: seat.run,
        model_call: "mcl_01arz3ndektsv4rrffq69g5fav",
        response_key: "k1",
        response_order: 0,
        tool: "project.list",
        definition_revision: "1",
        effect: "read",
        confirm: false,
        extension: null,
        input: "c".repeat(64),
        input_size: 2,
        retry_of: null,
        attempt: 0,
      }, { compare: { run_state_seq: "0", model_call_finished_seq: "0" } }),
    );
    assert(requested.status !== 200, JSON.stringify(requested.body));
    assertEquals(
      count(world.server, "select count(*) as n from tool_calls"),
      0,
    );
  } finally {
    await world.dispose();
  }
});
