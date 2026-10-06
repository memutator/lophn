// lophn-agent/questions: 질문의 글(본문·이유·선택지 설명·추천 이유·자유 답·취소 이유)은 요청에
// 값으로 실려 오고, core가 redaction을 거쳐 blob으로 준비하며, command가 같은 transaction에서
// 영구 참조를 등록한다. 읽기(ReadQuestionText)는 메시지 본문 읽기와 같은 길이다. 실제 core와
// temp LOPHN_HOME, 가짜 시계에서 본다(사람 데이터 root와 실제 provider는 쓰지 않는다).
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  type ManualClock,
  manualClock,
  seededRandom,
  sha256Hex,
} from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { id } from "../../packages/lophn-agent/conversation/testing/mod.ts";
import { settingsOptionAction } from "../../packages/lophn-agent/questions/mod.ts";
import { type Core, startCore } from "./core.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";

const NOW = Date.UTC(2024, 0, 1);
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123";
const BASIS = "b".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };

type Fixture = {
  home: string;
  clock: ManualClock;
  starts: number;
  tokens: number;
};

async function fixture(): Promise<Fixture> {
  return {
    home: await Deno.makeTempDir({ prefix: "lophn-question-text-" }),
    clock: manualClock(NOW),
    starts: 0,
    tokens: 0,
  };
}

async function start(f: Fixture): Promise<Core> {
  const started = await startCore({
    lophnHome: f.home,
    port: 0,
    teams: [{ lophnAgentDefinitions }, { createLedgerRegistration }],
    teamModules: [new URL("./lophn-agent.ts", import.meta.url).href],
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
  "ReadSession",
  "ReceiveMessage",
  "StartRun",
  "ReadRun",
  "CreateQuestion",
  "AnswerQuestion",
  "AnswerQuestionAction",
  "DeferQuestion",
  "CancelQuestion",
  "ReadQuestion",
  "ReadQuestionText",
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
    credential_ref: `cred_qtext${n}_${f.starts}`,
    scope: { operations: OPERATIONS, targets: bound },
    conditions: bound,
  };
  const token = `${actor.replace(/\W/g, "x").slice(0, 20)}${n}`.padEnd(43, "t");
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

// 열린 core 하나와 lophn assignment의 시작한 run 하나, 그 run에 묶인 자격들.
type World = {
  core: Core;
  user: string;
  machine: string;
  agent: string;
  otherAgent: string;
  coding: string;
  lophn: Assignment;
  run: string;
};

async function world(f: Fixture, core: Core): Promise<World> {
  const user = await grant(f, core, "user");
  const listed = await post(core.port, "assignments/list", {}, user);
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const all = (listed.body as { assignments: Assignment[] }).assignments;
  const lophn = all.find((entry) => entry.role === "lophn")!;
  const engineer = all.find((entry) => entry.role === "context_engineer")!;
  const session = id("ses", 1);
  const opened = await post(
    core.port,
    "sessions/open",
    command(
      {
        id: session,
        assignment: lophn.id,
        role: lophn.role,
        work_place: { kind: "global", id: null },
        continued_from: null,
      },
      "open-session",
      { assignment_revision: lophn.revision, assignment_state: lophn.state },
    ),
    user,
  );
  assertEquals(opened.status, 200, JSON.stringify(opened.body));
  const state = await post(core.port, "sessions/read", { session }, user);
  assertEquals(state.status, 200, JSON.stringify(state.body));
  const sent = await post(
    core.port,
    "messages/receive",
    command(
      {
        id: id("msg", 1),
        session,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: "질문이 필요한 일" }],
        },
        mode: "request",
      },
      "send-first",
      {
        session_state: "open",
        session_state_seq:
          (state.body as { session: { state_seq: string } }).session.state_seq,
        assignment_revision: lophn.revision,
        assignment_state: lophn.state,
      },
    ),
    user,
  );
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  const run = (sent.body as { message: { run: string } }).message.run;
  const machine = await grant(f, core, "machine");
  const read = await post(core.port, "runs/read", { run }, machine);
  assertEquals(read.status, 200, JSON.stringify(read.body));
  const started = await post(
    core.port,
    "runs/start",
    command(
      {
        run,
        basis: BASIS,
        limits: LIMITS,
        scope: { role: "lophn", assignment: lophn.id, apps: [] },
      },
      "start-run",
      {
        state_seq: (read.body as { run: { state_seq: string } }).run.state_seq,
      },
    ),
    machine,
  );
  assertEquals(started.status, 200, JSON.stringify(started.body));
  return {
    core,
    user,
    machine,
    lophn,
    run,
    agent: await grant(f, core, `agent:${lophn.id}`, {
      assignment: lophn.id,
      run,
    }),
    otherAgent: await grant(f, core, `agent:${engineer.id}`, {
      assignment: engineer.id,
      run: id("run", 9),
    }),
    coding: await grant(f, core, `coding_agent:${id("cac", 1)}`),
  };
}

