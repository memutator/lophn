// lophn-agent/conversation#R2·R4: 메시지 본문은 요청에 값으로 실려 오고, core가 redaction을
// 거쳐 blob으로 준비하며, command가 같은 transaction에서 영구 참조를 등록한다. 실제 core와
// temp LOPHN_HOME, 가짜 시계에서 본다(사람 데이터 root와 실제 provider는 쓰지 않는다).
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  type ManualClock,
  manualClock,
  seededRandom,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  BLOB_PREPARATION_TTL_MS,
  BLOB_UNREFERENCED_GRACE_MS,
} from "../../../protocol/server/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  MESSAGE_TEXT_CONTENT_MAX_BYTES,
  serializeMessageContent,
} from "../../../protocol/lophn-agent/mod.ts";
import { tableBlock } from "../../../protocol/lophn-agent/message-fixtures.ts";
import { id } from "./testing/mod.ts";
import { type Core, startCore } from "../../main/daemon/core.ts";
import { createLedgerRegistration as documentsRegistration } from "../../projects/register.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "../register.ts";

const NOW = Date.UTC(2024, 0, 1);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123";
const PLACE = id("prj", 1);

type Fixture = {
  home: string;
  clock: ManualClock;
  starts: number;
  tokens: number;
};

async function fixture(): Promise<Fixture> {
  return {
    home: await Deno.makeTempDir({ prefix: "lophn-message-body-" }),
    clock: manualClock(NOW),
    starts: 0,
    tokens: 0,
  };
}

