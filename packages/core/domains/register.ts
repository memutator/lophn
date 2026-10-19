import { ok } from "../../base/mod.ts";
import {
  type DomainLookup,
  domainLookupPort,
  domainProvisioningPort,
} from "../../protocol/domains/mod.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
  type TxPortRegistration,
} from "../storage/ledger/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createDomain, createDomainCommands } from "./commands.ts";
import { domainByName, domainOf, domainsOfOwner } from "./lookups.ts";
import { createDomainReads } from "./reads.ts";
import { domainsSchemaSteps } from "./schema.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  ports?: readonly TxPortRegistration[];
};

function lookupOf(sql: Pick<Tx["sql"], "get" | "all">): DomainLookup {
  return {
    get: (id) => domainOf(sql, id),
    ofOwner: (owner, status) => domainsOfOwner(sql, owner, status),
    byName: (name) => domainByName(sql, name),
  };
}

// owner target이 아니라 actor와 자격 조건으로 판정하므로 TargetAuthorization을 쓰지 않는다.
export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  const commands = createDomainCommands();
  const reads = createDomainReads();
  return {
    schemaSteps: domainsSchemaSteps,
    commands: [commands.create, commands.archive, commands.unarchive],
    reads: [reads.list, reads.get],
    ports: [
      defineTxPort(domainLookupPort, (tx) => lookupOf(tx.sql)),
      // 그릇이 있는지는 부른 command가 이미 같은 tx에서 확인했다.
      defineTxPort(domainProvisioningPort, (tx) => ({
        create(input) {
          const made = createDomain(tx, input);
          return made.ok ? ok({ id: made.value.id }) : made;
        },
      })),
    ],
  };
}

// reader Worker가 HTTP read를 연다. command 등록과 같은 read 목록이다.
export function createReaderRegistration(): ReaderRegistration {
  const reads = createDomainReads();
  return {
    reads: [reads.list, reads.get],
    ports: new Map<unknown, unknown>([
      [domainLookupPort, snapshotPort((snapshot) => lookupOf(snapshot.sql))],
    ]),
  };
}
