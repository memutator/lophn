---
type: domain-model
concerns: [apps/runtime]
---
# apps/runtime

앱의 실행 허용, 프로세스 관측과 direct call의 연결 값을 정의한다.

App 필드의 정본은 → apps/registration이다. runtime은 `run_enabled`의 변경과 관측 event를 소유한다. 별도 runtime entity·운영 ledger·lease는 없다.

## RuntimeObservation (값)

현재 supervisor 연결의 메모리 값이다. 과거 event나 ledger의 주소만으로 생존을 판정하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | → apps/registration | 앱 |
| `release` | `rel` ID | 예 | live에는 필수; preview는 PreviewInput.release가 있으면 동일 값, 준비 전 bundle이면 없음 → apps/releases, apps/preview | 고정 release 참조 |
| `mode` | `live` / `preview` | 아니오 | preview 규칙 → apps/preview | 프로세스 종류 |
| `process_nonce` | 무작위 문자열 | 아니오 | 시작마다 새 값; 재사용 금지; counter 아님 | 프로세스 구분값 |
| `endpoint` | 로컬 socket 주소 | 예 | 준비·실제 연결 확인 뒤 공개; 사용자 전용 경로 | direct call 주소 |
| `ready` | boolean | 아니오 | hash·handler·schema·실제 연결 검사 통과 때 true | 시작 준비 |
| `accepting` | boolean | 아니오 | live는 activation commit 뒤만 true | 새 호출/automation 허용 |
| `reason` | `{code:string,summary:string}` | 예 | redaction; 사용할 수 없으면 필수 | 실패·교체·시작 근거 |

## RuntimeState (값)

ledger에 별도 저장하지 않는 projection이다. archive/실행 허용과 프로세스 종료 중 여부는 함께 표시한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `state` | `preparing` / `stopped` / `running` / `unavailable` | 아니오 | 아래 우선순위로 계산 | 화면 상태 |
| `termination_pending` | boolean | 아니오 | stopped 요청 후 종료 미확인이면 true | 멈춤 완료와 구별 |
| `reason` | 짧은 JSON | 예 | unavailable에는 필수 | 근거 |

| 상태 | 뜻 |
|---|---|
| `preparing` | App.active_release 없음 |
| `stopped` | 채택한 release가 있고 run_enabled=false 또는 archived |
| `running` | run_enabled=true, active, 현재 채택한 release의 ready·accepting·직접 연결 성공 |
| `unavailable` | run_enabled=true이고 채택한 release가 있지만 running 조건 미충족 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| `preparing` | `running` | machine | 첫 activation 성공·실제 연결·통로 열림 | `AppStarted` |
| `preparing` | `preparing` | machine | 첫 activation 실패 | → apps/releases의 `ReleaseActivationFailed` |
| `running` / `unavailable` | `stopped` | user | run_enabled=false 또는 archive; 완료는 종료 확인 필요 | `AppExecutionDisabled` / → apps/registration의 `AppArchived`; 종료 확인은 `AppStopped` |
| `stopped` | `unavailable` | user | active App에서 실행 허용 | `AppExecutionEnabled` |
| `unavailable` | `running` | machine | 현재 release 준비·직접 연결·통로 열림 | `AppStarted` |
| `running` | `unavailable` | machine | 연결 실패·종료·교체; 허용값은 유지 | `AppUnavailable` |

## AppConnection (값)

