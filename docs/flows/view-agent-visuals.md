---
type: flow
concerns: [lophn-agent/visuals, lophn-agent/conversation, lophn-agent/roles/lophn, lophn-agent/harness/tools, shell/workspace, shell/app-frame, apps/blueprint, apps/sdk, apps/permissions, documents/formats, documents/versions, platform/redaction, platform/blob-store]
---
# 답 속 표와 앱 카드를 보고 문서로 남긴다

사람이 자료를 비교하거나 운영 상황을 설명해 달라고 요청했고, 글만으로는 이해하기 어려워 시각 표현이 포함된 답을 받는다. 사람은 필요한 결과만 읽고, 다시 쓸 부분만 문서로 남긴다.

연결된 intent: lophn-agent#I9, lophn-agent#I10, apps#I10, shell#I2, lophn-agent#I3, shell#I8.

## 흐름

1. conversation 화면 사람이 비교할 자료나 알고 싶은 운영 상황을 말한다. agent는 허용된 자료에서 필요한 근거만 읽고 확인된 사실과 해석을 구별한다. 자료 조회와 시각 명세 준비는 사람에게는 보이지 않는다. (lophn-agent/roles/lophn#R3, lophn-agent/roles/lophn#R18, lophn-agent/harness/tools#R8)
2. agent가 답의 해당 위치에 선언형 표·선 또는 막대 차트·도표를 넣고, 앱을 보여 줄 때는 카드 크기를 선언한 화면만 참조한다. 제목·설명·고정 문서 판 또는 앱 command 결과의 출처를 함께 남긴다. 명세 준비는 사람에게는 보이지 않는다. (lophn-agent/visuals#R1, lophn-agent/visuals#R2, lophn-agent/visuals#R4, apps/blueprint#R19)
3. machine이 종류·크기 상한·출처를 검사한 확정 명세를 메시지와 함께 저장하고 설치된 공용 SDK로 그린다. 임의 HTML·script를 shell 코드로 실행하지 않으며 앱 UI도 shell renderer로 가져오지 않는다. 검사·저장·격리 처리는 사람에게는 보이지 않는다. (lophn-agent/visuals#R1, lophn-agent/visuals#R2, lophn-agent/visuals#R3, lophn-agent/conversation#R13, shell/workspace#R12, shell/app-frame#R33, apps/sdk#R38)
4. conversation 화면 사람은 글과 시각 블록을 함께 읽고 필요하면 데이터·설명·출처를 확인한다. 새 답이 와도 읽던 위치와 focus를 잃지 않는다. app-card 화면 앱 카드는 원래 앱의 허락된 화면이며 카드를 열었다고 command 실행 권한이 늘어나지 않는다. (shell/workspace#R13, apps/sdk#R38, lophn-agent/visuals#R4, apps/permissions#R27)
5. conversation 화면 사람이 선택한 블록을 문서로 남기도록 요청한다. agent는 고정 명세·데이터·설명·출처·그 순간의 그림을 실행 코드 없는 HTML 본문으로 준비한 뒤, 별도 문서 저장 tool로 역할의 허용 범위와 format 계약에 맞춰 저장한다. 준비·검사·저장은 사람에게는 보이지 않는다. (lophn-agent/visuals#R6, lophn-agent/harness/tools#R19, lophn-agent/harness/tools#R6, lophn-agent/roles/lophn#R5, documents/formats#R4, documents/formats#R7)
6. 앱 카드를 남길 때는 앱이 허락한 redaction snapshot과 고정 앱 참조만 저장한다. snapshot을 얻지 못하면 그 부재와 참조를 남기고 live 앱·credential을 복제하지 않는다. redaction과 blob 참조 등록은 사람에게는 보이지 않는다. (lophn-agent/visuals#R7, platform/redaction#R5, platform/redaction#R14, platform/blob-store#R4)
7. document 화면 사람은 실제 저장한 문서의 고정 판을 열어 읽는다. 저장 성공과 검색 반영은 별개이며, 세션 화면을 닫거나 재시작한 뒤에도 conversation 화면 원래 메시지와 출처, 저장된 문서로 돌아온다. (documents/versions#R5, documents/versions#R6, documents/versions#R8, lophn-agent/conversation#R2, lophn-agent/conversation#R12)

## 다른 갈래

- 2~4에서 데이터가 비었거나 수집되지 않았으면 실제 값처럼 채우지 않는다. 사람은 빈 결과와 확인하지 못한 범위를 구별한다. (lophn-agent/visuals#R2)
- 3에서 블록이 너무 크면 일부를 전체처럼 자르지 않고 더 작은 블록을 요청한다. 미완성 응답은 확정 블록으로 남기지 않는다. (lophn-agent/visuals#R3, lophn-agent/conversation#R13)
- 4에서 renderer가 고장 나거나 앱·화면·release를 열 수 없으면 본문·설명·원래 참조와 이용 불가 이유를 남긴다. 다른 앱이나 최신 release로 몰래 대체하지 않는다. (lophn-agent/visuals#R5)
- 5에서 저장 범위가 맞지 않거나 format 검사에 실패하면 저장하지 않는다. 기존 문서의 최신 판이 바뀌었으면 충돌을 알리고 새 판을 덮지 않는다. (lophn-agent/harness/tools#R6, documents/formats#R4, documents/versions#R4)
- 5 전에 사람이 문서로 남기기를 그만두면 확정 메시지는 그대로 읽을 수 있고, 실제로 저장하지 않은 문서의 링크를 결과로 만들지 않는다. (lophn-agent/conversation#R4, lophn-agent/conversation#R12)
- 7에서 사람이 세션 자체를 끝내면 원래 세션은 읽기 전용으로 남는다. 이어서 일할 때는 원문을 참조하는 새 세션을 열며 블록 때문에 과거 동작을 재실행하지 않는다. (lophn-agent/conversation#R8, lophn-agent/conversation#R9, lophn-agent/conversation#R11)

## 끝

사람은 답 안의 글과 시각 표현을 같은 근거로 읽고, 남기기를 요청한 경우 실제 저장된 고정 문서를 다시 열 수 있다. 이용할 수 없는 앱이나 snapshot은 부재로 남고, 문서가 live 앱처럼 동작하지 않는다. (lophn-agent/visuals#R5, lophn-agent/visuals#R6, lophn-agent/visuals#R7, documents/versions#R6)
