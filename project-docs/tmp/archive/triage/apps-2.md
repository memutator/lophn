# apps-2 분류표 (apps/runtime, invocations, connections)

옛 파일: `agent-review/docs/requirements/apps/{runtime,invocations,connections}.md`. 형식은 plan.md 4장.

- 옛 말 "automation"이 주기 실행(보류)을 가리키는지 정해지지 않았다. automation을 닫거나 기록하는 항목은 automation 부분을 빼고 candidate로 두고, 이유 칸에 적었다. automation 부분만 따로 `ask` 줄로 두었다(runtime R3c, invocations R2b).
- "supervisor"는 catalog의 `supervision`(child process 감독)을 뜻한다.

## runtime

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| runtime R1 | candidate | app-runtime | 앱 하나당 운영 process는 많아야 하나이고, 이전 process의 종료를 확인하기 전에는 같은 DB를 쓰는 다음 process를 띄우지 않는다. | 재시작과 activation을 겹쳐 요청해도 같은 DB에 쓰는 process가 둘이 되지 않는다; 이전 process의 종료를 확인하기 전에 새 process가 시작되지 않는다 | |
| runtime R2a | candidate | app-runtime | 앱 process는 시작할 때 현재 release와 현재 허용 범위를 받는다. | release를 교체하고 허용 범위를 바꾼 뒤 시작하면 process가 새 release와 새 범위로 동작한다 | |
| runtime R2b | candidate | app-runtime | 앱 process가 30초 안에 실제 bundle, handler 목록, 데이터 schema, 직접 연결 준비를 알리지 못하거나 실제 handler 목록이 앱 정의와 다르면 시작 실패로 표시하고 이유를 보인다. | handler 목록이 다른 앱과 응답하지 않는 앱을 각각 시작하면 30초 안에 unavailable과 시작 실패 이유가 보인다 | |
| runtime R3a | candidate | app-runtime | 시작 준비 중에는 업무 쓰기와 외부 동작을 받지 않는다. | 준비 중에 업무 쓰기를 부르면 거절된다; 준비 중에 외부 동작을 부르면 거절된다 | automation 항목은 뺌(R3c) |
| runtime R3b | defer-other | problems | 앱이 시작에 성공해도 problem은 닫는 근거 없이는 닫히지 않고, 수리 성공으로 표시되지 않는다. | | subject가 problems |
| runtime R3c | ask | app-runtime | 시작 준비 중에 automation 호출도 받지 않는다. | 준비 중에 automation이 호출되면 거절된다 | automation이 주기 실행(보류)을 가리키는지; 아니라면 R15, R17의 automation 닫기와 함께 candidate로 쓴다 |
| runtime R4a | drop-dup | | | | req-0251 (앱 하나의 실패가 core를 끝내지 않음) |
| runtime R4b | candidate | app-runtime | 앱 process는 lophn의 DB, credential 파일, 플랫폼 제어 통로에 직접 닿지 못한다. | 앱 process에서 lophn 내부 DB나 credential 파일을 열면 거절된다; 제어 통로에 직접 연결하면 거절된다 | core 자격이 child의 메모리·IPC·환경에 없는 것은 req-0250 |
| runtime R5a | candidate | app-capability-api | 앱의 capability 통로는 그 사용자 계정만 닿을 수 있는 로컬 통로이고 network로 열리지 않는다. | 다른 사용자 계정이 연결하면 거절된다; network 주소로는 연결할 수 없다 | HTTP/1.1 JSON 같은 전송 형식은 뺌(drop-detail) |
| runtime R5b | candidate | app-direct-protocol | 앱 화면과 command의 직접 통로도 그 사용자 계정만 닿을 수 있는 로컬 통로이고, 통로의 위치는 앱 화면에 알려지지 않는다. | 다른 사용자 계정이 연결하면 거절된다; 앱 화면의 코드에서 통로 위치를 읽을 수 없다 | |
| runtime R5c | defer-other | shell | 앱 화면은 desktop app의 main 쪽 연결로만 앱 통로에 닿는다. | | subject가 shell |
| runtime R6 | candidate | app-runtime | 통로가 놓이는 디렉터리는 그 사용자만 쓸 수 있고(0700), 앱 이름이 길어도 통로 경로가 길이 한도를 넘지 않는다. | 런타임 디렉터리가 없는 환경에서도 사용자 전용 디렉터리에 통로가 열린다; 긴 앱 이름으로도 앱이 시작한다 | |
| runtime R7 | candidate | app-runtime | 앱 process의 시작 정보와 token, secret은 process 목록과 환경 변수에 나타나지 않는다. | 실행 중인 앱 process의 명령줄 인자와 환경에서 token과 secret 값을 찾을 수 없다 | secret 전달은 앱 권한 쪽(apps-3) |
| runtime R8 | drop-detail | | | | Deno의 socket HTTP host 검사를 맞추는 내부 장치; 선언 없는 외부 host 거절은 권한 쪽 보장 |
| runtime R9a | candidate | app-runtime | 앱의 제어 통로는 인증된 lophn 연결만 받는다. | 인증 없는 호출자가 제어 요청을 보내면 거절된다 | |
| runtime R9b | candidate | app-direct-protocol | 앱 화면의 연결은 화면의 신원에 묶이고, 요청 본문이 내세운 다른 앱은 무시된다. | 본문에 다른 앱 이름을 넣어 보내도 그 화면의 앱으로 처리된다 | |
| runtime R10 | candidate | app-direct-protocol | 연결이 이루어진 뒤 앱 화면과 일반 command의 요청·응답은 core와 기록 저장을 지나지 않고 앱으로 직접 간다. | 기록 저장을 지연시켜도 앱 화면과 일반 command 호출이 응답한다 | 확인이 필요한 command의 접수 선행은 invocations R7 |
| runtime R11a | candidate | app-direct-protocol | 직접 호출은 로컬에서 서명, process 신원, release, 운영·preview 구분, 만료, 화면 또는 command 범위를 검사한다. | 재시작 전의 연결, 위조 서명, 범위 밖 command로 호출하면 각각 거절된다 | credential 발급은 core-api 쪽 |
| runtime R11b | candidate | app-direct-protocol | 직접 호출의 입력은 호출 당시의 앱 정의로 검사한다. | 앱 정의와 맞지 않는 입력으로 부르면 handler가 실행되지 않고 거절된다 | |
| runtime R12 | candidate | app-direct-protocol | 전송이 끊기면 호출 결과를 모름으로 표시하고, 업무 쓰기 호출을 자동으로 다시 부르지 않는다. | 쓰기 직후 연결을 끊어도 같은 호출이 두 번 실행되지 않는다; 호출에 결과 모름이 표시된다 | |
| runtime R13a | candidate | app-runtime | 앱의 실행 상태(release 없음, 멈춤, 준비 중, 사용 가능, 사용 불가, 종료 중)는 실제 release 유무, 실행 허용, 현재 연결로 정하고, 과거 기록이나 열린 problem으로 추정하지 않는다. | release가 아직 없는 앱, 사람이 멈춘 앱, 응답하는 앱, 허용됐지만 응답 없는 앱이 서로 다른 상태로 나온다 | |
| runtime R13b | drop-detail | | | | 화면에 무엇을 먼저 보이고 무엇을 펼치는지는 화면 세부 |
| runtime R14 | candidate | app-runtime | 앱의 실행 상태와 열린 problem은 서로 다른 사실로 두고, 관측하지 않은 지표는 값을 만들어 보여 주지 않는다. | 실행 중인 앱의 열린 problem이 상태와 따로 조회된다; 관측이 없는 지표는 값 없음으로 나온다 | 화면 배치는 뺌(drop-detail) |
| runtime R15a | candidate | app-runtime | 사람이 앱을 멈추면 새 command 접수를 닫고, 진행 중인 호출에 종료를 요청한 뒤, 10초가 지나면 강제 종료한다. | 끝나지 않는 command가 있어도 멈춘 지 10초 뒤 강제 종료가 요청된다; 멈춘 뒤 새 command는 거절된다 | automation 항목은 뺌(R3c) |
| runtime R15b | candidate | app-runtime | 실제 종료가 확인되기 전에는 앱을 종료 중으로 표시하고 멈춤 완료로 표시하지 않는다. | OS가 종료를 확인하기 전까지 상태가 종료 중이다 | |
| runtime R16 | candidate | app-runtime | 사람이 멈춘 앱은 사람이 다시 실행을 허용하기 전에는 재시작 정책으로도 시작되지 않는다. | 멈춘 뒤 lophn을 다시 띄우거나 재시작 대기 시간이 지나도 앱이 시작되지 않는다 | |
| runtime R17a | candidate | app-runtime | core와의 제어 연결이 끊기면 앱은 새 호출을 받지 않고 종료한다. | core 연결을 끊으면 앱의 이전 호출 통로가 닫히고 앱이 종료한다 | automation 항목은 뺌(R3c) |
| runtime R17b | defer-other | supervision | 감독자를 교체할 때 PID만이 아니라 현재 child의 신원과 이전 child의 종료를 확인해, PID가 재사용돼도 옛 child와 새 child를 혼동하지 않는다. | | subject가 supervision |
| runtime R18 | candidate | app-runtime | daemon 종료, 앱 재시작, release 교체는 정지를 요청하기 전에 의도된 종료로 분류해, 동시에 온 종료 신호나 process tree 종료를 crash로 기록하지 않는다. | daemon과 앱에 종료 신호를 동시에 보내도 의도된 정지가 예상 밖 crash로 기록되지 않는다 | |
| runtime R19a | candidate | app-runtime | 앱이 예상 밖으로 종료하면 1초, 2초, 4초로 두 배씩 늘려 최대 5분까지 기다린 뒤 재시작한다. | 앱을 연속으로 종료시키면 재시작 간격이 1, 2, 4초로 늘어나고 5분을 넘지 않는다 | |
| runtime R19b | candidate | app-runtime | 10분 안에 5회를 넘게 종료하면 자동 재시작을 멈추고 이유를 남기며, 실행 허용 값은 바뀌지 않는다. | 10분 안에 여섯 번 종료시키면 반복 실패 이유가 보이고 자동 재시작이 멈춘다; 실행 허용 값은 그대로다 | |
| runtime R20 | candidate | app-runtime | 앱 process는 idle이라는 이유만으로 종료하지 않는다. | 화면과 호출 없이 기다려도 실행이 허용된 앱이 계속 떠 있다 | |
| runtime R21 | drop-dup | | | | req-0251 (child 하나의 실패가 다른 child와 core를 멈추지 않음), req-0216 (느린 작업이 무관한 read를 막지 않음) |
| runtime R22 | candidate | app-runtime | 앱 process에서 처리되지 않은 exception과 Promise rejection이 나면 안전한 보고를 시도하고, stderr에 원래 실패를 남기고, 종료 code 1로 끝낸다. 보고가 실패해도 원래 실패는 가려지지 않는다. | 보고 통로를 끊은 채 exception을 내면 stderr에 원래 실패가 남고 종료 code가 1이다 | |
| runtime R23 | candidate | app-runtime | 운영 앱은 시작할 때 prompt, 임의 설정, 원격 import, npm과 jsr 다운로드 없이 미리 준비한 코드와 고정된 의존만으로 시작한다. | network가 없는 환경에서 설치한 앱이 시작한다; 실행 중 원격 import는 거절된다 | |
| runtime R24a | candidate | app-runtime | 앱 process의 환경에는 실행에 꼭 필요한 값만 넘기고, 부모 환경의 provider credential 같은 값은 넘기지 않는다. | 부모 환경에 넣은 API token이 앱 process의 환경에 없다 | req-0250과 겹치는 부분(core 자격)은 거기서 다룸 |
| runtime R24b | drop-detail | | | | 어느 Deno 실행 파일을 쓰는지는 구현 세부 |
| runtime R25a | candidate | app-runtime | Linux에서는 앱 process의 실제 메모리 사용(VmRSS)을 60초마다 측정한다. | 표본 간격이 60초이고 값이 실제 RSS와 맞다 | |
| runtime R25b | candidate | app-runtime | 측정하지 못하는 OS에서는 측정값을 만들지 않고 확인 가능한 OOM 종료 근거만 남기며, Deno heap 설정을 전체 메모리 제한이라고 표시하지 않는다. | macOS와 Windows에서 RSS 표본이 없는 것으로 나오고 OOM 종료가 근거와 함께 남는다 | 지원 OS는 install-and-update 몫 |
| runtime R26a | candidate | app-runtime | invocation마다 log를 최대 200줄까지, 최근 500개 invocation만큼 모은다. | 201줄을 쓴 invocation은 200줄만 남고, 501개 invocation을 만들면 가장 오래된 것의 log가 사라진다 | |
| runtime R26b | candidate | app-runtime | invocation에 묶이지 않은 log는 앱마다 최근 500줄만 유지한다. | 묶이지 않은 log를 501줄 쓰면 가장 오래된 한 줄이 사라진다 | |
| runtime R26c | candidate | app-runtime | log 한 줄은 300자로 제한한다. | 300자를 넘는 줄은 300자까지만 남는다 | |
| runtime R26d | drop-dup | | | | req-0600 (secret 값을 출력에서 가림) |
| runtime R27a | candidate | app-runtime | 추가 log 조회는 최대 200줄을 돌려준다. | log가 많이 남은 실패 호출을 조회해도 200줄을 넘게 돌려주지 않는다 | |
| runtime R27b | candidate | app-runtime | 호출이 실패한 직후의 마지막 log를 모으려고 기다리는 시간은 최대 20ms다. | 실패 직후 log 수집 대기가 20ms를 넘지 않는다 | |
| runtime R28 | candidate | app-runtime | 앱의 예상 밖 종료, 시작 실패, crash loop, V8 OOM 종료를 서로 다른 근거로 구별해 관측하고 problem 보고로 넘기며, 의도된 정지는 crash로 세지 않는다. | ready timeout, 반복 종료, V8 OOM을 각각 일으키면 서로 다른 관측 근거가 남는다; 의도된 정지는 crash로 세어지지 않는다 | |
| runtime R29 | candidate | app-runtime | 앱의 RSS가 설정한 메모리 한도의 85%를 넘은 상태가 10분 이어지면 그 수치와 기간을 관측으로 남긴다. | 85% 초과를 10분 유지하면 관측이 남는다; 한도가 없거나 RSS를 측정하지 못한 경우에는 넘었다고 하지 않는다 | |
| runtime R30 | drop-dup | | | | connections R4 (연결 준비와 직접 전달), connections R1 (방향 있는 선언·허락) |
| runtime R31a | candidate | app-runtime | 같은 앱의 여러 화면은 하나의 운영 process를 쓰되, 화면마다 view session을 따로 둔다. | 패널 둘과 카드 하나를 열어도 앱 process는 하나이고, 각 화면의 context와 주석 대상은 따로 식별된다 | |
| runtime R31b | candidate | app-direct-protocol | 화면 요청은 앱이 선언한 크기(전체, 패널, 카드)와 화면의 신원에 묶인다. | 선언하지 않은 크기로 화면을 요청하면 거절된다; 다른 화면의 신원으로 요청하면 거절된다 | |
| runtime R32 | defer-other | agent-tools | agent가 앱 command를 쓰려면 앱의 agent 허락과 자리에 놓인 agent의 범위가 모두 맞아야 한다. | | subject가 agent-tools |

