import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { definePort } from "../platform/ports.ts";
import { sha256Schema } from "../platform/values.ts";
import {
  type ConnectionId,
  connectionIdSchema,
  connectionSchema,
  connectionScopeSchema,
  connectionStateSchema,
} from "./connections.ts";

// 검증 digest는 이 port 출력에만 있다. 일반 읽기·event에는 없다.
export const codingAgentConnectionAuthResultSchema = z.object({
  connection: connectionIdSchema,
  state: connectionStateSchema,
  scope: connectionScopeSchema,
  token_digest: sha256Schema,
  revision: connectionSchema.shape.revision,
});

export type CodingAgentConnectionAuthResult = z.infer<
  typeof codingAgentConnectionAuthResultSchema
>;

// platform 인증이 매 요청 같은 read 연결로 부른다.
export type CodingAgentConnectionAuthPort = (
  principal: string,
) => Promise<CodingAgentConnectionAuthResult | undefined>;

export const CodingAgentConnectionAuth: ReturnType<
  typeof definePort<CodingAgentConnectionAuthPort>
> = definePort<CodingAgentConnectionAuthPort>("CodingAgentConnectionAuth");

// helper `lophn-credential`의 stdin. token 원문은 요청에 없다.
export const credentialDeliveryRequestSchema = z.strictObject({
  connection: connectionIdSchema,
  process_generation: z.string().min(1),
  loader_identity: z.string().min(1),
  purpose: z.enum(["mcp_cli_loader", "coding_tui"]),
  start_operation: z.string().min(1).optional(),
});

export type CredentialDeliveryRequest = z.infer<
  typeof credentialDeliveryRequestSchema
>;

// token 원문이 담기는 곳은 이 helper의 stdout뿐이다.
export const credentialDeliveryResponseSchema = z.strictObject({
  token: z.string().min(1),
});

export type CredentialDeliveryResponse = z.infer<
  typeof credentialDeliveryResponseSchema
>;

// 네 이유 모두 unavailable 계열이다. 평문 파일·user credential fallback은 없다.
export const CREDENTIAL_DELIVERY_FAILURES = [
  "locked",
  "no_secret_service",
  "timeout",
  "not_found",
] as const;

export type CredentialDeliveryFailure =
  (typeof CREDENTIAL_DELIVERY_FAILURES)[number];

export const credentialDeliveryFailureSchema = z.strictObject({
  reason: z.enum(CREDENTIAL_DELIVERY_FAILURES),
});

export type CredentialDeliveryFailureBody = z.infer<
  typeof credentialDeliveryFailureSchema
>;

export const CREDENTIAL_DELIVERY_TIMEOUT_MS = 5_000;

export const CREDENTIAL_HELPER = "lophn-credential";

export function credentialDeliveryErrorCode(
  _reason: CredentialDeliveryFailure,
): "unavailable" {
  return "unavailable";
}

const knownErrors: readonly string[] = ERROR_CODES;
for (const reason of CREDENTIAL_DELIVERY_FAILURES) {
  if (!knownErrors.includes(credentialDeliveryErrorCode(reason))) {
    throw new Error(
      "credential delivery error code is outside the common seven",
    );
  }
}

export type { ConnectionId };
