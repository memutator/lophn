---
type: architecture
concerns: [apps]
---
# apps

## 1. 맡는 것과 맡지 않는 것

앱의 가벼운 등록, blueprint 검증, 불변 bundle과 release, 앱 프로세스, permission 강제, 앱 쌍 연결, 화면 context·주석, automation, invocation 전달, 앱 DB, preview, 설치 제공 SDK를 맡는다. 구현 코드는 `packages/apps/`의 concern 모듈과 `packages/sdk/`의 공개 Package로 나눈다. 앱마다 운영 프로세스는 하나이며 공유 supervisor가 core 밖에서 관리한다.

앱의 업무 table·ORM·transaction과 업무 correctness는 앱 코드가 소유한다. ledger의 transport·writer·공통 CAS와 idempotency는 `command`, `read` contract가 소유한다. 앱 영역 command handler만 이 파일의 ledger 표를 바꾼다. 사람 결정은 `approval`과 `confirmation window`, secret 보관은 `secret`, problem 처리와 실제 test result는 `문제 보고`와 `test 실행`, 앱 view 격리는 `앱 화면 틀`을 쓴다. 개인 SDK 등록·SDK 자동 전파·subprocess를 요구하는 앱·일반 workflow 언어는 만들지 않는다. 앱 사이 호출은 별도 API 계층 없이 blueprint command와 방향 있는 앱 쌍 Grant로 제공한다.

## 2. 프로세스

### 2.1 실행 단위와 통신

```text
shell Electron main ───────────┐
agent runtime ─────────────────┼── HTTP/1.1 over app socket ──> 앱 프로세스 A
MCP / CLI / 앱 프로세스 B ───────┘                                ├ 화면 byte 서버
                                                               ├ command handler
core ── 전용 stdio 제어 연결 ──> 공유 앱 supervisor                ├ automation clock
                                  ├ spawn / stop / OS 종료 확인  └ A의 data/data.db
                                  ├ 앱별 broker socket <──────── SDK 요청·관측
                                  ├ bounded invocation 전달 ──> core command
                                  ├ release worker (작업 동안)
                                  ├ blueprint 추출 / UI build (작업 동안)
                                  ├ 앱 전용 data worker (작업 동안)
                                  └ preview 프로세스 (요청 동안, disposable DB)

일반 화면·command의 요청과 응답은 core·supervisor를 통과하지 않는다.
secret 인증 전송·문서 저장·문제 보고와 다른 앱 연결 준비만 앱별 broker에서 해당 contract로 간다. 앱 B→A의 연결 뒤 업무 요청/응답은 broker를 지나지 않는다.
```

| 프로세스 | 누가 띄우고 멈추나 | 모듈과 수명 | 통신·권한 |
|---|---|---|---|
| core의 앱 영역 | platform의 core 수명 | `registration/commands`, `releases/commands`, `permissions/commands`, `invocations/commands`, `sdk/catalog` | 짧은 ledger command와 read만 수행. 앱 코드를 import하지 않음 |
| 공유 앱 supervisor 하나 | core가 띄우고 전용 제어 연결·OS 자식 handle을 감독 | `runtime/supervisor`, `runtime/processes`, `runtime/observations`, `permissions/broker`, `invocations/delivery` | core에는 `command`, `read`, `event 구독`; 앱에는 로컬 socket. 앱 DB를 직접 열지 않음 |
| 운영 앱, 앱마다 최대 하나 | supervisor가 현재 release·grant·run_enabled로 띄움 | `runtime/entrypoint`와 bundle의 앱 코드·SDK | command·화면 서버와 앱 안 clock. 자기 업무 DB writer |
| release worker | supervisor가 준비 요청마다 띄우고 완료·취소·timeout에 종료 | `releases/prepare`, `releases/bundle` | source의 정확한 git object 읽기, staging 쓰기, 부모와 stdio JSON. 플랫폼 credential 없음 |
| blueprint 추출 / UI build 자식 | release worker의 플랫폼 launcher가 필요한 단계에서 띄움 | `blueprint/extract`, `releases/ui-build` | 추출은 권한 없이 최대 10000ms. build는 staging과 고정 UI 의존만 사용. 운영 DB·secret·네트워크 없음 |
| 앱 전용 data worker | supervisor가 운영 자식 종료 확인 뒤 작업별로 띄움 | `data/worker` | schema 조회·backup·migration·restore·export. 한 앱 DB에 단독 접근. 외부 파일·network·secret·subprocess 없음 |
| preview | supervisor가 PreviewInput별로 띄우고 닫기 요청에 종료 | `preview/launcher`, 같은 runtime entrypoint | live와 다른 nonce·socket·DB·view session. 실제 permission 효과는 대역 |

이는 상시 공유 supervisor 1개와 운영 앱 N개에 필요할 때만 작업 프로세스를 더한 구성이다. 앱마다 별도 신뢰 host나 ledger writer를 두지 않는다. core 밖에 두었더라도 supervisor의 event loop에서 디렉터리 순회·큰 hash·build·SQLite backup을 하지 않는다. release worker가 앱 작성 코드를 실행할 때에는 더 좁은 추출/build 자식으로 내려보낸다. 앱 작성 코드와 migration에는 부모의 machine credential을 전달하지 않고 부모가 검증한 작업 결과만 command로 제출한다.

core↔supervisor는 platform pipe(길이 prefix frame)와 자식 handle을 함께 사용한다. 감독 pipe의 platform hello가 machine credential·core API port와, 앱이 쓸 서명 검증 공개 key(`scope.targets.verify_key`)를 한 번에 준다. supervisor는 `ready`로 답하고 그 뒤 core의 `worker_request`를 읽기 loop를 막지 않고 처리한다. op는 `apps.reconcile`(원하는 앱 상태를 알리고 접수만 답한다; 시작은 비동기이고 관측과 `record_*`로 따라간다), `apps.observe`(앱 하나의 현재 프로세스 관측: release·bundle·nonce·endpoint·ready·accepting·등록 command·선언 화면), `apps.logs`(log buffer 조각), `apps.restart`(그 nonce의 프로세스를 정지 확인 뒤 새 nonce로 다시 띄움)이다. 자식 앱마다 supervisor가 `app_credential_request`를 보내 core가 app credential을 발급하고(supervisor 자신의 machine credential은 자식에게 주지 않는다), 버린 log 줄은 `app_log_line_loss` 진단 frame으로 보낸다. core는 supervisor가 다시 떠서 상태를 잃은 것을 `apps.observe`가 비었다는 사실로 알고 마지막으로 알린 상태로 맞춘다. 제어 pipe는 caller가 선택한 일반 IPC 경로가 아니다. supervisor는 앱의 broker 제어 연결을 길게 유지한다. core 연결 EOF이면 새 호출과 automation부터 닫고 자식을 끝낸다. 앱도 broker 제어 연결 EOF이면 닫고 종료한다. socket 주소·PID만으로 생존을 판정하지 않는다. 자식 handle, 시작 nonce, OS 시작 신원과 실제 응답을 대조한다. 종료를 확인할 수 없으면 다음 writer를 시작하지 않는다.

### 2.2 두 로컬 socket과 시작 준비

앱마다 broker socket `b<slot>.sock`과 direct socket `a<slot>.sock` 두 개를 쓴다. Deno의 socket 듣기·연결 허락은 `--allow-net=unix:<정확한 경로>`뿐이라(폴더 prefix·와일드카드가 없다) supervisor가 앱 socket에 연결하려면 경로를 시작 전에 허락 목록에 넣어야 한다. 그래서 socket은 시작마다 새 무작위 이름이 아니라 고정 자리 64개의 경로이고, 앱 하나는 같은 자리를 계속 쓴다. 이전 자식의 종료를 확인한 뒤에만 같은 자리를 다시 쓰며 남은 socket 파일은 그때 지운다. 자리가 다 차면 새 앱은 시작하지 않는다. broker는 supervisor가 듣고, direct는 앱이 `Deno.serve({transport:"unix",path})`로 듣는다. HTTP/1.1 JSON의 가상 host는 `lophn.invalid`다. broker는 해당 자식의 인증된 좁은 요청만 받으며 core API의 임의 proxy가 아니다. direct의 제어 경로는 플랫폼의 인증된 연결만 받는다.

Linux는 `$XDG_RUNTIME_DIR/lophn/`을 먼저 쓰고 없으면 OS 사용자별 임시 디렉터리 `lophn-<uid>/`를 0700으로 생성한다. 소켓은 사용자 전용이며 app slug를 경로에 넣지 않는다. 생성 전에 UTF-8 경로가 104byte 미만인지 검사한다. 부족하면 짧은 사용자 전용 위치를 사용하거나 시작을 거절한다. Windows도 우선 고정 Deno의 AF_UNIX 지원을 설치 테스트로 확인하고 같은 두 socket contract를 사용한다. 지원하지 않으면 사용자 전용 ACL의 named pipe HTTP 어댑터를 사용하는 추천안을 적용하며, 그 어댑터의 검증 전에는 `unavailable`이고 TCP로 몰래 바꾸지 않는다.

