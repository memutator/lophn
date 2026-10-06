import {
  REDACT_SPANS_MAX,
  redactRequestSchema,
  type RedactResponse,
} from "../../packages/contracts/platform/mod.ts";
import type { KnownSecretMatch } from "../../packages/platform/ledger/mod.ts";
import { matchCredential } from "../../packages/platform/redaction/mod.ts";

// agent runtime의 안전화 요청(감독 pipe `redact_request`)을 core가 답한다(lophn-agent/harness/run-loop).
// 지울 자리는 제품 redactor(`createProductRedactor`)와 같은 규칙이다: 고정한 credential 검출 규칙과 core
// 보호 메모리의 알려진 secret 값(provider·connection token 포함). 알려진 값을 아직 다 모르거나 요청이
// 올바르지 않으면 ok=false이고 child는 그 글을 보내지 않는다. 값 목록·개수는 child로 가지 않는다.

type Span = { index: number; length: number };

// 한 조각 안의 지울 자리. 겹치면 앞에서 시작하는, 같으면 더 긴 쪽이다.
function spansOf(text: string, known: KnownSecretMatch): Span[] {
  const spans: Span[] = [];
  let offset = 0;
  let rest = text;
  while (rest.length > 0) {
    const pattern = matchCredential(rest);
    const secret = known.match(rest);
    const found = pattern && secret
      ? (secret.index < pattern.index ||
          (secret.index === pattern.index && secret.length > pattern.length)
        ? secret
        : pattern)
      : pattern ?? secret;
    if (!found) break;
    spans.push({ index: offset + found.index, length: found.length });
    offset += found.index + found.length;
    rest = rest.slice(found.index + found.length);
  }
  return spans;
}

export function answerRedactRequest(
  message: unknown,
  known: KnownSecretMatch | undefined,
): RedactResponse | undefined {
  const parsed = redactRequestSchema.safeParse(message);
  if (!parsed.success) return undefined;
  const failed: RedactResponse = {
    type: "redact_response",
    request_id: parsed.data.request_id,
    ok: false,
  };
  if (known === undefined || !known.ready) return failed;
  let total = 0;
  const spans = parsed.data.windows.map((window) => {
    const found = spansOf(window, known);
    total += found.length;
    return found;
  });
  if (total > REDACT_SPANS_MAX) return failed;
  return {
    type: "redact_response",
    request_id: parsed.data.request_id,
    ok: true,
    spans,
  };
}
