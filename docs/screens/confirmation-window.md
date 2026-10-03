---
type: screen
concerns: [shell/confirmation-window, platform/approvals, platform/secrets]
---
# Confirm

사람이 정확한 대상과 영향을 보고 결정을 내린다.

Confirm은 요청한 창 위의 child modal이다. 열린 동안 그 창의 앱 view는 그대로 보이고 입력만 막힌다(shell/confirmation-window#R6). 다른 화면에서 승인·권한 부여·secret 입력·고정 선택지의 결정이 필요할 때마다 이 틀 하나로 열린다 — 화면마다 다시 디자인하지 않는다.

## 보이는 것

1. **결정 자체를 설명하는 한 문장** — "Approval request" 같은 고정 명사가 아니라 "Switch money to Version 3?"처럼 그 결정 내용이 제목이다(screens/README#3).
2. **대상·변경 → 영향·위험 →되돌릴 수 있나 → 결정** 순서로, 지금 결정에 필요한 것만 기본에 보인다(shell/confirmation-window#R2).
   - 대상·변경: 무엇이 바뀌는지(이름, Version, 권한 범위, 연결 등). 권한 화면의 경로는 줄이지 않고 전체를 고정폭 글꼴로 보인다(shell/confirmation-window#R8).
   - 영향·위험: 새로 생기는 권한, 밖으로 나가는 정보와 받는 곳, 잃을 수 있는 데이터(platform/approvals#R1, R2).
   - 되돌릴 수 있나: "This can be undone" 또는 "This cannot be undone" 한 줄.
   - 결정: 그 결정에 맞는 이름의 버튼(예: "Switch version", "Grant access") 하나와 취소/거절 버튼.
3. **secret 입력이 필요하면** 전용 보호 입력 칸 하나와 "Only used to connect to {provider}, stored securely on this device" 한 줄이 함께 보인다(platform/secrets#R2, R3).
4. diff로 보여줄 수 없는 앱 동작이면 "See a safe preview"가 있을 때만 그 미리보기로 연다(shell/confirmation-window#R10).

## 숨긴 것

- 주체·시각·이유·근거·전체 diff(문서 전체, code diff)는 기본에서 빼고 "Details"를 펼쳐야 보인다(shell/confirmation-window#R2, R3).
- 요청자가 사람인지 agent인지 automation인지는 결정의 근거가 아니므로 기본 문장에서 강조하지 않는다 — 다만 agent가 대신 요청한 앱 command는 그 사실을 펼친 상세에서 확인할 수 있다(platform/approvals#R8).
- 이 창이 열려 있는 동안 안쪽에서 하는 재검사(대상이 아직 같은지, 권한이 아직 같은지)는 보이지 않는다. 결과만 "결정 가능" 또는 "달라졌음"으로 보인다(shell/confirmation-window#R5, screens/README#G3).

## 행동

- 화면 하나에 결정은 하나다(screens/README#G4). 첫 focus는 설명에 있고 Enter로 바로 제출되지 않으며, 닫기·Escape는 결정으로 치지 않는다(shell/confirmation-window#R4).
- 되돌릴 수 없는 결정에는 버튼을 누른 뒤 영향·범위를 한 번 더 보여주는 2차 확인이 따라온다(shell/confirmation-window#R4).
- 결정 버튼은 그 결정에 맞는 동사로 쓴다("Approve"/"Decline"처럼 뭉뚱그리지 않는다).
- secret 입력칸의 제출은 다른 결정과 같은 submit 경로를 쓰고, 값은 이 창을 벗어나는 순간부터 일반 화면·agent에 보이지 않는다(platform/secrets#R2, R5).

## 상태

- **확인하는 중** — 열자마자 대상을 다시 조회하는 짧은 동안 결정 버튼이 비활성이다(shell/confirmation-window#R5).
- **달라졌음** — 열어둔 사이 대상이나 권한이 바뀌면 버튼이 사라지고 "This changed since you opened it"과 최신 내용으로 가는 길만 남는다(shell/confirmation-window#R5).
- **기한 지남** — 더는 결정할 수 없는 요청은 "This has expired"만 보이고 버튼이 없다(platform/approvals#R12).
- **secret 저장 불가** — 이 컴퓨터의 보호 저장소를 쓸 수 없으면 그 secret 기능만 "Not available on this device"로 닫히고 다른 결정은 그대로 된다(platform/secrets#R8).
- **이미 결정됨** — 같은 handle로 다시 열리면 그 결과만 읽기로 보이고 다시 제출할 수 없다(shell/confirmation-window#R9).

## 문구

| key | en |
|---|---|
| confirmation-window.revert.can_undo | This can be undone |
| confirmation-window.revert.cannot_undo | This cannot be undone |
| confirmation-window.details.toggle | Details |
| confirmation-window.preview.open | See a safe preview |
| confirmation-window.secret.hint | Only used to connect to {provider}, stored securely on this device |
| confirmation-window.checking | Checking the latest details… |
| confirmation-window.stale.title | This changed since you opened it |
| confirmation-window.stale.action | See the latest |
| confirmation-window.expired.title | This has expired |
| confirmation-window.secret.unavailable | Not available on this device |
| confirmation-window.decided.title | Already decided |
| confirmation-window.cancel | Cancel |

## 크기와 접근성

- 창은 최대 640px이고 그보다 좁은 창에서는 안에 맞춰 줄어들며 순서는 바뀌지 않는다(shell/confirmation-window#R2).
- 열린 동안 부모 창의 앱 view는 가려지지 않고 그대로 보이되 click·키 입력만 막힌다(shell/confirmation-window#R6).
- 모든 조작(펼치기, secret 입력, 결정 버튼, 2차 확인)은 키보드로 닿고 첫 focus는 버튼이 아니라 설명에 둔다(shell/confirmation-window#R4, shell/design-system#R2).
- 추가·삭제·생략·자료 없음은 색 없이도 표지와 글로 구별된다(shell/confirmation-window#R3).
