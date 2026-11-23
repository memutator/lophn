// `app.sdk_decide`와 통합 `update.record`의 구현. 메인 스레드 handler가 지금 판과 메모 file을 읽어 program 값(through, 판, 메모 목록,
// handoff 글)을 채우고 internal command 하나로 기록과 handoff call을 한 tx에 낸다.
import { err, type IdSource, ok, type Result } from "../../../base/mod.ts";
import {
  type AppSdkStatus,
  appSdkDecide,
  appSdkReviewRecord,
} from "../../../protocol/apps/sdk-status.ts";
import { workspaceUpdateRecord } from "../../../protocol/apps/updates.ts";
import {
  type FollowUpWorkspace,
  parseActor,
} from "../../../protocol/base/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
  Input,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  insertFlowSdkReview,
  insertFollowUp,
  insertPlatformReview,
} from "../../follow-ups/mod.ts";
import {
  FAILURE_TEXTS,
  failureCode,
  routerEnvironment,
  routerFor,
} from "../../router/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { loadApp } from "../registration/mod.ts";
import { insertReview } from "./review-store.ts";
import { readSdkStatus, type SdkStatusDeps } from "./status.ts";

// 기록과 call을 내는 core 안 machine 자격이다(기동 때 ledger에 기록한다: wiring/apps.ts, wiring/updates.ts).
export const SDK_REVIEW_PRINCIPAL = "machine:sdk-review";
export const SDK_REVIEW_CONTEXT: AuthenticatedContext = {
  principal: SDK_REVIEW_PRINCIPAL,
  actor: "machine",
  scope: { operations: [appSdkReviewRecord.name], targets: {} },
  conditions: {},
  credential_ref: SDK_REVIEW_PRINCIPAL,
};

export const UPDATE_RECORD_PRINCIPAL = "machine:update-record";
export const UPDATE_RECORD_CONTEXT: AuthenticatedContext = {
  principal: UPDATE_RECORD_PRINCIPAL,
  actor: "machine",
  scope: { operations: [workspaceUpdateRecord.name], targets: {} },
  conditions: {},
  credential_ref: UPDATE_RECORD_PRINCIPAL,
};

const WORKSPACE_LOPHN = "lophn";

type Proposal = NonNullable<Input<typeof appSdkDecide>["features"]>[number];

// 앱 lophn이 받는 글이다. 판·메모 file·기능 ID는 program이 채우고 기능의 제안 글만 agent가 썼다.
export function handoffBody(
  status: AppSdkStatus,
  features: readonly (Proposal & { id: string })[],
): string {
  const moves = status.sdks.filter((sdk) => sdk.level !== "current");
  const lines = [
    "SDK update for this app, handed over by lophn at Home. Follow the migrate-sdk skill.",
    "",
  ];
  if (moves.length === 0) {
    lines.push("No SDK version change is needed.");
  } else {
    lines.push(
      "Move these SDK packages (pinned -> target) and read their notes:",
    );
    for (const sdk of moves) {
      lines.push(
        `- ${sdk.sdk}: ${sdk.pinned} -> ${sdk.current}${sdk.level === "required" ? " (required: the app does not start or soon will not)" : ""}`,
        `  notes: ${sdk.notes.join(", ")}`,
      );
    }
  }
  if (features.length > 0) {
    lines.push(
      "",
      'The person chose these features. Each is a proposal, not a finished spec: confirm what they want in this app\'s conversation and design it with the design-app skill after the migration is released. When you finish one, record its result with `lophn app sdk-feature <feature ID> --state done|changed|skipped --note "<one line>"`.',
    );
    for (const feature of features) {
      lines.push(
        `- ${feature.id}: ${feature.title}`,
        `  ${feature.proposal.replaceAll("\n", "\n  ")}`,
        `  note: ${feature.note}`,
      );
    }
  }
  return lines.join("\n");
}

export type SdkDecideDeps = SdkStatusDeps & {
  writer(): Writer;
  ids: IdSource;
};

