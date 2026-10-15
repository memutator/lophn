// composer의 `/` 명령(목록과 실행)과 대화의 쓰기: 보내기, 입력함의 메시지, 멈춤, 다시 하기, 질문 답, 허락 결정.
// 명령 목록은 그 session의 agent 기준 registry를 core에서 읽어 protocol의 거르기 규칙에 먹인 것이다(표를 여기에 다시
// 적지 않는다). 일하는 중 고른 명령도 모두 다음 turn에 들어가므로 끝나기를 기다리지 않는다.
import { t } from "@lophn/wording";
import type { z } from "zod";

import {
  approvalsDecideTurn,
  type TurnChoice,
} from "../../../protocol/approvals/requests.ts";
import {
  agentSessionList,
} from "../../../protocol/lophn-agent/agent-sessions.ts";
import { listCommands } from "../../../protocol/lophn-agent/command-filter.ts";
import {
  type CommandEntry,
  commandsList,
} from "../../../protocol/lophn-agent/commands.ts";
import { askAnswer } from "../../../protocol/lophn-agent/ask-tool.ts";
import {
  removeQueued,
  sendMessage,
  steerQueuedNow,
} from "../../../protocol/lophn-agent/inputs.ts";
import { messageBody } from "../../../protocol/lophn-agent/messages.ts";
import { receivedMessageRead } from "../../../protocol/lophn-agent/received-messages.ts";
import { turnRead } from "../../../protocol/lophn-agent/turn-reads.ts";
import { stopTurn } from "../../../protocol/lophn-agent/turns.ts";
import { newId } from "../desktop/lophn-space/model.ts";
import type { RequestChoice } from "../../../protocol/approvals/requests.ts";
import type { SlashEntryView, SlashGroupView } from "./slash-menu/types.ts";
import type {
  QuestionAnswer,
  SendInput,
  SourceResult,
} from "./agent-tab-source.ts";
import {
  dropValue,
  type Env,
  unavailable,
} from "./agent-tab-core-source-env.ts";

// ---------------------------------------------------------------- `/` 명령

type UserPart = z.input<
  typeof sendMessage.input
>["content"]["parts"][number];

/** 그 session의 registry. */
async function readRegistry(
  env: Env,
  session: string,
): Promise<SourceResult<readonly CommandEntry[]>> {
  const read = await env.read(commandsList, { session });
  return read.ok ? { ok: true, value: read.value.commands } : read;
}

/**
 * session이 없는 화면은 같은 agent의 session 하나의 registry를 빌린다. session이 하나도 없으면 목록이 비어 있다
 * (registry는 session을 기준으로 계산되어 agent만으로는 core에 물을 수 없다).
 */
async function registryOf(
  env: Env,
  session: string | null,
): Promise<SourceResult<readonly CommandEntry[]>> {
  if (session !== null) return await readRegistry(env, session);
  const listed = await env.read(agentSessionList, { agent: env.agent });
  if (!listed.ok) return listed;
  const open = listed.value.sessions[0];
  return open === undefined
    ? { ok: true, value: [] }
    : await readRegistry(env, open.id);
}

export async function readCommands(
  env: Env,
  session: string | null,
  query: string,
  agentName: () => Promise<string>,
): Promise<SourceResult<SlashGroupView[]>> {
  const registry = await registryOf(env, session);
  if (!registry.ok) return registry;
  // session이 없으면 session이 있어야 하는 built-in은 쓸 수 없다.
  const entries = session === null
    ? registry.value.filter((entry) =>
      entry.source !== "builtin" ||
      !SESSION_ONLY.has(entry.name)
    )
    : registry.value;
  const groups = listCommands({ entries }, await agentName(), query);
  return {
    ok: true,
    value: groups.map((group) => ({
      source: group.source,
      title: group.title,
      entries: group.entries.map((entry) => ({
        name: entry.name,
        title: entry.title,
        description: entry.description,
        source: entry.source,
        skillOrigin: entry.skill_origin,
        whileRunning: entry.while_running,
      })),
    })),
  };
}

/** session이 있어야 하는 전역 명령. */
const SESSION_ONLY = new Set(["rename", "archive", "compact", "fork", "recap"]);

/** role 명령과 skill 명령은 정한 prompt나 skill 이름이 든 사람의 메시지로 접수한다. */
export async function runCommand(
  env: Env,
  session: string,
  entry: SlashEntryView,
  key: string,
): Promise<SourceResult<void>> {
  if (entry.source === "builtin") return { ok: false, code: "invalid_input" };
  const registry = await readRegistry(env, session);
  if (!registry.ok) return registry;
  const found = registry.value.find((item) =>
    item.name === entry.name && item.source === entry.source
  );
  if (found === undefined) return { ok: false, code: "not_found" };
  // 정한 tool 하나를 실행하는 명령은 renderer가 실행할 길이 없다.
  if (found.action.kind === "tool" || found.action.kind === "builtin") {
    return unavailable;
  }
  const text = found.action.kind === "prompt"
    ? found.action.template
    : t("conversation.body.skill-command-request", {
      skill: found.action.skill_name,
    });
  return await sendText(env, {
    session,
    id: newId("msg", env.now()),
    key: `commands-run-${key}`,
    text,
    delivery: "next_turn",
  });
}

