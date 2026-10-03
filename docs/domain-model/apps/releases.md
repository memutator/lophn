---
type: domain-model
concerns: [apps/releases]
---
# apps/releases

Release의 불변 묶음, 준비 근거와 activation 상태를 정의한다.

## Release (`rel`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `rel` ID | 아니오 | PK | release ID |
| `app` | `app` ID | 아니오 | → apps/registration | 소속 앱 |
| `number` | 양의 정수 | 아니오 | `(app,number)` unique; 앱 안 증가 | 표시 번호 |
| `code_commit` | 문자열 | 아니오 | 완전한 git object ID; 고정 commit 존재 | source 기준 |
| `bundle_hash` | sha256 | 아니오 | → platform/blob-store; 준비한 실제 byte | 실행 묶음 |
| `blueprint_hash` | sha256 | 아니오 | → apps/blueprint; bundle 안 정규 Blueprint JSON과 동일 | 고정 blueprint |
| `data_schema` | 0 이상 정수 | 아니오 | → apps/data | 사용하는 앱 DB schema |
| `data_changes` | DataChange[] | 아니오 | → apps/data; 빈 목록 허용 | 앞으로 가는 migration |
| `tests` | `vrf` ID[] | 아니오 | 비어 있지 않음; 중복 금지; 같은 bundle의 통과한 app test; release_tests에서 조회 시 조립 | → problems/tests |
| `ticket_source` | TicketSource | 예 | 새 coding 준비는 필수; null은 과거 이력만; 준비 확정 시 현재 claim 검사 | 준비 출처 |
| `created_by` | actor | 아니오 | → platform/identity | 준비 요청 주체 |
| `created_at` | UTC 시각 | 아니오 | → platform/ledger | 준비 확정 시각 |
| `status` | `prepared` / `activating` / `active` / `failed` / `superseded` | 아니오 | 아래 전이만 | activation 상태 |
| `activation` | Activation | 예 | activating·failed에는 필수; 마지막 시도 projection | 현재/마지막 activation |
| `failure` | `{code:string,summary:string}` | 예 | failed에 필수; redaction; 큰 내용은 invocation 참조 | 실패 근거 요약 |

### 상태

| 상태 | 뜻 |
|---|---|
| `prepared` | 묶음과 통과한 app test를 고정함 |
| `activating` | activation 진행 중 |
| `active` | 앱이 채택한 release; 프로세스 생존과 무관 |
| `failed` | 마지막 activation 실패 |
| `superseded` | 다른 release가 채택됨 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `prepared` | machine | 신뢰된 준비 결과·같은 hash app test 통과; 새 coding 준비는 ticket_source 필수·현재 claim 검사 | `ReleasePrepared` |
| `prepared` / `superseded` / `failed` | `activating` | machine | 정확한 approval·grant·현재 release·schema 비교; 앱에 다른 activation 없음 | `ReleaseActivationStarted` |
| `activating` | `active` | machine | 필요한 migration과 준비 확인 완료; 같은 transaction에서 App.active_release 변경 | `ReleaseActivated` |
| `active` | `superseded` | machine | 다른 release activation 성공과 같은 transaction | `ReleaseSuperseded` |
| `activating` | `failed` | machine | 실제 activation 실패; 이전 활성 참조 유지 | `ReleaseActivationFailed` |

### 불변 조건

- 코드·bundle·blueprint·SDK·test 참조·ticket 출처는 준비 후 불변이다. 코드 수정은 새 release다.
- 앱마다 active와 activating은 각각 많아야 하나다. activating 동안 다른 activation·grant 변경은 금지한다.
- 준비는 정확한 commit으로 하며 uncommitted 파일을 넣지 않는다. 화면 build는 준비 프로세스에서 하고 운영 프로세스에서 하지 않는다.
- 테스트는 release 없이 bundle hash로 가능하다. test runner만 실제 결과를 쓴다(→ problems/tests).
- 긴 준비의 확정 때에도 현재 claim의 connection·seq·기한을 다시 검사한다. 새 coding 준비에서 ticket_source 누락을 거절한다. 과거 ticket_source=null은 이력으로만 보존하고 가짜 출처를 채우지 않는다.
- approval 거절은 activation 실패가 아니다. failed 묶음의 외부 조건만 고친 재시도에는 새 결정이 필요하다.
- active 참조 변경·이전 release 대체·App 이름/설명 갱신은 같은 transaction이다. 첫 성공에서 run_enabled를 true로 한다. 업무 통로는 commit 뒤에만 연다(→ apps/runtime).
- 이전 release도 새 activation이다. 현재 schema와 같은 판만 바로 허용한다. 운영 후 옛 backup 자동 복원과 agent run revert의 대상이 아니다.

## TicketSource (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `ticket` | `tkt` ID | 아니오 | → coding-agent/tickets; 같은 앱 | 준비 근거 |
| `claim_seq` | 양의 정수 | 아니오 | 해당 TicketClaimed의 event seq; 준비 시 현재 claim | claim 출처; claim 상태의 사본 아님 |

## Activation (값)