export function sdkDecideHandler(deps: SdkDecideDeps) {
  return async (
    ctx: AuthenticatedContext,
    raw: unknown,
  ): Promise<Result<unknown>> => {
    const parsed = appSdkDecide.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "invalid app sdk decide input",
      });
    }
    const input = parsed.data;
    const actor = parseActor(ctx.actor);
    if (actor?.kind !== "agent" || ctx.conditions.turn === undefined) {
      return err({ code: "forbidden", message: "only an agent turn decides" });
    }
    const found = await readSdkStatus(deps, { app: input.app });
    if (!found.ok) return found;
    const status = found.value[0];
    if (status === undefined) {
      return err({ code: "not_found", message: "app not found" });
    }
    const features = (input.features ?? []).map((feature) => ({
      ...feature,
      id: deps.ids.newId("sdf"),
    }));
    if (input.decision === "leave") {
      if (features.length > 0) {
        return err({
          code: "invalid_input",
          message: "features belong to an update",
        });
      }
      if (status.sdks.some((sdk) => sdk.level === "required")) {
        return err({
          code: "invalid_input",
          message:
            "a required SDK update cannot be left: decide update for this app",
        });
      }
    } else if (
      features.length === 0 &&
      status.sdks.every((sdk) => sdk.level === "current")
    ) {
      return err({
        code: "invalid_input",
        message:
          "nothing to update: every SDK is current and no feature is chosen",
      });
    }
    const known = new Set(
      status.sdks.flatMap((sdk) => [...sdk.notes, ...sdk.unreviewed]),
    );
    for (const feature of features) {
      if (!known.has(feature.note)) {
        return err({
          code: "invalid_input",
          message: `note ${feature.note} is not one of this app's notes`,
        });
      }
    }
    const through = Object.fromEntries(
      status.sdks.map((sdk) => [sdk.sdk, sdk.current]),
    );
    const done = await deps.writer().command(SDK_REVIEW_CONTEXT, {
      command: appSdkReviewRecord.name,
      input: {
        app: input.app,
        session: actor.id,
        turn: ctx.conditions.turn,
        decision: input.decision,
        through,
        features,
        ...(input.decision === "update"
          ? {
              body: [{ type: "text", text: handoffBody(status, features) }],
            }
          : {}),
      },
      idempotency_key: deps.ids.newId("sdr"),
      compare: {},
      prepared: [],
    });
    return done.ok ? ok(done.value.result) : done;
  };
}

// `app.sdk_decide`는 ledger queue를 거치지 않고 메인 스레드에서 처리한다(release 준비와 같은 모양). 처리 안에서 internal command를
// 전체 writer로 다시 낸다.
export function withSdkDecide(
  writer: Writer,
  handler: ReturnType<typeof sdkDecideHandler>,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      if (envelope.command !== appSdkDecide.name) {
        return await writer.command(ctx, envelope);
      }
      const handled = await handler(ctx, envelope.input);
      if (!handled.ok) return handled;
      return ok({
        result: handled.value,
        replayed: false,
        first_seq: null,
        last_seq: null,
      });
    },
  };
}

function loadActiveProject(
  tx: Pick<Tx, "sql">,
  projectId: string,
): Result<{ id: string }> {
  const row = tx.sql.get("select id, status from projects where id = ?", [
    projectId,
  ]);
  if (row === undefined || String(row["status"]) !== "active") {
    return err({ code: "not_found", message: "project not found" });
  }
  return ok({ id: String(row["id"]) });
}

