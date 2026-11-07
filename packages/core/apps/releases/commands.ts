// `release.record`: core가 준비와 검사를 마친 봉인 사본에서 모은 입력만 불변 prepared Release로 확정한다.
// machine만 부른다: 부르는 곳은 core의 `release.prepare` handler 하나이고, 검사에 떨어진 준비는 이 command까지
// 오지 않아 release 행을 남기지 않는다. 같은 bundle의 prepared release가 이미 있으면 새로 만들지 않고 그것을 준다.
// activation 쪽 command는 activation driver가 machine 자격으로 순서대로 부른다(activation/assembly.ts).
import { textBlocks } from "../../../protocol/lophn-agent/content-block.ts";
import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  activationActivatePrevious,
  activationAskConsent,
  type ActivationAttempt,
  activationComplete,
  activationConsent,
  type ActivationDataResult,
  activationFail,
  activationReport,
  activationStart,
  appSchema,
  type ReadyAttestation,
  type ReleaseRecord,
  releaseRecord,
  releaseRecordSchema,
} from "../../../protocol/apps/mod.ts";
import { canonicalJson, validateDeclaration } from "../declaration/mod.ts";
import { missingSdkPermission } from "./sdk-permissions.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { routerFor } from "../../router/mod.ts";

import {
  appAccessDenied,
  authorizeApp,
  loadApp,
  replaceApp,
} from "../registration/mod.ts";
import {
  type AttemptGate,
  createDataRecordStore,
  discardBackups,
} from "../data/mod.ts";
import { recordProgramNotice, releaseNameOf } from "../notices/mod.ts";
import { syncAppGrants } from "../permissions/mod.ts";
import { manifestBytes } from "./bundle/manifest.ts";
import { factsOfDeclaration } from "./facts.ts";
import { removedPublicSkillsOf, removedPublicToolsOf } from "./public-tools.ts";
import {
  findPreparedRelease,
  insertRelease,
  loadActiveRelease,
  loadRelease,
  loadStoredDeclaration,
  nextReleaseNumber,
} from "./store.ts";
import { inProgress, storeActivation } from "./activation/state.ts";
import {
  bundledShare,
  pushConsentEvent,
  waitingConsents,
} from "./activation/consents.ts";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 없는 앱과 범위 밖 앱은 같은 답이다.
function unreachableTarget(): Result<never> {
  return err({ code: "forbidden", message: "release target is not available" });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// release의 앱을 읽고 이 command를 낼 자격이 있는지 본다. 없는 release·없는 앱·범위 밖 앱은 같은 답이다.
function releaseAndApp(
  tx: Pick<Tx, "sql" | "port">,
  ctx: RequestContext,
  operation: string,
  releaseId: string,
  absent: () => Result<never>,
): Result<{
  release: ReleaseRecord;
  app: NonNullable<
    ReturnType<typeof loadApp> extends Result<infer A> ? A : never
  >;
}> {
  const found = loadRelease(tx.sql, releaseId);
  if (!found.ok) return found;
  if (found.value === null) return absent();
  const app = loadApp(tx.sql, found.value.app);
  if (!app.ok) return app;
  if (app.value === null) return absent();
  const access = authorizeApp(tx, ctx, operation, {
    kind: "command",
    before: app.value,
    after: app.value,
  });
  if (!access.ok) return appAccessDenied(access) ? absent() : access;
  return ok({ release: found.value, app: app.value });
}

// 앱 grant를 맞추는 새 revision이다. 이름·설명이 바뀌므로 revision도 바꾸어 CAS가 변경을 보게 한다.
// 이미 지난 event seq를 쓰면 앞으로 낼 event의 seq와 겹치지 않는다.
function nextRevision(tx: Pick<Tx, "sql">, current: string): string {
  const head = BigInt(
    String(
      tx.sql.get("SELECT COALESCE(MAX(seq), 0) AS head FROM events", [])
        ?.head ?? 0,
    ),
  );
  const now = BigInt(current);
  return String(head > now ? head : now + 1n);
}

function activationReportText(release: ReleaseRecord, appName: string): string {
  const head = `Release ${release.number} (${release.id}) of the app ${appName}`;
  if (release.status === "active") {
    return `${head} is now active. Tell the person.`;
  }
  const failure = release.failure;
  const lines = [
    `${head} failed to activate: ${failure?.code ?? "unknown"}: ${failure?.summary ?? ""}`,
  ];
  if (failure?.restored === true) {
    lines.push("The previous release is running again.");
  }
  lines.push("Tell the person what failed and how you would fix it.");
  return lines.join("\n");
}

// 한 앱에 activation이 진행 중이면 그 release다.
function activatingOf(tx: Pick<Tx, "sql">, app: string): string | null {
  const row = tx.sql.get(
    "SELECT id FROM releases WHERE app = ? AND status = 'activating'",
    [app],
  );
  return row === undefined ? null : String(row.id);
}

export function createReleaseCommands(): {
  record: CommandDefinition<typeof releaseRecord>;
  startActivation: CommandDefinition<typeof activationStart>;
  completeActivation: CommandDefinition<typeof activationComplete>;
  failActivation: CommandDefinition<typeof activationFail>;
  reportActivation: CommandDefinition<typeof activationReport>;
  activatePrevious: CommandDefinition<typeof activationActivatePrevious>;
  askConsent: CommandDefinition<typeof activationAskConsent>;
  consent: CommandDefinition<typeof activationConsent>;
} {
  return {
    // activation 시작. `release.activate`나 동의 뒤 sweep이 시작한 앱의 activation에서 driver가 machine 자격으로 부른다.
    // 시작 때는 CAS를 하지 않는다: 무엇을 activate하는지는 시작을 정할 때 정해졌고, 데이터의 실제 상태는
    // 종료를 확인한 뒤 읽는다. 앱마다 시도는 하나다.
    startActivation: {
      route: activationStart,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, "activation.start");
        if (!actor.ok) return actor;
        const found = releaseAndApp(
          tx,
          ctx,
          activationStart.name,
          input.release,
          unreachableTarget,
        );
        if (!found.ok) return found;
        const { release, app } = found.value;
        if (app.status === "archived") {
          return conflict("archived app cannot activate a release");
        }
        if (release.status !== "prepared" && release.status !== "superseded") {
          return conflict("the release cannot be activated from its status");
        }
        if (activatingOf(tx, release.app) !== null) {
          return conflict("an activation is in progress for the app");
        }
        const active = loadActiveRelease(tx.sql, release.app);
        if (!active.ok) return active;
        // 이전 release로 돌아가기는 데이터를 바꾸지 않는 release만이다.
        if (
          release.status === "superseded" &&
          active.value?.data_schema !== release.data_schema
        ) {
          return invalid("the data schema differs from the active release");
        }
        const activation: ActivationAttempt = {
          attempt: tx.newId("act"),
          previous_release: active.value?.id ?? null,
          backup_hash: null,
          data_change_invocation: null,
          started_at: tx.now(),
        };
        storeActivation(tx, release.id, "activating", activation, null);
        tx.sql.run("DELETE FROM activation_requests WHERE release = ?", [
          release.id,
        ]);
        // 더 새 release의 activation이 시작됐으니 이 앱의 동의 줄은 모두 닫는다(허락한 줄도 시작하지 못한다).
        for (const waiting of waitingConsents(tx.sql, release.app)) {
          pushConsentEvent(tx, {
            type: "ActivationConsentClosed",
            app: waiting.app,
            release: waiting.release,
            outcome: "cancelled",
          });
        }
        tx.sql.run("DELETE FROM activation_consents WHERE app = ?", [
          release.app,
        ]);
        return ok({
          attempt: activation.attempt,
          previous_release: activation.previous_release,
        });
      },
    },
    // activation 확정. 같은 시도와 실제 데이터 결과·준비 확인(hash·handler·schema)을 확인한 뒤 새 active 참조,
    // 이전 superseded, 앱 이름·설명 갱신(첫 성공은 run_enabled), 앱 grant 맞추기, 복구본 정리를 한 transaction으로
    // 바꾼다. 응답을 잃은 재전송은 같은 결과를 돌려준다. 성공은 event가 아니다.
    completeActivation: {
      route: activationComplete,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, "activation.complete");
        if (!actor.ok) return actor;
        // 없는 release·범위 밖 앱·다른 시도는 같은 답이다.
        const absent = () => conflict("no such activation is in progress");
        const found = releaseAndApp(
          tx,
          ctx,
          activationComplete.name,
          input.release,
          absent,
        );
        if (!found.ok) return found;
        const { app } = found.value;
        const finished = found.value.release;
        if (
          finished.status === "active" &&
          finished.activation?.attempt === input.attempt
        ) {
          return ok({
            status: "active" as const,
            previous_release: finished.activation.previous_release,
          });
        }
        const progress = inProgress(finished, input.attempt);
        if (!progress.ok) return progress;
        const release = progress.value;
        const activation = release.activation;
        const active = loadActiveRelease(tx.sql, release.app);
        if (!active.ok) return active;
        if ((active.value?.id ?? null) !== activation.previous_release) {
          return conflict("the current release changed");
        }
        const stored = loadStoredDeclaration(tx.sql, release.id);
        if (!stored.ok) return stored;
        if (stored.value === null) return absent();
        const proven = checkReady(tx, release, activation, input, stored.value);
        if (!proven.ok) return proven;
        const at = tx.now();
        const nextApp = {
          ...app,
          name: stored.value.declaration.name,
          description: stored.value.declaration.description,
          active_release: release.id,
          // 첫 성공만 실행을 허용한다. 사람이 멈춘 앱의 다음 release가 실행 허용을 되돌리지 않는다.
          run_enabled: active.value === null ? true : app.run_enabled,
          revision: nextRevision(tx, app.revision),
        };
        if (active.value !== null) {
          storeActivation(
            tx,
            active.value.id,
            "superseded",
            active.value.activation,
            active.value.failure,
          );
        }
        storeActivation(tx, release.id, "active", activation, null, at);
        const next = appSchema.safeParse(nextApp);
        if (!next.success) {
          return unavailable("declaration name and description are not valid");
        }
        const replaced = replaceApp(tx, next.data);
        if (!replaced.ok) return replaced;
        // 시작은 Gate가 묻지 않았거나 사람이 허락한 경우뿐이라 늘어난 선언에 grant를 만들 수 있다.
        // 새 선언이 더는 요구하지 않는 grant는 거둔다(앱 grant는 새 선언과의 교집합).
        const synced = syncAppGrants(
          tx,
          release.app,
          stored.value.facts,
          "granted",
        );
        if (!synced.ok) return synced;
        // 복구본은 필요 없다. 기다리던 이전으로 돌아가기 요청도 이 앱의 지금 상태에서는 낡았다.
        const discarded = discardBackups(tx, release.app);
        if (!discarded.ok) return discarded;
        tx.sql.run(
          `DELETE FROM activation_requests
            WHERE release IN (SELECT id FROM releases WHERE app = ?)`,
          [release.app],
        );
        // 이미 켜졌던 release를 다시 켠 것은 사람이 이전으로 돌아간 것이다(release 번호는 새로 매기지 않는다).
        const before = active.value;
        const noted = recordProgramNotice(
          tx,
          release.activated_at !== null && before !== null
            ? {
                kind: "release_rolled_back",
                app: release.app,
                params: {
                  release: releaseNameOf(tx, before.id),
                  to: releaseNameOf(tx, release.id),
                },
              }
            : {
                kind: "release_activated",
                app: release.app,
                params: { release: releaseNameOf(tx, release.id) },
              },
        );
        if (!noted.ok) return noted;
        return ok({
          status: "active" as const,
          previous_release: activation.previous_release,
        });
      },
    },
    // activation 실패. 실패 근거와 이전 활성 참조를 남긴다.
    // 데이터가 바뀌었을 수 있는 시도(backup 확정)는 복원 결과가 있어야 실패로 닫는다.
    failActivation: {
      route: activationFail,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, "activation.fail");
        if (!actor.ok) return actor;
        const absent = () => conflict("no such activation is in progress");
        const found = releaseAndApp(
          tx,
          ctx,
          activationFail.name,
          input.release,
          absent,
        );
        if (!found.ok) return found;
        if (
          found.value.release.status === "failed" &&
          found.value.release.activation?.attempt === input.attempt
        ) {
          return ok({ status: "failed" as const });
        }
        const progress = inProgress(found.value.release, input.attempt);
        if (!progress.ok) return progress;
        const release = progress.value;
        const records = createDataRecordStore(tx);
        if (
          release.activation.backup_hash !== null &&
          records.find(release.id, input.attempt, "restore") === null
        ) {
          return conflict("the backed up data is not restored");
        }
        const activation: ActivationAttempt = {
          ...release.activation,
          data_change_invocation:
            input.invocation ?? release.activation.data_change_invocation,
        };
        storeActivation(tx, release.id, "failed", activation, input.failure);
        tx.sql.run("DELETE FROM activation_requests WHERE release = ?", [
          release.id,
        ]);
        // 복원한 실패는 앱이 이전 release로 돌아갔다는 말까지 한 행에 싣는다(실패 하나에 행 하나).
        const back =
          input.failure.restored === true &&
          release.activation.previous_release !== null
            ? ` The app is back on release ${releaseNameOf(tx, release.activation.previous_release)}.`
            : "";
        const noted = recordProgramNotice(tx, {
          kind: "release_failed",
          app: release.app,
          params: {
            release: releaseNameOf(tx, release.id),
            reason: `${input.failure.summary.slice(0, 200 - back.length).trim()}${back}`,
          },
        });
        if (!noted.ok) return noted;
        return ok({ status: "failed" as const });
      },
    },
    // 끝난 activation의 결과를 release를 만든 agent session에 notice로 넣는다. 동의 뒤의 시작은 그 session의
    // turn이 이미 끝난 뒤라, 알리지 않으면 agent는 실패도 그 이유도 모른 채 사람에게 아무 말도 못 한다.
    reportActivation: {
      route: activationReport,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, activationReport.name);
        if (!actor.ok) return actor;
        const found = releaseAndApp(
          tx,
          ctx,
          activationReport.name,
          input.release,
          () => conflict("no such release"),
        );
        if (!found.ok) return found;
        const { release, app } = found.value;
        if (release.status !== "active" && release.status !== "failed") {
          return conflict("the activation has not finished");
        }
        const creator = parseActor(release.created_by);
        if (creator?.kind !== "agent") return ok({ delivered: false });
        const router = routerFor(tx);
        if (!router.ok) return router;
        const routed = router.value.route(tx, {
          from: { kind: "program" },
          to: { session: creator.id },
          reply: "none",
          body: textBlocks(activationReportText(release, app.name)),
          refs: [],
          reply_to: null,
          dedup: null,
          kind: "notice",
          delivery: "next_turn",
          notice: "activation_finished",
        });
        if (!routed.ok) return routed;
        return ok({ delivered: routed.value.state !== "failed" });
      },
    },
    // 이전 release로 돌아가기. 사람만 한다. 지금 활성 release와 data schema가 같은 superseded release만 받는다.
    // 요청만 남기고 시작하는 일은 driver가 한다(commit 뒤 hook이 없다).
    activatePrevious: {
      route: activationActivatePrevious,
      handle(tx, ctx, input) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return err({
            code: "forbidden",
            message: "only the user goes back to an earlier release",
          });
        }
        const found = releaseAndApp(
          tx,
          ctx,
          activationActivatePrevious.name,
          input.release,
          unreachableTarget,
        );
        if (!found.ok) return found;
        const { release, app } = found.value;
        if (app.status === "archived") {
          return conflict("archived app cannot activate a release");
        }
        if (release.status !== "superseded") {
          return invalid("only a superseded release can be activated again");
        }
        const active = loadActiveRelease(tx.sql, release.app);
        if (!active.ok) return active;
        if (active.value?.data_schema !== release.data_schema) {
          return invalid("the data schema differs from the active release");
        }
        if (activatingOf(tx, release.app) !== null) {
          return conflict("an activation is in progress for the app");
        }
        tx.sql.run(
          `INSERT INTO activation_requests (release, requested_at)
           VALUES (?, ?) ON CONFLICT (release) DO NOTHING`,
          [release.id, tx.now()],
        );
        return ok({});
      },
    },
    // 동의 묻기. machine만 한다(`release.activate`가 driver를 지나 부른다). 같은 release는 줄 하나라서 같은 비교로 다시 부르면
    // 아무것도 바꾸지 않는다(허락한 줄도 그대로). 비교가 달라졌으면 줄을 덮어 다시 사람을 기다린다.
    askConsent: {
      route: activationAskConsent,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, "activation.ask_consent");
        if (!actor.ok) return actor;
        const found = releaseAndApp(
          tx,
          ctx,
          activationAskConsent.name,
          input.release,
          unreachableTarget,
        );
        if (!found.ok) return found;
        const { release, app } = found.value;
        if (release.status !== "prepared") {
          return conflict("only a prepared release waits for consent");
        }
        const comparison = canonicalize(input.comparison);
        const existing = tx.sql.get(
          "SELECT comparison FROM activation_consents WHERE release = ?",
          [release.id],
        );
        if (
          existing !== undefined &&
          String(existing.comparison) === comparison
        ) {
          return ok({ created: false });
        }
        tx.sql.run(
          `INSERT INTO activation_consents (release, app, comparison, requested_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (release) DO UPDATE SET comparison = excluded.comparison,
             requested_at = excluded.requested_at, allowed_at = NULL`,
          [release.id, release.app, comparison, tx.now()],
        );
        pushConsentEvent(tx, {
          type: "ActivationConsentRequested",
          app: release.app,
          app_name: app.name,
          release: release.id,
        });
        return ok({ created: true });
      },
    },
    // 동의. 사람만 한다. 허락은 표에 남기고 시작은 driver가 한다. 같이 본 공유 요청이 있으면 같은 tx에서 승인한다. 거절은 줄을 지우고 release는 prepared로 남는다.
    // compare의 requested_at이 지금 대기와 다르면 사람이 본 것이 아니다(그 사이 다시 물었다).
    consent: {
      route: activationConsent,
      handle(tx, ctx, input, compare) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return err({
            code: "forbidden",
            message: "only the user consents to an activation",
          });
        }
        const found = releaseAndApp(
          tx,
          ctx,
          activationConsent.name,
          input.release,
          unreachableTarget,
        );
        if (!found.ok) return found;
        const { release } = found.value;
        const waiting = tx.sql.get(
          `SELECT requested_at FROM activation_consents
            WHERE release = ? AND allowed_at IS NULL`,
          [release.id],
        );
        if (
          waiting === undefined ||
          String(waiting.requested_at) !== compare.requested_at
        ) {
          return conflict("the consent is already decided or closed");
        }
        if (input.choice === "allow") {
          // 공유가 먼저다: 공유가 실패하면 tx째 되돌아가 동의는 대기로 남고 사람이 다시 누를 수 있다.
          if (input.share_requested_at !== undefined) {
            const shared = tx
              .port(bundledShare)
              .approve(release.app, input.share_requested_at);
            if (!shared.ok) return shared;
          }
          tx.sql.run(
            "UPDATE activation_consents SET allowed_at = ? WHERE release = ?",
            [tx.now(), release.id],
          );
        } else {
          tx.sql.run("DELETE FROM activation_consents WHERE release = ?", [
            release.id,
          ]);
        }
        pushConsentEvent(tx, {
          type: "ActivationConsentClosed",
          app: release.app,
          release: release.id,
          outcome: input.choice,
        });
        return ok({ release: release.id, outcome: input.choice });
      },
    },
    record: {
      route: releaseRecord,
      handle(tx, ctx, input) {
        const actor = requireMachine(ctx, releaseRecord.name);
        if (!actor.ok) return actor;
        const app = loadApp(tx.sql, input.app);
        if (!app.ok) return app;
        if (app.value === null) return unreachableTarget();
        const access = authorizeApp(tx, ctx, releaseRecord.name, {
          kind: "app",
          app: app.value,
        });
        if (appAccessDenied(access)) return unreachableTarget();
        if (!access.ok) return access;
        if (app.value.status === "archived") {
          return conflict("archived app cannot prepare a release");
        }
        // 정규 선언은 검증기를 통과한 것만 hash로 고정한다.
        const validated = validateDeclaration(input.declaration, {
          app: input.app,
          slug: app.value.slug,
        });
        if (!validated.ok) return invalid(validated.error.message);
        const declaration = validated.value;
        const canonical = canonicalJson(declaration as never);
        if (sha256(canonical) !== input.declaration_hash) {
          return invalid("declaration does not match its hash");
        }
        // bundle 안 manifest가 실제로 이 선언과 이 hash를 가리켜야 한다.
        const manifest = input.manifest;
        if (
          sha256(new TextDecoder().decode(manifestBytes(manifest))) !==
          input.bundle_hash
        ) {
          return invalid("manifest does not match the bundle hash");
        }
        const pinned = manifest.files.find(
          (file) => file.path === "declaration.json",
        );
        if (pinned?.hash !== input.declaration_hash) {
          return invalid(
            "bundle declaration.json does not match the declaration",
          );
        }
        // 선언에는 SDK와 사용자 package만 적는다(npm·jsr은 선언 문법이 없다). bundle에 담긴 그 둘이 선언과 같아야 한다.
        if (
          canonicalJson(declaration.sdk_dependencies as never) !==
          canonicalJson(manifestDependencies(manifest) as never)
        ) {
          return invalid("manifest dependencies differ from the declaration");
        }
        const missing = missingSdkPermission(declaration);
        if (missing !== undefined) {
          return err({
            code: "invalid_input",
            message: missing.message,
            details: {
              package: missing.package,
              permissions: [...missing.permissions],
            },
          });
        }
        const chain = checkDataChanges(input.data_changes, input.data_schema);
        if (!chain.ok) return chain;
        const removedPublic = () => {
          const tools = removedPublicToolsOf(
            tx,
            input.app,
            declaration.commands,
          );
          if (!tools.ok) return tools;
          const skills = removedPublicSkillsOf(
            tx,
            input.app,
            declaration.skills ?? [],
          );
          if (!skills.ok) return skills;
          return ok({
            removed_public_tools: tools.value,
            removed_public_skills: skills.value,
          });
        };
        const existing = findPreparedRelease(
          tx.sql,
          input.app,
          input.bundle_hash,
        );
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          const removed = removedPublic();
          if (!removed.ok) return removed;
          return ok({ release: existing.value, ...removed.value });
        }
        const id = tx.newId("rel");
        const facts = factsOfDeclaration(id, declaration);
        if (facts === undefined) {
          return invalid("declaration facts are not valid");
        }
        const release = releaseRecordSchema.safeParse({
          id,
          app: input.app,
          number: nextReleaseNumber(tx.sql, input.app),
          code_commit: input.commit,
          bundle_hash: input.bundle_hash,
          declaration_hash: input.declaration_hash,
          data_schema: input.data_schema,
          data_changes: input.data_changes,
          created_by: input.created_by,
          created_at: tx.now(),
          status: "prepared",
          activation: null,
          activated_at: null,
          failure: null,
        });
        if (!release.success) return invalid("invalid release");
        insertRelease(tx, release.data, canonical, facts);
        const removed = removedPublic();
        if (!removed.ok) return removed;
        return ok({ release: release.data, ...removed.value });
      },
    },
  };
}

