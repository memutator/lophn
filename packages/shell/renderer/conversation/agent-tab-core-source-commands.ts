// composer의 `/` 명령(목록과 실행)과 대화의 쓰기: 보내기, 입력함의 메시지, 멈춤, 다시 하기, 질문 답, 허락 결정.
// 명령 목록은 그 session의 agent 기준 registry를 core에서 읽어 protocol의 거르기 규칙에 먹인 것이다(표를 여기에 다시
// 적지 않는다). 일하는 중 고른 명령도 모두 다음 turn에 들어가므로 끝나기를 기다리지 않는다.
import { t } from "@lophn/i18n";
import type { z } from "zod";

import { turnRequestDecide } from "../../../protocol/approvals/turn-request.ts";
import { placeSessionList } from "../../../protocol/lophn-agent/agent-sessions.ts";
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
import { turnChoiceOf } from "../desktop/connection/waiting/decide.ts";
import { newId } from "../prefixed-id.ts";
import type { SlashEntryView, SlashGroupView } from "./slash-menu/types.ts";
import type {
  QuestionAnswer,
  SendInput,
  SourceResult,
} from "./agent-tab-source.ts";
import { dropValue, type Env } from "./agent-tab-core-source-env.ts";

// ---------------------------------------------------------------- `/` 명령

type UserPart = z.input<typeof sendMessage.input>["content"]["parts"][number];

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
  const listed = await env.read(placeSessionList, {
    agent: env.agent,
    place: env.place,
  });
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
): Promise<SourceResult<readonly SlashGroupView[]>> {
  const registry = await registryOf(env, session);
  if (!registry.ok) return registry;
  // session이 없으면 session이 있어야 하는 built-in은 쓸 수 없다.
  const entries =
    session === null
      ? registry.value.filter(
          (entry) =>
            entry.source !== "builtin" || !SESSION_ONLY.has(entry.name),
        )
      : registry.value;
  return { ok: true, value: listCommands({ entries }, query) };
}

/** session이 있어야 하는 전역 명령. */
const SESSION_ONLY = new Set([
  "rename",
  "archive",
  "compact",
  "fork",
  "status",
]);

/**
 * skill 명령은 skill을 쓰라는 한 줄과 `/이름` 뒤의 글이 든 사람의 메시지로 접수한다. 목록은 다시 읽지 않는다. 그 사이 skill이
 * 꺼졌으면 agent의 skill.read가 not_found를 내고 agent가 사람에게 말한다.
 */
export async function runCommand(
  env: Env,
  session: string,
  entry: SlashEntryView,
  argument: string,
  key: string,
): Promise<SourceResult<void>> {
  if (entry.source !== "skill") return { ok: false, code: "invalid_input" };
  const request = t("conversation.body.skill-command-request", {
    skill: entry.name,
  });
  return await sendText(env, {
    session,
    id: newId("msg", env.now()),
    key: `commands-run-${key}`,
    text: argument === "" ? request : `${request}\n\n${argument}`,
    delivery: "next_turn",
  });
}

// ---------------------------------------------------------------- 보내기

export function sendText(
  env: Env,
  input: SendInput,
): Promise<SourceResult<void>> {
  return env
    .command(sendMessage, {
      input: {
        id: input.id,
        session: input.session,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: input.text }],
        },
        delivery: input.delivery,
        refs: [],
      },
      compare: {},
      key: input.key,
    })
    .then(dropValue);
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
        refs: [],
      },
      compare: {},
      key: `retry-turn-${turn}`,
    }),
  );
}

/**
 * 끝난 turn의 입력을 새 메시지로 다시 보낸다. 누를 때마다 새 id와 key라 새 turn이 된다. [Retry]가 실패한 turn에
 * 쓰는 retryTurn은 결과를 몰라도 한 번만 보내야 해서 turn마다 고정 id·key를 쓴다.
 */
export async function repeatTurn(
  env: Env,
  turn: string,
): Promise<SourceResult<void>> {
  const read = await env.read(turnRead, { turn });
  if (!read.ok) return read;
  const body = await env.read(messageBody, {
    message: read.value.turn.input_message,
  });
  if (!body.ok) return body;
  const parts: UserPart[] = [];
  for (const part of body.value.content.parts) {
    if (part.kind === "text") parts.push({ kind: "text", text: part.text });
  }
  if (parts.length === 0) return { ok: false, code: "invalid_input" };
  const id = newId("msg", env.now());
  return dropValue(
    await env.command(sendMessage, {
      input: {
        id,
        session: body.value.session,
        content: { schema_version: 1, parts },
        delivery: "next_turn",
        refs: [],
      },
      compare: {},
      key: `repeat-turn-${id}`,
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

/** waiting 목록의 결정과 같은 memory route다. 허락한 범위(once·always)나 거절을 보낸다. */
export async function decidePermission(
  env: Env,
  session: string,
  request: string,
  choice: "once" | "always" | "reject",
  reason?: string,
): Promise<SourceResult<void>> {
  return dropValue(
    await env.read(turnRequestDecide, {
      session,
      request,
      choice: turnChoiceOf(choice, reason),
    }),
  );
}
