// `app.sdk_decide`의 메인 스레드 쪽. 지금 판과 메모 file을 읽어 program 값(through, 판, 메모 목록, handoff 글)을 채우고 internal command
// 하나로 기록과 handoff call을 한 tx에 낸다. agent 입력으로 받는 것은 결정과 기능의 제목·제안·근거 메모뿐이다.
import { err, type IdSource, ok, type Result } from "../../../base/mod.ts";
import {
  type AppSdkStatus,
  appSdkDecide,
  appSdkReviewRecord,
} from "../../../protocol/apps/sdk-status.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type {
  AuthenticatedContext,
  Input,
} from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { readSdkStatus, type SdkStatusDeps } from "./status.ts";

// 기록과 call을 내는 core 안 machine 자격이다(기동 때 ledger에 기록한다: wiring/apps.ts).
export const SDK_REVIEW_PRINCIPAL = "machine:sdk-review";
export const SDK_REVIEW_CONTEXT: AuthenticatedContext = {
  principal: SDK_REVIEW_PRINCIPAL,
  actor: "machine",
  scope: { operations: [appSdkReviewRecord.name], targets: {} },
  conditions: {},
  credential_ref: SDK_REVIEW_PRINCIPAL,
};

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
