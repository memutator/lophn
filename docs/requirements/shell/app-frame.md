---
type: requirements
concerns: [shell/app-frame]
---
# shell/app-frame

앱 view를 감싸는 플랫폼 크롬·분리된 view session·native view 표시 및 앱이 깨져도 동작하는 문제 알리기를 맡는다; 호출의 의미·권한은 apps/invocations·apps/permissions, 피드백 내용과 수집은 problems/feedback이 맡는다.

## 요구

### 화면과 조작

**[R1]** 앱과 격리 문서 view는 서로 다른 custom scheme으로 열고 앱별 지속 session과 문서 고정 판별 메모리 session을 사용한다.
- 이유: 앱 상태와 문서 고정 판의 저장 상태가 서로 섞이지 않게 한다.
- 확인: 앱 간·문서 판 간 쿠키와 저장 상태가 섞이지 않는다.
- 의도: platform#I2

**[R2]** 보이는 앱·격리 문서 view마다 renderer를 분리하고 Node 접근 없이 network 기본 차단을 지킨다.
- 이유: 한 view가 다른 view의 권한을 빌리지 못하게 한다.
- 확인: 한 view의 Node·네트워크 요청이 다른 view의 권한을 쓰지 못한다.
- 의도: platform#I2, shell#I4

**[R3]** 모든 view에 sandbox·context isolation·web security를 켜고 Node integration을 끈다.
- 이유: 앱·문서 코드의 OS 접근을 차단한다.
- 확인: 배포된 view가 OS sandbox를 포함한 격리 테스트를 통과한다.
- 의도: platform#I2

**[R4]** view의 새 창·camera·location 요청은 기본 거부하고 자기 scheme·경로 밖 탐색을 막으며 packaged build의 devtools는 끈다.
- 이유: 페이지가 허용하지 않은 창·장치·탐색을 열지 못하게 한다.
- 확인: 각 요청이 거절되고 외부 문서가 view 안에서 열리지 않는다.
- 의도: platform#I2

**[R5]** 앱의 외부 링크는 live·preview 모두 HTTP·HTTPS이면서 userinfo가 없고 8,192자 이하인 URL만 확인 없이 OS 기본 browser로 연다.
- 이유: 앱 링크의 안전 범위를 URL 형식으로 명확히 제한한다.
- 확인: 다른 scheme·userinfo·8,193자 URL은 아무것도 열지 않는다.
- 의도: platform#I2

**[R6]** 외부 URL은 앱 view 안에서 열지 않고 열기 기록에는 origin·경로만 남겨 query·fragment의 OAuth state·비밀을 제외한다.
- 이유: 링크 기록에 로그인 비밀을 남기지 않는다.
- 확인: OAuth URL을 열어도 query와 state가 기록에서 발견되지 않는다.
- 의도: platform#I2

**[R7]** shell 크롬의 외부 URL 열기는 앱 링크와 구별하여 confirmation을 받은 뒤 OS browser로 연다.
- 이유: 신뢰하는 shell 링크와 앱 콘텐츠 링크의 경계를 구별한다.
- 확인: shell과 앱의 링크 열기 경로가 서로의 확인 규칙을 대신하지 않는다.
- 의도: shell#I3

**[R8]** shell·앱·문서 고정 판의 session은 쿠키·localStorage·IndexedDB·cache를 각각 분리한다.
- 이유: 같은 저장 key를 써도 다른 대상의 데이터를 읽지 못하게 한다.
- 확인: 같은 이름의 저장값을 넣어도 다른 session에서 읽지 못한다.
- 의도: platform#I2

**[R9]** Electron main은 문서 blob·앱 GUI 요청을 proxy하고 view에 daemon·앱 내부 port를 노출하지 않는다.
- 이유: 내부 서비스 주소를 페이지의 직접 접근 경로로 만들지 않는다.
- 확인: view 주소와 preload에서 내부 port가 드러나지 않는다.
- 의도: platform#I2

**[R10]** 문서 고정 판 view를 닫으면 그 메모리 session의 저장 상태를 지운다.
- 이유: 닫힌 문서의 임시 상태를 다음 view에 넘기지 않는다.
- 확인: 닫고 다시 연 판에서 앞의 메모리 저장값을 읽지 못한다.
- 의도: platform#I2

**[R11]** custom scheme의 host 소문자 변환을 고려하여 view 대상 주소를 소문자 DNS label로 표현하고 다른 앱·고정 판으로 바뀌지 않게 해석한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 대소문자 변환 전후 같은 고정 판과 앱으로만 이어진다.
- 의도: shell#I1

**[R12]** 앱 view 요청의 앱·release 신원은 main이 실제 view에서 정하여 페이지의 앱·주체 주장을 무시하며 actor 인증은 platform/identity를 따른다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 페이지가 다른 앱과 사람을 주장해도 view에 묶인 신원만 전달된다.
- 의도: platform#I2

**[R13]** preload는 schema로 제한한 구조화된 통로만 제공하고 token·임의 method·임의 경로·파일 시스템 접근을 view에 노출하지 않는다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 임의 경로와 method 요청이 거절되고 token을 읽지 못한다.
- 의도: platform#I2