type Option = {
  key: string;
  label: string;
  description: string;
  evidence: unknown[];
  adoption: null;
  action: unknown;
};

function option(key: string, action: unknown = null): Option {
  return {
    key,
    label: `Option ${key}`,
    description: `Description of ${key}`,
    evidence: [],
    adoption: null,
    action,
  };
}

async function sha(text: string): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(text));
}

function settingsAction(question: string) {
  return settingsOptionAction({
    question,
    changes: [{
      layer: "common",
      key: "shell.reading_width",
      action: "set",
      value: 90,
    }],
    revision: 0,
    defaults_revision: "defaults-1",
  });
}

type Created = { id: string; status: string; created_seq: string };

async function ask(
  w: World,
  n: number,
  extra: Record<string, unknown> = {},
  key = `ask-${n}`,
) {
  return await post(
    w.core.port,
    "questions/create",
    command(
      {
        id: id("qst", n),
        run: w.run,
        session: null,
        prompt: `Prompt ${n}`,
        reason: `Reason ${n}`,
        options: [],
        recommendation: null,
        expires_at: null,
        ...extra,
      },
      key,
      {},
      w.run,
    ),
    w.agent,
  );
}

async function created(
  w: World,
  n: number,
  extra: Record<string, unknown> = {},
): Promise<Created> {
  const made = await ask(w, n, extra);
  assertEquals(made.status, 200, JSON.stringify(made.body));
  return (made.body as { result?: Created }).result ??
    made.body as Created;
}

async function readText(w: World, token: string, question: string) {
  return await post(w.core.port, "questions/text", { question }, token);
}

type Text = {
  question: string;
  prompt: string;
  reason: string;
  options: { key: string; description: string }[];
  recommendation: { option_key: string | null; explanation: string } | null;
  answer_text: string | null;
  closed_reason_text: string | null;
};

function plainAnswer(
  w: World,
  question: Created,
  answer: unknown,
  key: string,
) {
  return post(
    w.core.port,
    "questions/answer",
    command(
      { question: question.id, created_seq: question.created_seq, answer },
      key,
      { created_seq: question.created_seq },
    ),
    w.user,
  );
}

function refs(home: string, question: string): Record<string, unknown>[] {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare(
      "select field, hash, size_bytes from blob_refs where owner_kind = 'question' and owner_key = ? order by field, hash",
    ).all(question) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

function status(home: string, question: string): string {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return String(
      db.prepare("select status from questions where id = ?").get(question)![
        "status"
      ],
    );
  } finally {
    db.close();
  }
}

