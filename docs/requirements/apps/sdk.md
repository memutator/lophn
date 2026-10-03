---
type: requirements
concerns: [apps/sdk]
---
# apps/sdk

설치가 제공하는 SDK Package의 공개 이름·정확한 version·사용 안내, 앱 템플릿과 고정 의존을 맡는다. 앱이 실제로 사용한 재료를 다시 쓰게 하되 개인 SDK 등록·승격·자동 전파는 첫 판에 두지 않는다. 권한 강제는 apps/permissions, 보고의 의미는 problems/reporting, 안내 내용은 coding-agent/guides를 따른다.

## 요구

### 제공 재료와 탐색

**[R1]** 앱과 lophn 화면은 같은 TypeScript·Deno·React 기반 SDK를 사용하고 기본 SDK로 충분한 기능은 앱마다 다시 구현하지 않는다.
- 이유: 검증한 재료가 다음 앱의 개발 비용과 화면의 차이를 줄인다. 화면은 React로 고정한다.
- 확인: lophn 화면과 두 앱이 같은 설치 제공 패키지를 소비하며 각 앱의 업무 프로세스는 Deno, 화면은 React로 동작한다.
- 의도: apps#I4

**[R2]** SDK는 component·capability·domain·format의 네 종류를 제공하고 한 Package에는 한 종류만 담는다.
- 이유: 화면 코드와 도메인 로직·권한 클라이언트·문서 format의 목적이 섞이지 않게 한다.
- 확인: 목록에서 네 종류와 각 Package의 한 가지 목적을 구별하고 format의 동작 계약은 documents/formats를 따른다.
- 의도: apps#I4

**[R3]** 설치 제공 SDK 목록에서는 공개 이름·한 줄 목적·실제 사용할 수 있는 정확한 version·공개 API와 type·요구 permission·정확한 peer 의존·예제와 import 사용법을 읽을 수 있다.
- 이유: agent가 코드를 새로 만들기 전에 맞는 재료와 조건을 확인한다.
- 확인: 목록에서 패키지를 찾고 선택한 version의 안내만 읽어 필요한 permission과 peer, 사용 예를 확인한다.
- 의도: apps#I4

**[R4]** 첫 SDK 묶음은 @lophn/blueprint·@lophn/tokens·@lophn/ui-control·@lophn/ui-overlay·@lophn/ui-layout·@lophn/ui-reading·@lophn/ui-table·@lophn/ui-chart·@lophn/ui-filter·@lophn/ui-stat·@lophn/ui-state·@lophn/ui-action·@lophn/cap-fs·@lophn/cap-net·@lophn/cap-store·@lophn/cap-problem·@lophn/cap-schedule·@lophn/cap-save·@lophn/cap-secret와 documents/formats가 정한 format Package의 정확한 1.0.0을 제공한다.
- 이유: 이전 이름을 유지하되 새 command·문서·secret·report 계약을 과거 공개 byte와 같은 version이라고 하지 않는다. 초기 version은 1.0.0이고 과거 version을 재사용하지 않는다.
- 확인: 각 이름의 1.0.0 코드와 안내가 목록에 있고 제공하지 않는 @lophn/cap-read-model과 @lophn/cap-notify를 쓸 수 있다고 안내하지 않는다.
- 의도: apps#I4

**[R5]** @lophn/blueprint는 모든 앱이 같은 apps/blueprint 계약으로 선언을 작성하고 검사하는 도우미를 제공한다.
- 이유: 앱마다 blueprint schema의 다른 사본을 만들지 않는다.
- 확인: 템플릿과 직접 작성한 앱의 동일 선언이 같은 검사 결과를 내며 새 API를 옛 blueprint 선언으로 조용히 바꾸지 않는다.
- 의도: apps#I4, apps#I1

