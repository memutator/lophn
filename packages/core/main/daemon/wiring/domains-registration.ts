// domains가 projects·apps를 import하지 못하므로 이 wiring file이 domain.create가 같은 tx 안에서 보는
// 그릇(project나 app)의 존재와 보관 여부를 잇는다. Worker가 팀 등록 file로 import한다.
import { ownerLookupPort } from "../../../domains/mod.ts";
import { defineTxPort } from "../../../storage/ledger/mod.ts";
import { projectStatusOf } from "../../../projects/lookups.ts";
import { appStatusOf } from "../../../apps/lookups.ts";

const ports = [
  defineTxPort(ownerLookupPort, (tx) => ({
    get(owner) {
      const status =
        owner.kind === "project"
          ? projectStatusOf(tx.sql, owner.id)
          : appStatusOf(tx.sql, owner.id);
      return status === null ? null : { status };
    },
  })),
];

export function createCoreRegistration() {
  return { ports };
}