function routeHandoff(
  tx: Tx,
  params: {
    session: string | null;
    turn: string | null;
    to: {
      agent: string;
      workspace: { app: string } | { project: string } | { home: true };
    };
    body: { type: "text"; text: string }[];
  },
): Result<{ call: string | null; session: string | null }> {
  const environment = routerEnvironment();
  if (!environment.ok) return environment;
  const router = routerFor(tx);
  if (!router.ok) return router;
  const routed =
    params.session !== null
      ? router.value.route(tx, {
          from: { kind: "agent", session: params.session },
          to: params.to,
          reply: "none",
          body: params.body,
          refs: [],
          reply_to: null,
          dedup: null,
          kind: "call",
          delivery: "next_turn",
          unattended:
            params.turn !== null
              ? environment.value.unattendedTurn(tx, params.turn)
              : false,
        })
      : router.value.route(tx, {
          from: { kind: "human" },
          to: params.to,
          reply: "none",
          body: params.body,
          refs: [],
          reply_to: null,
          dedup: null,
          kind: "message",
          delivery: "next_turn",
          unattended: false,
        });
  if (!routed.ok) return routed;
  const { fail_reason } = routed.value;
  if (fail_reason !== null) {
    return err({
      code: failureCode(fail_reason),
      message: FAILURE_TEXTS[fail_reason],
    });
  }
  if (params.session !== null && routed.value.call === null) {
    return err({
      code: failureCode("not_found"),
      message: FAILURE_TEXTS.not_found,
    });
  }
  return ok({
    call: routed.value.call,
    session: routed.value.session,
  });
}

// 통합 `update.record` command: `app_sdk`, `flow_sdk`, `platform` 결정을 한 Tx에서 검증·인계·기록한다.
// 거절된 handoff가 하나라도 있으면 어떤 review·follow-up 행도 남기지 않고 오류를 돌려준다.
export const updateRecordCommand: CommandDefinition<
  typeof workspaceUpdateRecord