/** `/recap`은 읽는 route가 없다. */
export function recap(): Promise<SourceResult<readonly string[]>> {
  return Promise.resolve(unavailable);
}

// ---------------------------------------------------------------- 보내기

export function sendText(
  env: Env,
  input: SendInput,
): Promise<SourceResult<void>> {
  return env.command(sendMessage, {
    input: {
      id: input.id,
      session: input.session,
      content: {
        schema_version: 1,
        parts: [{ kind: "text", text: input.text }],
      },
      delivery: input.delivery,
      attached: [],
      refs: [],
    },
    compare: {},
    key: input.key,
  }).then(dropValue);
}

async function sessionOfMessage(
  env: Env,
  message: string,
): Promise<SourceResult<string>> {
  const read = await env.read(receivedMessageRead, { message });
  return read.ok ? { ok: true, value: read.value.message.session } : read;
}

/** 다음 turn 줄의 메시지를 도는 turn에 steer로 올린다. 이미 가져갔으면 conflict다. */
export async function sendQueuedNow(
  env: Env,
  queued: string,
): Promise<SourceResult<void>> {
  const session = await sessionOfMessage(env, queued);
  if (!session.ok) return session;
  return dropValue(
    await env.read(steerQueuedNow, { session: session.value, message: queued }),
  );
}

export async function removeQueuedMessage(
  env: Env,
  queued: string,
): Promise<SourceResult<void>> {
  const session = await sessionOfMessage(env, queued);
  if (!session.ok) return session;
  return dropValue(
    await env.read(removeQueued, { session: session.value, message: queued }),
  );
}

export async function stopTurnOf(
  env: Env,
  turn: string,
  key: string,
): Promise<SourceResult<void>> {
  const read = await env.read(turnRead, { turn });
  if (!read.ok) return read;
  return dropValue(
    await env.command(stopTurn, {
      input: { turn, request_key: key, reason: "user_stopped" },
      compare: { state_seq: read.value.turn.state_seq },
      key,
    }),
  );
}

/**
 * 실패한 turn을 시작한 입력 메시지를 같은 session에 다시 보낸다(새 route는 없다). 새 메시지 id를 쓰고, 결과를 몰라
 * 다시 눌러도 같은 id와 key로 보내 core가 한 번만 접수한다.
 */
export async function retryTurn(
  env: Env,
  retryIds: Map<string, string>,
  turn: string,
): Promise<SourceResult<void>> {
  const read = await env.read(turnRead, { turn });
  if (!read.ok) return read;
  const original = read.value.turn.input_message;
  const body = await env.read(messageBody, { message: original });
  if (!body.ok) return body;
  const parts: UserPart[] = [];
  for (const part of body.value.content.parts) {
    if (part.kind === "text") parts.push({ kind: "text", text: part.text });
    else if (part.kind === "attached") parts.push({ ...part });
  }
  if (parts.length === 0) return { ok: false, code: "invalid_input" };
  let id = retryIds.get(turn);
  if (id === undefined) {
    id = newId("msg", env.now());
    retryIds.set(turn, id);
  }
  return dropValue(
    await env.command(sendMessage, {
      input: {
        id,
        session: body.value.session,
        content: { schema_version: 1, parts },
        delivery: "next_turn",
        attached: [],
        refs: [],
      },
      compare: {},
      key: `retry-turn-${turn}`,
    }),
  );
}

// ---------------------------------------------------------------- 사람이 답할 것

export async function answerQuestions(
  env: Env,
  input: {
    session: string;
    toolCall: string;
    answers: readonly QuestionAnswer[];
  },
): Promise<SourceResult<void>> {
  return dropValue(
    await env.read(askAnswer, {
      session: input.session,
      tool_call: input.toolCall,
      answers: input.answers.map((one) => ({
        question: one.question,
        status: one.status,
        answer: [...one.answer],
      })),
    }),
  );
}

/** 거절 이유는 한 줄 500자 안으로 맞춘다. */
function reasonOf(reason: string | undefined): string | undefined {
  const one = reason?.replace(/\s+/g, " ").trim().slice(0, 500);
  return one === undefined || one === "" ? undefined : one;
}

/** waiting 목록의 결정과 같은 memory route다. 허락한 범위(once·session·always·allow)나 거절을 보낸다. */
export async function decidePermission(
  env: Env,
  session: string,
  request: string,
  choice: RequestChoice,
  reason?: string,
): Promise<SourceResult<void>> {
  const rejected = reasonOf(reason);
  const decision: TurnChoice = choice === "reject"
    ? {
      kind: "reject",
      ...(rejected === undefined ? {} : { reason: rejected }),
    }
    : { kind: choice };
  return dropValue(
    await env.read(approvalsDecideTurn, { session, request, choice: decision }),
  );
}
