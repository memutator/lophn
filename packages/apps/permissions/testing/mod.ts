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
import { DatabaseSync } from "node:sqlite";
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
  type ReadSnapshot,
  type SchemaStep,
  TargetAuthorization,
} from "../../../contracts/platform/mod.ts";
import { appsSchemaSteps } from "../../registration/mod.ts";
import {
  type AppDeclarations,
  type CurrentDeclarations,
  currentDeclarations,
} from "../declarations.ts";
import { permissionsSchemaSteps } from "../schema.ts";

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

// tx port와 reader port가 같은 구현을 쓴다. 구현은 부른 쪽의 sql을 받아 시험 표를 읽는다.
export const declarationsFixture: CurrentDeclarations = {
  get(sql, app) {
    const row = sql.get(
      "SELECT body FROM permissions_test_declarations WHERE app = ?",
      [app],
    );
    if (row === undefined) return ok(null);
    return ok(JSON.parse(String(row.body)) as AppDeclarations | null);
  },
};

export function createLedgerRegistration() {
  return {
    schemaSteps,
    commands: [setDeclarationsCommand, activationCommand],
    ports: [{
      key: currentDeclarations,
      create: () => declarationsFixture,
    }],
  };
}

// read handler를 ledger 없이 부르는 snapshot이다. 실제 apps·grants·시험 선언 표(실제
// schema)를 가진 메모리 DB를 읽고, 대상 권한 port는 모두 허용한다. 선언 port는 reader
// registration의 고정 값처럼 주입한다(withDeclarations=false면 등록하지 않은 core와 같다).
export function createGrantSnapshot(options: {
  withDeclarations: boolean;
}): {
  snapshot: ReadSnapshot;
  db: DatabaseSync;
  close(): void;
} {
  const db = new DatabaseSync(":memory:");
  for (const step of appsSchemaSteps) db.exec(step.sql);
  for (const step of permissionsSchemaSteps) db.exec(step.sql);
  for (const step of schemaSteps) db.exec(step.sql);
  const snapshot: ReadSnapshot = {
    as_of_seq: "7",
    sql: {
      get: (sql, params) =>
        db.prepare(sql).get(...(params as never[])) as never,
      all: (sql, params) =>
        db.prepare(sql).all(...(params as never[])) as never,
    },
    port: ((key: { name: string }) => {
      if (key.name === TargetAuthorization.name) {
        return () => ({ ok: true as const, value: undefined });
      }
      if (options.withDeclarations && key.name === currentDeclarations.name) {
        return declarationsFixture;
      }
      throw new Error("unregistered read port");
    }) as ReadSnapshot["port"],
  };
  return { snapshot, db, close: () => db.close() };
}
