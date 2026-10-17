import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import {
  agentSessionRead,
  openAgentSession,
} from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { sendMessage } from "../../../../protocol/lophn-agent/inputs.ts";
import type { AnnotationDelivery } from "../../../apps/annotations/ports.ts";
import {
  callCancel,
  callReply,
  callSend,
} from "../../../../protocol/lophn-agent/calls.ts";
import {
  archiveSession,
  closeSession,
  deleteSession,
  MESSAGE_CONTENT_MAX_BYTES,
  MESSAGE_CONTENT_PURPOSE,
  serializeMessageContent,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createProductRedactor } from "../../../../base/redaction/mod.ts";
import {
  prepareBytes,
  rejected,
} from "../../../lophn-agent/session/message-body.ts";
import type { BodyPrepare } from "../../../lophn-agent/session/message-body.ts";
import { createInboxApplier } from "../../../lophn-agent/run-loop/mod.ts";
import {
  callsReact,
  callsRecover,
  CANCEL_TEXT,
  FAILURE_TEXTS,
} from "../../../router/mod.ts";
import {
  createEventsReader,
  type ReactionRouter,
  registerNewWorkHandlers,
} from "../../../events/mod.ts";
import {
  type CommandEnvelope,
  type KnownSecretMatch,
  type LedgerConnection,
  openConnection,
  withAfterCommit,
  type Writer,
} from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// 켤 때 잃어버린 call을 닫는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const ROUTER_PRINCIPAL = "machine:router";

const ROUTER_CONTEXT: AuthenticatedContext = {
  principal: ROUTER_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [callsRecover.name, callsReact.name],
    targets: {},
  },
  conditions: {},
  credential_ref: ROUTER_PRINCIPAL,
};