시작 초기 JSON은 stdin 한 줄이다. app·release·bundle_hash·mode·process_nonce·두 socket·data 경로·고정 blueprint·Ed25519 공개 검증 key(`verify_key`, raw 32byte의 base64url)·해당 자식의 broker credential을 포함한다. mode는 `live`·`preview`·`test`다. token과 secret은 argv·환경·공용 파일에 쓰지 않는다. 초기 JSON에 secret 값은 없다. `Deno.Command`는 `clearEnv:true`이고 HOME·DENO_DIR·XDG_CACHE_HOME·PATH 중 실행에 필요한 값만 선택한다. Deno 실행 파일은 설정된 `LOPHN_DENO` 또는 현재 `Deno.execPath()`이다. 앱에 환경 읽기 permission을 주지는 않는다.

시작은 항상 `ready=false, accepting=false`로 한다. 작업 프로세스가 실제 bundle byte를 확인하고 앱 entrypoint가 실제 등록한 command 목록과 실제 DB schema를 보고한다. supervisor는 ReadyAttestation의 release·hash·nonce·command 목록·schema를 시작 요청과 대조하고 direct socket에 인증된 준비 probe를 보낸다. 30000ms 안에 모두 확인하지 못하면 시작 실패다. 준비 모드는 업무 쓰기·외부 동작·automation을 닫는다. activation의 새 앱은 ledger commit 전까지 준비 probe만 받는다. 이미 채택된 release의 재시작도 현재 실행 허용·grant를 확인한 뒤 통로를 연다. 시작 준비 성공은 업무 correctness나 problem 닫힘이 아니다.

### 2.3 Deno permission 생성

`permissions/flags`는 고정 blueprint 요구와 active Grant의 교집합을 실제 경로·host·port로 계산한다. fs.write grant가 fs.read를 포함하지 않는다. 보호 경로를 포함하는 부모 grant·문자열 prefix 판정·wildcard host·port 0은 거절한다. 경로·host 목록은 정렬하며 flag의 쉼표·NUL 등 표현 불가능한 값은 거절한다.

```text
deno run --no-prompt --no-config --no-remote --no-npm --cached-only --no-lock --quiet
  --import-map=<bundle의 플랫폼 생성 고정 import map>
  --allow-read=<bundle>,<자기 data>,<두 socket>,<fs.read 교집합>
  --allow-write=<자기 data>,<두 socket>,<fs.write 교집합>
  --allow-net=unix:<broker socket>,unix:<direct socket>,lophn.invalid
  <bundle의 플랫폼 entrypoint>
```

`--allow-all`/`-A`, `--allow-run`, `--allow-ffi`, `--allow-sys`, `--allow-env`는 생성하지 않는다. 운영 import graph는 준비한 상대 코드와 정확한 SDK 의존으로 고정하며 remote·npm·jsr import와 다운로드를 거절한다. source의 임의 설정 대신 플랫폼이 생성한 import map만 쓴다. SDK와 앱 코드는 같은 프로세스이며 SDK 검사는 별도 보안 경계가 아니다.

| permission | 실제 강제 |
|---|---|
| `fs.read`, `fs.write` | 각각 교집합 경로만 대응 Deno flag에 추가. 운영 bundle은 읽기만, source·다른 앱 DB·플랫폼 credential·log·backup은 없음 |
| `net.fetch` | 앱에 외부 net flag를 주지 않음. `cap-net`은 broker의 비동기 전송부로 요청하며 전송부가 exact host·port·redirect와 grant를 매번 검사. 앱 command 본문 자체는 여전히 direct |
| `net.listen` | 정확한 localhost/127.0.0.1/::1과 port만 후보. Deno의 host:port flag에 더해 방향을 강제하는 검증된 OS 제한이 있는 경우만 시작. 방향 강제가 없으면 해당 요청을 거절 |
| loopback | 앱이 닿을 수 있는 모든 표기에서 platform의 실제 port와 설정 port를 deny. localhost·127.0.0.1·::1을 서로 합치지 않음. callback grant를 view에 전달하지 않음 |
| `secret.use` | Deno flag 없음. 선언 이름∩grant를 broker 인증 전송에서 검사 |
| `document.save` | Deno flag 없음. 자기 blueprint 문서 key·grant·mode를 broker에서 검사하고 문서 contract 호출 |
| `app.call` | source에 선언∩Grant 범위의 target direct socket만 추가. source 신원·path·target command 범위를 서명한 AppConnection으로 매 요청 로컬 검사 |
| `agent.commands` | 앱 net flag 증가 없음. target의 현재 허락∩command∩역할/assignment를 agent AppConnection.commands로 제한 |

Deno net flag는 연결과 듣기를 구별하지 못한다. 방향 정책을 넓은 flag로 대신하지 않는다. broker 전송부는 외부 I/O를 비동기로 수행하며 ledger queue를 지나지 않는다. migration은 bundle 읽기와 자기 DB 작업 영역만 허용하고 외부 fs grant를 상속하지 않는다. backup 원문을 앱 migration 코드에 열어 주지 않는다.

Deno는 VM/container가 아니며 허락 경로 내부 데이터, 실행 중 symlink 교체, runtime 취약점, CPU·RSS·disk에 대한 강한 제한을 제공했다고 주장하지 않는다. read 효과·준비 모드의 업무 불변은 SDK 규약과 실제 test로 받친다. 앱 전체가 DB write permission을 가진다는 사실을 command별 OS 격리라고 부르지 않는다.

### 2.4 automation과 관측

automation clock은 앱 프로세스 안 `automations/clock`이 소유한다. 업무 통로가 열린 단조 시계 tick을 기준으로 1000ms마다 검사한다. on_start는 한 번, interval은 최소 60000ms이고 `started_tick + n * interval_ms`로 계산한다. 절전에서 돌아오면 가장 가까운 미래 배수만 선택하여 밀린 회차를 모두 skip한다. 재시작은 새 기준이다.

같은 `(nonce,release,key)`에는 running_invocation이 하나뿐이다. 서로 다른 automation은 병렬이고 전체 동시 invocation 기본 한도는 4개다. 전체 한도만 supervisor의 메모리 permit으로 제한한다. 회차가 도래하면 broker의 즉시 permit 요청을 하고 없으면 skip한다. permit 대기열·ledger 회차 표·공유 handler 실행은 없다. permit은 실제 handler 종료나 자식 종료 확인 때 반환한다. timeout 요청만으로 살아 있는 handler의 permit을 반환하지 않는다. 준비·교체·preview·archive·run_enabled=false에서는 clock을 닫는다. 자동 retry는 0회, timeout은 600000ms다. confirm=true 명령은 선언과 실행 모두 거절한다. external 명령은 사람이 automation을 켤 때 command·고정 입력·주기를 한 번 승인한 범위에서만 실행하고, 승인이 없거나 끈 뒤거나 범위가 다르면 그 회차는 시작하지 않는다. secret을 쓰는 명령은 선언 이름∩grant와 정확한 net.fetch host·port 안에서 실행하며 secret 사용 자체를 거절 사유로 삼지 않는다. 켜기 승인은 Grant kind `automation.run`이고 broker `try_acquire`가 회차마다 현재 선언∩active grant를 다시 읽는다(없으면 `forbidden`, 한도·점유는 `permit:false`).

`runtime/observations`는 stdout/stderr를 비동기로 읽는다. SDK의 실제 invocation 문맥 표시는 `[inv=<id>]`, 내부 trace는 별도 이름이다. AsyncLocalStorage 기반으로 await·timer·SQLite·fetch 뒤의 app·release·mode·invocation 문맥을 유지하며 Deno 2.9 대상 test로 확인한다. 알 수 없는 invocation ID를 생성하지 않는다. 내부 trace 이름은 최대 64자다.

- invocation별 최근 200줄, 앱별 최근 500개 invocation, 미연결 log 최근 500줄을 ring buffer로 유지한다. redaction 후 한 줄을 300자로 제한한다. stderr도 같은 한도를 적용한다.
- 줄바꿈 없는 stdout도 무한히 모으지 않는다. streaming decoder에 byte 상한을 두고 초과 부분은 생략 표시한다. redaction 전에 잘라 secret 일부가 새지 않도록 안전성을 모르면 원문을 버린다.
- 추가 log 읽기는 최대 200줄. 실패 직후 마지막 flush 대기는 최대 20ms이며 전달 지연 때문에 업무 결과를 바꾸지 않는다. buffer는 supervisor 메모리이고 snapshot이 선택한 근거만 해당 contract로 보존한다.
- Linux는 현재 자식 신원을 대조한 `/proc/<pid>/status`의 VmRSS를 60000ms마다 비동기로 읽는다. 단절·읽기 실패는 없음이다. macOS/Windows는 확인 가능한 OOM 종료 근거만 남기며 미측정 RSS를 0으로 채우지 않는다.
- 설정된 메모리 한도가 있고 실제 RSS가 그 85% 초과인 상태가 10분 지속되면 수치·기간을 관측으로 보고한다. 표본 누락은 지속 판단을 끊는다. V8 heap 옵션은 전체 RSS 제한이 아니다.
- 예상 밖 종료·ready timeout·crash loop·V8 OOM의 실제 근거를 `문제 보고`로 보낸다. 실행 상태와 열린 problem은 별도로 표시하며 가짜 health·수집률·실패율을 만들지 않는다.

## 3. 저장

### 3.1 ledger의 소유 모듈

아래 표는 모두 platform이 관리하는 `~/.lophn/lophn.db`에 있다. apps 모듈의 command handler가 유일한 writer인 core 안에서 쓰며 supervisor·앱·SDK는 직접 SQLite 연결을 열지 않는다.

