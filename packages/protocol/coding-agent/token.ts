// coding token과 principal. token은 앱 하나 범위이고 coding session이 끝나면 회수된다.
// 원문 token은 저장하지 않는다. 구현은 core의 identity와 coding session module이 낸다.
import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { definePort, type PortKey } from "../base/ports.ts";

// CLI가 읽는 유일한 인증 환경 변수다.
export const CODING_TOKEN_ENV = "LOPHN_CODING_TOKEN";

// coding session. 앱 하나에 한 번에 하나만 돈다.
export const codingSessionIdSchema = idSchema("ses");

export function codingPrincipal(session: string): `coding_agent:${string}` {
  return `coding_agent:${session}`;
}

const codingTokenScopeSchema = z.strictObject({
  session: codingSessionIdSchema,
  app: idSchema("app"),
});
type CodingTokenScope = z.infer<typeof codingTokenScopeSchema>;

// token 발급과 회수. 회수한 token의 새 호출은 거절한다.
export type CodingTokens = {
  // credential_ref는 core가 그 자격을 ledger에 기록할 때 쓴다(기록이 없으면 writer가 그 token의 command를 거절한다).
  issue(
    scope: CodingTokenScope,
  ): Result<{ token: string; credential_ref: string }>;
  revoke(session: string): Result<void>;
};
export const CodingTokens: PortKey<CodingTokens> =
  definePort<CodingTokens>("CodingTokens");

// session이 속한 앱. 앱 하나 범위를 보는 쪽(annotation 읽기 등)이 "token은 앱 하나만 연다"를 검사할 때 쓴다.
export type CodingSessionLookup = { appOf(session: string): string | null };
export const CodingSessionLookup: PortKey<CodingSessionLookup> =
  definePort<CodingSessionLookup>("CodingSessionLookup");
