// lophn-agent/harness/waiting-and-recovery: 질문 묶음을 기다리는 run의 결정 반영을 실제 core(임시
// LOPHN_HOME, 가짜 시계)에서 본다. 묶음 하나가 기다림의 요청 하나이고(`waiting_on`은 qgr) 묶음 전체의
// 답이 같은 run을 한 번 재개하며, 미루기·만료·취소는 묶음 전체의 답 없음 종료다. run은 세션 없이
// machine이 접수한 것을 쓴다(세션 흐름은 conversation의 시험이 본다). 실제 provider와 사람 데이터
// root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../../base/mod.ts";
import { answerQuestionAction } from "../../../protocol/lophn-agent/mod.ts";
import { createWaitResolver, type WaitStep } from "./mod.ts";
import { settingsOptionAction } from "../tools/questions/mod.ts";
import { confirmationBinding } from "../../server/identity/mod.ts";
import {
  command,
  created,
  type Fixture,
  fixture,
  groupBody,
  id,
  openRun,
  option,
  post,
  start,
  type World,
  world,
} from "../../testing/question-world.ts";
import type { Core } from "../../main/daemon/core.ts";

type Reply = { status: number; body: unknown };

function machineCall(w: World) {
  return async (path: string, body: unknown): Promise<Result<unknown>> => {
    const reply: Reply = await post(
      w.core.port,
      path.replace(/^\/v1\//, ""),
      body,
      w.machine,
    );
    if (reply.status === 200) return ok(reply.body);
    const error = (reply.body as {
      error?: { code?: string; message?: string };
    }).error;
    return err({
      code: (error?.code ?? "internal") as "internal",
      message: error?.message ?? "core error",
    });
  };
}

// 판정은 질문 기다림에 쓰이지 않는다(approval만 쓴다).
function resolverOf(w: World) {
  return createWaitResolver({
    machine: machineCall(w),
    judgment: {} as never,
    callRequest: () =>
      Promise.resolve(
        err({ code: "not_found" as const, message: "no input" }),
      ),
  });
}

function rows(f: Fixture, query: string, params: string[] = []) {
  const db = new DatabaseSync(`${f.home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare(query).all(...params) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

const count = (f: Fixture, query: string, params: string[] = []) =>
  Number(rows(f, query, params)[0]!["n"]);

const RESUMED = "select count(*) as n from events where type = 'RunResumed'";
const RESOLUTIONS = "select count(*) as n from run_wait_resolutions";

async function runOf(w: World) {
  const read = await post(w.core.port, "runs/read", { run: w.run }, w.machine);
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return (read.body as {
    run: {
      state: string;
      state_seq: string;
      waiting_on: string | null;
      outcome: { kind: string; reason: string } | null;
    };
  }).run;
}

// 질문 tool이 하는 대로 agent가 묶음을 만들고 machine이 같은 내용으로 WaitRun에 싣는다.
async function waitOn(w: World, n: number, extra: Record<string, unknown>) {
  const group = await created(w, n, extra);
  const run = await runOf(w);
  const waited = await post(
    w.core.port,
    "runs/wait",
    command(
      {
        run: w.run,
        request: { kind: "question", input: groupBody(w, n, extra) },
        call: null,
      },
      `wait-${n}`,
      { state_seq: run.state_seq },
    ),
    w.machine,
  );
  assertEquals(waited.status, 200, JSON.stringify(waited.body));
  return group;
}

function answerGroup(
  w: World,
  group: { id: string; created_seq: string },
  answers: { question: string; answer: unknown }[],
  key: string,
) {
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

const two = (first: number) =>
  [first, first + 1].map((n) => ({
    id: id("qst", n),
    prompt: `Prompt ${n}`,
    reason: "r",
    options: [option("a"), option("b")],
    recommendation: null,
  }));

function settled(step: Result<WaitStep>): WaitStep {
  assert(step.ok, step.ok ? "" : JSON.stringify(step.error));
  return step.value;
}

async function withWorld(
  body: (f: Fixture, core: Core, w: World) => Promise<void>,
) {
  const f = await fixture();
  try {
    const core = await start(f);
    try {
      await body(f, core, await world(f, core));
    } finally {
      await core.shutdown();
    }
  } finally {
    await Deno.remove(f.home, { recursive: true });
  }
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R1 [agent-I13]: the run waits on the group and one Submit of all its questions resumes the same run once", async () => {
  await withWorld(async (f, _core, w) => {
    const group = await waitOn(w, 1, { questions: two(1) });
    // run은 묶음 하나를 기다린다. 사람이 답하기 전에는 재개하지 않는다.
    const waiting = await runOf(w);
    assertEquals(waiting.state, "waiting_user");
    assertEquals(waiting.waiting_on, group.id);
    const resolver = resolverOf(w);
    assertEquals(settled(await resolver.settle(w.run)), {
      kind: "pending",
      request: group.id,
    });
    // 질문 하나만 답한 Submit은 받지 않으므로 기다림은 그대로다.
    const partial = await answerGroup(w, group, [
      { question: id("qst", 1), answer: { kind: "option", option_key: "a" } },
    ], "answer-partial");
    assertEquals(partial.status, 400, JSON.stringify(partial.body));
    assertEquals(settled(await resolver.settle(w.run)).kind, "pending");
    // 모든 질문에 답한 Submit 한 번이 같은 run을 한 번 재개한다.
    const answered = await answerGroup(w, group, [
      { question: id("qst", 1), answer: { kind: "option", option_key: "a" } },
      { question: id("qst", 2), answer: { kind: "text", text: "Free." } },
    ], "answer-all");
    assertEquals(answered.status, 200, JSON.stringify(answered.body));
    const closedSeq = (answered.body as {
      result?: { closed_seq: string };
      closed_seq?: string;
    }).result?.closed_seq ??
      (answered.body as { closed_seq: string }).closed_seq;
    // 재시작한 해소기가 현재 사실에서 한 번만 반영한다(event가 없어도 같은 읽기로 만난다).
    const recovered = await resolverOf(w).recover();
    assert(recovered.ok, recovered.ok ? "" : JSON.stringify(recovered.error));
    assertEquals(recovered.value.length, 1);
    const step = recovered.value[0]!.step;
    assert(step.kind === "resolved");
    assertEquals(step.state, "running");
    assertEquals(step.resolution.result, "resumed");
    assertEquals(step.resolution.reason, "question_answered");
    assertEquals(step.resolution.request, group.id);
    assertEquals(step.resolution.decision_seq, closedSeq);
    const after = await runOf(w);
    assertEquals(after.state, "running");
    assertEquals(after.waiting_on, null);
    assertEquals(count(f, RESUMED), 1);
    assertEquals(count(f, RESOLUTIONS), 1);
    // 다시 만나도 새로 반영하지 않는다.
    const again = await resolverOf(w).recover();
    assert(again.ok);
    assertEquals(again.value, []);
    assertEquals(settled(await resolver.settle(w.run)).kind, "idle");
    assertEquals(count(f, RESUMED), 1);
    assertEquals(count(f, RESOLUTIONS), 1);
  });
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R1 [agent-I13]: deferring and cancelling a group stop the run with no answer", async () => {
  await withWorld(async (f, core, first) => {
    const ends = async (w: World, group: string) => {
      const step = settled(await resolverOf(w).settle(w.run));
      assert(step.kind === "resolved");
      assertEquals(step.state, "finished");
      assertEquals(step.resolution.result, "stopped_no_answer");
      assertEquals(step.resolution.reason, "no_answer");
      assertEquals(step.resolution.request, group);
      const run = await runOf(w);
      assertEquals(run.state, "finished");
      assertEquals(run.outcome, { kind: "stopped", reason: "no_answer" });
      // 어느 경우도 답이 없고 재개 event도 없다.
      assertEquals(
        count(
          f,
          `select count(*) as n from questions where "group" = ? and answer is not null`,
          [group],
        ),
        0,
      );
    };
    // Skip(미루기)
    const deferred = await waitOn(first, 1, { questions: two(1) });
    const skip = await post(
      core.port,
      "questions/defer",
      command(
        { group: deferred.id, created_seq: deferred.created_seq },
        "defer-1",
        { created_seq: deferred.created_seq },
      ),
      first.user,
    );
    assertEquals(skip.status, 200, JSON.stringify(skip.body));
    await ends(first, deferred.id);
    // 취소
    const seat3 = await openRun(f, core, first.machine, first.lophn, 2);
    const third = { ...first, ...seat3 };
    const cancelling = await waitOn(third, 2, { questions: two(3) });
    const cancelled = await post(
      core.port,
      "questions/cancel",
      command(
        {
          group: cancelling.id,
          created_seq: cancelling.created_seq,
          closed_reason: "cancelled",
          closed_reason_text: "Not needed any more.",
        },
        "cancel-2",
        { created_seq: cancelling.created_seq },
      ),
      first.user,
    );
    assertEquals(cancelled.status, 200, JSON.stringify(cancelled.body));
    await ends(third, cancelling.id);
    assertEquals(count(f, RESUMED), 0);
    assertEquals(count(f, RESOLUTIONS), 2);
  });
});

// 설정 판을 실제로 읽은 기준으로 고정한 선택지를 만들어 묶음을 기다리고 사람이 그 선택지를 고른다.
async function askAndChoose(
  f: Fixture,
  w: World,
  n: number,
  value: string,
  stale = false,
) {
  const read = await post(
    w.core.port,
    "settings/get",
    { keys: ["shell.reading_width"] },
    w.user,
  );
  assertEquals(read.status, 200, JSON.stringify(read.body));
  const basis = read.body as { revision: number; defaults_revision: string };
  const question = id("qst", n);
  const action = settingsOptionAction({
    question,
    changes: [{
      layer: "common",
      key: "shell.reading_width",
      action: "set",
      value,
    }],
    revision: stale ? basis.revision + 5 : basis.revision,
    defaults_revision: basis.defaults_revision,
  });
  const group = await waitOn(w, n, {
    questions: [{
      id: question,
      prompt: `Which reading width? (${n})`,
      reason: "r",
      options: [option("plain"), option("apply", action)],
      recommendation: { option_key: "apply", explanation: "It reads better." },
    }],
  });
  const input = {
    group: group.id,
    created_seq: group.created_seq,
    answer: { kind: "option", option_key: "apply" },
    binding_hash: action.binding_hash,
    evidence: { question, option: "apply" },
  };
  const binding = await confirmationBinding(answerQuestionAction, input);
  assert(binding, "no confirmation binding");
  const issued = await w.core.confirmation?.({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: `win-${n}`,
      target_ref: binding.target,
      content_hash: binding.content,
      allowed_decisions: [answerQuestionAction.name],
      expires_at: new Date(f.clock.nowMs() + 120_000).toISOString(),
    },
  });
  assert(issued?.ok, "confirmation was not issued");
  const answered = await post(
    w.core.port,
    "questions/answer-action",
    {
      ...command(input, `answer-action-${n}`, {
        created_seq: group.created_seq,
      }),
      confirmation: (issued.value as { confirmation: string }).confirmation,
    },
    w.user,
  );
  assertEquals(answered.status, 200, JSON.stringify(answered.body));
  return { group, question };
}

const EVIDENCE = "select count(*) as n from question_evidence";
const SETTINGS_CHANGED =
  "select count(*) as n from events where type = 'SettingsChanged'";

Deno.test("lophn-agent/questions#R13 [agent-I13]: choosing an action option applies only the fixed change once and then resumes the run once", async () => {
  await withWorld(async (f, _core, w) => {
    const { group, question } = await askAndChoose(f, w, 1, "wide");
    // 답을 접수했을 뿐 변경은 없다.
    assertEquals(count(f, SETTINGS_CHANGED), 0);
    assertEquals(count(f, EVIDENCE), 0);
    const step = settled(await resolverOf(w).settle(w.run));
    assert(step.kind === "resolved");
    assertEquals(step.resolution.result, "resumed");
    assertEquals(count(f, SETTINGS_CHANGED), 1);
    assertEquals(count(f, EVIDENCE), 1);
    assertEquals(count(f, RESUMED), 1);
    const width = await post(
      w.core.port,
      "settings/get",
      { keys: ["shell.reading_width"] },
      w.user,
    );
    assertEquals(
      (width.body as { settings: { value: unknown }[] }).settings[0]!.value,
      "wide",
    );
    // 적용은 묶음 읽기에 질문마다의 적용 결과로 드러나고 사람의 답과 구별된다.
    const read = await post(
      w.core.port,
      "questions/read",
      { group: group.id },
      w.machine,
    );
    const record = (read.body as {
      group: { questions: { id: string; applied: boolean }[] };
    }).group;
    assertEquals(record.questions.map((one) => [one.id, one.applied]), [
      [question, true],
    ]);
    // 근거를 검증한 적용은 사람 결정이라 actor=user, run=null로 남는다(identity R14).
    const changed = rows(
      f,
      "select actor, run from events where type = 'SettingsChanged'",
    );
    assertEquals(changed[0]!["actor"], "user");
    assertEquals(changed[0]!["run"], null);
    // 다시 만나도 적용도 재개도 더하지 않는다.
    assertEquals(settled(await resolverOf(w).settle(w.run)).kind, "idle");
    assertEquals(count(f, SETTINGS_CHANGED), 1);
    assertEquals(count(f, RESUMED), 1);
  });
});

Deno.test("lophn-agent/questions#R14 [agent-I13]: when the premise of an action option changed the answer stays, nothing is applied and the run keeps waiting", async () => {
  await withWorld(async (f, _core, w) => {
    const { group } = await askAndChoose(f, w, 1, "wide", true);
    const held = settled(await resolverOf(w).settle(w.run));
    assert(held.kind === "action_pending");
    assert(held.why !== undefined);
    // 적용 시도는 통째로 되돌아가 변경도 일회 기록도 재개도 없다.
    assertEquals(count(f, SETTINGS_CHANGED), 0);
    assertEquals(count(f, EVIDENCE), 0);
    assertEquals(count(f, RESUMED), 0);
    assertEquals(count(f, RESOLUTIONS), 0);
    const run = await runOf(w);
    assertEquals(run.state, "waiting_user");
    assertEquals(run.waiting_on, group.id);
    // 답은 그대로이고 적용 안 됨으로 읽힌다.
    const read = await post(
      w.core.port,
      "questions/read",
      { group: group.id },
      w.machine,
    );
    const record = (read.body as {
      group: {
        status: string;
        questions: { answer: unknown; applied: boolean }[];
      };
    }).group;
    assertEquals(record.status, "answered");
    assertEquals(record.questions[0]!.applied, false);
    assert(record.questions[0]!.answer !== null);
  });
});
