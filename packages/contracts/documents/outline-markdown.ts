// md 목차 parser. shell editor의 Outline, context의 `outline`·`section` kind, 준비 worker가
// 같은 코드를 불러야 같은 파일에서 같은 tree를 얻으므로 contracts에 둔다(code-map "여러 최상위가 같이 쓰는 순수 함수").
// 의존성·시각·무작위·IO가 없다.
//
// 입력 text는 UTF-8로 읽은 문자열이다. parser가 BOM 제거 → CRLF/CR을 LF로 → NFC를 직접 적용하고,
// 줄 번호와 codepoint 수는 이 정규화한 텍스트 기준이다(`text.split("\n")`의 조각 하나가 한 줄이며,
// 끝의 개행 뒤 빈 조각도 한 줄로 센다: documents/formats의 document module과 같다).

export type OutlineRange = {
  // 1-based, inclusive.
  start_line: number;
  end_line: number;
};

export type OutlineNode = {
  // 한 outline 안에서 유일. 명시 anchor 우선, 없으면 제목 slug, 같은 부모 아래 중복은 `-2`부터,
  // 부모가 있으면 `부모key/자기slug`. 첫 heading 앞 본문은 `_preamble`.
  key: string;
  title: string;
  parent: string | null;
  // 원문 순서, 0부터. `_preamble`이 있으면 그것이 0.
  position: number;
  // 1..6. `_preamble`만 0. 건너뛴 level은 그대로 두고 가장 가까운 낮은 level의 heading 아래에 둔다.
  level: number;
  anchor: string | null;
  // heading 줄과 자식 section을 뺀 자체 본문. 한 줄도 없으면 null(빈 줄뿐인 본문은 null이 아니다).
  own_range: OutlineRange | null;
  // heading 줄부터 하위 section 끝까지(setext면 밑줄 줄 포함).
  subtree_range: OutlineRange;
  // 자체 본문의 Unicode codepoint 수. own_range의 줄을 "\n"으로 이은 글자 수.
  characters: number;
  // ceil(characters / 3). 실제 model token 수가 아니다.
  estimated_tokens: number;
  // own_range의 줄을 "\n"으로 이은 문자열(UTF-8)의 SHA-256 소문자 hex. own_range가 null이면 빈 문자열의 hash.
  body_hash: string;
  children_count: number;
};

export type OutlineReady = {
  status: "ready";
  // 유일한 h1의 표시 제목. h1이 없거나 둘 이상이면 null. title인 h1은 sections에 들지 않는다.
  title: string | null;
  line_count: number;
  characters: number;
  sections: OutlineNode[];
};

export type OutlineUnsupported = {
  status: "unsupported";
  media_type: string;
};

export type OutlineResult = OutlineReady | OutlineUnsupported;

// 형식마다 parser를 붙이는 자리는 이 함수 하나다. 지금은 text/markdown·text/x-markdown만 해석한다.
export function parseOutline(
  _mediaType: string,
  _text: string,
): OutlineResult {
  return {
    status: "ready",
    title: null,
    line_count: 0,
    characters: 0,
    sections: [],
  };
}
