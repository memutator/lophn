import { realpath } from "node:fs/promises";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import { createProductRedactor } from "../../../../base/redaction/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  type ArtifactPlace,
  artifactsFolder,
} from "../../../../protocol/projects/mod.ts";
import {
  placeSessionOpen,
  placeSessionRead,
} from "../../../../protocol/lophn-agent/agent-sessions.ts";
import {
  agentCallSend,
  callCancel,
  callReply,
} from "../../../../protocol/lophn-agent/calls.ts";
import { sendMessage } from "../../../../protocol/lophn-agent/inputs.ts";
import {
  archiveSession,
  blocksOfContent,
  type ContentBlock,
  contentBlocksSchema,
  contentOfBlocks,
  deleteSession,
  MESSAGE_CONTENT_MAX_BYTES,
  MESSAGE_CONTENT_PURPOSE,
  messageBody,
  serializeMessageContent,
  textBlocks,
} from "../../../../protocol/lophn-agent/mod.ts";
import {
  type AgentAtPlace,
  LOPHN_AGENT_ID,
  type Place,
} from "../../../../protocol/lophn-agent/places.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { AnnotationDelivery } from "../../../apps/annotations/ports.ts";
import { appExists, appStatusOf } from "../../../apps/lookups.ts";
import {
  createSessionDirectory,
  placeDepsOf,
} from "../../../lophn-agent/places/mod.ts";
import { createInboxApplier } from "../../../lophn-agent/run-loop/mod.ts";
import { INBOX_PUT_TOPIC } from "../../../lophn-agent/run-loop/topics.ts";
import type { BodyPrepare } from "../../../lophn-agent/session/message-body.ts";
import {
  prepareBytes,
  redactBlocks,
  rejected,
} from "../../../lophn-agent/session/message-body.ts";
import { unstartedHumanMessages } from "../../../lophn-agent/session/message-commands.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { lastArtifactWriter } from "../../../lophn-agent/session/rewind/mod.ts";
import { projectStatusOf } from "../../../projects/lookups.ts";
import {
  CANCEL_TEXT,
  callsRecover,
  FAILURE_TEXTS,
} from "../../../router/mod.ts";
import {
  type CommandEnvelope,
  type KnownSecretMatch,
  type LedgerConnection,
  openConnection,
  type Writer,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// 켤 때 잃어버린 call을 닫는 core 안 machine 자격이다. 입력함에 되돌릴 사람 메시지의 본문을 읽는 데도 쓴다. 기동 때 ledger에 기록한다.
const ROUTER_PRINCIPAL = "machine:router";

const ROUTER_CONTEXT: AuthenticatedContext = {
  principal: ROUTER_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [callsRecover.name],
    targets: {},
  },
  conditions: {},
  credential_ref: ROUTER_PRINCIPAL,
};

