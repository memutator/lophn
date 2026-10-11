// lophn-agent#T29 끝에서 끝까지: 사람이 고른 용어 정의 선택지가 실제 core·documents 위에서
// 한 번만 적용되는지 본다(실제 core, documents worker. 데이터 root는 temp dir이고 사람
// 데이터 root는 열지 않는다). model provider는 부르지 않는다. 문서 자리 이동·앱 등록
// 선택지는 question-option-actions_test.ts와 registration_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { answerQuestionAction } from "../../packages/contracts/lophn-agent/mod.ts";
import { defineTermOptionAction } from "../../packages/lophn-agent/questions/mod.ts";
import { call, command, count, inspect } from "./testing/approvals-fixture.ts";
import type { Server } from "./testing/approvals-fixture.ts";
import {
  issueConfirmation,
  MACHINE_TOKEN,
  openWaitingWorld,
  USER_TOKEN,
  type WaitingWorld,
} from "./testing/waiting-world.ts";
import { id } from "./testing/tool-judgment-world.ts";

const DEFINED = "select count(*) as n from events where type = 'TermDefined'";
const EVIDENCE = "select count(*) as n from question_evidence";

const CONTEXT = id("ctx", 1);
const TERM_ONE = id("trm", 1);
const TERM_TWO = id("trm", 2);

function termRows(world: Server, term: string) {
  return inspect(
    world,
    "select name, definition, status from terms where id = ?",
    [term],
  );
}

async function open(): Promise<WaitingWorld> {
  const world = await openWaitingWorld();
  // 뜻을 정리할 자료와 목적은 사람이 정한다(contexts/create는 사람 몫이다). machine에게는
  // 없는 동작이다.
  const created = await world.post("contexts/create", USER_TOKEN, {
    id: CONTEXT,
    title: "판단 기준",
    purpose: "이 판단에서 쓸 말의 뜻",
    items: [],
  });
  assertEquals(created.status, 200, JSON.stringify(created.body));
  return world;
}

let counter = 0;

// 용어 정의 선택지를 질문한다. 적용은 하지 않는다. 앞 질문이 끝나지 않은 run은 새 질문을
// 받지 않으므로 질문마다 seat을 고른다.
async function askTerm(
  world: WaitingWorld,
  fixed: { id: string; name: string; definition: string },
  seat: "lophn" | "editor" = "lophn",
) {
  counter += 1;
  const group = id("qgr", 100 + counter);
  const question = id("qst", 100 + counter);
  const action = defineTermOptionAction({ context: CONTEXT, ...fixed });
  const run = world[seat].run;
  const state = await world.read("runs/read", MACHINE_TOKEN, { run });
  const waited = await world.post("runs/wait", MACHINE_TOKEN, {
    run,
    request: {
      kind: "question",
      input: {
        id: group,
        run,
        session: null,
        expires_at: null,
        questions: [{
          id: question,
          prompt: `Define this term? (${question})`,
          reason: "The person decides what their word means.",
          options: [
            {
              key: "define",
              label: "이 뜻으로 정의",
              description: "이 이름과 뜻으로 용어를 정의한다.",
              evidence: [],
              adoption: null,
              action,
            },
            {
              key: "leave",
              label: "남겨 둔다",
              description: "정의하지 않고 후보로 남긴다.",
              evidence: [],
              adoption: null,
              action: null,
            },
          ],
          recommendation: {
            option_key: "define",
            explanation: "사람이 고른 뜻이다.",
          },
        }],
      },
    },
    call: null,
  }, {
    state_seq: (state.body["run"] as { state_seq: string }).state_seq,
  });
  assertEquals(waited.status, 200, JSON.stringify(waited.body));
  const read = await world.read("questions/read", MACHINE_TOKEN, { group });
  const created = (read.body["group"] as { created_seq: string }).created_seq;
  return { group, question, action, created };
}

// 사람이 고른 선택지로 답한다(사람 확인이 필요한 AnswerQuestionAction).
async function choose(
  world: WaitingWorld,
  asked: {
    group: string;
    question: string;
    created: string;
    action: { binding_hash: string };
  },
) {
  const input = {
    group: asked.group,
    created_seq: asked.created,
    answer: { kind: "option", option_key: "define" },
    binding_hash: asked.action.binding_hash,
    evidence: { question: asked.question, option: "define" },
  };
  const reply = await call(
    world.server,
    "questions/answer-action",
    USER_TOKEN,
    command(input, {
      compare: { created_seq: asked.created },
      confirmation: await issueConfirmation(world, answerQuestionAction, input),
    }),
  );
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
}

// 사람이 action 없는 다른 선택지를 고른다. 사람 확인이 필요 없는 AnswerQuestion이다.
async function chooseLeave(
  world: WaitingWorld,
  asked: { group: string; question: string; created: string },
) {
  const left = await world.post(
    "questions/answer",
    USER_TOKEN,
    {
      group: asked.group,
      created_seq: asked.created,
      answers: [{
        question: asked.question,
        answer: { kind: "option", option_key: "leave" },
      }],
    },
    { created_seq: asked.created },
  );
  assertEquals(left.status, 200, JSON.stringify(left.body));
}

function applyDefine(
  world: WaitingWorld,
  question: string,
  action: unknown,
  token = MACHINE_TOKEN,
) {
  const closed = String(
    inspect(
      world.server,
      `select g.closed_seq as s from questions q
       join question_groups g on g.id = q."group" where q.id = ?`,
      [question],
    )[0]!["s"],
  );
  return world.post("questions/apply-option", token, {
    question,
    answered_seq: closed,
    option_key: "define",
    action,
    evidence: { question, option: "define" },
  });
}

