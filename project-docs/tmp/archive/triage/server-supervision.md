# triage: server-supervision

옛 파일: platform/api, identity, responsiveness, security. 결과 subject 후보: server, core-api, supervision, child-supervision-protocol. 옛 줄 이름은 `파일 Rn`이다.

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| api R1a | candidate | core-api | read 호출은 저장된 상태를 바꾸지 않는다. | read를 반복 호출하기 전후로 저장된 기록과 event 순번이 같다 | |
| api R1b | drop-detail | | | | 전송 방식(HTTP JSON, POST RPC, WebSocket, port 번호)은 구현 선택(catalog 4장) |
| api R2a | candidate | core-api | 등록되지 않은 version·resource·method 호출은 다른 동작으로 추정하지 않고 거절한다. | 철자가 비슷한 미등록 호출이 어떤 동작도 실행하지 않고 거절된다; 등록된 호출은 정상으로 실행된다 | |
| api R2b | drop-detail | | | | 경로 구간의 모양은 전송 세부 |
| api R3a | candidate | core-api | 실패 응답은 오류 객체 하나이고, 입력 오류·자격 없음·범위 거절·부재·충돌·사용 불가·내부 실패 중 하나의 종류와 안전한 설명을 담는다. | 일곱 상황 각각에서 서로 다른 오류 종류가 돌아온다; 모든 오류 객체에 종류와 안전한 설명이 있다 | HTTP 상태 숫자 대응은 전송 세부라 뺐다 |
| api R3b | drop-detail | | | | 성공 응답이 결과 객체를 그대로 담는 모양은 전송 세부 |
| api R3c | defer-other | projects | project 폴더의 파일 원본을 읽으면 원본 바이트와 맞는 Content-Type이 돌아온다. | | subject가 projects(파일 읽기). 이번 범위 밖 |
| api R4 | candidate | core-api | 앱 실패가 일반 API 호출의 오류로 나갈 때는 안전한 오류 종류와 설명만 담는다. | secret과 개인정보를 담은 예외를 일으킨 앱을 호출하면 응답에 stack, 원시 상세, 입력 원문, token이 없다 | |
| api R5 | defer-other | event-stream | WebSocket 연결과 HTTP 재조회는 같은 범위 검사·전역 순번·재전달 규칙을 쓰고, 범위 필터로 생략한 event가 있어도 읽어 지난 위치를 돌려준다. | | subject가 event-stream(events). 이번 범위 밖 |
| api R6a | ask | core-api | | | 같은 major 안에서는 선택 필드 추가만 허용하고 필수 입력·의미·오류 분류 변경은 새 major로 가르는 호환 규칙을 요구로 둘지. MVP 이전에는 호환 장치를 만들지 않는다는 AGENTS.md 호환성 절과 부딪힐 수 있다 |
| api R6b | candidate | core-api | 지원하지 않는 major의 호출은 다른 major로 바꿔 처리하지 않고 거절한다. | 지원하지 않는 major로 부르면 오류가 돌아오고 어떤 동작도 실행되지 않는다 | |
| api R7 | defer-other | event-stream | 이름 있는 구독자의 확인 응답은 자기 자격에 묶여 읽어 지난 위치 이하의 줄지 않는 재생 위치로 저장되고 재연결에 쓰인다. | | subject가 event-stream(events). 이번 범위 밖 |
| identity R1 | candidate | core-api | 호출자의 종류와 자격은 token이 정하고, 요청이 내세운 이름·label·제품 이름·환경 변수·화면의 주장으로 바뀌지 않는다. | 같은 제품의 두 연결·자리에 놓인 두 agent·두 앱이 서로를 주장해도 자격과 범위가 그대로다; 일반 process가 사람을 주장하면 실패한다 | 호출자 종류 목록(옛 다섯 종류)이 새 모델과 같은지는 쓸 때 확인 |
| identity R2 | candidate | server | 자격은 정해진 시작 경로와 사람의 연결 결정으로만 발급되고, 발급 상한 안의 범위만 갖는다. 앱과 agent는 자기 자격을 발급하거나 넓히지 못한다. | 발급 상한보다 넓은 범위를 청하면 거절된다; 앱이나 agent가 자기 자격 발급·확대를 청하면 거절된다 | |
| identity R3a | candidate | core-api | 호출은 호출자 자격의 범위 안에서만 읽고 쓴다. 다른 연결·앱·자리에 놓인 agent의 범위로 읽기·쓰기를 청하면 거절한다. | 다른 앱·다른 agent·다른 연결의 자격으로 서로의 자료를 읽고 쓰려 하면 모두 거절된다 | |
| identity R3b | defer-other | problems | test 결과 제출은 실제 test runner의 자격만 받는다. | | subject가 problems. 이번 범위 밖 |
| identity R4a | defer-other | shell | 사람의 token은 shell main이 보관하고 화면(renderer)에는 넘기지 않는다. | | subject가 shell. 이번 범위 밖 |
| identity R4b | candidate | supervision | 사용자 코드가 도는 child process의 메모리·IPC·환경에서 core 자격을 조회해도 나오지 않는다. | 앱·test 코드가 도는 child에서 core 자격을 찾아도 값이 없다 | 자격을 쥔 쪽이 supervision인지 app-runtime인지는 쓸 때 확인 |
| identity R5 | defer-other | coding-agent | 사람이 harness 연결을 고르면 lophn이 coding 자격을 만들어 OS keychain에 보관하고, 준비나 commit이 실패한 자격은 쓸 수 없게 정리한다. | | subject가 coding-agent(connection)와 secrets. 이번 범위 밖 |
| identity R6a | candidate | core-api | token은 Bearer header로만 받는다. token hash, URL query, cookie로 낸 token은 인증으로 받지 않는다. | hash로 호출, query에 token을 붙인 호출, cookie에 token을 담은 호출이 모두 거절된다 | |
| identity R6b | defer-other | secrets | token 원문은 보호 저장소 밖(argv, URL, 환경 변수, skill, 안내, 오류, event, model 문맥, 일반 조회 결과)에 남지 않는다. | | subject가 secrets. 이번 범위 밖 |
| identity R7a | candidate | core-api | 자격이 회수·소멸(agent 멈춤, 앱 권한 회수, 작업 종료, 감독 연결 상실, core 재시작)하면 그 자격의 새 호출은 즉시 거절한다. | 읽기·쓰기·구독·앱 직접 연결을 하기 직전에 자격을 회수하면 호출이 거절된다; core 재시작 뒤 이전 메모리 자격이 실패한다 | |
| identity R7b | drop-detail | | | | 과거 효과를 취소로 표시하지 않는다는 표시 규칙. 회수는 이후 호출에만 적용한다는 점은 identity R7a가 덮음 |
| identity R8 | defer-other | agent-tools | agent의 조회는 제목·주소·존재·개수·관계·근거를 펼치거나 요약하기 전에 현재 범위로 제한하고, 허용된 자료만으로 요약을 만들 수 없으면 그 요약을 내지 않는다. | | subject가 agent-tools(허락 판정). 이번 범위 밖 |
| identity R9a | candidate | core-api | 주소·이름·blob hash를 안다는 사실은 권한이 아니다. 호출은 대상을 아는지가 아니라 호출자 자격의 범위로 판정한다. | 범위 밖 주소나 hash를 넣은 읽기·쓰기가 거절된다 | |
| identity R9b | defer-other | app-runtime | 여러 앱의 자료를 연결해도 다른 앱의 권한이 합쳐지지 않는다. | | subject가 app-runtime. 이번 범위 밖 |
| identity R10a | candidate | core-api | 앱 범위 자격이 다른 앱의 대상을 조회하면, 없는 대상을 조회했을 때와 같은 안전한 부재 응답을 돌려준다. | 존재하는 다른 앱의 ID와 실제로 없는 ID를 조회한 응답이 내용으로 구별되지 않는다 | |
| identity R10b | drop-dup | | | | 자격 없음과 금지 동작의 오류 구별은 api R3a가 덮음 |
| identity R11 | candidate | core-api | 모든 호출(command, read, 구독, 준비 상태, health)은 유효한 token을 요구하고, Origin이 없거나 localhost라는 사실만으로 통과시키지 않는다. | 모든 경로에 token 없는 요청을 보내면 자격 없음 오류가 돌아온다; Origin이 없는 요청도 token을 요구한다 | |
| identity R12 | candidate | server | Host는 실제 bind 주소와 port의 정확한 허용 목록으로 검사하고 IPv4·IPv6·localhost를 모두 처리한다. proxy header는 신원 근거로 쓰지 않는다. | 127.0.0.1·localhost·대괄호 IPv6 Host는 통과하고 다른 port·외부 Host·변조한 proxy header는 거절된다 | |
| identity R13a | candidate | server | Origin header가 붙은 요청은 거절한다. CORS preflight나 cookie 인증으로 통과시키지 않는다. | 올바른 token과 Origin을 함께 보내도 거절된다; CORS preflight와 cookie만 있는 요청이 실패한다 | |
| identity R13b | candidate | server | 요청 검사는 Host, Origin, Bearer token, 현재 동작 자격의 순서로 하고 인증이 끝나기 전에 body를 처리하지 않는다. | 외부 Host와 틀린 token을 함께 보내면 Host 거절이 먼저 나온다; 인증 전 요청의 body가 처리되지 않는다 | |
| identity R13c | drop-detail | | | | token 비교를 constant-time으로 하는 것은 구현 세부 |
| identity R14 | defer-other | approvals | 사람 token은 사람이 직접 누른 증거가 아니다. 사람의 결정으로 기록되는 것은 사람이 고른 질문의 고정 선택지를 정확한 대상·입력으로 한 번 적용한 경우뿐이다. | | subject가 approvals. 이번 범위 밖 |
| identity R15 | defer-other | coding-agent | coding MCP·CLI는 시작할 때 신뢰하는 loader가 현재 연결·범위·process 결합을 확인한 뒤 보호된 process 안 통로로만 자격을 전달받는다. | | subject가 coding-agent(connection)와 secrets. 이번 범위 밖 |
| responsiveness R1a | candidate | server | 느린 작업(앱 실행, model 호출, test, 파일 scan)이 돌고 있어도 무관한 command와 read는 그 작업이 끝나기를 기다리지 않고 응답한다. | 느린 작업을 30초 이상 멈춘 동안 무관한 command와 read가 응답한다 | |
| responsiveness R1b | defer-other | run-loop | model 호출은 lophn agent process에서만 한다. | | subject가 run-loop. 이번 범위 밖 |
| responsiveness R2 | defer-other | app-runtime | 앱 화면·read·command의 일반 호출은 앱으로 바로 가고 core나 기록 확정을 기다리지 않는다. | | subject가 app-runtime. 이번 범위 밖 |
| responsiveness R3a | candidate | server | 관리 요청의 크기, 대기 개수, 주체별 점유, 대기 기한은 유한하고 초과는 명시적으로 거절한다. | 한 주체가 상한까지 제출한 뒤 더 내면 초과 요청이 거절된다; 대기열이 끝없이 커지지 않는다 | |
| responsiveness R3b | candidate | server | 권한 회수와 정지 제어 요청은 입장 여유를 따로 예약해 두어, 다른 요청이 가득 차도 접수된다. | 한 주체가 자기 상한을 가득 채운 상태에서도 다른 주체의 회수·정지 요청이 접수된다 | |
| responsiveness R4 | defer-other | projects | 여러 project 폴더의 scan과 검색은 유한한 worker를 공정하게 나눠 써서 큰 폴더 하나가 다른 폴더의 작업을 굶기지 못한다. | | subject가 projects(scan)와 contexts(검색). 이번 범위 밖 |
| responsiveness R5a | defer-other | shell | shell main의 IPC 처리에는 크기에 비례하는 작업과 무제한 대기를 넣지 않는다. | | subject가 shell. 이번 범위 밖 |
| responsiveness R5b | candidate | supervision | child process 하나가 무한 loop·응답 없음·crash여도 다른 child와 core의 응답은 멈추지 않는다. | 앱 child 하나를 무한 loop시키거나 죽여도 다른 앱과 core의 호출이 계속 응답한다 | |
| responsiveness R6 | drop-detail | | | | 응답 시간 목표(p95·p99 수치)는 재는 일이라 eval 몫(README 1장) |
| responsiveness R7 | drop-detail | | | | 저장·회수 접수의 응답 시간 수치는 eval 몫(README 1장) |
| responsiveness R8 | drop-detail | | | | 측정 장치·표본·보고 방법은 eval 몫(README 1장) |
| responsiveness R9 | drop-detail | | | | 부하 측정 시나리오는 eval 몫(README 1장) |
| responsiveness R10 | drop-detail | | | | 대기 원인 분류와 측정 보고 방식은 eval 몫(README 1장) |
| security R1 | drop-detail | | | | 위협 전제 서술. 판정할 보장은 identity 계열 요구가 각각 맡음 |
| security R2 | drop-detail | | | | 지원 범위 선언이고 하는 일이 아님(README 2장) |
| security R3 | defer-other | app-runtime | 앱은 자기 process와 저장 경계 안에서 돌아, 직접 OS 접근이나 다른 앱 접근이 막힌다. | | subject가 app-runtime. 이번 범위 밖 |
| security R4 | defer-other | shell | 배포 build는 OS sandbox를 켠 채 동작한다. | | subject가 shell(배포). 이번 범위 밖 |
| security R5 | drop-detail | | | | 의존성 고정은 개발 규칙(docs/dev 몫)이고 market 없음은 README 2장 |
| security R6 | candidate | server | core API는 loopback 주소(IPv4 127.0.0.1, IPv6 ::1)에서만 연결을 받는다. | LAN 주소로 HTTP와 구독 연결을 시도하면 실패한다; loopback 연결도 token을 요구한다 | |
| security R7 | drop-dup | | | | 터널 뒤 요청에도 같은 검사를 적용한다는 점은 identity R11, R12, R13a가 덮음. remote 기능 없음은 README 2장 |
| security R8a | candidate | server | 요청 body는 읽기 전에 동작별 최대 bytes와 견주어 한도를 넘으면 거절한다. | 길이를 속인 chunked body와 큰 JSON 요청을 보내면 한도에서 거절되고 body 전체가 처리되지 않는다 | |
| security R8b | drop-dup | | | | 모든 경로의 token·Host·Origin 검사는 identity R11, R12, R13a가 덮음 |
| security R9 | defer-other | app-runtime | 컴퓨터 밖 전송은 사람이 허용한 목적지와 자료 범위 안에서만 하고, 전송과 redirect마다 목적지와 범위를 다시 검사한다. | | subject가 app-runtime(앱 network)와 models(provider 연결). 이번 범위 밖 |
| security R10 | defer-other | run-loop | 읽은 자료의 모든 문자열은 data로 직렬화되고, 인용 경계 표식을 흉내 내도 지시 영역으로 나가거나 사람 승인·권한·test 결과로 승격되지 않는다. | | subject가 run-loop. 이번 범위 밖 |
| security R11 | defer-other | agent-sessions | summary·compaction·handoff는 원래 범위와 출처, data 분류를 유지하고 출처를 알 수 없으면 data로 다룬다. | | subject가 agent-sessions. 이번 범위 밖 |

## 개수

- candidate: 23
- drop-removed: 0
- drop-conflict: 0
- drop-dup: 3
- drop-detail: 13
- defer-other: 20
- ask: 1
