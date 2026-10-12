// 고친 기록의 실제 executor 등록. harness Worker가 이 module을 읽는다.
// Deno.test는 없다. coding-agent·apps 표를 받지 못하므로(check-deps 최상위 경계)
// handler가 묻는 열과 claim 검사가 읽는 열만 같은 이름으로 정의하고, TicketClaimCheck는
// 검사 이력(coding-agent/tickets)의 같은 우선순위를 본는 test double port를 건다.
import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import { TicketClaimCheck } from "../../../protocol/coding-agent/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { defineCommand } from "../../../protocol/base/mod.ts";
import { recordProblemFixCommand } from "./commands.ts";
import { listProblemFixesRead } from "./reads.ts";

type LedgerEnvironment = {
  currentCredential(credentialRef: string): Result<never>;
};

// claim 검사가 보는 대상. Worker module 상태에만 있고 Deno.test는 없다.
type FixtureTicket = {
  id: string;
  app: string;
  kind: string;
  state: string;
  readiness: string;
};
type FixtureClaim = {
  ticket: string;
  connection: string;
  claim_seq: string;
  expires_at: string;
};
type FixtureRevoked = Set<string>;

const tickets = new Map<string, FixtureTicket>();
const claims = new Map<string, FixtureClaim>();
const revoked: FixtureRevoked = new Set();

// test double이 본는 검사 규칙(coding-agent/tickets). 거절 우선순위:
// ticket_closed → not_ready → claim 없음(missing/released) → revoked →
// wrong_connection → changed → expired. now가 기한과 같으면 만료다(coding-agent#R12).
function checkClaimDouble(input: {
  ticket: string;
  claim_seq: string;
  connection: string;
  now: string;
}): Result<
  { ok: true; expires_at: string; app?: string } | {
    ok: false;
    reason: string;
  }
> {
  const ticket = tickets.get(input.ticket);
  if (ticket === undefined) return ok({ ok: false, reason: "missing" });
  if (ticket.state === "confirmed" || ticket.state === "cancelled") {
    return ok({ ok: false, reason: "ticket_closed" });
  }
  if (ticket.readiness !== "ready") {
    return ok({ ok: false, reason: "not_ready" });
  }
  const claim = claims.get(input.ticket) ?? null;
  if (claim === null) {
    return ok({
      ok: false,
      reason: input.claim_seq === "0" ? "missing" : "released",
    });
  }
  if (revoked.has(`coding_agent:${input.connection}`)) {
    return ok({ ok: false, reason: "revoked" });
  }
  if (claim.connection !== input.connection) {
    return ok({ ok: false, reason: "wrong_connection" });
  }
  if (claim.claim_seq !== input.claim_seq) {
    return ok({ ok: false, reason: "changed" });
  }
  const expires_at_ms = Date.parse(claim.expires_at);
  if (Number.isNaN(expires_at_ms) || Date.parse(input.now) >= expires_at_ms) {
    return ok({ ok: false, reason: "expired" });
  }
  return ok({ ok: true, expires_at: claim.expires_at, app: ticket.app });
}