| ledger 표 | 앱 영역 소유 모듈 | 저장 내용 |
|---|---|---|
| `apps` | `registration/commands`; `runtime/commands`가 run_enabled, `releases/commands`가 activation 성공 필드를 담당 | App, source 참조, archive, active_release, run_enabled |
| `releases`, `release_tests` | `releases/commands`; `data/commands`가 같은 Activation의 backup·데이터 결과 참조 갱신 | Release의 불변 참조, 마지막 Activation, 실패 요약, Verification 연결 |
| `grants` | `permissions/commands` | exact scope와 approval 참조, active/revoked, 허락/회수 user와 시각. app.call과 agent.commands도 기존 Grant |
| `invocations` | `invocations/commands` | 당시 release·operation·trigger·mode·원래 actor·caller(app/release/parent 또는 run/tool_call)·실제 시작/결과 |
| `packages`, `package_versions` | `sdk/catalog` | 설치 제공 Package와 불변 version의 코드/guide hash |

blueprint·agent-context·connections·automation·runtime·data·preview에는 별도 ledger entity나 표가 없다. 화면 context 선언과 앱 연결 선언은 blueprint blob, AppScreenContext는 앱의 현재 상태를 읽는 일시 값이다. RuntimeObservation과 endpoint·nonce, AutomationClock, permit, invocation 재전송 목록은 메모리다. activation 복구 정본은 Release.activation, 관련 event, 보호 backup 참조와 실제 앱 DB다. 파일 phase journal이나 별도 outbox를 만들지 않는다. command 결과와 재전송 key는 `command` contract의 공통 저장을 쓴다.

### 3.2 파일과 blob

경로 기준은 platform의 데이터 root이며 아래 `~/.lophn`은 기본 예다. app slug 대신 불변 app ID로 디스크 위치를 정한다.

```text
~/.lophn/
  lophn.db
  apps/<app ID>/
    source/                         선택적인 관리 git source; 외부 source_path도 허용
    bundles/<bundle hash>/          읽기 전용으로 풀어놓은 검증 사본
    data/data.db                    운영 SQLite DB, WAL·SHM
    data/files/                     앱의 로컬 파일 영역; DB backup에 포함했다고 주장하지 않음
    preview/<process_nonce>/data.db disposable fixture DB와 파일 영역
    staging/<request key hash>/    commit 추출·build·bundle 준비 중 자료
  sdk/<Package.name>/<version>/     설치 제공 SDK의 읽기 전용 사본
  templates/app/                    hash 검증한 설치 템플릿
```

bundle·정규 blueprint·SDK 코드와 guide·redaction된 실패 detail은 `blob` contract로 불변 저장한다. bundle manifest에는 entrypoint, 각 상대 path·hash, exact sdk_dependencies가 있다. 공개 SDK와 bundle 사본은 파일 0444·디렉터리 0555로 봉인하며 내용 hash를 확인하여 다시 만들 수 있다. 이 사본은 ledger 정본이 아니며 앱에 SDK 설치 디렉터리 전체 접근을 주지 않는다.

app test Verification은 완성된 bundle hash를 대상으로 만들어지고 Release.tests로 고정된다. test result를 이미 hash한 bundle byte 안에 다시 집어넣어 hash를 바꾸지 않는다. 화면 build와 external source map, source commit 경로 대응은 bundle 안에 둔다. stack의 앱 frame은 그 commit 경로, SDK frame은 Package·version으로 해석한다. 일반 invocation 입력·출력 전체나 secret 원문을 blob으로 저장하지 않는다.

운영 DB는 해당 앱 또는 종료 확인 뒤 단독 data worker만 연다. 앱 DB에는 앱의 실제 현재 schema(0 이상)와 마지막 migration 결과를 보관한다. DB 미사용 앱에는 schema 0을 허용하며 빈 migration을 강제하지 않는다. core와 supervisor는 실제 DB를 열지 않고 data worker의 검증된 결과를 받는다.

DataBackup은 SQLite backup API로 WAL의 확정 내용까지 포함한 일관된 복사본을 만든 뒤 무결성·schema를 검사해 보호 `blob`으로 설치한다. 일반 문서 읽기·agent·앱 credential에 그 원문을 공개하지 않는다. backup metadata는 app·activation_seq·schema·database_hash이며 참조는 Activation.backup_hash다. 기본 최근 5개를 유지하지만 진행 중 복원 참조는 보호한다. DB backup을 첨부 파일까지 포함한 전체 복구라고 표시하지 않는다. export는 data worker가 일관된 DB 사본과 고정 blueprint·release 이력·각 불변 실행 bundle·정확한 SDK 의존 byte를 묶는다. secret 원값·credential은 제외하고 앱 외부 자료·첨부의 포함 여부를 명시한다.

secret 원문은 OS keychain에만 있고 이 영역은 이름과 grant만 취급한다. runtime log buffer와 memory 표본은 메모리이며 지속 log 정본이나 derived 검색 index를 새로 두지 않는다. 플랫폼 자체 진단은 `platform/diagnostics`를 가리킨다.

### 3.3 SDK와 템플릿

공개 API·type·permission 요구·exact peer·예제·import 안내는 version별 guide blob이다. `lophn-sdk:` import map은 release 준비 때 공개 hash를 확인한 bundle 내부 상대 file 경로로 치환한다. 운영에서 registry server를 조회하거나 설치 SDK 최신판을 선택하지 않는다. SDK update는 새 version만 추가하고 기존 release byte·guide를 바꾸지 않는다.

첫 공개 묶음의 정확한 version은 1.0.0이다. 이름은 `@lophn/blueprint`, `@lophn/tokens`, `@lophn/ui-{control,overlay,layout,reading,table,chart,filter,stat,state,action}`, `@lophn/cap-{fs,net,store,problem,schedule,save,secret}`와 `documents/formats`가 정한 format Package다. Package는 component·capability·domain·format 중 한 종류다. `cap-read-model`, `cap-notify`, 개인 Package 등록은 제공하지 않는다. capability import는 grant를 주지 않는 typed client다.

템플릿 선택은 명시된 `LOPHN_APP_TEMPLATE` → 설치 `templates/app` 순서이며 없으면 검증된 설치 템플릿을 제공한다. 진입 코드·blueprint·exact import map과 lock·생성 blueprint test·fixture·React 화면·root AppErrorBoundary·문제 보고와 예외 수집·coding agent 안내를 기본 연결하고 DB 사용 때만 migration을 둔다. GUI의 React/npm 의존은 고정 UI Package가 제공한 exact 목록으로 준비 단계에만 build한다. 공용 UI SDK·템플릿은 shell/wording의 message key·en-only·ICU·Intl 계약과 en catalog·placeholder 검사를 기본 build/test에 연결하고 catalog·formatter 의존 byte를 bundle에 고정한다. 화면 문구 변경은 screen/command key를 바꾸지 않는다. lophn 화면은 설치 SDK의 첫 소비자이며 앱 DB 구조나 한 앱 전용 prop을 SDK로 자동 승격하지 않는다.

## 4. concern 배치표

| concern | 프로세스 | 모듈 (`packages/apps/` 기준) | 저장 | 주로 쓰는 contract |
|---|---|---|---|---|
| apps/registration | core; source 확인은 release worker | `registration/commands`, `registration/read` | apps; source_path | command, read |
| apps/blueprint | blueprint 추출 자식; release worker; 앱 | `blueprint/schema`, `blueprint/extract`, `blueprint/validate` | 정규 JSON blob, bundle | blob, test 실행 |
| apps/releases | core; supervisor; release worker | `releases/commands`, `releases/prepare`, `releases/activation` | releases, release_tests, bundle | release 준비·적용, approval |
| apps/runtime | core 제어 어댑터; supervisor; 운영 앱 | `runtime/connect`, `runtime/supervisor`, `runtime/entrypoint`, `runtime/client`, `runtime/observations` | apps.run_enabled, 메모리 관측·log | 앱 통로, 인증, event 구독 |
| apps/agent-context | 앱; agent runtime·shell 소비자 | `agent-context/schema`, `agent-context/redaction`; handler는 앱 | blueprint blob; 앱 현재 view 상태 | 앱 통로, redaction, 앱 화면 틀 |
| apps/connections | core 연결 준비 어댑터; supervisor; source·target 앱 | `connections/resolve`, `connections/client`, `connections/origin` | blueprint blob; grants; 일시 connection | 앱 통로, 인증, approval |
| apps/permissions | core; supervisor broker; 앱 | `permissions/commands`, `permissions/flags`, `permissions/broker` | grants; secret 이름만 | 인증, approval, secret, redaction |
| apps/automations | 앱; 전체 permit만 supervisor | `automations/clock`, `automations/permits` | 메모리 clock·permit; invocation | 앱 통로, invocation 전달 |
| apps/invocations | 앱; supervisor; core | `invocations/context`, `invocations/delivery`, `invocations/commands` | invocations, detail blob, bounded 메모리 | invocation 전달, command, approval |
| apps/data | 단독 data worker; 운영 앱; 결과만 core | `data/worker`, `data/commands` | data.db, 보호 backup blob, Activation 참조 | release 준비·적용, blob, invocation 전달 |
| apps/preview | supervisor; preview 앱 | `preview/launcher`, `preview/adapters` | disposable DB·파일·메모리 | 앱 통로, 앱 화면 틀, test 실행 |
| apps/sdk | 설치 worker; core catalog; 앱·shell 소비자 | `sdk/catalog`, `sdk/resolve`; 공개 구현은 `packages/sdk/` | packages, package_versions, 코드/guide blob·사본 | read, blob, format 실행 |

