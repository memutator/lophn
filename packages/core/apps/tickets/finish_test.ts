// ticket 완료 보고·취소 테스트(coding-agent/tickets#R15, R17, R22, R23).
// fixture transaction으로 접수·취소 전이와 거절 경계를 본다. blob 등록은
// fixture의 preparedBlobs 목록으로, release·verification 참조는 같은
// transaction의 seed insert로 본다. 실제 executor 경로는 finish-executor_test.ts다.
import { assert, assertEquals } from "@std/assert";
import { createTicketClaimCommands } from "./claims.ts";
import { createTicketCommands } from "./commands.ts";
import {
  APP,
  DOC,
  OTHER_APP,
  QUESTION,
  ticketFixture,
  userContext,
  VER,
} from "./fixture.ts";
import { createTicketFinishCommands } from "./report.ts";

const START = Date.parse("2026-10-05T00:00:00.000Z");
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const CAC_B = "cac_01arz3ndektsv4rrffq69g5faw";
const DIGEST = "a".repeat(64);
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const REL_OTHER = "rel_01arz3ndektsv4rrffq69g5faw";
const HASH = "ab".repeat(32);
const SUMMARY_BYTES = new TextEncoder().encode("고친 요약");

const commands = createTicketCommands();
const claims = createTicketClaimCommands();
const finish = createTicketFinishCommands();

function code(
  result: { ok: boolean; error?: { code: string; message?: string } },
  expected: string,
): void {
  assert(!result.ok, JSON.stringify(result));
  assertEquals(result.error?.code, expected);
}

function connection(id: string, app: string | null = null, state = "active") {
  return {
    connection: id,
    state: state as "active" | "revoked",
    scope: app === null
      ? { kind: "all" as const, app: null }
      : { kind: "app" as const, app },
    token_digest: DIGEST,
    revision: "1",
  };
}

function agent(id: string) {
  return userContext(`coding_agent:${id}`);
}

function machine() {
  return userContext("machine");
}

function preparedBlob(hash: string) {
  return {
    preparation: "prep-finish-1",
    principal: `coding_agent:${CAC}`,
    purpose: "ticket_summary",
    hash,
    size_bytes: SUMMARY_BYTES.length,
  };
}

function fixture(preparedBlobs?: ReturnType<typeof preparedBlob>[]) {
  return ticketFixture({
    adoptions: new Map([[QUESTION, { document: DOC, version: VER }]]),
    connections: new Map([
      [`coding_agent:${CAC}`, connection(CAC)],
      [`coding_agent:${CAC_B}`, connection(CAC_B)],
    ]),
    nowMs: START,
    preparedBlobs,
  });
}

function openReady(ledger: ReturnType<typeof ticketFixture>): {
  ticket: string;
  revision: string;
} {
  const created = ledger.transaction((tx) =>
    commands.create.handle(
      tx,
      userContext(),
      {
        app: APP,
        kind: "implementation",
        title: "fix leaf redaction",
        what: "redact leaf before snapshot",
        why: "snapshot shows the raw leaf",
        references: [],
        adoption_questions: [],
        conditions: [],
        inspect: ["src/leaf.ts"],
        preserve: ["docs/leaf.md"],
        problems: [],
        readiness: "needs_confirmation",
        needs: ["confirm the redaction"],
      },
      {},
    )
  );
  assert(created.ok);
  if (!created.ok) return { ticket: "", revision: "" };
  const made = ledger.transaction((tx) =>
    commands.make_ready.handle(
      tx,
      userContext(),
      {
        ticket: created.value.ticket,
        base_revision: created.value.revision,
        references: [{
          kind: "version",
          target: VER,
          address: {
            place: "project",
            document: "leaf-redaction",
            section: null,
            version: 1,
          },
          section: null,
        }],
        adoption_questions: [QUESTION],
        conditions: [
          { kind: "app_test" },
          {
            kind: "test_command",
            executable: "deno",
            argv: ["task", "test"],
            cwd: ".",
            timeout_ms: 60_000,
            expected_exit_code: 0,
          },
        ],
        inspect: ["src/leaf.ts"],
        preserve: ["docs/leaf.md"],
      },
      { base_revision: created.value.revision },
    )
  );
  assert(made.ok);
  if (!made.ok) return { ticket: "", revision: "" };
  return { ticket: created.value.ticket, revision: made.value.revision };
}

