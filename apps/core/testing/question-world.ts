/**
 * 질문 묶음을 실제 core(임시 LOPHN_HOME, 가짜 시계)에서 보는 시험이 같이 쓰는 준비. 시작한 run 하나와
 * 그 run에 묶인 agent·사람·machine 자격을 만든다. run은 세션 없이 machine이 접수한다(handoff로
 * 받은 일처럼): 질문 묶음은 세션이 없어도 낸다(lophn-agent/questions#R2). 실제 provider와 사람
 * 데이터 root는 열지 않는다. 제품 main.ts에는 없다.
 */
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  type ManualClock,
  manualClock,
  seededRandom,
  sha256Hex,
} from "../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../packages/protocol/platform/mod.ts";
import { settingsOptionAction } from "../../../packages/lophn-agent/questions/mod.ts";
import { type Core, startCore } from "../core.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "../lophn-agent.ts";

// 시험 id. 같은 번호는 접두사만 다르고 꼬리가 같다(묶음 n의 첫 질문은 질문 n).
const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
export function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

export const NOW = Date.UTC(2024, 0, 1);
export const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123";
export const BASIS = "b".repeat(64);
export const LIMITS = {
  model_attempts: 30,
  stall_ms: 300_000,
  active_ms: 1_800_000,
};

export type Fixture = {
  home: string;
  clock: ManualClock;
  starts: number;
  tokens: number;
};

export async function fixture(): Promise<Fixture> {
  return {
    home: await Deno.makeTempDir({ prefix: "lophn-question-text-" }),
    clock: manualClock(NOW),
    starts: 0,
    tokens: 0,
  };
}

export async function start(f: Fixture): Promise<Core> {
  const started = await startCore({
    lophnHome: f.home,
    port: 0,
    teams: [{ lophnAgentDefinitions }, { createLedgerRegistration }],
    teamModules: [new URL("../lophn-agent.ts", import.meta.url).href],
    clock: f.clock,
    // 시작마다 다른 seed다. 같은 seed는 같은 credential ref를 만든다.
    random: seededRandom(100 + ++f.starts),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  return started.value;
}

export const OPERATIONS = [
  "ListAssignments",
  "AcceptRun",
  "StartRun",
  "ReadRun",
  "ListRuns",
  "WaitRun",
  "ResolveRunWait",
  "CreateQuestionGroup",
  "AnswerQuestionGroup",
  "AnswerQuestionAction",
  "DeferQuestionGroup",
  "CancelQuestionGroup",
  "ExpireQuestionGroup",
  "ReadQuestionGroup",
  "ReadQuestionText",
  // 사람이 고른 선택지의 고정 action 적용(questions#R13): 적용 자격은 소유 command의 operation도
  // 가진다.
  "ApplyQuestionOption",
  "ApplySettings",
  "GetSettings",
  "SettingsDefinitions",
];

// 이 core에서 쓰는 자격 하나. 같은 token을 한 번만 받고 기록한다.
export async function grant(
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

export async function post(
  port: number,
  path: string,
  body: unknown,
  token: string,
) {
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

export function command(
  input: unknown,
  key: string,
  compare: unknown,
  run?: string,
) {
  return {
    input,
    idempotency_key: key,
    compare,
    prepared: [],
    ...(run === undefined ? {} : { run }),
  };
}

export type Assignment = {
  id: string;
  role: string;
  revision: number;
  state: string;
};

// 열린 core 하나와 lophn assignment의 시작한 run 하나, 그 run에 묶인 자격들.
export type World = {
  core: Core;
  user: string;
  machine: string;
  agent: string;
  otherAgent: string;
  coding: string;
  lophn: Assignment;
  run: string;
};

// lophn assignment의 run 하나를 machine이 접수해 시작하고 그 run에 묶인 agent 자격을 만든다. 세션 없는
// run(handoff로 받은 일 같은)도 묶음을 낸다. 이어 받는 run은 앞 run이 끝난 뒤에 만든다.
export async function openRun(
  f: Fixture,
  core: Core,
  machine: string,
  lophn: Assignment,
  n: number,
): Promise<{ run: string; agent: string }> {
  const run = id("run", n);
  const accepted = await post(
    core.port,
    "runs/accept",
    command(
      {
        id: run,
        assignment: lophn.id,
        session: null,
        source: { kind: "message", message: id("msg", n) },
        continued_from: null,
        start_after: null,
      },
      `accept-run-${n}`,
      { assignment_revision: lophn.revision },
    ),
    machine,
  );
  assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
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
      `start-run-${n}`,
      {
        state_seq: (read.body as { run: { state_seq: string } }).run.state_seq,
      },
    ),
    machine,
  );
  assertEquals(started.status, 200, JSON.stringify(started.body));
  return {
    run,
    agent: await grant(f, core, `agent:${lophn.id}`, {
      assignment: lophn.id,
      run,
    }),
  };
}

export async function world(f: Fixture, core: Core): Promise<World> {
  const user = await grant(f, core, "user");
  const listed = await post(core.port, "assignments/list", {}, user);
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const all = (listed.body as { assignments: Assignment[] }).assignments;
  const lophn = all.find((entry) => entry.role === "lophn")!;
  const engineer = all.find((entry) => entry.role === "context_engineer")!;
  const machine = await grant(f, core, "machine");
  const seat = await openRun(f, core, machine, lophn, 1);
  return {
    core,
    user,
    machine,
    lophn,
    run: seat.run,
    agent: seat.agent,
    otherAgent: await grant(f, core, `agent:${engineer.id}`, {
      assignment: engineer.id,
      run: id("run", 9),
    }),
    coding: await grant(f, core, `coding_agent:${id("cac", 1)}`),
  };
}

export type Option = {
  key: string;
  label: string;
  description: string;
  evidence: unknown[];
  adoption: null;
  action: unknown;
};

export function option(key: string, action: unknown = null): Option {
  return {
    key,
    label: `Option ${key}`,
    description: `Description of ${key}`,
    evidence: [],
    adoption: null,
    action,
  };
}

export async function sha(text: string): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(text));
}