// handler와 ticket double이 묻는 열만 같은 이름으로 둔다. products 표는
// contracts의 조각이 아니다: 테스트에만 있는 최소 모양이다. FK는 없다.
// probeWrite가 호출마다 rollback이므로 행 seeding은 seed command만 남긴다.
// trigger는 migration 검사의 guard가 아니라 fixture에 trigger가 없는 표다.
const SCHEMA = `
create table problems (
  id text primary key,
  app text not null,
  group_key text not null,
  status text not null check (status in ('open', 'fixing', 'closed')),
  work text,
  interpretation_version text,
  interpretation_section text,
  closure text,
  check ((status = 'closed') = (closure is not null)),
  check (work is null or length(work) > 0),
  check (interpretation_version is null or length(interpretation_version) > 0),
  check (interpretation_section is null or interpretation_version is not null)
) strict;
create table releases (
  id text primary key,
  app text not null,
  number integer not null check (number > 0),
  code_commit text not null check (length(code_commit) = 40),
  bundle_hash text not null check (length(bundle_hash) = 64),
  blueprint_hash text not null check (length(blueprint_hash) = 64),
  data_schema integer not null check (data_schema >= 0),
  data_changes text not null check (json_valid(data_changes)),
  ticket_source text check (ticket_source is null or json_valid(ticket_source)),
  created_by text not null check (length(created_by) > 0),
  created_at text not null check (length(created_at) > 0),
  status text not null check (status in (
    'prepared', 'activating', 'active', 'failed', 'superseded'
  )),
  activation text check (activation is null or json_valid(activation)),
  failure text check (failure is null or json_valid(failure)),
  blueprint text not null check (json_valid(blueprint)),
  declarations text not null check (json_valid(declarations))
) strict;
create table verifications (
  id text primary key,
  request_principal text not null,
  request_key text not null,
  request_hash text not null,
  kind text not null check (kind in ('app_test', 'reproduction', 'test_command')),
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
  result text not null check (result in ('pass', 'fail', 'inconclusive')),
  reason text not null,
  observations text not null,
  recorded_seq text not null,
  verification_canonical text not null
) strict;
create table tickets (
  id text primary key,
  app text not null,
  kind text not null check (kind in ('implementation', 'repair')),
  title text not null check (length(trim(title)) > 0),
  what text not null,
  why text not null,
  inspect text not null,
  preserve text not null,
  problems text not null,
  state text not null check (state in (
    'open', 'claimed', 'reported', 'confirmed', 'check_failed', 'cancelled'
  )),
  readiness text not null check (readiness in ('needs_confirmation', 'ready')),
  needs text not null,
  cancel_reason text,
  completion_seq text,
  revision text not null
) strict;
create table ticket_problems (
  ticket text not null,
  position integer not null check (position >= 0),
  problem text not null,
  primary key (ticket, position),
  unique (ticket, problem)
) strict;
create table ticket_claims (
  ticket text primary key not null,
  connection text not null,
  claim_seq text not null unique,
  expires_at text not null
) strict;
`;

// seed command. worker가 등록 command Tx 안에서 commit한다. probeWrite는
// 호출마다 rollback이라 seeding에 못 쓴다(platform/ledger#R10). inputs은
// handler와 같은 열만 가진다.
const seed = defineCommand({
  resource: "problems",
  method: "seed-repair-fixture",
  name: "problems.repairs.seed",
  input: z.object({
    problem: z.string(),
    app: z.string(),
    group_key: z.string().default("{}"),
    before: z.string().nullable(),
    after: z.string().nullable(),
    verification: z.string().nullable(),
    ticket: z.string().nullable(),
    claim: z.string().nullable(),
    ticket_problem: z.boolean().default(true),
    revoked: z.boolean().default(false),
  }),
  output: z.object({ seeded: z.boolean() }),
  actors: ["machine"],
  errors: [],
});

