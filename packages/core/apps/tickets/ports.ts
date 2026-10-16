import { err, ok, type Result } from "../../../base/mod.ts";
import { definePort, type PortKey } from "../../../protocol/base/ports.ts";
import {
  TicketClaimCheck,
  type TicketClaimChecker,
  TicketSessionEnd,
} from "../../../protocol/coding-agent/ticket/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import {
  defineTxPort,
  type TxPortRegistration,
} from "../../storage/ledger/mod.ts";
import type { AnnotationLookup } from "../annotations/ports.ts";
import { checkTicketClaim } from "./claims.ts";
import { createTicketSessionEnd } from "./session-end.ts";

// ticket 근거(problem, release)가 어느 앱의 것인지 읽는다. 없으면 null이다. 두 표는 같은
// ledger라 tx.sql로 읽고, 읽지 못하면(표 없음 등) 닫힌 채로 unavailable이다.
export type TicketEvidenceLookupPort = {
  problemApp(id: string): Result<string | null>;
  releaseApp(id: string): Result<string | null>;
};
export const TicketEvidenceLookup: PortKey<TicketEvidenceLookupPort> =
  definePort<TicketEvidenceLookupPort>("coding-agent.tickets.EvidenceLookup");

// ticket.show가 근거 annotation을 값으로 풀 때 읽는다. 구현은 annotation module이 등록한다.
// 등록이 없으면 annotation 값은 null이다.
export const TicketAnnotationLookup: PortKey<AnnotationLookup> = definePort<
  AnnotationLookup
>("apps.AnnotationLookup");

function appOf(tx: Tx, table: "problems" | "releases", id: string) {
  try {
    const row = tx.sql.get(`select app from ${table} where id = ?`, [id]);
    return ok(row === undefined ? null : String(row["app"]));
  } catch {
    return err({
      code: "unavailable" as const,
      message: `${table} could not be read`,
    });
  }
}

const ports: TxPortRegistration[] = [
  defineTxPort(TicketEvidenceLookup, (tx): TicketEvidenceLookupPort => ({
    problemApp: (id) => appOf(tx, "problems", id),
    releaseApp: (id) => appOf(tx, "releases", id),
  })),
  // release 준비가 지금 claim을 확인한다.
  defineTxPort(
    TicketClaimCheck,
    (tx): TicketClaimChecker => (input) => checkTicketClaim(tx, input),
  ),
  // coding session이 끝났을 때 claim을 반납한다.
  defineTxPort(TicketSessionEnd, createTicketSessionEnd),
];

export function createCoreRegistration() {
  return { ports };
}
