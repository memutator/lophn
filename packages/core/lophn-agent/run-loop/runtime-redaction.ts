import {
  REDACT_SPANS_MAX,
  redactRequestSchema,
  type RedactResponse,
} from "../../../protocol/supervision/mod.ts";
import type { KnownSecretMatch } from "../../storage/ledger/mod.ts";
import {
  credentialPrefixFrom,
  matchCredential,
  REDACTION_REPLACEMENT,
} from "../../../base/redaction/mod.ts";

// agent runtime의 안전화 요청(감독 pipe `redact_request`)을 core가 답한다.
// 지울 자리는 제품 redactor(`createProductRedactor`)와 같은 규칙이다: 고정한 credential 검출 규칙과 core
// 보호 메모리의 알려진 secret 값(provider·connection token 포함). 알려진 값을 아직 다 모르거나 요청이
// 올바르지 않으면 ok=false이고 child는 그 글을 보내지 않는다. 값 목록·개수는 child로 가지 않는다.
// core가 child가 보낸 쓰는 중인 model 글을 화면에 내기 전에 같은 규칙으로 가리고, 아직 다 오지 않았을 수
// 있는 secret의 시작부터는 붙잡는다(`redactSettled`). 붙잡는 자리는 core 안에서만 쓰고 child에 답하지
// 않는다. 답하면 child가 글을 골라 거듭 물어 값을 앞에서부터 한 자씩 맞춰 볼 수 있다.

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

// 아직 다 오지 않았을 수 있는 secret이 시작하는 자리. 알려진 값의 앞부분과 credential 규칙의
// 앞부분 중 이른 쪽이고, 그 자리가 span 안에 떨어지면 span의 시작으로 내린다. 그 자리에서 자르면
// span의 앞부분이 지워지지 않은 채 나가기 때문이다.
function holdFrom(
  text: string,
  known: KnownSecretMatch,
  spans: readonly Span[],
): number | null {
  const knownFrom = known.prefixFrom(text);
  const credentialFrom = credentialPrefixFrom(text);
  const hold = knownFrom === undefined
    ? credentialFrom
    : credentialFrom === undefined
    ? knownFrom
    : Math.min(knownFrom, credentialFrom);
  if (hold === undefined) return null;
  for (const span of spans) {
    if (span.index < hold && hold < span.index + span.length) return span.index;
  }
  return hold;
}

// 한 model 호출에서 쌓인 날 글 전체를 지우고, 아직 다 오지 않았을 수 있는 secret의 시작부터는 붙잡는다.
// 붙잡은 자리 앞의 글은 뒤에 글이 더 와도 바뀌지 않으므로 부르는 쪽은 앞서 낸 길이 뒤만 내면 된다.
// 알려진 값을 다 모르면 원문을 내지 않도록 null이다(fail-closed).
export function redactSettled(
  text: string,
  known: KnownSecretMatch | undefined,
): string | null {
  if (known === undefined || !known.ready) return null;
  const spans = spansOf(text, known);
  const hold = holdFrom(text, known, spans) ?? text.length;
  let out = "";
  let end = 0;
  for (const span of spans) {
    if (span.index + span.length > hold) break;
    out += text.slice(end, span.index) + REDACTION_REPLACEMENT;
    end = span.index + span.length;
  }
  return out + text.slice(end, hold);
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
