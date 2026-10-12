/**
 * apps/runtime의 team-brief testing fixture다. mod.ts에서 내보내지 않는다.
 *
 * runtime 표현은 ledger에 저장하지 않는다(domain-model apps/runtime). 테스트
 * 흐름에 필요한 관측 준비는 이 fixture가 writer transaction 안에서 남긴다.
 *
 * ```ts
 * const opened = await createLedgerHarness({
 *   registrationModules: [documents, registration, runtimeFixtures],
 *   credentials: [user, machine],
 * });
 * // active_release 기입:
 * await opened.command(machine, envelope("runtime.tests.adopt_release", {
 *   app: id, release,
 * }));
 * ```
 * record_*는 supervisor 관측 사실의 기록이므로 여기 남기지 않는다.
 */
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ok } from "../../../../base/mod.ts";
import type { App } from "../../../../protocol/apps/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
  type ReadSnapshot,
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../../protocol/platform/mod.ts";
import { appsSchemaSteps } from "../../registration/mod.ts";

export const adoptRelease = defineCommand({
  resource: "runtime",
  method: "adopt-release",
  name: "runtime.tests.adopt_release",
  input: z.object({ app: z.string(), release: z.string() }),
  output: z.object({ adopted: z.boolean() }),
  actors: ["user", "machine"],
  errors: [],
});

// probeWrite는 rollback되므로 원본 표 기록은 writer transaction 안에서
// dispatch하는 이 fixture command로 남긴다(R2).
const adoptReleaseCommand: CommandDefinition<typeof adoptRelease> = {
  route: adoptRelease,
  handle(tx: Tx, _ctx, input) {
    // active_release는 releases 조립이 채택한다. 가져온 release를 기록한다.
    tx.sql.run("UPDATE apps SET active_release = ? WHERE id = ?", [
      input.release,
      input.app,
    ]);
    return ok({ adopted: true });
  },
};

export { adoptReleaseCommand };

// public harness는 이 함수를 부른다. fixture command만 등록한다.
export function createLedgerTestRegistration() {
  return {
    testCommands: [adoptReleaseCommand],
  };
}

// core harness(createCoreHarness)가 같은 fixture command를 등록하는 입구다.
export function createLedgerRegistration() {
  return { commands: [adoptReleaseCommand] };
}

// read handler를 ledger 없이 부르는 snapshot이다. 실제 apps 표(실제 schema)에 App 하나를
// 넣은 메모리 DB를 읽고, 대상 권한 port는 요청 신원이 같은 앱이면 허용한다.
export function createAppSnapshot(
  app: App,
  allow: (ctx: RequestContext) => boolean = () => true,
): { snapshot: ReadSnapshot; close(): void } {
  const db = new DatabaseSync(":memory:");
  for (const step of appsSchemaSteps) db.exec(step.sql);
  db.prepare(
    `INSERT INTO apps (id, slug, name, description, planning_version, source_path,
       active_release, run_enabled, revision, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    app.id,
    app.slug,
    app.name,
    app.description,
    app.planning_version,
    app.source_path,
    app.active_release,
    app.run_enabled ? 1 : 0,
    app.revision,
    app.status,
  );
  const snapshot: ReadSnapshot = {
    as_of_seq: "7",
    sql: {
      get: (sql, params) =>
        db.prepare(sql).get(...(params as never[])) as never,
      all: (sql, params) =>
        db.prepare(sql).all(...(params as never[])) as never,
    },
    port: ((key: { name: string }) => {
      if (key.name !== TargetAuthorization.name) {
        throw new Error(`unexpected port ${key.name}`);
      }
      return (ctx: RequestContext) => {
        return allow(ctx) ? { ok: true as const, value: undefined } : {
          ok: false as const,
          error: { code: "not_found", message: "app not found" },
        };
      };
    }) as ReadSnapshot["port"],
  };
  return { snapshot, close: () => db.close() };
}

// apps/invocations의 시험이 앱 runtime entrypoint를 실제로 돌릴 때 쓰는 준비다.
export { createConfirmMarkers } from "../entrypoint/confirm-marker.ts";
export { handleInvoke } from "../entrypoint/invoke.ts";
export { startRuntime } from "../entrypoint/startup.ts";
export { startDirectServer } from "../entrypoint/direct-server.ts";
export type { BrokerTransport } from "../entrypoint/broker-client.ts";
export type { AppConnection } from "../entrypoint/wire.ts";
export {
  APP,
  connection,
  installHandlers,
  NONCE,
  REL,
  shaKey,
  startLine,
} from "../entrypoint/testing.ts";

// 실제 앱 자식 프로세스 fixture. 다른 leaf의 시험(apps/connections)이 앱 쌍 호출에 쓰고,
// preview·test 시험이 실제 앱 자식과 같은 bundle을 만드는 입구다.
export {
  COMMANDS,
  FIXTURE_APP,
  FIXTURE_RELEASE,
  type FixtureApp,
  fixtureBlueprint,
  SCREENS,
  startFixtureApp,
  writeFixtureBundle,
} from "./app-process.ts";
