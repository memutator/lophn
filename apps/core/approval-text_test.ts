// platform/approvals#R1·R2·R17: approval 설명 글(이유·변경·외부 영향·되돌림)은 요청에 값으로 실려
// 오고, core가 redaction을 거쳐 blob으로 준비하며, create command가 같은 transaction에서 영구
// 참조를 등록한다. 읽기(ReadApprovalText)는 결정 화면이 보는 글을 request를 볼 수 있는 쪽에만
// 돌려준다. 실제 core와 temp LOPHN_HOME, 가짜 시계에서 본다. model 쪽은 실제 HTTP로 fake
// provider를 부른다(사람 데이터 root와 실제 provider는 쓰지 않는다).
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  type ManualClock,
  manualClock,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import {
  BLOB_PREPARATION_TTL_MS,
  BLOB_UNREFERENCED_GRACE_MS,
} from "../../packages/protocol/server/mod.ts";
import type {
  ApprovalRequest,
  AuthenticatedContext,
} from "../../packages/protocol/server/mod.ts";
import { type Core, startCore } from "./core.ts";
import {
  actionOf,
  call,
  codeOf,
  command,
  createInput,
  decide as humanDecide,
  type Server,
} from "./testing/approvals-fixture.ts";
import {
  binding,
  kit,
  MACHINE_TOKEN,
  modelAsks,
  openWorld,
  requested,
  RUN_A,
  RUN_B,
  TARGET,
  tool,
  USER_TOKEN,
  type World,
} from "./testing/tool-judgment-world.ts";

const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Text = {
  approval: string;
  reason: string;
  changes: string;
  external: string | null;
  reversibility: string;
  closed_reason: string | null;
};

