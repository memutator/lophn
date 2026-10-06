/**
 * 앱 등록의 question option action 시험이 같이 쓰는 준비(apps/registration#R3). 실제 core(임시
 * LOPHN_HOME)에 documents·apps 등록을 띄우고, lophn가 새 앱 등록 선택지를 질문으로 묻고 사람이
 * 고르고 machine이 적용하는 단계를 부른다. model·실제 provider·사람 데이터 root는 열지 않는다.
 */
import { assertEquals } from "@std/assert";
import { answerQuestionAction } from "../../../packages/contracts/lophn-agent/mod.ts";
import { appCreateOptionAction } from "../../../packages/lophn-agent/questions/mod.ts";
import { call, command, count, inspect } from "./approvals-fixture.ts";
import { id } from "./tool-judgment-world.ts";
import {
  issueConfirmation,
  MACHINE_TOKEN,
  openWaitingWorld,
  USER_TOKEN,
  type WaitingWorld,
} from "./waiting-world.ts";

export {
  call,
  command,
  count,
  inspect,
  MACHINE_TOKEN,
  openWaitingWorld,
  USER_TOKEN,
  type WaitingWorld,
};

export const APP_CREATED =
  "select count(*) as n from events where type = 'AppCreated'";
export const EVIDENCE = "select count(*) as n from question_evidence";

export type Registration = {
  id: string;
  slug: string;
  name: string;
  description: string;
};

export function openAppOptionWorld(): Promise<WaitingWorld> {
  return openWaitingWorld({ apps: true });
}

let counter = 0;

// 새 앱 등록 선택지를 질문한다. 적용은 하지 않는다. 앞 질문이 끝나지 않은 run은 새 질문을 받지
// 않으므로 질문마다 seat을 고른다.
export async function askRegister(
  world: WaitingWorld,
  app: Registration,
  seat: "lophn" | "editor" = "lophn",
) {
  counter += 1;
  const question = id("qst", 100 + counter);
  const action = appCreateOptionAction(app);
  const run = world[seat].run;
  const state = await world.read("runs/read", MACHINE_TOKEN, { run });
  const waited = await world.post("runs/wait", MACHINE_TOKEN, {
    run,
    request: {
      kind: "question",
      input: {
        id: question,
        run,
        session: null,
        prompt: `Register this app? (${question})`,
        reason: "The work looks like a new app.",
        options: [
          {
            key: "register",
            label: "Register",
            description: "Register it as a new app.",
            evidence: [],
            adoption: null,
            action,
          },
          {
            key: "leave",
            label: "Leave it",
            description: "Do not register it.",
            evidence: [],
            adoption: null,
            action: null,
          },
        ],
        recommendation: { option_key: "register", explanation: "New work." },
        expires_at: null,
      },
    },
    call: null,
  }, {
    state_seq: (state.body["run"] as { state_seq: string }).state_seq,
  });
  assertEquals(waited.status, 200, JSON.stringify(waited.body));
  const read = await world.read("questions/read", MACHINE_TOKEN, { question });
  const created = (read.body["question"] as { created_seq: string })
    .created_seq;
  return { question, action, created };
}

// 사람이 고른 선택지로 답한다(사람 확인이 필요한 AnswerQuestionAction).
export async function chooseOption(
  world: WaitingWorld,
  asked: {
    question: string;
    created: string;
    action: { binding_hash: string };
  },
  option = "register",
) {
  const input = {
    question: asked.question,
    created_seq: asked.created,
    answer: { kind: "option", option_key: option },
    binding_hash: asked.action.binding_hash,
    evidence: { question: asked.question, option },
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

// 사람이 선택지가 아닌 자유 글로 답한다.
export async function answerFree(
  world: WaitingWorld,
  asked: { question: string; created: string },
  text: string,
) {
  const reply = await world.post(
    "questions/answer",
    USER_TOKEN,
    {
      question: asked.question,
      created_seq: asked.created,
      answer: { kind: "text", text },
    },
    { created_seq: asked.created },
  );
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
}

export function applyRegister(
  world: WaitingWorld,
  question: string,
  action: unknown,
  token = MACHINE_TOKEN,
) {
  const closed = String(
    inspect(
      world.server,
      "select closed_seq as s from questions where id = ?",
      [question],
    )[0]!["s"],
  );
  return world.post("questions/apply-option", token, {
    question,
    answered_seq: closed,
    option_key: "register",
    action,
    evidence: { question, option: "register" },
  });
}
