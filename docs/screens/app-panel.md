---
type: screen
concerns: [shell/app-frame, shell/workspace, apps/blueprint]
---
# app-panel

project-workspace의 탭 하나다. 사람이 문서 옆에서 패널 크기를 선언한 앱 화면을 쓴다. 앱 화면 안의 내용과 조작은 그 앱의 blueprint가 정하며, 여기는 모든 앱 패널이 함께 쓰는 틀만 다룬다.

## 보이는 것

1. **앱 화면.** 그 앱이 패널 크기로 선언하고 테스트한 화면만 연다(apps/blueprint#R19).
2. **이름·연결 상태.** 탭 머리에 앱 이름과 연결 상태를 보인다(shell/app-frame#R34).
3. **문제 알리기.** 이 패널에만 묶인 독립 버튼으로, 앱 화면이 멈추거나 깨져도 눌린다(shell/app-frame#R34, R32).
4. **Activity(기본 닫힘).** 이 패널에서 최근에 한 일을 펼쳐 본다.

## 숨긴 것

- 이 앱 command가 한 번 실행된 기록(Invocation)은 기본으로 보이지 않고, Activity를 펼쳐야 보인다.
- secret을 쓰는 command라도 그 값은 어디에도 나타나지 않는다. 사람에게 보이는 것은 그 호출이 됐다는 결과뿐이다.
- 패널 view의 session·scheme 분리 같은 격리 처리는 전혀 보이지 않는다(shell/app-frame#R33).

## 행동

- 주 행동: 없음(패널 안의 주 행동은 그 앱의 화면이 정한다).
- shell이 더하는 보조: **문제 알리기**, 패널 크기를 지원하지 않는 화면으로 가려 하면 뜨는 **Open in app space**, **Activity** 펼치기.

## 상태

- **불러오는 중.** 300ms 전에는 아무것도 보이지 않고 이후 skeleton을 보인다(shell/design-system#R1).
- **연결 끊김.** 마지막으로 확인한 화면을 유지하고 최신 확인 못함을 표시한다(shell/app-frame#R33, shell/desktop#R7).
- **멈춤·깨짐.** 앱 화면이 멈추거나 깨져도 문제 알리기는 동작하고, 고쳐진 것처럼 보이지 않는다(shell/app-frame#R32).
- **패널 미지원.** 그 앱이 패널 크기를 선언하지 않았으면 탭에 열리지 않고 Open in app space로만 안내한다(shell/workspace#R5).

## 문구

| key | en |
|---|---|
| app-panel.report_problem | Report a problem |
| app-panel.open_in_app_space | Open in app space |
| app-panel.activity.label | Activity |
| app-panel.activity.empty | Nothing yet |
| app-panel.connection.lost | Can't reach this app right now |
| app-panel.unsupported | This app doesn't support a panel view |

## 크기와 접근성

- 패널은 project-workspace의 탭 칸(최소 480px) 안에서 자기 화면 머리부터 그리고, 바깥 크롬(탭 이름, 문제 알리기)은 shell이 그린다(shell/app-frame#R25).
- resize·스크롤·탭 전환에도 패널의 경계는 항상 함께 적용된다(shell/app-frame#R35).
- 같은 앱의 다른 패널이 깨져도 각 문제 알리기 버튼은 자기 패널에만 묶여 동작한다(shell/app-frame#R34).
