---
type: flow
concerns: [documents/series, documents/contexts, lophn-agent/roles/operator, lophn-agent/assignments, shell/workspace]
---
# 반복 문서의 다음 편을 이어서 쓴다

매주 쓰는 보고나 번호 붙은 실험 기록처럼 같은 틀의 문서를 이어 쓰려 할 때 시작한다. 반복 문서는 따로 등록하지 않는다. context 계약의 series 자료가 가진 파일 이름 pattern이 정의이고, 다음 이름은 그 pattern과 지금 있는 파일로 lophn이 계산한다. 쓰는 쪽은 Operator나 다른 lophn agent, 또는 사람이다.

지키는 약속: documents#I5, documents#I1, documents#I6.

## 흐름

1. 사람이 flow/build-context에서 Context Engineer와 함께 계약에 series 자료를 둔다. 자료는 프로젝트 폴더 기준 상대 경로 pattern 하나다(예: `reports/weekly-{n}.md`). pattern에는 번호 자리 `{n}`·`{major}`·`{minor}`·`{patch}` 중 정확히 하나가 있고 `*`는 파일 이름 칸에서만 쓴다. 이름·제목·정렬 기준 같은 별도 등록은 없다. (documents/series#R1, documents/series#R2, documents/contexts#R11)
2. 첫 회차는 사람이 key를 직접 정해 평범한 파일 하나를 만든다. 이름이 pattern에 맞는 프로젝트 파일은 모두 멤버이고 번호 자리가 잡은 글자가 key다. 파일을 만들거나 지우거나 옮기면 멤버가 따라 바뀐다. 멤버가 없을 때는 다음 이름이 빈 제안이다. (documents/series#R3, documents/series#R6, documents/series#R10)
3. 다음 회차를 쓸 때가 되면 Operator가 주기에 맞춰 일하거나 사람이 Agent 탭에서 이어 쓰라고 요청한다. 쓰는 쪽이 context 도구로 다음 이름을 읽는다. lophn은 pattern과 지금 있는 파일 목록만으로 이름을 계산하고, 계산의 근거가 된 마지막 멤버와 그 이름이 이미 멤버에 있는지를 함께 알려 준다. 이 읽기는 파일을 만들지 않고 변경 기록도 남기지 않는다. 사람에게는 보이지 않는다. (documents/series#R5, documents/series#R9, documents/series#R10)
4. 계산은 정수 증가·감소, major·minor·patch 변경, 최대 4자리 0 채움을 지원한다. P001은 P002로, 0.2는 0.3 또는 1.0으로, 0.2.1은 0.2.2로, v1은 v2로 같은 결과를 낸다. 0 채움을 적지 않으면 마지막 멤버의 자리 수를 따르고, 멤버의 순서는 key의 숫자를 수로 비교한 자연 순서다. 사람에게는 보이지 않는다. (documents/series#R4, documents/series#R7)
5. 쓰는 쪽이 그 이름으로 평범한 프로젝트 파일을 하나 쓴다. 새 파일이 곧 새 멤버가 되며 문서마다 판이 따로 남지 않는다. Operator는 사람이 승인한 범위와 주기 안에서만 쓴다. (documents/series#R3, documents/series#R9, lophn-agent/assignments)
6. 사람이 프로젝트 폴더에서 새 파일을 문서 탭으로 열어 읽고 고친다. 고쳐도 멤버는 그대로 하나다. 선언된 검색이 series 자료를 쓰면 Search 탭에서 같은 자연 순서로 이전 회차와 나란히 본다. (shell/workspace#R1, shell/workspace#R25, documents/series#R4, documents/contexts#R11, documents/contexts#R17)

## 다른 갈래

- 처음에는 멤버가 없으므로 다음 이름이 빈 제안이다. pattern의 `*` 자리는 계산하지 않고 `*`로 남겨, 쓰는 쪽이 채우게 한다. (documents/series#R6)
- 마지막 멤버로 규칙을 계산할 수 없거나 이름에 날짜가 들어 있으면 오류 대신 빈 제안을 돌려준다. 날짜가 든 이름은 번호 pattern의 멤버가 아니므로 번호를 꾸며 내지 않고, 이름은 사람이 직접 정한다. (documents/series#R8)
- 계산한 이름이 이미 멤버에 있다고 알려 오면 그 사실만 알려 줄 뿐 lophn이 막거나 다른 이름을 대신 고르지 않는다. 쓰는 쪽이 이를 보고 사람에게 알린다. (documents/series#R5)
- 1에서 pattern이 번호 자리를 둘 이상 갖거나 하나도 없으면, 또는 5자리 이상 0 채움을 적으면 계약이 돌지 않으므로 묶음을 적용하는 격리 검사가 막는다. Context Engineer가 고쳐 다시 제출한다. (documents/series#R2, documents/series#R7, documents/contexts#R20)
- pattern과 어긋난 이름으로 둔 파일은 멤버가 아니다. 계약의 경로 pattern과 어긋난 이름이나 자리는 위반으로 세어져 Violations에 나온다. (documents/series#R3, documents/contexts#R24)
- series 등록, 가족 보관, draft, series 화면은 없다. 반복 문서를 정리하려면 파일을 직접 옮기거나 지우고, 계약의 pattern을 고치려면 Context Engineer에게 말한다. coding agent는 context에 접근하지 않으므로 이 흐름의 쓰는 쪽이 아니다. (documents/series#R1, documents/contexts#R27, coding-agent/mcp-server#R38)
- 연결이 끊기면 Agent 탭과 문서 탭의 마지막 화면과 작성 중 내용을 유지한다. 이름을 읽기만 한 것은 파일이 아니므로 재연결 뒤 다시 읽고 계산한다. (shell/desktop#R7, documents/series#R10)

## 끝

사람은 같은 pattern의 파일이 정한 순서로 쌓인 것을 보고, 다음 편의 이름이 규칙대로 정해진 것을 확인한다. 이름을 읽은 것만으로는 파일이 생기지 않았고, 멤버·순서·다음 이름은 파일 목록 말고 어디에도 따로 기억되지 않는다. (documents/series#R5, documents/series#R10)
