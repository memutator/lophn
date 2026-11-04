import {
  canonicalize,
  createIdSource,
  err,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  type AgentRuntime,
  blocksOfContent,
  type ContentBlock,
  finishTurn,
  harnessFinishTurn,
  harnessRecord,
  harnessSetExternalId,
  harnessStartTurn,
  harnessTake,
  messageBody,
  recordMessage,
  startTurn,
  turnRead,
  bindHarnessSession,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  Output,
} from "../../../../protocol/server/mod.ts";
import {
  createSessionDirectory,
  placeDepsOf,
} from "../../../lophn-agent/places/mod.ts";
import {
  createInbox,
  createInboxApplier,
  INBOX_CLEAR_TOPIC,
  INBOX_PUT_TOPIC,
  inputParts,
  turnLimitsOf,
} from "../../../lophn-agent/run-loop/mod.ts";
import {
  harnessEnabledSetting,
  harnessOf,
  HARNESS_INBOX_PUT_TOPIC,
} from "../../../lophn-agent/session/mod.ts";
import { loadSession } from "../../../lophn-agent/session/model.ts";
import { unstartedHumanMessages } from "../../../lophn-agent/session/message-commands.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import {
  openConnection,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";

// shell main의 harness host가 부르는 core 쪽이다. 입력함(메모리)을 쥐고, turn과 메시지는 machine 자격으로 기존
// command(StartTurn, RecordMessage, FinishTurn)에 기록한다. host는 사람 token의 memory route로만 닿고
// renderer 통로에는 없다. 흐름은 `protocol/lophn-agent/harness-host.ts`.
const HARNESS_PRINCIPAL = "machine:harness";
const HARNESS_CONTEXT: AuthenticatedContext = {
  principal: HARNESS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      startTurn.name,
      finishTurn.name,
      recordMessage.name,
      bindHarnessSession.name,
      turnRead.name,
      messageBody.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: HARNESS_PRINCIPAL,
};

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

