---
type: screen
concerns: [problems/feedback, shell/app-frame]
---
# report-problem

사람이 지금 보던 앱 화면에서 이상을 글로 알린다.

앱 공간·패널·카드의 [Report a problem] 버튼(shell/app-frame#R31, R34)을 누르면 shell overlay view에 뜨는 dialog다. 버튼을 누른 그 순간의 화면만 먼저 캡처한 뒤 열리므로(problems/feedback#R5), 이 화면이 뜰 때는 캡처 성공·실패가 이미 정해져 있다.

## 보이는 것

1. **지금 겪은 일**(필수, 빈 줄 포함 1~500자): 사람이 직접 쓰는 글 하나뿐이다(problems/feedback#R1). 앱이나 agent가 대신 채울 수 없다.
2. **이미 연결된 Issue가 있으면** 그 이름을 읽기 전용으로 보인다(예: "Adding to: Can't import bank file"). [Report a problem]을 Issue 화면의 "Still not working" 같은 자리에서 열었을 때만 나타나고, 평소에는 보이지 않는다(problems/feedback#R13, R14).
3. **같이 보낼 자료** 두 줄:
   - "Include this screen's state" — 기본 선택됨. 화면 이름·탭·path 정도만 담았다는 한 줄 설명.
   - "Include a screenshot" — 기본 선택 안 됨. 누르면 redaction된 미리보기 이미지가 먼저 보이고, 그걸 본 뒤에만 선택할 수 있다(problems/feedback#R6).
   - 둘 중 하나라도 모으지 못했으면 체크박스 대신 이유 한 줄(예: "No screenshot available")을 보인다(problems/feedback#R10).
4. **Send** 버튼 하나(주 행동). 글이 비었으면 비활성화된다.

## 숨긴 것

- 화면 상태에 실제로 어떤 값이 들어갔는지(안전한 hash·path 수준)는 "Include this screen's state" 옆의 "Details" 펼침에서만 보인다. URL query 값·업무 DB 원문·command 입력은 애초에 담기지 않으므로 펼쳐도 없다(problems/feedback#R7).
- lophn이 알아서 처리해 화면에 전혀 나오지 않는 것: 글과 선택한 자료의 redaction 처리, 어느 앱·release의 report인지 식별, 제출 뒤 기존 Issue와 합칠지 새 Issue로 둘지 정하는 일(problems/feedback#R3). "비슷해 보인다"는 이유만으로 같은 원인이라고 화면에 단정하지 않는다.
- 제출 전 임시 글은 메모리에만 있고 복구를 보장하지 않는다는 사실은 화면에 따로 경고하지 않되, 접수 실패 시에는 복사 가능한 글로 남긴다(problems/feedback#R11).

## 행동

- **주 행동**: Send. 접수 중에는 "Sending…"으로 바뀌고 다시 누를 수 없다.
- **보조 행동**: 체크박스 두 개로 첨부 제외, screenshot 미리보기 열기, Cancel(닫기).
- Cancel이나 Escape, dialog 바깥 클릭은 미제출 글을 그대로 버린다. 이미 접수된 Issue는 이 동작으로 지워지지 않는다(problems/feedback#R12).

## 상태

- **입력 중**: Send 전 기본 상태.
- **Sending…**: 접수 요청을 보낸 뒤부터 응답까지.
- **Sent**: "Problem reported" 한 줄과 "View issue"(연결된 Issue로 이동) 링크. 접수와 실제 반영을 구별하지 않고, 접수 자체가 이 화면의 끝이다(problems/feedback#R11).
- **Couldn't send**: 실패 대상과 다음 행동(Retry)을 먼저 보이고, 쓴 글은 그대로 남아 복사할 수 있다(problems/feedback#R11, shell/wording#R10).
- **No screenshot available** / **Screen state not available**: 각각의 이유를 체크박스 자리에서 설명으로 대신한다. 글만으로도 Send는 그대로 된다(problems/feedback#R10).
- **앱이 깨졌을 때**: 뒤의 앱 view가 멈추거나 crash여도 이 dialog와 Send는 그대로 동작한다(shell/app-frame#R32).

## 문구

| key | en |
|---|---|
| report-problem.title | Report a problem |
| report-problem.description.label | What's wrong? |
| report-problem.context.adding_to | Adding to: {issueName} |
| report-problem.attachments.state.label | Include this screen's state |
| report-problem.attachments.state.unavailable | Screen state not available |
| report-problem.attachments.screenshot.label | Include a screenshot |
| report-problem.attachments.screenshot.preview | Preview screenshot |
| report-problem.attachments.screenshot.unavailable | No screenshot available |
| report-problem.actions.send | Send |
| report-problem.actions.cancel | Cancel |
| report-problem.actions.sending | Sending… |
| report-problem.sent.title | Problem reported |
| report-problem.sent.view_issue | View issue |
| report-problem.error.send.title | Couldn't send this report |
| report-problem.error.send.retry | Retry |

## 크기와 접근성

- dialog 폭 480px(shell/design-system#R33), shell overlay view에 그려 뒤의 앱 view를 가리지 않는다(shell/app-frame#R24, R31).
- 첫 focus는 글 입력란에 두고, 탭 순서는 입력란 → 두 체크박스 → (있으면 Issue 표시) → Cancel → Send다.
- Escape와 바깥 클릭은 dialog를 닫되 결정으로 취급하지 않는다. 제출 상태 변화는 screen reader에 polite로, 접수 실패는 assertive로 전달한다.
- 좁은 창에서도 dialog는 창 안에 맞추고 체크박스 두 줄은 세로로 유지한다.