leaf concern 12개 모두 배치하며 다른 concern의 table에 직접 접근하는 런타임 코드를 두지 않는다.

## 5. 내놓는 contract

### 5.1 앱 통로

**연결 요청.** `POST /v1/apps/connect`는 `{app,mode,screens,screen_sizes,commands,caller?,preview_nonce?}`를 받는다. core의 read 경로 밖 제어 어댑터가 supervisor의 현재 연결을 확인하고 `인증` contract로 원래 credential의 actor·scope를 제한한다. 출력은 현재 direct endpoint와 서명된 AppConnection `{endpoint, connection, signature}`이다. `{payload: connection, signature}`가 앱 direct 요청의 Authorization이다. 호출 자격마다 범위가 다르다: 사람(user)은 요청한 화면·크기와 command 중 선언과 만나는 것, agent는 현재 active agent.commands 허락 ∩ 역할·assignment 범위(AgentAppScope) ∩ 현재 프로세스가 등록한 command와 인증된 run·tool call 호출자, coding agent는 선언 command, machine(supervisor)은 화면·command가 없는 제어 connection이다. 범위 밖 앱은 없는 앱과 같은 응답이다. 원래 credential이 닫히거나 agent 허락이 줄면 발급한 connection의 프로세스를 정지 확인 뒤 새 nonce로 다시 띄워 이전 통로를 닫는다(credential 상태와 grant를 주기적으로 다시 읽는다). endpoint·nonce는 ledger에 저장하지 않는다. release 없는 preview는 bundle 기준의 개발 연결만 발급하며 가짜 rel ID를 만들지 않는다. 화면 연결의 endpoint와 credential은 Electron main에만 둔다.

**닫힌 화면 view.** `POST /v1/apps/view_closed`는 `{app, view_session}`을 받는 memory route이며 사람(user) 자격의 shell main만 부른다. shell은 앱 machine 연결이 없으므로 core 제어 어댑터가 범위를 확인한 뒤 supervisor의 `apps.view_closed`로 그 앱의 지금 live 자식 nonce를 붙여 direct socket의 `/_lophn/control/view-closed`를 보낸다. 출력은 `{relayed}`로 받을 live 자식이 있었는지만 알린다. 범위 밖 앱은 없는 앱과 같은 응답이다. ledger를 쓰지 않는다.

AppConnection은 app·release·bundle_hash·mode·process_nonce·원래 actor·credential_ref·screen/size/command 범위·인증된 caller·기한을 묶는다. mode는 `live`·`preview`·`test`다. Authorization과 confirm proof는 `{payload, signature}` envelope다. 서명 대상은 payload의 RFC 8785 canonical JSON UTF-8이고 signature는 raw 64byte Ed25519의 base64url이다. key 순서가 달라도 같은 payload는 같은 서명 bytes다. 서명 key는 core 안 apps 제어 어댑터가 core 시작마다 만들고, 앱은 시작 입력의 공개 검증 key만 받아 매 요청을 로컬 검증한다. 재시작·activation·grant 변경·credential 회수/축소는 이전 통로 종료와 새 nonce로 나눈다. 본문 actor·effect·mode 주장은 권한 근거가 아니다.

**direct socket 경로.** 아래 경로는 core API가 아니다. caller가 직접 앱 socket으로 보내며 Authorization에 AppConnection을 쓴다. request_key는 호출 식별이고 일반 업무의 exactly-once 보장이 아니다.

| 경로 | 입력 | 출력 |
|---|---|---|
| `GET /screens/<screen key>/<asset path>` | 고정 release·screen/size scope, 인증된 view_session, bundle 내부 path | content type과 화면 byte. traversal·scheme·authority 금지 |
| `POST /_lophn/commands/invoke` | `{request_key,release?,command,input?,proof?}`; live에는 release 필수, release 없는 preview는 connection.bundle_hash에 결속 | `{result,invocation?,mode}` 또는 오류. 연결에 고정된 blueprint로 검증·default 적용 |
| `POST /_lophn/commands/cancel` | 같은 호출의 request_key·알려진 inv ID | 취소 요청 접수 여부. 효과 취소나 종료 보장은 아님 |
| `GET /_lophn/commands/status` | 같은 connection과 request_key·inv ID | 현재 프로세스가 아는 진행/결과 또는 unknown. handler 재실행 없음 |
| `POST /_lophn/control/probe` | 플랫폼 인증 연결·현재 nonce | ReadyAttestation의 실제 연결 근거 |
| `POST /_lophn/control/open` | 플랫폼 인증 연결·확정된 release/activation 기준 | accepting 전환. activation commit 전 거절 |
| `POST /_lophn/control/close` | 플랫폼 인증 연결·의도된 종료 이유 | 새 호출·clock 차단 확인 |
| `POST /_lophn/control/view-closed` | 플랫폼 인증 연결·현재 nonce·`view_session` | 그 view session을 버린다. 이후 그 session의 화면 요청은 conflict, context 조회·주석 쓰기는 unavailable. 앱의 협조가 필요 없다 |
| `POST /_lophn/control/shutdown` | 플랫폼 인증 연결·grace_ms | 종료 요청 접수. 앱은 새 호출을 닫은 채 진행 호출이 끝나는 대로(grace_ms 안에서) 스스로 끝나고 유예가 지나면 supervisor가 강제 종료한다. OS 종료 확인은 별도 |

screen은 `앱 화면 틀`의 좁은 preload와 Electron main을 통해 부른다. main은 송신 view 신원에서 app·release·mode를 정하며 임의 socket과 token을 view에 노출하지 않는다. MCP·CLI·agent runtime은 같은 `runtime/client`로 direct socket을 부른다. Operator의 승인된 read scope 등 호출자의 제한은 `인증`과 해당 호출자 concern을 따른다. 앱 read는 effect=read인 command이지 별도 Query/read-model 통로가 아니다.

**confirm.** `confirm=true`는 인증된 user·app·agent 요청 모두에서 정확한 사람 approval을 요구한다. 앱 쌍 Grant와 agent.commands Grant는 이 결정을 대신하지 않는다. shell main 또는 agent/앱 호출의 플랫폼 어댑터가 고정 blueprint로 검증·default 적용한 정규 입력과 인증된 원래 caller를 `approval`과 `confirmation window`에 묶는다. 정확한 approval 뒤 broker의 플랫폼 어댑터가 `invocation.accept_confirm` command로 accepted와 approval 사용을 한 transaction에 확정한다. 출력은 inv ID와 ConfirmExecutionProof다. caller는 그 proof를 실제 입력과 함께 direct 호출에 붙인다. core는 handler를 중계하지 않는다.

앱은 proof의 서명·inv ID·현재 nonce·release·command·input_hash·InvocationCaller projection·expires_at을 비교하고 handler 전에 메모리 marker에 넣는다. 같은 접수는 알고 있는 같은 진행/결과만 반환한다. marker는 proof 만료 전 제거하지 않으며 프로세스당 4096개 한도에 닿으면 새 접수를 거절한다. 종료 결과의 큰 본문 대신 inv ID와 진행/종료 여부를 유지하므로 marker를 비워 재실행하지 않는다. 새 프로세스에서는 옛 proof를 쓸 수 없다. accepted는 started_at을 만들지 않는다. 저장 실패·입력 변경·재시작 때 사람 결정을 재사용하지 않는다.

**broker의 제한된 서비스.** `POST /_lophn/broker/ready`, `/invocations/submit`, `/control/watch`, `/automations/try_acquire`, `/automations/release`, `/net/fetch`, `/secrets/use`, `/documents/save`, `/problems/report`, `/apps/connect`, `/apps/confirm/request`, `/apps/confirm/poll`는 해당 자식 credential과 현재 mode·nonce에 묶인다. ready·invocation·permit 외 서비스는 소유한 `secret`, `문제 보고`, 문서 contract를 호출할 뿐 그 contract를 재정의하지 않는다. SDK는 core command 임의 호출·grant 발급·problem 닫기를 할 수 없다. `/apps/connect`는 source 자식 신원으로 제한된 다른 앱 connection 준비만 하며 업무 payload를 중계하지 않는다. `/apps/confirm/request`·`/apps/confirm/poll`은 호출한 앱 자식이 confirm=true command(정확한 대상 앱·release·command·입력)의 approval을 요청하고 사람의 결정을 짧은 poll(최대 5초)로 기다려 서명된 proof를 받는 통로이며 proof는 `apply_approved_action`으로 approval이 한 번 쓰인 뒤에만 나온다.

`secrets/use`의 앱 입력은 SecretUseContext와 인증할 목적지·요청이며 원값 get/CRUD가 아니다. broker는 현재 이름 선언∩grant, live·accepting 자식 credential·nonce, grant가 허락한 목적지를 검증한 뒤 `secret`과 `redaction` contract를 쓴다. 플랫폼 전송부가 전송 직전에 인증 값을 붙이고 앱에는 안전한 사용 결과만 반환한다. 목적지 변경 redirect는 재검사하고 grant 밖이면 거절한다. 호출마다 사람 확인을 받지 않고 command를 부른 쪽(사람 화면·agent·automation·다른 앱)으로 막지 않는다. 값은 앱 코드·preview·준비 모드·agent·argv·환경·invocation·event·공통 blob으로 가지 않는다. redaction 등록 실패면 사용하지 않는다. 원값이 필요한 임의 앱 계산은 이 방식으로 지원한다고 약속하지 않는다. 값 교체·삭제 뒤 사용 앱은 종료 확인과 새 nonce로 재시작한다.

