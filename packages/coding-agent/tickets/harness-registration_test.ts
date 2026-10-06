// ticket claim·완료 보고·취소의 실제 executor 등록. harness Worker가 이
// module을 읽는다. Deno.test는 없다. connection 등록과 함께 써서 회수·scope를
// 실제 표로 본다. report가 역조회하는 releases·versions·verifications 표는
// fixture step으로 두고 행은 seed command가 채운다(probeWrite는 호출마다
// rollback이므로 seeding은 seed command만 남는다).
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { appRegistrationLookup } from "../../contracts/apps/mod.ts";
import type { CodingAgentConnectionAuthResult } from "../../contracts/coding-agent/mod.ts";
import { connectionAuthSyncPort } from "../connection/mod.ts";
import {
  type CommandDefinition,
  defineCommand,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { createTicketClaimCommands } from "./claims.ts";
import {
  createTicketCommands,
  PROBLEM_STATUSES_PORT,
  QUESTION_ADOPTIONS_PORT,
} from "./commands.ts";
import { createTicketFinishCommands } from "./report.ts";
import { createTicketReads } from "./reads.ts";
import { ticketSchemaSteps } from "./schema.ts";

type LedgerEnvironment = {
  currentCredential(credentialRef: string): Result<RequestContext>;
};

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const CAC_B = "cac_01arz3ndektsv4rrffq69g5faw";
const DIGEST = "a".repeat(64);

// worker가 이 module을 따로 읽는다. 값은 import 시점에 있어야 factory가 본다.
const connections = new Map<string, CodingAgentConnectionAuthResult>([
  [connectionPrincipal(CAC), connectionAuth(CAC, DIGEST)],
  [connectionPrincipal(CAC_B), connectionAuth(CAC_B, "b".repeat(64))],
]);
const apps = new Map<string, { id: string; status: string }>([
  [APP, { id: APP, status: "active" }],
]);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const adoptions = new Map<string, { document: string; version: string }>([
  [QUESTION, { document: DOC, version: VER }],
]);
const problems = new Map<string, string>();

function connectionPrincipal(id: string): string {
  return `coding_agent:${id}`;
}

function connectionAuth(
  id: string,
  digest: string,
): CodingAgentConnectionAuthResult {
  return {
    connection: id,
    state: "active",
    scope: { kind: "all", app: null },
    token_digest: digest,
    revision: "1",
  };
}

// report가 역조회하는 행만 같은 이름으로 둔다. FK는 없고 probeWrite는 호출마다
// rollback이므로 행 seeding은 seed command만 남는다.
const FIXTURE_SCHEMA = `
create table releases (
  id text primary key,
  app text not null,
  ticket_source text
) strict;
create table versions (
  id text primary key,
  document text not null,
  number integer not null
) strict;
create table verifications (
  id text primary key,
  app text not null
) strict;
`;

// seed command. worker가 등록 command Tx 안에서 commit한다.
const seed = defineCommand({
  resource: "tickets",
  method: "seed-finish-fixture",
  name: "coding-agent.tickets.seed",
  input: z.strictObject({
    app: z.string(),
    release: z.string(),
    release_app: z.string().optional(),
    ticket_source: z.string().nullable(),
    versions: z.array(z.string()).default([]),
    verifications: z.array(z.strictObject({
      id: z.string(),
      app: z.string(),
    })).default([]),
  }),
  output: z.object({ seeded: z.boolean() }),
  actors: ["machine"],
  errors: [],
});

const seedCommand: CommandDefinition<typeof seed> = {
  route: seed,
  handle(tx, _ctx, raw) {
    const parsed = seed.input.parse(raw) as {
      app: string;
      release: string;
      release_app?: string;
      ticket_source: string | null;
      versions: string[];
      verifications: { id: string; app: string }[];
    };
    tx.sql.run(
      `INSERT INTO releases (id, app, ticket_source) VALUES (?, ?, ?)`,
      [
        parsed.release,
        parsed.release_app ?? parsed.app,
        parsed.ticket_source,
      ],
    );
    for (const version of parsed.versions) {
      tx.sql.run(
        "INSERT INTO versions (id, document, number) VALUES (?, ?, 1)",
        [version, "doc_01arz3ndektsv4rrffq69g5fav"],
      );
    }
    for (const verification of parsed.verifications) {
      tx.sql.run(
        "INSERT INTO verifications (id, app) VALUES (?, ?)",
        [verification.id, verification.app],
      );
    }
    return ok({ seeded: true });
  },
};

export function createLedgerTestRegistration(
  _environment: LedgerEnvironment,
) {
  const tickets = createTicketCommands();
  const claims = createTicketClaimCommands();
  const finish = createTicketFinishCommands();
  const reads = createTicketReads();
  return {
    schemaSteps: [
      ...ticketSchemaSteps,
      { id: "coding-agent.tickets.fixture.tables", sql: FIXTURE_SCHEMA },
    ],
    commands: [
      tickets.create,
      tickets.make_ready,
      claims.claim,
      claims.renew_claim,
      claims.release_claim,
      claims.expire_claim,
      finish.report_completion,
      finish.cancel,
    ],
    testCommands: [seedCommand],
    reads: [reads.list, reads.show, reads.checks, reads.claim_sweep],
    ports: [
      {
        key: connectionAuthSyncPort,
        create:
          () =>
          (principal: string): CodingAgentConnectionAuthResult | undefined =>
            connections.get(principal),
      },
      {
        key: appRegistrationLookup,
        create: () => ({
          get(app: string) {
            const found = apps.get(app);
            return {
              ok: true as const,
              value: found
                ? {
                  id: found.id,
                  slug: "notes",
                  status: found.status === "archived" ? "archived" : "active",
                }
                : null,
            };
          },
        }),
      },
      {
        key: QUESTION_ADOPTIONS_PORT,
        create: () => ({
          adoptions(questions: readonly string[]) {
            return {
              ok: true as const,
              value: new Map(questions.flatMap((question) => {
                const found = adoptions.get(question);
                return found ? [[question, found] as const] : [];
              })),
            };
          },
        }),
      },
      {
        key: PROBLEM_STATUSES_PORT,
        create: () => ({
          problems(ids: readonly string[]) {
            return {
              ok: true as const,
              value: ids.map((id) => ({
                id,
                status: problems.get(id) ?? "open",
              })),
            };
          },
        }),
      },
    ],
    registerBlobRef(
      tx: Tx,
      _ctx: RequestContext,
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
