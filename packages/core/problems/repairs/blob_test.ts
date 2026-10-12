// 고친 기록의 summary blob 영구 참조(문제#T14, platform/blob-store#R4).
// 등록은 RecordProblemFix command transaction 안의 blob_refs insert고, 준비는
// 실제 I/O worker blob 준비(core.prepareBlob)다. 저장되지 않은 hash만 싣는
// 기록은 살아 있는 준비 참조가 없어 거절된다: event와 참조가 남지 않는다.
// harness의 notePrepared는 쓰지 않는다(blob-flow, problems-flow와 같다).

import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  manualClock,
  type Result,
  seededRandom,
  sha256Hex,
} from "../../../base/mod.ts";
import { objectPathFor } from "../../storage/blobs/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../apps/register.ts";
import { codingAgentConnectionDefinitions } from "../../server/identity/coding-connection.ts";
import {
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../register.ts";
import { ticketDefinitions } from "../../apps/tickets/register.ts";
import { startCore } from "../../main/daemon/core.ts";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const ACTOR = `coding_agent:${CAC}`;
const START = Date.parse("2026-10-06T00:00:00.000Z");
const EXPIRES = "2026-10-06T01:00:00.000Z";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const REL_AFTER = "rel_01arz3ndektsv4rrffq69g5fbv";
const VER = "vrf_01arz3ndektsv4rrffq69g5fav";
const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const PROBLEM = "prb_01arz3ndektsv4rrffq69g5fav";
const AFTER_BUNDLE = "e".repeat(64);
const UNPREPARED = "d".repeat(64);
const SUMMARY_BYTES = new TextEncoder().encode("고친 요약");

type Prepared = {
  preparation: string;
  principal: string;
  purpose: string;
  hash: string;
  size_bytes: number;
};

type Body = {
  error?: { code?: string; message?: string };
  seq?: string;
};

type Opened = {
  port: number;
  dataRoot: string;
  agentToken: string;
  userToken: string;
  prepare(principal: string): Promise<Result<Prepared>>;
  close(): Promise<void>;
};

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

async function post(
  port: number,
  path: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Body }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Body };
}

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-fix-blob-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration: createAppsRegistration },
      { codingAgentConnectionDefinitions },
      { problemsTestDefinitions },
      { problemsReportDefinitions },
      { ticketDefinitions },
    ],
    teamModules: [
      new URL("../../apps/register.ts", import.meta.url).href,
      new URL("../../server/identity/coding-connection.ts", import.meta.url)
        .href,
      new URL("../register.ts", import.meta.url).href,
      new URL("../../apps/tickets/register.ts", import.meta.url).href,
    ],
    clock: manualClock(START),
    random: seededRandom(1),
    testCredentials: true,
  });
  if (!started.ok) await Deno.remove(home, { recursive: true });
  assert(started.ok, started.ok ? undefined : JSON.stringify(started.error));
  const core = started.value;
  const agentToken = "a".repeat(43);
  const userToken = "b".repeat(43);
  const agent: AuthenticatedContext = {
    principal: ACTOR,
    actor: ACTOR,
    credential_ref: "cred-fix-blob-agent",
    scope: {
      operations: [
        "RecordProblemFix",
        "problems/record-fix",
        "blobs/read",
        "blob.read",
      ],
      targets: {},
    },
    conditions: {},
  };
  const user: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    credential_ref: "cred-fix-blob-user",
    scope: {
      operations: [
        "CreateCodingAgentConnection",
        "coding_agent_connections/create",
        "blobs/read",
        "blob.read",
      ],
      targets: {},
    },
    conditions: {},
  };
  for (
    const entry of [{ token: agentToken, context: agent }, {
      token: userToken,
      context: user,
    }]
  ) {
    // credential 기록은 writer가 현재 자격을 다시 볼 때 필요하다.
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential(
      entry.context,
      entry.token,
    );
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(entry.context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
  }
  // 연결은 실제 create command로 기록한다. claim 검사의 인증 port가 그 표를 본다.
  const connection = await post(
    core.port,
    "/v1/coding_agent_connections/create",
    userToken,
    {
      input: {
        id: CAC,
        label: "claude",
        scope: { kind: "all", app: null },
        token_digest: "c".repeat(64),
      },
      idempotency_key: "connection-create-1",
      compare: {},
      prepared: [],
    },
  );
  assertEquals(connection.status, 200, JSON.stringify(connection.body));
  seed(core.dataRoot);
  return {
    port: core.port,
    dataRoot: core.dataRoot,
    agentToken,
    userToken,
    prepare(principal: string) {
      return core.prepareBlob({
        principal,
        purpose: "fix_summary",
        bytes: new ReadableStream({
          start(controller) {
            controller.enqueue(SUMMARY_BYTES);
            controller.close();
          },
        }),
      });
    },
    close() {
      return core.shutdown().finally(() =>
        Deno.remove(home, { recursive: true })
      );
    },
  };
}