## invocations

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| invocations R1 | candidate | app-runtime | 일반 앱 호출은 직접 통로에서 응답하고, invocation 기록은 응답 뒤에 비동기로 남긴다. | 기록 저장을 지연시켜도 화면, CLI, agent의 일반 호출 응답이 먼저 돌아오고 그 뒤 기록이 반영된다 | |
| invocations R2a | candidate | app-runtime | 사람 확인이 필요한 command, 업무를 바꾸거나 외부 효과를 내는 command, 실패하거나 거절된 읽기, 앱 시작, 데이터 변경은 invocation으로 남기고, 성공한 일반 읽기와 화면 byte 조회는 매번 남기지 않는다. | 각 종류를 부른 뒤 기록을 찾을 수 있다; 성공한 일반 읽기 100회가 invocation 100개를 만들지는 않는다 | automation 항목은 뺌(R2b) |
| invocations R2b | ask | app-runtime | automation이 부른 호출은 읽기도 모두 invocation으로 남긴다. | automation이 부른 읽기 호출의 기록이 모두 남는다 | automation이 주기 실행(보류)을 가리키는지 |
| invocations R3 | candidate | app-runtime | invocation에서 그 당시의 앱, release, 호출 대상, 호출 계기, 운영 또는 preview 구분, 인증된 원래 호출자, 실제 시작과 종료 결과를 찾을 수 있다. | release를 교체한 뒤 옛 invocation을 열어도 당시의 대상, 계기, 호출자가 그대로다; 앱이 입력으로 내세운 사람 이름으로 호출자가 바뀌지 않는다 | automation 계기는 뺌(R2b와 같은 질문) |
| invocations R4a | candidate | app-runtime | command 경계 한 번에는 invocation 하나를 연결하고, 내부 helper 호출과 trace는 따로 invocation으로 만들지 않는다. | 내부 helper 10개를 부르는 command에서 invocation이 하나다 | |
| invocations R4b | candidate | app-runtime | 진행 상황과 취소 요청은 그 command의 invocation에 연결된다. | 진행 중인 command의 진행과 취소 요청을 같은 invocation에서 따라갈 수 있다 | |
| invocations R5 | candidate | app-runtime | 이미 끝난 업무의 성공·실패는 이후 진단이나 invocation 전달의 실패로 바뀌지 않고, 기록 메시지만 한도가 있는 메모리에서 backoff를 두고 다시 보낸다. | 업무가 성공한 뒤 기록 전달을 끊어도 응답은 성공으로 유지되고 command가 다시 실행되지 않는다; 기록 메시지만 다시 전달된다 | 한도 초과 손실은 diagnostics로 드러남(R19b) |
| invocations R6a | candidate | app-runtime | 같은 invocation의 같은 사실을 다시 전달하면 같은 기록을 돌려준다. | 종료 통보를 반복해 보내도 기록과 결과가 하나다 | |
| invocations R6b | candidate | app-runtime | 이미 확정한 종료 결과와 부딪히는 늦은 사실은 거절한다. | 종료 뒤에 시작 통보나 다른 종료 결과를 보내도 진행 중이나 새 성공으로 바뀌지 않는다 | |
| invocations R7a | candidate | app-runtime | 사람 확인이 필요한 command는 승인과 접수를 함께 확정한 뒤에만 handler를 실행한다. | 승인과 접수 저장이 함께 확정되기 전에는 handler가 호출되지 않는다; 저장이 실패하면 실행되지 않는다 | |
| invocations R7b | drop-dup | | | | req-0308 (허락은 본 대상, 입력에 묶임), req-0310 (허락은 실제 적용과 한 번만) |
| invocations R7c | candidate | app-runtime | 같은 접수를 다시 보내면 기존 접수만 돌려주고 새 접수를 만들지 않는다. | 같은 접수를 두 번 보내면 접수가 하나다 | 호출자 종류와 상관없음 |
| invocations R8a | candidate | app-runtime | 접수된 confirm 호출을 다시 보내거나 process를 다시 시작해도 handler는 한 번만 실행된다. | 같은 접수를 동시에 보내면 handler가 1회만 실행된다; process를 재시작한 뒤 다시 보내도 중복 실행되지 않는다 | |
| invocations R8b | candidate | app-runtime | release, command, 입력, process 중 하나가 달라지면 원래 확인으로 실행하지 않는다. | 입력을 바꾸거나 옛 process의 실행 증명을 새 process에 보내면 거절된다 | |
| invocations R9 | candidate | app-runtime | confirm 접수와 실제 시작을 구별해 보여 주고, 시작과 결과는 실제로 관측한 뒤 기록한다. | 접수만 확정하고 handler 시작을 지연시키면 접수됨만 보인다; 실제 시작 시각이 접수 시각으로 채워지지 않는다 | |
| invocations R10 | candidate | app-runtime | 시작이나 결과를 확인할 수 없는 invocation은 미확인으로 표시하고, 기록 자체가 없거나 연결할 호출을 모르면 그 부재를 표시한다. | 결과를 전달하기 전에 process를 종료하면 미확인이나 기록 없음이 드러난다; 모르는 호출을 위한 가짜 invocation이 생기지 않는다 | |
| invocations R11 | candidate | app-runtime | 실패, timeout, 중단, 취소 요청은 부분 저장이나 외부 효과가 없었다는 뜻으로 표시하지 않고, 이미 저장하거나 전송한 사실은 따로 찾을 수 있다. | 로컬 저장 뒤 외부 전송이 실패한 command에서 저장 완료와 전송 실패가 따로 보인다; 취소 요청만 받은 상태가 외부 효과 취소 완료로 보이지 않는다 | |
| invocations R12a | drop-dup | | | | runtime R12 (결과 모름이어도 쓰기를 자동 재호출하지 않음) |
| invocations R12b | candidate | app-runtime | invocation 기록만으로 외부 효과가 정확히 한 번 일어났다고 말하지 않고, 확인 근거가 있는 단계와 모르는 단계를 구별한다. | 외부 전송 뒤 응답을 끊으면 같은 전송이 자동으로 반복되지 않는다; 외부 확인 근거가 있는 단계와 모르는 단계가 구별된다 | |
| invocations R13 | candidate | app-runtime | invocation의 성공은 handler가 반환했고 경계 계약을 지켰다는 뜻일 뿐, 업무 집계의 정확성이나 problem이 닫혔다는 뜻이 아니다. | 형식은 맞고 값이 틀린 응답이 성공 invocation으로 남아도 업무 정확성 판정은 따로 남는다 | |
| invocations R14a | candidate | app-spi | 읽기 command의 결과는 정상적인 0행과 원천 미수집, 일부 범위, 신선도 부족을 구별해 돌려준다. | 미수집 응답과 실제 0행 응답이 다르다 | |
| invocations R14b | candidate | app-spi | 페이지를 이어 읽을 때 처음 조건, 정렬, 데이터 기준이 바뀌었으면 거절한다. | 기간이나 정렬을 바꾼 뒤 처음 이어 읽기 값을 쓰면 거절된다 | |
| invocations R15a | drop-dup | | | | req-0600 (secret 값을 출력에서 가림) |
| invocations R15b | drop-removed | | | | 앱 문서와 앱의 `document.save`(removed.md 1, 앱 문서) |
| invocations R16 | candidate | app-runtime | 다른 앱이나 agent가 부른 invocation에는 인증된 부른 앱과 당시 release, 또는 agent run과 tool call을 남기고, 알려진 부모 invocation은 연결하며 모르는 출처는 만들어 채우지 않는다. | 앱 A가 부른 기록과 agent가 부른 기록이 구별된다; A의 release를 교체한 뒤에도 당시 출처가 유지된다; 부모 기록이 없으면 없음으로 나온다 | |
| invocations R17a | candidate | app-runtime | 앱 쌍 허락이나 agent 허락은 invocation의 원래 호출자를 사람으로 바꾸지 않는다. | agent나 앱 A가 요청한 confirm 호출을 사람이 승인해도 호출자는 agent나 A로 남는다 | |
| invocations R17b | drop-dup | | | | req-0306 (실제로 부른 주체를 요청자로 남기고 사람의 결정과 구별) |
| invocations R18 | drop-dup | | | | invocations R1, R2a, R7a (호출자 종류와 상관없이 같은 규칙) |
| invocations R19a | candidate | app-runtime | confirm 실행 marker는 process당 4096개까지 두고, 가득 차면 유효한 기존 marker를 버리지 않고 새 접수를 거절한다. | marker를 4096개 채운 뒤 새 접수는 거절되고 기존 접수는 그대로 유효하다 | |
| invocations R19b | candidate | app-runtime | 후행 기록의 전달 대기는 전체 4096 메시지 또는 8MiB 중 먼저 닿는 한도로 제한하고, 한도를 넘어 잃은 기록은 안전한 진단으로 남긴다. | 한도를 넘기면 손실이 진단에 남고 업무 응답은 바뀌지 않는다 | |
| invocations R19c | candidate | app-runtime | 가린 summary는 UTF-8 최대 16KiB로 제한한다. | 16KiB를 넘는 summary는 그 크기까지만 남는다 | |
| invocations R19d | candidate | app-runtime | 기록 전달은 unavailable일 때만 1초, 2초, 4초로 늘려 최대 30초 간격으로 다시 보내고, unauthorized, conflict, invalid_input은 다시 보내지 않는다. | unavailable 응답에는 재전송 간격이 1, 2, 4초로 늘어 30초를 넘지 않는다; unauthorized, conflict, invalid_input 응답에는 재전송하지 않는다 | |

