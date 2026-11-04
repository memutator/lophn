// AcpSend: 입력 꼴마다 지금 있는 route로 보낸다. 부른 사람의 자격(who)을 그대로 넘겨 그 route가 권한을 본다.
// core 안 machine 자격으로 대신 부르면 SendMessage 권한이 없는 호출자도 AcpSend로는 보낼 수 있게 된다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { AcpInput } from "../../../../protocol/acp/mod.ts";
import type {
  CommandRoute,
  MemoryRoute,
} from "../../../../protocol/base/route.ts";
import { turnRequestDecide } from "../../../../protocol/approvals/turn-request.ts";
import { askAnswer } from "../../../../protocol/lophn-agent/ask-tool.ts";
import {
  editQueued,
  moveQueued,
  removeQueued,
  sendMessage,
  steerQueuedNow,
} from "../../../../protocol/lophn-agent/inputs.ts";
import { blocksOfContent } from "../../../../protocol/lophn-agent/message-content.ts";
import { messageBody } from "../../../../protocol/lophn-agent/messages.ts";
import { turnRead } from "../../../../protocol/lophn-agent/turn-reads.ts";
import { stopTurn } from "../../../../protocol/lophn-agent/turns.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { CommandEnvelope } from "../../../storage/ledger/mod.ts";

export type AcpSendDeps = {
  command(
    who: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<unknown>>;
  read(
    who: AuthenticatedContext,
    route: { resource: string; method: string },
    input: unknown,
  ): Promise<Result<unknown>>;
  memory(
    who: AuthenticatedContext,
    route: { resource: string; method: string },
    input: unknown,
  ): Promise<Result<unknown>>;
  newMessageId(): string;
};

const invalid = () =>
  err({ code: "invalid_input" as const, message: "invalid input" });

export function createAcpSend(deps: AcpSendDeps) {
  // retry를 다시 눌러도 같은 메시지 id와 key로 보내 core가 한 번만 접수한다.
  const retryIds = new Map<string, string>();

  const command = async (
    who: AuthenticatedContext,
    route: CommandRoute,
    input: unknown,
    key: string,
    compare: unknown,
  ): Promise<Result<void>> => {
    const parsed = route.input.safeParse(input);
    if (!parsed.success) return invalid();
    const done = await deps.command(who, {
      command: route.name,
      input: parsed.data,
      idempotency_key: key,
      compare,
      prepared: [],
    });
    return done.ok ? ok(undefined) : done;
  };

  const memory = async (
    who: AuthenticatedContext,
    route: MemoryRoute,
    input: unknown,
  ): Promise<Result<void>> => {
    const parsed = route.input.safeParse(input);
    if (!parsed.success) return invalid();
    const done = await deps.memory(who, route, parsed.data);
    return done.ok ? ok(undefined) : done;
  };

  const stateSeqOf = async (
    who: AuthenticatedContext,
    turn: string,
  ): Promise<Result<{ state_seq: number; input_message: string }>> => {
    const read = await deps.read(who, turnRead, { turn });
    if (!read.ok) return read;
    return ok(
      (read.value as { turn: { state_seq: number; input_message: string } })
        .turn,
    );
  };

  return async (
    who: AuthenticatedContext,
    input: AcpInput,
  ): Promise<Result<void>> => {
    switch (input.type) {
      case "send":
        return await command(
          who,
          sendMessage,
          {
            id: input.id,
            session: input.session,
            content: input.content,
            delivery: input.delivery,
            refs: [],
          },
          input.key,
          {},
        );
      case "stop": {
        const turn = await stateSeqOf(who, input.turn);
        if (!turn.ok) return turn;
        return await command(
          who,
          stopTurn,
          { turn: input.turn, request_key: input.key, reason: "user_stopped" },
          input.key,
          { state_seq: turn.value.state_seq },
        );
      }
      case "retry": {
        const turn = await stateSeqOf(who, input.turn);
        if (!turn.ok) return turn;
        const body = await deps.read(who, messageBody, {
          message: turn.value.input_message,
        });
        if (!body.ok) return body;
        const parts = blocksOfContent(
          (body.value as { content: Parameters<typeof blocksOfContent>[0] })
            .content,
        );
        if (parts.length === 0) return invalid();
        let id = retryIds.get(input.turn);
        if (id === undefined) {
          id = deps.newMessageId();
          retryIds.set(input.turn, id);
        }
        return await command(
          who,
          sendMessage,
          {
            id,
            session: input.session,
            content: parts,
            delivery: "next_turn",
            refs: [],
          },
          `retry-turn-${input.turn}`,
          {},
        );
      }
      case "answer":
        return await memory(who, askAnswer, {
          session: input.session,
          tool_call: input.tool_call,
          answers: input.answers,
        });
      case "decide":
        return await memory(who, turnRequestDecide, {
          session: input.session,
          request: input.request,
          choice: input.choice,
        });
      case "send_queued":
        return await memory(who, steerQueuedNow, {
          session: input.session,
          message: input.message,
        });
      case "remove_queued":
        return await memory(who, removeQueued, {
          session: input.session,
          message: input.message,
        });
      case "edit_queued":
        return await memory(who, editQueued, {
          session: input.session,
          message: input.message,
          content: input.content,
        });
      case "move_queued":
        return await memory(who, moveQueued, {
          session: input.session,
          message: input.message,
          direction: input.direction,
        });
    }
  };
}
