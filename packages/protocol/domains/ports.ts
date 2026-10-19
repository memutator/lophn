import type { Result } from "../../base/mod.ts";
import { definePort } from "../base/ports.ts";
import type { DomainOwner } from "./values.ts";

export type DomainInfo = {
  id: string;
  name: string;
  owner: DomainOwner;
  status: "active" | "archived";
};

// 같은 tx·snapshot에서 domain을 읽는다. archived도 돌려주므로 부른 쪽이 status를 본다.
export interface DomainLookup {
  get(id: string): DomainInfo | null;
  // 이름순.
  ofOwner(
    owner: DomainOwner,
    status?: "active" | "archived",
  ): readonly DomainInfo[];
  byName(name: string): DomainInfo | null;
}

export const domainLookupPort = definePort<DomainLookup>("domains.lookup");

// 다른 module의 command가 같은 tx 안에서 domain을 만든다(앱을 만들 때 앱 이름의 domain).
// owner가 있는지는 부른 command가 이미 같은 tx에서 확인했다.
export interface DomainProvisioning {
  create(input: {
    name: string;
    title: string;
    purpose: string;
    owner: DomainOwner;
  }): Result<{ id: string }>;
}

export const domainProvisioningPort = definePort<DomainProvisioning>(
  "domains.provisioning",
);
