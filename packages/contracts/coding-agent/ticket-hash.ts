import { fingerprint } from "../../base/mod.ts";
import type { AcceptanceCheck } from "./ticket-values.ts";

// condition_hash는 조건 입력의 RFC 8785 정규 JSON sha256이다(contracts T41).
// TicketTestLink.check_hash와 같은 값이다(problems/tests).
export function conditionHash(input: AcceptanceCheck): Promise<string> {
  return fingerprint(input);
}
