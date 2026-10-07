// 제품 core의 coding_agent operation 상한(coding-agent#T36). 실제 coding credential 발급·인증(fake
// keychain)과 실제 core(임시 LOPHN_HOME)로, 상한이 route 정의가 선언한 coding_agent actors를 따르는지,
// 연결의 앱 범위가 그 안에서 더 좁히는지, ticket 완료 보고의 summary blob이 같은 transaction에서
// 저장·참조되는지 본다. 사람의 실제 keychain·데이터 root는 열지 않는다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { err, ok, type Result, sha256Hex } from "../../packages/base/mod.ts";
import {
  connectionRevoke,
  TICKET_SUMMARY_MAX_BYTES,
} from "../../packages/contracts/coding-agent/mod.ts";
import { UPLOAD_INPUT_HEADER } from "../../packages/contracts/platform/mod.ts";
import { confirmationBinding } from "../../packages/platform/identity/mod.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../packages/platform/secrets/mod.ts";
import {
  openWorld,
  type World,
} from "../../packages/apps/runtime/world_test.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { ticketDefinitions } from "./tickets.ts";

const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const ABSENT_TICKET = "tkt_01arz3ndektsv4rrffq69g5fb9";
const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";
const decoder = new TextDecoder();

type Reply = { status: number; body: Record<string, unknown> };
type Connected = { connection: string; token: string; revision: string };

async function post(
  world: World,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
  extra: { confirmation?: string; prepared?: string[] } = {},
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${world.harness.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        input,
        idempotency_key: `k-${crypto.randomUUID()}`,
        compare,
        prepared: extra.prepared ?? [],
        ...(extra.confirmation === undefined
          ? {}
          : { confirmation: extra.confirmation }),
      }),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

// read route는 envelope 없이 입력만 받는다.
async function read(
  world: World,
  path: string,
  token: string,
  input: unknown,
): Promise<Reply> {
  const response = await fetch(
    `http://127.0.0.1:${world.harness.port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function uploadSummary(
  world: World,
  token: string,
  bytes: Uint8Array<ArrayBuffer>,
  hash: string,
): Promise<Reply> {
  const input = btoa(JSON.stringify({ blob_hash: hash, bytes: bytes.length }))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const response = await fetch(
    `http://127.0.0.1:${world.harness.port}/v1/tickets/upload_summary`,
    {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        authorization: `Bearer ${token}`,
        [UPLOAD_INPUT_HEADER]: input,
      },
      body: bytes,
    },
  );
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

type Opened = {
  world: World;
  user: string;
  // 사람이 만든 두 번째 앱이다. world.app과 다르다.
  other: string;
  connect(label: string, app?: string): Promise<Connected>;
};

