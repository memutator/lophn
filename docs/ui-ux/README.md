---
type: guide
concerns: [shell]
---
# ui/ux

lophn 화면 전체에 걸치는 UI/UX 전역 규칙이다. 화면마다의 정적 명세는 두지 않는다. 화면에 "무엇을 보여 주고 지켜야 하나"는 각 concern의 requirements가 정하고, 여기는 **어떻게 덜어 내고 어떻게 말하나**만 정한다.

## 1. 누구를 위한 화면인가

화면을 보는 사람은 개발자가 아니라 **바이브코딩 사용자**(코드를 읽지 않고 coding agent에게 앱을 만들게 하는 사람)다. ledger, release, invocation, assignment, run, approval request 같은 말은 이 사람의 말이 아니다. 개발자용 상세(diagnostics, 원시 오류, 내부 ID)는 숨겨 둔 상세에만 둔다. 이 규칙은 shell#I8, shell#I9, product.md의 P17을 따른다.

## 2. 원칙

**[G1] 지금 필요한 것만 보인다.** 지금 판단하거나 행동하는 데 꼭 필요한 것만 기본으로 보인다. 나머지는 2번 규칙을 따른다.

**[G2] 나머지는 숨기고 펼친다.** 기본에서 뺀 것은 없앤 것이 아니라 펼쳐 보는 자리로 옮긴다. 펼치는 자리는 화면마다 분명해야 한다("상세", "자세히 보기" 같은 하나의 이름으로).

**[G3] lophn이 알아서 처리한 일은 결과만 보인다.** scan, index, redaction, retry, 자격 재검사처럼 사람 대신 lophn이 하는 일은 과정을 보이지 않고 "지금 상태"와 "그 상태가 바뀐 결과"만 보인다. 과정을 보이면 사람이 그 과정에 책임이 있다고 오해한다.

