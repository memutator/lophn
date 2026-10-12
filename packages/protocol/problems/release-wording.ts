import type { Result } from "../../base/mod.ts";
import type { Sql } from "../platform/mod.ts";
import { definePort, type PortKey } from "../platform/ports.ts";
import type { ProblemCodeDeclaration } from "./problem-codes.ts";

// 보고 당시 release의 선언 code 문구(apps/releases store가 고정 blueprint에서 읽는다).
// 구현은 problems가 내놓고 core 조립이 reader·Tx port로 등록한다(problems#T27).
export type ProblemWordingFact = {
  // 앱 등록 기록의 사람이 지은 이름(#261 이어받음: fallback에 앱 이름을 붙인다).
  app_name: string;
  // 그 release가 없거나 선언에 그 code가 없으면 null이다(선언을 읽을 수 없는 상태).
  declaration: ProblemCodeDeclaration | null;
};

export type ProblemWordingLookup = (
  sql: Pick<Sql, "get" | "all">,
  app: string,
  release: string,
  code: string,
) => Result<ProblemWordingFact | null>;

export const ProblemWordingPort: PortKey<ProblemWordingLookup> = definePort<
  ProblemWordingLookup
>("problems.ProblemWording");