async function withWorld(run: (opened: Opened) => Promise<void>) {
  const keychain: FakeKeychain = createFakeKeychain();
  const world = await openWorld({
    approvals: true,
    extend: {
      teams: [{ codingAgentConnectionDefinitions }, { ticketDefinitions }],
      teamModules: [
        new URL("./coding-agent.ts", import.meta.url).href,
        new URL("./tickets.ts", import.meta.url).href,
        new URL("./ticket-claim-ports_test.ts", import.meta.url).href,
      ],
      coding: { keychain, loaders: [] },
    },
  });
  try {
    await world.harness.codingCredentialsReady;
    const user = (await world.login("user", [
      "CreateCodingAgentConnection",
      "RevokeCodingAgentConnection",
      "CreateTicket",
      "MakeTicketReady",
      "app.create",
    ])).token;
    const created = await post(world, "apps/create", user, {
      slug: "other",
      name: "Other",
      description: "other app",
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    await run({
      world,
      user,
      other: String(created.body["id"]),
      async connect(label, app) {
        const seen: { revision?: string } = {};
        const connected = await world.harness.codingCredentials!.connect(
          {
            label,
            scope: app === undefined
              ? { kind: "all", app: null }
              : { kind: "app", app },
          },
          async (submission): Promise<Result<unknown>> => {
            const sent = await post(
              world,
              "coding_agent_connections/create",
              user,
              submission,
            );
            if (sent.status !== 200) {
              return err({ code: "conflict", message: `${sent.status}` });
            }
            seen.revision = (sent.body["connection"] as { revision: string })
              .revision;
            return ok(sent.body);
          },
        );
        assert(connected.ok, connected.ok ? "" : connected.error.message);
        const { connection } = connected.value;
        const token = decoder.decode(
          keychain.stored.get(codingCredentialRef(connection)!)!,
        );
        return { connection, token, revision: seen.revision! };
      },
    });
  } finally {
    await world.close();
  }
}

async function readyTicket(
  world: World,
  user: string,
  app: string,
): Promise<string> {
  const created = await post(world, "tickets/create", user, {
    app,
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
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const ticket = String(created.body["ticket"]);
  const revision = String(created.body["revision"]);
  const ready = await post(world, "tickets/make_ready", user, {
    ticket,
    base_revision: revision,
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
  }, { base_revision: revision });
  assertEquals(ready.status, 200, JSON.stringify(ready.body));
  return ticket;
}

async function revisionOf(
  world: World,
  token: string,
  ticket: string,
): Promise<string> {
  const shown = await read(world, "tickets/show", token, { ticket });
  assertEquals(shown.status, 200, JSON.stringify(shown.body));
  return String((shown.body["ticket"] as { revision: string }).revision);
}

// 이 claim으로 준비된 release 행이다(releases 조립은 apps 몫이라 시험이 직접 심는다).
function seedRelease(world: World, app: string, ticket: string, claim: string) {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       VALUES (?, ?, 1, ?, ?, ?, 0, '[]', ?, 'coding_agent', ?, 'prepared', '{}', '{}')`,
    ).run(
      RELEASE,
      app,
      "a".repeat(40),
      "b".repeat(64),
      "c".repeat(64),
      JSON.stringify({ ticket, claim_seq: claim }),
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}

function ticketRow(world: World, ticket: string) {
  const db = new DatabaseSync(`${world.harness.dataRoot}/lophn.db`, {
    readOnly: true,
  });
  try {
    return {
      state: db.prepare("SELECT state FROM tickets WHERE id = ?").get(ticket)
        ?.state as string | undefined,
      refs: db.prepare(
        `SELECT hash FROM blob_refs WHERE owner_kind = 'ticket' AND owner_key = ? AND field = 'summary'`,
      ).all(ticket) as { hash: string }[],
    };
  } finally {
    db.close();
  }
}

Deno.test("coding-agent/tickets#R11 #R12 #R17: 실제 coding token이 자기 앱 ticket을 claim·renew하고 summary blob을 준비해 보고한다", async () => {
  await withWorld(async ({ world, user, connect }) => {
    const scoped = await connect("claude", world.app);
    const ticket = await readyTicket(world, user, world.app);
    const bytes = new TextEncoder().encode(
      "변경: leaf redaction\n수행한 확인: deno task test\n미실행 확인: 없음\n한계: 없음\n",
    );
    const hash = await sha256Hex(bytes);

    let revision = await revisionOf(world, scoped.token, ticket);
    const claimed = await post(world, "tickets/claim", scoped.token, {
      ticket,
      base_revision: revision,
    }, { base_revision: revision });
    assertEquals(claimed.status, 200, JSON.stringify(claimed.body));
    const claimSeq = String(claimed.body["claim_seq"]);

    revision = await revisionOf(world, scoped.token, ticket);
    const renewed = await post(world, "tickets/renew_claim", scoped.token, {
      ticket,
      claim_seq: claimSeq,
      base_revision: revision,
    }, { base_revision: revision });
    assertEquals(renewed.status, 200, JSON.stringify(renewed.body));

    // summary는 ticket 등록 purpose로만 준비된다. 상한을 넘기거나 hash가 다르면 blob이 없다.
    const wrong = await uploadSummary(
      world,
      scoped.token,
      bytes,
      "e".repeat(64),
    );
    assertNotEquals(wrong.status, 200, JSON.stringify(wrong.body));
    const tooBig = await uploadSummary(
      world,
      scoped.token,
      new Uint8Array(TICKET_SUMMARY_MAX_BYTES + 1),
      "e".repeat(64),
    );
    assertEquals(tooBig.status, 400, JSON.stringify(tooBig.body));
    const prepared = await uploadSummary(world, scoped.token, bytes, hash);
    assertEquals(prepared.status, 200, JSON.stringify(prepared.body));
    assertEquals(prepared.body["purpose"], "ticket_summary");
    assertEquals(prepared.body["hash"], hash);

    seedRelease(world, world.app, ticket, claimSeq);
    revision = await revisionOf(world, scoped.token, ticket);
    const reported = await post(
      world,
      "tickets/report_completion",
      scoped.token,
      {
        ticket,
        base_revision: revision,
        claim_seq: claimSeq,
        completion: {
          release: RELEASE,
          summary_hash: hash,
          outputs: [],
          fix_records: [],
          verifications: [],
        },
        summary_blob: prepared.body,
      },
      { base_revision: revision },
      {
        prepared: [String(prepared.body["preparation"])],
      },
    );
    assertEquals(reported.status, 200, JSON.stringify(reported.body));
    assertEquals(reported.body["state"], "reported");
    // 저장된 blob의 영구 참조가 같은 transaction에서 등록됐다.
    const row = ticketRow(world, ticket);
    assertEquals(row.state, "reported");
    assertEquals(row.refs.map((ref) => ref.hash), [hash]);
  });
});

Deno.test("coding-agent/connection#R5 coding-agent/connection#R4: coding token은 route가 coding_agent를 선언하지 않았거나 범위 밖이면 거절이고 다른 앱 ticket·문서는 없는 것과 같은 답이다", async () => {
  await withWorld(async ({ world, user, other, connect }) => {
    const all = await connect("all");
    const scoped = await connect("scoped", world.app);
    const mine = await readyTicket(world, user, world.app);
    const theirs = await readyTicket(world, user, other);

    // coding_agent를 선언하지 않은 route는 상한 밖이라 403이다.
    for (
      const [path, input] of [
        ["tickets/create", {}],
        ["tickets/make_ready", {}],
        ["tickets/expire_claim", {}],
        ["coding_agent_connections/revoke", {}],
        ["coding_agent_connections/create", {}],
      ] as const
    ) {
      const sent = await post(world, path, scoped.token, input);
      assertEquals(sent.status, 403, `${path} ${JSON.stringify(sent.body)}`);
    }
    // 일반 blob 읽기는 선언에 coding_agent가 있어도 열지 않는다.
    const blob = await read(world, "blobs/read", all.token, {
      owner_kind: "ticket",
      owner_key: mine,
      field: "summary",
      offset_bytes: 0,
      length_bytes: 10,
    });
    assertEquals(blob.status, 403, JSON.stringify(blob.body));

    // 앱 등록은 전체 범위 연결에만 허용하고 앱 하나 범위 연결은 거절한다(R4).
    const registerInput = { slug: "extra", name: "Extra", description: "x" };
    assertNotEquals(
      (await post(world, "apps/create", scoped.token, registerInput)).status,
      200,
    );

    // 다른 앱 ticket은 없는 ticket과 같은 답이다(읽기·claim·renew·release·보고).
    const absentShow = await read(world, "tickets/show", scoped.token, {
      ticket: ABSENT_TICKET,
    });
    assertNotEquals(absentShow.status, 200);
    const otherShow = await read(world, "tickets/show", scoped.token, {
      ticket: theirs,
    });
    assertEquals(otherShow.status, absentShow.status);
    assertEquals(otherShow.body, absentShow.body);
    const absentChecks = await read(world, "tickets/checks", scoped.token, {
      ticket: ABSENT_TICKET,
    });
    const otherChecks = await read(world, "tickets/checks", scoped.token, {
      ticket: theirs,
    });
    assertEquals(otherChecks.status, absentChecks.status);
    assertEquals({ ...otherChecks.body, ticket: null }, {
      ...absentChecks.body,
      ticket: null,
    });
    // 목록은 연결 범위의 앱 ticket만 싣는다. 전체 범위 연결은 둘 다 본다.
    const idsOf = async (token: string, input: unknown) =>
      ((await read(world, "tickets/list", token, input)).body["tickets"] as {
        id: string;
      }[]).map((item) => item.id);
    assertEquals(await idsOf(scoped.token, {}), [mine]);
    assertEquals(await idsOf(scoped.token, { app: other }), []);
    assertEquals((await idsOf(all.token, {})).sort(), [mine, theirs].sort());
    const forms: [string, Record<string, unknown>][] = [
      ["tickets/claim", {}],
      ["tickets/renew_claim", { claim_seq: "1" }],
      ["tickets/release_claim", { claim_seq: "1" }],
    ];
    for (const [path, extra] of forms) {
      const ask = (ticket: string) =>
        post(world, path, scoped.token, {
          ticket,
          base_revision: "1",
          ...extra,
        }, { base_revision: "1" });
      const absent = await ask(ABSENT_TICKET);
      const foreign = await ask(theirs);
      assertNotEquals(absent.status, 200, path);
      assertEquals(foreign.status, absent.status, path);
      assertEquals(foreign.body, absent.body, path);
    }
    // 같은 ticket을 전체 범위 연결은 읽는다(상한이 아니라 범위가 막은 것이다).
    assertEquals(
      (await read(world, "tickets/show", all.token, { ticket: theirs })).status,
      200,
    );
    // 범위 밖 ticket은 아무것도 바뀌지 않았다.
    assertEquals(ticketRow(world, theirs).state, "open");
    assertEquals(ticketRow(world, mine).state, "open");
  });
});

Deno.test("coding-agent/connection#R8: 회수한 연결의 coding token은 새 상한에서도 거절이다", async () => {
  await withWorld(async ({ world, user, connect }) => {
    const a = await connect("claude", world.app);
    const ticket = await readyTicket(world, user, world.app);
    assertEquals(
      (await read(world, "tickets/show", a.token, { ticket })).status,
      200,
    );
    const target = { connection: a.connection, base_revision: a.revision };
    const binding = await confirmationBinding(connectionRevoke, target);
    assert(binding);
    const issued = await world.harness.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-ceiling",
        target_ref: binding.target,
        content_hash: binding.content,
        allowed_decisions: [connectionRevoke.name],
        expires_at: new Date(world.harness.clock.nowMs() + 600_000)
          .toISOString(),
      },
    });
    assert(issued.ok, issued.ok ? "" : JSON.stringify(issued.error));
    const revoked = await post(
      world,
      "coding_agent_connections/revoke",
      user,
      target,
      { base_revision: target.base_revision },
      { confirmation: (issued.value as { confirmation: string }).confirmation },
    );
    assertEquals(revoked.status, 200, JSON.stringify(revoked.body));
    assertEquals(
      (await read(world, "tickets/show", a.token, { ticket })).status,
      401,
    );
    assertEquals(
      (await post(world, "tickets/claim", a.token, {
        ticket,
        base_revision: "1",
      }, { base_revision: "1" })).status,
      401,
    );
    const bytes = new TextEncoder().encode("요약");
    assertEquals(
      (await uploadSummary(world, a.token, bytes, await sha256Hex(bytes)))
        .status,
      401,
    );
  });
});