**[R14]** 문서 view에는 원본 파일 수정 통로를 제공하지 않고 수정은 shell/editor에서만 하게 한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 격리 문서 스크립트가 원본을 쓰지 못한다.
- 의도: shell#I5, documents#I1

**[R15]** 앱 preload는 자기 앱의 명령·읽기 명령·외부 링크 통로만 노출하고 apps/invocations의 직접 호출 계약을 쓰며 confirm 명령은 platform/approvals로 연결한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 별도 Query나 임의 API가 없고 일반 읽기가 ledger 쓰기 완료를 기다리지 않는다.
- 의도: platform#I2, platform#I3

**[R16]** 앱·문서 view 외부 network 요청은 session에서 기본 차단하고 자기 scheme과 apps/permissions가 부여한 앱 fetch host만 통과시킨다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 미부여 host 요청과 문서 외부 요청이 차단된다.
- 의도: platform#I2

**[R17]** 문서 view에는 CSP를 겹쳐 기본 resource와 connection을 차단하고 script·style·font는 자기 자원, 이미지는 자기 자원·data만 허용한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 문서가 외부 script·font·connection을 시작하지 못한다.
- 의도: platform#I2

**[R18]** 본문 view·앱 전용 새 창·OS 설치형 앱 창은 동일한 session·scheme·preload 경계를 유지한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 세 표시 방식에서 같은 격리 테스트가 통과한다.
- 의도: platform#I2

**[R19]** 앱 UI 코드를 shell renderer에 import하지 않고 신원·session·network 정책을 실제 앱과 release에 묶는다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 앱 UI의 crash가 shell renderer 코드를 직접 실행하거나 바꾸지 않는다.
- 의도: shell#I4, platform#I2

**[R20]** view 존재만으로 일반 사람·수리 권한을 부여하지 않고 schema 검증한 preload만 사용한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: view를 만든 것만으로 coding-agent/connection이나 apps/permissions의 권한이 생기지 않는다.
- 의도: platform#I2

**[R21]** 앱 UI의 무한 loop·큰 렌더링·crash에서도 shell·다른 앱 조작을 테스트하며 WebContents 분리만으로 자원 격리 완료라고 표시하지 않는다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 각 부하를 주어 shell과 다른 앱을 조작하고 platform/responsiveness의 기준을 검사한다.
- 의도: shell#I4

**[R22]** view 생성·교체·폐기·실제 표시를 같은 view 식별로 되짚을 수 있게 한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 교체 전후 실제 어떤 앱·release가 표시됐는지 이어 읽는다.
- 의도: platform#I1

**[R23]** main은 신원·검증 IPC·OS 통합을 담당하고 renderer는 DB·비밀·플랫폼 token을 직접 소유하지 않는다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: renderer에서 비밀·token·DB를 직접 읽지 못한다.
- 의도: platform#I2

**[R24]** tooltip·sheet·메뉴·popover·팔레트·dialog는 앱 view 위에 놓인 shell overlay view에 그려 앱 view를 숨기지 않고 sheet는 backdrop 없이 Escape·바깥 click으로 닫는다.
- 이유: 앱 view는 shell HTML 위에 붙어 z-index로 덮을 수 없으므로 떠 있는 UI를 그보다 위 층에서 그리고, 메뉴를 열 때마다 앱 화면이 사라지지 않게 한다.
- 확인: 앱 영역에 걸친 메뉴·팔레트·dialog가 앱 화면 위에 보이고 여는 동안과 닫은 뒤 앱 view가 한 frame도 사라지지 않는다.
- 의도: shell#I1, shell#I2

**[R25]** 앱 view는 배정된 앱 공간·탭 패널·세션 카드의 본문 경계 안에서 자기 페이지 머리부터 그리며 바깥 크롬은 shell이 그린다.
- 이유: 앱 화면이 어디에 놓여도 플랫폼의 조작과 신원을 가리지 않게 한다.
- 확인: 전체 화면·패널·카드에서 앱이 shell 크롬을 차지하지 않는다.
- 의도: shell#I7, apps#I10

**[R26]** 앱 공간은 얇은 바와 전체 native view를 기본으로 하고 운영 패널은 720px로 열며 창 폭 1,024px 미만에서는 앱 view를 숨기지 않고 패널이 덮지 않는 영역으로 bounds를 줄인다.
- 이유: 패널을 여는 동안에도 남은 자리에서 앱 화면을 보이게 한다.
- 확인: 넓고 좁은 창에서 정한 패널 배치가 측정되고 좁은 창에서도 앱 view가 사라지지 않으며 패널을 닫으면 원래 bounds로 돌아온다.
- 의도: shell#I6, shell#I8

**[R27]** 앱 view와 문서·터미널은 shell/workspace의 프로젝트 분할 칸에 나란히 놓을 수 있고 앱 공간으로의 전환 때에는 그 공간에서 보이지 않는 view만 숨긴다.
- 이유: 문서 옆에서 반응형 앱을 쓰는 사람의 프로젝트 배치를 지킨다.
- 확인: 문서와 앱 패널을 나란히 보고 다른 공간으로 이동하면 이전 공간의 view가 숨겨진다.
- 의도: shell#I7

