// 문서 출력(agent 본문·export)의 제품 redactor. handler 입구가 동기라서 platform
// redaction engine(async)이 아니라 같은 검출 규칙(matchCredential)을 동기로 적용한다.
// 입력은 항상 JS 문자열(본문 조각·제목)이다. 지우는 것은 두 가지다.
// - pattern 검출: 고정한 credential prefix·PEM 규칙(matchCredential).
// - 알려진 secret 원문: reader Worker의 보호 메모리 registry다. 값은 core가 reader pool의
//   등록·회수 통로로 넣고(apps/core/secret-store.ts), 이 redactor는 일치 검사만 하는
//   matcher를 받는다. 값 목록도 module 전역 상태도 이 파일에 없다.
// 한 자리에서 둘이 겹치면 더 앞에서 시작하는, 같으면 더 긴 쪽을 지운다. 안전화를 끝내지
// 못하면 null로 답해 원문이 나가지 않게 한다(fail-closed).
import { REDACTION_REPLACEMENT } from "../../packages/contracts/platform/mod.ts";
import type { KnownSecretMatch } from "../../packages/platform/ledger/mod.ts";
import { matchCredential } from "../../packages/platform/redaction/mod.ts";

export type DocumentRedactor = (
  source: { concern: string; revision: string; scope: string },
  mediaType: string,
  text: string,
) => string | null;

export function createProductRedactor(
  known?: KnownSecretMatch,
): DocumentRedactor {
  return (_source, _mediaType, text) => {
    // 알려진 값을 아직 다 모르면 안전화를 끝낼 수 없다.
    if (known !== undefined && !known.ready) return null;
    let out = "";
    let rest = text;
    while (rest.length > 0) {
      const pattern = matchCredential(rest);
      const secret = known?.match(rest);
      const found = pattern && secret
        ? (secret.index < pattern.index ||
            (secret.index === pattern.index && secret.length > pattern.length)
          ? secret
          : pattern)
        : pattern ?? secret;
      if (!found) {
        out += rest;
        break;
      }
      out += rest.slice(0, found.index) + REDACTION_REPLACEMENT;
      rest = rest.slice(found.index + found.length);
    }
    return out;
  };
}
