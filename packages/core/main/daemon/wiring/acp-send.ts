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
import { placeSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { BUILTIN_COMMAND_IDS } from "../../../../protocol/lophn-agent/commands.ts";
import { blocksOfContent } from "../../../../protocol/lophn-agent/message-content.ts";
import { messageBody } from "../../../../protocol/lophn-agent/messages.ts";
import { receivedMessageList } from "../../../../protocol/lophn-agent/received-messages.ts";
import {
  sessionRewind,
  sessionRewindPreview,
} from "../../../../protocol/lophn-agent/session-rewinds.ts";
import {
  changeSessionModel,
  changeSessionSkip,
  forkSession,
  renameSession,
  requestSessionCompact,
} from "../../../../protocol/lophn-agent/sessions.ts";
import { turnRead } from "../../../../protocol/lophn-agent/turn-reads.ts";
import { stopTurn } from "../../../../protocol/lophn-agent/turns.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { CommandEnvelope } from "../../../storage/ledger/mod.ts";
import { AGENT_MODES } from "./acp-build.ts";

/** `AcpSend`의 답. fork가 연 새 session이다. */
export type AcpSent = { session?: string };

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
  newId(prefix: "msg" | "ses" | "rwd"): string;
};

// 화면 catalog의 `conversation.body.skill-command-request`와 같은 글이다. core는 design을 import하지 못해 복사했다.
const skillRequest = (skill: string) =>
  `Use the "${skill}" skill for this request.`;

const invalid = () =>
  err({ code: "invalid_input" as const, message: "invalid input" });