function refs(home: string, approval: string): Record<string, unknown>[] {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare(
      "select field, hash, size_bytes from blob_refs where owner_kind = 'approval_request' and owner_key = ? order by field",
    ).all(approval) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

async function blobHashes(home: string): Promise<string[]> {
  const found: string[] = [];
  try {
    for await (const prefix of Deno.readDir(`${home}/blobs/sha256`)) {
      if (!prefix.isDirectory) continue;
      for await (
        const name of Deno.readDir(`${home}/blobs/sha256/${prefix.name}`)
      ) {
        if (name.isFile) found.push(`${prefix.name}${name.name}`);
      }
    }
  } catch {
    return found;
  }
  return found;
}

async function blobText(home: string, hash: string): Promise<string> {
  return await Deno.readTextFile(
    `${home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
  );
}

// 도구 판정이 만든 approval. model은 Anthropic Messages로 말하고, 변경·외부 영향 설명에
// secret이 섞여 있다. 설명은 소유 계약이 해석한 값이다.
async function askedApproval(world: World) {
  const entry = {
    definition: tool("note.record"),
    binding: binding([{ id: TARGET, reversibility: "irreversible" }], {
      changes: `records one note ${SECRET}`,
      external: `sends the note to example.com ${SECRET}`,
      reversibility: "the note cannot be removed",
    }),
  };
  const asked = await modelAsks(
    "please record this",
    entry.definition.name,
    { note: "first-note" },
    "anthropic-messages",
  );
  const harness = kit(world, "a", [entry]);
  const request = await requested(
    world,
    world.runs.a.run,
    entry.definition,
    asked.input,
  );
  const decided = await harness.judgment.decide(request);
  assert(decided.ok, decided.ok ? "" : JSON.stringify(decided.error));
  const approval = decided.value.decision.approval;
  assert(approval !== null);
  return { approval, request };
}

function textOf(world: World, token: string, approval: string) {
  return world.read("approvals/text", token, { approval });
}

Deno.test("platform/approvals#R1 #R17: a tool-judgment approval's reason, changes, external and reversibility are read back for display with redaction applied", async () => {
  const world = await openWorld();
  try {
    const { approval, request } = await askedApproval(world);
    const reason = `tool call ${request.toolCall}: note.record on ${TARGET}`;
    const expected = {
      approval,
      reason,
      changes: "records one note *",
      external: "sends the note to example.com *",
      reversibility: "the note cannot be removed",
    };
    // 사람·machine·요청한 agent가 읽는다. 글은 redaction을 거친 값이다.
    for (const token of [USER_TOKEN, MACHINE_TOKEN, world.runs.a.token]) {
      const read = await textOf(world, token, approval);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const text = read.body as unknown as Text;
      assertEquals({
        approval: text.approval,
        reason: text.reason,
        changes: text.changes,
        external: text.external,
        reversibility: text.reversibility,
      }, expected);
      assert(!JSON.stringify(read.body).includes(SECRET));
    }
    // 저장된 request의 hash는 읽은 글의 UTF-8 bytes의 hash다.
    const got = await world.read("approvals/get", USER_TOKEN, { approval });
    assertEquals(got.status, 200, JSON.stringify(got.body));
    const stored = got.body["request"] as ApprovalRequest;
    assertEquals(stored.reason_blob, await sha256Hex(expected.reason));
    assertEquals(stored.effect.changes_blob, await sha256Hex(expected.changes));
    assertEquals(
      stored.effect.external_blob,
      await sha256Hex(expected.external),
    );
    assertEquals(
      stored.effect.reversibility_blob,
      await sha256Hex(expected.reversibility),
    );
    // 참조는 field마다 영구 하나다. secret 원문은 blob 어디에도 남지 않는다.
    assertEquals(
      refs(world.core.dataRoot, approval).map((ref) => ref["field"]),
      ["changes", "external", "reason", "reversibility"],
    );
    for (const hash of await blobHashes(world.core.dataRoot)) {
      assert(!(await blobText(world.core.dataRoot, hash)).includes(SECRET));
    }
  } finally {
    await world.dispose();
  }
});

Deno.test("platform/approvals#R17: an approval without external text reads external as null, and a caller out of scope gets the same not_found as for an absent approval", async () => {
  const world = await openWorld();
  try {
    const entry = {
      definition: tool("note.record"),
      binding: binding([{ id: TARGET, reversibility: "irreversible" }]),
    };
    const asked = await modelAsks("go", entry.definition.name, { note: "n" });
    const harness = kit(world, "a", [entry]);
    const call = await requested(
      world,
      world.runs.a.run,
      entry.definition,
      asked.input,
    );
    const decided = await harness.judgment.decide(call);
    assert(decided.ok);
    const approval = decided.value.decision.approval;
    assert(approval !== null);
    const own = await textOf(world, world.runs.a.token, approval);
    assertEquals(own.status, 200, JSON.stringify(own.body));
    assertEquals((own.body as unknown as Text).external, null);
    assertEquals((own.body as unknown as Text).changes, "records one note");
    // 다른 assignment의 agent(run B)는 이 request를 볼 수 없다: 없는 id와 상태·본문이 같다.
    const other = world.runs.b.token;
    const hidden = await textOf(world, other, approval);
    const absent = await textOf(
      world,
      other,
      "apr_01h455vb4pex5v6nkc6gd5fdwz",
    );
    assertEquals(hidden.status, 404);
    assertEquals(codeOf(hidden), "not_found");
    assertEquals(hidden.status, absent.status);
    assertEquals(hidden.body, absent.body);
    // 요청한 쪽과 사람에게는 같은 request가 보이고, run C(같은 assignment의 다른 run)도 같은 요청자다.
    const sameAssignment = await textOf(world, world.runs.c.token, approval);
    assertEquals(
      sameAssignment.status,
      200,
      JSON.stringify(sameAssignment.body),
    );
    assertNotEquals(RUN_A, RUN_B);
  } finally {
    await world.dispose();
  }
});

// ── 수명: 준비 TTL과 미참조 유예기간 ──────────────────────────────────────────

type Fixture = { home: string; clock: ManualClock; starts: number };

async function start(f: Fixture): Promise<Core> {
  const started = await startCore({
    lophnHome: f.home,
    port: 0,
    teams: [],
    clock: f.clock,
    // 시작마다 다른 seed다. 같은 seed는 같은 credential ref를 만든다.
    random: seededRandom(200 + ++f.starts),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  return started.value;
}

async function grant(
  f: Fixture,
  core: Core,
  actor: "user" | "machine",
  operations: string[],
): Promise<string> {
  const context: AuthenticatedContext = {
    principal: `${actor}-${f.starts}`,
    actor,
    credential_ref: `cred_apr_text_${actor}_${f.starts}`,
    scope: { operations, targets: {} },
    conditions: {},
  };
  const token = `${actor}${f.starts}`.padEnd(43, "t");
  assert(core.acceptTestCredential);
  assert((await core.acceptTestCredential(context, token)).ok);
  assert((await core.record(context)).ok);
  return token;
}

// 미참조 확인 기록을 유예기간보다 앞으로 당긴다. 참조가 없으면 이 기록만으로 지워진다.
async function ageUnreferenced(
  home: string,
  hash: string,
  nowMs: number,
): Promise<void> {
  const path = `${home}/blobs/unreferenced/${hash.slice(0, 2)}/${
    hash.slice(2)
  }.json`;
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(
    path,
    `${
      JSON.stringify({
        unreferenced_at_ms: nowMs - BLOB_UNREFERENCED_GRACE_MS - MINUTE,
      })
    }\n`,
  );
}

Deno.test("platform/approvals#R1 #R17: the texts outlive the 10-minute preparation and the 7-day unreferenced grace, including a restart", async () => {
  const f: Fixture = {
    home: await Deno.makeTempDir({ prefix: "lophn-approval-text-" }),
    clock: manualClock(Date.UTC(2024, 0, 1)),
    starts: 0,
  };
  try {
    const approval = "apr_01h455vb4pex5v6nkc6gd5fdw1";
    const reason = "오래 남아야 하는 이유";
    const changes = "노트 하나를 남긴다";
    const reversibility = "남긴 뒤에는 되돌리지 못한다";
    const kept: string[] = [];
    let orphan = "";
    {
      const core = await start(f);
      try {
        const operations = [
          "create_approval_request",
          "GetApproval",
          "ReadApprovalText",
        ];
        const user = await grant(f, core, "user", operations);
        const fixed = await actionOf({
          command: "record_owned_note",
          caller: "user",
          targets: [TARGET],
          value: { note: "n" },
        });
        const created = await call(
          core,
          "approvals/create",
          user,
          command(
            createInput(approval, "user", fixed, {
              reason,
              changes,
              reversibility,
            }),
          ),
        );
        assertEquals(created.status, 200, JSON.stringify(created.body));
        for (const field of refs(f.home, approval)) {
          kept.push(String(field["hash"]));
        }
        assertEquals(kept.length, 3);
        // 준비 참조는 10분이면 만기이고 글은 영구 참조 덕에 그대로 읽힌다.
        f.clock.advance(BLOB_PREPARATION_TTL_MS + MINUTE);
        await core.sweepTicketClaims();
        const read = await call(core, "approvals/text", user, { approval });
        assertEquals(read.status, 200, JSON.stringify(read.body));
        assertEquals(
          [read.body["reason"], read.body["changes"], read.body["external"]],
          [reason, changes, null],
        );
        // 참조 없이 준비만 한 대조 blob. 유예기간이 지나면 같은 정리가 지운다.
        const prepared = await core.prepareBlob({
          principal: "user-control",
          purpose: "operational_log",
          bytes: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("control orphan"));
              controller.close();
            },
          }),
        });
        assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
        orphan = prepared.value.hash;
        assert(!kept.includes(orphan));
        // 7일이 지나고 모든 blob이 오래전부터 미참조로 관측된 상태다. 종료 정리가 돈다.
        f.clock.advance(8 * DAY);
        for (const hash of [...kept, orphan]) {
          await ageUnreferenced(f.home, hash, f.clock.nowMs());
        }
      } finally {
        await core.shutdown();
      }
    }
    // 정리가 실제로 돌았다는 증거: 참조 없는 대조 blob은 지워졌고 글 blob은 남았다.
    const left = await blobHashes(f.home);
    for (const hash of kept) {
      assert(left.includes(hash), "참조된 설명 blob이 지워졌다");
    }
    assert(!left.includes(orphan), "정리가 돌지 않았다");
    // 재시작한 core가 같은 글을 돌려준다.
    const again = await start(f);
    try {
      const user = await grant(f, again, "user", [
        "GetApproval",
        "ReadApprovalText",
      ]);
      const read = await call(again, "approvals/text", user, { approval });
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals(
        [read.body["reason"], read.body["changes"], read.body["reversibility"]],
        [reason, changes, reversibility],
      );
    } finally {
      await again.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("platform/approvals#R1: oversize or blank text is rejected before anything is stored, and a text that is only a secret becomes the replacement text", async () => {
  const f: Fixture = {
    home: await Deno.makeTempDir({ prefix: "lophn-approval-text-" }),
    clock: manualClock(Date.UTC(2024, 0, 1)),
    starts: 0,
  };
  try {
    const core = await start(f);
    try {
      const user = await grant(f, core, "user", [
        "create_approval_request",
        "ReadApprovalText",
      ]);
      const fixed = await actionOf({
        command: "record_owned_note",
        caller: "user",
        targets: [TARGET],
        value: { note: "n" },
      });
      const before = await blobHashes(f.home);
      const create = (id: string, over: Record<string, unknown>) =>
        call(
          core,
          "approvals/create",
          user,
          command({ ...createInput(id, "user", fixed), ...over }),
        );
      const blank = await create("apr_01h455vb4pex5v6nkc6gd5fdw2", {
        reason: "   ",
      });
      assertEquals(blank.status, 400, JSON.stringify(blank.body));
      const huge = await create("apr_01h455vb4pex5v6nkc6gd5fdw3", {
        reason: "a".repeat(32769),
      });
      assertEquals(huge.status, 400, JSON.stringify(huge.body));
      // 옛 모양(hash)은 글이 아니다.
      const hashes = await call(
        core,
        "approvals/create",
        user,
        command({
          id: "apr_01h455vb4pex5v6nkc6gd5fdw4",
          requester: "user",
          run: null,
          reason_blob: "ab".repeat(32),
          effect: {
            changes_blob: "ab".repeat(32),
            external_blob: null,
            reversible: false,
            reversibility_blob: "ab".repeat(32),
          },
          action: fixed,
          expires_at: null,
        }),
      );
      assertEquals(hashes.status, 400, JSON.stringify(hashes.body));
      assertEquals(await blobHashes(f.home), before);
      // secret만 있는 글도 가려져 글이 된다. 원문은 어디에도 남지 않는다.
      const secret = await create("apr_01h455vb4pex5v6nkc6gd5fdw5", {
        reason: SECRET,
      });
      assertEquals(secret.status, 200, JSON.stringify(secret.body));
      const read = await call(core, "approvals/text", user, {
        approval: "apr_01h455vb4pex5v6nkc6gd5fdw5",
      });
      assertEquals(read.body["reason"], "*");
      for (const hash of await blobHashes(f.home)) {
        assert(!(await blobText(f.home, hash)).includes(SECRET));
      }
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

// ── 종료 이유: 거절·취소의 글과 만료 ────────────────────────────────────────

const REJECTED = "apr_01h455vb4pex5v6nkc6gd5fdw6";
const BARE = "apr_01h455vb4pex5v6nkc6gd5fdw7";
const CANCELLED = "apr_01h455vb4pex5v6nkc6gd5fdw8";
const DUE = "apr_01h455vb4pex5v6nkc6gd5fdw9";

function serverOf(f: Fixture, core: Core): Server {
  return {
    port: core.port,
    dataRoot: core.dataRoot,
    clock: f.clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "없다" } }),
  };
}

async function createFor(
  core: Core,
  token: string,
  id: string,
  expiresAt: string | null = null,
) {
  const fixed = await actionOf({
    command: "record_owned_note",
    caller: "user",
    targets: [TARGET],
    value: { note: id },
  });
  const made = await call(
    core,
    "approvals/create",
    token,
    command(createInput(id, "user", fixed, { expiresAt })),
  );
  assertEquals(made.status, 200, JSON.stringify(made.body));
  return made.body["request"] as ApprovalRequest;
}

function closedRefs(home: string, approval: string) {
  return refs(home, approval).filter((ref) => ref["field"] === "closed_reason");
}

Deno.test("platform/approvals#R14: a rejection reason is read back redacted with one permanent reference, and a rejection without a reason has null and no reference", async () => {
  const f: Fixture = {
    home: await Deno.makeTempDir({ prefix: "lophn-approval-text-" }),
    clock: manualClock(Date.UTC(2024, 0, 1)),
    starts: 0,
  };
  try {
    const core = await start(f);
    try {
      const user = await grant(f, core, "user", [
        "create_approval_request",
        "reject_approval_request",
        "cancel_approval_request",
        "GetApproval",
        "ReadApprovalText",
      ]);
      const server = serverOf(f, core);
      const first = await createFor(core, user, REJECTED);
      const bare = await createFor(core, user, BARE);
      const cancelled = await createFor(core, user, CANCELLED);

      // 아직 끝나지 않은 request는 종료 이유가 없다.
      const open = await call(core, "approvals/text", user, {
        approval: REJECTED,
      });
      assertEquals(open.body["closed_reason"], null);

      const rejected = await humanDecide(
        server,
        user,
        first,
        "reject",
        `Not now ${SECRET} please`,
      );
      assertEquals(rejected.status, 200, JSON.stringify(rejected.body));
      const read = await call(core, "approvals/text", user, {
        approval: REJECTED,
      });
      assertEquals(read.status, 200, JSON.stringify(read.body));
      // 이유 글은 redaction을 거친 값이다. 설명 글은 그대로 읽힌다.
      assertEquals(read.body["closed_reason"], "Not now * please");
      assertEquals(read.body["reason"], "사람이 보고 정해야 한다");
      assert(!JSON.stringify(read.body).includes(SECRET));
      const stored = rejected.body["request"] as ApprovalRequest;
      assertEquals(stored.status, "rejected");
      assertEquals(
        stored.closed_reason_blob,
        await sha256Hex("Not now * please"),
      );
      assertEquals(
        closedRefs(f.home, REJECTED).map((ref) => ref["hash"]),
        [stored.closed_reason_blob],
      );
      const event = new DatabaseSync(`${f.home}/lophn.db`, { readOnly: true });
      try {
        const payload = event.prepare(
          "select payload from events where type = 'ApprovalRequestRejected' and subject = ?",
        ).get(REJECTED)!["payload"];
        assertEquals(
          JSON.parse(String(payload))["closed_reason_blob"],
          stored.closed_reason_blob,
        );
      } finally {
        event.close();
      }
      for (const hash of await blobHashes(f.home)) {
        assert(!(await blobText(f.home, hash)).includes(SECRET));
      }

      // 이유 없이 거절하면 null이고 hash도 참조도 없다.
      const none = await humanDecide(server, user, bare, "reject");
      assertEquals(none.status, 200, JSON.stringify(none.body));
      assertEquals(
        (none.body["request"] as ApprovalRequest).closed_reason_blob,
        null,
      );
      assertEquals(closedRefs(f.home, BARE), []);
      const bareRead = await call(core, "approvals/text", user, {
        approval: BARE,
      });
      assertEquals(bareRead.body["closed_reason"], null);

      // 취소 이유도 같은 길이다.
      const cancel = await call(
        core,
        "approvals/cancel",
        user,
        command(
          {
            approval: CANCELLED,
            created_seq: cancelled.created_seq,
            closed_reason: `Changed my mind ${SECRET}`,
          },
          { compare: { created_seq: cancelled.created_seq } },
        ),
      );
      assertEquals(cancel.status, 200, JSON.stringify(cancel.body));
      const cancelRead = await call(core, "approvals/text", user, {
        approval: CANCELLED,
      });
      assertEquals(cancelRead.body["closed_reason"], "Changed my mind *");
      assertEquals(closedRefs(f.home, CANCELLED).length, 1);

      // 옛 hash 입력과 공백뿐인 이유는 어떤 것도 만들지 않고 거절된다.
      const old = await call(
        core,
        "approvals/cancel",
        user,
        command({
          approval: BARE,
          created_seq: bare.created_seq,
          closed_reason_blob: "ab".repeat(32),
        }),
      );
      assertEquals(old.status, 400, JSON.stringify(old.body));
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("platform/approvals#R12: an expired approval has a null closed reason, no fake hash and no reference, and the reason blobs outlive the preparation TTL and the unreferenced grace", async () => {
  const f: Fixture = {
    home: await Deno.makeTempDir({ prefix: "lophn-approval-text-" }),
    clock: manualClock(Date.UTC(2024, 0, 1)),
    starts: 0,
  };
  try {
    const kept: string[] = [];
    {
      const core = await start(f);
      try {
        const user = await grant(f, core, "user", [
          "create_approval_request",
          "reject_approval_request",
          "GetApproval",
          "ReadApprovalText",
        ]);
        const server = serverOf(f, core);
        const deadline = new Date(f.clock.nowMs() + 60_000).toISOString();
        const due = await createFor(core, user, DUE, deadline);
        const first = await createFor(core, user, REJECTED);
        const rejected = await humanDecide(
          server,
          user,
          first,
          "reject",
          "오래 남아야 하는 거절 이유",
        );
        assertEquals(rejected.status, 200, JSON.stringify(rejected.body));
        kept.push(
          ...refs(f.home, REJECTED).map((ref) => String(ref["hash"])),
        );
        assertEquals(kept.length, 4);

        // 기한이 지나면 machine 정리가 만료한다. 이유 hash도 참조도 없다.
        f.clock.advance(60_000);
        await core.sweepApprovalExpiry();
        const got = await call(core, "approvals/get", user, { approval: DUE });
        const expired = got.body["request"] as ApprovalRequest;
        assertEquals(expired.status, "expired");
        assertEquals(expired.closed_reason_blob, null);
        assertEquals(closedRefs(f.home, DUE), []);
        assertEquals(expired.created_seq, due.created_seq);
        const text = await call(core, "approvals/text", user, {
          approval: DUE,
        });
        assertEquals(text.status, 200, JSON.stringify(text.body));
        assertEquals(text.body["closed_reason"], null);

        // 준비 TTL과 7일 유예기간이 지나도 이유 글이 남는다.
        f.clock.advance(BLOB_PREPARATION_TTL_MS + MINUTE);
        await core.sweepTicketClaims();
        const read = await call(core, "approvals/text", user, {
          approval: REJECTED,
        });
        assertEquals(read.body["closed_reason"], "오래 남아야 하는 거절 이유");
        f.clock.advance(8 * DAY);
        for (const hash of kept) {
          await ageUnreferenced(f.home, hash, f.clock.nowMs());
        }
      } finally {
        await core.shutdown();
      }
    }
    const left = await blobHashes(f.home);
    for (const hash of kept) {
      assert(left.includes(hash), "참조된 blob이 지워졌다");
    }
    const again = await start(f);
    try {
      const user = await grant(f, again, "user", ["ReadApprovalText"]);
      const read = await call(again, "approvals/text", user, {
        approval: REJECTED,
      });
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals(read.body["closed_reason"], "오래 남아야 하는 거절 이유");
    } finally {
      await again.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});
