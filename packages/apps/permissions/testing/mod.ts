/**
 * apps/permissions의 team-brief testing fixture다. mod.ts에서 내보내지 않는다.
 *
 * releases 조립(apps#T18·T19)이 들어오기 전에는 현재 release의 선언과 activation event를 낼
 * 주체가 없다. 이 fixture는 그 둘만 writer transaction 안에서 남기는 시험 전용 team이다.
 * 선언은 `currentDeclarations` port의 실제 구현으로 시험 표에서 읽는다. grant command와 read는
 * 제품 등록(apps/core/apps.ts) 그대로 쓴다.
 *
 * ```ts
 * const opened = await createCoreHarness({
 *   teams: [appsTeam, permissionsFixtures],
 *   teamModules: [appsUrl, new URL("./testing/mod.ts", import.meta.url).href],
 * });
 * ```
 */
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import {
  releaseActivated,
  releaseActivationFailed,
  releaseActivationStarted,
} from "../../../contracts/apps/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
  type SchemaStep,
  type Tx,
} from "../../../contracts/platform/mod.ts";
import { type AppDeclarations, currentDeclarations } from "../declarations.ts";

const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const APR = "apr_01h455vb4pex5v6nkc6gd5fdw1";

export const setDeclarations = defineCommand({
  resource: "permissions_tests",
  method: "set_declarations",
  name: "permissions.tests.set_declarations",
  input: z.strictObject({
    app: z.string(),
    declarations: z.record(z.string(), z.unknown()).nullable(),
  }),
  output: z.object({ stored: z.boolean() }),
  actors: ["machine"],
  errors: [],
});

export const activation = defineCommand({
  resource: "permissions_tests",
  method: "activation",
  name: "permissions.tests.activation",
  input: z.strictObject({
    app: z.string(),
    phase: z.enum(["start", "succeed", "fail"]),
    // succeed·fail이 가리키는 시작 event seq.
    started_seq: z.string().optional(),
  }),
  output: z.object({ seq: z.string() }),
  actors: ["machine"],
  errors: [],
});

const setDeclarationsCommand: CommandDefinition<typeof setDeclarations> = {
  route: setDeclarations,
  handle(tx, _ctx, input) {
    tx.sql.run(
      `INSERT INTO permissions_test_declarations (app, body) VALUES (?, ?)
       ON CONFLICT(app) DO UPDATE SET body = excluded.body`,
      [input.app, JSON.stringify(input.declarations)],
    );
    return ok({ stored: true });
  },
};

const activationCommand: CommandDefinition<typeof activation> = {
  route: activation,
  handle(tx, _ctx, input) {
    if (input.phase === "start") {
      const seq = tx.emit(releaseActivationStarted, REL, {
        app: input.app,
        started_seq: "1",
        previous_release: null,
        approval: APR,
        expected_grants_seq: 0,
        expected_schema: 0,
      });
      return ok({ seq });
    }
    if (input.started_seq === undefined) {
      return err({ code: "invalid_input", message: "started_seq is required" });
    }
    if (input.phase === "succeed") {
      const seq = tx.emit(releaseActivated, REL, {
        started_seq: input.started_seq,
        previous_release: null,
        data_schema: 0,
      });
      return ok({ seq });
    }
    const seq = tx.emit(releaseActivationFailed, REL, {
      started_seq: input.started_seq,
      failure: { code: "test", summary: "fixture failure" },
    });
    return ok({ seq });
  },
};

const schemaSteps: readonly SchemaStep[] = [{
  id: "apps.permissions.testing.declarations",
  sql: `CREATE TABLE permissions_test_declarations (
    app TEXT PRIMARY KEY NOT NULL,
    body TEXT NOT NULL
  ) STRICT;`,
}];

export function createLedgerRegistration() {
  return {
    schemaSteps,
    commands: [setDeclarationsCommand, activationCommand],
    ports: [{
      key: currentDeclarations,
      create: (tx: Pick<Tx, "sql">) => ({
        get(app: string) {
          const row = tx.sql.get(
            "SELECT body FROM permissions_test_declarations WHERE app = ?",
            [app],
          );
          if (row === undefined) return ok(null);
          return ok(JSON.parse(String(row.body)) as AppDeclarations | null);
        },
      }),
    }],
  };
}
