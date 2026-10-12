---
name: lophn-navigate
description: "lophn 문서·프로젝트·앱을 찾고 읽는 절차. 사람이 lophn에 쌓은 자료를 보고 답하거나 작업 근거를 모을 때 쓴다. 읽기만 하며 저장·수리·claim을 시작하지 않는다."
---

# lophn 탐색

lophn의 문서·프로젝트·앱을 찾아 읽는 절차다. 이 절차는 읽기만 한다. 목차나
요약을 읽는 것은 어떤 작업의 착수 지시도 아니다.

## 통로

MCP tool 이름이다. MCP가 없으면 같은 이름의 CLI command(`lophn index`,
`lophn read`)가 같은 사실을 준다.

- `lophn_index`: op `root`, `place`, `document`, `section`, `search`, `status`
- `lophn_project`: op `list`, `show`, `current`
- `lophn_document`: op `list`, `history`, `diff`
- `lophn_read`: 고정 판의 본문
- `lophn_series`: op `list`, `show`, `next`

## 순서

1. 전체 목차부터 본다. `lophn_index` op `root`로 어떤 프로젝트·앱이 있는지
   읽는다. 지금 작업 위치가 어느 프로젝트인지는 `lophn_project` op `current`로
   확인한다.
2. 질문이 어느 자료에 닿는지 고른다. 이름을 알면 `lophn_index`의 op
   `place`(프로젝트·앱 자리)로 내려가고, 모르면 op `search`의 keyword로 찾는다.
   op `status`에 반영 지연이나 누락 표시가 있으면 검색 결과가 전부라고 말하지
   않는다.
3. 문서는 목차(`lophn_index` op `document`)에서 절(op `section`)로 내려간 뒤
   `lophn_read`로 읽는다. 읽을 때는 고정 판(version)을 지정한다. 결과에 새 판
   존재, 남은 범위, 이어 읽기 cursor, 추출 한계가 있으면 그대로 따른다.
4. 판이 바뀐 것이 궁금하면 `lophn_document` op `history`와 `diff`를 쓴다. 이름이
   바뀐 것은 추정하지 않는다.

## 보고

읽은 자료는 문서·판·절 주소로 적는다. 읽지 못한 자료(범위 밖, 잘림, 추출 실패)는
읽지 못했다고 쓴다.

## 하지 않는 것

- 사람 원본 파일을 직접 열거나 경로를 추측해 읽지 않는다. lophn이 준 주소로만
  읽는다.
- 프로젝트 등록은 바꾸지 않는다. 바꾸고 싶으면 사람에게 알린다.
- 목록·요약·질문(`lophn_question`)·approval(`lophn_approval`)을 읽었다고 일을
  시작하지 않는다. ticket 목록이 보여도 사람이 그 ticket을 지정하기 전에는
  claim하지 않는다.