// 문제·release·verification·ticket 행은 node:sqlite로 심는다(test-only seeding,
// blob_test.ts의 같은 자리). ticket_problem 연결과 claim 기한·claim seq는
// handler의 ticket 조건과 claim 검사가 읽는 값이다.
function seed(dataRoot: string): void {
  const db = new DatabaseSync(`${dataRoot}/lophn.db`);
  try {
    db.prepare(
      "insert into problems (id, app, group_key, status, work, interpretation_version, interpretation_section, closure) values (?, ?, '{}', 'open', NULL, NULL, NULL, NULL)",
    ).run(PROBLEM, APP);
    const release = db.prepare(
      `insert into releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
       values (?, ?, ?, ?, ?, ?, 0, '[]', NULL, 'machine:releaser', '2026-10-06T00:00:00.000Z', ?, NULL, NULL, '{}', '[]')`,
    );
    release.run(
      REL,
      APP,
      1,
      "c".repeat(40),
      "a".repeat(64),
      "e".repeat(64),
      "superseded",
    );
    release.run(
      REL_AFTER,
      APP,
      2,
      "c".repeat(40),
      AFTER_BUNDLE,
      "e".repeat(64),
      "active",
    );
    db.prepare(
      `insert into verifications (id, request_principal, request_key, request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution, result, reason, observations, recorded_seq, verification_canonical)
       values (?, 'user-1', 'key-1', ?, 'app_test', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}', '{}', 'pass', '', '[]', '1', '{}')`,
    ).run(VER, "f".repeat(64), APP, AFTER_BUNDLE);
    db.prepare(
      `insert into tickets (id, app, kind, title, what, why, inspect, preserve, problems, state, readiness, needs, cancel_reason, completion_seq, revision)
       values (?, ?, 'repair', 't', 'w', 'y', '[]', '[]', '[]', 'claimed', 'ready', '[]', NULL, NULL, '1')`,
    ).run(TICKET, APP);
    db.prepare(
      "insert into ticket_problems (ticket, position, problem) values (?, 0, ?)",
    ).run(TICKET, PROBLEM);
    db.prepare(
      "insert into ticket_claims (ticket, connection, claim_seq, expires_at) values (?, ?, '3', ?)",
    ).run(TICKET, CAC, EXPIRES);
  } finally {
    db.close();
  }
}

// idempotency_key는 input 최상위 열이기도 하다(contracts/problems fixes의 input schema).
// envelope의 idempotency_key는 command_results key다.
function recordFixBody(
  key: string,
  summary: string,
  blob: unknown,
): unknown {
  return {
    input: {
      problem: PROBLEM,
      idempotency_key: key,
      fix: {
        before: REL,
        after: REL_AFTER,
        summary,
        verification: [VER],
        ticket: TICKET,
        claim_seq: "3",
      },
      summary_blob: blob,
    },
    idempotency_key: key,
    compare: { problem_seq: "0" },
    prepared: [],
  };
}

function readBody(): unknown {
  return {
    owner_kind: "problem_fix",
    owner_key: PROBLEM,
    field: "summary",
    offset_bytes: 0,
    length_bytes: SUMMARY_BYTES.length,
  };
}

function codeOf(body: Body): string | undefined {
  return body.error?.code;
}

function counts(dataRoot: string): { events: number; refs: number } {
  const db = new DatabaseSync(`${dataRoot}/lophn.db`, { readOnly: true });
  try {
    const events = db.prepare(
      "select count(*) as n from events where type = 'ProblemFixRecorded' and subject = ?",
    ).get(PROBLEM) as { n: number };
    const refs = db.prepare(
      "select count(*) as n from blob_refs where owner_kind = 'problem_fix' and owner_key = ? and field = 'summary'",
    ).get(PROBLEM) as { n: number };
    return { events: events.n, refs: refs.n };
  } finally {
    db.close();
  }
}