export function settingsAction(question: string) {
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

export type Created = { id: string; status: string; created_seq: string };

// 묶음 n. 질문을 따로 주지 않으면 질문 n 하나짜리 묶음이다. 묶음의 값(expires_at·session)과 질문의
// 값(prompt·reason·options·recommendation)을 한 곳에서 덮어쓴다.
export function groupBody(
  w: World,
  n: number,
  extra: Record<string, unknown> = {},
) {
  const { questions, expires_at, session, ...question } = extra;
  return {
    id: id("qgr", n),
    run: w.run,
    session: session ?? null,
    expires_at: expires_at ?? null,
    questions: questions ?? [{
      id: id("qst", n),
      prompt: `Prompt ${n}`,
      reason: `Reason ${n}`,
      options: [],
      recommendation: null,
      ...question,
    }],
  };
}

export async function ask(
  w: World,
  n: number,
  extra: Record<string, unknown> = {},
  key = `ask-${n}`,
) {
  return await post(
    w.core.port,
    "questions/create",
    command(groupBody(w, n, extra), key, {}, w.run),
    w.agent,
  );
}

export async function created(
  w: World,
  n: number,
  extra: Record<string, unknown> = {},
): Promise<Created> {
  const made = await ask(w, n, extra);
  assertEquals(made.status, 200, JSON.stringify(made.body));
  return (made.body as { result?: Created }).result ??
    made.body as Created;
}

export async function readText(w: World, token: string, group: string) {
  return await post(w.core.port, "questions/text", { group }, token);
}

export type Text = {
  group: string;
  questions: {
    question: string;
    prompt: string;
    reason: string;
    options: { key: string; description: string }[];
    recommendation: { option_key: string | null; explanation: string } | null;
    answer_text: string | null;
  }[];
  closed_reason_text: string | null;
};

// 질문 하나짜리 묶음의 질문 글.
export const only = (text: Text) => text.questions[0]!;

// 묶음의 답. 질문 하나짜리 묶음이면 Answer 하나를 첫 질문(qst n)의 답으로 싣는다.
export function plainAnswer(
  w: World,
  group: Created,
  answer: unknown,
  key: string,
) {
  const answers = Array.isArray(answer) ? answer : [{
    question: group.id.replace(/^qgr_/, "qst_"),
    answer,
  }];
  return post(
    w.core.port,
    "questions/answer",
    command(
      { group: group.id, created_seq: group.created_seq, answers },
      key,
      { created_seq: group.created_seq },
    ),
    w.user,
  );
}

export function refs(home: string, group: string): Record<string, unknown>[] {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare(
      "select field, hash, size_bytes from blob_refs where owner_kind = 'question' and owner_key = ? order by field, hash",
    ).all(group) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

export function status(home: string, group: string): string {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return String(
      db.prepare("select status from question_groups where id = ?").get(
        group,
      )!["status"],
    );
  } finally {
    db.close();
  }
}

export async function blobBytes(home: string, hash: string): Promise<string> {
  return await Deno.readTextFile(
    `${home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`,
  );
}

export async function blobHashes(home: string): Promise<string[]> {
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
  } catch (error) {
    // blob을 한 번도 저장하지 않은 data root에는 폴더가 없다.
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return found;
}