Deno.test("lophn-agent/questions#R13: 선택 전에는 용어가 없고 사람이 고른 뒤에만 고정한 정의가 한 번 적용되며 두 번째는 conflict다", async () => {
  const world = await open();
  try {
    const asked = await askTerm(world, {
      id: TERM_ONE,
      name: "범위",
      definition: "이번 판단의 대상",
    });
    // 질문과 답만으로는 용어를 정의하지 않는다.
    assertEquals(termRows(world.server, TERM_ONE), []);
    assertEquals(count(world.server, DEFINED), 0);
    await choose(world, asked);
    assertEquals(termRows(world.server, TERM_ONE), []);
    assertEquals(count(world.server, DEFINED), 0);
    const applied = await applyDefine(world, asked.question, asked.action);
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals((applied.body as { applied: boolean }).applied, true);
    // 고정한 이름·뜻 그대로 active로 등록된다.
    assertEquals(termRows(world.server, TERM_ONE), [
      { name: "범위", definition: "이번 판단의 대상", status: "active" },
    ]);
    // 근거를 검증한 적용은 사람 결정이라 actor=user, run=null로 남는다(identity R14).
    const defined = inspect(
      world.server,
      "select actor, run, payload from events where type = 'TermDefined'",
    );
    assertEquals(defined[0]!["actor"], "user");
    assertEquals(defined[0]!["run"], null);
    assertEquals(JSON.parse(String(defined[0]!["payload"])), {
      context: CONTEXT,
      name: "범위",
      before_definition: null,
      definition: "이번 판단의 대상",
      before_revision: null,
    });
    assertEquals(count(world.server, EVIDENCE), 1);
    // 같은 선택지의 두 번째 적용은 conflict이고 정의도 일회 기록도 더하지 않는다.
    const again = await applyDefine(world, asked.question, asked.action);
    assertEquals(again.status, 409, JSON.stringify(again.body));
    assertEquals(count(world.server, DEFINED), 1);
    assertEquals(count(world.server, EVIDENCE), 1);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/questions#R13: 다른 선택지를 골랐거나 고정 입력이 다르면 정의를 적용하지 않는다", async () => {
  const world = await open();
  try {
    // 사람이 action 없는 다른 선택지를 골랐다. 정의 action을 적용할 근거가 아니다.
    const first = await askTerm(world, {
      id: TERM_ONE,
      name: "범위",
      definition: "이번 판단의 대상",
    });
    await chooseLeave(world, first);
    const refused = await applyDefine(world, first.question, first.action);
    assertEquals(refused.status, 403, JSON.stringify(refused.body));
    // 고정 action과 다른 뜻(다른 고정 입력)은 같은 질문의 근거가 아니다.
    const second = await askTerm(world, {
      id: TERM_TWO,
      name: "경계",
      definition: "여기 적지 않는 선",
    }, "editor");
    await choose(world, second);
    const changed = {
      ...second.action,
      input: {
        kind: "inline",
        value: {
          context: CONTEXT,
          id: TERM_TWO,
          name: "경계",
          definition: "고친 뜻",
        },
      },
    };
    const changedApply = await applyDefine(world, second.question, changed);
    assertEquals(changedApply.status, 403, JSON.stringify(changedApply.body));
    assertEquals(termRows(world.server, TERM_ONE), []);
    assertEquals(termRows(world.server, TERM_TWO), []);
    assertEquals(count(world.server, DEFINED), 0);
    assertEquals(count(world.server, EVIDENCE), 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/questions#R14: 질문 뒤 같은 이름이 이미 정의되면 답은 남고 정의는 적용되지 않으며 달라진 대상과 이유를 알린다", async () => {
  const world = await open();
  try {
    const asked = await askTerm(world, {
      id: TERM_ONE,
      name: "범위",
      definition: "이번 판단의 대상",
    });
    await choose(world, asked);
    // 질문 뒤 사람이 같은 이름의 용어를 직접 정의했다. 질문이 고정한 것은 낡은 전제다.
    const direct = await world.post("terms/define", USER_TOKEN, {
      id: TERM_TWO,
      context: CONTEXT,
      name: "범위",
      definition: "사람이 직접 정한 뜻",
    });
    assertEquals(direct.status, 200, JSON.stringify(direct.body));
    const refused = await applyDefine(world, asked.question, asked.action);
    assertEquals(refused.status, 409, JSON.stringify(refused.body));
    const details = (refused.body["error"] as {
      details?: { targets: string[]; reason: string };
    }).details;
    assertEquals(details?.targets, [TERM_ONE]);
    assert((details?.reason ?? "").length > 0);
    // 사람이 직접 정의한 것만 남고 질문의 용어는 만들어지지 않는다. 실패한 적용은
    // 일회 기록을 남기지 않아 다시 적용을 시도할 수 있다.
    assertEquals(termRows(world.server, TERM_ONE), []);
    assertEquals(termRows(world.server, TERM_TWO), [
      { name: "범위", definition: "사람이 직접 정한 뜻", status: "active" },
    ]);
    assertEquals(count(world.server, DEFINED), 1);
    assertEquals(count(world.server, EVIDENCE), 0);
    // 답은 그대로다.
    const read = await world.read("questions/read", MACHINE_TOKEN, {
      group: asked.group,
    });
    const record = read.body["group"] as {
      status: string;
      questions: { applied: boolean; answer: { option_key: string } }[];
    };
    assertEquals(record.status, "answered");
    assertEquals(record.questions[0].answer.option_key, "define");
    assertEquals(record.questions[0].applied, false);
  } finally {
    await world.dispose();
  }
});