**[R28]** 보이는 각 칸과 카드에는 자기 경계 안의 native view를 동시에 표시할 수 있고 키보드 입력 focus는 한 view 또는 shell 조작에만 둔다.
- 이유: 나란히 보는 배치를 유지하면서 입력 대상과 표시 대상을 구별한다.
- 확인: 두 native view를 동시에 보고 칸을 오가면 입력은 focus 대상에만 전달되며 view 경계가 겹치지 않는다.
- 의도: shell#I7

**[R29]** 탭·칸 경계 drag 중에는 shell overlay view가 창 본문 전체에서 pointer를 받아 앱 view를 숨기지 않고, sidebar·정보 패널 resize 중 위치 갱신은 16ms마다 한 번으로 묶으며 탭 전환 때 새 view 준비 전에 옛 view부터 숨긴다.
- 이유: drag를 앱 view가 삼키지 않게 하면서 drag 중에도 앱 화면을 보이게 한다.
- 확인: drag 포인터를 view가 삼키지 않고 drag 중 앱 화면이 보이며 전환 중 두 view가 겹친 frame이 없다.
- 의도: shell#I7, shell#I2

**[R30]** confirmation window가 열려도 native view를 숨기거나 떼지 않고 열린 동안 부모 창의 native view 입력만 막는다.
- 이유: 별도 창인 confirmation window는 앱 view가 덮을 수 없고, 사람은 보던 앱 화면을 보며 결정한다.
- 확인: confirmation window가 열린 동안 앱 view가 보이고 click·키 입력이 앱에 전달되지 않는다.
- 의도: shell#I3

**[R31]** 문제 알리기는 앱 공간 바의 독립 버튼으로 두어 앱 view 캡처를 먼저 요청한 뒤 shell overlay view에 dialog를 연다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 메뉴를 열기 전 캡처가 가능하고 수집 성공·실패 표시는 problems/feedback을 따른다.
- 의도: shell#I4, problems#I2

**[R32]** 문제 알리기는 모든 앱 화면의 shell 크롬에서 앱 view가 깨져도 조작 가능하게 유지한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: view crash·무한 loop 후에도 버튼으로 problems/feedback 화면을 연다.
- 의도: shell#I4

### 패널과 카드

**[R33]** 프로젝트 앱 패널과 세션 앱 카드는 전체 앱 view와 같은 실제 앱·release·모드 신원과 session·scheme·preload·network 격리를 사용하고 앱 UI 코드를 shell renderer에 import하지 않는다.
- 이유: 작은 표시 방식이 격리와 권한의 예외가 되어서는 안 된다.
- 확인: 패널·카드·전체 앱 화면에서 같은 격리 테스트를 통과하고 preview와 운영 상태가 섞이지 않는다.
- 의도: shell#I4, platform#I2

**[R34]** 탭 패널과 세션 카드마다 앱 이름·모드·연결 상태와 독립된 [문제 알리기]를 shell 크롬에 표시하고 버튼은 그 패널 또는 카드의 실제 view에 묶는다.
- 이유: 같은 앱의 여러 화면 중 무엇이 깨졌는지 정하고 앱 고장 밖에서 보고한다.
- 확인: 같은 앱의 패널 두 개 중 하나가 crash해도 각 버튼이 원래 view의 feedback을 열고 없어진 캡처는 없다고 표시한다.
- 의도: shell#I4

**[R35]** 패널·카드의 resize·스크롤·탭 전환에는 모든 보이는 view의 경계를 함께 적용하고 카드가 화면 밖이면 숨긴다.
- 이유: 작은 view도 자기 경계 밖에 남아 다른 칸·크롬을 가리지 못하게 한다.
- 확인: 카드 스크롤·두 패널 resize에서 view가 경계 밖에 보이는 frame이 없다.
- 의도: shell#I7

**[R36]** 좁은 창에서 대화·정보 패널이 본문을 덮을 때는 앱 view를 숨기지 않고 bounds를 패널이 덮지 않는 영역으로 줄인다.
- 이유: 패널을 여는 동안에도 남은 자리에서 앱 화면을 보이게 한다.
- 확인: 1,024px 미만 창에서 대화 패널을 열면 앱 view가 패널 옆 남은 폭으로 줄고 사라지지 않으며 닫으면 원래 bounds로 돌아온다.
- 의도: shell#I6, shell#I8

## 열린 질문

- shell/app-frame#Q1 문서 session을 고정 판마다 나눌까, 문서 단위로 공유할까?

## 버린 것

- 떠 있는 UI를 열 때·경계 drag 중 native view 숨김 — 앱 화면이 사라지는 UX 손해가 커서 버리고 shell overlay view로 대신한다(R24, R29, R31).
- lophn sidebar 안 앱 view와 M1 이후 새 창 버튼 — 같은 원문의 후반 결정이 얇은 바 앱 공간으로 대체하고 milestone 조건은 폐기했다.