export function createAcpSend(deps: AcpSendDeps) {
  // retry를 다시 눌러도 같은 메시지 id와 key로 보내 core가 한 번만 접수한다.
  const retryIds = new Map<string, string>();
  // 같은 key로 다시 보내도 같은 id로 가야 core가 한 번만 접수한다(fork의 새 session, rewind, 명령 메시지).
  const keyedIds = new Map<string, string>();
  const idFor = (prefix: "msg" | "ses" | "rwd", key: string) => {
    const same = `${prefix}:${key}`;
    let id = keyedIds.get(same);
    if (id === undefined) {
      id = deps.newId(prefix);
      keyedIds.set(same, id);
    }
    return id;
  };

  const commandResult = async (
    who: AuthenticatedContext,
    route: CommandRoute,
    input: unknown,
    key: string,
    compare: unknown,
  ): Promise<Result<unknown>> => {
    const parsed = route.input.safeParse(input);
    if (!parsed.success) return invalid();
    const done = await deps.command(who, {
      command: route.name,
      input: parsed.data,
      idempotency_key: key,
      compare,
      prepared: [],
    });
    return done.ok ? ok((done.value as { result?: unknown }).result) : done;
  };

  const command = async (
    who: AuthenticatedContext,
    route: CommandRoute,
    input: unknown,
    key: string,
    compare: unknown,
  ): Promise<Result<AcpSent>> => {
    const done = await commandResult(who, route, input, key, compare);
    return done.ok ? ok({}) : done;
  };

  const memory = async (
    who: AuthenticatedContext,
    route: MemoryRoute,
    input: unknown,
  ): Promise<Result<AcpSent>> => {
    const parsed = route.input.safeParse(input);
    if (!parsed.success) return invalid();
    const done = await deps.memory(who, route, parsed.data);
    return done.ok ? ok({}) : done;
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

  const sessionStateSeq = async (
    who: AuthenticatedContext,
    session: string,
  ): Promise<Result<unknown>> => {
    const read = await deps.read(who, placeSessionRead, { session });
    if (!read.ok) return read;
    return ok(
      (read.value as { session: { state_seq: unknown } }).session.state_seq,
    );
  };

  // fork와 rewind가 고른 메시지의 순번을 찾는다. message가 null이면 마지막 메시지다.
  const messageSeq = async (
    who: AuthenticatedContext,
    session: string,
    message: string | null,
  ): Promise<Result<unknown>> => {
    const all: { id: string; created_seq: unknown }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await deps.read(who, receivedMessageList, {
        session,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!page.ok) return page;
      const value = page.value as {
        messages: { id: string; created_seq: unknown }[];
        next_cursor?: string | null;
      };
      all.push(...value.messages);
      if (value.next_cursor === null || value.next_cursor === undefined) break;
      cursor = value.next_cursor;
    }
    const point =
      message === null ? all.at(-1) : all.find((one) => one.id === message);
    return point === undefined ? invalid() : ok(point.created_seq);
  };

  return async (
    who: AuthenticatedContext,
    input: AcpInput,
  ): Promise<Result<AcpSent>> => {
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
          id = deps.newId("msg");
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
        // core 승인에는 session 범위가 없다.
        if (input.choice.kind === "session") return invalid();
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
      case "set_model": {
        // model id는 `<provider id>/<model name>`이다(acp-build의 acpModelId). provider id에는 `/`가 없다.
        const cut = input.model.indexOf("/");
        if (cut <= 0) return invalid();
        const seq = await sessionStateSeq(who, input.session);
        if (!seq.ok) return seq;
        return await command(
          who,
          changeSessionModel,
          {
            session: input.session,
            model: {
              provider: input.model.slice(0, cut),
              model_name: input.model.slice(cut + 1),
              option_values: input.options,
            },
          },
          `acp-set-model-${input.key}`,
          { state: "open", state_seq: seq.value },
        );
      }
      case "set_mode": {
        if (!AGENT_MODES.some((mode) => mode.id === input.mode)) {
          return invalid();
        }
        const seq = await sessionStateSeq(who, input.session);
        if (!seq.ok) return seq;
        return await command(
          who,
          changeSessionSkip,
          { session: input.session, skip: input.mode === "skip" },
          `acp-set-mode-${input.key}`,
          { state_seq: seq.value },
        );
      }
      case "run_command": {
        // 내장 명령은 화면이 처리한다. 나머지는 skill 이름이고 목록은 다시 읽지 않는다.
        if ((BUILTIN_COMMAND_IDS as readonly string[]).includes(input.name)) {
          return invalid();
        }
        const request = skillRequest(input.name);
        return await command(
          who,
          sendMessage,
          {
            id: idFor("msg", input.key),
            session: input.session,
            content: [
              {
                type: "text",
                text:
                  input.argument === ""
                    ? request
                    : `${request}\n\n${input.argument}`,
              },
            ],
            delivery: "next_turn",
            refs: [],
          },
          `acp-run-command-${input.key}`,
          {},
        );
      }
      case "rewind": {
        const choice = input.files ? "restore_all" : "messages_only";
        const preview = await deps.read(who, sessionRewindPreview, {
          session: input.session,
          checkpoint: input.message,
          choice,
        });
        if (!preview.ok) return preview;
        const id = idFor("rwd", input.key);
        const applied = await commandResult(
          who,
          sessionRewind,
          {
            id,
            session: input.session,
            checkpoint: input.message,
            choice,
            accept_remaining: true,
            preview_hash: (preview.value as { preview_hash: string })
              .preview_hash,
            summary_call: null,
            files: [],
            apps: input.apps,
          },
          `rewind-${id}`,
          { session_state: "open", active_turn: null, applying_rewind: null },
        );
        if (!applied.ok) return applied;
        return (applied.value as { outcome?: string } | undefined)?.outcome ===
          "blocked"
          ? err({ code: "conflict" as const, message: "rewind blocked" })
          : ok({});
      }
      case "fork": {
        const seq = await messageSeq(who, input.session, input.message);
        if (!seq.ok) return seq;
        const id = idFor("ses", input.key);
        const forked = await command(
          who,
          forkSession,
          { id, source: input.session, through_seq: seq.value },
          `acp-fork-${input.key}`,
          {},
        );
        return forked.ok ? ok({ session: id }) : forked;
      }
      case "compact": {
        const seq = await sessionStateSeq(who, input.session);
        if (!seq.ok) return seq;
        return await command(
          who,
          requestSessionCompact,
          { session: input.session },
          `acp-compact-${input.key}`,
          { state: "open", state_seq: seq.value },
        );
      }
      case "rename": {
        const title = input.title.trim();
        if (title === "") return invalid();
        const seq = await sessionStateSeq(who, input.session);
        if (!seq.ok) return seq;
        return await command(
          who,
          renameSession,
          { session: input.session, title },
          `acp-rename-${input.key}`,
          { state_seq: seq.value },
        );
      }
    }
  };
}
