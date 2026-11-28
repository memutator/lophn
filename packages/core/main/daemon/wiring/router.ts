import { realpath } from "node:fs/promises";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import { createProductRedactor } from "../../../../base/redaction/mod.ts";
import { appDelete } from "../../../../protocol/apps/mod.ts";
import { appSdkReviewRecord } from "../../../../protocol/apps/sdk-status.ts";
import { workspaceUpdateRecord } from "../../../../protocol/apps/updates.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import { agentDelete } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import {
  workspaceSessionOpen,
  workspaceSessionRead,
} from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { APP_CALL_SETTLED_EVENT } from "../../../../protocol/lophn-agent/app-calls.ts";
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
  finishTurn,
  interruptTurns,
  MESSAGE_CONTENT_MAX_BYTES,
  MESSAGE_CONTENT_PURPOSE,
  messageBody,
  serializeMessageContent,
  stopTurn,
  textBlocks,
} from "../../../../protocol/lophn-agent/mod.ts";
import {
  TEAM_MEMBER_PREAMBLE,
  teamEnd,
  teamSpawn,
} from "../../../../protocol/lophn-agent/team.ts";
import {
  type AgentAtWorkspace,
  lophnIdOf,
  type Workspace,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import {
  type ArtifactWorkspace,
  artifactsFolder,
} from "../../../../protocol/projects/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  type WorkflowOrigin,
  workflowOriginSchema,
} from "../../../../protocol/workflows/values.ts";
import type { ApprovalsService } from "../../../approvals/approvals.ts";
import type { AnnotationDelivery } from "../../../apps/annotations/ports.ts";
import { appExists, appStatusOf } from "../../../apps/lookups.ts";
import { createQueueApplier } from "../../../lophn-agent/run-loop/mod.ts";
import { QUEUE_PUT_TOPIC } from "../../../lophn-agent/run-loop/topics.ts";
import type { BodyPrepare } from "../../../lophn-agent/session/message-body.ts";
import {
  prepareBytes,
  redactBlocks,
  rejected,
} from "../../../lophn-agent/session/message-body.ts";
import { unstartedHumanMessages } from "../../../lophn-agent/session/message-commands.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { lastArtifactWriter } from "../../../lophn-agent/session/rewind/mod.ts";
import {
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import { projectStatusOf } from "../../../projects/lookups.ts";
import {
  APP_CALL_SETTLED_TOPIC,
  ASK_ANSWERED_TOPIC,
  ASK_ENDED_TOPIC,
  CALL_SESSION_OPENED_TOPIC,
  CANCEL_TEXT,
  callsAppCancel,
  callsAppSend,
  callsAskOpen,
  callsAskWithdraw,
  callsMailApply,
  callsMailSent,
  callsRecover,
  FAILURE_TEXTS,
  remoteStepBody,
  TAKEN_RESTART_TEXTS,
  TEAM_SPAWNED_TOPIC,
  WORKFLOW_SESSION_OPENED_TOPIC,
} from "../../../router/mod.ts";
import {
  type CommandEnvelope,
  type CommitAction,
  type KnownSecretMatch,
  type LedgerConnection,
  openConnection,
  type Writer,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// 켤 때 잃어버린 call을 닫는 core 안 machine 자격이다. queue에 되돌릴 사람 메시지의 본문을 읽는 데도 쓴다. 기동 때 ledger에 기록한다.
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
      workspaceSessionOpen.name,
      sendMessage.name,
      workspaceSessionRead.name,
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

export function createCallBodyPreparer(deps: {
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
    if (
      name === agentCallSend.name ||
      name === callReply.name ||
      name === teamSpawn.name ||
      name === callsAskOpen.name ||
      name === callsAppSend.name ||
      name === appSdkReviewRecord.name
    ) {
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
      // team spawn의 첫 call은 앞에 고정 글 하나를 붙인다. 받은 메시지로 저장되어 이력 재생이 같은 bytes다.
      const body =
        name === teamSpawn.name
          ? [{ type: "text" as const, text: TEAM_MEMBER_PREAMBLE }, ...safe]
          : safe;
      bodies.push(body);
      next = { ...envelope, input: { ...(input as object), body } };
    } else if (name === workspaceUpdateRecord.name) {
      // 통합 update.record는 각 operation의 body(app_sdk·flow_sdk·platform handoffs)를 모두 redaction·blob 준비한다.
      const shaped = workspaceUpdateRecord.input.safeParse(input);
      if (!shaped.success) return ok(envelope);
      const redact = createProductRedactor(deps.known?.());
      const operations = [];
      for (const op of shaped.data.operations) {
        if (op.kind === "platform") {
          const handoffs = [];
          for (const handoff of op.handoffs) {
            const safe = redactBlocks(redact, handoff.body);
            if (safe === null) {
              return rejected("unavailable", "call redaction did not finish");
            }
            bodies.push(safe);
            handoffs.push({ ...handoff, body: safe });
          }
          operations.push({ ...op, handoffs });
        } else if (op.body !== undefined) {
          const safe = redactBlocks(redact, op.body);
          if (safe === null) {
            return rejected("unavailable", "call redaction did not finish");
          }
          bodies.push(safe);
          operations.push({ ...op, body: safe });
        } else {
          operations.push(op);
        }
      }
      if (bodies.length === 0) return ok(envelope);
      next = { ...envelope, input: { ...shaped.data, operations } };
    } else if (
      name === callCancel.name ||
      name === callsAskWithdraw.name ||
      name === callsAppCancel.name
    ) {
      bodies.push(textBlocks(CANCEL_TEXT));
    } else if (
      name === archiveSession.name ||
      name === deleteSession.name ||
      name === teamEnd.name ||
      // 앱·agent를 지우면 같은 tx에서 관련 session을 지운다(DeleteSession과 같은 끝).
      name === appDelete.name ||
      name === agentDelete.name
    ) {
      // 받은 call이 receiver_ended로 닫히며 보낸 session에 가는 알림과, 끝나는 session이 보낸 ask나 끝나는 팀원 자리가 이 기계로
      // 보낸 call이 취소되며 받은 session에 가는 취소 알림이다.
      bodies.push(
        textBlocks(FAILURE_TEXTS.receiver_ended),
        textBlocks(CANCEL_TEXT),
      );
    } else if (
      name === stopTurn.name ||
      (name === finishTurn.name &&
        (input as { outcome?: { kind?: unknown } } | null)?.outcome?.kind ===
          "failed")
    ) {
      // 가져간 result call을 답 없이 끝낸 turn이면 그 call이 receiver_ended로 닫히며 보낸 session에 가는 알림이다.
      bodies.push(textBlocks(FAILURE_TEXTS.receiver_ended));
    } else if (name === interruptTurns.name) {
      // agent runtime이 사라져 닫는 turn이 가져간 call의 알림이다.
      bodies.push(textBlocks(TAKEN_RESTART_TEXTS.local));
    } else if (name === callsMailApply.name) {
      // 다른 컴퓨터의 mail이 이 기계의 session에 넣는 글: call·reply의 본문(보낸 기계가 했어도 redaction을 한 번 더 거친다), 실패 알림,
      // 취소 알림.
      const shaped = callsMailApply.input.safeParse(input);
      if (!shaped.success) return ok(envelope);
      const { mail } = shaped.data;
      const body =
        mail.kind === "call" || mail.kind === "reply" ? mail.body : null;
      if (body !== null) {
        const safe = redactBlocks(createProductRedactor(deps.known?.()), body);
        if (safe === null) {
          return rejected("unavailable", "call redaction did not finish");
        }
        // workflow step은 받는 session에 다른 컴퓨터 표시 줄이 붙은 본문으로 들어간다(Router가 같은 글을 만든다).
        bodies.push(
          mail.kind === "call" && mail.step !== undefined
            ? remoteStepBody(shaped.data.origin.computer, safe)
            : safe,
        );
        next = {
          ...envelope,
          input: { ...shaped.data, mail: { ...mail, body: safe } },
        };
      }
      if (mail.kind === "reply" && mail.outcome?.state === "failed") {
        bodies.push(
          textBlocks(FAILURE_TEXTS[mail.outcome.reason ?? "receiver_ended"]),
        );
      }
      // 팀원 session이나 그 자리가 끝나면(cancel의 end, state의 ended, 실패한 spawn call이나 자리로 보낸 call) 그 session이 받은 열린
      // call이 receiver_ended로 닫혀 보낸 session에 가는 알림과, 그 session이 보낸 ask나 그 팀원이 이 기계로 보낸 call의 취소 알림이다.
      if (
        mail.kind === "cancel" ||
        mail.kind === "state" ||
        (mail.kind === "reply" && mail.outcome?.state === "failed")
      ) {
        bodies.push(
          textBlocks(FAILURE_TEXTS.receiver_ended),
          textBlocks(CANCEL_TEXT),
        );
      }
      if (bodies.length === 0) return ok(envelope);
    } else if (name === callsMailSent.name) {
      // 다른 컴퓨터가 받지 못한 call의 실패 알림이다: 옛 판이 거절했거나 그 기계가 배달하지 못했다.
      const shaped = callsMailSent.input.safeParse(input);
      if (!shaped.success) return ok(envelope);
      const { result } = shaped.data;
      const reason =
        result.kind === "refused"
          ? "old_version"
          : result.kind === "acked" && result.applied.delivery === "failed"
            ? (result.applied.reason ?? "not_found")
            : null;
      if (reason === null) return ok(envelope);
      // spawn call이나 자리로 보낸 call이 실패하면 그 팀원의 자리가 끝나며 자리로 보낸 다른 열린 call도 receiver_ended로 닫히고 그 팀원이
      // 이 기계로 보낸 call은 취소된다.
      bodies.push(
        textBlocks(FAILURE_TEXTS[reason]),
        textBlocks(FAILURE_TEXTS.receiver_ended),
        textBlocks(CANCEL_TEXT),
      );
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
  prepareTeamWorktree?: (
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ) => Promise<
    Result<{ envelope: CommandEnvelope; createdWorktreeId?: Id<"wkt"> }>
  >,
  rollbackTeamWorktree?: (id: Id<"wkt">) => Promise<void>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const ready = await prepare(ctx, envelope);
      if (!ready.ok) return ready;
      let next = ready.value;
      let createdWorktreeId: Id<"wkt"> | undefined;
      if (prepareTeamWorktree !== undefined) {
        const prepared = await prepareTeamWorktree(ctx, next);
        if (!prepared.ok) return prepared;
        next = prepared.value.envelope;
        createdWorktreeId = prepared.value.createdWorktreeId;
      }
      const result = await writer.command(ctx, next);
      if (!result.ok && createdWorktreeId !== undefined) {
        await rollbackTeamWorktree?.(createdWorktreeId);
      }
      return result;
    },
  };
}

// Router의 main thread 쪽이다. command와 read는 writer·reader Worker가 `router-registration.ts`로 돌린다.
// 여기서는 call 본문을 미리 준비하고, commit된 tx가 모은 일(queue에 넣기, agent event)을 적용하고, 켤 때 잃어버린
// call을 닫는다.
export const routerWiring: WiringFactory = () => {
  // 켤 때 접수만 된 사람 메시지를 다시 읽는 main thread 연결이다.
  let eventsConnection: LedgerConnection | undefined;
  return {
    name: "router",
    records: () => [ROUTER_CONTEXT, ANNOTATION_DELIVERY_CONTEXT],
    build(ctx) {
      const applyQueue = createQueueApplier({
        queue: ctx.queue,
        publish: (event) => ctx.bus.publish(event),
      });
      // agent가 연 session은 그 session의 workspace에 Agent 탭으로 연다. 같은 workspace면 연 session의 탭을 source로 두고 무엇인지
      // (relation: team spawn은 peer·stage, 그냥 call은 stage)만 말하며 자리는 renderer가 정한다. 다른 workspace면 source 없이
      // 그 workspace의 Main desk 끝에 열린다. host queue는 늦게 채워지므로 부를 때 읽는다.
      const openSessionTab = (data: {
        opener: Id<"ses">;
        session: Id<"ses">;
        relation: "peer" | "stage";
      }) => {
        const rows = ledgerSnapshot(ctx.ledgerPath, (lookup) => ({
          opener: loadSession(lookup, data.opener),
          session: loadSession(lookup, data.session),
        }));
        if (!rows.ok || !rows.value.opener || !rows.value.session) return;
        // GUI 탭 팀원은 Agent 탭이 아니라 그 coding agent의 터미널 탭이 자리다. 그 탭은 입력이 들어올 때 GUI 연결이 연다.
        if (rows.value.session.harness_gui) return;
        let origin: WorkflowOrigin | null = null;
        if (rows.value.session.workflow_origin !== null) {
          try {
            const parsed = workflowOriginSchema.safeParse(
              JSON.parse(rows.value.session.workflow_origin),
            );
            if (parsed.success) origin = parsed.data;
          } catch {
            // 손상된 값은 무시하고 기본 자리에 연다.
          }
        }
        if (origin !== null) {
          // workflow_origin이 있는 세션(및 그 team spawn 자식)은 원 workflow의 workspace·desk·step 묶음에 둔다.
          ctx.hostQueue.openTab({
            owner: data.opener,
            workspace: { kind: "project", id: origin.project },
            target: { session: data.session },
            relation: null,
            source: null,
            desk: { workflow: origin.workflow, instance: origin.instance },
            group: `${origin.instance}:${origin.step}`,
          });
          return;
        }
        const from = workspaceOf(rows.value.opener);
        const there = workspaceOf(rows.value.session);
        const same = from?.kind === there?.kind && from?.id === there?.id;
        ctx.hostQueue.openTab({
          owner: data.opener,
          workspace: there ?? { kind: "home" },
          target: { session: data.session },
          relation: same ? data.relation : null,
          source: same ? data.opener : null,
        });
      };
      // workflow step이 `open: "tab"`으로 넘긴 session은 GUI 탭 팀원이 아닌 경우 원 workflow desk·step 묶음에 Agent 탭으로 연다.
      const openWorkflowSessionTab = (session: Id<"ses">) => {
        const loaded = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
          loadSession(lookup, session),
        );
        if (!loaded.ok || !loaded.value) return;
        if (loaded.value.harness_gui) return;
        if (loaded.value.workflow_origin === null) return;
        let origin: WorkflowOrigin | null = null;
        try {
          const parsed = workflowOriginSchema.safeParse(
            JSON.parse(loaded.value.workflow_origin),
          );
          if (parsed.success) origin = parsed.data;
        } catch {
          return;
        }
        if (origin === null) return;
        ctx.hostQueue.openTab({
          owner: "person",
          workspace: { kind: "project", id: origin.project },
          target: { session },
          relation: null,
          source: null,
          desk: { workflow: origin.workflow, instance: origin.instance },
          group: `${origin.instance}:${origin.step}`,
        });
      };
      // 앱이 보낸 call이 끝났다. 앱에는 queue가 없어 `call.settled` event(발행자 lophn)로 그 앱에만 알린다.
      const settled = (data: {
        app: string;
        call: string;
        state: string;
        fail_reason: string | null;
      }) => {
        void ctx.eventDelivery
          .publish({
            publisher: "lophn",
            release: null,
            source: "lophn",
            event: APP_CALL_SETTLED_EVENT,
            payload: {
              call: data.call,
              state: data.state,
              fail_reason: data.fail_reason,
            },
            chain: [],
            parent: null,
            audience: (app) => app === data.app,
          })
          .then((published) => {
            if (!published.ok) {
              ctx.telemetry.logger.warn({
                component: "router",
                event: "call_settled_publish_failed",
                fields: { message: published.error.message },
              });
            }
          });
      };
      const apply = (actions: readonly CommitAction[]) => {
        applyQueue(actions);
        for (const action of actions) {
          if (action.topic === TEAM_SPAWNED_TOPIC) {
            const spawned = action.data as {
              parent: Id<"ses">;
              child: Id<"ses">;
              relation: "peer" | "stage";
            };
            openSessionTab({
              opener: spawned.parent,
              session: spawned.child,
              relation: spawned.relation,
            });
          } else if (action.topic === CALL_SESSION_OPENED_TOPIC) {
            const opened = action.data as {
              caller: Id<"ses">;
              session: Id<"ses">;
            };
            openSessionTab({
              opener: opened.caller,
              session: opened.session,
              relation: "stage",
            });
          } else if (action.topic === WORKFLOW_SESSION_OPENED_TOPIC) {
            const opened = action.data as { session: Id<"ses"> };
            openWorkflowSessionTab(opened.session);
          } else if (action.topic === ASK_ANSWERED_TOPIC) {
            ctx.peek.approvals?.askReplies.answered(
              action.data as Parameters<
                ApprovalsService["askReplies"]["answered"]
              >[0],
            );
          } else if (action.topic === ASK_ENDED_TOPIC) {
            ctx.peek.approvals?.askReplies.ended(
              action.data as Parameters<
                ApprovalsService["askReplies"]["ended"]
              >[0],
            );
          } else if (action.topic === APP_CALL_SETTLED_TOPIC) {
            settled(
              action.data as {
                app: string;
                call: string;
                state: string;
                fail_reason: string | null;
              },
            );
          }
        }
      };
      // artifact를 받는 일은 그 그릇 workspace의 lophn이 맡는다. 없거나 보관한 그릇은 not_found다.
      const activeWorkspace = (
        workspace: ArtifactWorkspace,
      ): Result<ArtifactWorkspace> => {
        const found = ledgerSnapshot(
          ctx.ledgerPath,
          (lookup) =>
            (workspace.kind === "project"
              ? projectStatusOf(lookup.sql, workspace.id)
              : appStatusOf(lookup.sql, workspace.id)) === "active",
        );
        if (!found.ok) return found;
        return found.value
          ? ok(workspace)
          : err({ code: "not_found", message: "artifact workspace not found" });
      };
      // 사람 메시지는 이미지를 싣지 않고 refs의 annotation으로 가리킨다. 보관한 앱이면 session 열기나 보내기가 conflict다.
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // 사람 메시지는 본문 준비와 queue 적용을 거쳐야 turn이 열린다. API server와 같은 접은 writer가 그 층을 가진다.
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
      // 지정된 session이 받는 쪽(agent와 workspace)의 열린 session인지 본다. 아니면 conflict다.
      const checkOpenSession = async (
        session: string,
        target: AgentAtWorkspace,
        message: string,
      ): Promise<Result<void>> => {
        const found = await ctx.runtime.readers.read(
          workspaceSessionRead,
          ANNOTATION_DELIVERY_CONTEXT,
          { session },
        );
        if (!found.ok) return found;
        const {
          agent: actual,
          workspace,
          lifecycle,
        } = (
          found.value as {
            session: {
              agent: string;
              workspace: Workspace | null;
              lifecycle: string;
            };
          }
        ).session;
        const sameWorkspace =
          workspace === null
            ? target.workspace === null
            : target.workspace !== null &&
              workspace.kind === target.workspace.kind &&
              workspace.id === target.workspace.id;
        const same = actual === target.agent && sameWorkspace;
        return same && lifecycle === "open"
          ? ok(undefined)
          : err({ code: "conflict", message });
      };
      // session을 정해 사람 메시지 하나로 넣는다. session이 null이면 받는 쪽의 새 session을 연다.
      const sendHuman = async (
        target: AgentAtWorkspace,
        session: string | null,
        input: { text: string; annotations: readonly string[] },
      ): Promise<Result<{ session: string; message: string }>> => {
        if (session === null) {
          const opened = await run(workspaceSessionOpen, {
            id: ids.newId("ses"),
            agent: target.agent,
            workspace: target.workspace,
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
        target: AgentAtWorkspace,
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
          const target: AgentAtWorkspace = {
            agent: input.agent,
            workspace: { kind: "app", id: input.app as Id<"app"> },
          };
          return await deliverTo(
            target,
            input.session,
            input,
            "not an open session of this agent in this app",
          );
        },
        // 받는 쪽 후보 순서: (a) 그 그릇의 artifacts 폴더에 마지막으로 쓴 그 그릇 workspace의 열린 session(rewind 기록),
        // (b) 입력 session(그 그릇 workspace의 lophn 열린 session), (c) 그 그릇 workspace의 lophn 새 session.
        async deliverArtifact(input) {
          const owner = activeWorkspace(input.workspace);
          if (!owner.ok) return owner;
          const workspace: Workspace = {
            kind: owner.value.kind,
            id: owner.value.id as never,
          };
          const target: AgentAtWorkspace = {
            agent: lophnIdOf(workspace),
            workspace,
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
            "not an open session of lophn in the artifact's workspace",
          );
        },
        // 사람의 폴더에 있는 `.html`은 그 project workspace의 lophn이 받는다.
        async deliverFile(input) {
          const workspace: Workspace = {
            kind: "project",
            id: input.project as Id<"prj">,
          };
          const target: AgentAtWorkspace = {
            agent: lophnIdOf(workspace),
            workspace,
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
            async (authCtx, envelope) => {
              if (envelope.command !== teamSpawn.name) {
                return ok({ envelope });
              }
              const parsed = teamSpawn.input.safeParse(envelope.input);
              if (!parsed.success || parsed.data.worktree !== "new") {
                return ok({ envelope });
              }
              const wt = ctx.peek.worktrees;
              if (wt === undefined) {
                return err({
                  code: "unavailable" as const,
                  message: "worktrees are not wired",
                });
              }
              // 대상 project를 푼다: workspace가 지정되면 그 주소의 project, 없으면 부모 session의 project.
              const actor = parseActor(authCtx.actor);
              const parentSessionId =
                actor?.kind === "agent" ? actor.id : undefined;
              const targetRes = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
                const deps = workspaceDepsOf(lookup.sql);
                if (parsed.data.workspace !== undefined) {
                  const resolved = deps.names.resolveAddress({
                    agent: parsed.data.agent,
                    workspace: parsed.data.workspace,
                  });
                  if (!resolved.ok) return resolved;
                  if (resolved.value.workspace?.kind !== "project") {
                    return err({
                      code: "invalid_input" as const,
                      message: "worktree requires a project workspace",
                    });
                  }
                  return ok(resolved.value.workspace.id as Id<"prj">);
                }
                if (parentSessionId === undefined) {
                  return err({
                    code: "forbidden" as const,
                    message: "only an agent session calls",
                  });
                }
                const parentRow = loadSession(lookup, parentSessionId);
                if (parentRow === undefined) {
                  return err({
                    code: "not_found" as const,
                    message: "session not found",
                  });
                }
                const ws = workspaceOf(parentRow);
                if (ws?.kind !== "project") {
                  return err({
                    code: "invalid_input" as const,
                    message: "worktree requires a project workspace",
                  });
                }
                return ok(ws.id as Id<"prj">);
              });
              if (!targetRes.ok) return targetRes;
              if (!targetRes.value.ok) return targetRes.value;
              const created = await wt.create({
                project: targetRes.value.value,
              });
              if (!created.ok) return created;
              const worktreeId = created.value.record.id as Id<"wkt">;
              return ok({
                envelope: {
                  ...envelope,
                  input: {
                    ...(envelope.input as Record<string, unknown>),
                    worktree: worktreeId,
                  },
                },
                createdWorktreeId: worktreeId,
              });
            },
            async (worktreeId) => {
              await ctx.peek.worktrees
                ?.remove({ worktree: worktreeId, force: true })
                .catch(() => undefined);
            },
          ),
      });
    },
    closeWork() {
      eventsConnection?.close();
      eventsConnection = undefined;
    },
    // queue와 앱 줄이 메모리라 꺼졌다 켜진 뒤에는 잃어버린 call과 돌던 turn이 있다. 같은 tx에서 닫고,
    // agent runtime이 turn을 읽기 전에(afterReady 앞) 끝낸다. 접수만 하고 turn이 가져가지 않은 사람 메시지는
    // queue에 되돌려 새 turn을 연다.
    async start(ctx) {
      const apply = createQueueApplier({
        queue: ctx.queue,
        publish: (event) => ctx.bus.publish(event),
      });
      // 보낸 session에 이유를 돌려줄 글을 준비하지 못하면 알림 없이 닫는다.
      // 가져가기 전에 잃은 call과 가져가 일하던 call은 글이 다르다.
      const prepared = await prepareTexts(ctx.bodyPrepare, ROUTER_CONTEXT, [
        FAILURE_TEXTS.lophn_restarted,
        TAKEN_RESTART_TEXTS.local,
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
          ...workspaceDepsOf(sql),
          publish: () => {},
          sql: () => sql,
        });
        for (const pending of unstartedHumanMessages(sql)) {
          // 보관한 workspace의 session은 새 입력을 받지 않는다. harness session의 입력은 harness wiring이 되돌린다.
          const target = directory.find(pending.session as Id<"ses">);
          if (!target?.accepting || target.transport !== "lophn") continue;
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
              topic: QUEUE_PUT_TOPIC,
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