**오류.** signature/credential 오류 `unauthorized`, scope·확인·permission 부족 `forbidden`, 미선언 command·schema 오류 `invalid_input`, release·nonce·input 불일치 `conflict`, 멈춤·교체·preview 없음 `unavailable`, 대상 없음 `not_found`다. secret 이름 없음은 not_found, keychain 사용 불가는 unavailable이다. 안전한 오류에는 필요한 permission 이름·scope를 넣고 secret이나 원문 stack을 외부 응답에 노출하지 않는다. 전송 단절은 결과 모름이다.

**보장.** 연결 이후 일반 요청·응답은 core·supervisor·ledger queue를 지나지 않는다. 매 요청의 credential과 당시 blueprint 검사는 로컬이다. 성공 일반 read와 screen byte마다 ledger를 쓰지 않는다. confirm만 선행 접수 관문이 있다. **보장하지 않음.** 일반 쓰기의 자동 재호출, 모든 외부 효과의 exactly-once, SDK만으로 악의적인 앱 내부 부작용 차단, 준비 성공으로 업무 정상 판정.

### 5.1.1 앱 쌍 direct call

`connections/resolve`는 source의 현재 release.app_connections, active `Grant(kind="app.call", app=source, scope={app:target,commands})`, target의 현재 command 목록을 교차한다. 사람 approval은 방향 있는 앱 쌍·정확한 command 목록에 한 번 묶인다. 새로운 대상·command는 새 Grant이며 반대 방향·제3 앱으로 재위임하지 않는다. target의 file/network/secret Grant는 target 자신의 경계다.

source는 자기 broker의 `POST /_lophn/broker/apps/connect {app:target,commands}`로 준비 요청을 한다. 신원은 요청 본문이 아니라 자식 credential·현재 release/nonce에서 정한다. 준비 서비스는 source/target이 live·accepting임을 검사해 target endpoint와 app actor의 서명된 AppConnection을 반환한다. AppCallOrigin은 source app/release/nonce·Grant·알려진 parent_invocation·호출 path를 묶는다. target socket만 source의 Deno 범위에 추가하며 임의 다른 socket 접근은 열지 않는다. 연결 이후 `runtime/client`는 대상 direct socket의 기존 commands/invoke를 그대로 부른다. source/target release나 grant 변경은 관련 source 통로 차단·source 종료 확인·새 범위 재시작으로 나누며 연결 준비 중 교체는 conflict다.

현재 path에 target이 있거나 추가 뒤 앱 수가 8을 넘으면 handler 전 invalid_input이다. path는 자식이 주장하지 않는다. 호출을 다른 앱에게서 받은 중이면 SDK가 받은 연결의 출처 식별(`incoming`: 부른 앱·release·부모)만 broker 요청에 싣고, 준비 서비스가 자기가 발급한 origin 중 이 자식 프로세스가 받은 것과 맞춰 path를 자기 값으로 잇는다. 모르는 출처는 invalid_input이고 입력의 path 주장은 없다. 그래서 ledger에 남지 않는 읽기만 거친 A→B→A도 준비 때 거절된다. `incoming`이 없으면 서비스가 broker로 본 호출 시작 사실(받은 앱이 보낸 caller 근거)로 이어 가고, 시작 사실도 없으면 부모 없음·새 path다. 대상 failure와 전송 단절은 해당 호출에만 돌아가며 업무 쓰기 retry는 없다. confirm은 5.1의 같은 사람 approval/accepted/proof로 실행한다.

### 5.1.2 agent tool과 화면 context

agent connection은 기존 `Grant(kind="agent.commands",app=target,scope={commands})`와 역할/assignment 범위 교집합으로 발급한다. 기본은 닫힘이고 화면 열기나 app.call 허락과 별개다. `created_by/created_at/revoked_by/revoked_at`은 사람 결정과 종료 확인 시각을 남긴다. 인증된 AgentCallOrigin `{kind:"agent",run,tool_call}`을 묶는다. command key·label·description·input에서 tool 정의를 만드는 일과 effect/revert/confirm 판정은 `lophn-agent/harness/tools`, `lophn-agent/harness/tool-judgment`가 소유한다. 앱은 별도 MCP server를 만들지 않는다.

blueprint의 `screens[].sizes=[full|panel|card]`는 실제 반응형 entrypoint의 지원 모드다. 요청의 screen/size/view_session을 검증하고 같은 운영 프로세스의 서로 다른 view session으로 표시한다. panel/card를 선언하지 않은 full 화면을 억지로 줄이지 않는다. component는 실제 container resize를 사용하며 panel 320px·card 240px부터 페이지 가로 scroll을 만들지 않는다. app view의 격리와 lifecycle은 `shell/app-frame`, 탭·시각 블록의 배치는 `shell/workspace`다.

`agent_context[]`는 AgentContextDeclaration이고 read_command와 annotation_targets[].write_command는 같은 commands 목록의 안정된 앱 key다. 예약 context command 이름이나 DOM 접근은 없다. `ScreenContextReadInput {screen,view_session,detail}`에서 `AppScreenContext {app,release,screen,view_session,revision,summary,data?,redacted}`를 반환한다. summary는 redaction 후 2048byte 이하이고 turn에는 요약만, 상세는 같은 read command tool로 조회한다. 앱은 sensitive_paths를 제거하고 model 전달 경계는 `platform/redaction`을 다시 쓴다. 안전성 미확인은 원문 생략이다. 상태는 앱이 소유하며 lophn ledger에 복제하지 않는다.

주석 입력 `AnnotationWriteInput {screen,view_session,expected_revision,target,text}`는 선언된 target과 현재 revision에 CAS한다. 닫힌 view=unavailable, revision 변경=conflict다. handler는 효과 전의 거절을 `CommandRejection`(코드 `invalid_input|forbidden|conflict|unavailable`)으로 알리고 entrypoint가 그 코드와 안내 문장으로 답한다. 다른 예외는 원문 없는 500이다. command.revert가 지원하는 write만 `{result,revert:{invocation,receipt,expected_revision}}`를 반환하며 receipt는 앱 내부 변경 전 상태 참조다. 되돌림 command도 같은 command 통로·현재 revision 검사를 사용한다. 앱 업무 보상과 run revert 연계는 `lophn-agent/revert`가 소유하며 성공 선언만으로 복원을 확정하지 않는다.

SDK의 `@lophn/blueprint.defineAgentContext`, `@lophn/cap-schedule.registerScreenContext/registerAnnotationTarget/connectAppCommands`는 위 type과 검사를 공유한다. chart/table의 선언형 JSON은 기존 ui-chart/ui-table가 앱과 lophn 화면에서 함께 그린다. 임의 script는 입력에 없으며 앱 카드는 격리된 app view다. 시각 블록 보관과 문서화는 `lophn-agent/visuals`다.

### 5.2 invocation 전달

**입력.** 실제 관측한 inv ID·app·당시 release·operation(command/start/data_change)·trigger(direct/automation/activation/restart)·mode·인증된 원래 actor·InvocationCaller·실제 시작/종료/거절과 안전한 summary/detail_hash를 받는다. 앱 본문의 actor 대신 AppConnection·confirm 접수와 자식 credential 문맥을 검증한다. 제출 command actor는 machine이고 Invocation.actor는 원래 caller다. credential 원문·일반 입출력 본문은 저장하지 않는다.

**구체 경로와 event.** supervisor가 다음 core RPC로 제출한다. 공통 응답 envelope·오류·CAS·idempotency 규칙은 `command` contract를 따른다.

| RPC | 출력 사실 | event |
|---|---|---|
| `POST /v1/invocations/accept_confirm` | 동일 key의 accepted와 proof; 정확한 approval 사용과 원자적 접수 | `InvocationAccepted` |
| `POST /v1/invocations/record_started` | inv의 실제 running 또는 이미 확정한 같은 사실 | `InvocationStarted` |
| `POST /v1/invocations/record_finished` | succeeded/failed/unknown의 실제 종료·미확인 결과 | `InvocationFinished` |
| `POST /v1/invocations/record_denied` | handler 미시작 거절 | `InvocationDenied` |

write/external·confirm·automation의 read 포함 전체 호출·실패/거절 read·앱 start·data_change를 기록한다. 일반 direct 호출의 앱 adapter는 실제 start/finish 사실을 메모리에 모았다가 응답을 보낸 뒤 전달을 시작한다. 전송이 끊기면 응답 경계가 끝난 뒤 아는 사실만 전달한다. automation·start·data_change는 caller 응답 경계가 없으므로 관측 직후 비동기로 전달한다. app은 응답을 기록 전달에 묶지 않으며 종료 사실에는 실제 started_at을 포함해 끝이 먼저 도착해도 한 번에 기록할 수 있다. 성공 일반 read의 응답 호출 ID가 있다고 ledger 행이 있다는 뜻은 아니다. release 없는 preview는 Verification과 개발 진단이며 Invocation을 꾸며 만들지 않는다.