function requireMachine(ctx: RequestContext, route: string): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine"
    ? ok(undefined)
    : err({ code: "forbidden", message: `${route} is machine only` });
}

// bundle에 담긴 의존 가운데 선언에 적힌 것(SDK와 사용자 package)이다. 이름순으로 낸다.
function manifestDependencies(manifest: {
  sdk_dependencies: readonly { name: string; version: string }[];
  dependencies: readonly {
    name: string;
    version: string;
    source: "sdk" | "package" | "npm" | "jsr";
  }[];
}): { name: string; version: string }[] {
  const byName = new Map<string, { name: string; version: string }>();
  for (const dependency of [
    ...manifest.sdk_dependencies,
    ...manifest.dependencies.filter(
      (item) => item.source === "sdk" || item.source === "package",
    ),
  ]) {
    byName.set(dependency.name, {
      name: dependency.name,
      version: dependency.version,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// migration 단계는 끊김 없이 이어지고 마지막 도착이 release의 schema다.
function checkDataChanges(
  changes: readonly { from: number; to: number }[],
  dataSchema: number,
): Result<void> {
  for (let index = 1; index < changes.length; index++) {
    if (changes[index].from !== changes[index - 1].to) {
      return invalid("data changes are not a continuous path");
    }
  }
  if (changes.length > 0 && changes[changes.length - 1].to !== dataSchema) {
    return invalid("data changes do not end at the data schema");
  }
  return ok(undefined);
}

// complete가 확인하는 실제 데이터 결과와 준비 확인이다. hash·handler·schema·연결이 하나라도
// 맞지 않으면 채택하지 않는다. 데이터를 바꾼 시도는 backup 확정과 변경 결과가 ledger에 있어야 하고,
// 바꾸지 않은 시도는 변경 결과가 없어야 한다.
function checkReady(
  tx: Pick<Tx, "sql">,
  release: ReleaseRecord,
  activation: ActivationAttempt,
  input: {
    result: ActivationDataResult;
    attestation: ReadyAttestation;
  },
  stored: { facts: { tools: readonly string[] } },
): Result<void> {
  const { result, attestation } = input;
  if (result.release !== release.id || result.attempt !== activation.attempt) {
    return conflict("the data result is for another activation");
  }
  if (!result.integrity_ok || result.data_schema !== release.data_schema) {
    return unavailable("the app data is not at the release schema");
  }
  const records = createDataRecordStore(tx);
  const change = records.find(release.id, activation.attempt, "change");
  const backup = records.find(release.id, activation.attempt, "backup");
  const recorded =
    change === null
      ? result.invocation === null
      : backup !== null &&
        change.dataSchema === release.data_schema &&
        result.invocation === change.invocation;
  if (!recorded) {
    return unavailable("the data change is not recorded");
  }
  const declared = [...stored.facts.tools].sort();
  const reported = [...attestation.tools].sort();
  if (
    attestation.release !== release.id ||
    attestation.bundle_hash !== release.bundle_hash ||
    attestation.data_schema !== release.data_schema ||
    declared.length !== reported.length ||
    declared.some((key, index) => key !== reported[index])
  ) {
    return unavailable("the started app does not match the release");
  }
  return ok(undefined);
}

// record_backup·record_data_change·record_data_restore가 부르는 시도 확인이다. 진행 중인 같은
// 시도의 release만 받는다. 확정한 참조는 그 시도에 남긴다.
export const activationAttemptGate: AttemptGate = {
  check(tx, attempt) {
    const found = loadRelease(tx.sql, attempt.release);
    if (!found.ok) return found;
    const progress = inProgress(found.value, attempt.attempt);
    if (!progress.ok) return progress;
    const release = progress.value;
    // 복구본은 목표보다 앞선 schema의 것이다. 복구본이 필요 없는 시도는 backup을 만들지 않는다.
    if (
      attempt.kind === "backup" &&
      attempt.dataSchema >= release.data_schema
    ) {
      return conflict("the release needs no data change from that schema");
    }
    if (
      attempt.kind === "change" &&
      attempt.dataSchema !== release.data_schema
    ) {
      return conflict("the data is not at the release schema");
    }
    return ok({ app: release.app });
  },
  record(tx, attempt) {
    if (attempt.kind === "restore") return;
    const found = loadRelease(tx.sql, attempt.release);
    if (!found.ok || found.value === null || found.value.activation === null) {
      return;
    }
    const activation: ActivationAttempt = {
      ...found.value.activation,
      ...(attempt.kind === "backup" ? { backup_hash: attempt.backupHash } : {}),
      ...(attempt.kind === "change"
        ? { data_change_invocation: attempt.invocation }
        : {}),
    };
    storeActivation(
      tx,
      attempt.release,
      found.value.status,
      activation,
      found.value.failure,
    );
  },
};