**[R6]** SDK 목록과 사용처는 실제 공개 Package와 release의 고정 의존으로 조회하고 @me 이름이 존재하면 @lophn보다 먼저 보여 주되 현재 개인 Package 등록은 받지 않는다.
- 이유: 탐색 순서는 보존하면서 첫 판에 없는 승격·등록 workflow를 있는 것처럼 보이지 않는다.
- 확인: 설치 제공 Package만 등록되고 사용처는 해당 version을 쓰는 release에서 찾으며 개인 등록 요청은 거절된다.
- 의도: apps#I4

### 불변 version과 의존

**[R7]** SDK version은 완전한 SemVer 2.0.0 하나로 고정하고 lophn-sdk scheme의 import map에 정확한 version만 허용하며 ^·~·latest와 암묵적 최신 선택은 거절한다.
- 이유: 같은 release를 다시 실행할 때 다른 의존이 섞이지 않는다.
- 확인: 1.0.0은 받아들이고 ^1.0.0·~1.0.0·latest는 거절되며 bundle 의존 내용과 공개 내용 hash가 일치한다.
- 의도: apps#I3

**[R8]** 공개한 같은 이름·version의 코드와 안내·내용 hash는 바꾸거나 삭제하지 않고 변경은 새 version으로 추가한다.
- 이유: 과거 release와 사용 안내를 다시 읽을 수 있어야 한다.
- 확인: 공개 byte나 안내를 바꾸면 테스트가 실패하고 기존 hash를 덮어쓰지 않으며 새 version만 추가된다.
- 의도: apps#I3

**[R9]** 공개 SDK 설치 사본은 파일 권한 0444·디렉터리 권한 0555의 읽기 전용으로 제공한다.
- 이유: 실행 앱이 공용 패키지를 바꾸지 못하게 한다.
- 확인: 설치 사본의 권한을 확인하고 앱이 그 내용을 수정하려 하면 실패한다.
- 의도: apps#I3

**[R10]** 운영 release에는 고정 SDK 의존을 포함하고 그 묶음만 읽으며 실행 때 새 패키지를 다운로드하거나 다른 version으로 바꾸지 않는다.
- 이유: 로컬에서 오래 쓰는 앱이 registry 최신 상태에 따라 달라지지 않는다.
- 확인: 인터넷과 설치 사본을 바꾸어도 기존 release는 고정 byte로 동작하고 필요한 통로를 지원하지 않으면 사용 불가를 반환한다.
- 의도: apps#I3

**[R11]** lophn 설치·update는 새 SDK version만 추가하고 기존 앱의 의존은 새 release를 만들기 전에는 바꾸지 않는다.
- 이유: SDK 개선이 사용 중인 앱을 몰래 바꾸지 않는다.
- 확인: update 뒤에도 기존 pinned version이 남고 기존 앱은 그대로이며 SDK 변경은 새 release에서만 적용된다.
- 의도: apps#I3

**[R12]** SDK의 patch는 API·동작을 유지한 내부 수정·문서·예제, minor는 기존 API를 유지한 추가, major는 API·동작 제거나 변경 또는 요구 permission 증가로 구분한다.
- 이유: 고정 version을 바꾸려는 사람이 변경 영향을 예측한다.
- 확인: 공개 안내에서 세 변경을 구별하고 permission 증가를 patch나 minor로 표시하지 않는다.
- 의도: apps#I4

**[R13]** SDK 설치는 공개 마켓이나 외부 Package 등록 없이 로컬에서 검증된 설치 제공 내용만 추가한다.
- 이유: 공급망의 범위를 첫 판의 설치 제공 재료로 제한한다.
- 확인: 설치가 실제 확인한 내용만 목록에 나타나고 외부 패키지를 앱 등록처럼 바로 공개할 수 없다.
- 의도: apps#I4

### UI Package

**[R14]** @lophn/ui-control은 높이 28·32·36px의 버튼·입력·선택·체크박스·스위치·키 표시를 제공한다.
- 이유: 앱마다 기본 조작의 치수가 달라지지 않는다.
- 확인: 세 크기의 조작을 예제에서 사용하며 시각 값의 정본은 shell/design-system을 따른다.
- 의도: apps#I4