function claim(
  ledger: ReturnType<typeof ticketFixture>,
  ready: { ticket: string; revision: string },
  id = CAC,
): { claim_seq: string } {
  const claimed = ledger.transaction((tx) =>
    claims.claim.handle(
      tx,
      agent(id),
      { ticket: ready.ticket, base_revision: ready.revision },
      { base_revision: ready.revision },
    )
  );
  assert(claimed.ok, JSON.stringify(claimed));
  if (!claimed.ok) return { claim_seq: "" };
  return { claim_seq: claimed.value.claim_seq };
}

function seedRelease(
  ledger: ReturnType<typeof ticketFixture>,
  ticket: string,
  claimSeq: string,
  release = REL,
  app = APP,
): void {
  ledger.sql.run(
    "INSERT INTO releases (id, app, ticket_source) VALUES (?, ?, ?)",
    [release, app, JSON.stringify({ ticket, claim_seq: claimSeq })],
  );
}

function seedOtherClaimRelease(
  ledger: ReturnType<typeof ticketFixture>,
  release: string,
  app: string,
): void {
  ledger.sql.run(
    "INSERT INTO releases (id, app, ticket_source) VALUES (?, ?, ?)",
    [
      release,
      app,
      JSON.stringify({
        ticket: "tkt_01h455vb4pex5v6nkc6gd5fdzz",
        claim_seq: "90",
      }),
    ],
  );
}

function reportInput(
  ticket: string,
  hold: { claim_seq: string },
  patch: Record<string, unknown> = {},
) {
  const blob = preparedBlob(HASH);
  return {
    ticket,
    claim_seq: hold.claim_seq,
    base_revision: hold.claim_seq,
    completion: {
      release: REL,
      summary_hash: HASH,
      outputs: [],
      fix_records: [],
      verifications: [],
    },
    summary_blob: blob,
    ...patch,
  };
}