**전달기.** supervisor의 메모리 목록은 전체 4096 메시지 또는 8MiB 중 먼저 닿는 한도로 제한한다. summary는 최대 16KiB이며 큰 안전한 실패 상세는 blob 참조다. unavailable만 1s·2s·4s부터 최대 30s backoff로 같은 메시지를 재전송한다. 앱 업무는 재실행하지 않는다. 저장 확인 뒤 메시지를 지우며 `(inv ID,start/finish/deny)` 공통 key로 중복을 막는다. 메모리 한도 초과는 redaction된 손실 진단을 `platform/diagnostics`로 내고 앱 응답은 막지 않는다. unauthorized·conflict·invalid_input은 반복하지 않는다.

**출력·오류·보장.** 확정한 inv ID·status 또는 conflict/unauthorized/invalid_input/unavailable을 반환한다. 같은 사실은 같은 결과, terminal의 다른 결과는 conflict다. 늦은 start가 terminal을 running으로 되돌리지 않는다. 알려진 ID만 unknown으로 확정한다. accepted만 있어 시작/결과를 모르면 그 부재를 유지한다. 성공은 handler 반환과 경계 계약 만족일 뿐이다. 실패·timeout·취소 요청은 부분 DB 저장·외부 효과가 없다는 증명이 아니다.

**보장하지 않음.** supervisor crash 뒤 메모리 기록 보존, 앱 DB와 ledger의 원자적 transaction, 누락 기록의 추측 복원, 외부 효과 exactly-once. ID를 잃으면 기록 없음/연결 ID 모름으로 표시하고 새 inv를 만들지 않는다.

### 5.3 release 준비·적용

**작업 요청 API.** 요청 수락은 release 확정이 아니다. control 어댑터가 인증·앱 scope를 확인하여 core command queue 밖 supervisor에 요청한다. request_key는 메모리 진행 식별이며 새 영구 job entity가 아니다.

| RPC | 입력 | 출력 |
|---|---|---|
| `POST /v1/releases/prepare_bundle` | app, 완전한 commit ID, request_key, ticket_source? | 준비 접수와 진행 key; 완료 시 고정 bundle_hash·blueprint_hash·manifest |
| `POST /v1/releases/preparation` | app,request_key | 현재 진행/완료/취소/실패; 작업 메모리 유실이면 unknown |
| `POST /v1/releases/cancel_preparation` | app,request_key | 취소 요청. worker 종료 확인 뒤 정리 |
| `POST /v1/releases/prepare` | 신뢰된 준비 결과, tests, ticket_source?, key | 불변 prepared Release |
| `POST /v1/releases/start_activation` | release,approval,expected previous release,grants seq,실제 schema,key | activating, started_seq |
| `POST /v1/releases/record_backup` | release,activation_seq,보호 hash,실제 schema | 복구 참조 확정 |
| `POST /v1/releases/record_data_change` | DataResult | 실제 schema·무결성 결과 확정 |
| `POST /v1/releases/record_data_restore` | DataResult,backup_hash | 실제 복원 결과 확정 |
| `POST /v1/releases/complete_activation` | release,started_seq,DataResult·ReadyAttestation | 새 active 참조와 이전 superseded |
| `POST /v1/releases/fail_activation` | release,started_seq,안전한 failure | failed, 이전 active 참조 유지 |

뒤의 확정 RPC는 machine 제출 전용이다. coding agent가 tests 통과 주장·hash 주장·데이터 성공을 직접 확정하지 못한다. 요청 서비스가 `test 실행` contract를 호출하고 runner가 쓴 같은 hash의 통과 app test만 Release.tests로 채택한다.

**bundle 준비.** 연결된 실제 git source 경계에서 지정한 commit의 tree/object만 추출한다. working tree 변경·symlink·git 정보·개발 credential·agent 도구·임시 설정은 포함하지 않는다. 준비 앞뒤에 source 경계·commit object·핵심 pin·working tree 관측을 대조하고 도중 변화면 source_changed로 취소한다. source를 운영 대상으로 직접 실행하지 않는다. source 상한 64MiB, 완성 bundle 상한 256MiB, 파일 수 10000개, 전체 준비 300000ms를 적용한다. worker 종료·취소·상한 초과 때 부분 사본을 release로 확정하지 않는다.

고정 SDK code/guide hash·import map·lock·blueprint 정규 JSON·실제 handler 목록·문서 format·permission·automation·필수 problem code를 검사한다. blueprint TS는 권한 없는 추출 자식에서 10초까지 실행한다. GUI build와 external source map까지 끝낸 후 bundle manifest와 실제 byte를 봉인하여 `blob`으로 설치한다. bundle_hash가 완성된 뒤 바로 그 hash로 app test를 요청한다. test 후 byte 수정은 새 bundle·새 test다.

새 coding release 준비는 ticket 출처가 필수이며 요청 시와 준비 확정 시 모두 현재 connection·claim_seq·기한을 검사하고 출처를 불변 보존한다. 과거 ticket 없는 release는 당시 null 출처로 보존하며 옛 release 선택은 새 코드 수리가 아니다. 같은 입력 schema라는 이유로 동작 호환을 주장하지 않으며 command 효과·confirm·automation·permission·데이터 변경·손실·삭제한 problem code 경고를 이전 release와 비교하여 사람에게 제공한다.

**activation.** 모든 activation과 이전 release 선택에 정확한 사람 approval이 필요하다. 앱마다 하나만 접수하고 다른 activation과 grant 변경을 거절한다. 시작과 확정 모두 활성 참조·bundle·grant seq·approval·실제 schema를 CAS한다. 순서는 이전 자식 종료 확인 → 필요할 때 보호 backup 확정 → migration과 schema 실제 확인 → 새 앱의 준비 확인 → 활성 참조 commit → 업무 통로 open이다. schema가 같은 rollback은 새 activation이며 다른 schema의 옛 release는 바로 시작하지 않는다.

**event 목록.** `ReleasePrepared`, `ReleaseActivationStarted`, `ReleaseBackupRecorded`, `ReleaseDataChanged`, `ReleaseDataRestored`, `ReleaseActivated`, `ReleaseSuperseded`, `ReleaseActivationFailed`를 내놓는다. 앱 영역 notification 계기는 ReleaseActivationFailed만이며 다른 시작/권한/invocation event를 notification 계기로 추가하지 않는다.

**오류.** commit·선언·의존·상한·연속 migration 경로 오류는 invalid_input, scope·approval 부족은 forbidden, source/claim/CAS 변화·진행 activation은 conflict, test 미통과·backup·migration·시작 실패는 안전한 근거를 동반한 unavailable이다. approval 거절은 실제 activation 실패가 아니다.

**보장.** 같은 hash의 app test를 통과한 고정 byte만 prepared가 된다. 시작 준비 실패한 판은 active가 되지 않는다. 새 업무 통로 전 migration/준비 실패면 backup 복원과 실제 무결성·schema 확인 뒤 이전 release를 다시 준비한다. **보장하지 않음.** test의 전체 업무 정답 증명, 코드 rollback으로 외부 효과 취소, activation commit 이후 옛 backup 자동 덮어쓰기, DB 외 첨부까지 복원.

### 5.4 앱 영역 command·read 목록

이는 위 세 contract의 상태·목록을 사용하는 구체 앱 영역 표면이다. actor와 비교 기준은 각 domain model command 정본을 따른다. 모든 core RPC는 POST이며 응답 envelope는 `command`/`read` contract의 것이다.

| resource | RPC method (`/v1/<resource>/<method>`) | 결과·관련 event |
|---|---|---|
| `apps` | `create`, `connect_source`, `archive`, `unarchive` | App; `AppCreated`, `AppSourceConnected`, `AppArchived`, `AppUnarchived` |
| `apps` | `enable_execution`, `disable_execution` | 실행 허용 변경; `AppExecutionEnabled`, `AppExecutionDisabled` |
| `apps` | `record_started`, `record_stopped`, `record_unavailable` | 실제 관측; `AppStarted`, `AppStopped`, `AppUnavailable` |
| `grants` | `create`, `revoke` | exact Grant와 종료 확인; `GrantCreated`, `GrantRevoked` |
| `packages` | `register_version` | 설치 machine만 불변 코드·guide 등록; `PackageVersionRegistered` |
| `apps` | `list`, `get`, `blueprint` | App 목록·고정 release 선언. runtime 상태와 생존은 현재 supervisor 관측 별도 |
| `apps` | `runtime`, `logs`, `automations` | 현재 RuntimeState·관측, 최대 200줄 log, 선언/실행 가능 여부/실제 관측. 관측 없음 명시 |
| `releases` | `list`, `get`, `compare` | 불변 Release와 당시 test·claim 출처·activation 비교 |
| `grants` | `list` | 현재 app의 grant와 선언 교집합 |
| `invocations` | `list`, `get` | 당시 release로 해석한 상태·안전한 detail 참조 |
| `packages` | `list`, `versions`, `guide`, `usage` | 공개 exact version·고정 guide·release 사용처 |
| `previews` | `start`, `get`, `stop` | PreviewInput으로 별도 프로세스 시작/실제 관측/종료 요청; App 활성 참조 변경 없음 |
| `apps` | `export` | 단독 data worker가 준비한 앱 export; 준비 중·완성·실패 구별 |