Deno.test("platform/blob-store#R4 #R5: 고친 기록이 summary blob 준비 참조를 같은 transaction에 등록하고 일반 읽기는 막는다", async () => {
  const opened = await open();
  try {
    const prepared = value(await opened.prepare(ACTOR));

    const recorded = await post(
      opened.port,
      "/v1/problems/record-fix",
      opened.agentToken,
      recordFixBody("fix-ok-1", prepared.hash, prepared),
    );
    assertEquals(recorded.status, 200, JSON.stringify(recorded.body));
    const seq = recorded.body.seq;
    assert(typeof seq === "string");
    assertEquals(recorded.body, { seq });

    // 등록된 참조 행: hash·크기·등록 seq가 준비 결과와 같다.
    const db = new DatabaseSync(`${opened.dataRoot}/lophn.db`, {
      readOnly: true,
    });
    let event: { seq: number | bigint; actor: string } | undefined;
    let ref:
      | {
        hash: string;
        size_bytes: number | bigint;
        registered_seq: number | bigint;
      }
      | undefined;
    try {
      event = db.prepare(
        "select seq, actor from events where type = 'ProblemFixRecorded' and subject = ?",
      ).get(PROBLEM) as { seq: number | bigint; actor: string } | undefined;
      ref = db.prepare(
        "select hash, size_bytes, registered_seq from blob_refs where owner_kind = 'problem_fix' and owner_key = ? and field = 'summary'",
      ).get(PROBLEM) as
        | {
          hash: string;
          size_bytes: number | bigint;
          registered_seq: number | bigint;
        }
        | undefined;
    } finally {
      db.close();
    }
    assert(event, "ProblemFixRecorded event가 없다");
    assertEquals(String(event.seq), seq);
    assertEquals(event.actor, ACTOR);
    assert(ref, "blob_refs 참조 행이 없다");
    assertEquals(ref.hash, prepared.hash);
    assertEquals(Number(ref.size_bytes), SUMMARY_BYTES.length);
    assertEquals(String(ref.registered_seq), seq);

    // 준비된 바이트가 실제로 저장되어 있다. 파일의 sha256이 hash와 같다.
    const stored = await Deno.readFile(
      objectPathFor(opened.dataRoot, prepared.hash),
    );
    assertEquals(await sha256Hex(stored), prepared.hash);
    assertEquals(stored.length, SUMMARY_BYTES.length);

    // general_read가 없는 field다. user·agent 어느 token으로도 읽지 못한다.
    const refusedUser = await post(
      opened.port,
      "/v1/blobs/read",
      opened.userToken,
      readBody(),
    );
    assertEquals(refusedUser.status, 403, JSON.stringify(refusedUser.body));
    assertEquals(codeOf(refusedUser.body), "forbidden");
    const refusedAgent = await post(
      opened.port,
      "/v1/blobs/read",
      opened.agentToken,
      readBody(),
    );
    assertEquals(refusedAgent.status, 403, JSON.stringify(refusedAgent.body));
    assertEquals(codeOf(refusedAgent.body), "forbidden");
  } finally {
    await opened.close();
  }
});

Deno.test("platform/blob-store#R4: 저장되지 않은 summary hash의 수리 기록은 event와 참조를 남기지 않는다", async () => {
  const opened = await open();
  try {
    const before = counts(opened.dataRoot);
    assertEquals(before, { events: 0, refs: 0 });

    // 살아 있는 준비 참조가 없다. 등록이 거절되고 기록 전체(event 포함)가 없다.
    const unprepared = await post(
      opened.port,
      "/v1/problems/record-fix",
      opened.agentToken,
      recordFixBody("fix-unprepared-1", UNPREPARED, {
        preparation: "prep-unprepared",
        principal: ACTOR,
        purpose: "fix_summary",
        hash: UNPREPARED,
        size_bytes: SUMMARY_BYTES.length,
      }),
    );
    assertEquals(unprepared.status, 400, JSON.stringify(unprepared.body));
    assertEquals(codeOf(unprepared.body), "invalid_input");

    // purpose가 fix_summary가 아니다. input schema가 거절한다.
    const wrongPurpose = await post(
      opened.port,
      "/v1/problems/record-fix",
      opened.agentToken,
      recordFixBody("fix-purpose-1", UNPREPARED, {
        preparation: "prep-wrong-purpose",
        principal: ACTOR,
        purpose: "operational_log",
        hash: UNPREPARED,
        size_bytes: SUMMARY_BYTES.length,
      }),
    );
    assertEquals(wrongPurpose.status, 400, JSON.stringify(wrongPurpose.body));
    assertEquals(codeOf(wrongPurpose.body), "invalid_input");

    // summary_blob hash가 fix.summary와 어긋난다. input schema가 거절한다.
    const mismatched = await post(
      opened.port,
      "/v1/problems/record-fix",
      opened.agentToken,
      recordFixBody("fix-mismatch-1", UNPREPARED, {
        preparation: "prep-mismatched",
        principal: ACTOR,
        purpose: "fix_summary",
        hash: "9".repeat(64),
        size_bytes: SUMMARY_BYTES.length,
      }),
    );
    assertEquals(mismatched.status, 400, JSON.stringify(mismatched.body));
    assertEquals(codeOf(mismatched.body), "invalid_input");

    const after = counts(opened.dataRoot);
    assertEquals(after, before);
  } finally {
    await opened.close();
  }
});
