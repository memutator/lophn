# 앞 묶음에서 apps·coding-agent로 미룬 줄

approvals-config.md: | approvals R8c | defer-other | app-runtime | 같은 command 요청을 다시 보내면 새 접수를 만들지 않고 같은 접수를 돌려준다. | | 접수는 앱 호출 쪽 몫이다. |
approvals-config.md: | settings R31 | defer-other | coding-agent | coding agent의 실행 파일 경로·감지 결과·session 관측은 이 컴퓨터에서 확인한 사실로 따로 두고, 사람의 설정 선택으로 저장하지 않는다. | | 설정 항목의 뜻은 coding agent 몫이다. |
problems-a.md: | problem-codes R8 | defer-other | app-releases | 앱은 예상 실패를 선언하지 않아도 process 예외 수집과 저장 전 redaction 경로를 갖추고, 화면이 있으면 view 예외 수집과 제보 경로도 갖춰야 release로 인정된다. | | release 인정 검사는 app-releases 몫이다. problems-b tests가 같은 검사를 덮는지 대조가 필요하다 |
problems-a.md: | problem-codes R9 | defer-other | app-releases | 선언한 problem code마다 실제 실패 경로를 거쳐 그 보고가 접수됨을 확인하는 테스트가 최소 하나 있어야 release로 인정된다. | | release 인정 검사는 app-releases 몫이다. problems-b tests와 대조가 필요하다 |
problems-b.md: | tests R6 | defer-other | app-releases | release 준비의 app test는 고정 blueprint를 검증하고 lophn 소유의 필수 검사를 만든 뒤 최소 권한 Deno 테스트를 실제로 돌리며, coding agent가 필수 검사를 바꾸지 못한다 | blueprint와 handler가 어긋나거나 필수 검사를 지우면 실패한다 | 앱 release 준비 검사라 app-releases 쪽 |
problems-b.md: | tests R7 | defer-other | app-releases | app test는 선언한 problem code마다 실제 실패 경로 하나 이상과 보고, 예외, feedback, redaction, 권한 거절, 고정 SDK를 검사한다 | 경로 하나를 뺀 fixture는 통과하지 못한다 | 앱 release 준비 검사라 app-releases 쪽 |
problems-b.md: | tests R8 | defer-other | app-releases | 앱 DB migration은 빈 DB에 전체 적용한 경우와 이전 release schema에서 새 schema로 적용한 경우를 모두 검사한다 | 두 fixture를 각각 돌려 한쪽이 실패하면 통과하지 못한다 | 앱 release 준비 검사라 app-releases 또는 app-data 쪽 |
problems-b.md: | tests R9 | defer-other | app-releases | app test는 read command의 입력 계약과 부작용 없음, automation의 실행 가능 범위, 되돌리기를 지원하는 write의 되돌림을 fixture로 검사한다 | 잘못된 입력, read의 업무 쓰기, grant 없는 접근을 넣으면 실패한다; write는 변경 뒤 되돌리면 원래 상태와 일치한다 | 앱 release 준비 검사라 app-releases 쪽. blueprint, automation, 되돌림이 새 설계에 어떻게 남는지는 그 쪽에서 확인 |
sdk.md: | sdk R2 | defer-other | app-packages | package는 component, capability, domain, format 네 종류 중 하나이고 한 package는 한 종류만 담는다. | | package 계약은 package-spi, 목록은 app-packages |
sdk.md: | sdk R3 | defer-other | app-packages | package 목록에서 이름, 목적, 쓸 수 있는 정확한 버전, 공개 API와 type, 요구 permission, peer 의존, 예제를 읽을 수 있다. | | 목록은 app-packages |
sdk.md: | sdk R6 | defer-other | app-packages | package 목록과 사용처는 공개 package와 release의 고정 의존에서 조회한다. 사용처는 그 버전을 쓰는 release에서 찾는다. | | 목록은 app-packages. 개인 namespace와 개인 등록은 옛 문서가 첫 판에서 이미 버린 것이라 옮기지 않는다 |
sdk.md: | sdk R7 | defer-other | app-packages | package 버전은 완전한 SemVer 하나로 고정하고, 범위나 latest 같은 암묵적 선택은 거절한다. bundle의 의존 내용과 공개 내용 hash가 일치한다. | | package-spi와 버전 관리 |
sdk.md: | sdk R8 | defer-other | package-spi | 공개한 같은 이름과 버전의 코드, 안내, 내용 hash는 바뀌지 않고 변경은 새 버전으로 추가된다. | | package 한 버전의 계약 |
sdk.md: | sdk R9 | defer-other | app-packages | 설치된 공개 package 사본은 읽기 전용이라 실행 중인 앱이 고칠 수 없다. | | 사본 관리는 app-packages |
sdk.md: | sdk R10 | defer-other | app-releases | 운영 release는 고정한 package 의존을 담고 그 묶음만 읽는다. 실행 때 새 package를 받거나 다른 버전으로 바꾸지 않는다. | | release 구성은 app-releases |
sdk.md: | sdk R11 | defer-other | app-packages | lophn 설치와 update는 새 package 버전만 추가하고, 기존 앱의 의존은 새 release를 만들기 전에는 바뀌지 않는다. | | install-and-update는 이번 범위 밖, 의존 고정은 app-packages |
sdk.md: | sdk R12 | defer-other | package-spi | patch는 API와 동작을 유지한 수정, minor는 기존 API를 유지한 추가, major는 API나 동작의 제거·변경 또는 요구 permission 증가다. 공개 안내에서 세 변경을 구별한다. | | 버전 뜻은 package-spi |
sdk.md: | sdk R22 | defer-other | app-capability-api | SDK의 capability client를 import하는 것만으로는 권한이 생기지 않고, client가 요구하는 permission은 앱 선언과 대조된다. | | permission 강제는 app-runtime과 app-capability-api |
sdk.md: | sdk R23 | defer-other | app-capability-api | capability 호출이 거절되면 오류에 필요한 permission 이름과 범위가 담긴다. | | 거절 결과는 capability API가 정한다 |
sdk.md: | sdk R33 | defer-other | apps | 앱 template은 진입 code, blueprint, 정확한 SDK 의존 설정, 시험, fixture, React 화면, coding agent 안내를 담는다. | | template 소유는 catalog가 sdk가 아니라 apps 쪽으로 읽힌다. 사람이 다르게 정하면 sdk로 옮긴다 |
sdk.md: | sdk R34 | defer-other | app-releases | 앱 업무 code는 정확한 버전의 @lophn package와 상대 import만 쓰고, GUI 의존은 고정된 UI package 목록만 쓴다. 운영에서는 build와 다운로드를 하지 않는다. | | 의존 검사는 release 구성 몫 |
sdk.md: | sdk R35 | defer-other | apps | template은 사람이 지정한 것을 먼저 쓰고, 없으면 설치가 제공한 것을 쓴다. | | R33과 같이 template 소유가 apps |
sdk.md: | sdk R40 | defer-other | app-runtime | 다른 앱의 command를 부르는 client는 앱이 선언하고 grant받은 연결로만 부르며, 부르는 앱과 부모 호출 문맥을 전달한다. | | 호출과 신원 확인은 app-runtime과 app-direct-protocol |
secrets-diagnostics-base.md: | secrets R10 | defer-other | app-runtime | 앱의 secret 사용은 앱에 준 현재 허락 범위로 판단하고, 부른 쪽이 사람 화면, agent, 자동화, 다른 앱 중 무엇인지로 막지 않는다. | | 앱 허락 모델 몫 |
secrets-diagnostics-base.md: | secrets R12 | defer-other | coding-agent | coding agent 연결용 credential은 앱 secret과 다른 용도로 keychain에 두고, 연결을 거두면 새 사용이 바로 막힌다. | | coding agent 연결 몫 |
server-supervision.md: | identity R5 | defer-other | coding-agent | 사람이 harness 연결을 고르면 lophn이 coding 자격을 만들어 OS keychain에 보관하고, 준비나 commit이 실패한 자격은 쓸 수 없게 정리한다. | | subject가 coding-agent(connection)와 secrets. 이번 범위 밖 |
server-supervision.md: | identity R9b | defer-other | app-runtime | 여러 앱의 자료를 연결해도 다른 앱의 권한이 합쳐지지 않는다. | | subject가 app-runtime. 이번 범위 밖 |
server-supervision.md: | identity R15 | defer-other | coding-agent | coding MCP·CLI는 시작할 때 신뢰하는 loader가 현재 연결·범위·process 결합을 확인한 뒤 보호된 process 안 통로로만 자격을 전달받는다. | | subject가 coding-agent(connection)와 secrets. 이번 범위 밖 |
server-supervision.md: | responsiveness R2 | defer-other | app-runtime | 앱 화면·read·command의 일반 호출은 앱으로 바로 가고 core나 기록 확정을 기다리지 않는다. | | subject가 app-runtime. 이번 범위 밖 |
server-supervision.md: | security R3 | defer-other | app-runtime | 앱은 자기 process와 저장 경계 안에서 돌아, 직접 OS 접근이나 다른 앱 접근이 막힌다. | | subject가 app-runtime. 이번 범위 밖 |
server-supervision.md: | security R9 | defer-other | app-runtime | 컴퓨터 밖 전송은 사람이 허용한 목적지와 자료 범위 안에서만 하고, 전송과 redirect마다 목적지와 범위를 다시 검사한다. | | subject가 app-runtime(앱 network)와 models(provider 연결). 이번 범위 밖 |
