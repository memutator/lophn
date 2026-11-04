import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import { createProductRedactor } from "../../../../base/redaction/mod.ts";
import {
  agentCallRead,
  messageBody,
  receivedMessageList,
  receivedMessageRead,
  textBlocks,
  turnBody,
  turnRead,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  Output,
} from "../../../../protocol/server/mod.ts";
import { redactBlocks } from "../../../lophn-agent/session/message-body.ts";
import { callsAutoReply } from "../../../router/mod.ts";
import type { WiringFactory } from "./context.ts";
import { prepareBodies } from "./router.ts";

// bare session의 turn이 끝나면 마지막 응답 글을 result call의 답으로 보내는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const BARE_REPLY_PRINCIPAL = "machine:bare-reply";
const BARE_REPLY_CONTEXT: AuthenticatedContext = {
  principal: BARE_REPLY_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      turnRead.name,
      turnBody.name,
      receivedMessageRead.name,
      receivedMessageList.name,
      messageBody.name,
      agentCallRead.name,
      callsAutoReply.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: BARE_REPLY_PRINCIPAL,
};

const route = (r: { resource: string; method: string }) =>
  `${r.resource}/${r.method}`;

type TurnInfo = {
  session: string;
  input_message: string;
  unattended: boolean;
};

// 결정만 담는다. 읽기와 보내기는 port이고 wiring이 끼운다.
export type BareReplyPorts = {
  turn(turn: string): Promise<Result<TurnInfo>>;
  // turn 입력이 result call이면 그 call, 아니면 null.
  resultCallOf(message: string): Promise<Result<string | null>>;
  callOpen(call: string, session: string): Promise<Result<boolean>>;
  isBare(turn: string): Promise<Result<boolean>>;
  // 그 turn의 마지막 agent 메시지 글. 없거나 비면 null.
  answer(session: string, turn: string): Promise<Result<string | null>>;
  reply(input: {
    session: string;
    call: string;
    text: string;
    unattended: boolean;
  }): Promise<Result<void>>;
};

// 답이 없는 turn(멈춤, 실패, 빈 글)은 call을 그대로 둔다. agent가 이미 reply로 닫은 call은 `callOpen`이 거른다.
export function createBareReply(ports: BareReplyPorts) {
  return async function turnEnded(event: {
    turn: string;
    outcome: { kind: string };
  }): Promise<Result<void>> {
    if (event.outcome.kind !== "completed") return ok(undefined);
    const turn = await ports.turn(event.turn);
    if (!turn.ok) return turn;
    const call = await ports.resultCallOf(turn.value.input_message);
    if (!call.ok || call.value === null) return call.ok ? ok(undefined) : call;
    const open = await ports.callOpen(call.value, turn.value.session);
    if (!open.ok || !open.value) return open.ok ? ok(undefined) : open;
    const bare = await ports.isBare(event.turn);
    if (!bare.ok || !bare.value) return bare.ok ? ok(undefined) : bare;
    const text = await ports.answer(turn.value.session, event.turn);
    if (!text.ok || text.value === null) return text.ok ? ok(undefined) : text;
    return await ports.reply({
      session: turn.value.session,
      call: call.value,
      text: text.value,
      unattended: turn.value.unattended,
    });
  };
}

export const bareReplyWiring: WiringFactory = () => {
  let unsubscribe: (() => void) | undefined;
  return {
    name: "bare-reply",
    records: () => [BARE_REPLY_CONTEXT],
    // 모든 wiring이 build한 뒤 구독한다. TurnEnded는 commit 뒤 Bus로 오므로 tx 밖이다.
    start(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const read = async <T>(
        r: { resource: string; method: string },
        input: unknown,
      ): Promise<Result<T>> =>
        (await ctx.runtime.reads.get(route(r))!(
          BARE_REPLY_CONTEXT,
          input,
        )) as Result<T>;

      const turnEnded = createBareReply({
        async turn(turn) {
          const found = await read<Output<typeof turnRead>>(turnRead, { turn });
          if (!found.ok) return found;
          const t = found.value.turn;
          return ok({
            session: t.session,
            input_message: t.input_message,
            unattended: t.mode === "unattended",
          });
        },
        async resultCallOf(message) {
          const found = await read<Output<typeof receivedMessageRead>>(
            receivedMessageRead,
            { message },
          );
          if (!found.ok) return found;
          const m = found.value.message;
          return ok(m.call !== null && m.reply === "result" ? m.call : null);
        },
        async callOpen(call, session) {
          const found = await read<Output<typeof agentCallRead>>(
            agentCallRead,
            {
              call,
            },
          );
          if (!found.ok) return found;
          const row = found.value.call;
          return ok(
            row.state === "accepted" && row.receiver_session === session,
          );
        },
        // turn이 고정한 resolved agent의 runtime이다. 정의를 turn 도중 바꿔도 이 turn의 것을 본다.
        async isBare(turn) {
          const found = await read<Output<typeof turnBody>>(turnBody, {
            kind: "turn_resolved",
            id: turn,
          });
          if (!found.ok) return found;
          return ok(
            (found.value.value as { runtime?: string }).runtime === "bare",
          );
        },
        // runs의 answer()와 같은 읽기다.
        async answer(session, turn) {
          let last: string | null = null;
          let cursor: string | undefined;
          for (;;) {
            const page = await read<Output<typeof receivedMessageList>>(
              receivedMessageList,
              { session, turn, ...(cursor === undefined ? {} : { cursor }) },
            );
            if (!page.ok) return page;
            for (const m of page.value.messages) {
              if (m.from.kind === "agent" && m.from.session === session) {
                last = m.id;
              }
            }
            const next = page.value.next_cursor;
            if (next === null || next === undefined) break;
            cursor = next;
          }
          if (last === null) return ok(null);
          const body = await read<Output<typeof messageBody>>(messageBody, {
            message: last,
          });
          if (!body.ok) return body;
          const text = body.value.content.parts
            .flatMap((part) => (part.kind === "text" ? [part.text] : []))
            .join("\n");
          return ok(text.trim() === "" ? null : text);
        },
        async reply(input) {
          const safe = redactBlocks(
            createProductRedactor(ctx.knownSecrets),
            textBlocks(input.text),
          );
          if (safe === null) {
            return err({
              code: "unavailable",
              message: "reply redaction did not finish",
            });
          }
          const prepared = await prepareBodies(
            ctx.bodyPrepare,
            BARE_REPLY_CONTEXT,
            [safe],
          );
          if (!prepared.ok) return prepared;
          // 접은 writer를 쓴다. 날 writer는 본문 준비와 입력함 적용을 건너뛰어 보낸 쪽 turn이 열리지 않는다.
          const done = await ctx.writer.command(BARE_REPLY_CONTEXT, {
            command: callsAutoReply.name,
            input: {
              session: input.session,
              call: input.call,
              body: safe,
              unattended: input.unattended,
            },
            idempotency_key: ids.newId("idk"),
            compare: {},
            prepared: [],
          });
          return done.ok ? ok(undefined) : done;
        },
      });

      unsubscribe = ctx.bus.subscribe([{ types: ["TurnEnded"] }], {
        send(event) {
          if (event.type !== "TurnEnded") return;
          void turnEnded(event.payload).then((done) => {
            if (done.ok) return;
            ctx.telemetry.logger.error({
              component: "bare-reply",
              event: "reply_failed",
              fields: { code: done.error.code },
            });
          });
        },
        close() {},
      });
      return Promise.resolve(ok(undefined));
    },
    closeIntake() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
};