// annotation 묶음을 App Engineer에게 사람 메시지로 넣는 자격이다. 보내기는 사람이 누른 단추의 효과라서 actor가
// user이고, 기동 때 ledger에 기록한다. 기동마다 다시 쓰는 core 안 자격이라 ref는 `machine:`으로 시작한다.
const ANNOTATION_DELIVERY_PRINCIPAL = "machine:annotation-delivery";
const ANNOTATION_DELIVERY_CONTEXT: AuthenticatedContext = {
  principal: ANNOTATION_DELIVERY_PRINCIPAL,
  actor: "user",
  scope: {
    operations: [
      openAgentSession.name,
      sendMessage.name,
      agentSessionRead.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: ANNOTATION_DELIVERY_PRINCIPAL,
};

const SOURCE = {
  concern: "router",
  revision: "1",
  scope: "call-body",
};

function textBytes(text: string): Uint8Array {
  return serializeMessageContent({
    schema_version: 1,
    parts: [{ kind: "text", text }],
  });
}

// 받는 session 기록은 글을 blob으로 둔다. command 안에서 쓰는 글은 그 command를 부른 자격의 이름으로 미리
// 준비돼 있어야 한다. 보낸 call의 본문, 실패를 보낸 session에 돌려주는 고정 문구, 취소 알림이다.
async function prepareTexts(
  relay: BodyPrepare,
  ctx: AuthenticatedContext,
  texts: readonly string[],
): Promise<Result<void>> {
  for (const text of new Set(texts)) {
    const bytes = textBytes(text);
    if (bytes.length > MESSAGE_CONTENT_MAX_BYTES) {
      return rejected("invalid_input", "call text is too large");
    }
    const prepared = await prepareBytes(
      relay,
      ctx,
      MESSAGE_CONTENT_PURPOSE,
      bytes,
      "call text",
    );
    if (!prepared.ok) return prepared;
  }
  return ok(undefined);
}

function createCallBodyPreparer(deps: {
  relay(): BodyPrepare | undefined;
  known?(): KnownSecretMatch | undefined;
}) {
  return async (
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandEnvelope>> => {
    const name = envelope.command;
    const input = envelope.input;
    const texts: string[] = [];
    let next = envelope;
    if (
      name === callSend.name || name === callReply.name ||
      name === callsReact.name
    ) {
      const body = (input as { body?: unknown } | null)?.body;
      // 모양이 틀린 요청은 건드리지 않고 지나가 command의 schema 검사가 거절한다.
      if (typeof body !== "string") return ok(envelope);
      const safe = createProductRedactor(deps.known?.())(
        SOURCE,
        "text/plain",
        body,
      );
      if (safe === null) {
        return rejected("unavailable", "call redaction did not finish");
      }
      texts.push(safe);
      next = { ...envelope, input: { ...(input as object), body: safe } };
    } else if (name === callCancel.name) {
      texts.push(CANCEL_TEXT);
    } else if (
      name === archiveSession.name || name === deleteSession.name ||
      name === closeSession.name
    ) {
      // 받은 call이 receiver_ended로 닫히며 보낸 session에 가는 알림이다.
      texts.push(FAILURE_TEXTS.receiver_ended);
    } else return ok(envelope);
    const relay = deps.relay();
    if (relay === undefined) {
      return rejected("unavailable", "blob preparation is not available");
    }
    const prepared = await prepareTexts(relay, ctx, texts);
    return prepared.ok ? ok(next) : prepared;
  };
}

function withCallBody(
  writer: Writer,
  prepare: ReturnType<typeof createCallBodyPreparer>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const ready = await prepare(ctx, envelope);
      if (!ready.ok) return ready;
      return await writer.command(ctx, ready.value);
    },
  };
}

// Router의 main thread 쪽이다. command와 read는 writer·reader Worker가 `router-registration.ts`로 돌린다.
// 여기서는 call 본문을 미리 준비하고, commit된 tx가 모은 일(입력함에 넣기, agent event)을 적용하고, 켤 때 잃어버린
// call을 닫는다.
export const routerWiring: WiringFactory = () => {
  // 새 일 handler가 근거 event를 다시 읽는 main thread 연결이다.
  let eventsConnection: LedgerConnection | undefined;
  return {
    name: "router",
    records: () => [ROUTER_CONTEXT, ANNOTATION_DELIVERY_CONTEXT],
    build(ctx) {
      const apply = createInboxApplier({
        inbox: ctx.inbox,
        publish: (event) => ctx.bus.publish(event),
      });
      // session이 있으면 그 App Engineer session에, 없으면 새 session을 열어 사람 메시지 하나로 넣는다. 이미지는
      // 메시지에 싣지 않고 refs의 annotation으로 가리킨다. 보관한 앱이면 session 열기나 보내기가 conflict다.
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const run = async (route: { name: string }, input: unknown) => {
        const done = await ctx.runtime.writer.command(
          ANNOTATION_DELIVERY_CONTEXT,
          {
            command: route.name,
            input,
            idempotency_key: crypto.randomUUID(),
            compare: {},
            prepared: [],
          },
        );
        return done.ok ? ok(done.value.result) : done;
      };
      const delivery: AnnotationDelivery = {
        async deliver(input) {
          let session = input.session;
          if (session === null) {
            const opened = await run(openAgentSession, {
              id: ids.newId("ses"),
              agent: { role: "app_engineer", app: input.app },
              opening_context: null,
            });
            if (!opened.ok) return opened;
            session = (opened.value as { id: string }).id;
          } else {
            const found = await ctx.runtime.readers.read(
              agentSessionRead,
              ANNOTATION_DELIVERY_CONTEXT,
              { session },
            );
            if (!found.ok) return found;
            const { agent, lifecycle } = (found.value as {
              session: {
                agent: { role: string; app?: string };
                lifecycle: string;
              };
            }).session;
            if (
              agent.role !== "app_engineer" || agent.app !== input.app ||
              lifecycle !== "open"
            ) {
              return err({
                code: "conflict",
                message: "not an open session of this app's engineer",
              });
            }
          }
          const message = ids.newId("msg");
          const sent = await run(sendMessage, {
            id: message,
            session,
            content: {
              schema_version: 1,
              parts: [{ kind: "text", text: input.text }],
            },
            delivery: "next_turn",
            attached: [],
            refs: input.annotations.map((id) => ({ kind: "annotation", id })),
          });
          if (!sent.ok) return sent;
          return ok({ session, message });
        },
      };
      ctx.provide("annotationDelivery", delivery);

      // 새 일을 여는 domain event의 handler. 보내기는 Router의 program 입력이다. 같은 key는 한 번만 보낸다.
      // Reactor가 시작하기 전에 등록해야 해서 events가 아니라 approvals 뒤인 여기서 한다.
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      eventsConnection = opened.value;
      const reaction: ReactionRouter = {
        async send(call, idempotencyKey) {
          const done = await ctx.runtime.writer.command(ROUTER_CONTEXT, {
            command: callsReact.name,
            input: {
              event_seq: call.from.kind === "program"
                ? call.from.event_seq
                : "",
              to: call.to,
              body: call.body,
              refs: call.refs,
            },
            idempotency_key: idempotencyKey,
            compare: {},
            prepared: [],
          });
          return done.ok ? ok(undefined) : done;
        },
      };
      registerNewWorkHandlers(ctx.reactor, {
        approvals: ctx.approvals,
        router: reaction,
        events: createEventsReader(eventsConnection.sql),
      });
      return ok({
        writer: (inner) =>
          withCallBody(
            withAfterCommit(inner, apply),
            createCallBodyPreparer({
              relay: () => ctx.bodyPrepare,
              known: () => ctx.knownSecrets,
            }),
          ),
      });
    },
    closeWork() {
      eventsConnection?.close();
      eventsConnection = undefined;
    },
    // 입력함과 앱 줄이 메모리라 꺼졌다 켜진 뒤에는 잃어버린 call과 돌던 turn이 있다. 같은 tx에서 닫고,
    // agent runtime이 turn을 읽기 전에(afterReady 앞) 끝낸다.
    async start(ctx) {
      const writer = withAfterCommit(
        ctx.runtime.writer,
        createInboxApplier({
          inbox: ctx.inbox,
          publish: (event) => ctx.bus.publish(event),
        }),
      );
      // 보낸 session에 이유를 돌려줄 글을 준비하지 못하면 알림 없이 닫는다.
      const prepared = await prepareTexts(
        ctx.bodyPrepare,
        ROUTER_CONTEXT,
        [FAILURE_TEXTS.lophn_restarted],
      );
      const done = await writer.command(ROUTER_CONTEXT, {
        command: callsRecover.name,
        input: { notify: prepared.ok },
        idempotency_key: crypto.randomUUID(),
        compare: {},
        prepared: [],
      });
      if (!done.ok) {
        console.error(
          `router: could not close lost calls (${done.error.code})`,
        );
      }
      return ok(undefined);
    },
  };
};