**[R15]** @lophn/ui-overlay는 tooltip·popover·메뉴·dialog·toast·command palette를 제공하고 @lophn/ui-layout은 앱 shell·tab·sidebar·grid·card·5가지 페이지 틀을 제공한다.
- 이유: 반복되는 화면 구조를 앱이 매번 새로 만들지 않는다.
- 확인: 패키지 예제에서 각 overlay와 5가지 페이지 틀을 열어 사용할 수 있다.
- 의도: apps#I4

**[R16]** @lophn/ui-reading은 Markdown·목차 tree·code block·문서 주소 표시를 제공하고 @lophn/ui-table은 정렬·페이지·열 선택·숫자 정렬·가상 scroll을 제공한다.
- 이유: 읽기와 대량 표의 기본 동작을 공유한다.
- 확인: Markdown과 code block을 읽고 숫자 열을 정렬하며 대량 행을 가상 scroll로 탐색할 수 있다.
- 의도: apps#I4

**[R17]** @lophn/ui-chart는 시계열·막대·누적 막대·분포·산점 차트를 d3-scale·d3-shape 계산과 React SVG로, node와 edge로 된 도표를 React SVG로 제공하며 누적 면은 첫 판 지원 밖으로 표시한다.
- 이유: 이전에 검증한 지원 범위와 구현 선택을 유지하되, lophn-agent/visuals#R1이 세션 시각 블록으로 산점 차트와 node·edge 도표를 같은 SDK로 그리라고 하므로 그 둘을 더한다.
- 확인: 여섯 종류를 예제에서 사용할 수 있고 누적 면을 지원한다고 안내하지 않으며 색과 치수 규칙은 shell/design-system을 따른다.
- 의도: apps#I4

**[R18]** @lophn/ui-filter는 기간·다중 선택·검색, @lophn/ui-stat은 수치·변화량, @lophn/ui-state는 loading·empty·error·freshness 상태를 제공한다.
- 이유: 조회 조건과 상태를 앱마다 다른 모양이나 뜻으로 새로 만들지 않는다.
- 확인: 읽기 명령 결과의 기간·검색·빈 결과·오류·신선도 상태를 각 component로 표시할 수 있다.
- 의도: apps#I4

**[R19]** @lophn/ui-layout·@lophn/ui-filter·@lophn/ui-state는 실제 화면과 읽기 명령 결과에 연결하고 @lophn/ui-action은 명령 버튼·확인 표시를 제공하되 외부 효과 여부만이 아니라 apps/blueprint의 사람 확인 선언을 따른다.
- 이유: 없어진 read model 선언과 external 전용 확인 기준을 되살리지 않는다.
- 확인: 명령 버튼과 확인 표시를 예제에서 사용할 수 있고 확인이 필요한 write 명령도 확인을 요구하며 확인 호출의 접수·approval 사용은 apps/invocations를 따른다.
- 의도: apps#I4

**[R20]** 시각 스타일은 @lophn/tokens 및 shell/design-system을 따른다.
- 이유: 재사용한 component가 lophn 화면과 다른 모양을 내지 않게 한다.
- 확인: component 예제의 색·치수·글꼴이 @lophn/tokens와 shell/design-system의 값과 같다.
- 의도: apps#I4

**[R21]** lophn 화면은 설치된 SDK의 첫 소비자로 공용 component를 사용하고 사용자 앱은 자신이 고정한 SDK를 사용한다.
- 이유: 플랫폼 화면에서 검증한 재료를 사용자 앱도 재사용하며 host 전용 복제 component를 만들지 않는다.
- 확인: 같은 기능이 공용 package에서 제공되고 host는 설치와 같은 SDK, 앱은 release에 고정한 SDK를 쓴다.
- 의도: apps#I4

### capability와 보고

**[R22]** capability Package는 typed client만 제공하며 그 import가 grant를 주지 않고 요구 permission을 앱 선언과 대조한다.
- 이유: SDK 사용을 권한 부여로 오해하거나 숨은 접근을 추가하지 않는다.
- 확인: permission이 빠진 앱 선언이 거절되고 실제 강제와 grant 절차는 apps/permissions를 따른다.
- 의도: apps#I6