async function start(f: Fixture): Promise<Core> {
  const started = await startCore({
    lophnHome: f.home,
    port: 0,
    teams: [
      { lophnAgentDefinitions },
      { createLedgerRegistration },
      { createLedgerRegistration: documentsRegistration },
    ],
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
      new URL("../../projects/register.ts", import.meta.url).href,
    ],
    clock: f.clock,
    // 시작마다 다른 seed다. 같은 seed는 같은 credential ref를 만든다.
    random: seededRandom(100 + ++f.starts),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  return started.value;
}

const OPERATIONS = [
  "ListAssignments",
  "OpenSession",
  "project.create",
  "ReadSession",
  "ReceiveMessage",
  "RecordMessage",
  "ListMessages",
  "ReadMessageBody",
];

// 이 core에서 쓰는 자격 하나. 같은 token을 한 번만 받고 기록한다.
async function grant(
  f: Fixture,
  core: Core,
  actor: string,
  extra: { assignment?: string; run?: string } = {},
): Promise<string> {
  const n = ++f.tokens;
  const bound = extra.assignment === undefined ? {} : {
    assignment: extra.assignment,
    ...(extra.run === undefined ? {} : { run: extra.run }),
  };
  const context: AuthenticatedContext = {
    principal: actor.startsWith("agent:") ? actor : `${actor}-${n}`,
    actor: actor as AuthenticatedContext["actor"],
    credential_ref: `cred_body${n}_${f.starts}`,
    scope: { operations: OPERATIONS, targets: bound },
    conditions: bound,
  };
  const token = `${actor.replace(/\W/g, "x")}${n}`.padEnd(43, "t");
  assert(core.acceptTestCredential);
  assert((await core.acceptTestCredential(context, token)).ok);
  assert((await core.record(context)).ok);
  return token;
}

async function post(port: number, path: string, body: unknown, token: string) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function command(input: unknown, key: string, compare: unknown, run?: string) {
  return {
    input,
    idempotency_key: key,
    compare,
    prepared: [],
    ...(run === undefined ? {} : { run }),
  };
}

type Assignment = { id: string; role: string; revision: number; state: string };

async function assignments(core: Core, token: string): Promise<Assignment[]> {
  const listed = await post(core.port, "assignments/list", {}, token);
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  return (listed.body as { assignments: Assignment[] }).assignments;
}

async function openSession(
  core: Core,
  token: string,
  assignment: Assignment,
  session: string,
) {
  // 세션은 쓸 수 있는 project 하나를 자리로 받는다. 같은 key라 다시 만들어도 같은 결과다.
  const place = await post(
    core.port,
    "projects/create",
    command(
      {
        id: PLACE,
        name: "alpha",
        title: "alpha",
        purpose: "",
        folders: [],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      },
      "session-place",
      {},
    ),
    token,
  );
  assertEquals(place.status, 200, JSON.stringify(place.body));
  const opened = await post(
    core.port,
    "sessions/open",
    command(
      {
        id: session,
        assignment: assignment.id,
        work_place: { kind: "project", id: PLACE },
        opening_context: null,
      },
      `open-${session}`,
      {
        assignment_revision: assignment.revision,
        assignment_state: assignment.state,
      },
    ),
    token,
  );
  assertEquals(opened.status, 200, JSON.stringify(opened.body));
}

function textContent(text: string) {
  return { schema_version: 1, parts: [{ kind: "text", text }] };
}

type Sent = { status: number; body: unknown };

async function send(
  core: Core,
  token: string,
  assignment: Assignment,
  session: string,
  message: string,
  content: unknown,
  key = `send-${message}`,
): Promise<Sent> {
  const state = await post(core.port, "sessions/read", { session }, token);
  assertEquals(state.status, 200, JSON.stringify(state.body));
  const stateSeq = (state.body as { session: { state_seq: string } }).session
    .state_seq;
  return await post(
    core.port,
    "messages/receive",
    command({ id: message, session, content, mode: "request" }, key, {
      session_state: "open",
      session_state_seq: stateSeq,
      assignment_revision: assignment.revision,
      assignment_state: assignment.state,
    }),
    token,
  );
}

type Body = {
  message: string;
  session: string;
  body: string;
  size_bytes: number;
  content: { schema_version: number; parts: unknown[] };
};

async function readBody(core: Core, token: string, message: string) {
  return await post(core.port, "messages/body", { message }, token);
}

function ledger(home: string): DatabaseSync {
  return new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
}

function refsOf(home: string, message?: string): Record<string, unknown>[] {
  const db = ledger(home);
  try {
    return (message === undefined
      ? db.prepare(
        "select owner_key, field, hash, size_bytes from blob_refs where owner_kind = 'message'",
      ).all()
      : db.prepare(
        "select owner_key, field, hash, size_bytes from blob_refs where owner_kind = 'message' and owner_key = ?",
      ).all(message)) as Record<string, unknown>[];
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

async function blobBytes(home: string, hash: string): Promise<string> {
  return await Deno.readTextFile(
    `${home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
  );
}

async function hashOfContent(content: unknown): Promise<string> {
  return await sha256Hex(serializeMessageContent(content));
}

Deno.test("lophn-agent/conversation#R2: a person's message text round-trips through core as a redacted permanent blob", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const user = await grant(f, core, "user");
      const lophn = (await assignments(core, user)).find((entry) =>
        entry.role === "lophn"
      )!;
      const session = id("ses", 1);
      await openSession(core, user, lophn, session);
      const message = id("msg", 1);
      const sent = await send(
        core,
        user,
        lophn,
        session,
        message,
        textContent(`계획을 세워 줘 ${SECRET} 끝`),
      );
      assertEquals(sent.status, 200, JSON.stringify(sent.body));
      // 저장되는 것은 redaction을 거친 값이다. 호출자는 hash를 만들지 않았다.
      const redacted = textContent("계획을 세워 줘 * 끝");
      const hash = await hashOfContent(redacted);
      const stored = (sent.body as { message: { body: string } }).message;
      assertEquals(stored.body, hash);
      const read = await readBody(core, user, message);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const body = read.body as Body;
      assertEquals(body.content, redacted);
      assertEquals(body.body, hash);
      assertEquals(body.size_bytes, serializeMessageContent(redacted).length);
      assertEquals(body.session, session);
      // 목록의 hash와 읽은 값이 같은 blob이고 참조는 영구 하나다.
      const listed = await post(core.port, "messages/list", { session }, user);
      assertEquals(
        (listed.body as { messages: { message: { body: string } }[] })
          .messages.map((entry) => entry.message.body),
        [hash],
      );
      const refs = refsOf(f.home, message);
      assertEquals(refs.length, 1);
      assertEquals([refs[0]!.field, refs[0]!.hash], ["body", hash]);
      // secret 원문은 응답에도 blob 어디에도 남지 않는다.
      assert(!JSON.stringify(read.body).includes(SECRET));
      for (const name of await blobHashes(f.home)) {
        assert(!(await blobBytes(f.home, name)).includes(SECRET));
      }
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

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

Deno.test("lophn-agent/conversation#R2: the body outlives the 10-minute preparation and the 7-day unreferenced grace, including a restart", async () => {
  const f = await fixture();
  try {
    const message = id("msg", 1);
    const session = id("ses", 1);
    const text = "오래 남아야 하는 말";
    const content = textContent(text);
    const hash = await hashOfContent(content);
    let orphan = "";
    {
      const core = await start(f);
      try {
        const user = await grant(f, core, "user");
        const lophn = (await assignments(core, user)).find((entry) =>
          entry.role === "lophn"
        )!;
        await openSession(core, user, lophn, session);
        const sent = await send(core, user, lophn, session, message, content);
        assertEquals(sent.status, 200, JSON.stringify(sent.body));
        // 준비 참조는 10분이면 만기이고 본문은 영구 참조 덕에 그대로 읽힌다.
        f.clock.advance(BLOB_PREPARATION_TTL_MS + MINUTE);
        await core.sweepTicketClaims();
        const read = await readBody(core, user, message);
        assertEquals(read.status, 200, JSON.stringify(read.body));
        assertEquals((read.body as Body).content, content);
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
        assertNotEquals(orphan, hash);
        // 7일이 지나고 두 blob 모두 오래전부터 미참조로 관측된 상태다. 종료 정리가 돈다.
        f.clock.advance(8 * DAY);
        await ageUnreferenced(f.home, hash, f.clock.nowMs());
        await ageUnreferenced(f.home, orphan, f.clock.nowMs());
      } finally {
        await core.shutdown();
      }
    }
    // 정리가 실제로 돌았다는 증거: 참조 없는 대조 blob은 지워졌고 본문 blob은 남았다.
    const kept = await blobHashes(f.home);
    assert(kept.includes(hash), "참조된 본문 blob이 지워졌다");
    assert(!kept.includes(orphan), "정리가 돌지 않았다");
    // 재시작한 core가 같은 본문을 돌려준다.
    const again = await start(f);
    try {
      const user = await grant(f, again, "user");
      const read = await readBody(again, user, message);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals((read.body as Body).content, content);
      assertEquals((read.body as Body).body, hash);
    } finally {
      await again.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/conversation#R2: an oversize body is rejected before anything is stored", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const user = await grant(f, core, "user");
      const lophn = (await assignments(core, user)).find((entry) =>
        entry.role === "lophn"
      )!;
      const session = id("ses", 1);
      await openSession(core, user, lophn, session);
      const before = await blobHashes(f.home);
      // 정규 직렬화 상한 위 한 바이트부터 거절이다. 한글은 UTF-8 3바이트로 센다.
      const overhead = serializeMessageContent(textContent("")).length;
      const limit = MESSAGE_TEXT_CONTENT_MAX_BYTES - overhead;
      const over = await send(
        core,
        user,
        lophn,
        session,
        id("msg", 1),
        textContent("a".repeat(limit + 1)),
      );
      assertEquals(over.status, 400, JSON.stringify(over.body));
      const wide = await send(
        core,
        user,
        lophn,
        session,
        id("msg", 2),
        textContent("가".repeat(Math.floor(limit / 3) + 1)),
      );
      assertEquals(wide.status, 400, JSON.stringify(wide.body));
      // RPC 본문 상한(256KiB)을 넘는 요청은 계약 검사 전에 끊긴다.
      const huge = await send(
        core,
        user,
        lophn,
        session,
        id("msg", 3),
        textContent("a".repeat(300_000)),
      );
      assertNotEquals(huge.status, 200);
      // hash만 보내는 옛 모양도 받지 않는다: 호출자는 blob을 만들지 않는다.
      const state = await post(core.port, "sessions/read", { session }, user);
      const hashed = await post(
        core.port,
        "messages/receive",
        command(
          { id: id("msg", 4), session, body: "ab".repeat(32), mode: "request" },
          "send-hash",
          {
            session_state: "open",
            session_state_seq:
              (state.body as { session: { state_seq: string } }).session
                .state_seq,
            assignment_revision: lophn.revision,
            assignment_state: lophn.state,
          },
        ),
        user,
      );
      assertEquals(hashed.status, 400, JSON.stringify(hashed.body));
      // 아무것도 저장·준비되지 않았다.
      const listed = await post(core.port, "messages/list", { session }, user);
      assertEquals(
        (listed.body as { messages: unknown[] }).messages.length,
        0,
      );
      assertEquals(refsOf(f.home).length, 0);
      assertEquals(await blobHashes(f.home), before);
      // 상한 안의 가장 큰 본문은 받고 그대로 읽는다.
      const fits = textContent("a".repeat(limit));
      const ok = await send(core, user, lophn, session, id("msg", 5), fits);
      assertEquals(ok.status, 200, JSON.stringify(ok.body));
      const read = await readBody(core, user, id("msg", 5));
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals((read.body as Body).content, fits);
      assertEquals(
        (read.body as Body).size_bytes,
        MESSAGE_TEXT_CONTENT_MAX_BYTES,
      );
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/conversation#R2: only the person, the assignment's agent and machine read a body, and any other message is absent", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const user = await grant(f, core, "user");
      const all = await assignments(core, user);
      const lophn = all.find((entry) => entry.role === "lophn")!;
      const engineer = all.find((entry) => entry.role === "context_engineer")!;
      const session = id("ses", 1);
      await openSession(core, user, lophn, session);
      const message = id("msg", 1);
      const sent = await send(
        core,
        user,
        lophn,
        session,
        message,
        textContent("보이는 말"),
      );
      assertEquals(sent.status, 200, JSON.stringify(sent.body));
      const run = (sent.body as { message: { run: string } }).message.run;
      const own = await grant(f, core, `agent:${lophn.id}`, {
        assignment: lophn.id,
        run,
      });
      const other = await grant(f, core, `agent:${engineer.id}`, {
        assignment: engineer.id,
        run: id("run", 9),
      });
      const machine = await grant(f, core, "machine");
      for (const token of [user, own, machine]) {
        const read = await readBody(core, token, message);
        assertEquals(read.status, 200, JSON.stringify(read.body));
        assertEquals((read.body as Body).content, textContent("보이는 말"));
      }
      // 다른 assignment의 agent가 받는 답은 없는 메시지에 받는 답과 같다.
      const outOfScope = await readBody(core, other, message);
      const absent = await readBody(core, other, id("msg", 77));
      const absentForUser = await readBody(core, user, id("msg", 77));
      assertEquals(outOfScope.status, 404);
      assertEquals(outOfScope, absent);
      assertEquals(absentForUser, absent);
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/conversation#R2: resending the same message is idempotent and the same text in a new message gets its own reference after the preparation expired", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const user = await grant(f, core, "user");
      const lophn = (await assignments(core, user)).find((entry) =>
        entry.role === "lophn"
      )!;
      const session = id("ses", 1);
      await openSession(core, user, lophn, session);
      const content = textContent("같은 말");
      const hash = await hashOfContent(content);
      const first = await send(
        core,
        user,
        lophn,
        session,
        id("msg", 1),
        content,
      );
      assertEquals(first.status, 200, JSON.stringify(first.body));
      // 같은 key의 재전송은 이전 결과다(준비 참조가 아직 살아 있다).
      const replay = await send(
        core,
        user,
        lophn,
        session,
        id("msg", 1),
        content,
      );
      assertEquals(replay, first);
      // 준비가 만기된 뒤의 재전송도 같은 결과이고 참조는 하나다.
      f.clock.advance(BLOB_PREPARATION_TTL_MS + MINUTE);
      await core.sweepTicketClaims();
      const late = await send(
        core,
        user,
        lophn,
        session,
        id("msg", 1),
        content,
      );
      assertEquals(late, first);
      assertEquals(refsOf(f.home, id("msg", 1)).length, 1);
      // 같은 글이라도 새 메시지는 자기 참조를 갖는다. 같은 hash의 blob 하나를 가리킨다.
      const second = await send(
        core,
        user,
        lophn,
        session,
        id("msg", 2),
        content,
      );
      assertEquals(second.status, 200, JSON.stringify(second.body));
      assertEquals(
        refsOf(f.home).map((ref) => [ref.owner_key, ref.hash]).sort(),
        [[id("msg", 1), hash], [id("msg", 2), hash]],
      );
      assertEquals(
        (await blobHashes(f.home)).filter((name) => name === hash).length,
        1,
      );
      // 같은 id에 다른 글은 충돌이다.
      const clash = await send(
        core,
        user,
        lophn,
        session,
        id("msg", 1),
        textContent("다른 말"),
        "send-clash",
      );
      assertEquals(clash.status, 409, JSON.stringify(clash.body));
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/conversation#R4: a machine records redacted text only and an agent text with visual blocks through core, and an oversize record stores nothing", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const user = await grant(f, core, "user");
      const lophn = (await assignments(core, user)).find((entry) =>
        entry.role === "lophn"
      )!;
      const session = id("ses", 1);
      await openSession(core, user, lophn, session);
      const sent = await send(
        core,
        user,
        lophn,
        session,
        id("msg", 1),
        textContent("질문"),
      );
      const run = (sent.body as { message: { run: string } }).message.run;
      const machine = await grant(f, core, "machine");
      const record = (message: string, content: unknown) =>
        post(
          core.port,
          "messages/record",
          command(
            { id: message, session, run, content, links: [] },
            `r-${message}`,
            {},
          ),
          machine,
        );
      // machine 확인은 글뿐이고 redaction을 거쳐 값으로 읽힌다.
      const checked = await record(
        id("msg", 2),
        textContent(`확인했다 ${SECRET}`),
      );
      assertEquals(checked.status, 200, JSON.stringify(checked.body));
      const read = await readBody(core, user, id("msg", 2));
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals((read.body as Body).content, textContent("확인했다 *"));
      assertEquals(refsOf(f.home, id("msg", 2)).length, 1);
      const visual = {
        schema_version: 1,
        parts: [{ kind: "text", text: "표" }, {
          kind: "visual",
          block: tableBlock,
        }],
      };
      const refused = await record(id("msg", 3), visual);
      assertEquals(refused.status, 400, JSON.stringify(refused.body));
      assertEquals(refsOf(f.home, id("msg", 3)).length, 0);
      // agent는 자기 run에 묶인 자격으로 글과 시각 블록을 순서대로 남기고, 글의
      // secret은 redaction을 거친다. 참조의 준비 주체는 agent 자격이다.
      const agent = await grant(f, core, `agent:${lophn.id}`, {
        assignment: lophn.id,
        run,
      });
      const shown = {
        schema_version: 1,
        parts: [{ kind: "text", text: `표를 보여 준다 ${SECRET}` }, {
          kind: "visual",
          block: tableBlock,
        }],
      };
      const answered = await post(
        core.port,
        "messages/record",
        command(
          { id: id("msg", 6), session, run, content: shown, links: [] },
          "r-agent",
          {},
          run,
        ),
        agent,
      );
      assertEquals(answered.status, 200, JSON.stringify(answered.body));
      const shownRead = await readBody(core, user, id("msg", 6));
      assertEquals(shownRead.status, 200, JSON.stringify(shownRead.body));
      const parts = (shownRead.body as Body).content.parts as {
        kind: string;
        text?: string;
        block?: { key: string };
      }[];
      assertEquals(parts.map((part) => part.kind), ["text", "visual"]);
      assertEquals(parts[0]!.text, "표를 보여 준다 *");
      assertEquals(parts[1]!.block!.key, tableBlock.key);
      // agent도 자기 답을 읽는다.
      assertEquals((await readBody(core, agent, id("msg", 6))).status, 200);
      // machine의 글은 64KiB까지다. 그보다 크면 받지 않고 아무것도 준비하지 않는다.
      const before = await blobHashes(f.home);
      const long = textContent("가".repeat(30_000));
      const tooLong = await record(id("msg", 4), long);
      assertEquals(tooLong.status, 400, JSON.stringify(tooLong.body));
      // agent의 답은 240KiB까지다. 요청 상한(256KiB) 안이어도 그보다 크면 준비하지 않는다.
      const bigAnswer = await post(
        core.port,
        "messages/record",
        command(
          {
            id: id("msg", 7),
            session,
            run,
            content: textContent("a".repeat(250_000)),
            links: [],
          },
          "r-agent-big",
          {},
          run,
        ),
        agent,
      );
      assertEquals(bigAnswer.status, 400, JSON.stringify(bigAnswer.body));
      // RPC 본문(256KiB)을 넘는 요청은 계약 검사 전에 끊긴다.
      const huge = await record(id("msg", 5), textContent("a".repeat(300_000)));
      assertEquals(huge.status, 400, JSON.stringify(huge.body));
      assertEquals(await blobHashes(f.home), before);
      assertEquals(refsOf(f.home).length, 3);
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});
