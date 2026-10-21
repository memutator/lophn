import { realpath } from "node:fs/promises";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  agentSessionRead,
  openAgentSession,
} from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { sendMessage } from "../../../../protocol/lophn-agent/inputs.ts";
import type { AnnotationDelivery } from "../../../apps/annotations/ports.ts";
import { appExists, appStatusOf } from "../../../apps/lookups.ts";
import { domainOwnerOf } from "../../../domains/lookups.ts";
import { projectStatusOf } from "../../../projects/lookups.ts";
import type { DomainOwner } from "../../../../protocol/domains/mod.ts";
import { domainArtifactsFolder } from "../../../../protocol/domains/paths.ts";
import type { AgentRef } from "../../../../protocol/lophn-agent/places.ts";
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
  messageBody,
  serializeMessageContent,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createProductRedactor } from "../../../../base/redaction/mod.ts";
import {
  prepareBytes,
  rejected,
} from "../../../lophn-agent/session/message-body.ts";
import type { BodyPrepare } from "../../../lophn-agent/session/message-body.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { lastArtifactWriter } from "../../../lophn-agent/session/rewind/mod.ts";
import { createInboxApplier } from "../../../lophn-agent/run-loop/mod.ts";
import { INBOX_PUT_TOPIC } from "../../../lophn-agent/run-loop/topics.ts";
import {
  createSessionDirectory,
  placeDepsOf,
} from "../../../lophn-agent/places/mod.ts";
import { unstartedHumanMessages } from "../../../lophn-agent/session/message-commands.ts";
import {
  callsRecover,
  CANCEL_TEXT,
  FAILURE_TEXTS,
} from "../../../router/mod.ts";
import {
  type CommandEnvelope,
  type KnownSecretMatch,
  type LedgerConnection,
  openConnection,
  withAfterCommit,
  type Writer,
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
    if (name === callSend.name || name === callReply.name) {
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
      // 앱을 받는 일은 그 앱의 App Engineer가 맡는다.
      const agentOfApp = (app: string): Result<AgentRef> => {
        const found = ledgerSnapshot(
          ctx.ledgerPath,
          (lookup) => appExists(lookup.sql, app),
        );
        if (!found.ok) return found;
        return found.value
          ? ok({ role: "app_engineer", app: app as Id<"app"> })
          : err({ code: "not_found", message: "app not found" });
      };
      // domain을 받는 일은 그 domain 그릇의 agent가 맡는다. 없는 domain이나 보관한 owner는 not_found다.
      const ownerOfDomain = (domain: string): Result<DomainOwner> => {
        const found = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
          const owner = domainOwnerOf(lookup.sql, domain);
          if (owner === null) return null;
          const status = owner.kind === "project"
            ? projectStatusOf(lookup.sql, owner.id)
            : appStatusOf(lookup.sql, owner.id);
          return status === "active" ? owner : null;
        });
        if (!found.ok) return found;
        return found.value === null
          ? err({ code: "not_found", message: "domain or its owner not found" })
          : ok(found.value);
      };
      const agentOfOwner = (owner: DomainOwner): AgentRef =>
        owner.kind === "project"
          ? { role: "project_manager", project: owner.id }
          : { role: "app_engineer", app: owner.id };
      // 사람 메시지는 이미지를 싣지 않고 refs의 annotation으로 가리킨다. 보관한 앱이면 session 열기나 보내기가 conflict다.
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // 사람 메시지는 본문 준비와 입력함 적용을 거쳐야 turn이 열린다. API server와 같은 접은 writer가 그 층을 가진다.
      const run = async (route: { name: string }, input: unknown) => {
        const done = await ctx.writer.command(
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
      const refKey = (agent: AgentRef) =>
        agent.role === "app_engineer"
          ? `app:${agent.app}`
          : agent.role === "project_manager"
          ? `prj:${agent.project}`
          : agent.role;
      // 지정된 session이 agent의 열린 session인지 본다. 아니면 conflict다.
      const checkOpenSession = async (
        session: string,
        agent: AgentRef,
        message: string,
      ): Promise<Result<void>> => {
        const found = await ctx.runtime.readers.read(
          agentSessionRead,
          ANNOTATION_DELIVERY_CONTEXT,
          { session },
        );
        if (!found.ok) return found;
        const { agent: actual, lifecycle } = (found.value as {
          session: { agent: AgentRef; lifecycle: string };
        }).session;
        const same = refKey(actual) === refKey(agent);
        return same && lifecycle === "open"
          ? ok(undefined)
          : err({ code: "conflict", message });
      };
      // session을 정해 사람 메시지 하나로 넣는다. session이 null이면 agent의 새 session을 연다.
      const sendHuman = async (
        agent: AgentRef,
        session: string | null,
        input: { text: string; annotations: readonly string[] },
      ): Promise<Result<{ session: string; message: string }>> => {
        if (session === null) {
          const opened = await run(openAgentSession, {
            id: ids.newId("ses"),
            agent,
            opening_context: null,
          });
          if (!opened.ok) return opened;
          session = (opened.value as { id: string }).id;
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
          refs: input.annotations.map((id) => ({ kind: "annotation", id })),
        });
        if (!sent.ok) return sent;
        return ok({ session, message });
      };
      // 지정된 session이 있으면 agent의 열린 session인지 보고, 없으면 새 session에 넣는다.
      const deliverTo = async (
        agent: AgentRef,
        session: string | null,
        input: { text: string; annotations: readonly string[] },
        notOpen: string,
      ) => {
        if (session !== null) {
          const checked = await checkOpenSession(session, agent, notOpen);
          if (!checked.ok) return checked;
        }
        return await sendHuman(agent, session, input);
      };
      const delivery: AnnotationDelivery = {
        async deliver(input) {
          const agent = agentOfApp(input.app);
          if (!agent.ok) return agent;
          return await deliverTo(
            agent.value,
            input.session,
            input,
            "not an open session of this app's engineer",
          );
        },
        // 받는 쪽 후보 순서: (a) 그 domain의 artifacts 폴더에 마지막으로 쓴 열린 session(rewind 기록),
        // (b) 입력 session(그 domain owner의 열린 PM 또는 App Engineer), (c) owner의 새 session.
        async deliverArtifact(input) {
          const owner = ownerOfDomain(input.domain);
          if (!owner.ok) return owner;
          const agent = agentOfOwner(owner.value);
          const root = await realpath(
            domainArtifactsFolder(ctx.root.path, input.domain),
          ).catch(() => null);
          if (root !== null) {
            const found = ledgerSnapshot(
              ctx.ledgerPath,
              (lookup) =>
                lastArtifactWriter(lookup.sql, {
                  root,
                  name: input.name,
                  owner: owner.value,
                  roles: [agent.role, "operator"],
                }),
            );
            if (!found.ok) return found;
            if (found.value !== null) {
              return await sendHuman(agent, found.value.session, input);
            }
          }
          return await deliverTo(
            agent,
            input.session,
            input,
            "not an open session of this domain's owner",
          );
        },
        // 사람의 폴더에 있는 `.html`은 그 project의 PM이 받는다.
        async deliverFile(input) {
          return await deliverTo(
            { role: "project_manager", project: input.project as Id<"prj"> },
            input.session,
            input,
            "not an open session of this project's manager",
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
    // agent runtime이 turn을 읽기 전에(afterReady 앞) 끝낸다. 접수만 하고 turn이 가져가지 않은 사람 메시지는
    // 입력함에 되돌려 새 turn을 연다.
    async start(ctx) {
      const apply = createInboxApplier({
        inbox: ctx.inbox,
        publish: (event) => ctx.bus.publish(event),
      });
      // 보낸 session에 이유를 돌려줄 글을 준비하지 못하면 알림 없이 닫는다.
      const prepared = await prepareTexts(
        ctx.bodyPrepare,
        ROUTER_CONTEXT,
        [FAILURE_TEXTS.lophn_restarted],
      );
      const done = await ctx.writer.command(ROUTER_CONTEXT, {
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
            console.error(
              `router: could not requeue a received message (${body.error.code})`,
            );
            continue;
          }
          const { content } = body.value as {
            content: { parts: { kind: string; text?: string }[] };
          };
          const text = content.parts.flatMap((part) =>
            part.kind === "text" ? [part.text ?? ""] : []
          ).join("\n");
          apply([{
            topic: INBOX_PUT_TOPIC,
            data: {
              session: pending.session,
              input: {
                kind: "message",
                from: { kind: "human" },
                call: null,
                reply_to: null,
                body: text,
                refs: pending.refs,
                delivery: "next_turn",
                message: pending.id,
                reply: null,
                outcome: null,
                event: null,
                notice: null,
                unattended: false,
              },
              at: pending.created_at,
            },
          }]);
        }
      }
      return ok(undefined);
    },
  };
};
