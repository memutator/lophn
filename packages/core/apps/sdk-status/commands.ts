// 결정 기록과 기능 결과. 기록과 handoff call은 한 tx에서 같이 남거나 같이 남지 않는다.
import { err, ok } from "../../../base/mod.ts";
import {
  appSdkFeature,
  appSdkReviewRecord,
} from "../../../protocol/apps/sdk-status.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { CommandDefinition } from "../../../protocol/server/mod.ts";
import {
  FAILURE_TEXTS,
  failureCode,
  routerEnvironment,
  routerFor,
} from "../../router/mod.ts";
import { appAccessDenied, authorizeApp, loadApp } from "../registration/mod.ts";
import {
  insertFeature,
  insertReview,
  loadFeature,
  setFeatureState,
} from "./review-store.ts";

// handoff를 받을 곳은 그 앱의 lophn이다(private 앱에도 Home lophn의 reply none call은 고정 예외로 닿는다).
const APP_LOPHN = "lophn";

// core 안 machine만 쓴다. 입력의 판·본문은 `appSdkDecide`의 메인 스레드 handler가 program 값으로 채웠다.
const recordReview: CommandDefinition<typeof appSdkReviewRecord> = {
  route: appSdkReviewRecord,
  handle(tx, ctx, input) {
    if (parseActor(ctx.actor)?.kind !== "machine") {
      return err({
        code: "forbidden",
        message: "only core records an SDK review",
      });
    }
    const app = loadApp(tx.sql, input.app);
    if (!app.ok) return app;
    if (app.value === null || app.value.status !== "active") {
      return err({ code: "not_found", message: "app not found" });
    }
    let call: string | null = null;
    if (input.decision === "update") {
      if (input.body === undefined) {
        return err({
          code: "invalid_input",
          message: "an update needs a handoff body",
        });
      }
      const environment = routerEnvironment();
      if (!environment.ok) return environment;
      const router = routerFor(tx);
      if (!router.ok) return router;
      // 호출한 home session의 이름으로 보낸다. call 정책(private 예외 포함)과 명함 검사는 call.send와 같다.
      const routed = router.value.route(tx, {
        from: { kind: "agent", session: input.session },
        to: { agent: APP_LOPHN, workspace: { app: app.value.slug } },
        reply: "none",
        body: input.body,
        refs: [],
        reply_to: null,
        dedup: null,
        kind: "call",
        delivery: "next_turn",
        unattended: environment.value.unattendedTurn(tx, input.turn),
      });
      // 거절이면 오류로 돌려 tx가 되돌아간다: 기록만 남지 않는다.
      if (!routed.ok) return routed;
      const { fail_reason } = routed.value;
      if (routed.value.call === null || fail_reason !== null) {
        const reason = fail_reason ?? "not_found";
        return err({
          code: failureCode(reason),
          message: FAILURE_TEXTS[reason],
        });
      }
      call = routed.value.call;
    } else if (input.features.length > 0) {
      return err({
        code: "invalid_input",
        message: "features belong to an update",
      });
    }
    const review = insertReview(tx, {
      app: input.app,
      session: input.session,
      decision: input.decision,
      through: input.through,
      call,
    });
    const features = input.features.map((feature) => ({
      id: insertFeature(tx, {
        id: feature.id,
        review,
        app: input.app,
        title: feature.title,
        proposal: feature.proposal,
        note: feature.note,
      }),
      title: feature.title,
    }));
    return ok({
      review: review as Id<"sdr">,
      call: call as Id<"cal"> | null,
      features: features.map((one) => ({
        id: one.id as Id<"sdf">,
        title: one.title,
      })),
    });
  },
};

// 앱 lophn이 자기 앱의 기능 결과만 낸다. 없는 기능과 범위 밖 앱의 기능은 같은 답이다.
const recordFeature: CommandDefinition<typeof appSdkFeature> = {
  route: appSdkFeature,
  handle(tx, ctx, input) {
    const feature = loadFeature(tx.sql, input.feature);
    const absent = () =>
      err({ code: "not_found" as const, message: "feature not found" });
    if (feature === undefined) return absent();
    const app = loadApp(tx.sql, feature.app);
    if (!app.ok) return app;
    if (app.value === null) return absent();
    const access = authorizeApp(tx, ctx, appSdkFeature.name, {
      kind: "command",
      before: app.value,
      after: app.value,
    });
    if (!access.ok) return appAccessDenied(access) ? absent() : access;
    setFeatureState(tx, feature.id, input.state, input.note ?? null);
    return ok({ feature: input.feature, state: input.state });
  },
};

export const sdkReviewCommands = { recordReview, recordFeature };
