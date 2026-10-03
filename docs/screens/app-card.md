---
type: screen
concerns: [lophn-agent/visuals, shell/workspace, apps/blueprint]
---
# App card

사람이 대화 안에서 agent가 끼운 앱 카드를 보고 쓴다.

## 보이는 것

1. **카드 제목** — 그 화면이 보여 주는 내용을 설명하는 짧은 글(agent가 붙인 설명, lophn-agent/visuals#R2).
2. **앱 카드 크기로 선언된 화면 그 자체** — apps/blueprint가 카드 크기를 지원한다고 선언한 화면만 끼운다(apps/blueprint#R19, lophn-agent/visuals#R4). 카드 자체의 조작(입력, 클릭)은 평소 그 화면과 같다.
3. **Report a problem** — 이 카드 하나에 묶인 독립 버튼. 같은 앱의 다른 패널·카드가 멈춰도 이 버튼은 이 카드의 view에만 묶인다(shell/app-frame#R33, R34).
4. **Save as document** — 지금 보이는 카드를 고정 문서로 남기는 블록 공통 행동(lophn-agent/visuals#R6, shell/workspace#R13).
5. 카드 아래 작은 글로 관측 시각이 보인다(shell/workspace#R13).

## 숨긴 것

- 그 앱의 version·access·연결·issue·task 같은 운영 정보는 카드에 없다. 카드를 봤다고 app-detail로 가는 길이 생기지 않는다.
- 카드를 보거나 연다고 agent의 그 앱 command 실행 권한이 늘지 않는다(lophn-agent/visuals#R4).
- 카드 내부에서 agent가 보낸 임의 HTML·script는 실행되지 않는다. 카드는 설치된 SDK 컴포넌트로만 그려진다(lophn-agent/visuals#R1, shell/workspace#R12).

## 행동

- 주 행동은 카드 내용을 그대로 쓰는 것이다(screens/README#G4 — 상단 Report a problem·Save as document는 보조 행동).
- **Save as document**를 누르면 지금 이 순간의 명세·데이터·설명·출처를 실행 코드 없는 문서로 저장한다(lophn-agent/visuals#R6). 앱이 redaction한 snapshot을 못 구하면 "Couldn't save a copy of this"와 참조만 남는다 — snapshot은 안쪽 개념이라 화면 말에는 쓰지 않는다(screens/README#3, lophn-agent/visuals#R7).
- **Report a problem**은 이 카드의 view가 멈춰도 눌린다.

## 상태

- **불러오는 중** — 300ms 전엔 아무것도 없고 이후 카드 크기의 skeleton(shell/design-system#R1).
- **더는 열 수 없음** — 앱이 archive되거나 release가 더는 없으면 카드 자리에 본문·설명·원래 참조는 남기고 "No longer available"만 보인다. 다른 앱이나 최신 release로 몰래 바뀌지 않는다(lophn-agent/visuals#R5).
- **renderer 오류** — 카드가 깨져도 메시지 본문·설명·출처는 그대로 남는다(lophn-agent/visuals#R5, R2).

## 문구

| key | en |
|---|---|
| app-card.report | Report a problem |
| app-card.save | Save as document |
| app-card.saved | Saved |
| app-card.save_failed_snapshot | Couldn't save a copy of this |
| app-card.unavailable.title | No longer available |
| app-card.observed_at | Seen {time} |

## 크기와 접근성

- 카드는 대화 도크(400px)·overlay·저장된 문서 안에서 모두 같은 격리 규칙을 쓴다(shell/app-frame#R33).
- 카드가 화면 밖으로 스크롤되면 native view는 숨긴다(shell/app-frame#R35).
- 카드가 나타나거나 저장되는 동안 사람이 읽던 스크롤 위치와 입력 focus는 그대로 유지된다(shell/workspace#R13).
- Report a problem·Save as document는 키보드로 닿고, 카드 안 조작도 그 화면 자체의 접근성 규칙을 따른다(shell/design-system#R2).
