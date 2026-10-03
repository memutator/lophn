---
type: flow
concerns: [documents/terms, documents/contexts, documents/outline-and-search, documents/versions, lophn-agent/roles/context-engineer, lophn-agent/questions, platform/ledger, shell/confirmation-window, shell/desktop]
---
# 내 자료에서 쓰는 말의 뜻을 정한다

문서마다 같은 말이 다른 뜻으로 쓰여 읽기와 판단이 헷갈리는 사람이, 특정 목적의 자료에서 자신이 쓸 뜻을 정한다.

지키는 약속: documents#I6, lophn-agent#I1, lophn-agent#I7.

## 흐름

1. contexts 화면 사람이 뜻을 정리할 자료와 목적을 고른다. 같은 말이라도 다른 목적에서 정한 뜻을 자동으로 가져오지 않는다. 필요한 경우 conversation 화면에서 Context Engineer에게 정리를 요청한다. (documents/contexts#R1, documents/contexts#R2, documents/terms#R3, lophn-agent/roles/context-engineer#R1, shell/desktop#R1)
2. Context Engineer가 자료의 목차에서 시작해 필요한 본문만 읽고, 같은 context의 서로 다른 문서 3개 이상에 그대로 나타나는 미등록 말을 후보로 모은다. 후보마다 최대 5개 출현 근거를 고정 판과 section 또는 줄 범위로 남긴다. agent는 이름과 근거를 다루고 뜻을 확정하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/roles/context-engineer#R3, lophn-agent/roles/context-engineer#R8, documents/outline-and-search#R8, documents/terms#R1, documents/terms#R2)
3. contexts 화면 사람이 이미 정한 뜻과 아직 정하지 않은 후보를 구별해서 본다. conversation 화면에서 결정을 필요로 하는 말의 근거와 미정 선택, 추천 이유를 확인하고 자신이 쓸 이름·뜻을 명시적으로 답하거나 미룬다. 선택만 하거나 일반 메시지로 긍정한 것은 정의 확정이 아니다. (documents/terms#R4, lophn-agent/roles/context-engineer#R10, lophn-agent/questions#R1, lophn-agent/questions#R3, lophn-agent/questions#R4, lophn-agent/questions#R6)
4. 사람이 고른 선택지에 정확한 context·이름·뜻이 고정돼 있으면 machine이 그 답의 확정을 사람의 결정으로 받아 적용한다. 별도 확인 창은 열지 않는다. 자유 답은 정의로 자동 해석하지 않고 적용할 내용이 고정된 새 선택지 또는 사람 직접 요청으로 다시 확인한다. (documents/terms#R2, lophn-agent/questions#R13, lophn-agent/questions#R15, lophn-agent/questions#R6)
5. machine이 유효한 사람 결정의 정확한 내용만 한 번 적용하고 결정 주체·출처와 변경 기록을 남긴다. 이후 agent가 읽는 목록에서도 사람 정의와 미정 후보를 구별한다. 사람에게는 보이지 않는다. (lophn-agent/questions#R13, documents/terms#R1, documents/terms#R2, documents/terms#R4, platform/ledger#R3, platform/ledger#R10)
6. contexts 화면 사람이 자신이 정한 뜻이 실제로 반영된 결과를 확인한다. 마음에 들지 않으면 새 이름·뜻을 명시적으로 결정하는 3~5를 다시 거친다. 이전 출처를 덮어쓰거나 agent의 추정으로 수정하지 않는다. (documents/terms#R2, lophn-agent/questions#R10, platform/ledger#R10)

## 다른 갈래

- 2에서 자료가 3개 미만이거나 본문 출현 근거가 없으면 Context Engineer의 후보 조건을 충족한 것처럼 표시하지 않는다. 사람은 직접 자신의 뜻을 정할 수 있지만 agent가 자동 확정하지 않는다. (lophn-agent/roles/context-engineer#R8, documents/terms#R1, documents/terms#R2)
- 2에서 필요한 자료를 읽을 수 없거나 검색 반영이 늦으면 누락·지연을 구별한다. 빈 결과를 원문이나 말의 부재로 단정하지 않는다. (documents/outline-and-search#R14, documents/outline-and-search#R22)
- 3에서 미루거나 답하지 않으면 해당 정의 변경을 보류한다. 명시 미루기·취소·만료는 답 없음으로 남고 추천을 자동 채택하지 않는다. (lophn-agent/roles/context-engineer#R10, lophn-agent/questions#R8)
- 4에서 전제가 바뀌면 답은 보존하지만 옛 내용으로 적용하지 않고 달라진 대상과 이유를 다시 보여 준다. 선택만 하거나 창을 닫는 것은 결정이 아니다. (lophn-agent/questions#R14, lophn-agent/questions#R6)
- 다른 context의 같은 이름에 다른 뜻이 있어도 합치지 않는다. context나 용어를 보관해도 사람 정의와 출현 근거는 남는다. (documents/terms#R3, documents/terms#R5)
- 연결이 끊기면 마지막 화면과 최신 확인 못함을 유지한다. 작성하던 답은 보존하고 재연결 뒤 실제 적용 결과를 조회한다. (shell/desktop#R7, shell/desktop#R8, lophn-agent/questions#R10)

## 끝

사람이 고른 context에서 자신의 뜻이 반영된 결과를 보거나, 미정으로 남긴 말이 정의와 섞이지 않은 것을 확인한다. 답 접수만으로 적용 완료라고 하지 않는다. (documents/terms#R4, lophn-agent/questions#R10)
