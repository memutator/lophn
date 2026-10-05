// ticket claim의 실제 executor 등록. harness Worker가 이 module을 읽는다.
// Deno.test는 없다. connection 등록과 함께 써서 회수·scope를 실제 표로 본다.
import type { Result } from "../../base/mod.ts";
import { appRegistrationLookup } from "../../contracts/apps/mod.ts";
import type { CodingAgentConnectionAuthResult } from "../../contracts/coding-agent/mod.ts";
import { connectionAuthSyncPort } from "../connection/mod.ts";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import { createTicketClaimCommands } from "./claims.ts";
import {
  createTicketCommands,
  PROBLEM_STATUSES_PORT,
  QUESTION_ADOPTIONS_PORT,
} from "./commands.ts";
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

export function createLedgerTestRegistration(
  _environment: LedgerEnvironment,
) {
  const tickets = createTicketCommands();
  const claims = createTicketClaimCommands();
  const reads = createTicketReads();
  return {
    schemaSteps: ticketSchemaSteps,
    commands: [
      tickets.create,
      tickets.make_ready,
      claims.claim,
      claims.renew_claim,
      claims.release_claim,
      claims.expire_claim,
    ],
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
  };
}