// annotation 묶음을 받는 쪽 agent에게 사람 메시지로 넣는 자격이다. 보내기는 사람이 누른 단추의 효과라서 actor가
// user이고, 기동 때 ledger에 기록한다. 기동마다 다시 쓰는 core 안 자격이라 ref는 `machine:`으로 시작한다.
const ANNOTATION_DELIVERY_PRINCIPAL = "machine:annotation-delivery";
const ANNOTATION_DELIVERY_CONTEXT: AuthenticatedContext = {
  principal: ANNOTATION_DELIVERY_PRINCIPAL,
  actor: "user",
  scope: {
    operations: [
      placeSessionOpen.name,
      sendMessage.name,
      placeSessionRead.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: ANNOTATION_DELIVERY_PRINCIPAL,
};

// 받는 session 기록은 본문을 blob으로 둔다. command 안에서 쓰는 본문은 그 command를 부른 자격의 이름으로 미리
// 준비돼 있어야 한다. 보낸 call의 본문, 실패를 보낸 session에 돌려주는 고정 문구, 취소 알림이다. 이미지는 hash만
// 싣는다: bytes는 보낸 자격이 먼저 올린 blob이고 command가 같은 transaction에서 참조를 건다.
export async function prepareBodies(
  relay: BodyPrepare,
  ctx: AuthenticatedContext,
  bodies: readonly (readonly ContentBlock[])[],
): Promise<Result<void>> {
  for (const body of bodies) {
    const bytes = serializeMessageContent(contentOfBlocks(body));
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

// 글 하나짜리 본문들을 준비한다. 같은 글은 한 번만 준비한다.
export async function prepareTexts(
  relay: BodyPrepare,
  ctx: AuthenticatedContext,
  texts: readonly string[],
): Promise<Result<void>> {
  return await prepareBodies(
    relay,
    ctx,
    [...new Set(texts)].map((text) => textBlocks(text)),
  );
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
    const bodies: ContentBlock[][] = [];
    let next = envelope;
    if (name === agentCallSend.name || name === callReply.name) {
      // 모양이 틀린 요청은 건드리지 않고 지나가 command의 schema 검사가 거절한다.
      const shaped = contentBlocksSchema.safeParse(
        (input as { body?: unknown } | null)?.body,
      );
      if (!shaped.success) return ok(envelope);
      // 글(text, link, resource text)만 redaction한다. 이미지는 hash를 그대로 둔다.
      const safe = redactBlocks(
        createProductRedactor(deps.known?.()),
        shaped.data,
      );
      if (safe === null) {
        return rejected("unavailable", "call redaction did not finish");
      }
      bodies.push(safe);
      next = { ...envelope, input: { ...(input as object), body: safe } };
    } else if (name === callCancel.name) {
      bodies.push(textBlocks(CANCEL_TEXT));
    } else if (name === archiveSession.name || name === deleteSession.name) {
      // 받은 call이 receiver_ended로 닫히며 보낸 session에 가는 알림이다.
      bodies.push(textBlocks(FAILURE_TEXTS.receiver_ended));
    } else return ok(envelope);
    const relay = deps.relay();
    if (relay === undefined) {
      return rejected("unavailable", "blob preparation is not available");
    }
    const prepared = await prepareBodies(relay, ctx, bodies);
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
  // 켤 때 접수만 된 사람 메시지를 다시 읽는 main thread 연결이다.
  let eventsConnection: LedgerConnection | undefined;
  return {
    name: "router",
    records: () => [ROUTER_CONTEXT, ANNOTATION_DELIVERY_CONTEXT],
    build(ctx) {
      const apply = createInboxApplier({
        inbox: ctx.inbox,
        publish: (event) => ctx.bus.publish(event),
      });
      // artifact를 받는 일은 그 그릇 place의 lophn이 맡는다. 없거나 보관한 그릇은 not_found다.
      const activePlace = (place: ArtifactPlace): Result<ArtifactPlace> => {
        const found = ledgerSnapshot(
          ctx.ledgerPath,
          (lookup) =>
            (place.kind === "project"
              ? projectStatusOf(lookup.sql, place.id)
              : appStatusOf(lookup.sql, place.id)) === "active",
        );
        if (!found.ok) return found;
        return found.value
          ? ok(place)
          : err({ code: "not_found", message: "artifact place not found" });
      };
      // 사람 메시지는 이미지를 싣지 않고 refs의 annotation으로 가리킨다. 보관한 앱이면 session 열기나 보내기가 conflict다.
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // 사람 메시지는 본문 준비와 입력함 적용을 거쳐야 turn이 열린다. API server와 같은 접은 writer가 그 층을 가진다.
      const run = async (route: { name: string }, input: unknown) => {
        const done = await ctx.writer.command(ANNOTATION_DELIVERY_CONTEXT, {
          command: route.name,
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        });
        return done.ok ? ok(done.value.result) : done;
      };
      // 지정된 session이 받는 쪽(agent와 place)의 열린 session인지 본다. 아니면 conflict다.
      const checkOpenSession = async (
        session: string,
        target: AgentAtPlace,
        message: string,
      ): Promise<Result<void>> => {
        const found = await ctx.runtime.readers.read(
          placeSessionRead,
          ANNOTATION_DELIVERY_CONTEXT,
          { session },
        );
        if (!found.ok) return found;
        const {
          agent: actual,
          place,
          lifecycle,
        } = (
          found.value as {
            session: { agent: string; place: Place | null; lifecycle: string };
          }
        ).session;
        const samePlace =
          place === null
            ? target.place === null
            : target.place !== null &&
              place.kind === target.place.kind &&
              place.id === target.place.id;
        const same = actual === target.agent && samePlace;
        return same && lifecycle === "open"
          ? ok(undefined)
          : err({ code: "conflict", message });
      };
      // session을 정해 사람 메시지 하나로 넣는다. session이 null이면 받는 쪽의 새 session을 연다.
      const sendHuman = async (
        target: AgentAtPlace,
        session: string | null,
        input: { text: string; annotations: readonly string[] },
      ): Promise<Result<{ session: string; message: string }>> => {
        if (session === null) {
          const opened = await run(placeSessionOpen, {
            id: ids.newId("ses"),
            agent: target.agent,
            place: target.place,
          });
          if (!opened.ok) return opened;
          session = (opened.value as { id: string }).id;
        }
        const message = ids.newId("msg");
        const sent = await run(sendMessage, {
          id: message,
          session,
          content: textBlocks(input.text),
          delivery: "next_turn",
          refs: input.annotations.map((id) => ({ kind: "annotation", id })),
        });
        if (!sent.ok) return sent;
        return ok({ session, message });
      };
      // 지정된 session이 있으면 받는 쪽의 열린 session인지 보고, 없으면 새 session에 넣는다.
      const deliverTo = async (
        target: AgentAtPlace,
        session: string | null,
        input: { text: string; annotations: readonly string[] },
        notOpen: string,
      ) => {
        if (session !== null) {
          const checked = await checkOpenSession(session, target, notOpen);
          if (!checked.ok) return checked;
        }
        return await sendHuman(target, session, input);
      };
      const delivery: AnnotationDelivery = {
        async deliver(input) {
          const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            appExists(lookup.sql, input.app),
          );
          if (!found.ok) return found;
          if (!found.value) {
            return err({ code: "not_found", message: "app not found" });
          }
          const target: AgentAtPlace = {
            agent: input.agent,
            place: { kind: "app", id: input.app as Id<"app"> },
          };
          return await deliverTo(
            target,
            input.session,
            input,
            "not an open session of this agent in this app",
          );
        },
        // 받는 쪽 후보 순서: (a) 그 그릇의 artifacts 폴더에 마지막으로 쓴 그 그릇 place의 열린 session(rewind 기록),
        // (b) 입력 session(그 그릇 place의 lophn 열린 session), (c) 그 그릇 place의 lophn 새 session.
        async deliverArtifact(input) {
          const owner = activePlace(input.place);
          if (!owner.ok) return owner;
          const target: AgentAtPlace = {
            agent: LOPHN_AGENT_ID,
            place: { kind: owner.value.kind, id: owner.value.id as never },
          };
          const root = await realpath(
            artifactsFolder(ctx.root.path, owner.value),
          ).catch(() => null);
          if (root !== null) {
            const found = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
              lastArtifactWriter(lookup.sql, {
                root,
                name: input.name,
                owner: owner.value,
              }),
            );
            if (!found.ok) return found;
            if (found.value !== null) {
              return await sendHuman(target, found.value.session, input);
            }
          }
          return await deliverTo(
            target,
            input.session,
            input,
            "not an open session of lophn in the artifact's place",
          );
        },
        // 사람의 폴더에 있는 `.html`은 그 project place의 lophn이 받는다.
        async deliverFile(input) {
          const target: AgentAtPlace = {
            agent: LOPHN_AGENT_ID,
            place: { kind: "project", id: input.project as Id<"prj"> },
          };
          return await deliverTo(
            target,
            input.session,
            input,
            "not an open session of lophn in this project",
          );
        },
      };
      ctx.provide("annotationDelivery", delivery);

      // 켤 때 접수만 된 사람 메시지를 start에서 다시 읽으려 main thread 연결을 연다.
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      eventsConnection = opened.value;
      return ok({
        writer: (inner) =>
          withCallBody(
            withAfterCommit(inner, apply, ctx.telemetry.logger),
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
    // agent runtime이 turn을 읽기 전에(afterReady 앞) 끝낸다. 접수만 하고 turn이 가져가지 않은 사람 메시지는
    // 입력함에 되돌려 새 turn을 연다.
    async start(ctx) {
      const apply = createInboxApplier({
        inbox: ctx.inbox,
        publish: (event) => ctx.bus.publish(event),
      });
      // 보낸 session에 이유를 돌려줄 글을 준비하지 못하면 알림 없이 닫는다.
      const prepared = await prepareTexts(ctx.bodyPrepare, ROUTER_CONTEXT, [
        FAILURE_TEXTS.lophn_restarted,
      ]);
      const done = await ctx.writer.command(ROUTER_CONTEXT, {
        command: callsRecover.name,
        input: { notify: prepared.ok },
        idempotency_key: crypto.randomUUID(),
        compare: {},
        prepared: [],
      });
      if (!done.ok) {
        ctx.telemetry.logger.error({
          component: "router",
          event: "close_lost_calls_failed",
          fields: { code: done.error.code },
        });
      }
      // 본문은 blob이라 tx 안에서 읽지 못한다. 같은 ledger를 읽는 main thread 연결로 가려 읽는다.
      if (eventsConnection !== undefined) {
        const sql = eventsConnection.sql;
        const directory = createSessionDirectory({
          ...placeDepsOf(sql),
          publish: () => {},
          sql: () => sql,
        });
        for (const pending of unstartedHumanMessages(sql)) {
          // 보관한 place의 session은 새 입력을 받지 않는다.
          if (!directory.find(pending.session as Id<"ses">)?.accepting) {
            continue;
          }
          // ReadMessageBody는 blob을 읽어서 reader pool 밖의 read다.
          const body = await ctx.runtime.reads.get(
            `${messageBody.resource}/${messageBody.method}`,
          )!(ROUTER_CONTEXT, { message: pending.id });
          if (!body.ok) {
            ctx.telemetry.logger.error({
              component: "router",
              event: "requeue_message_failed",
              fields: { code: body.error.code },
            });
            continue;
          }
          const { content } = body.value as {
            content: Parameters<typeof blocksOfContent>[0];
          };
          apply([
            {
              topic: INBOX_PUT_TOPIC,
              data: {
                session: pending.session,
                input: {
                  kind: "message",
                  from: { kind: "human" },
                  call: null,
                  reply_to: null,
                  body: blocksOfContent(content),
                  refs: pending.refs,
                  delivery: "next_turn",
                  message: pending.id,
                  reply: null,
                  outcome: null,
                  event: null,
                  notice: null,
                  step: null,
                  unattended: false,
                },
                at: pending.created_at,
              },
            },
          ]);
        }
      }
      return ok(undefined);
    },
  };
};