**[R23]** capability 호출 거절은 필요한 permission 이름과 scope를 알려 준다.
- 이유: coding agent가 무엇을 선언하고 사람에게 요청해야 하는지 알 수 있어야 한다.
- 확인: 범위 밖 파일이나 network 접근을 거절하면 필요한 이름과 범위가 오류 안내에 있다.
- 의도: apps#I6

**[R24]** @lophn/cap-fs는 허락된 경로의 read·write·watch, @lophn/cap-net은 timeout·retry가 있는 fetch, @lophn/cap-store는 자기 SQLite DB와 migration 도우미를 제공한다.
- 이유: 실제 쓰는 접근 동작과 데이터 작업을 얇은 공용 클라이언트로 묶는다.
- 확인: 세 package의 예제에서 해당 기능을 사용하며 재시도가 외부 효과를 중복하지 않는지는 앱의 실제 계약으로 확인한다.
- 의도: apps#I4

**[R25]** loopback 듣기는 전용 capability Package를 만들지 않고 Deno.serve로 제공하며 주소와 permission 제한은 apps/permissions를 따른다.
- 이유: platform client가 없는 기능을 형식적인 SDK package로 만들지 않는다.
- 확인: loopback 듣기의 안내에 별도 @lophn package가 필요하다고 나오지 않는다.
- 의도: apps#I6

**[R26]** @lophn/cap-problem은 추가 permission 없이 자기 앱의 선언 code로 보고·해소 주장·변경 메모를 전달하되 problem을 직접 닫는 API는 제공하지 않는다.
- 이유: 앱의 이상 보고는 막지 않으면서 과거 해소 보고를 닫힘 결정으로 오해하지 않는다.
- 확인: 별도 permission이 없는 앱도 선언 code의 보고와 메모를 전달하고 해소 주장을 보내도 닫힘은 problems/closing을 따른다.
- 의도: apps#I6

**[R27]** @lophn/cap-schedule은 직접 명령과 automation의 같은 handler 등록·실제 invocation 문맥·log 문맥·실제 통계 요약·오류 상세·처리되지 않은 예외 수집을 제공한다.
- 이유: 별도 job 구현 없이 앱 호출과 비동기 callback의 출처를 잇는다.
- 확인: 명령과 automation에서 timer·await·SQLite·fetch 뒤에도 앱·release·preview 여부와 알려진 invocation 문맥이 이어지며 모르는 invocation은 만들지 않는다.
- 의도: apps#I5, apps#I4

**[R28]** 내부 trace 이름은 invocation과 구분하고 최대 64자로 제한하며 Deno 2.9의 비동기 문맥 유지 여부를 실제 테스트로 확인한다.
- 이유: 내부 작업 이름과 플랫폼 호출을 섞거나 runtime의 문맥 전파를 추측하지 않는다.
- 확인: 64자 이름은 받아들이고 65자는 거절하며 timer와 SQLite 호출 뒤 문맥 유지 테스트가 통과한다.
- 의도: apps#I4

**[R29]** @lophn/ui-state의 AppErrorBoundary는 앱 화면 root에서 잡은 오류를 플랫폼 오류 수집에 전달하고 템플릿에 기본 배치한다.
- 이유: 앱 화면이 깨져도 선언 보고가 빠지지 않게 한다.
- 확인: 템플릿 앱의 root 아래 오류를 일으키면 수집 통로에 전달되며 보고 처리 규칙은 problems/reporting을 따른다.
- 의도: apps#I6

**[R30]** @lophn/cap-save는 앱이 선언한 문서의 기대 version과 재전송 기준을 받는 문서 저장 client를 제공한다.
- 이유: 기존 artifact 저장을 새 문서 version 계약에 연결하고 재전송이 중복 version을 만들지 않게 한다.
- 확인: 같은 저장 요청의 재전송 결과가 하나이며 실제 선언·저장 검사는 apps/blueprint와 documents/versions를 따른다.
- 의도: apps#I4