async function blobBytes(home: string, hash: string): Promise<string> {
  return await Deno.readTextFile(
    `${home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
  );
}

async function blobHashes(home: string): Promise<string[]> {
  const found: string[] = [];
  for await (const prefix of Deno.readDir(`${home}/blobs/sha256`)) {
    if (!prefix.isDirectory) continue;
    for await (
      const name of Deno.readDir(`${home}/blobs/sha256/${prefix.name}`)
    ) {
      if (name.isFile) found.push(`${prefix.name}${name.name}`);
    }
  }
  return found;
}

Deno.test("lophn-agent/questions#R4: the person reads the question text with redaction applied, and each text is one permanent reference", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1, {
        prompt: `Which one? ${SECRET} 어느 쪽이 좋을까요`,
        reason: `Both work. ${SECRET}`,
        options: [option("a"), option("b")],
        recommendation: { option_key: "a", explanation: "Smaller change." },
      });
      assertEquals(q.status, "pending");
      const read = await readText(w, w.user, q.id);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const text = read.body as Text;
      // 글은 redaction을 거친 값이다. secret 원문은 응답에도 blob 어디에도 남지 않는다.
      assertEquals(text.prompt, "Which one? * 어느 쪽이 좋을까요");
      assertEquals(text.reason, "Both work. *");
      assertEquals(text.options, [
        { key: "a", description: "Description of a" },
        { key: "b", description: "Description of b" },
      ]);
      assertEquals(text.recommendation, {
        option_key: "a",
        explanation: "Smaller change.",
      });
      assertEquals(text.answer_text, null);
      assertEquals(text.closed_reason_text, null);
      assert(!JSON.stringify(read.body).includes(SECRET));
      for (const name of await blobHashes(f.home)) {
        assert(!(await blobBytes(f.home, name)).includes(SECRET));
      }
      // 저장된 질문 record의 hash는 읽은 글의 UTF-8 bytes의 hash다.
      const record = await post(
        core.port,
        "questions/read",
        { question: q.id },
        w.user,
      );
      assertEquals(record.status, 200, JSON.stringify(record.body));
      const stored = (record.body as {
        question: {
          prompt_blob: string;
          reason_blob: string;
          options: { description_blob: string }[];
        };
      }).question;
      assertEquals(
        stored.prompt_blob,
        await sha("Which one? * 어느 쪽이 좋을까요"),
      );
      assertEquals(
        stored.options[1]!.description_blob,
        await sha("Description of b"),
      );
      // 참조는 field마다 영구 하나다(같은 글은 한 참조).
      assertEquals(
        refs(f.home, q.id).map((ref) => ref.field),
        [
          "option_description",
          "option_description",
          "prompt",
          "reason",
          "recommendation",
        ],
      );
      // 질문한 agent와 machine도 읽는다.
      for (const token of [w.agent, w.machine]) {
        const same = await readText(w, token, q.id);
        assertEquals(same.status, 200, JSON.stringify(same.body));
        assertEquals((same.body as Text).prompt, text.prompt);
      }
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R10: an agent of another assignment and any other caller get the same not_found as for an absent question", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1, { options: [option("a")] });
      const missing = id("qst", 77);
      // 다른 assignment의 agent가 받는 답은 없는 질문에 받는 답과 같다.
      const outOfScope = await readText(w, w.otherAgent, q.id);
      const absent = await readText(w, w.otherAgent, missing);
      assertEquals(outOfScope.status, 404, JSON.stringify(outOfScope.body));
      assertEquals(outOfScope, absent);
      assertEquals(await readText(w, w.user, missing), {
        status: 404,
        body: absent.body,
      });
      // 읽는 쪽으로 열려 있지 않은 자격(app)도 있는 질문과 없는 질문을 구별해 답하지 않는다.
      const app = await grant(f, core, `app:${id("app", 1)}`);
      const appReal = await readText(w, app, q.id);
      const appAbsent = await readText(w, app, missing);
      assertNotEquals(appReal.status, 200);
      assertEquals(appReal, appAbsent);
      // 읽을 수 없는 자격이 아무것도 바꾸지 않았다.
      assertEquals(status(f.home, q.id), "pending");
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R6: a plain answer needs no confirmation handle and a free-text answer's text is stored and readable", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      // action 없는 선택지는 handle 없이 받는다.
      const first = await created(w, 1, {
        options: [option("a"), option("b")],
      });
      const picked = await plainAnswer(
        w,
        first,
        { kind: "option", option_key: "a" },
        "answer-1",
      );
      assertEquals(picked.status, 200, JSON.stringify(picked.body));
      assertEquals(status(f.home, first.id), "answered");
      const pickedText = await readText(w, w.user, first.id);
      assertEquals(pickedText.status, 200, JSON.stringify(pickedText.body));
      // 선택지 답에는 자유 답 글이 없다.
      assertEquals((pickedText.body as Text).answer_text, null);
      // 같은 답의 재전송은 저장된 결과이고 새 결정이 아니다.
      const again = await plainAnswer(
        w,
        first,
        { kind: "option", option_key: "a" },
        "answer-1",
      );
      assertEquals(again, picked);
      // 자유 답은 글을 값으로 보낸다. core가 blob으로 준비하고 hash는 호출자가 만들지 않는다.
      const second = await created(w, 2);
      const said = "두 번째 안으로 가 주세요. Please use the second one.";
      const answered = await plainAnswer(
        w,
        second,
        { kind: "text", text: said },
        "answer-2",
      );
      assertEquals(answered.status, 200, JSON.stringify(answered.body));
      const read = await readText(w, w.user, second.id);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals((read.body as Text).answer_text, said);
      const record = await post(
        core.port,
        "questions/read",
        { question: second.id },
        w.user,
      );
      assertEquals(
        (record.body as { question: { answer: unknown } }).question.answer,
        { kind: "text", option_key: null, text_blob: await sha(said) },
      );
      const saidHash = await sha(said);
      assert(
        refs(f.home, second.id).some((ref) =>
          ref.field === "answer" && ref.hash === saidHash &&
          Number(ref.size_bytes) === new TextEncoder().encode(said).length
        ),
      );
      // 질문한 agent는 자기 질문의 답을 읽고, coding_agent는 사람이 남긴 글을 받지 않는다.
      const asAgent = await readText(w, w.agent, second.id);
      assertEquals((asAgent.body as Text).answer_text, said);
      const asCoding = await readText(w, w.coding, second.id);
      assertEquals(asCoding.status, 200, JSON.stringify(asCoding.body));
      assertEquals((asCoding.body as Text).prompt, "Prompt 2");
      assertEquals((asCoding.body as Text).answer_text, null);
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R11: a free-text answer that looks like a secret is held back before it is stored", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1);
      const before = await blobHashes(f.home);
      for (
        const text of [`my token is ${SECRET}`, "   \n ", ""]
      ) {
        const held = await plainAnswer(
          w,
          q,
          { kind: "text", text },
          `answer-${text.length}`,
        );
        assertEquals(held.status, 400, JSON.stringify(held.body));
        assert(!JSON.stringify(held.body).includes(SECRET));
      }
      // 막힌 답은 저장도 준비도 되지 않고 질문은 미답으로 남는다.
      assertEquals(status(f.home, q.id), "pending");
      assertEquals(await blobHashes(f.home), before);
      assertEquals(refs(f.home, q.id).filter((r) => r.field === "answer"), []);
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("platform/identity#R14: a fixed-change answer is refused without a confirmation handle on either route", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const action = settingsAction(id("qst", 1));
      const q = await created(w, 1, {
        options: [option("plain"), option("apply", action)],
      });
      // user token은 클릭의 증거가 아니다. action이 있는 선택지는 확인 없는 일반 답으로
      // 받지 않는다.
      const viaPlain = await plainAnswer(
        w,
        q,
        { kind: "option", option_key: "apply" },
        "answer-plain",
      );
      assertEquals(viaPlain.status, 403, JSON.stringify(viaPlain.body));
      // action 답 route는 handle 없이 받지 않는다.
      const viaAction = await post(
        core.port,
        "questions/answer-action",
        command(
          {
            question: q.id,
            created_seq: q.created_seq,
            answer: { kind: "option", option_key: "apply" },
            binding_hash: action.binding_hash,
            evidence: { question: q.id, option: "apply" },
          },
          "answer-action",
          { created_seq: q.created_seq },
        ),
        w.user,
      );
      // 확인 handle이 요청 모양의 필수 부분이라 요청이 계약 검사에서 거절된다.
      assertEquals(viaAction.status, 400, JSON.stringify(viaAction.body));
      // 잘못된 모양의 handle도 받지 않는다.
      const forged = await post(
        core.port,
        "questions/answer-action",
        {
          ...command(
            {
              question: q.id,
              created_seq: q.created_seq,
              answer: { kind: "option", option_key: "apply" },
              binding_hash: action.binding_hash,
              evidence: { question: q.id, option: "apply" },
            },
            "answer-forged",
            { created_seq: q.created_seq },
          ),
          confirmation: "x".repeat(43),
        },
        w.user,
      );
      assertNotEquals(forged.status, 200, JSON.stringify(forged.body));
      assertEquals(status(f.home, q.id), "pending");
      // action 없는 선택지는 같은 질문에서 확인 없이 답할 수 있다.
      const plain = await plainAnswer(
        w,
        q,
        { kind: "option", option_key: "plain" },
        "answer-ok",
      );
      assertEquals(plain.status, 200, JSON.stringify(plain.body));
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R9: a cancel reason carries text and is readable by the person but not by a coding agent", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1, { options: [option("a")] });
      const reason = `더는 필요 없다. ${SECRET}`;
      const cancelled = await post(
        core.port,
        "questions/cancel",
        command(
          {
            question: q.id,
            created_seq: q.created_seq,
            closed_reason: "cancelled",
            closed_reason_text: reason,
          },
          "cancel-1",
          { created_seq: q.created_seq },
        ),
        w.user,
      );
      assertEquals(cancelled.status, 200, JSON.stringify(cancelled.body));
      const read = await readText(w, w.user, q.id);
      assertEquals(read.status, 200, JSON.stringify(read.body));
      assertEquals((read.body as Text).closed_reason_text, "더는 필요 없다. *");
      assertEquals(
        (await readText(w, w.agent, q.id)).body as Text,
        read.body as Text,
      );
      assertEquals(
        ((await readText(w, w.coding, q.id)).body as Text).closed_reason_text,
        null,
      );
      assertEquals(
        refs(f.home, q.id).filter((ref) => ref.field === "closed").length,
        1,
      );
      // 미루기는 사람 글이 없다. 이유 글도 없다.
      const deferred = await created(w, 2);
      const closed = await post(
        core.port,
        "questions/defer",
        command(
          { question: deferred.id, created_seq: deferred.created_seq },
          "defer-2",
          { created_seq: deferred.created_seq },
        ),
        w.user,
      );
      assertEquals(closed.status, 200, JSON.stringify(closed.body));
      assertEquals(
        ((await readText(w, w.user, deferred.id)).body as Text)
          .closed_reason_text,
        null,
      );
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R10: an unreadable text blob makes the whole read unavailable, and a question with no reference is unavailable too", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const q = await created(w, 1, { options: [option("a")] });
      assertEquals((await readText(w, w.user, q.id)).status, 200);
      // blob 파일이 사라지면 빈 글이 아니라 unavailable이다.
      const hash = await sha("Prompt 1");
      await Deno.remove(
        `${f.home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
      );
      const lost = await readText(w, w.user, q.id);
      assertEquals(lost.status, 503, JSON.stringify(lost.body));
      assertEquals(
        (lost.body as { error?: { code?: string } }).error?.code ??
          (lost.body as { code?: string }).code,
        "unavailable",
      );
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});

Deno.test("lophn-agent/questions#R3: an oversize text or the old hash-only shape is rejected before anything is stored", async () => {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      const w = await world(f, core);
      const before = await blobHashes(f.home);
      const big = await ask(w, 1, { prompt: "a".repeat(33_000) });
      assertEquals(big.status, 400, JSON.stringify(big.body));
      // hash만 보내는 옛 모양도 받지 않는다: 호출자는 blob을 만들지 않는다.
      const hashed = await post(
        core.port,
        "questions/create",
        command(
          {
            id: id("qst", 2),
            run: w.run,
            session: null,
            prompt_blob: "ab".repeat(32),
            reason_blob: "cd".repeat(32),
            options: [],
            recommendation: null,
            expires_at: null,
          },
          "ask-hash",
          {},
          w.run,
        ),
        w.agent,
      );
      assertEquals(hashed.status, 400, JSON.stringify(hashed.body));
      assertEquals(await blobHashes(f.home), before);
      assertEquals(refs(f.home, id("qst", 1)), []);
      // 상한 안의 가장 큰 글은 받는다.
      const fits = await ask(w, 3, { prompt: "a".repeat(32_768) });
      assertEquals(fits.status, 200, JSON.stringify(fits.body));
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
});
