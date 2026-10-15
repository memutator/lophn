import { definePort, type PortKey } from "../../../protocol/base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { ReleaseLookup } from "../ports.ts";

// 재발 판정(접수)과 문제 상세의 release 풀이(읽기)가 ReleaseLookup을 받는 자리다. 접수 transaction과
// reader가 같은 ledger를 읽으므로 값은 sql을 받아 ReleaseLookup을 만드는 함수이고, 구현은 apps/releases가
// 내놓고 core 조립이 writer ports와 reader ports에 같은 key로 끼운다.
export type ReleaseLookupOf = (sql: Pick<Sql, "get" | "all">) => ReleaseLookup;

export const ReleaseLookupPort: PortKey<ReleaseLookupOf> = definePort<
  ReleaseLookupOf
>("problems.ReleaseLookup");
