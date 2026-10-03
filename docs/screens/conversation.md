---
type: screen
concerns: [lophn-agent/conversation, lophn-agent/questions, lophn-agent/visuals, shell/desktop]
---
# Conversation

사람이 agent와 대화하며 질문에 답하고 결과를 본다.

Conversation은 독립 공간이 아니라 모든 공간에서 토글하는 도크다(shell/desktop#R1). 역할·대상은 세션을 여는 순간 고정되고 세션 중 바뀌지 않는다(lophn-agent/conversation#R1).

## 보이는 것

1. **메시지 목록** — 사람의 말과 역할의 확정 답을 시각으로 구분해서 쌓는다. 각 답에는 실제로 만든 것(문서, 앱, Version 등)의 링크만 붙고, 계획만 말한 것에는 링크가 없다(lophn-agent/conversation#R4). 답 4개 이상이면 처음 3개와 "+N more"로 줄인다(shell/desktop#R3).
2. **지금 일의 상태** — 메시지 옆에 In progress / Waiting for your answer / Stopped / Done 중 하나만 보인다(screens/README#3 — run은 상태만 보인다).
3. **질문/승인 한 칸** — 입력창 바로 위, 동시에 하나만 보인다. blocking인 것이 먼저이고 나머지는 접수 순서다. "지금 3개 중 1번째" 같은 위치와 앞뒤 이동이 함께 있다(shell/desktop#R6).
   - 질문이면: 설명이 붙은 선택지(추천 이유 포함)와 자유 입력, Defer·Cancel(lophn-agent/questions#R3, R4).
   - 승인이면: 정확한 대상·영향·되돌릴 수 있는지와 결정 버튼 하나 — 실제 결정은 confirmation-window에서 받는다(shell/confirmation-window#R1).
4. **입력창** — 항상 입력을 받는다. 지금 일이 진행 중이면 이 메시지가 "지금 일 수정"인지 "끝난 뒤 새 일"인지 고르는 작은 전환 하나가 입력창 위에 붙는다(lophn-agent/conversation#R5, R6).
5. **시각 블록** — 표·차트·도표·앱 카드가 답 본문 사이 원래 순서로 보인다(lophn-agent/conversation#R12, lophn-agent/visuals#R1). 각 블록에는 제목·출처·관측 시각과 Save as document가 있다(shell/workspace#R13).
6. **답 하나의 "Details" 펼침** — 무엇을 근거로 했는지, 실제 비용 추정, 되돌릴 수 있는 변경이면 "Revert"가 있다(lophn-agent/observability, lophn-agent/revert). Revert의 실제 결정은 confirmation-window에서 받는다.

## 숨긴 것

- run, invocation, assignment, handoff, ledger 같은 안쪽 개념은 화면 어디에도 이름으로 나오지 않는다(screens/README#3).
- 지금 일의 수정 원문이 쌓이는 순서·다음 모델 판단에 반영되는 시점은 보이지 않는다. 사람에게는 "접수됨"과 "반영됨"만 구별해서 보인다(lophn-agent/conversation#R3).
- 세션을 이어갈 때 쓰는 요약은 기본으로 숨고, "Summary used"를 펼쳐야 그 요약과 원문 구간 출처가 보인다(lophn-agent/conversation#R10).
- 모델 호출별 원가·cache 비용 같은 상세는 "Details"를 펼쳐야 보이고, 기본 화면에는 지금 결과와 다음 행동만 있다(lophn-agent/observability).

## 행동

- 주 행동은 **보내기**다(screens/README#G4).
- 질문에는 선택지를 고르거나 자유 입력을 쓰고 명시적으로 답을 보내야 적용된다. 선택만으로는 아무 일도 생기지 않는다(lophn-agent/questions#R4, R6).
- 진행 중인 일은 **Stop**으로 멈출 수 있다. 멈춤 요청과 실제 끝은 구별해서 보인다(lophn-agent/conversation#R6, shell/desktop#R5).
- 멈췄거나 끝난 run은 **Try again**으로 새로 시작하고, 자동으로 다시 시작하지 않는다(lophn-agent/conversation#R6).
- 세션이 끝났으면 입력창 대신 "This conversation has ended"와 **Start a new conversation from here**만 보이고, 원문 일부를 골라 새 세션으로 이어간다(lophn-agent/conversation#R9, R10).
- 답의 **Revert**는 되돌릴 수 있는 변경에만 보이고 confirmation-window로 이어진다(lophn-agent/revert).

## 상태

- **비었음** — 새 세션의 첫 화면에는 "Say what you want"류 안내 한 줄과 입력창만 있다.
- **불러오는 중** — 지난 메시지를 불러오는 동안 300ms 뒤 skeleton(shell/design-system#R1).
- **진행 상태** — In progress / Waiting for your answer / Stopped / Done.
- **보내는 중/못 보냄** — 전송이 불명확하면 재전송보다 "Checking if this was received"를 먼저 보인다(shell/desktop#R8).
- **연결 끊김** — 마지막으로 확인한 메시지와 확인 시각을 유지하고 다시 연결되면 그 사이 놓친 진행을 한 번에 몰아 보이지 않는다(shell/desktop#R7).
- **세션 끝남** — 읽기는 계속되고 새 입력은 받지 않는다(lophn-agent/conversation#R8).
- **블록 깨짐** — 시각 블록이 깨져도 본문 글과 설명·원래 참조는 남는다(lophn-agent/visuals#R5).

## 문구

| key | en |
|---|---|
| conversation.empty.title | Say what you want lophn to do |
| conversation.compose.placeholder | Message |
| conversation.compose.send | Send |
| conversation.compose.mode.update | Update this |
| conversation.compose.mode.queue | New request after this |
| conversation.run.in_progress | In progress |
| conversation.run.waiting | Waiting for your answer |
| conversation.run.stopped | Stopped |
| conversation.run.done | Done |
| conversation.run.stop | Stop |
| conversation.run.try_again | Try again |
| conversation.results.more | {count, plural, one {# more result} other {# more results}} |
| conversation.question.position | {current} of {total} |
| conversation.question.defer | Decide later |
| conversation.question.cancel | Cancel |
| conversation.reply.details | Details |
| conversation.reply.revert | Revert |
| conversation.summary.used | Summary used |
| conversation.send.checking | Checking if this was received |
| conversation.ended.title | This conversation has ended |
| conversation.ended.continue | Start a new conversation from here |

## 크기와 접근성

- 넓은 창에서는 본문 옆 400px 도크, 본문 480px를 지킬 수 없으면 overlay로 바뀌고 닫으면 이전 정보 패널 상태로 돌아간다(shell/desktop#R2, R29).
- 질문/승인 칸의 앞뒤 이동과 모든 조작은 키보드로 닿는다(shell/design-system#R2).
- 새 답이 와도 사람이 읽던 스크롤 위치와 입력 focus는 그대로 유지된다(shell/workspace#R13).
- 메시지의 발화자(사람/역할/machine 확인)와 시각은 색이 아니라 글로도 구별된다(shell/design-system#R2, R10).