> = {
  route: workspaceUpdateRecord,
  handle(tx, ctx, input) {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return err({
        code: "forbidden",
        message: "only core records workspace updates",
      });
    }

    // Phase 1: 모든 operation의 대상과 입력 정합성을 먼저 검증한다.
    const appSlugs = new Map<string, string>();
    for (const op of input.operations) {
      if (op.kind === "app_sdk") {
        const app = loadApp(tx.sql, op.app);
        if (!app.ok) return app;
        if (app.value === null || app.value.status !== "active") {
          return err({ code: "not_found", message: "app not found" });
        }
        appSlugs.set(op.app, app.value.slug);
        if (op.decision === "update") {
          if (op.body === undefined) {
            return err({
              code: "invalid_input",
              message: "an update needs a handoff body",
            });
          }
        } else if (op.items.length > 0) {
          return err({
            code: "invalid_input",
            message: "items belong to an update",
          });
        }
      } else if (op.kind === "flow_sdk") {
        const project = loadActiveProject(tx, op.project);
        if (!project.ok) return project;
        if (op.decision === "update") {
          if (op.body === undefined) {
            return err({
              code: "invalid_input",
              message: "an update needs a handoff body",
            });
          }
        } else if (op.items.length > 0) {
          return err({
            code: "invalid_input",
            message: "items belong to an update",
          });
        }
      } else {
        for (const handoff of op.handoffs) {
          if (handoff.workspace === null) continue;
          if (handoff.workspace.kind === "app") {
            const app = loadApp(tx.sql, handoff.workspace.id);
            if (!app.ok) return app;
            if (app.value === null || app.value.status !== "active") {
              return err({ code: "not_found", message: "app not found" });
            }
            appSlugs.set(handoff.workspace.id, app.value.slug);
          } else {
            const project = loadActiveProject(tx, handoff.workspace.id);
            if (!project.ok) return project;
          }
        }
      }
    }

    // Phase 2: 모든 handoff를 라우팅한다(거절 시 review·follow-up을 쓰지 않고 즉시 실패).
    const opCalls = new Map<number, string | null>();
    const calls: string[] = [];
    const handoffSessions: string[] = [];
    const seenSessions = new Set<string>();
    const recordSession = (session: string | null) => {
      if (session !== null && !seenSessions.has(session)) {
        seenSessions.add(session);
        handoffSessions.push(session);
      }
    };

    for (const [index, op] of input.operations.entries()) {
      if (op.kind === "app_sdk") {
        if (op.decision !== "update") {
          opCalls.set(index, null);
          continue;
        }
        const routed = routeHandoff(tx, {
          session: input.session,
          turn: input.turn,
          to: {
            agent: WORKSPACE_LOPHN,
            workspace: { app: appSlugs.get(op.app)! },
          },
          body: op.body!,
        });
        if (!routed.ok) return routed;
        opCalls.set(index, routed.value.call);
        if (routed.value.call !== null) calls.push(routed.value.call);
        recordSession(routed.value.session);
      } else if (op.kind === "flow_sdk") {
        if (op.decision !== "update") {
          opCalls.set(index, null);
          continue;
        }
        const routed = routeHandoff(tx, {
          session: input.session,
          turn: input.turn,
          to: {
            agent: WORKSPACE_LOPHN,
            workspace: { project: op.project },
          },
          body: op.body!,
        });
        if (!routed.ok) return routed;
        opCalls.set(index, routed.value.call);
        if (routed.value.call !== null) calls.push(routed.value.call);
        recordSession(routed.value.session);
      } else {
        for (const handoff of op.handoffs) {
          if (handoff.workspace === null) {
            // Home lophn이 직접 /update 중이면 자기 자신에게 중복 call을 보내지 않고 follow-up만 기록한다.
            if (input.session !== null) continue;
            const routed = routeHandoff(tx, {
              session: null,
              turn: null,
              to: { agent: WORKSPACE_LOPHN, workspace: { home: true } },
              body: handoff.body,
            });
            if (!routed.ok) return routed;
            recordSession(routed.value.session);
            continue;
          }
          const to =
            handoff.workspace.kind === "app"
              ? {
                  agent: WORKSPACE_LOPHN,
                  workspace: { app: appSlugs.get(handoff.workspace.id)! },
                }
              : {
                  agent: WORKSPACE_LOPHN,
                  workspace: { project: handoff.workspace.id },
                };
          const routed = routeHandoff(tx, {
            session: input.session,
            turn: input.turn,
            to,
            body: handoff.body,
          });
          if (!routed.ok) return routed;
          if (routed.value.call !== null) calls.push(routed.value.call);
          recordSession(routed.value.session);
        }
      }
    }

    // Phase 3: review와 follow_up_items를 기록한다.
    const followUps: {
      id: string;
      workspace: FollowUpWorkspace | null;
      title: string;
    }[] = [];

    for (const [index, op] of input.operations.entries()) {
      if (op.kind === "app_sdk") {
        insertReview(tx, {
          app: op.app,
          session: input.session ?? "",
          decision: op.decision,
          through: op.through,
          call: opCalls.get(index) ?? null,
        });
        const workspace: FollowUpWorkspace = { kind: "app", id: op.app };
        for (const item of op.items) {
          const created = insertFollowUp(tx, {
            id: item.id,
            workspace,
            origin: "app_sdk",
            source_ref: item.source_ref ?? null,
            title: item.title,
            body: item.proposal,
          });
          followUps.push({
            id: created.id,
            workspace: created.workspace,
            title: created.title,
          });
        }
      } else if (op.kind === "flow_sdk") {
        insertFlowSdkReview(tx, {
          project: op.project,
          workflow: op.workflow,
          session: input.session,
          decision: op.decision,
          through: op.through,
          call: opCalls.get(index) ?? null,
        });
        const workspace: FollowUpWorkspace = {
          kind: "project",
          id: op.project,
        };
        for (const item of op.items) {
          const created = insertFollowUp(tx, {
            id: item.id,
            workspace,
            origin: "flow_sdk",
            source_ref: item.source_ref ?? null,
            title: item.title,
            body: item.proposal,
          });
          followUps.push({
            id: created.id,
            workspace: created.workspace,
            title: created.title,
          });
        }
      } else {
        insertPlatformReview(tx, {
          through: op.through,
          session: input.session,
        });
        for (const handoff of op.handoffs) {
          for (const item of handoff.items) {
            const created = insertFollowUp(tx, {
              id: item.id,
              workspace: handoff.workspace,
              origin: "platform_note",
              source_ref: item.source_ref ?? op.through,
              title: item.title,
              body: item.proposal,
            });
            followUps.push({
              id: created.id,
              workspace: created.workspace,
              title: created.title,
            });
          }
        }
      }
    }

    return ok({
      follow_ups: followUps,
      calls,
      handoff_sessions: handoffSessions,
    });
  },
};
