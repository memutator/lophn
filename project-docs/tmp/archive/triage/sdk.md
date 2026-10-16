# triage: sdk

옛 파일: `apps/sdk.md` (R1 ~ R41). 새 파일은 `sdk.yaml`(subject sdk, sdk-api; 맡은 interface sdk-api).

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| sdk R1 | defer-other | design | lophn 화면과 사용자 앱이 같은 UI kit을 쓴다. | | UI kit 자체는 design. TypeScript/Deno/React 기반이라는 말은 구현 선택 |
| sdk R2 | defer-other | app-packages | package는 component, capability, domain, format 네 종류 중 하나이고 한 package는 한 종류만 담는다. | | package 계약은 package-spi, 목록은 app-packages |
| sdk R3 | defer-other | app-packages | package 목록에서 이름, 목적, 쓸 수 있는 정확한 버전, 공개 API와 type, 요구 permission, peer 의존, 예제를 읽을 수 있다. | | 목록은 app-packages |
| sdk R4 | ask | | | | 첫 묶음의 이름 목록에 지운 것(cap-save, 앱 문서 저장)과 거취가 정해지지 않은 것(cap-schedule, format package)이 섞여 있다. SDK가 처음 내놓을 package 구성과 버전을 사람이 새로 정해야 한다 |
| sdk R5 | candidate | sdk | SDK는 앱 blueprint 선언을 작성하고 검사하는 도우미를 제공하고, 도우미의 검사는 lophn이 앱 정의를 받을 때의 검사와 같은 기준을 쓴다. | 같은 blueprint 선언을 도우미로 검사한 결과가 lophn이 앱 정의를 받을 때의 검사 결과와 같다; 도우미로 쓴 앱과 직접 쓴 앱에서 같은 선언은 같은 검사 결과를 낸다 | 앱 정의 검사 계약은 app-releases와 맞춰야 한다 |
| sdk R6 | defer-other | app-packages | package 목록과 사용처는 공개 package와 release의 고정 의존에서 조회한다. 사용처는 그 버전을 쓰는 release에서 찾는다. | | 목록은 app-packages. 개인 namespace와 개인 등록은 옛 문서가 첫 판에서 이미 버린 것이라 옮기지 않는다 |
| sdk R7 | defer-other | app-packages | package 버전은 완전한 SemVer 하나로 고정하고, 범위나 latest 같은 암묵적 선택은 거절한다. bundle의 의존 내용과 공개 내용 hash가 일치한다. | | package-spi와 버전 관리 |
| sdk R8 | defer-other | package-spi | 공개한 같은 이름과 버전의 코드, 안내, 내용 hash는 바뀌지 않고 변경은 새 버전으로 추가된다. | | package 한 버전의 계약 |
| sdk R9 | defer-other | app-packages | 설치된 공개 package 사본은 읽기 전용이라 실행 중인 앱이 고칠 수 없다. | | 사본 관리는 app-packages |
| sdk R10 | defer-other | app-releases | 운영 release는 고정한 package 의존을 담고 그 묶음만 읽는다. 실행 때 새 package를 받거나 다른 버전으로 바꾸지 않는다. | | release 구성은 app-releases |
| sdk R11 | defer-other | app-packages | lophn 설치와 update는 새 package 버전만 추가하고, 기존 앱의 의존은 새 release를 만들기 전에는 바뀌지 않는다. | | install-and-update는 이번 범위 밖, 의존 고정은 app-packages |
| sdk R12 | defer-other | package-spi | patch는 API와 동작을 유지한 수정, minor는 기존 API를 유지한 추가, major는 API나 동작의 제거·변경 또는 요구 permission 증가다. 공개 안내에서 세 변경을 구별한다. | | 버전 뜻은 package-spi |
| sdk R13 | drop-dup | | | | sdk R6(목록은 공개 package만 다룬다) |
| sdk R14 | defer-other | design | 높이 28, 32, 36px의 button, 입력, 선택, checkbox, switch, 키 표시를 제공한다. | | UI kit 자체 |
| sdk R15 | defer-other | design | UI kit이 tooltip, popover, 메뉴, dialog, toast, command palette와 앱 shell, tab, sidebar, grid, card, 페이지 틀을 제공한다. | | UI kit 자체. R15는 독립 보장이 둘이나 같은 design 몫이라 한 줄로 둔다 |
| sdk R16 | defer-other | design | UI kit이 Markdown, 목차 tree, code block과 정렬·페이지·열 선택·가상 scroll이 되는 표를 제공한다. | | UI kit 자체. |
| sdk R17 | defer-other | design | UI kit이 시계열, 막대, 누적 막대, 분포, 산점 chart와 node-edge 도표를 제공한다. | | UI kit 자체 |
| sdk R18 | defer-other | design | UI kit이 기간, 다중 선택, 검색 filter와 수치·변화량 표시, loading·empty·error·freshness 상태를 제공한다. | | UI kit 자체 |
| sdk R19 | defer-other | design | UI kit이 명령 button과 확인 표시를 제공하고, 확인은 앱 blueprint가 선언한 사람 확인을 따른다. | | UI kit 자체. 확인 호출의 접수는 app-runtime |
| sdk R20 | defer-other | design | UI kit 예제의 색, 치수, 글꼴은 design token과 같다. | | UI kit 자체 |
| sdk R21 | drop-dup | | | | sdk R1(공용 UI kit 쓰기), sdk R10과 R34(앱은 고정한 의존을 쓴다) |
| sdk R22 | defer-other | app-capability-api | SDK의 capability client를 import하는 것만으로는 권한이 생기지 않고, client가 요구하는 permission은 앱 선언과 대조된다. | | permission 강제는 app-runtime과 app-capability-api |
| sdk R23 | defer-other | app-capability-api | capability 호출이 거절되면 오류에 필요한 permission 이름과 범위가 담긴다. | | 거절 결과는 capability API가 정한다 |
| sdk R24a | candidate | sdk | SDK는 앱이 허락받은 경로의 파일을 읽고, 쓰고, 변경을 지켜보는 typed client를 제공한다. | 앱이 client로 허락받은 경로의 파일을 읽고 쓴다; 같은 경로의 변경을 client로 지켜본다 | |
| sdk R24b | candidate | sdk | SDK는 timeout과 재시도를 지정할 수 있는 network 요청 client를 제공한다. | timeout을 넘긴 요청이 오류로 끝난다; 지정한 횟수만큼 요청이 다시 간다 | 재시도가 외부 효과를 중복하지 않는지는 앱 몫 |
| sdk R24c | candidate | sdk | SDK는 앱이 자기 DB를 쓰는 client와 DB 구조를 바꾸는 도우미를 제공한다. | 앱이 client로 자기 DB를 열고 읽고 쓴다; 도우미로 DB 구조를 바꾼 뒤 앱이 새 구조로 동작한다 | 앱 data 자체는 app-data |
| sdk R25 | drop-detail | | | | 어떤 package가 없다는 문장(README 2장). loopback 듣기의 주소와 permission 제한은 app-runtime |
| sdk R26 | candidate | sdk | SDK는 앱이 자기가 선언한 code로 problem 보고와 변경 메모를 보내는 client를 제공하고, 별도 permission 없이 쓸 수 있다. | permission을 따로 선언하지 않은 앱이 선언한 code로 보고를 보내면 problems가 받는다; 같은 client로 변경 메모를 보낸다 | 해소 주장이 닫힘을 정하지 않는 규칙은 problems 몫이라 옮기지 않는다 |
| sdk R27 | ask | | | | 이 package는 직접 명령과 automation이 같은 handler를 쓰는 것, 호출 문맥·log 문맥 전달, 통계, 처리되지 않은 예외 수집을 묶고 있다. automation이 주기 실행(보류)을 가리키는지, 호출 문맥 전달과 예외 수집만 남기는지 정해야 한다. 남으면 subject가 sdk인지 app-runtime인지도 정해야 한다 |
| sdk R28 | drop-detail | | | | 내부 trace 이름 길이와 Deno 버전 시험은 구현 세부. 남는다면 sdk R27의 결정을 따른다 |
| sdk R29 | candidate | sdk | SDK는 앱 화면 root에서 잡힌 오류를 problem 보고 통로로 전달하는 오류 경계를 제공한다. | 앱 화면 root 아래에서 오류를 일으키면 problem 보고 통로에 전달된다; 앱 template로 만든 앱에 기본으로 오류 경계가 놓인다 | 오류 경계 component는 design의 상태 부품이지만 전달 통로는 sdk 몫. template 배치는 sdk R33과 같이 정리 |
| sdk R30 | drop-removed | | | | 앱 문서(removed.md 1장 "앱 문서": 앱의 document.save 권한) |
| sdk R31 | candidate | sdk | SDK는 앱이 grant받은 범위의 secret만 쓰는 client와 preview에서 쓰는 대역을 제공한다. | grant받은 secret은 client로 쓸 수 있다; grant 범위 밖 secret을 client로 청하면 거절 결과가 돌아온다 | 새 secrets 모델에서 앱 secret 쓰기가 어떻게 남는지는 secrets 묶음의 결정과 맞춘다 |
| sdk R32 | drop-detail | | | | core DB나 관리 credential에 닿지 않는다는 문장은 없는 것을 찾는 문장(README 2장). SDK의 의존 방향은 catalog depends_on이 정한다 |
| sdk R33 | defer-other | apps | 앱 template은 진입 code, blueprint, 정확한 SDK 의존 설정, 시험, fixture, React 화면, coding agent 안내를 담는다. | | template 소유는 catalog가 sdk가 아니라 apps 쪽으로 읽힌다. 사람이 다르게 정하면 sdk로 옮긴다 |
| sdk R34 | defer-other | app-releases | 앱 업무 code는 정확한 버전의 @lophn package와 상대 import만 쓰고, GUI 의존은 고정된 UI package 목록만 쓴다. 운영에서는 build와 다운로드를 하지 않는다. | | 의존 검사는 release 구성 몫 |
| sdk R35 | defer-other | apps | template은 사람이 지정한 것을 먼저 쓰고, 없으면 설치가 제공한 것을 쓴다. | | R33과 같이 template 소유가 apps |
| sdk R36 | drop-detail | | | | 재사용 재료를 고르는 개발 방침이지 판정할 보장이 아니다 |
| sdk R37 | defer-other | design | 공용 layout component는 전체, 패널, 카드의 container 크기에 반응하고, 패널은 너비 320px, 카드는 240px부터 가로 scroll 없이 읽고 조작할 수 있다. | | UI kit 자체 |
| sdk R38 | defer-other | design | chart와 표 component는 앱 화면과 agent session의 시각 블록에서 같은 입력으로 쓰이고, loading·empty·error 표시를 제공한다. | | UI kit 자체 |
| sdk R39 | ask | | | | 앱 화면 상태를 agent에게 공유하는 기능(화면 상태 등록, 민감한 칸 제거, 요약과 상세, 주석 handler)이 새 모델(자리에 놓인 agent, 새 Context)에서 남는지 정해야 한다. 남는다면 이름이 새 Context와 겹치지 않게 다시 지어야 한다 |
| sdk R40 | defer-other | app-runtime | 다른 앱의 command를 부르는 client는 앱이 선언하고 grant받은 연결로만 부르며, 부르는 앱과 부모 호출 문맥을 전달한다. | | 호출과 신원 확인은 app-runtime과 app-direct-protocol |
| sdk R41 | defer-other | design | 공용 UI는 message key로 사용자 문구를 받고 en catalog를 기본으로 쓰며, 앱 command와 screen 식별자는 message key와 분리된다. | | 화면 말 계약은 design과 shell 쪽. template build 검사 연결은 apps |

## 개수

| 판정 | 개수 |
|---|---|
| candidate | 7 (R5, R24a, R24b, R24c, R26, R29, R31) |
| drop-removed | 1 |
| drop-conflict | 0 |
| drop-dup | 2 |
| drop-detail | 4 |
| defer-other | 26 |
| ask | 3 |

합계 43줄이다(요구 41개에서 R24를 셋으로 나눠 +2).