create는 user 또는 전체 scope coding connection만, source 연결은 user 또는 해당 앱 범위 connection만 받는다. 이름 추천은 slug의 대시·밑줄을 공백으로 바꾸고 단어 첫 글자를 대문자로 하되 입력 이름은 보존한다. AppCreated 뒤 assignment 생성과 앱 place 이름 공간은 해당 concern의 contract를 쓴다. archive는 run_enabled=false와 새 호출 차단을 만들지만 release 이력과 문서 place를 삭제하지 않는다. unarchive도 false를 유지한다.

read는 ledger write queue를 거치지 않는다. runtime·logs·automations는 현재 supervisor 메모리를 비동기로 조회하며 과거 event만으로 running이라고 응답하지 않는다. 공통 오류는 unauthorized/forbidden/not_found/invalid_input/conflict/unavailable이다. grant 회수 접수와 기존 프로세스 종료 확인·revoked 확정을 구별하고 종료를 모르면 unavailable, 회수 완료 아님이다.

## 6. 쓰는 contract

| 다른 소유 contract | 쓰는 곳 |
|---|---|
| command, read | 등록·release·grant·invocation·SDK 목록과 짧은 확정. 앱 DB 업무 호출에는 쓰지 않음 |
| event 구독 | supervisor 시작 때 현재 사실을 read한 뒤 seq cursor로 허용·archive·grant·secret 변경·activation을 따라잡음. 중복 event로 migration/on_start 재실행하지 않음 |
| blob | 불변 bundle·blueprint·SDK·guide·안전한 실패 detail·보호 backup 설치와 참조 |
| 인증 | 원래 actor·scope, 자식 broker credential, AppConnection·ConfirmExecutionProof 서명/검증, 회수 |
| approval, confirmation window | grant·activation·정확한 confirm command와 입력에 대한 사람 결정 |
| secret, redaction | 인증 전송 직전의 secret 사용, 저장·log·report·외부 응답의 안전한 출력 |
| notification | ReleaseActivationFailed의 정해진 notification |
| format 실행 | blueprint가 선언한 문서 format 검사. format 앱 코드를 core에서 import하지 않음 |
| 파일 준비 결과와 문서 저장 | cap-save의 선언 key·기대 version·재전송 key로 문서 준비와 확정. 성공 응답은 실제 version 확정까지 기다림 |
| 문제 보고 | SDK 예외·command 실패·시작/종료·memory 관측을 안전하게 전달. preview는 개발 진단으로 분리 |
| test 실행 | 고정 bundle hash의 app test. 결과는 runner만 기록 |
| 앱 화면 틀 | 화면 신원·view session·main의 직접 호출과 [문제 알리기] 연결 |
| shell/workspace | panel 탭과 세션 card container·현재 보기 상태. 업무 상태는 앱 read command에서만 얻음 |
| lophn-agent/harness/tools, tool-judgment, prompt-assemble | command tool 정의·역할 노출·effect/revert 판정·turn의 작은 화면 요약. 앱 영역은 현재 계약과 직접 통로만 제공 |
| lophn-agent/revert | 지원 command의 invocation/receipt/revision으로 업무 보상. 앱 DB와 ledger의 원자적 복원을 주장하지 않음 |
| coding agent 통로 | source 연결·준비·preview 요청과 SDK 안내. 실제 CLI/MCP 이름은 소유 파일을 따름 |

cap-save는 임의 document/place를 고르는 API가 아니다. 현재 release의 documents.key·document.save grant·live 문맥을 검사하고 `documents/versions`가 자기 앱 place의 `(app,key)` 문서 대응과 기대 version 충돌을 소유한다. 저장 결과가 command 결과의 일부면 그 version 확정을 기다리되 invocation 후행 기록은 기다리지 않는다. preview는 문서 대역만 사용한다.

## 7. 흐름

### 7.1 화면 조회와 일반 업무 쓰기

```text
[shell main/MCP/agent runtime] apps.connect (인증된 연결 요청)
  → [core 제어 어댑터] 현재 supervisor 관측 + 인증 contract로 제한 connection
  → [caller] direct GET screens / POST commands/invoke
  → [앱] signature·nonce·release·mode·scope·blueprint input 검사
  → [앱] 자기 DB transaction, 실제 handler 결과를 caller에 응답
  → [앱] 작은 관측을 비동기 broker 전달
  → [supervisor] invocation.record_started / record_finished command
  → [core] ledger와 event 확정
```

일반 호출 응답은 마지막 두 단계를 기다리지 않는다. 쓰기 응답이 끊기면 caller는 결과 모름을 표시하고 같은 업무를 자동 재호출하지 않는다. read는 정상 0행과 미수집·부분 범위·신선도 부족을 앱 결과로 구분하며 paging cursor는 처음 조건·정렬·데이터 기준에 묶는다. 성공 일반 read에는 매번 invocation 행을 만들지 않는다.

### 7.2 confirm command와 secret 인증 전송

confirm command의 흐름이다. confirm=false command는 approval 단계 없이 바로 앱에 가고, secret 사용은 아래 `secret.use` 검사(선언 이름∩grant·mode·목적지)만 거친다.

```text
[앱 view의 사람] command 요청
  → [shell main] 당시 blueprint 검사·default 적용·정규 input hash
  → [confirmation window / approval] 정확한 release·command·입력·영향 결정
  → [플랫폼 broker 어댑터] invocation.accept_confirm command
  → [core] approval 사용 + accepted 원자적 확정, proof 반환
  → [shell main] 같은 입력·proof를 앱 direct socket에 전송
  → [앱] proof 검사 + handler 전 marker, 실제 시작
  → [broker 전송부] secret.use 검사(선언 이름∩grant) → secret·redaction contract → 인증 전송
  → [앱] 실제 사용 결과 반환
  → [supervisor] 실제 start/finish만 후행 command
```

접수 저장 전 handler는 부르지 않는다. 두 번 전송한 같은 proof는 같은 marker를 만나 새 실행이 아니다. secret 값은 앱 프로세스에 반환되지 않는다. accepted 직후 단절은 시작을 증명하지 않고, 실제 외부 요청 이후 단절도 외부 효과를 자동 반복할 근거가 아니다.

### 7.2.1 앱 쌍 호출과 agent 주석

```text
[사람] A→B 정확한 command 목록 / B의 agent.commands 별도 허락
  → [core] 기존 Grant에 사람·시각·scope 확정
  → [supervisor] 관련 이전 자식 종료 확인, 새 socket 범위·nonce로 시작
[A의 SDK / agent runtime] 연결 준비 요청, 인증된 AppCallOrigin / AgentCallOrigin
  → [준비 어댑터] 선언·Grant·현재 source/target·역할 scope 교집합
  → [caller] 기존 target direct commands/invoke
  → [B] 같은 handler·입력·confirm/proof·caller 검사
  → [B] caller에 업무 결과 응답, caller 참조 포함 관측만 후행 전달
```

앱 context는 shell이 고른 현재 screen/view_session을 read_command에 전달한다. 짧은 요약은 turn 입력, detail은 별도 tool 결과다. agent 힌트는 선언된 target의 write_command에 expected_revision을 보내며 사람이 그 사이 코드를 바꾸면 conflict다. 오류를 숨겨 새 revision에 자동 재적용하지 않는다.

### 7.3 bundle 준비·test·preview

```text
[coding agent 통로/사람] app·commit·ticket_source?로 prepare_bundle
  → [supervisor] release worker spawn
  → [release worker] commit 추출·pin·제외/상한 검사
  → [추출/build 자식] 권한 없는 blueprint 추출 / 고정 UI build
  → [release worker] 봉인 bundle hash·manifest, blob 준비
  → [test 실행 contract] 동일 hash의 실제 app test와 Verification
  → [supervisor] release.prepare command (claim·scope 재확인)
  → [core] prepared Release·tests·출처 고정
```

완성 bundle부터 preview는 release 없이도 가능하다. `previews.start`는 별도 nonce·읽기 전용 bundle/fixture·disposable DB와 test-double adapter를 사용한다. automation clock·운영 secret·외부 쓰기·실제 문서 저장·다른 앱 조회·loopback listen은 없다. 실제 confirm handler와 approval 소비는 없고 대역 확인만 표시한다. preview가 없으면 운영 앱으로 대신 호출하지 않는다. release가 없을 때 inv를 만들지 않고 bundle 대상 Verification과 개발 진단으로 남긴다.

### 7.4 activation과 준비 전 실패 복원

```text
[confirmation window] release 비교·permission·schema·손실 가능성 확인
  → [플랫폼 어댑터] release.start_activation command
  → [core] approval·CAS 확인, 앱의 activating 하나 접수
  → [supervisor] 새 호출/clock close → 의도된 종료 표시 → 이전 자식 종료 확인
  → [data worker] 실제 schema 확인 → 필요하면 SQLite backup API·무결성 검사
  → [supervisor] release.record_backup command, 보호 참조 확정 기다림
  → [data worker] 연속 migration; 각 단계 데이터+schema 한 transaction
  → [supervisor] release.record_data_change command
  → [새 앱] 준비 모드 시작, hash·handler·schema·직접 연결 확인
  → [supervisor] release.complete_activation command
  → [core] 새 active + 이전 superseded + App active_release/name/description 원자적 변경
  → [supervisor] 확정 확인 후 accepting과 automation clock open
```

