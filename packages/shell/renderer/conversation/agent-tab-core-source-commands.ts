// 대화의 쓰기: 보내기, queue의 메시지, 멈춤, 다시 하기, 질문 답. 모두 core의 `AcpSend` 하나로 보낸다.
import { acpSend } from "../../../protocol/acp/routes.ts";
import { messageBody } from "../../../protocol/lophn-agent/messages.ts";
import { blocksOfContent } from "../../../protocol/lophn-agent/message-content.ts";
import { receivedMessageRead } from "../../../protocol/lophn-agent/received-messages.ts";
import {
  turnList,
  turnRead,
} from "../../../protocol/lophn-agent/turn-reads.ts";
import type {
  QuestionAnswer,
  SendInput,
  SourceResult,
} from "./agent-tab-source.ts";
import { newId } from "../prefixed-id.ts";
import { dropValue, type Env } from "./agent-tab-core-source-env.ts";

// ---------------------------------------------------------------- 보내기

export function sendContent(
  env: Env,
  input: SendInput,
): Promise<SourceResult<void>> {
  return env
    .read(acpSend, {
      type: "send",
      session: input.session,
      id: input.id,
      key: input.key,
      content: [...input.content],
      delivery: input.delivery,
      seen: input.seen,
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
    await env.read(acpSend, {
      type: "send_queued",
      session: session.value,
      message: queued,
    }),
  );
}

export async function removeQueuedMessage(
  env: Env,
  queued: string,
): Promise<SourceResult<void>> {
  const session = await sessionOfMessage(env, queued);
  if (!session.ok) return session;
  return dropValue(
    await env.read(acpSend, {
      type: "remove_queued",
      session: session.value,
      message: queued,
    }),
  );
}

/**
 * 다음 turn 줄의 글을 고친다. 이미 turn이 가져갔으면 conflict다. 글이 아닌 block(이미지, 링크)은 그대로 실어
 * 보낸다. 빼면 사람이 붙인 이미지가 본문에서 조용히 빠진다.
 */
export async function editQueuedMessage(
  env: Env,
  queued: string,
  text: string,
): Promise<SourceResult<void>> {
  const session = await sessionOfMessage(env, queued);
  if (!session.ok) return session;
  const body = await env.read(messageBody, { message: queued });
  if (!body.ok) return body;
  const kept = blocksOfContent(body.value.content).filter(
    (block) => block.type !== "text",
  );
  return dropValue(
    await env.read(acpSend, {
      type: "edit_queued",
      session: session.value,
      message: queued,
      content: [{ type: "text", text }, ...kept],
    }),
  );
}

/** 다음 turn 줄의 순서를 이웃과 바꾼다. 끝이면 그대로 둔다. */
export async function moveQueuedMessage(
  env: Env,
  queued: string,
  direction: "up" | "down",
): Promise<SourceResult<void>> {
  const session = await sessionOfMessage(env, queued);
  if (!session.ok) return session;
  return dropValue(
    await env.read(acpSend, {
      type: "move_queued",
      session: session.value,
      message: queued,
      direction,
    }),
  );
}

async function stopTurnIn(
  env: Env,
  session: string,
  turn: string,
  key: string,
): Promise<SourceResult<void>> {
  return dropValue(
    await env.read(acpSend, { type: "stop", session, turn, key }),
  );
}

export async function stopTurnOf(
  env: Env,
  turn: string,
  key: string,
): Promise<SourceResult<void>> {
  const read = await env.read(turnRead, { turn });
  if (!read.ok) return read;
  return await stopTurnIn(env, read.value.turn.session, turn, key);
}

export async function stopSessionOf(
  env: Env,
  session: string,
): Promise<SourceResult<void>> {
  const listed = await env.read(turnList, { session, state: "running" });
  if (!listed.ok) return listed;
  for (const turn of listed.value.turns) {
    const stopped = await stopTurnIn(
      env,
      session,
      turn.id,
      newId("stop", env.now()),
    );
    if (!stopped.ok) return stopped;
  }
  return { ok: true, value: undefined };
}

/** 실패한 turn을 시작한 입력 메시지를 같은 session에 다시 보낸다. 새 메시지 id와 key는 core가 정한다. */
export async function retryTurn(
  env: Env,
  turn: string,
): Promise<SourceResult<void>> {
  const read = await env.read(turnRead, { turn });
  if (!read.ok) return read;
  return dropValue(
    await env.read(acpSend, {
      type: "retry",
      session: read.value.turn.session,
      turn,
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
    await env.read(acpSend, {
      type: "answer",
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
