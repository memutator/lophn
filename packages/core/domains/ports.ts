import { definePort } from "../../protocol/base/mod.ts";
import type { DomainOwner } from "../../protocol/domains/mod.ts";

// domain.create가 같은 tx 안에서 그릇(project나 app)의 존재와 보관 여부를 본다. domains는 projects·apps를
// import하지 못하므로 구현은 조립(core/main)이 꽂는다.
export interface OwnerLookup {
  get(owner: DomainOwner): { status: "active" | "archived" } | null;
}

export const ownerLookupPort = definePort<OwnerLookup>("domains.owner_lookup");