export function createLedgerTestRegistration(
  _environment: LedgerEnvironment,
) {
  return {
    schemaSteps: [{ id: "repairs.fixture.tables", sql: SCHEMA }],
    commands: [recordProblemFixCommand],
    testCommands: [{
      route: seed,
      handle(tx, _ctx, raw) {
        const parsed = seed.input.parse(raw) as {
          problem: string;
          app: string;
          group_key: string;
          before: string | null;
          after: string | null;
          verification: string | null;
          ticket: string | null;
          claim: string | null;
          ticket_problem: boolean;
          revoked: boolean;
        };
        tx.sql.run(
          `insert into problems (id, app, group_key, status, work, interpretation_version, interpretation_section, closure)
           values (?, ?, ?, 'open', NULL, NULL, NULL, NULL)`,
          [parsed.problem, parsed.app, parsed.group_key],
        );
        const bundle = "b".repeat(64);
        for (const id of [parsed.before, parsed.after]) {
          if (id === null) continue;
          tx.sql.run(
            `insert into releases (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema, data_changes, ticket_source, created_by, created_at, status, activation, failure, blueprint, declarations)
             values (?, ?, 1, ?, ?, ?, 0, '[]', NULL, 'machine:releaser', '2026-10-05T00:00:00.000Z', 'active', '[]', NULL, ?, '[]')`,
            [
              id,
              parsed.app,
              "c".repeat(40),
              bundle,
              "d".repeat(64),
              `{"kind":"app"}`,
            ],
          );
        }
        if (parsed.verification !== null) {
          const v = JSON.parse(parsed.verification) as {
            id?: string;
            kind?: string;
            app?: string;
            target_bundle_hash?: string;
            problem?: string | null;
            before_release?: string | null;
            after_release?: string | null;
            result?: string;
          };
          tx.sql.run(
            `insert into verifications (id, request_principal, request_key, request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, test, execution, result, reason, observations, recorded_seq, verification_canonical)
             values (?, 'user-1', 'key-1', ?, ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, '{}', '{}', ?, '', '[]', '1', '{}')`,
            [
              v.id ?? "vrf_01arz3ndektsv4rrffq69g5fav",
              "e".repeat(64),
              v.kind ?? "app_test",
              v.app ?? parsed.app,
              v.target_bundle_hash ?? bundle,
              v.problem ?? null,
              v.before_release ?? null,
              v.after_release ?? null,
              v.result ?? "pass",
            ],
          );
        }
        if (parsed.ticket !== null) {
          tx.sql.run(
            `insert into tickets (id, app, kind, title, what, why, inspect, preserve, problems, state, readiness, needs, cancel_reason, completion_seq, revision)
             values (?, ?, 'repair', 't', 'w', 'y', '[]', '[]', '[]', 'claimed', 'ready', '[]', NULL, NULL, '1')`,
            [parsed.ticket, parsed.app],
          );
          // 검사 double은 SQL이 아니라 worker module 상태를 본다.
          tickets.set(parsed.ticket, {
            id: parsed.ticket,
            app: parsed.app,
            kind: "repair",
            state: "claimed",
            readiness: "ready",
          });
          if (parsed.ticket_problem) {
            tx.sql.run(
              `insert into ticket_problems (ticket, position, problem) values (?, 0, ?)`,
              [parsed.ticket, parsed.problem],
            );
          }
        }
        if (parsed.claim !== null) {
          const ticketId = parsed.ticket as string;
          const c = JSON.parse(parsed.claim) as {
            connection: string;
            claim_seq: string;
            expires_at: string;
          };
          tx.sql.run(
            `insert into ticket_claims (ticket, connection, claim_seq, expires_at) values (?, ?, ?, ?)`,
            [ticketId, c.connection, c.claim_seq, c.expires_at],
          );
          claims.set(ticketId, {
            ticket: ticketId,
            connection: c.connection,
            claim_seq: c.claim_seq,
            expires_at: c.expires_at,
          });
        }
        if (parsed.revoked) {
          const claim = JSON.parse(parsed.claim ?? "{}") as {
            connection?: string;
          };
          if (claim.connection !== undefined) {
            revoked.add(`coding_agent:${claim.connection}`);
          }
        }
        return ok({ seeded: true });
      },
    } as CommandDefinition],
    reads: [listProblemFixesRead],
    ports: [
      {
        key: TicketClaimCheck,
        create: (_tx: Tx) => checkClaimDouble,
      },
    ],
    registerBlobRef(
      tx: Tx,
      _ctx: unknown,
      reference: {
        owner_kind: string;
        owner_key: string;
        field: string;
        registered_seq: string | bigint;
        source: { kind: string; blob?: { hash: string; size_bytes: number } };
      },
    ) {
      // 준비되지 않은 hash는 영구 참조가 되지 못한다(ledger 시험은 같은 guard를 본다).
      if (
        reference.source.kind !== "prepared" ||
        reference.source.blob === undefined
      ) {
        return err({ code: "forbidden", message: "prepared blob만 등록한다" });
      }
      // LEDGER_SCHEMA_STEPS의 blob-refs 표다. 등록이 거절되면 command 전체가 없다.
      tx.sql.run(
        `insert into blob_refs (
           owner_kind, owner_key, field, hash, size_bytes, registered_seq
         ) values (?, ?, ?, ?, ?, ?)`,
        [
          reference.owner_kind,
          reference.owner_key,
          reference.field,
          reference.source.blob.hash,
          reference.source.blob.size_bytes,
          BigInt(reference.registered_seq),
        ],
      );
      return ok({
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash: reference.source.blob.hash,
        registered_seq: reference.registered_seq,
      });
    },
  };
}

// Worker module 상태는 seed command가 채운다. 이 파일에는 Deno.test가 없다.
// claim 검사 double은 같은 Worker module에서 읽는다.