core가 서명하는 앱 호출용 제한 credential이다. credential 보관·서명·actor 형식은 → platform/identity. 앱은 공개 검증 key만 받는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | 요청/프로세스와 일치 | 대상 |
| `release` | `rel` ID | 예 | live에는 필수; release 없는 preview는 부재이고 bundle_hash로 결속 | 코드 기준 |
| `bundle_hash` | sha256 | 아니오 | release가 있으면 release와 일치; 없으면 PreviewInput·실제 묶음과 일치 | 내용 기준 |
| `mode` | `live` / `preview` | 아니오 | 프로세스와 일치 | 운영/preview |
| `process_nonce` | 무작위 문자열 | 아니오 | 현재 RuntimeObservation과 일치 | 재시작 경계 |
| `actor` | actor | 아니오 | 원래 credential의 actor | 호출자 |
| `credential_ref` | 불투명 credential 식별자 | 아니오 | → platform/identity; 원문 token 아님 | scope·회수 근거 |
| `screens` | 문자열[] | 아니오 | 허용 screen key; 중복 금지 | 화면 범위 |
| `screen_sizes` | map<string,(`full` / `panel` / `card`)[]> | 아니오 | screens 안 key; blueprint.sizes 교집합 | 크기별 화면 범위 |
| `caller` | AppCallOrigin / AgentCallOrigin | 예 | app/agent 호출은 필수; 서명된 인증 근거만 → apps/connections, apps/invocations | 부른 쪽 |
| `commands` | 문자열[] | 아니오 | 허용 command key; 중복 금지 | 명령 범위 |
| `expires_at` | UTC 시각 | 예 | 원래 credential에 기한이 있으면 그 기한 이하 | 만료 |

## AppScreenRequest (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `screen` | 문자열 | 아니오 | AppConnection.screens 안 | 화면 |
| `size` | `full` / `panel` / `card` | 아니오 | screen_sizes 안; 크기 미선언이면 거절 | 표시 모드 |
| `view_session` | 불투명 문자열 | 아니오 | shell/app-frame에서 인증한 session | 탭·카드 상태 분리 |

단일 path의 같은 반응형 entrypoint에 size를 넘긴다. 크기별 다른 프로세스·DB는 없다. 화면 container 치수와 lifecycle은 → shell/workspace, view 격리는 → shell/app-frame다.

## ReadyAttestation (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `release` | `rel` ID | 예 | live에는 필수; 시작 요청과 일치; release 없는 preview는 부재 | 실제 release 참조 |
| `bundle_hash` | sha256 | 아니오 | 별도 작업에서 byte 확인; release 또는 release 없는 PreviewInput과 일치 | 실제 코드 |
| `commands` | 문자열[] | 아니오 | 선언 목록과 정확히 일치 | 등록 handler |
| `data_schema` | 0 이상 정수 | 아니오 | 실제 앱 DB와 고정 bundle의 기대 schema 일치; release가 있으면 그 기대 schema와도 일치 | 실제 schema |
| `process_nonce` | 무작위 문자열 | 아니오 | 현재 시작한 자식과 일치 | 프로세스 근거 |
| `connection_ok` | boolean | 아니오 | 실제 direct 응답 확인; 성공은 true | 연결 준비 |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `app.enable_execution` | user | app | App 최신 seq; active 보관 상태; active_release 존재 | `AppExecutionEnabled` | `conflict`, `invalid_input`, `not_found` |
| `app.disable_execution` | user | app | App 최신 seq | `AppExecutionDisabled` | `conflict`, `not_found` |
| `app.record_started` | machine | app,ReadyAttestation | 현재 release·nonce·run_enabled·activation 상태 | `AppStarted` | `conflict`, `invalid_input` |
| `app.record_stopped` | machine | app,release,process_nonce,종료 확인 | 같은 자식의 종료 관측 | `AppStopped` | `conflict`, `invalid_input` |
| `app.record_unavailable` | machine | app,release,process_nonce?,reason | 현재 관측 대상; run_enabled를 바꾸지 않음 | `AppUnavailable` | `conflict`, `invalid_input` |

이 command는 → apps/registration의 `apps`와 → platform/ledger의 event만 쓴다. process_nonce·endpoint는 현재 연결에서 관리하며 별도 정본 표는 없다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `AppExecutionEnabled` | → apps/registration | `run_enabled:true` | apps/runtime |
| `AppExecutionDisabled` | → apps/registration | `run_enabled:false` | apps/runtime |
| `AppStarted` | → apps/registration | release,process_nonce,data_schema | shell/app-frame, problems/reporting |
| `AppStopped` | → apps/registration | release,process_nonce | shell/app-frame |
| `AppUnavailable` | → apps/registration | release,reason | shell/app-frame, problems/reporting |

## 정책