Deno.test("coding-agent/tickets#R15: report accepts a release prepared through the same ticket claim", () => {
  const ledger = fixture([preparedBlob(HASH)]);
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    seedRelease(ledger, ready.ticket, hold.claim_seq);
    const reported = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    assert(reported.ok, JSON.stringify(reported));
    if (!reported.ok) return;
    assertEquals(reported.value.state, "reported");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R15: report rejects another app's release and another claim's release", () => {
  const ledger = fixture([preparedBlob(HASH)]);
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    // 다른 앱에 출처가 이 ticket인 release를 둔다. 같은 앱이 아니면 거절이다.
    seedOtherClaimRelease(ledger, REL_OTHER, OTHER_APP);
    const crossApp = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold, {
          completion: {
            release: REL_OTHER,
            summary_hash: HASH,
            outputs: [],
            fix_records: [],
            verifications: [],
          },
        }),
        { base_revision: hold.claim_seq },
      )
    );
    code(crossApp, "conflict");
    // 같은 앱이지만 다른 ticket·claim 출처의 release다.
    seedOtherClaimRelease(ledger, "rel_01arz3ndektsv4rrffq69g5fbv", APP);
    const crossClaim = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold, {
          completion: {
            release: "rel_01arz3ndektsv4rrffq69g5fbv",
            summary_hash: HASH,
            outputs: [],
            fix_records: [],
            verifications: [],
          },
        }),
        { base_revision: hold.claim_seq },
      )
    );
    code(crossClaim, "conflict");
    // 접수는 남지 않는다. claim도 그대로다.
    const rows = ledger.sql.get(
      "SELECT COUNT(*) AS count FROM ticket_completions",
      [],
    );
    assertEquals(Number(rows?.count), 0);
    const claimRow = ledger.sql.get(
      "SELECT claim_seq FROM ticket_claims WHERE ticket = ?",
      [ready.ticket],
    );
    assertEquals(claimRow?.claim_seq, hold.claim_seq);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R15: report reads the claim source back from the release row", () => {
  const ledger = fixture([preparedBlob(HASH)]);
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    const wrongSeq = String(Number(hold.claim_seq) + 20);
    seedRelease(ledger, ready.ticket, wrongSeq);
    const stale = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    code(stale, "conflict");
    // release 행의 ticket_source를 이 claim으로 바꾸면 같은 보고가 받아진다.
    ledger.sql.run("UPDATE releases SET ticket_source = ? WHERE id = ?", [
      JSON.stringify({ ticket: ready.ticket, claim_seq: hold.claim_seq }),
      REL,
    ]);
    const accepted = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    assert(accepted.ok, JSON.stringify(accepted));
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R17: receipt ends the claim and the ticket stays reported without confirmation", () => {
  const ledger = fixture([preparedBlob(HASH)]);
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    seedRelease(ledger, ready.ticket, hold.claim_seq);
    const reported = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    assert(reported.ok, JSON.stringify(reported));
    if (!reported.ok) return;
    const seq = reported.value.completion_seq;
    // 접수 때 claim을 끝낸다.
    const claimRow = ledger.sql.get(
      "SELECT claim_seq FROM ticket_claims WHERE ticket = ?",
      [ready.ticket],
    );
    assertEquals(claimRow, undefined);
    // machine 검사 전까지 confirmed가 되지 않는다.
    const row = ledger.sql.get(
      "SELECT state, completion_seq, revision FROM tickets WHERE id = ?",
      [ready.ticket],
    );
    assertEquals(row?.state, "reported");
    assertEquals(row?.completion_seq, seq);
    assertEquals(row?.revision, seq);
    // 접수 값은 남는다.
    const completion = ledger.sql.get(
      "SELECT summary_hash, release FROM ticket_completions WHERE ticket = ? AND seq = ?",
      [ready.ticket, seq],
    );
    assertEquals(completion?.summary_hash, HASH);
    assertEquals(completion?.release, REL);
    // 확인됨이 되는 유일한 길인 record_checks command가 없어 state는 reported다.
    const kinds = ledger.emitted.map((event) => event.type);
    assertEquals(kinds.includes("TicketConfirmed"), false);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R17: report demands the current claim and a live claim row", () => {
  const ledger = fixture([preparedBlob(HASH)]);
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    seedRelease(ledger, ready.ticket, hold.claim_seq);
    // 다른 connection이 이미 claim을 가져갔으면 접수는 거절된다.
    const stale = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC_B),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    code(stale, "forbidden");
    // 접수 뒤에는 claim 행이 없어 같은 보고도 거절된다.
    const accepted = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    assert(accepted.ok);
    const again = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    code(again, "conflict");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R17: report registers the summary blob prepared reference", () => {
  const ledger = fixture([preparedBlob(HASH)]);
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    seedRelease(ledger, ready.ticket, hold.claim_seq);
    const reported = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    assert(reported.ok, JSON.stringify(reported));
    if (!reported.ok) return;
    const ref = ledger.sql.get(
      "SELECT hash, registered_seq FROM blob_refs WHERE owner_kind = 'ticket' AND owner_key = ? AND field = 'summary'",
      [ready.ticket],
    );
    assertEquals(ref?.hash, HASH);
    assertEquals(
      String(ref?.registered_seq),
      reported.value.completion_seq,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R15: report rejects a version reference that does not exist", () => {
  const ledger = fixture([preparedBlob(HASH)]);
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    seedRelease(ledger, ready.ticket, hold.claim_seq);
    const missing = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold, {
          completion: {
            release: REL,
            summary_hash: HASH,
            outputs: ["ver_01h455vb4pex5v6nkc6gd5fdzz"],
            fix_records: [],
            verifications: [],
          },
        }),
        { base_revision: hold.claim_seq },
      )
    );
    code(missing, "not_found");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R22: user cancels with a one-line reason and no confirmation window", () => {
  const ledger = fixture();
  try {
    const ready = openReady(ledger);
    ledger.setNow(START + 1000);
    const cancelled = ledger.transaction((tx) =>
      finish.cancel.handle(
        tx,
        userContext(),
        {
          ticket: ready.ticket,
          base_revision: ready.revision,
          reason: "wrong scope",
        },
        { base_revision: ready.revision },
      )
    );
    assert(cancelled.ok, JSON.stringify(cancelled));
    if (!cancelled.ok) return;
    assertEquals(cancelled.value.state, "cancelled");
    const row = ledger.sql.get(
      "SELECT state, cancel_reason, revision FROM tickets WHERE id = ?",
      [ready.ticket],
    );
    assertEquals(row?.state, "cancelled");
    assertEquals(row?.cancel_reason, "wrong scope");
    // 취소 event의 seq가 revision이 된다.
    assert(typeof row?.revision === "string" && row.revision.length > 0);
    // 확인 창 예약은 쓰지 않는다. handle은 useApproval을 부르지 않는다.
    const event = ledger.emitted.at(-1);
    assertEquals(event?.type, "TicketCancelled");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R22: machine cancels a ticket without external history once", () => {
  const ledger = fixture();
  try {
    const ready = openReady(ledger);
    const cancelled = ledger.transaction((tx) =>
      finish.cancel.handle(
        tx,
        machine(),
        {
          ticket: ready.ticket,
          base_revision: ready.revision,
          reason: "revert the App Engineer ticket",
        },
        { base_revision: ready.revision },
      )
    );
    assert(cancelled.ok, JSON.stringify(cancelled));
    if (!cancelled.ok) return;
    // 외부 이력이 없는 종료라 released_claim은 null이다.
    const event = ledger.emitted.at(-1);
    assertEquals(
      (event?.payload as { released_claim?: string | null } | undefined)
        ?.released_claim,
      null,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R22: machine cancel is forbidden once an external claim exists", () => {
  const ledger = fixture();
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    const denied = ledger.transaction((tx) =>
      finish.cancel.handle(
        tx,
        machine(),
        {
          ticket: ready.ticket,
          base_revision: hold.claim_seq,
          reason: "revert the ticket",
        },
        { base_revision: hold.claim_seq },
      )
    );
    code(denied, "forbidden");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R22: agent actor cancels nothing", () => {
  const ledger = fixture();
  try {
    const ready = openReady(ledger);
    const denied = ledger.transaction((tx) =>
      finish.cancel.handle(
        tx,
        userContext("agent:app_01h455vb4pex5v6nkc6gd5fdw1"),
        {
          ticket: ready.ticket,
          base_revision: ready.revision,
          reason: "not mine",
        },
        { base_revision: ready.revision },
      )
    );
    code(denied, "forbidden");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R23: right after a cancel the old claim renews, releases, and reports nothing", () => {
  const ledger = fixture([preparedBlob(HASH)]);
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    seedRelease(ledger, ready.ticket, hold.claim_seq);
    const cancelled = ledger.transaction((tx) =>
      finish.cancel.handle(
        tx,
        userContext(),
        {
          ticket: ready.ticket,
          base_revision: hold.claim_seq,
          reason: "wrong scope",
        },
        { base_revision: hold.claim_seq },
      )
    );
    assert(cancelled.ok, JSON.stringify(cancelled));
    // 옛 claim의 갱신은 claim 행이 없어 거절된다.
    const renewed = ledger.transaction((tx) =>
      claims.renew_claim.handle(
        tx,
        agent(CAC),
        {
          ticket: ready.ticket,
          claim_seq: hold.claim_seq,
          base_revision: hold.claim_seq,
        },
        { base_revision: hold.claim_seq },
      )
    );
    // 거절은 claim 행 부재가 아니라 취소가 올린 revision 때문에 먼저
    // conflict가 된다. 어느 쪽이든 갱신은 막힌다.
    code(renewed, "conflict");
    // ticket 근거 release 준비 검사와 보고도 거절된다.
    const reported = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    code(reported, "conflict");
    const state = ledger.sql.get(
      "SELECT state FROM tickets WHERE id = ?",
      [ready.ticket],
    );
    assertEquals(state?.state, "cancelled");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R23: cancel keeps past results and completions", () => {
  const ledger = fixture([preparedBlob(HASH)]);
  try {
    const ready = openReady(ledger);
    const hold = claim(ledger, ready);
    seedRelease(ledger, ready.ticket, hold.claim_seq);
    const reported = ledger.transaction((tx) =>
      finish.report_completion.handle(
        tx,
        agent(CAC),
        reportInput(ready.ticket, hold),
        { base_revision: hold.claim_seq },
      )
    );
    assert(reported.ok, JSON.stringify(reported));
    if (!reported.ok) return;
    const seq = reported.value.completion_seq;
    const cancelled = ledger.transaction((tx) =>
      finish.cancel.handle(
        tx,
        userContext(),
        {
          ticket: ready.ticket,
          base_revision: seq,
          reason: "wrong scope",
        },
        { base_revision: seq },
      )
    );
    assert(cancelled.ok, JSON.stringify(cancelled));
    // 이미 남은 결과는 삭제하지 않는다.
    const kept = ledger.sql.get(
      "SELECT summary_hash FROM ticket_completions WHERE ticket = ? AND seq = ?",
      [ready.ticket, seq],
    );
    assertEquals(kept?.summary_hash, HASH);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R23: cancel emits no external-process-kill confirmation", () => {
  const ledger = fixture();
  try {
    const ready = openReady(ledger);
    const cancelled = ledger.transaction((tx) =>
      finish.cancel.handle(
        tx,
        userContext(),
        {
          ticket: ready.ticket,
          base_revision: ready.revision,
          reason: "wrong scope",
        },
        { base_revision: ready.revision },
      )
    );
    assert(cancelled.ok);
    // event payload는 세션 종료를 보장하는 표시를 싣지 않는다(connection#R18).
    const event = ledger.emitted.find((item) =>
      item.type === "TicketCancelled"
    );
    assert(event);
    const payload = event.payload as Record<string, unknown>;
    assertEquals(
      Object.keys(payload).some((key) =>
        key.includes("session") || key.includes("process") ||
        key.includes("kill")
      ),
      false,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R22: cancel ends the ticket and drops its repair reservation rows", () => {
  const ledger = fixture();
  try {
    // repair ticket은 problem 예약 행을 남긴다.
    const created = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        {
          app: APP,
          kind: "repair",
          title: "fix the snapshot leaf",
          what: "redact the leaf",
          why: "the snapshot shows a raw leaf",
          references: [],
          adoption_questions: [],
          conditions: [],
          inspect: ["src/leaf.ts"],
          preserve: ["docs/leaf.md"],
          problems: [],
          readiness: "needs_confirmation",
          needs: ["confirm the prune"],
        },
        {},
      )
    );
    assert(created.ok);
    if (!created.ok) return;
    // 예약 행을 위한 problem 참조를 손으로 둔다(create 문제 link는 R4 자리다).
    ledger.sql.run(
      "INSERT INTO ticket_problems (ticket, position, problem) VALUES (?, 0, ?)",
      [created.value.ticket, "prb_01h455vb4pex5v6nkc6gd5fdw1"],
    );
    ledger.sql.run(
      "INSERT INTO ticket_open_repair_problems (problem, ticket) VALUES (?, ?)",
      ["prb_01h455vb4pex5v6nkc6gd5fdw1", created.value.ticket],
    );
    const cancelled = ledger.transaction((tx) =>
      finish.cancel.handle(
        tx,
        userContext(),
        {
          ticket: created.value.ticket,
          base_revision: created.value.revision,
          reason: "wrong scope",
        },
        { base_revision: created.value.revision },
      )
    );
    assert(cancelled.ok, JSON.stringify(cancelled));
    const reservation = ledger.sql.get(
      "SELECT ticket FROM ticket_open_repair_problems WHERE ticket = ?",
      [created.value.ticket],
    );
    assertEquals(reservation, undefined);
  } finally {
    ledger.close();
  }
});