**[R31]** @lophn/cap-secret은 grant 범위의 secret 사용 client와 preview 대역을 제공하고 무승인 secret CRUD 통로는 제공하지 않는다.
- 이유: 과거 앱 소유 secret 관리가 사람의 확인과 OS 보관 경계를 우회하지 않게 한다.
- 확인: 예제와 템플릿에서 무승인 변경이나 원값 읽기를 안내하지 않고 실제 전달과 확인은 apps/permissions 및 platform/secrets를 따른다.
- 의도: apps#I6

**[R32]** SDK client는 core DB·플랫폼 관리 credential에 직접 접근하거나 grant 발급·problem 닫힘 통로를 제공하지 않는다.
- 이유: 얇은 client가 플랫폼의 결정 권한을 갖지 않게 한다.
- 확인: 공개 API에 해당 직접 접근이 없고 앱 코드를 관리 프로세스에 import하지 않는다.
- 의도: apps#I6

### 앱 템플릿과 재사용 기준

**[R33]** 앱 템플릿은 진입 코드·blueprint·정확한 SDK import map과 lock·DB 사용 시 migration·생성 blueprint test·fixture·React 화면·coding agent 안내를 포함한다.
- 이유: 시작한 앱에 선언·테스트·오류 보고·고정 의존의 기본 연결이 빠지지 않게 한다.
- 확인: 템플릿으로 만든 앱에서 각 요소를 찾고 문제 보고·예외 수집·root 오류 경계가 기본 연결되며 안내 내용은 coding-agent/guides를 따른다.
- 의도: apps#I4

**[R34]** 앱 업무 코드는 정확한 @lophn version과 상대 import만 사용하고 GUI의 React·npm 의존은 고정 UI Package가 제공한 목록과 정확한 version만 사용한다.
- 이유: 앱 실행에서 임의 원격·npm 의존을 가져와 bundle 고정을 우회하지 않는다.
- 확인: 업무 코드의 임의 원격 import는 거절되고 GUI build는 고정 의존으로 개발 때 완료되며 운영에서는 build나 다운로드를 하지 않는다.
- 의도: apps#I3

**[R35]** 템플릿은 사람이 명시한 override를 먼저 확인하고 설치 제공 템플릿을 다음으로 사용하며 둘 다 없으면 검증된 설치 템플릿을 제공한다.
- 이유: 개발용 선택을 유지하면서 템플릿 부재 때문에 앱 시작이 막히지 않게 한다.
- 확인: 두 후보를 다르게 지정하면 override를 쓰고 없으면 설치 후보를 쓰며 제공된 템플릿 내용은 고정 hash로 확인된다.
- 의도: apps#I4

**[R36]** 재사용 재료는 lophn 화면과 MaHas 등 실제 2개 이상의 사용처에서 확인된 도메인 이름·명확한 입출력·token 기반 스타일을 기준으로 자라며 앱 DB 구조·앱 전용 prop·한 곳 layout 조정은 앱에 남긴다.
- 이유: 미래를 추측해 거대한 SDK를 만들거나 한 앱의 내부 구조를 모든 앱에 강제하지 않는다.
- 확인: 재사용 이유에서 실제 사용처 2개를 찾고 한 번만 쓴 harness 사용량 parser나 앱 전용 prop을 개인 Package로 자동 승격하지 않는다.
- 의도: apps#I4

### 패널·카드와 화면 context

**[R37]** 공용 layout component는 전체·패널·카드의 container 크기에 반응하고 패널은 너비 320px·카드는 너비 240px부터 페이지 가로 scroll 없이 읽기와 조작을 제공한다.
- 이유: 창 크기가 아니라 실제 넣은 영역에 맞는 앱을 만든다.
- 확인: 같은 앱 화면을 전체·320px 패널·240px 카드에 넣고 resize해도 조작과 상태 표시가 사라지지 않는다.
- 의도: apps#I8

