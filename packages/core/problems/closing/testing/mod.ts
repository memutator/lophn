// problems/closing 시험의 harness 확장 조각. Deno.test는 없다. 조립은 leaf의
// *_test.ts만 한다(code-map: leaf의 testing/은 제품 코드가 import하지 않고 다른
// leaf의 testing fixture는 *_test.ts가 import한다). 확장은 close-verified command,
// verified 근거·활성 release의 줄임 시험 command, 근거 행이 참조하는 앱·release 표다.
// handler가 읽는 problems·verifications·releases·reports 열은 grouping·tests fixture가
// 같은 이름으로 둔다. 문제 seq는 문제 표 subject event에서 읽으므로 시험이 직접 event를 낸다.
import { z } from "zod";
import { ok } from "../../../../base/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
  type Tx,
} from "../../../../protocol/server/mod.ts";
import {
  applyProblemDecisionCommand,
  closeProblemVerifiedCommand,
} from "../mod.ts";

// 실제 RecordVerification이 하는 일의 줄임이다: verified 근거(reproduction pass
// Verification 행)를 원장에 남긴다. 시험이 근거 연결을 만들 때만 쓴다.
export function seedVerificationRow(
  tx: Tx,
  input: {
    id: string;
    problem: string;
    basis_seq: string;
    after_release: string;
    kind?: string;
    result?: string;
    app?: string | null;
  },
): void {
  tx.sql.run(
    `insert into verifications (
       id, request_principal, request_key, request_hash, kind, app,
       target_bundle_hash, target_release, problem, basis_seq,
       before_release, after_release, ticket, test, execution,
       result, reason, observations, recorded_seq, verification_canonical
     ) values (?, 'runner-1', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, 'ran', '{}', '1', '{}')`,
    [
      input.id,
      `key-${input.id}`,
      "f".repeat(64),
      input.kind ?? "reproduction",
      input.app ?? "app_01arz3ndektsv4rrffq69g5fav",
      "e".repeat(64),
      input.after_release,
      input.problem,
      input.basis_seq,
      input.after_release,
      "d".repeat(64),
      "c".repeat(64),
      input.result ?? "pass",
    ],
  );
}

const verify = defineCommand({
  resource: "problems",
  method: "test-verify-record",
  name: "problems.testing.verify",
  input: z.object({
    id: z.string(),
    problem: z.string(),
    basis_seq: z.string(),
    after_release: z.string(),
    kind: z.string().default("reproduction"),
    result: z.string().default("pass"),
    app: z.string().nullable().default(null),
  }),
  output: z.object({ stored: z.boolean() }),
  actors: ["machine"],
  errors: ["not_found"],
});

const verifyCommand: CommandDefinition<typeof verify> = {
  route: verify,
  handle(tx, _ctx, input) {
    seedFixtureRows(tx);
    seedVerificationRow(tx, {
      id: input.id,
      problem: input.problem,
      basis_seq: input.basis_seq,
      after_release: input.after_release,
      kind: input.kind,
      result: input.result,
      app: input.app,
    });
    return ok({ stored: true });
  },
};

// 실제 activation이 하는 일의 줄임이다(releases 조립은 apps 몫이라 시험이 직접 심는다):
// 앱의 채택 참조·status를 같은 transaction에서 바꾼다.
const activate = defineCommand({
  resource: "problems",
  method: "test-activate-release",
  name: "problems.testing.activate",
  input: z.object({ app: z.string(), release: z.string() }),
  output: z.object({ adopted: z.boolean() }),
  actors: ["machine"],
  errors: ["not_found"],
});

const activateCommand: CommandDefinition<typeof activate> = {
  route: activate,
  handle(tx, _ctx, input) {
    seedFixtureRows(tx);
    tx.sql.run(
      "update releases set status = 'superseded' where app = ? and status = 'active'",
      [input.app],
    );
    tx.sql.run("update releases set status = 'active' where id = ?", [
      input.release,
    ]);
    tx.sql.run("update apps set active_release = ? where id = ?", [
      input.release,
      input.app,
    ]);
    return ok({ adopted: true });
  },
};