**[G4] 화면 하나에 주 행동 하나.** 화면마다 primary 버튼은 하나다(shell/design-system#R27). 여러 결정이 필요하면 화면을 나누거나 순서를 두고, 한 화면에 같은 무게의 버튼을 나란히 두지 않는다.

**[G5] 사람에게 묻는 일은 드물고 분명하다.** 되돌릴 수 없거나 심각한 일(지우기, 돈이 나가는 일, 밖으로 보내기)만 묻고 나머지는 묻지 않고 진행한다(platform I3). 물을 때는 무엇이 되돌릴 수 없는지 한 줄로 보이고, 침묵·닫기·다른 화면의 동의는 결정이 아니다. 사람이 직접 누른 [Start] 같은 동작은 그 자체가 허락이라 다시 묻지 않는다.

**[G6] 안쪽 실패는 사람이 할 수 있는 행동으로 바꿔 말한다.** 오류는 원인 추측이 아니라 사람이 겪는 영향과 다음 행동 하나로 적는다(shell/wording#R10). "무엇이 실패했는지"가 아니라 "그래서 무엇을 할 수 있는지"를 먼저 보인다.

## 3. 화면 말

안쪽 개념(코드와 문서의 말)을 화면에 그대로 내보내지 않는다. 화면 말은 전부 en이고, 아래 표의 오른쪽 열이 그 자리에서 실제로 쓰는 말이다(사람이 지은 이름은 그대로 쓴다). "보이지 않음"은 그 개념이 화면 어디에도 이름으로 나타나지 않는다는 뜻이다.

| 안쪽 개념 | 화면 말 | 비고 |
|---|---|---|
| ledger | 보이지 않음 | 모든 사실의 저장소. 화면에는 "저장됨"·"확인됨" 같은 결과로만 비친다 |
| release | **Version**(예: "Version 3", "Current version") | 사람이 고르고 되돌리는 단위 |
| invocation | 보이지 않음(기본); 펼치면 **Activity** | 앱 command·automation 한 번의 실행 기록 |
| assignment | 보이지 않음(기본); Operator 설정 화면에서만 **Repeating check** | 역할을 어떤 범위에 붙인 것 |
| run | 보이지 않음; 상태만 **In progress / Waiting / Stopped / Done** | |
| handoff | 보이지 않음 | 역할이 바뀌어도 사람에게는 같은 요청의 이어짐으로 보인다 |
| approval request | 고정 명사 없음. 그 결정 자체를 문장으로 보인다(예: "Approve this change?") | confirmation window의 제목이 대상을 설명한다(shell/confirmation-window#R2) |
| grant | **Access**(예: "Files this app can read") | |
| snapshot | 보이지 않음; 문제 알리기 화면에서는 **Details we collected** | |
| redaction | 보이지 않음; 못 모았을 때만 "Some details were left out" | |
| provider | 실제 제품 이름(Claude, ChatGPT 등). 일반화해 말할 때는 **Connection** | |
| judgment model / organizing model | **For decisions** / **For summaries** | shell/wording#R13 |
| coding agent connection | **Connection** | |
| ticket | **Task** | |
| claim | 보이지 않음 | |
| problem | **Issue** | |
| report | 보이지 않음(Problem으로 묶여 Issue로만 보인다) | |
| verification(test result) | **Test result** | 이미 바이브코딩 사용자가 아는 말 |
| context | **Focus**(사람이 지은 이름과 함께, 예: "Focus: Grocery budget") | |
| term | **Meaning** | |
| preset | **Preset**(예: "Preset: Grocery helper") | agent 구성 하나. 역할마다 기본 Preset이 있고 사람이 고치거나 새로 만든다. 내부 구성(prompt, capability, MCP 목록)은 펼쳐 보는 자리에만 둔다 |
| 사람 지침(LOPHN.md) | **Instructions** | 버튼 [Instructions]로 lophn 편집기에서 연다. 파일 경로와 안쪽 version 식별자는 기본에서 숨긴다 |
| Operator 구성 | **Operator** + 붙은 project나 app 이름 | 같은 자리에 여럿 둘 수 있다. 반복 주기는 **Repeating check** |
| coding agent 연결 | **Connection**(고른 harness 이름, 예: "Claude Code") | 감지·설치 기록·MCP·skill 위치는 숨긴다. 사람은 harness를 고르기만 한다 |
| 시작 | **[Start]** | Task에서 coding agent를 터미널 탭에 연다. 누르는 것이 허락이라 확인 창을 따로 두지 않는다 |
| session | 보이지 않음; 터미널 탭과 Task 상태로만 비친다 | |
| series | **Series**(documents 화면의 탭과 등록 화면에서만) | sidebar 목적지가 아니다. 그 밖에서는 문서 목록의 정렬 결과로만 비친다(plan/shell Q14) |

이 표에 없는 개념을 화면에 써야 하면 docs/README.md의 말 규칙으로 안쪽 이름을 먼저 확인하고, 이 표에 줄을 더한다. 문서·코드의 말 규칙(docs/README.md#말)과 이 표는 서로 다른 목적이라 같은 말이 양쪽에 다르게 적힐 수 있다.

## 4. i18n

**형식.** 화면에 나오는 고정 문구는 전부 message key로 관리한다. key는 `<screen>.<part>.<name>` 패턴을 쓴다(예: `launcher.projects.empty.title`, `app-detail.release.confirm_body`). `<screen>`은 그 화면의 kebab-case 이름, `<part>`는 화면 안의 자리(머리, 목록, 빈 상태, 오류, 버튼 등), `<name>`은 그 문구를 구별하는 짧은 이름이다. 처음에는 en 메시지만 제공하고 다른 locale은 나중에 같은 key로 더한다.

**문장은 ICU MessageFormat으로 쓴다.** 이름·숫자 같은 placeholder는 메시지 안에 `{name}`으로 넣고, 복수형은 ICU의 `plural` 구문으로 locale마다 다르게 처리한다.

```
app-detail.release.confirm_body = "{appName} will switch to {version}."
things-to-confirm.count         = "{count, plural, one {# thing to confirm} other {# things to confirm}}"
```

화면 코드에서 문자열을 이어 붙여 문장을 만들지 않는다("Switch to " + version처럼). 조사·어순·복수형이 바뀌는 언어를 나중에 더할 때 화면 코드를 고치지 않아야 한다(shell/wording#R3).

**날짜·숫자·상대 시각은 Intl API로 formatting한다.** 날짜는 `Intl.DateTimeFormat`, 숫자는 `Intl.NumberFormat`(큰 수는 compact, shell/design-system#R41 참고), "3분 전" 같은 상대 시각은 `Intl.RelativeTimeFormat`을 쓰고 직접 문자열을 계산해 붙이지 않는다. en이 유일한 locale이어도 이 규칙을 지켜야 locale을 더할 때 값만 바뀌고 계산 코드는 그대로다.

**무엇이 i18n 대상인가.**
- shell이 소유한 고정 문구(버튼, 라벨, 상태, empty/error 안내)는 모두 message key 대상이다. key와 en 값의 정본은 shell의 en catalog다(→ shell/wording).
- 앱·problem code가 선언하는 고정 문구(명령 설명, 권한 설명, problem 안내)도 같은 key·en 규칙을 따르되, 그 문구의 소유자는 shell이 아니라 해당 concern이다(problems/problem-codes#R6, lophn-agent/harness/model#R15 같은 선례). shell은 받은 문구를 그대로 쓰고 다시 합성하지 않는다(shell/wording#R9).
- agent가 그때 생성하는 자유 글(대화 응답, Operator 보고 본문, App Engineer의 질문 문장)은 미리 정의한 key가 없다. 이 글은 "en으로 쓴다"는 언어 요구만 따르고 message catalog에는 들어가지 않는다. 틀(머리, 버튼, 상태)과 자유 글을 같은 화면에 섞어도 틀만 key 대상이다.

shell/wording이 i18n의 지켜야 할 요구(en-only 시작, key 검사)를 정하고, 이 절은 그 요구를 실제로 지키는 방법(key 패턴, ICU, Intl, 대상 구분)을 정한다. 둘이 다른 말을 하면 shell/wording이 정하는 "지켜야 할 것"이 우선하고 이 절의 방법을 고친다.

## 5. 전체 화면 구조와 이동

최상위 공간은 다섯이다. 모든 화면 이름은 kebab-case다.

| 공간 | 화면(이름) | 하는 일 한 줄 | 들어가는 길 |
|---|---|---|---|
| 첫 창 | **launcher** | 프로젝트·앱을 열거나 등록하고 이어서 쓴다 | 새 기본 창의 시작, `Ctrl+Shift+L` |
| 프로젝트 | **project-workspace** | 문서·터미널·앱 패널을 같은 탭 줄에 놓고 오간다 | launcher의 프로젝트 카드 |
| 〃 탭 내용 | **document** | 문서 하나를 읽거나 고치고 판 이력을 본다 | project-workspace의 문서 탭 |
| 〃 탭 내용 | **terminal** | 프로젝트 폴더에서 명령을 실행하고, Task의 [Start]로 coding agent를 연다 | project-workspace의 터미널 탭, Task의 [Start] |
| 〃 탭 내용 | **app-panel** | 문서 옆 탭에서 앱 화면을 쓴다 | project-workspace의 앱 패널 탭 |
| 앱 | **app-space** | 앱 화면 전체를 쓰고 문제를 알린다 | launcher의 앱 카드, OS 바로가기 |
| 〃 패널 | **app-detail** | 한 앱의 version·access·연결·issue·task를 보고 결정한다 | app-space의 운영 패널 진입점 |
| lophn | **projects** | 등록한 프로젝트를 찾고 정리한다 | 상단 바 고정 진입점 → lophn 공간 |
| 〃 | **documents** | 문서를 검색하고 저장한 보기를 연다 | 〃 |
| 〃 | **contexts** | focus와 meaning을 만들고 정한다 | 〃 |
| 〃 | **apps** | 등록한 앱을 찾고 정리한다 | 〃 |
| 〃 | **things-to-confirm** | 기다리는 결정과 지난 결과를 모아 본다 | 〃, notification 클릭 |
| 〃 | **roles** | 역할이 하는 일과 만든 것을 보고 대화를 연다 | 〃 |
| 〃 | **settings** | provider·연결·백업·진단 같은 설정을 보고 바꾼다 | 〃 |
| 대화 | **conversation** | agent와 대화하며 질문에 답하고 결과를 본다 | 모든 공간의 오른쪽 도크 토글 |
| 〃 카드 | **app-card** | 대화 안에서 앱 카드를 보고 쓴다 | conversation의 시각 블록 |
| 전역 | **confirmation-window** | 정확한 대상과 영향을 보고 결정을 내린다 | approval·question의 action, secret 입력 |
| 전역 | **report-problem** | 지금 화면의 이상을 글로 알린다 | app-panel/app-space의 [문제 알리기] |

- **Instructions**는 화면이 아니라 진입점이다. 전역은 settings, project는 project-workspace, app은 app-detail의 [Instructions]에서 lophn 편집기(document)로 연다. **Preset**은 roles에서 고친다.
- 모든 창은 launcher로 시작한다(shell/desktop#R24). lophn 공간의 일곱 화면은 형제이며 분류 전·거처 같은 중간 계층을 두지 않는다(shell/desktop#R28).
- **conversation**은 독립 공간이 아니라 모든 공간에서 토글하는 도크다. 닫아도 project-workspace·app-space의 탐색은 그대로다(shell/desktop#R1).
- **confirmation-window**는 요청한 창 위의 child modal이다. 앱 view는 숨기지 않고 입력만 막는다(shell/confirmation-window#R6). 사람의 결정은 이 화면에서만 받는다.
- **notification**은 화면이 아니라 창 오른쪽 아래 1칸의 chip이다(shell/desktop#R10). 클릭하면 things-to-confirm으로 이어지고, 그 자체로 읽음·승인·답이 되지 않는다.
- 프로젝트 작업대의 안내(추적 꺼짐, Operator, 읽기 실패)는 본문 위 줄이 아니라 toast와 같은 폭의 떠 있는 카드다. 본문 높이를 쓰지 않고 저절로 사라지지 않으며, 닫아도 상단 바의 [Show notices]로 다시 연다(shell/desktop#R27). 사람을 부르는 notification chip의 오른쪽 아래 한 칸과 겹치지 않게 왼쪽 아래에 둔다.
- **app-panel**과 **app-card**는 app-space와 같은 앱·release 신원·격리 규칙을 쓰는 더 작은 틀이다(shell/app-frame#R33). 틀이 작다고 권한이나 확인 규칙이 줄지 않는다.

## 6. 공통 패턴

화면마다 다시 정의하지 않고 아래 패턴을 그대로 쓴다. 

| 패턴 | 기본 동작 |
|---|---|
| **비었음** | 아이콘 하나·한 문장·행동 하나만 보인다. 삽화를 넣지 않는다(shell/design-system#R34) |
| **불러오는 중** | 300ms 전에는 아무것도 보이지 않고, 그 뒤부터 실제 배치를 지킨 skeleton을 보인다(shell/design-system#R1) |
| **오류** | 실패한 대상·사람이 겪는 영향·가능한 다음 행동 하나를 먼저 적고 원인을 추측하지 않는다(shell/wording#R10) |
| **연결 끊김** | 마지막으로 확인한 내용과 확인 시각을 유지하고 "최신 확인 못함"을 표시한다. 빈 결과나 최신 값으로 보이지 않는다(shell/desktop#R7) |
| **권한 없음** | 무엇을 못 보는지와 누구에게 권한을 물어야 하는지를 적는다. 빈 화면으로 조용히 바꾸지 않는다 |
| **오래 걸리는 일** | 전면 spinner를 쓰지 않는다. 지금 상태와, 끝나면 사람이 할 일만 남기고 화면을 막지 않는다(platform/responsiveness) |
| **사람이 정할 일** | 묻는 것은 드물다. 물을 때는 선택지와 추천 이유, 무엇이 되돌릴 수 없는지 한 줄을 먼저 보이고, 되돌릴 수 없는 일은 confirmation-window로 보낸다. 되돌릴 수 있는 일은 묻지 않고 진행하고 결과만 알린다(lophn-agent/questions#R4) |
| **되돌리기** | 되돌릴 수 있는 범위와 되돌릴 수 없는 부분을 구별해 보이고, 되돌린 결과를 새 기록으로 남기며 이전 이력을 지우지 않는다(lophn-agent/revert) |
| **달라졌음** | 결정하거나 저장하려는 대상이 열어 둔 사이 바뀌면 적용을 멈추고 "This changed since you opened it" 같은 한 문장과 최신 내용으로 가는 길만 남긴다. 자동으로 합치거나 덮어쓰지 않는다 |
| **앱이 깨졌을 때** | 앱 view가 멈추거나 crash해도 [문제 알리기]와 다른 탭·화면은 그대로 동작한다. 깨진 화면을 고쳐진 것처럼 보이지 않는다(shell/app-frame#R21, R32) |

## 7. 디자인 값

색·글꼴·간격·크기·컴포넌트의 실제 값은 `shell/design-system` requirements에 있다. 이 문서는 그 값을 반복하지 않고 가리킨다. 치수가 필요하면 `shell/design-system#R<n>`으로 가리키고 새 값을 만들지 않는다.
