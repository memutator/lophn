import {
  definePort,
  type PortKey,
  type RequestContext,
} from "../../../protocol/server/mod.ts";
import type { Input } from "../../../protocol/server/mod.ts";
import type {
  recordVerification,
  requestTest,
} from "../../../protocol/problems/mod.ts";
import type { PreparedAdmission, PreparedResultEvidence } from "./model.ts";

// 현재 Tx를 capture하는 static map은 쓰지 않는다. entry가 tx.port로 넣는다.
// port는 반환 값 identity만 유지한다. hash·canonical·side 시작은 여기서 다시 검사한다.
export const testAdmissionPort: PortKey<
  (
    ctx: RequestContext,
    input: Input<typeof requestTest>,
  ) => PreparedAdmission | null
> = definePort("problems.tests.admission");

export const testEvidencePort: PortKey<
  (input: Input<typeof recordVerification>) => PreparedResultEvidence | null
> = definePort("problems.tests.evidence");
