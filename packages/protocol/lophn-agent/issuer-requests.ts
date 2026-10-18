import { z } from "zod";
import { defineMemory } from "../base/route.ts";

// OAuth 발급자 호출(MCP 서버와 구독 provider의 token 교환·갱신, JWKS, device code)을 agent runtime이 대신 보낸다.
// OAuth network는 runtime의 몫이고 core module graph에는 외부 fetch가 없다. core는 요청을 작업 메모리 대기열에
// 놓고, runtime이 이 입구로 가져가 `--allow-net`이 허락한 발급자에게 보낸 뒤 받은 응답을 돌려준다. machine 자격만
// 부르고(actors), 요청과 응답 본문에는 code·verifier·refresh token·새 token이 들어 있어 loopback 밖으로 나가지
// 않으며 어디에도 남기지 않는다(ledger·event·log 없음). URL은 https이거나 loopback http(fake 발급자)다.
export const ISSUER_REQUEST_BODY_MAX = 65_536;

export function issuerUrlAllowed(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "[::1]" ||
      url.hostname === "localhost");
}

const issuerRequestSchema = z.strictObject({
  id: z.string().min(1).max(64),
  url: z.string().max(2048).refine(issuerUrlAllowed),
  method: z.enum(["GET", "POST"]),
  headers: z.record(
    z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
    // Bearer + ChatGPT access token(JWT)이 512자를 넘는다.
    z.string().max(4096),
  ),
  // GET이면 빈 문자열이다.
  body: z.string().max(ISSUER_REQUEST_BODY_MAX),
});
export type IssuerRequest = z.infer<typeof issuerRequestSchema>;

export const issuerRequestTake = defineMemory({
  resource: "issuer-requests",
  method: "take",
  name: "TakeIssuerRequest",
  input: z.strictObject({}),
  // 보낼 요청이 없으면 null이다. 가져간 요청은 runtime이 답하거나 기한이 지날 때까지 core가 기다린다.
  output: z.object({ request: issuerRequestSchema.nullable() }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

const issuerResponseSchema = z.strictObject({
  status: z.number().int().min(100).max(599),
  // redirect 판정에 쓰는 Location뿐이다. 다른 header는 옮기지 않는다.
  location: z.string().max(2048).nullable(),
  body: z.string().max(ISSUER_REQUEST_BODY_MAX),
});

export const issuerRequestDone = defineMemory({
  resource: "issuer-requests",
  method: "done",
  name: "FinishIssuerRequest",
  input: z.strictObject({
    id: z.string().min(1).max(64),
    // 발급자에 닿지 못했으면 null이다.
    response: issuerResponseSchema.nullable(),
  }),
  // 이미 기한이 지났거나 모르는 요청이면 accepted가 false다.
  output: z.object({ accepted: z.boolean() }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});