export const harnessWiring: WiringFactory = () => {
  // harness session의 입력함이다. run-loop의 입력함과 따로여서 run-loop가 harness 입력을 가져가지 않는다.
  const inbox = createInbox();
  let unsubscribe: (() => void) | undefined;
  return {
    name: "harness",
    records: () => [HARNESS_CONTEXT],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const read = async <T>(
        r: { resource: string; method: string },
        input: unknown,
      ): Promise<Result<T>> =>
        (await ctx.runtime.reads.get(key(r))!(
          HARNESS_CONTEXT,
          input,
        )) as Result<T>;
      const command = (name: string, input: unknown, compare = {}) =>
        ctx.writer.command(HARNESS_CONTEXT, {
          command: name,
          input,
          idempotency_key: ids.newId("idk"),
          compare,
          prepared: [],
        });

      // 사람 token을 가진 shell main만 부른다. 꺼져 있으면 host는 일하지 않는다.
      const gate = (who: AuthenticatedContext): Result<void> => {
        if (who.actor !== "user") {
          return err({ code: "forbidden", message: "only the shell host" });
        }
        return ctx.settings.get(harnessEnabledSetting) === true
          ? ok(undefined)
          : err({ code: "unavailable", message: "harness is turned off" });
      };
      // 이 session이 열려 있고 입력을 받고 runtime이 harness여야 한다. 아니면 어떤 route도 고치지 못한다.
      const harnessSession = (session: string) => {
        const found = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
          const directory = createSessionDirectory({
            ...placeDepsOf(lookup.sql),
            publish: () => {},
            sql: () => lookup.sql,
          });
          return {
            row: loadSession(lookup, session),
            target: directory.find(session as Id<"ses">),
          };
        });
        if (!found.ok) return found;
        const harness = harnessOf(found.value.row);
        if (!harness.ok) return harness;
        return ok({
          row: harness.value,
          accepting: found.value.target?.accepting === true,
        });
      };

      const take: MemoryHandler = async (who) => {
        const allowed = gate(who);
        if (!allowed.ok) return allowed;
        for (const session of inbox.waiting()) {
          if (inbox.isRunning(session)) continue;
          const found = harnessSession(session);
          if (!found.ok || !found.value.accepting) {
            // 끝났거나 보관된 session의 입력은 받을 곳이 없다.
            if (!found.ok && found.error.code !== "unavailable") {
              inbox.clear(session);
            }
            continue;
          }
          const head = inbox.next(session)!;
          // 본문은 session 기록이 정본이다(빼거나 고친 사람 메시지가 입력함에 남지 않게 한다).
          const body = await read<Output<typeof messageBody>>(messageBody, {
            message: head.message,
          });
          if (!body.ok) {
            if (body.error.code === "not_found") {
              inbox.remove(session, head.message as string);
            }
            continue;
          }
          const row = found.value.row;
          const prompt = inputParts(
            { ...head, body: blocksOfContent(body.value.content) },
            row.harness as AgentRuntime,
          )
            .flatMap((part) => (part.kind === "text" ? [part.text] : []))
            .join("\n");
          return ok({
            input: {
              session,
              agent: row.agent,
              place:
                row.place_kind === null
                  ? null
                  : { kind: row.place_kind, id: row.place_id },
              harness: row.harness,
              external_session_id: row.harness_session,
              input_message: head.message,
              kind: head.kind,
              from: head.from,
              call: head.call,
              reply: head.reply,
              unattended: head.unattended,
              prompt,
            },
          });
        }
        return ok({ input: null });
      };

      const startTurnHandler: MemoryHandler = async (who, body) => {
        const allowed = gate(who);
        if (!allowed.ok) return allowed;
        const input = harnessStartTurn.input.parse(body);
        const found = harnessSession(input.session);
        if (!found.ok) return found;
        const head = inbox.next(input.session as Id<"ses">);
        if (
          !found.value.accepting ||
          head === undefined ||
          head.message !== input.input_message ||
          inbox.isRunning(input.session as Id<"ses">)
        ) {
          return err({
            code: "conflict",
            message: "that input is not the next one of an idle session",
          });
        }
        const limits = turnLimitsOf(ctx.settings);
        if (!limits.ok) return limits;
        const turn = ids.newId("trn");
        const started = await command(startTurn.name, {
          id: turn,
          session: input.session,
          input_message: input.input_message,
          basis: await sha256Hex(
            canonicalize({
              harness: found.value.row.harness,
              session: input.session,
              input_message: input.input_message,
            }),
          ),
          limits: limits.value,
          mode: head.unattended ? "unattended" : "attended",
        });
        if (!started.ok) {
          // 입력의 메시지가 없어졌으면 입력함에 남겨 Take가 같은 입력을 되풀이하게 두지 않는다.
          if (started.error.code === "not_found") {
            inbox.remove(input.session as Id<"ses">, input.input_message);
          }
          return started;
        }
        inbox.take(input.session as Id<"ses">);
        inbox.setRunning(input.session as Id<"ses">, true);
        return ok({ turn });
      };

      const recordHandler: MemoryHandler = async (who, body) => {
        const allowed = gate(who);
        if (!allowed.ok) return allowed;
        const input = harnessRecord.input.parse(body);
        const found = harnessSession(input.session);
        if (!found.ok) return found;
        const message = ids.newId("msg");
        const done = await command(recordMessage.name, {
          id: message,
          session: input.session,
          turn: input.turn,
          content: { schema_version: 1, parts: input.parts },
        });
        return done.ok ? ok({ message }) : done;
      };

      const finishHandler: MemoryHandler = async (who, body) => {
        const allowed = gate(who);
        if (!allowed.ok) return allowed;
        const input = harnessFinishTurn.input.parse(body);
        const turn = await read<Output<typeof turnRead>>(turnRead, {
          turn: input.turn,
        });
        if (!turn.ok) return turn;
        const found = harnessSession(turn.value.turn.session);
        if (!found.ok) return found;
        // 모델이 쓴 본문이 없으므로 host가 알린 사실만 결과로 정리한다(StopTurn과 같다).
        const result = await sha256Hex(
          canonicalize({
            turn: input.turn,
            session: turn.value.turn.session,
            outcome: input.outcome,
          }),
        );
        const done = await command(
          finishTurn.name,
          { turn: input.turn, outcome: input.outcome, result },
          { state_seq: turn.value.turn.state_seq },
        );
        return done.ok ? ok({ turn: input.turn }) : done;
      };

      const externalIdHandler: MemoryHandler = async (who, body) => {
        const allowed = gate(who);
        if (!allowed.ok) return allowed;
        const input = harnessSetExternalId.input.parse(body);
        const found = harnessSession(input.session);
        if (!found.ok) return found;
        const done = await command(bindHarnessSession.name, input);
        return done.ok ? ok({}) : done;
      };

      // 입력을 입력함에 넣는 일은 commit 뒤 main thread가 한다(`createInboxApplier`를 harness 입력함으로 쓴다).
      // 같은 afterCommit 묶음의 다른 일(Bus event 등)은 run-loop 쪽 applier가 이미 했으므로 여기서는 거른다.
      const apply = createInboxApplier({
        inbox,
        publish: (event) => ctx.bus.publish(event),
      });
      return ok({
        memory: [
          [key(harnessTake), take],
          [key(harnessStartTurn), startTurnHandler],
          [key(harnessRecord), recordHandler],
          [key(harnessFinishTurn), finishHandler],
          [key(harnessSetExternalId), externalIdHandler],
        ],
        writer: (inner) =>
          withAfterCommit(
            inner,
            (actions) =>
              apply(
                actions.flatMap((action) =>
                  action.topic === HARNESS_INBOX_PUT_TOPIC
                    ? [{ ...action, topic: INBOX_PUT_TOPIC }]
                    : action.topic === INBOX_CLEAR_TOPIC
                      ? [action]
                      : [],
                ),
              ),
            ctx.telemetry.logger,
          ),
      });
    },
    // 꺼졌다 켜지면 입력함이 비므로 접수만 된 사람 메시지를 다시 넣는다(run-loop 쪽은 router wiring이 한다).
    // 도는 turn은 router가 먼저 interrupted(restarted)로 닫았다.
    start(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (opened.ok) {
        try {
          const sql = opened.value.sql;
          const directory = createSessionDirectory({
            ...placeDepsOf(sql),
            publish: () => {},
            sql: () => sql,
          });
          for (const pending of unstartedHumanMessages(sql)) {
            const target = directory.find(pending.session as Id<"ses">);
            if (!target?.accepting || target.transport !== "harness") continue;
            inbox.put(pending.session as Id<"ses">, {
              kind: "message",
              from: { kind: "human" },
              call: null,
              reply_to: null,
              // 본문은 Take가 session 기록에서 읽는다.
              body: [] as ContentBlock[],
              refs: pending.refs,
              delivery: "next_turn",
              message: pending.id as Id<"msg">,
              reply: null,
              outcome: null,
              event: null,
              notice: null,
              step: null,
              unattended: false,
            });
          }
        } finally {
          opened.value.close();
        }
      }
      // turn이 어떻게 끝나든(host의 끝냄, 사람의 멈춤, session 끝남) 그 session은 다음 입력을 받을 수 있다.
      unsubscribe = ctx.bus.subscribe([{ types: ["TurnEnded"] }], {
        send(event) {
          if (event.type === "TurnEnded") {
            inbox.setRunning(event.session as Id<"ses">, false);
          }
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
