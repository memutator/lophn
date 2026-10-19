import { definePort } from "../../../protocol/base/mod.ts";

// app.create가 같은 tx 안에서 project의 존재와 보관 여부를 본다. apps는 projects를 import하지 못하므로
// 구현은 조립(core/main)이 꽂는다.
export interface AppProjectLookup {
  get(project: string): { status: "active" | "archived" } | null;
}

export const appProjectLookupPort = definePort<AppProjectLookup>(
  "apps.project_lookup",
);
