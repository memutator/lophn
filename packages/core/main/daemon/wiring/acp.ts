// ACP: snapshot route(`AcpSnapshot`)와 갱신 event(`AcpUpdated`). 기록을 읽어 상태를 만드는 일은 `acp-build.ts`이고,
// 여기서는 Bus의 agent event를 ACP 갱신으로 바꿔 내고(`acpUpdatesOf`), 항목이 대화에 들 때 session 순번을
// 저장하며(`AllocateAcpItems`), rewind가 끝나면 숨긴 구간을 낸다. event를 하나씩 차례로 처리해 갱신 순서가 event 순서다.
// 화면의 대화 조작은 `AcpSend` 하나로 받아 지금 route로 보낸다(`acp-send.ts`).
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import {
  type AcpInput,
  type AcpUpdate,
  acpCoreApprovalChoices,
  acpItemsAllocate,
  acpSend,
  acpSnapshot,
} from "../../../../protocol/acp/mod.ts";
import { agentCallRead } from "../../../../protocol/lophn-agent/calls.ts";
import { placeSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { agentRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import {
  messageBody,
  receivedMessageList,
} from "../../../../protocol/lophn-agent/mod.ts";
import { sendMessage } from "../../../../protocol/lophn-agent/inputs.ts";
import {
  modelCatalogRead,
  shownModelsRead,
} from "../../../../protocol/lophn-agent/models.ts";
import { providerList } from "../../../../protocol/lophn-agent/providers.ts";
import { rewindList } from "../../../../protocol/lophn-agent/reverts.ts";
import { sessionRewind } from "../../../../protocol/lophn-agent/session-rewinds.ts";
import { sessionStatusRead } from "../../../../protocol/lophn-agent/session-status.ts";
import {
  changeSessionModel,
  changeSessionSkip,
  renameSession,
} from "../../../../protocol/lophn-agent/sessions.ts";
import {
  toolCallList,
  toolCallRead,
} from "../../../../protocol/lophn-agent/tool-calls.ts";
import {
  turnBody,
  turnList,
} from "../../../../protocol/lophn-agent/turn-reads.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { AgentEvent, BusEvent } from "../../../../protocol/events/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { TurnRequest } from "../../../../protocol/approvals/mod.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import {
  type AcpAlloc,
  type AcpCaptured,
  type AcpEnv,
  type AcpLive,
  type AcpStoredItem,
  acpUpdatesFor,
  buildAcpState,
  readSessionMeta,
  redactDeep,
  sessionChangeOf,
} from "./acp-build.ts";
import { createAcpSend } from "./acp-send.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

// 항목 순번을 붙이고 기록을 읽는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const ACP_PRINCIPAL = "machine:acp";
const ACP_CONTEXT: AuthenticatedContext = {
  principal: ACP_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      acpItemsAllocate.name,
      receivedMessageList.name,
      messageBody.name,
      turnList.name,
      turnBody.name,
      toolCallList.name,
      toolCallRead.name,
      placeSessionRead.name,
      agentRead.name,
      agentCallRead.name,
      rewindList.name,
      providerList.name,
      modelCatalogRead.name,
      shownModelsRead.name,
      sessionStatusRead.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: ACP_PRINCIPAL,
};

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// 갱신으로 바뀌는 event. 나머지는 ACP에 나가지 않는다.
const EVENT_TYPES = [
  "MessageReceived",
  "MessageSteered",
  "MessageRemoved",
  "TurnStarted",
  "TurnResumed",
  "TurnEnded",
  "CompactEnded",
  "ModelOutputStreamed",
  "MessageRecorded",
  "ToolCallStarted",
  "ToolCallEnded",
  "TurnRequestOpened",
  "TurnRequestClosed",
  "QuestionAsked",
  "QuestionResolved",
] as const;

export const acpWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  let unsubscribe: (() => void) | undefined;
  return {
    name: "acp",
    records: () => [ACP_CONTEXT],
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const redactor = createProductRedactor({
        get ready() {
          return ctx.peek.knownSecrets?.ready ?? false;
        },
        match: (text: string) => ctx.peek.knownSecrets?.match(text),
      });
      const env: AcpEnv = {
        async read<T>(
          route: { resource: string; method: string },
          input: unknown,
        ): Promise<Result<T>> {
          const handler = ctx.runtime.reads.get(key(route));
          if (handler === undefined) {
            return err({ code: "unavailable", message: "read not served" });
          }
          return (await handler(ACP_CONTEXT, input)) as Result<T>;
        },
        redact: (text) =>
          redactor(
            { concern: "acp", revision: "1", scope: "conversation" },
            "text/plain",
            text,
          ) ?? "",
      };

      const allocate = async (
        session: string,
        items: AcpAlloc[],
      ): Promise<Result<Map<string, number>>> => {
        const done = await ctx.writer.command(ACP_CONTEXT, {
          command: acpItemsAllocate.name,
          input: { session, items },
          idempotency_key: ids.newId("idk"),
          compare: {},
          prepared: [],
        });
        if (!done.ok) return done;
        const out = acpItemsAllocate.output.parse(done.value.result);
        return ok(new Map(out.items.map((one) => [one.id, one.seq])));
      };

      const storedOf = (session: string): AcpStoredItem[] =>
        sql
          .all(
            "select id, seq, kind, turn, at, data from acp_items where session = ? order by seq",
            [session],
          )
          .map((row) => ({
            id: String(row["id"]),
            seq: Number(row["seq"]),
            kind: String(row["kind"]) as AcpStoredItem["kind"],
            turn: row["turn"] === null ? null : String(row["turn"]),
            at: String(row["at"]),
            data: row["data"] === null ? null : String(row["data"]),
          }));

      // 승인 카드는 harness 물음을 뺀 첫 요청이다. harness 물음은 터미널에서 답한다.
      const approvalOf = (session: string) => {
        for (const request of ctx.approvals.turnRequests(session)) {
          const subject = request.subject;
          if (subject.kind === "harness") continue;
          return {
            id: request.id,
            subject: redactDeep(env, subject),
            choices: acpCoreApprovalChoices(request.always_patterns),
            always_patterns: request.always_patterns,
          };
        }
        return null;
      };

      const questionOf = (session: string) => {
        const asked = ctx.questionWaits.list(session)[0];
        if (asked === undefined) return null;
        const read = ctx.questionWaits.read(session, asked.tool_call);
        return {
          group: asked.group,
          tool_call: asked.tool_call,
          questions: read.ok ? redactDeep(env, read.value.questions) : null,
        };
      };

      // `who`가 있으면 대화 밖 session 기능(`session`)까지 읽는다. 명령 목록이 사람 자격으로만 읽혀서다.
      const snapshot = async (
        session: string,
        who: AuthenticatedContext | null,
      ) => {
        const live: AcpLive = {
          steering: new Set(
            ctx.inbox
              .pendingSteering(session as Id<"ses">)
              .flatMap((input) =>
                input.message === null ? [] : [input.message as string],
              ),
          ),
          // 쓰는 중인 글은 core live-turns가 redaction을 거쳐 낸 그대로다.
          writing: ctx.liveTurns.writing(session),
          elapsed: ctx.liveTurns.elapsed(session),
          approval: approvalOf(session),
          question: questionOf(session),
          session:
            who === null
              ? null
              : await readSessionMeta(env, session, async (route, input) => {
                  const handler = ctx.runtime.reads.get(key(route));
                  return handler === undefined
                    ? err({ code: "unavailable", message: "read not served" })
                    : ((await handler(who, input)) as Result<never>);
                }),
          stored: storedOf(session),
          allocate: (items) => allocate(session, items),
        };
        return buildAcpState(env, session, live);
      };

      // ---- 갱신

      const publishUpdates = (
        session: string,
        at: string,
        updates: readonly AcpUpdate[],
      ) => {
        for (const update of updates) {
          ctx.bus.publish({
            type: "AcpUpdated",
            subject: null,
            at,
            payload: { session, update },
          } as BusEvent);
        }
      };

      // 승인 요청의 내용(redaction을 거친 것). 닫힐 때 결과 항목으로 저장한다.
      const openRequests = new Map<string, TurnRequest["subject"]>();

      const capture = (event: AgentEvent): AcpCaptured => ({
        // 줄에 선 메시지: 도는 중에 사람이 다음 turn으로 보냈다.
        queuedHuman:
          event.type === "MessageReceived" &&
          event.payload.from.kind === "human" &&
          !event.payload.steer &&
          ctx.inbox.isRunning(event.session as Id<"ses">),
        decision:
          event.type === "TurnRequestClosed"
            ? ctx.approvals
                .waitTurnDecision(event.payload.request)
                .then((outcome) =>
                  outcome.outcome === "allow"
                    ? { choice: outcome.scope, reason: null }
                    : outcome.outcome === "reject"
                      ? {
                          choice: null,
                          reason:
                            outcome.reason === null
                              ? null
                              : env.redact(outcome.reason),
                        }
                      : null,
                )
            : null,
        questions:
          event.type === "QuestionAsked"
            ? (() => {
                const read = ctx.questionWaits.read(
                  event.session,
                  event.payload.tool_call,
                );
                return read.ok ? read.value.questions : null;
              })()
            : null,
      });

      const publishSessionChange = async (
        session: string,
        changed: Parameters<typeof sessionChangeOf>[2],
      ) => {
        const update = await sessionChangeOf(env, session, changed);
        if (update !== null) {
          publishUpdates(session, ctx.clock.now(), [update]);
        }
      };

      // event는 하나씩 차례로 처리한다. 읽기를 기다리는 사이에 뒤 event가 앞서 나가지 않게 한다.
      let queue: Promise<void> = Promise.resolve();
      const enqueue = (work: () => Promise<void>) => {
        queue = queue.then(work).catch((cause: unknown) => {
          ctx.telemetry.logger.error({
            component: "acp",
            event: "acp_update_failed",
            fields: { message: String(cause) },
          });
        });
      };

      unsubscribe = ctx.bus.subscribe([{ types: [...EVENT_TYPES] }], {
        send: (event) => {
          if (!("session" in event)) return;
          const agent = event as AgentEvent;
          const cap = capture(agent);
          enqueue(async () => {
            // 압축은 대화 항목이 없다. 사용량만 바뀐다.
            if (agent.type !== "CompactEnded") {
              publishUpdates(
                agent.session,
                agent.at,
                await acpUpdatesFor(
                  { env, allocate, openRequests },
                  agent,
                  cap,
                ),
              );
            }
            if (agent.type === "TurnEnded" || agent.type === "CompactEnded") {
              await publishSessionChange(agent.session, "usage");
            }
          });
        },
        close() {},
      });

      const hiddenAfterRewind = async (session: string) => {
        const built = await snapshot(session, null);
        if (!built.ok) return;
        publishUpdates(
          session,
          ctx.clock.now(),
          built.value.items.flatMap((item): AcpUpdate[] =>
            item.kind === "hidden" ? [{ type: "hidden_added", item }] : [],
          ),
        );
      };

      // 조작은 부른 사람의 자격으로 지금 route에 보낸다. 여기 machine 자격을 쓰지 않는다.
      const send = createAcpSend({
        command: (who, envelope) => ctx.writer.command(who, envelope),
        read: async (who, route, input) => {
          const handler = ctx.runtime.reads.get(key(route));
          return handler === undefined
            ? err({ code: "unavailable", message: "read not served" })
            : await handler(who, input);
        },
        memory: async (who, route, input) => {
          const handler = ctx.runtime.memory.handlers.get(key(route));
          return handler === undefined
            ? err({ code: "unavailable", message: "route unavailable" })
            : await handler(who, input);
        },
        newId: (prefix) => ids.newId(prefix),
      });

      return ok({
        memory: [
          [
            key(acpSend),
            async (who, body) => {
              return await send(who, body as AcpInput);
            },
          ],
        ],
        reads: (reads) =>
          reads.set(key(acpSnapshot), async (who, input) => {
            const parsed = acpSnapshot.input.safeParse(input);
            if (!parsed.success) {
              return err({ code: "invalid_input", message: "invalid input" });
            }
            return await snapshot(parsed.data.session, who);
          }),
        // rewind가 숨긴 구간은 AgentEvent가 없어 적용이 끝난 뒤 여기서 낸다. 제목·model·mode는 어느 client가 바꿔도
        // 이 writer를 지나므로 바뀐 칸을 여기서 낸다. 첫 말은 자동 제목을 붙이므로 SendMessage 뒤에도 제목을 낸다.
        writer: (inner) => ({
          ...inner,
          async command(who, envelope) {
            const done = await inner.command(who, envelope);
            if (!done.ok) return done;
            const session = (envelope.input as { session?: unknown }).session;
            if (typeof session !== "string") return done;
            switch (envelope.command) {
              case sessionRewind.name:
                enqueue(() => hiddenAfterRewind(session));
                break;
              case renameSession.name:
              case sendMessage.name:
                enqueue(() => publishSessionChange(session, "title"));
                break;
              case changeSessionModel.name:
                enqueue(() => publishSessionChange(session, "model"));
                break;
              case changeSessionSkip.name:
                enqueue(() => publishSessionChange(session, "mode"));
                break;
            }
            return done;
          },
        }),
      });
    },
    closeIntake() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
    closeWork() {
      connection?.close();
      connection = undefined;
    },
  };
};