첫 성공은 run_enabled=true도 함께 확정한다. migration이 없으면 backup/변경 단계는 생략한다. 새 업무 open 전 실패는 새 자식부터 종료 확인한다. 변경이 있었으면 단독 data worker가 첫 변경 전 backup을 restore하고 무결성·schema를 확인하여 `release.record_data_restore` command로 보고한다. `release.fail_activation`은 이전 active 참조와 실패 근거를 유지한다. 복원 성공 뒤만 이전 앱을 다시 준비한다. 복원이 실패하거나 모르면 unavailable이다.

### 7.5 automation 회차

```text
[앱 clock] accepting 열린 단조 시계 기준으로 도래 확인
  → [앱] 같은 key 진행 여부·schema·고정 입력·effect·confirm 제한 검사
  → [supervisor broker] 전체 동시 4개 permit 즉시 판정 (없으면 skip)
  → [앱] 실제 inv 발급, machine/automation trigger로 같은 command handler
  → [앱] timeout 10분이면 취소 요청, 결과 모르면 unknown 근거
  → [앱] 실제 종료 후 permit 반환; 다음 회차 기준은 고정 배수 유지
  → [supervisor] read 포함 invocation start/finish 후행 command
```

진행 중·한도 초과·절전 누락은 회차를 queue에 넣지 않는다. timeout 뒤 실제 handler가 남았으면 같은 automation과 permit을 여전히 점유한다. 기록 실패로 업무나 지난 회차를 retry하지 않는다.

### 7.6 실행 멈춤·grant 회수·secret 교체

```text
[사람 / confirmation window] 실행 멈춤 또는 권한 변경 결정
  → [core] 실행 멈춤은 app.disable_execution command
  → [supervisor] 먼저 의도된 종료 분류, 새 command·secret 전송·clock close
  → [앱] 진행 호출 취소 요청, 10초 유예
  → [supervisor] 필요하면 강제 종료, OS 자식 종료 확인
  → [플랫폼 어댑터/core] grant.revoke 또는 secret contract의 변경·회수 확정
  → [supervisor] run_enabled와 archive 확인, 허용된 앱만 새 범위·nonce로 시작
  → [supervisor/core] app.record_stopped / record_started command로 실제 관측
```

grant.create도 기존 자식 종료 후 새 권한 경계로 적용한다. 종료 전에 회수 완료라고 표시하지 않는다. 사람 멈춤·archive는 재시작 backoff가 우회하지 않는다. 기존 업무 저장이나 이미 전송된 외부 요청을 취소했다고 표시하지 않는다.

## 8. 실패와 재시작

| 실패 지점 | 처리와 다시 확인할 근거 |
|---|---|
| 일반 direct 전송 단절 | 결과 모름. 업무 쓰기 자동 retry 없음. 앱이 제공한 업무 키·외부 확인 명령이 있으면 별도 read로 확인 |
| confirm accepted 뒤 단절 | 같은 접수 결과만 조회. marker/proof로 중복 handler 차단. 재시작한 자식에 옛 proof 재실행 금지 |
| 앱 예상 밖 종료 | 해당 socket을 닫고 알려진 inv만 unknown 전달. 실제 exit·signal·안전한 log로 문제 보고. 다른 앱은 유지 |
| ready 실패 | 30초 timeout 또는 hash·handler·schema·연결 불일치. 통로 닫고 자식 종료 확인. app.record_unavailable 또는 진행 activation 실패 |
| 반복 종료 | 1s·2s·4s부터 두 배, 최대 300s. 600s 안에 5회를 넘으면 자동 재시작 중지와 이유. run_enabled는 유지. idle 종료 없음 |
| 사람이 멈춤·archive | 새 호출과 clock부터 차단. 실제 종료까지 termination_pending=true. 사람의 다시 허용 전 재시작하지 않음 |
| core/supervisor 제어 EOF | 새 호출·automation 차단과 자식 종료. 새 supervisor는 이전 자식 신원과 종료부터 확인. PID 재사용을 생존 증거로 쓰지 않음 |
| invocation 전달 실패 | 기록 메시지만 bounded backoff. 전달기까지 죽어 잃은 것은 없음으로 표시. 가짜 invocation이나 성공 0회 생성 없음 |
| 준비/build/test 실패 | 현재 운영 release/DB 유지. staging은 취소·종료 뒤 정리하고 후보를 prepared로 확정하지 않음 |
| backup 확정 전 중단 | mutation 관문이 열리지 않았음. 앱 종료·실제 schema를 다시 확인하고 기존 참조 유지 |
| migration/새 준비 중단 | 이전 자식과 작업 자식 종료 확인 후 data worker로 DB schema·무결성·마지막 변경 결과 확인. 알려진 backup으로 새 업무 전 실패 복원. 모르는 script를 무조건 replay하지 않음 |
| complete_activation 응답 유실 | 같은 command key로 commit 결과를 확인. ledger active 참조가 새 release면 옛 backup 자동 복원 금지, 새 release를 다시 준비하거나 unavailable |
| 복원 실패/결과 미확인 | 데이터를 추가로 덮지 않고 backup과 실패 근거 유지. 이전 코드도 시작하지 않으며 문제 보고 |
| grant/credential 회수 중 종료 미확인 | 회수 진행 중. 넓은 옛 권한 프로세스 종료 확인 없이 새 자식·회수 완료 없음 |

daemon 종료·release 교체·재시작은 await나 shutdown 전 자식을 모두 의도된 종료로 분류한다. Ctrl-C가 process tree에 동시에 전달되어도 crash로 세지 않는다. 강제 종료 요청과 실제 OS 종료 확인은 다른 사실이며 확인 불가 상태에서 두 번째 DB writer를 만들지 않는다.

재시작 때 supervisor는 먼저 현재 apps/releases/grants와 진행 Activation을 `read`로 읽는다. event cursor는 후속 변화용이며 event replay를 업무 replay로 사용하지 않는다. core는 전체 source scan이나 hash 준비를 기다리지 않는다. 현재 active commit 이후 업무가 있었을 가능성을 배제할 수 없으면 옛 backup 복원 대신 현재 release의 schema·준비를 확인한다. ledger의 진행 invocation을 다시 실행 queue로 읽지 않는다.

구현 테스트는 panel/card container resize·동일 앱 여러 view session·민감 context 제거·stale 주석 CAS·앱 쌍 방향/범위·caller 위조·A→B→A 거절·source/target 교체·agent 허락과 역할 교집합·되돌림 receipt 충돌을 포함한다. 기존 구현 테스트는 각 activation 단계에서 child/core/supervisor 종료, 끝 통보가 시작보다 먼저 도착, confirm 동시 재전송, 옛 connection, grant 회수 중 무응답, 메모리 전달 상한, stdout 무한 줄, 85% RSS 지속·표본 누락, 절전 후 clock, 준비/build 중 다른 앱 direct 응답을 포함한다. 성공 test는 준비와 경계를 확인할 뿐 problem 닫힘은 `problems/closing`의 근거로만 판단한다.

## 9. 이전과 달라진 것

- 이전: daemon이 action·query·GUI를 중계 / 지금: caller가 app socket으로 직접 호출 / 이유: source scan·ledger 지연을 앱 응답 경로에서 뺀다.
- 이전: 앱별 host journal·lease·실행 허가 단계·여러 token 종류 / 지금: 단일 ledger, 공유 supervisor, 현재 자식 nonce와 살아 있는 제어 연결 / 이유: 개인 컴퓨터에서 앱별 권위 저장소를 만들지 않는다.
- 이전: 개발 tree 복사와 설치 registry 직접 읽기 / 지금: 정확한 commit·전체 SDK·화면을 불변 bundle에 고정 / 이유: test한 byte와 오래 쓸 byte를 같게 한다.
- 이전: activation active 참조를 바꾼 뒤 새 프로세스 시작 / 지금: 종료→backup→변경→시작 준비→active commit→open / 이유: 시작할 수 없는 release가 현재 판이 되지 않게 한다.
- 이전: fs.write가 read를 포함하고 wildcard/port 0과 방향이 섞인 net flag 허용 / 지금: 좁은 교집합과 별도 방향 강제, 표현 못 하면 거절 / 이유: permission 요청보다 넓은 실행 접근을 주지 않는다.
- 이전: 앱 소유 secret 무승인 CRUD와 원값 반환 / 지금: 사람이 관리하는 전역 secret, 이름별 grant, 플랫폼 인증 전송 / 이유: agent·앱 코드·기록에 운영 secret을 열지 않는다.
- 이전: action/read-model/job 구현과 cron·event·catch-up·retry / 지금: 같은 command handler, 앱 안 on_start·interval clock, skip과 retry 0 / 이유: 실제 첫 판 요구보다 큰 automation 언어를 복원하지 않는다.
- 이전: health·degraded·suspended로 problem과 실행 상태 혼합 / 지금: 현재 연결의 preparing/stopped/running/unavailable와 열린 problem 별도 / 이유: 관측 없는 정상과 잘못된 자동 정지를 만들지 않는다.
- 이전: 모든 관측을 응답 조건으로 삼거나 앱별 영구 journal / 지금: 후행 bounded 메모리 전달과 손실 표시, confirm accepted만 선행 / 이유: 관측 실패를 업무 retry나 지연으로 바꾸지 않는다.
- 이전: personal SDK 승격·자동 전파와 옛 공개 version 재사용 / 지금: 설치 제공 exact 1.0.0부터 불변 공개, 변경은 새 version과 새 release / 이유: 과거 byte를 새 계약으로 덮지 않으며 없는 workflow를 두지 않는다.