**[R38]** 공용 차트·표 component는 앱 화면과 lophn 세션의 선언형 시각 블록에서 같은 입력 계약으로 사용하고 임의 script 실행 없이 loading·empty·error 표시를 제공한다.
- 이유: 앱과 agent 답의 시각 재료를 별도로 복제하지 않는다.
- 확인: 같은 데이터가 앱과 lophn 화면에서 같은 component로 그려지고 표가 크면 component 내부에서 scroll하며 지원 종류는 R16·R17을 따른다.
- 의도: apps#I4, apps#I8

**[R39]** SDK는 apps/agent-context의 화면 상태 등록·민감한 칸 제거·요약과 상세 반환·선언된 주석 handler 및 revision 검사를 제공한다.
- 이유: 앱마다 context 공유의 안전 계약을 다시 구현하지 않는다.
- 확인: 템플릿 예제에서 코드 입력과 지난 attempt를 공유하고 민감한 칸은 빠지며 옛 revision의 주석은 거절된다.
- 의도: apps#I9

**[R40]** SDK는 apps/connections의 선언·grant로 제한한 다른 앱 command client를 제공하고 실제 app·release·부모 invocation 문맥을 전달하되 import만으로 연결 허락을 주지 않는다.
- 이유: SDK의 다른 앱 호출도 같은 API와 권한·출처를 쓴다.
- 확인: 허락된 command만 같은 handler로 호출되고 미허락 연결과 caller 신원 위조가 거절된다.
- 의도: apps#I7

### 공용 화면 언어

**[R41]** 공용 UI SDK와 앱 템플릿은 shell/wording의 message key·en-only·ICU·Intl 계약을 사용하고 고정 사용자 문구·en catalog와 placeholder 검사를 기본 build/test에 연결하며 message key와 앱 command·screen 식별자를 분리한다.
- 이유: 공용 재료로 만든 앱도 화면 언어와 i18n을 별도로 다시 구현하거나 내부 key를 사용자 라벨로 노출하지 않는다.
- 확인: 템플릿 앱은 en만으로 동작하고 고정 문구의 직접 삽입·빠진 en key·placeholder 불일치가 검사에서 실패하며 catalog 문구를 바꿔도 command와 screen key는 같다.
- 의도: apps#I4

## 열린 질문

## 버린 것

- UI component의 기본 accessibility 속성과 "마우스 없이 모든 조작" 요구: 접근성(screen reader, ARIA, WCAG, reduced-motion, 키보드만으로 모든 조작)은 작은 오픈소스 MVP의 범위 밖이다. 키보드 shortcut은 shell이 맡는다.
- @lophn과 @me의 두 SDK 계층·개인 namespace 변경·개인 등록과 공유·승격·SDK 전파 workflow: 첫 판은 설치 제공 Package만 등록한다.
- major별 소비 release 영향 보고와 별도 사람 승인 entity, SDK 공개 event의 agent 기동: 앱 activation 검토는 apps/releases가 맡고 event로 agent를 깨우지 않는다.
- @lophn/cap-read-model: 별도 read model Package는 만들지 않고 앱 사이 command 호출은 @lophn/cap-schedule과 apps/connections를 따른다.
- @lophn/cap-secret 0.2.0의 앱 소유 secret 무승인 CRUD와 사용자 secret 분기: 새 secret 확인·전달 계약에 맞지 않으므로 과거 공개 기능을 되살리지 않는다.
- 과거 공개 @lophn/cap-problem 0.1.0의 해소 보고가 닫힘을 결정하는 API, @lophn/blueprint 0.4.0의 Home 변경 계약: 새 report·문서·command 계약은 동일 공개 version의 byte를 바꾸어 이식하지 않는다.
- SDK 개발 milestone M0→M1→M3와 runtime export의 기간 제한 adapter 이관: 처음부터 다시 만들며 과거 workspace 이관을 제품 규칙으로 두지 않는다.