독립 ID는 없다. 시도는 ReleaseActivationStarted의 seq로 구분한다. 이전 시도는 event·invocation으로 남는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `started_seq` | 양의 정수 | 아니오 | 시작 event seq; 결과 제출 CAS | 시도 식별 |
| `previous_release` | `rel` ID | 예 | 첫 activation은 없음; 같은 앱 | 이전 채택 참조 |
| `approval` | `apr` ID | 아니오 | → platform/approvals; 정확한 대상 release | 사람 결정 |
| `expected_grants_seq` | 0 이상 정수 | 아니오 | 해당 앱의 grant 집합 변경 seq | 권한 CAS |
| `expected_schema` | 0 이상 정수 | 아니오 | 실제 앱 DB 확인값 → apps/data | 시작 schema |
| `backup_hash` | sha256 | 예 | 보호된 blob; migration 전 필수 → apps/data | 변경 전 backup |
| `data_change_invocation` | `inv` ID | 예 | → apps/invocations; 같은 시도·앱 | 실제 migration |

## BundleManifest (값)

bundle 안의 manifest이며 release에 별도 mutable 표로 복제하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `entrypoint` | 상대 경로 | 아니오 | manifest files 안; `..`·절대 경로 금지 | 앱 진입 코드 |
| `files` | `{path:string,hash:sha256}[]` | 아니오 | path unique; 실제 내용과 일치 | 코드·화면·blueprint·migration·전체 의존 |
| `sdk_dependencies` | SDKDependency[] | 아니오 | → apps/blueprint; 공개 SDK hash와 일치 | 고정 SDK |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Release | 소속 | → apps/registration | 1 | 삭제 거절 |
| Release | test 근거 | → problems/tests | 1..N | 참조 유지; 삭제 거절 |
| Release | 준비 출처 | → coding-agent/tickets | 0..1 | claim 해제·취소로 옛 출처를 지우지 않음 |
| Activation | 사람 결정 | → platform/approvals | 1 | 참조 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `releases` | Release, activation·failure JSON; blueprint는 hash | PK `id` | `(app,id)`, `(app,number)`; partial unique app WHERE status='active'; partial unique app WHERE status='activating' | `(app,created_at,id)`, `(app,status)`, `(ticket_source.ticket,ticket_source.claim_seq)` | app → apps; previous_release → releases; approval → platform/approvals; backup_hash → blob; data_change_invocation → invocations |
| `release_tests` | tests 관계 | PK `(release,verification)` | 동일 PK | `(verification,release)` | release → releases; verification → problems/tests |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `release.prepare` | machine | 신뢰된 준비 결과,app,commit,bundle_hash,blueprint_hash,data_schema,data_changes,tests,ticket_source,key | App source; 같은 bundle test; 현재 claim; 요청 connection scope | `ReleasePrepared` | `forbidden`, `invalid_input`, `conflict`, `unavailable` |
| `release.start_activation` | machine | release,approval,expected previous release,grants seq,schema,key | 현재 활성 참조·grant 집합·approval; 앱 activation lock | `ReleaseActivationStarted` | `forbidden`, `conflict`, `invalid_input` |
| `release.complete_activation` | machine | release,started_seq,실제 schema·준비 확인 | 같은 시도·이전 활성 참조·grant seq; 데이터 결과 | `ReleaseActivated`, `ReleaseSuperseded` | `conflict`, `unavailable` |
| `release.fail_activation` | machine | release,started_seq,failure | 같은 진행 시도 | `ReleaseActivationFailed` | `conflict`, `invalid_input` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ReleasePrepared` | Release | 고정 필드·test ID·ticket_source | coding-agent/tickets, shell/confirmation-window |
| `ReleaseActivationStarted` | Release | Activation의 시작 필드 | apps/runtime, apps/data |
| `ReleaseActivated` | Release | started_seq,previous_release,data_schema | apps/runtime, problems/closing, coding-agent/tickets |
| `ReleaseSuperseded` | 이전 Release | 채택한 release ID,started_seq | apps/runtime |
| `ReleaseActivationFailed` | Release | started_seq,failure,invocation? | problems/reporting, platform/notifications |

## 정책

- **bundle 제외.** git 관리 파일·개발 credential·agent 설정은 bundle에 넣지 않는다. 의존의 범위·latest·변경 가능한 원격 import는 거절한다.
- **준비 상한.** core 밖 준비 worker는 source 64MiB·완성 bundle 256MiB·10000파일·전체 300000ms 기본 상한을 적용한다. 상한 초과·취소·worker 종료의 부분 결과는 release.prepare 입력으로 확정하지 않는다. test result는 완성된 동일 bundle hash에 연결한 불변 참조이며 테스트 뒤 bundle byte에 넣지 않는다.
- **notification.** 이 concern의 notification 계기는 ReleaseActivationFailed만이며 항상 생성 대상이다(→ platform/notifications).

## 정할 것

- 새 release의 activation은 사람이 한 번 눌러 고른다. coding agent가 준비해도 정확한 대상 release에 대한 사람 approval 없이는 활성화하지 않는다.
- 다른 schema의 이전 release에 시험한 호환 범위를 허용할지 정한다. 현재는 같은 schema만 바로 허용한다.
- 선언 삭제·완화와 machine 생성 파일 변경의 경고/거절 검사 위치·대상을 problems/problem-codes, problems/tests와 맞춘다. 삭제는 problem 닫힘 증거가 아니다.
