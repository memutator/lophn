// 문서 출력(agent 본문·export)의 제품 redactor. handler 입구가 동기라서 platform
// redaction engine(async)이 아니라 같은 검출 규칙(matchCredential)을 동기로 적용한다.
// 입력은 항상 JS 문자열(본문 조각·제목)이다. 알려진 secret 원문 registry는 core 보호
// 메모리에 있고 reader Worker에는 없다: 이 조립은 pattern 검출만 한다(documents#T11
// 진행 줄). 안전화를 끝내지 못하면 null로 답해 원문이 나가지 않게 한다(fail-closed).
import { REDACTION_REPLACEMENT } from "../../packages/contracts/platform/mod.ts";
import { matchCredential } from "../../packages/platform/redaction/mod.ts";

export type DocumentRedactor = (
  source: { concern: string; revision: string; scope: string },
  mediaType: string,
  text: string,
) => string | null;

export function createProductRedactor(): DocumentRedactor {
  return (_source, _mediaType, text) => {
    let out = "";
    let rest = text;
    while (rest.length > 0) {
      const found = matchCredential(rest);
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