## connections

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| connections R1a | candidate | app-releases | 앱은 다른 앱의 command를 쓰려면 쓸 대상 앱, command 목록, 목적을 앱 정의에 선언한다. | 선언하지 않은 대상 앱이나 command는 호출할 수 없다 | |
| connections R1b | candidate | app-runtime | 사람은 방향이 있는 앱 쌍과 그 command 범위를 한 번 허락하고, 한 쌍의 허락은 다른 앱이나 반대 방향으로 이어지지 않는다. | A에서 B의 두 command를 허락하면 그 둘만 호출된다; B에서 A, A에서 C 호출은 거절된다 | |
| connections R2a | candidate | app-runtime | 앱이 다른 앱에 부를 수 있는 범위는 부르는 앱의 현재 선언, 앱 쌍의 유효한 허락, 대상 앱의 현재 command 목록의 교집합이다. | 허락 뒤 대상 앱에서 command가 사라지면 그 command는 호출되지 않는다 | |
| connections R2b | candidate | app-runtime | 새 command나 새 대상 앱을 더하는 release는 새 사람 결정이 있어야 호출할 수 있고, command 범위가 같으면 다시 묻지 않는다. | 같은 범위의 release는 다시 묻지 않는다; 새 command를 더한 선언은 옛 허락으로 호출되지 않는다 | |
| connections R3a | candidate | app-runtime | 앱끼리 부를 때도 대상 앱의 같은 command handler, 입력 검사, 효과, 사람 확인 선언을 쓴다. | 직접 쓰는 command와 다른 앱이 쓰는 command가 같은 handler를 부른다 | |
| connections R3b | drop-dup | | | | invocations R7a, req-0304 (확인이 필요한 command는 정확한 대상·입력에 대한 사람의 결정이 있어야 실행) |
| connections R4 | candidate | app-direct-protocol | 앱끼리의 연결은 인증된 부른 앱의 현재 process에서만 준비하고, 연결된 뒤 일반 command의 요청·응답은 core와 기록 저장을 지나지 않고 대상 앱으로 직접 간다. | 위조한 호출자, 허락 없는 command, 옛 process의 연결은 거절된다; 기록 저장을 지연시켜도 허락된 A에서 B의 일반 호출이 응답한다 | |
| connections R5a | drop-dup | | | | invocations R16 (인증된 부른 앱과 당시 release, 부모 invocation을 남김) |
| connections R5b | drop-dup | | | | req-0205 (호출자는 token이 정하고 요청이 내세운 이름으로 바뀌지 않음) |
| connections R5c | candidate | app-runtime | 앱 A에 대한 허락은 A가 부른 앱 B를 거쳐 다른 앱 C로 다시 위임되지 않는다. | B에서 C를 부르려면 B 자신의 선언과 허락이 있어야 하고, 없으면 거절된다 | |
| connections R6 | candidate | app-runtime | 대상 앱이 멈추거나 교체되거나 연결이 끊기면 그 호출에는 unavailable 또는 결과 모름을 돌려주고, 부른 앱의 다른 일과 다른 앱 통로는 계속 동작하며 업무 쓰기를 자동으로 다시 부르지 않는다. | B가 응답 중에 종료돼도 A의 다른 화면과 A에서 C 호출은 동작한다; B의 쓰기는 반복 실행되지 않는다 | |
| connections R7a | candidate | app-runtime | 앱끼리 이어 부르는 깊이는 앱 8개까지로 제한한다. | 아홉 번째 앱을 부르는 호출은 handler 실행 전에 거절된다 | |
| connections R7b | candidate | app-runtime | 현재 호출 경로에 이미 있는 앱으로 돌아가는 호출은 handler를 실행하기 전에 거절한다. | A에서 B를 거쳐 A로 돌아오는 호출은 거절되고, 서로 독립인 A에서 B, B에서 A 호출은 각 허락 안에서 가능하다 | |

## 개수

| 판정 | 개수 |
|---|---|
| candidate | 74 |
| drop-removed | 1 |
| drop-conflict | 0 |
| drop-dup | 12 |
| drop-detail | 3 |
| defer-other | 4 |
| ask | 2 |
| 합계 | 96 |

candidate의 subject별 개수: app-runtime 62, app-direct-protocol 8, app-spi 2, app-releases 1, app-capability-api 1.