// 근거 행이 쓰는 release·앱 표의 최소 모양이다. grouping fixture에 없는 표다.
export const FIXTURE_STEP = {
  id: "problems.closing_fixtures",
  sql: `
create table if not exists apps (
  id text primary key,
  slug text not null,
  name text not null,
  active_release text
) strict;
create table if not exists releases (
  id text primary key,
  app text not null,
  number integer not null,
  code_commit text not null,
  bundle_hash text not null,
  blueprint_hash text not null,
  data_schema integer not null,
  data_changes text not null,
  ticket_source text,
  created_by text not null,
  created_at text not null,
  status text not null,
  blueprint text not null,
  declarations text not null
) strict;
create table if not exists release_tests (
  release text not null,
  verification text not null,
  primary key (release, verification)
) strict;
create table if not exists verifications (
  id text primary key,
  request_principal text not null,
  request_key text not null,
  request_hash text not null,
  kind text not null,
  app text not null,
  target_bundle_hash text not null,
  target_release text,
  problem text,
  basis_seq text,
  before_release text,
  after_release text,
  ticket text,
  test text not null,
  execution text not null,
  result text not null,
  reason text not null,
  observations text not null,
  recorded_seq text not null,
  verification_canonical text not null
) strict;`,
};

// 근거 행이 참조하는 release 행과 app 행이다. fixture 표에 행이 있어야 handler의 참조가
// 맞는 조립과 같아진다.
export function seedFixtureRows(tx: Tx): void {
  tx.sql.run(
    `insert into apps (id, slug, name, active_release) values (?, ?, ?, NULL)
      on conflict (id) do nothing`,
    ["app_01arz3ndektsv4rrffq69g5fav", "usage", "Usage"],
  );
  tx.sql.run(
    `insert into apps (id, slug, name, active_release) values (?, ?, ?, NULL)
      on conflict (id) do nothing`,
    ["app_01arz3ndektsv4rrffq69g5faw", "other", "Other"],
  );
  for (
    const release of [
      "rel_01arz3ndektsv4rrffq69g5fa1",
      "rel_01arz3ndektsv4rrffq69g5fa2",
    ]
  ) {
    tx.sql.run(
      `insert into releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       values (?, 'app_01arz3ndektsv4rrffq69g5fav', 1, ?, ?, ?, 0, '[]', NULL, 'coding_agent',
         '2026-10-04T00:00:00.000Z', 'prepared', '{}', '[]')
       on conflict (id) do nothing`,
      [
        release,
        "a".repeat(40),
        "b".repeat(64),
        "c".repeat(64),
      ],
    );
    tx.sql.run(
      `insert into releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       values (?, 'app_01arz3ndektsv4rrffq69g5faw', 1, ?, ?, ?, 0, '[]', NULL, 'coding_agent',
         '2026-10-04T00:00:00.000Z', 'prepared', '{}', '[]')
       on conflict (id) do nothing`,
      [
        `rel_01arz3ndektsv4rrffq69g5f${
          release.slice(-1) === "1" ? "ax" : "ay"
        }`,
        "a".repeat(40),
        "b".repeat(64),
        "c".repeat(64),
      ],
    );
  }
}

// grouping fixture의 등록에 closing 확장을 더한다. 등록 모듈은 두 개다: grouping
// fixture의 초기 등록과 여기 closing 확장(code-map: 다른 leaf의 testing fixture는
// *_test.ts만 import한다).
export function createLedgerTestRegistration(
  _environment: unknown = {},
) {
  return {
    schemaSteps: [FIXTURE_STEP],
    commands: [
      closeProblemVerifiedCommand,
      applyProblemDecisionCommand,
      verifyCommand as CommandDefinition,
      activateCommand as CommandDefinition,
    ],
  };
}

// 닫힘 command의 machine 자격이다. 시험이 CloseProblemVerified와 줄임 시험 command를
// 부를 때 쓴다.
export const MACHINE_TEST = {
  principal: "machine:releaser",
  actor: "machine" as const,
  scope: {
    operations: [
      "RecordReport",
      "CloseProblemVerified",
      "problems.testing.verify",
      "problems.testing.activate",
      "problems.testing.arrange",
      "problems.testing.set-wording",
      "problems.testing.set-app-name",
      "problems.testing.ticket-event",
      "problems.testing.assignment",
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: "cred-closing",
};
