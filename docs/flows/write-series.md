---
type: flow
concerns: [documents/series, documents/versions, documents/formats, documents/outline-and-search, platform/ledger, shell/editor, shell/desktop]
---
# 반복 문서의 다음 편을 이어서 쓴다

사람이 매주 쓰는 보고처럼 같은 틀의 문서를 이어서 쓰려 할 때 시작한다. 가족 규칙과 다음 이름은 lophn이 계산하고, 사람은 첫 key와 내용을 정한다. Operator는 기존 문서의 새 판만 쓰며 가족의 다음 문서를 만들지 않는다.

지키는 약속: documents#I5, documents#I2, documents#I1.

## 흐름

1. documents 화면 사람이 프로젝트나 앱 자리에서 series를 등록하고 이름·제목·문서 format·정렬 기준·다음 이름 규칙을 정한다. 가족은 문서 간 관계 대신 멤버십으로 이어지며 lophn agent의 가족 등록은 받지 않는다. (documents/series#R1, documents/series#R12)
2. documents 화면 사람이 첫 멤버의 key를 직접 정하고 내용을 쓴다. 빈 가족이나 규칙으로 읽을 수 없는 key에서는 다음 이름을 자동으로 꾸미지 않는다. 저장은 가족과 비어 있지 않은 key를 함께 정하고, key는 문서 이름과 별개이며 그 가족 안에서 유일하다. (documents/series#R2, documents/series#R7, shell/editor#R1)
3. lophn은 멤버를 같은 자리와 정한 format의 고정 판으로 확정하고 확인된 주체의 변경 기록을 남긴다. 멤버를 고쳐도 같은 문서의 새 판이 생길 뿐 새 멤버가 되지 않는다. 사람에게는 보이지 않는다. (documents/series#R3, documents/series#R14, documents/versions#R2, platform/ledger#R3)
4. documents 화면 사람이 다음 편을 쓰려 하면 lophn이 마지막 key와 저장한 규칙으로 다음 key를 제안하고 계산 근거 key와 이미 쓰인 이름 여부를 함께 보여 준다. 제안은 저장하지 않으며 문서를 만들지 않는다. 지원 규칙은 정수 증가·감소와 major·minor·patch 변경, 최대 4자리 0 채움이다. 계산은 사람에게는 보이지 않는다. (documents/series#R6, documents/series#R8)
5. documents 화면 사람이 제안이나 직접 고친 key로 다음 멤버를 저장한다. 작성 중 값은 가족의 draft 하나로 보존하고 확정 전에는 문서나 context 대상으로 읽히지 않는다. 저장 상태와 판 확정은 서로 다른 결과로 보여 준다. (documents/series#R2, documents/series#R11, shell/editor#R2)
6. documents 화면 사람이 가족 목록과 목차에서 같은 순서의 key·제목·고정 최신 판·보관 상태를 본다. 순서는 format의 정렬 값이 있으면 그 값으로, 없으면 key로 정하고 key의 숫자 부분은 수로 비교한다. (documents/series#R4, documents/series#R5, documents/outline-and-search#R1)
7. documents 화면 사람이 가족을 보관하거나 해제한다. 가족 보관은 멤버 문서의 보관이 아니며 가족 삭제는 제공하지 않는다. 보관 뒤에도 멤버 구성과 key, 확정 판을 읽는다. (documents/series#R10, documents/series#R13, documents/versions#R11, documents/versions#R12)

## 다른 갈래

- 1에서 해석할 수 없는 규칙이나 5자리 이상 0 채움을 등록하려 하면 거절하고 다시 고르게 한다. 날짜 key는 사람이 직접 정한다. (documents/series#R8, documents/series#R7)
- 2·5에서 key 없이 가족만 지정하거나 이미 쓴 key를 다시 쓰면 저장하지 않는다. 멤버에서 뺀 key도 다른 문서에 재사용하지 않는다. (documents/series#R2)
- 3에서 format이나 자리가 가족의 규칙과 다르면 멤버로 받지 않는다. 저장 중 기준 판이 바뀌면 충돌로 멈추고 사람의 판을 덮지 않는다. (documents/series#R3, documents/versions#R4)
- 4에서 다음 제안을 여러 번 읽어도 문서가 늘지 않는다. 목록 읽기와 재조회는 변경 기록을 만들지 않는다. (documents/series#R6, documents/series#R14)
- lophn agent는 가족 목록·상세·다음 제안만 읽고 가족 등록·구성 변경·멤버 추가·보관·draft 변경을 하지 못한다. 허용된 앱과 coding agent의 등록·멤버 저장은 받는다. (documents/series#R9)
- 연결이 끊기면 documents 화면에서 마지막 확인 상태와 작성 중 draft를 유지하고, 재연결 뒤 실제 저장된 판을 확인한다. 확인하지 못한 저장을 성공으로 채우지 않는다. (documents/series#R11, shell/editor#R2)

## 끝

사람은 같은 가족의 멤버를 정한 순서로 읽고, 다음 편의 이름과 자리가 규칙대로 정해진 것을 확인한다. 제안만 본 것은 저장과 구별되고, 가족을 정리해도 멤버 문서와 옛 판은 남는다. (documents/series#R4, documents/series#R6, documents/series#R13)