- **프로세스 수.** core 밖 공유 supervisor 하나, 앱마다 운영 프로세스 많아야 하나. 이전 프로세스 종료를 확인하기 전 같은 DB를 쓰는 새 프로세스를 띄우지 않는다.
- **direct call.** 연결 후 화면·명령 요청/응답은 core·supervisor·ledger queue를 지나지 않는다. 입력은 connection,request key,고정 release(없으면 preview bundle_hash),화면 path 또는 command+input; 명령 결과에 inv ID·mode를 붙인다. confirm 접수 예외 → apps/invocations.
- **검사.** 서명·nonce·release·bundle·mode·기한·screen/command scope를 매번 로컬 검증한다. 본문의 actor·effect 주장은 무시한다. handler·입력은 당시 blueprint로 검사한다. 재시작/교체 뒤 옛 connection과 proof는 거절한다.
- **오류.** 잘못된 credential=unauthorized, 범위/확인 부족=forbidden, 미선언 명령/입력=invalid_input, release/input 불일치=conflict, 멈춤/교체=unavailable. 전송 단절은 결과 모름이며 쓰기 자동 retry는 없다.
- **시작.** 제한된 준비 모드는 automation·업무 쓰기·외부 동작을 닫는다. 실제 bundle·handler·schema·직접 연결 준비를 30000ms 안에 확인하지 못하면 시작 실패다. 준비 통보는 업무 정상·problem 닫힘의 근거가 아니다(→ problems/closing).
- **멈춤.** 새 호출·automation부터 닫고 진행 호출 종료 요청 후 10000ms 유예 뒤 강제 종료를 요청한다. 실제 OS 종료 확인 전 완료로 표시하지 않는다. 결과 미확인 inv ID는 → apps/invocations의 unknown이다.
- **재시작.** 예상 밖 종료는 1000ms·2000ms·4000ms부터 두 배씩 최대 300000ms backoff하며 600000ms 안에 5회를 넘는 종료에는 자동 재시작을 멈추고 이유를 남긴다. run_enabled를 몰래 바꾸지 않는다. 사람의 멈춤을 우회하지 않고 idle만으로 자동 종료하지 않는다. 회수/축소 credential과 grant는 이전 통로 종료 뒤 새 nonce로 시작한다.
- **연결 단절.** core 제어 연결이 끊기면 새 호출·automation을 닫고 앱을 끝낸다. supervisor 교체는 옛 자식 종료 확인 뒤에만 가능하다. PID만으로 자식을 판정하지 않는다.
- **실패 격리.** 한 앱 종료는 다른 앱 통로를 닫지 않는다. uncaught error/unhandled rejection은 안전한 보고를 시도하고 exit 1로 끝낸다. 보고 실패는 원래 crash를 숨기지 않는다.
- **관측.** Linux VmRSS는 60000ms마다 측정할 수 있다. macOS/Windows는 OOM 종료 근거를 기록하며 별도 health entity·자동 정상 판정은 없다.

- **다른 앱 연결.** source 자식의 인증된 broker 연결이 `/apps/connect` 준비 요청을 보낸다. supervisor 연결 준비 어댑터는 메모리의 현재 선언/Grant와 source/target nonce를 검사해 target direct endpoint와 app actor의 제한 AppConnection을 돌려준다. source는 준비된 target socket만 접근하며 그 이후 업무 요청·응답은 supervisor/core를 지나지 않는다. signed caller/path 검사 → apps/connections.
- **agent 연결.** target의 active agent.commands ∩ 현재 command ∩ 인증된 역할/assignment scope를 AppConnection.commands에 묶는다. agent의 run/tool call은 AgentCallOrigin에 묶고 입력의 caller 주장은 무시한다. model tool 정의와 실행 판단은 → lophn-agent/harness/tools, lophn-agent/harness/tool-judgment다.
- **화면 크기.** screen key·size·view_session을 함께 검사한다. panel/card만을 위한 실행도 현재 운영 프로세스 하나를 공유한다. 화면 크기 선언 누락은 invalid_input이며 full을 몰래 축소하지 않는다.

## 정할 것

- 준비 확인 30000ms·종료 유예 10000ms·재시작 backoff와 반복 실패 한계는 위 정책을 따른다. 강제 종료 요청 뒤 OS 종료가 확인되지 않을 때의 추가 대기 상한과 OS별 기본값 조정 여부는 apps/runtime#Q5에서 정한다.
- credential 서명·구분값 byte 길이·TTL은 → platform/identity와 고정한다.
