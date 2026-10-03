---
type: screen
concerns: [shell/app-frame, shell/desktop, apps/runtime]
---
# App

사람이 자기가 만든 앱 화면 전체를 쓰고, 이상이 있으면 그 자리에서 알린다.

## 보이는 것

1. **앱 view 그 자체**가 화면 대부분을 차지한다. 얇은 바 밑 전체 영역에서 그 앱의 own 화면이 머리부터 그려진다(shell/app-frame#R25, R26).
2. **얇은 상단 바**에 다음만 둔다.
   - 런처로 돌아가기(shell/desktop#R26).
   - 앱 이름(사람이 지은 이름, 안쪽 slug 아님).
   - 지금 상태 한 단어: Starting / Available / Unavailable / Stopped 중 실제로 해당하는 하나(apps/runtime#R13). 상태 옆에는 지금 판단에 필요한 다음 행동만 붙는다(예: Unavailable일 때 "Retry").
   - 열린 Issue 개수 pill. 0개면 pill 자체가 없다(apps/runtime#R14, problems/grouping#R12).
   - **App details** 진입점 — app-detail(운영 패널)을 연다(shell/app-frame#R26).
   - **Report a problem** 버튼 — 앱 view와 독립된 자리에 항상 떠 있다(shell/app-frame#R31, R32).
3. 앱이 아직 한 번도 만들어지지 않았으면(등록만 되고 release가 없는 상태) 본문 전체가 "Not built yet" 빈 상태로 바뀌고, 진행 중인 대화로 가는 안내 하나만 보인다.

## 숨긴 것

- release 번호의 안쪽 commit·bundle hash·blueprint hash, process PID, 재시작 backoff 횟수 — 이런 진단 상세는 app-detail의 펼친 자리에서만 본다(shell/wording#R6, R8).
- automation 실행 기록, permission·connection의 실제 목록 — app-detail로 미룬다(apps/runtime#R13, R14 "상세는 사람이 펼쳐 볼 수 있다").
- 앱 교체·재시작·권한 변경 같은 안쪽 처리 순서(새 프로세스 준비, 이전 프로세스 종료 확인 등)는 전혀 보이지 않는다. 사람에게는 상태 전환의 결과만 보인다(apps/runtime#R15~R19, screens/README#G3).
- 외부 연결이 필요한 command의 "연결 안 됨/기다림/결과 모름" 표시는 이 화면의 크롬이 아니라 앱 view 안쪽 내용이다(apps/runtime#R12, R21). shell 크롬은 앱 process 자체의 생존만 말한다.

## 행동

- 주 행동은 **앱 view를 그대로 쓰는 것**이다. 상단 바에는 경쟁하는 primary 버튼을 두지 않는다(screens/README#G4).
- **Report a problem**은 앱 view가 멈추거나 crash해도 항상 눌린다(shell/app-frame#R32). 누르면 report-problem 화면으로 간다.
- **App details**를 누르면 app-detail 패널이 720px로 열리고, 창이 1,024px 미만이면 앱 view를 가리지 않고 bounds만 줄인다(shell/app-frame#R26).
- 상태가 Unavailable이면 "Retry"가 상단 바에 보이고, Stopped면 사람이 직접 멈춘 것이라 자동으로 다시 켜지 않는다(apps/runtime#R16)는 사실이 app-detail 상세에서 설명된다.

## 상태

- **Starting** — 아직 실제 handler·연결을 확인하지 못함.
- **Available** — 실제로 호출에 응답함.
- **Unavailable** — 허용은 됐지만 응답이 없음; 다음 행동(Retry, 또는 App details에서 이유 보기)이 함께 보인다.
- **Stopped** — 사람이 멈춤; 다시 켜는 행동만 보이고 자동 재시작 문구는 없다(apps/runtime#R16).
- **Not built yet** — release가 하나도 없음; 빈 상태 하나와 "Continue the conversation" 행동 하나만 둔다(screens/README 공통 패턴 "비었음").
- **크래시 뒤에도 조작 가능** — 앱 view가 멈추거나 무한 loop에 빠져도 상단 바 전체(특히 Report a problem)는 계속 눌린다(shell/app-frame#R21, R32).

## 문구

| key | en |
|---|---|
| app-space.bar.back | Home |
| app-space.bar.details | App details |
| app-space.bar.report | Report a problem |
| app-space.status.starting | Starting |
| app-space.status.available | Available |
| app-space.status.unavailable | Not responding |
| app-space.status.stopped | Stopped |
| app-space.status.retry | Retry |
| app-space.issues.count | {count, plural, one {# issue} other {# issues}} |
| app-space.empty.title | Not built yet |
| app-space.empty.action | Continue the conversation |

## 크기와 접근성

- 상단 바 높이와 창 조작 영역은 shell/desktop#R22, R23을 따른다.
- 창 1,024px 미만에서는 App details 패널이 앱 view를 가리지 않고 남는 폭으로만 줄어든다(shell/app-frame#R26, R36).
- 상단 바의 모든 조작(Home, App details, Report a problem, Retry)은 키보드로 닿고 focus 순서가 분명하며, 상태 단어는 색이 아니라 글자와 아이콘으로도 구별된다(shell/design-system#R2, R10).
- 두 view(앱 view + 상단 바)가 동시에 보여도 키보드 입력 focus는 한 곳에만 있다(shell/app-frame#R28).
