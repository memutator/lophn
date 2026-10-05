---
type: plan
concerns: [platform]
---
# platform 계획

platform 팀의 작업 전부다. 근거는 `docs/intent/platform.md`, `docs/requirements/platform/`, `docs/domain-model/platform/`, `docs/architecture/platform.md`, platform을 지나는 flow다. 작업 모양은 [tasks.md](../dev/tasks.md), slice 순서는 [README.md](README.md)를 따른다.

skeleton의 core 쪽(ledger, command, read, event, API, identity, supervisor, core entry)이 다른 팀 전부의 선행이다. 그래서 skeleton 작업을 작게 나누고, T1·T5·T7은 contracts 선행만 끝나면 함께 시작한다.

## 코드 자리

code-map의 platform 줄을 따른다. architecture 2.2의 모듈 이름(`commands`, `reads`, `events`, `supervisor`)은 code-map에 줄이 없으므로 이렇게 둔다(→ 질문 Q1).

| 일 | 자리 |
|---|---|
| SQLite 실행기, writer·reader Worker, command·read 처리, event 배포, 반응 cursor | packages/platform/ledger/ |
| schema step 적용, backup, restore | packages/platform/backup-and-migration/ |
| HTTP·WebSocket 입구, route registry | packages/platform/api/ |
| 입장 한도, platform I/O 작업 scheduler, 신뢰 child 감독 | packages/platform/responsiveness/ |
| 신뢰 child 권한 정책, data 직렬화, child 메모리 상한 adapter | packages/platform/security/ |
| core 조립, data root, 시작·종료, 팀 등록 registry | apps/core/ (조립과 registry), packages/platform/install-and-update/ (규칙) |
| worker kind registry | apps/worker/ (entry와 kind 목록) |
| platform I/O worker | apps/worker/platform/ (kind `platform/io`) |

## 내놓는 contract

contracts 팀에 보냈고 모든 항목의 contracts 작업 id를 받았다.

| 이름 | 무엇 | 처음 쓰는 slice | contracts 작업 |
|---|---|---|---|
| base | ErrorCode 7종과 HTTP 상태, Result, Clock, IdSource(접두사 목록), RFC 8785 canonical JSON, sha256, seq 십진 문자열, 안전 log interface | skeleton | contracts#T3, T4 |
| 등록 interface | CommandDefinition, ReadDefinition, EventDefinition, SchemaStep, Tx(자기 표 SQL, emit, now, newId, 반응 cursor 갱신), read snapshot | skeleton | contracts#T6(`tx.call`, `tx.port` 포함) |
| transport | `POST /v1/<resource>/<method>`, route kind, 오류 body, command 요청·응답, read 응답 공통 필드, idempotency key 한도 | skeleton | contracts#T5 |
| event 구독 | EventEnvelope, `/v1/events/list`, WS frame과 close code, AdvanceSubscriberCursor | skeleton | contracts#T7 |
| 인증 값 | Actor, CredentialScope, CredentialConditions, AuthenticatedContext | skeleton | contracts#T6 |
| supervisor pipe | stdin·stdout 길이 prefix binary frame codec, 신뢰 child의 hello·ready·stop·stopped·diagnostic·byte chunk 메시지, kind launch spec, Electron main↔core 메시지 | skeleton | contracts#T6 |
| platform client | `createPlatformClient` | skeleton | contracts#T5 |
| platform route(skeleton) | platform/status(ledger_id 포함), platform/health, identity/current, commands/result, events/list, events/advance-cursor | skeleton | contracts#T6 |
| blob | PreparedBlob, BlobReadResult, blob field 정의(보존 종류), Tx의 blob 참조 등록, `blob.prepare` 통로, `/v1/blobs/read` | documents | contracts#T11 |
| redaction | RedactionInput·RedactionResult·Omission, entry가 끼워 주는 Redactor interface | documents | contracts#T12 |
| notification | Notification, 계기 source event 표, notifications route | agent | contracts#T22 |
| secret | secrets route, SecretPreparation, 전송 부착·갱신 결과 저장 interface | agent | contracts#T23 |
| approval | ApprovalAction·ApprovalEffect·ApprovalUse, binding hash 규칙, approvals route, Tx의 approval 사용 | agent | contracts#T22 |
| confirmation handle | main↔core 비공개 연결의 handle 발급·사용 메시지 | documents | contracts#T13 |
| settings | SettingDefinition 등록 interface, EffectiveSetting, settings route | agent | contracts#T24 |
| QuestionActionEvidence | machine이 user 변경으로 기록하는 근거(값은 lophn-agent 소유, platform은 검증) | agent | contracts#T28 |
| data 직렬화 | 자료를 data로 감싸는 interface와 TrustClass | agent | contracts#T12 |
| file·worker 전달 route | 인증·한도 뒤 감독 중인 worker kind로 넘기는 route kind(`file`은 바이트 응답, `defineFile`·`defineWorker`) | documents | contracts#T5 |
| workspace route | CurrentViewState의 publish·bind·unpublish·read(core 메모리, route kind `memory`) | agent | contracts#T25 |
| backups·diagnostics route | backups/list·get, diagnostics/list·check | operations | contracts#T45 |

## 쓰는 다른 팀 contract

| 팀 | 무엇 | 쓰는 작업 |
|---|---|---|
| lophn-agent | run·assignment 유효성 read, question option action read, handoff 계보 판정, QuestionCreated·AssignmentPaused event, run 복구 command | T24, T22, T29, T43 |
| coding-agent | connection digest·회수 상태 read, connection 생성 command(digest 제출), TicketConfirmed·TicketCheckFailed event, harness 설정 검증 | T34, T35, T36 |
| apps | 현재 grant read, invocations의 confirm 접수, ReleaseActivationFailed event, 앱 실행 credential 조건, invocation·release activation 복구 command, grant 위험 read, SDK hash | T31, T32, T33, T43, T47 |
| problems | ProblemOpened·ProblemReopened·ProblemClosed(운영 보고 여부), snapshot 수집 입력 | T37, T39 |
| documents | ContextWatchedItemChanged event, blob 준비 호출, 복원 뒤 derived 초기화 | T53, T13, T42 |
| shell | confirmation window(handle 사용), Electron main의 core 시작과 종료·`--tray`·`--quit`, notification 표시, 패키징, 현재 보기 publish | T9, T56, T22, T46, T48, T55, T57 |

---

## skeleton

### T1 ledger 실행기와 공통 표

- 등급: 기본
- concern: platform/ledger, platform/backup-and-migration
- 요구: platform/ledger#R1, R2, R7, R8, R9, R10, R22, R23, platform/backup-and-migration#R1, R4, R6
- 자리: packages/platform/ledger/, packages/platform/backup-and-migration/
- 쓰는 contract: base, 등록 interface(Tx, SchemaStep, EventDefinition)
- 내놓는 contract: 없음
- slice: skeleton
- 선행: contracts#T1, contracts#T3, contracts#T4, contracts#T6
- 상태: 완료 (#29)
- 완료: 아래 확인이 통과한다
  - `node:sqlite` 연결이 `journal_mode=WAL`의 실제 반환을 확인하고 `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`을 건다. WAL이 아니면 쓰기 전에 기동을 거절한다(R2).
  - `events`, `command_results`, `subscriber_cursors`, `schema_migrations` 표와 UPDATE·DELETE 금지 trigger가 있다(R10, R22).
  - Tx가 `BEGIN IMMEDIATE` 하나에서 event seq를 전역 단조로 배정하고, ID는 IdSource, 시각은 Clock에서 받는다(R8, R9). 중첩 transaction과 자체 commit은 거절한다.
  - schema step 목록을 정수 순번·sha256 내용 hash·완료 시각의 불변 이력으로 적용하고, 단계마다 변환과 이력을 한 transaction으로 확정한다. 실패한 단계는 전부 rollback한다(b&m R1, R4).
  - 지원보다 높은 schema, 다른 내용 hash, `integrity_check` 실패면 정상 시작을 거절하고 원본을 건드리지 않는다(b&m R6).
  - `ledger_test.ts`, `migrations_test.ts`에 위 요구 테스트(임시 파일 SQLite)

### T2 command 처리: writer Worker, idempotency, CAS

- 등급: 기본
- concern: platform/ledger
- 요구: platform/ledger#R3, R4, R5, R6, R12, R13, R20
- 자리: packages/platform/ledger/
- 쓰는 contract: base, 등록 interface, transport(command 요청·응답)
- 내놓는 contract: 없음
- slice: skeleton
- 선행: platform#T1, contracts#T5
- 상태: 완료 (#49)
- 완료: 아래 확인이 통과한다
  - writer는 Deno Worker 하나 안의 유일한 쓰기 연결이다. API 쪽과 작은 메시지로 주고받는다.
  - 처리 순서: fingerprint(RFC 8785, token·handle 원문 제외)를 transaction 전에 계산 → `BEGIN IMMEDIATE` → 현재 자격 재검사 hook → `(principal,key)` 조회 → 같은 fingerprint면 저장 결과를 `replayed:true`로 → 다르면 `conflict` → 등록 handler(동기, Tx만) → event·결과 저장 → commit → event 배포에 wake-up 힌트(R3, R5, R13).
  - CAS 하나라도 다르면 전체 `conflict`다. handler 전에 parse된 compare의 leaf 수를 중첩 object·배열까지 재귀로 세어 256개 초과면 `invalid_input`이고 handler를 부르지 않는다. 변경 행은 `Tx.sql`·`emit`·`advanceSubscriberCursor`의 SQL마다 앞뒤 연결 `total_changes()`의 실제 차이(event·cursor 행, RETURNING·trigger 포함)를 transaction 안에서 누적하고 1,000개 초과면 전체 rollback한다. `Tx.sql.get`·`all`이 행을 바꾸면 거절하고 rollback한다. handler가 이 거절을 삼켜도 commit하지 않는다(R12, → Q19).
  - disk·I/O 오류·5,000ms 잠금 초과는 `unavailable`이고 입력을 소비하거나 메모리로 대신하지 않는다(R6).
  - handler는 `await`·파일·socket을 쓸 수 없다(동기 함수 타입과 테스트, R4). 등록되지 않은 command 이름·SQL·경로를 받지 않는다(R20).
  - `AdvanceSubscriberCursor`(감소 불가)와 `commands/result` read handler(자기 principal만)
  - `commands_test.ts`에 R3–R6, R12, R13, R20 테스트(테스트 전용 command 정의로)

### T58 command port를 같은 transaction의 factory로 묶기

- 등급: 좁은
- concern: platform/ledger
- 요구: platform/ledger#R3, R4, R12, R13
- 자리: packages/platform/ledger/
- 쓰는 contract: 등록 interface(Tx.port)
- 내놓는 contract: 없음
- slice: skeleton
- 선행: platform#T2
- 상태: 완료 (#58)
- 완료: 아래 확인이 통과한다
  - owner port는 `defineTxPort(key, (tx) => 구현)`으로 등록한다. factory는 `BEGIN IMMEDIATE`와 현재 자격 확인 뒤 그 command의 guarded `Tx`를 받는다. 같은 Tx·같은 key는 한 번만 만들고 cache하며 다음 command는 새 구현이다.
  - malformed 등록·중복 key는 handler 전에 `internal`로 거절한다. factory가 없거나, 자기 key나 순환을 다시 보거나, throw·Promise·thenable·반환값/throw 값의 then 검사 실패를 내면 `internal`이고 handler가 삼켜도 commit하지 않는다. SQL side effect가 있으면 전체 rollback이다(R3, R12).
  - factory 반환 객체·함수는 감싸거나 복사하지 않는다. frozen·class·배열·순환은 원본 그대로다. 효과는 붙잡힌 guarded Tx의 sql·emit·now·newId·port가 seal 뒤에 거절하는 것으로 막는다. 순수 값이나 Tx 밖 side effect를 가둔다고 하지 않는다. 변경 행 한도는 port가 쓰는 같은 guarded `Tx.sql`에 누적한다(R4, R12).
  - read snapshot의 정적 port map은 그대로다. 실제 writer Worker fixture도 이 등록을 쓴다.
  - `tx-ports_test.ts`, `tx-ports-failure_test.ts`에 R3, R4, R12, R13 테스트

### T60 확정 ledger key의 REPLACE·UPSERT 우회 차단

- 상태: 완료 (#62)
- 등급: 좁은
- concern: platform/ledger, platform/backup-and-migration
- 요구: platform/ledger#R2, R10, platform/backup-and-migration#R1, R4, R5, R6
- 자리: packages/platform/ledger/sqlite.ts, packages/platform/ledger/schema.ts, packages/platform/ledger/ledger_test.ts, packages/platform/ledger/sqlite-storage_test.ts, packages/platform/ledger/immutable_test.ts, packages/platform/backup-and-migration/migrations.ts, packages/platform/backup-and-migration/migrations_test.ts
- 쓰는 contract: 등록 interface(SchemaStep)
- 내놓는 contract: 없음
- slice: skeleton
- 선행: platform#T58
- 완료: 아래 확인이 통과한다
  - 연결은 기존 WAL·FULL·외래 키·5초 대기와 함께 `recursive_triggers=ON`의 실제 값 1을 확인하고 적용되지 않으면 `unavailable`로 기동을 거절한다. handler의 PRAGMA 거절은 유지한다(R2).
  - `common-tables` SQL과 hash는 바꾸지 않고 `immutable-insert-guards` step으로 events seq·command 결과의 principal/key·schema 이력 version의 duplicate INSERT를 거절한다. migration bootstrap도 같은 이력 guard를 설치한다(R10, b&m R1).
  - 새 DB와 common-tables만 적용한 DB upgrade에서 원래 SQL·hash·이력·event·결과가 보존되고 각 표의 INSERT OR REPLACE·REPLACE INTO·UPSERT(동일 내용 포함)는 실패한다. native recursive trigger OFF에서도 duplicate guard가 작동하고 configured 연결의 UPDATE·DELETE도 실패한다(R10, b&m R5).
  - 다른 principal의 같은 key·새 key·새 migration version은 정상이며 malicious migration의 history REPLACE와 domain 쓰기는 함께 rollback된다. 기존 history/hash를 먼저 검증하는 흐름을 유지한다(b&m R1, R4, R6).
  - `ledger_test.ts`, `sqlite-storage_test.ts`, `immutable_test.ts`, `migrations_test.ts`의 실제 파일 SQLite·WAL 회귀 테스트가 통과하고 각 파일은 400줄 이하다.

### T59 다른 팀의 public ledger integration test harness

- 상태: 완료 (#65)
- 등급: 기본
- concern: platform/ledger
- 요구: platform/ledger#R1, R2, R3, R4, R10, R13, R14, R20, R21, R22
- 자리: apps/core/testing/, tools/check-deps.ts, tools/check-deps_test.ts
- 쓰는 contract: 등록 interface, AuthenticatedContext, Tx, ReadSnapshot
- 내놓는 contract: 없음(테스트 전용 public entry)
- slice: skeleton
- 선행: platform#T58, platform#T60
- 완료: 아래 확인이 통과한다
  - 다른 팀 `*_test.ts`는 `apps/core/testing/ledger.ts` 하나로 static URL registration을 넘긴다. fixture URL은 caller의 `import.meta.url` 기준이고 함수와 PortKey identity는 각 Worker 안에서 다시 조립한다.
  - harness가 임시 directory와 실제 파일 SQLite/WAL을 소유한다. writer Worker 하나는 migration 뒤 실제 serveWriter/executor를 쓰며 reader Worker 둘은 readOnly/query_only 연결과 실제 executeRead를 쓴다.
  - 다섯 actor의 지정 scope/conditions를 현재 테스트 credential map으로 제어한다. set/revoke는 모든 Worker ack 뒤 다음 호출을 열고 command와 read는 현재 principal/actor/ref binding·만료·run 조건을 다시 검사한다. startup과 set의 credential snapshot을 첫 await 전에 고정하고 current targets의 own key restriction을 보존한다. read의 명시 run과 current bound run을 구별한다.
  - Tx-local port factory와 guarded Tx/current context를 받는 blob callback, extra test-only lifecycle command를 지원한다. handler·이전 callback의 context mutation은 blob callback의 current snapshot을 바꾸지 못하며 callback의 blob_refs·domain·event·결과는 같은 transaction에서 rollback된다. 제품 credential 발급·core/API entry·T14 blob prepare/read·Tx.call dispatch·event visibility/replay는 만들지 않는다.
  - inspect는 실제 read-only snapshot을 읽고 idle writer와 직렬된 write probe는 성공/실패 모두 rollback한다. 테스트 SQL control은 제품 WriterRequest에 추가하지 않는다.
  - 중복 command name/read key/schema id/route와 singleton registration은 안전하게 기동 실패한다. 유한 pending cap·ready/request timeout, structured clone/Worker/partial startup 실패와 idempotent close의 Worker·파일 cleanup을 검증한다.
  - 최소 public 사용 예제, file/WAL·atomic rollback·현재 credential·read metadata·per-Tx port identity·immutable REPLACE probe 회귀와 testing 내부 import 허용/제품 외부 import 거절 회귀가 통과한다.

### T3 read 처리: reader Worker와 snapshot

- 등급: 기본
- concern: platform/ledger
- 요구: platform/ledger#R14
- 자리: packages/platform/ledger/
- 쓰는 contract: 등록 interface(ReadDefinition, snapshot), transport(read 응답 공통 필드)
- 내놓는 contract: 없음
- slice: skeleton
- 선행: platform#T1
- 상태: 완료 (#40)
- 정정: 완료 (#45). reader output과 error body는 shared `output.ts`로 raw JSON 안전성을 schema strip·metadata 덮어쓰기 전에 검사한다. function·symbol·undefined·bigint·cycle·비plain object·NaN·Infinity·negative zero는 `internal`로 거절하고 JSON extra key strip은 허용한다. schema 뒤 최종 JSON을 다시 schema로 검사해 값 불변을 확인하며, handler 직후 snapshot 종료와 실제 reader Worker의 다음 read를 보존한다.
- 완료: 아래 확인이 통과한다
  - reader Worker 2개가 각자 `readOnly` 연결과 `PRAGMA query_only=ON`을 쓴다. writer queue와 다른 queue다.
  - 응답 하나가 짧은 read transaction 하나이고, 자료와 `as_of_seq`를 같은 snapshot에서 얻는다.
  - 최대 500행·1MiB, 넘으면 page 또는 명시 한도 오류. 2초를 넘는 reader는 새 입장을 닫고 unhealthy로 표시한다.
  - writer가 긴 transaction 중이어도 read가 기다리지 않는다는 테스트
  - `reads_test.ts`에 R14 테스트

### T4 event 배포, 구독, 반응 cursor

- 상태: 완료 (#68)
- 등급: 기본
- concern: platform/ledger, platform/api
- 요구: platform/ledger#R15, R16, R17, R18, platform/api#R5, R7
- 자리: packages/platform/ledger/
- 쓰는 contract: event 구독, 등록 interface(Tx의 반응 cursor 갱신)
- 내놓는 contract: 없음
- slice: skeleton
- 선행: platform#T2, platform#T3, contracts#T7
- 완료: 아래 확인이 통과한다
  - 배포기는 commit 힌트를 받아 reader에서 커밋된 event를 읽는다. 힌트를 잃어도 seq 조회로 따라잡는다.
  - `/v1/events/list`(`seq > after_seq`)와 WS session 처리(`from_seq` 포함, `types`·`subjects` 필터, 숨긴 event도 `scanned_through_seq`에 포함, `head_seq`)가 같은 재생 뜻을 가진다(api R5).
  - batch 256개·256KiB, 연결 buffer 1MiB를 넘는 느린 연결은 `unavailable` frame 뒤 1013으로 닫는다. 회수된 자격은 1008(R16).
  - 이름 있는 구독의 ack는 자기 principal·이름에 묶여 `H/derived/api-subscriptions/`에 위치와 출처(DerivedProvenance)를 같은 로컬 transaction으로 저장한다. 후퇴·미관측 ack는 거절한다. 지워도 ledger는 그대로다(api R7, ledger R17, R18).
  - 등록 subscriber의 반응 cursor는 domain command와 같은 transaction에서 Tx로 올리고, idempotency 기준은 `(subscriber, cause_seq, reaction)`이다(R15).
  - cursor CAS read와 갱신 SQL 전에 BEGIN 뒤 current credential의 full context로 owner를 검사한다. handler·이전 gate의 context mutation은 다음 검사에 반영하지 않는다. gate가 없거나 거절·malformed·Promise·thenable·getter/proxy inspection 실패·throw이면 sticky rollback이고, handler가 그 거절을 삼켜도 event·domain 변경·command 결과를 commit하지 않는다. owner 원문 오류는 숨기며 actor·run만 있는 transaction은 cursor를 올리지 못한다.
  - `events_test.ts`, `subscribe_test.ts`, `reaction_test.ts`, `subscriber-guard_test.ts`, `ledger-infrastructure_test.ts`에 위 요구 테스트와 실제 writer Worker 회귀

### T5 identity: credential 발급·검증·회수

- 등급: 기본
- concern: platform/identity
- 요구: platform/identity#R1, R2, R3, R4, R6, R7, R10
- 자리: packages/platform/identity/
- 쓰는 contract: 인증 값, base
- 내놓는 contract: 없음
- slice: skeleton
- 선행: contracts#T3, contracts#T6
- 상태: 완료 (#26)
- 완료: 아래 확인이 통과한다
  - token은 주입한 무작위 source의 32 bytes base64url, 검증은 sha256 digest의 32-byte constant-time 비교다. digest를 Bearer로 받지 않는다.
  - architecture/platform 5.6 표의 `coding_agent` 줄과 마지막 절 "connection 생성은 보호 화면의 exact scope 결정"을 coding-agent/connection#R2·D19에 맞춰 고친다. 사람의 harness 연결·범위 선택이 허락이고 확인 창은 없으며, 회수만 confirmation window다(→ Q16).
  - core epoch마다의 메모리 registry: user(hello에 한 번), machine(task·대상·결과 command 고정) 발급과 active→revoked/ended. ended·revoked는 되살리지 않는다(R2, R7).
  - actor는 credential에서만 정한다. 본문·header·환경 변수의 actor 주장을 무시한다(R1). actor별 상한 ∩ 현재 조건(R3).
  - token 원문이 오류·log·event·결과에 나오지 않는다(R6). credential을 renderer·앱 코드에 넘기는 경로가 없다(R4).
  - 앱 범위 credential의 다른 앱 대상은 `not_found`, 없는 자격 `unauthorized`, 금지 동작 `forbidden`(R10)
  - AuthenticatedContext는 token이 아닌 불투명 `credential_ref`와 기한(있으면)을 함께 준다. apps의 앱 연결 진술이 이것으로 원래 자격에 묶인다(apps 요청).
  - coding_agent·agent·app actor는 소유 팀 contract가 생길 때 resolver를 더한다(T24, T31, T34). 지금은 만들지 않는다.
  - `identity_test.ts`에 위 요구 테스트

### T6 API 입구: HTTP·WebSocket transport와 인증 검사

- 상태: 완료 (#78)
- 등급: 기본
- concern: platform/api, platform/identity, platform/security, platform/diagnostics
- 요구: platform/api#R1, R2, R3, R4, R6, platform/identity#R11, R12, R13, platform/security#R6, R7, R8, platform/diagnostics#R7
- 자리: packages/platform/api/
- 쓰는 contract: transport, event 구독, 인증 값
- 내놓는 contract: 없음
- slice: skeleton
- 선행: platform#T2, platform#T3, platform#T4, platform#T5
- 완료: 아래 확인이 통과한다
  - `127.0.0.1`과 `::1`에만 bind한다(기본 7431, 테스트는 주입 port). 원격 bind 설정이 없다(security R6, R7).
  - route registry는 `resource/method → kind, schema, handler, actor 상한, 한도`를 정적 등록한다. 정확히 3구간, POST만, 미등록·대소문자 차이·`/v2`는 추정하지 않고 거절한다(api R2, R6).
  - 검사 순서 Host(실제 port의 `127.0.0.1:P`, `localhost:P`, `[::1]:P`) → Origin(있으면 403) → Bearer → 동작 자격. health·status·WS도 같다(identity R11–R13).
  - header 8KiB, Content-Length 사전 검사, chunked 누적 상한, body 5초, JSON 256KiB·깊이 16·항목 4,096을 body 읽기 전·중에 검사한다(security R8).
  - 성공은 결과 객체 그대로 200, 실패는 `{error:{code,message,details?}}`와 400/401/403/404/409/503/500. handler 오류의 stack·원문·token을 지운다(api R1, R3, R4).
  - WS upgrade(`GET /v1/events/subscribe`, subprotocol `lophn.events.1`)를 T4의 session에 넘긴다.
  - 무인증 실패·Origin 거부는 제한된 안전 log로만 남고 ledger event를 만들지 않는다(diagnostics R7).
  - `server_test.ts`, `auth_test.ts`에 위 요구 테스트

### T7 supervisor: 신뢰 child 감독과 pipe

- 상태: 완료 (#55)
- 등급: 기본
- concern: platform/responsiveness, platform/security, platform/backup-and-migration
- 요구: platform/security#R1, R2, R3, platform/backup-and-migration#R17
- 자리: packages/platform/responsiveness/, packages/platform/security/
- 쓰는 contract: supervisor pipe
- 내놓는 contract: supervisor pipe의 child 쪽 helper(entry가 조립)
- slice: skeleton
- 선행: contracts#T6
- 완료: 아래 확인이 통과한다
  - 감독 통로는 부모가 만든 child의 stdin(부모→자식)·stdout(자식→부모) pipe 위의 길이 prefix binary frame이다(JSON 제어 frame과 byte chunk frame, codec은 contracts#T6). child entry는 console 출력을 stderr로 돌리고 helper는 전역 console을 바꾸지 않는다. frame이 아닌 stdout 바이트는 protocol 위반으로 그 child를 멈춘다. stderr는 제어·성공 근거로 쓰지 않는다(→ Q2). argv에 credential이 없다. architecture 2.4의 해당 문장을 같은 PR에서 고친다.
  - Electron main↔core도 같은 frame을 쓴다. shell main의 diagnostic도 이 통로로 보낸다.
  - child는 `deno run --cached-only --frozen --no-prompt`와 kind별로 좁힌 `--allow-read/--allow-write/--allow-net`만 받는다. `--allow-all`·전체 환경은 없다. 권한 표는 TrustClass와 architecture 2.4 표를 따른다(security R1–R3).
  - hello(core epoch, process identity, task, scope 상한, credential) → ready 10초 → stop 5초 뒤 실제 handle 강제 종료. 실패 재기동은 1·2·4초 뒤 최대 3회, 그 뒤 그 구성 요소만 사용 불가.
  - 부모 pipe EOF면 child가 새 작업과 credential 사용을 멈추고 종료한다. Linux는 process group으로 자식까지 정리한다. PID 파일만 보고 죽이지 않는다.
  - 재기동은 task 재실행이 아니다. 미확인 작업을 자동 반복하지 않는다(b&m R17).
  - kind마다 launch spec(고정 entry, 좁힌 `--allow-read/write/net`, 특정 실행 파일만의 `--allow-run`, 이름을 정한 `--allow-env`)과 상시·요청 시 정책을 받는다. spec은 각 팀의 core 모듈 파일이 선언하고 supervisor가 금지 flag를 거절한다. spec이 바뀌면(등록 host, skill root, MCP 실행 파일, 앱 socket 폴더) 그 child만 정상 정지 뒤 다시 띄운다(problems·lophn-agent 요청, → Q8).
  - `supervisor_test.ts`에 위 요구 테스트(fixture child script)

### T8 platform I/O worker와 안전 log

- 상태: 완료 (#59)
- 등급: 기본
- concern: platform/responsiveness, platform/diagnostics, platform/redaction
- 요구: platform/responsiveness#R4, platform/diagnostics#R2, R3, R11, R12, platform/redaction#R15
- 자리: apps/worker/platform/, packages/platform/responsiveness/, packages/platform/diagnostics/
- 쓰는 contract: supervisor pipe, base(log)
- 내놓는 contract: supervisor pipe의 diagnostic 메시지(신뢰 child가 안전 진단을 보내는 길, problems 요청)
- slice: skeleton
- 선행: platform#T7
- 완료: 아래 확인이 통과한다
  - `apps/worker/main.ts`는 kind로 고르는 entry와 kind 목록(registry)이다. 각 팀은 `apps/worker/<팀>/`만 고친다(lead 결정, Q4). 이 작업은 `apps/worker/platform/`의 `platform/io`만 만든다. kind 이름은 supervisor contract의 고정 목록과 같다.
  - 무거운 작업 동시 2개, 대기 32개, principal당 4개, principal 사이 round-robin(responsiveness R4)
  - core와 신뢰 child의 log·diagnostic 메시지를 I/O worker가 `H/logs/`에 비동기로 쓴다. info 기본, 파일당 10MiB×5, 메모리 대기 1MiB, 넘치면 버리고 개수만 센다. log가 막혀도 API가 기다리지 않는다(diagnostics R2, R3, R11, R12).
  - 기록에는 구성 요소·시각·종류·안전 위치·설명만 있고 stdout·stderr·HTTP dump·crash 메모리·credential을 남기지 않는다(redaction R15).
  - 진단 종류는 contract의 고정 목록이다(`lophn_internal`, 출처 불명 관측, 잘못된 보고, apps 전달 손실 등 소유 팀이 contracts 팀에 올린 것).
  - `scheduler_test.ts`, `log_test.ts`에 위 요구 테스트

### T9 core entry: data root, 시작·종료, status·health

- 상태: 완료 (#111)
- 등급: 기본
- concern: platform/install-and-update, platform/ledger, platform/diagnostics
- 요구: platform/install-and-update#R7, R9, R10, R12, platform/ledger#R21, platform/diagnostics#R8
- 자리: apps/core/, packages/platform/install-and-update/, packages/platform/diagnostics/
- 쓰는 contract: supervisor pipe(Electron main→core hello), platform route(skeleton)
- 내놓는 contract: platform client(실제 동작 확인), 통합 테스트용 core harness `apps/core/testing/`(→ Q3), `H/run` 위치 metadata(→ T55)
- slice: skeleton
- 선행: platform#T6, platform#T7, platform#T8
- 완료: 아래 확인이 통과한다
  - `LOPHN_HOME` 또는 `~/.lophn`을 소유자·symlink 확인한 정규 경로 하나로 고정하고 H·`H/run`·`H/apps`가 0700보다 넓으면 기동을 거절한다(R7, R9).
  - registry: 최상위 팀마다 `apps/core/<팀>.ts` 한 파일이 자기 command·read·event·schema step·dispatchable command·port·worker kind launch spec을 등록하고, `apps/core/main.ts`는 그 목록만 부른다. 팀은 자기 등록 파일만 고친다(lead 결정, Q4).
  - 시작 인자: data root는 `LOPHN_HOME`(없으면 `~/.lophn`), port는 `--port=<n>`(기본 7431, 0이면 빈 port). 실제 port와 core epoch는 부모에게 감독 frame으로 알린다. contracts#T9의 `deno task dev`·`dev:core`가 이것으로 띄운다.
  - `H/run/`의 OS instance lock으로 같은 H에 두 번째 core·writer를 열지 않는다(R10).
  - 시작: lock → ledger 열기·schema step → writer·reader → event 배포 → API → I/O worker 감독. Electron main의 IPC hello에 user token을 한 번 준다. 창 닫기가 아니라 main의 명시 종료나 pipe EOF가 core 종료를 시작한다(R12).
  - 종료: 새 command 입장 닫기 → 입장한 command 확정·실패 → child 정지 → 연결 닫기 → lock 해제(ledger R21)
  - `/v1/platform/status`(준비·schema·data root·`ledger_id`·구성 요소)와 `/v1/platform/health`(HealthObservation, 관측 시각)는 인증을 요구한다(diagnostics R8).
  - `apps/core/testing/`: 다른 팀 통합 테스트가 메모리 SQLite·임시 H로 core를 띄우고 자기 모듈을 등록하는 harness. 다섯 actor 어느 것이든 지정 scope·conditions의 테스트 credential을 만들 수 있다(coding_agent 발급 T34 전에도 MCP·CLI 테스트가 붙는다). 테스트 전용이고 `apps/core/main.ts`에는 이 입구가 없다. 다른 팀 `*_test.ts`는 이 폴더만 import한다(lead 결정).
  - 시작 때 `H/run/`에 인증 없는 위치 metadata(port, core epoch, 시작 시각; credential 없음)를 쓰고 정상 종료 때 지운다.
  - Node 부모가 실제 core 프로세스를 띄워 hello → command → read → event list → WS 구독까지 도는 통합 테스트(skeleton의 core 쪽)
  - `core_test.ts`에 위 요구 테스트

### T10 core import 정적 검사

- 상태: 완료 (#126)
- 등급: 좁은
- concern: platform/responsiveness
- 요구: platform/responsiveness#R1
- 자리: packages/platform/responsiveness/
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: skeleton
- 선행: platform#T9
- 완료: 아래 확인이 통과한다
  - `apps/core`의 module graph(`deno info --json`)에서 `node:sqlite`는 ledger 실행기만, 동기 파일 API·압축·외부 fetch·앱/format/model 구현 import는 어디에도 없음을 확인하는 테스트(`deno test`로 check에 들어간다)
  - `core_imports_test.ts`에 R1 테스트

## documents

### T11 입장 한도와 scope 재검사

- 등급: 기본
- concern: platform/responsiveness, platform/identity
- 요구: platform/responsiveness#R3, platform/identity#R8
- 자리: packages/platform/responsiveness/, packages/platform/api/, packages/platform/ledger/
- 쓰는 contract: transport, 인증 값
- 내놓는 contract: 없음
- slice: documents
- 선행: platform#T9
- 상태: 완료 (#138)
- 완료: 아래 확인이 통과한다
  - command 입장 전체 256·principal당 64·제어용 16 예약·시작 대기 5초, read 실행 2·대기 64·principal당 8, HTTP 동시 128·principal당 16, event 연결 32·principal당 4. 초과는 `unavailable`이고 caller의 priority 주장을 받지 않는다(R3).
  - 회수·정지 제어는 예약 영역으로 들어간다는 테스트
  - event list·구독과 platform read가 제목·존재·개수·관계를 scope로 먼저 제한한다. 범위 안 자료만으로 summary를 만들 수 없으면 전체를 뺀다(identity R8).
  - `admission_test.ts`, `scope_test.ts`에 위 요구 테스트

### T12 file·worker 전달 route

- 등급: 기본
- concern: platform/api, platform/responsiveness
- 요구: platform/api#R2, R3, platform/responsiveness#R1
- 자리: packages/platform/api/, packages/platform/responsiveness/
- 쓰는 contract: transport, supervisor pipe
- 내놓는 contract: transport(route kind `file`의 바이트 응답, `worker` 전달 kind → Q9)
- slice: documents
- 선행: platform#T9, contracts#T5(`defineFile`·`defineWorker`)
- 완료: 아래 확인이 통과한다
  - `file` route(documents의 원본 파일 읽기)는 ledger queue를 거치지 않고 인증·한도·schema 뒤 등록된 worker kind로 비동기 pipe 요청을 보내고, 바이트와 Content-Type을 그대로 돌려준다(api R3).
  - `worker` route(problems의 report·request-test 등)는 같은 길로 JSON 결과·공통 오류를 그대로 돌려준다.
  - core는 바이트를 해석·저장하지 않고 응답 크기 상한과 timeout을 route마다 등록값으로 둔다. worker가 없거나 ready가 아니면 `unavailable`이다.
  - `forward_test.ts`에 위 요구 테스트
- 상태: 완료 (#137)

### T13 blob 준비와 설치

- 등급: 기본
- concern: platform/blob-store
- 요구: platform/blob-store#R1, R2, R3, R12
- 자리: packages/platform/blob-store/, apps/worker/platform/
- 쓰는 contract: blob, supervisor pipe
- 내놓는 contract: blob(`blob.prepare` 통로, PreparedBlob)
- slice: documents
- 선행: platform#T8, platform#T9, contracts#T11
- 완료: 아래 확인이 통과한다
  - I/O worker가 같은 파일 시스템의 `H/blobs/tmp/`에 streaming으로 쓰며 sha256·크기를 계산하고 fsync → 0400 → 원자적 rename → directory sync 뒤에만 성공한다(R2, R3).
  - 같은 hash는 덮어쓰지 않고 기존 파일을 검증해 재사용한다(R1). 최대 1GiB, chunk 1MiB, 예상 hash·크기 불일치는 `invalid_input`.
  - 준비 참조는 principal·purpose·hash·크기와 10분 수명으로 core 메모리에 등록된다. core는 파일을 다시 hash하지 않는다.
  - 실제 디스크 여유가 부족하면 새 준비를 `unavailable`로 막고 참조 blob을 지우지 않는다(R12).
  - 문서 worker 같은 신뢰 child는 감독 pipe의 byte chunk frame으로 보내고, core는 해석·hash 없이 backpressure를 지키며 I/O worker로 넘긴다(→ Q6).
  - `prepare_test.ts`에 위 요구 테스트
- 상태: 완료 (#133)

### T14 blob 참조 등록과 읽기

- 상태: 완료 (#150) — 후속 완료 (#175): 256KiB 읽기 창이 감독 control frame 한도를 넘지 않는다
- 등급: 기본
- concern: platform/blob-store, platform/identity
- 요구: platform/blob-store#R4, R5, R6, R7, platform/identity#R9
- 자리: packages/platform/blob-store/
- 쓰는 contract: blob, 등록 interface
- 내놓는 contract: blob(Tx의 blob 참조 등록, blob field 정의와 보존 종류, `/v1/blobs/read`, BlobReadResult)
- slice: documents
- 선행: platform#T13
- 완료: 아래 확인이 통과한다
  - Tx가 준비 참조의 주체·purpose·수명을 확인하고 `blob_refs`를 소유 변경과 같은 transaction에 등록한다(R4).
  - 소유 concern이 blob field를 등록할 때 보존 종류(영구 또는 용량 상한 종류)와 일반 읽기 허용 여부를 함께 적는다. 보호 backup처럼 일반 읽기를 막은 field는 `/v1/blobs/read`로 어떤 actor도 읽지 못한다(problems·apps 요청, 실제 정리는 T44).
  - `/v1/blobs/read`는 hash가 아니라 허용 owner·고정 판·field에서 시작하고 매 조각마다 scope를 다시 검사한다. hash를 안다고 읽을 수 없다(R5, identity R9).
  - 참조된 blob이 없거나 hash가 다르면 `unavailable`, 빈 내용을 돌려주지 않는다(R6).
  - 부분 읽기는 전체 크기·실제 구간·잘림을 함께 돌려준다. JSON 구간 최대 256KiB(R7).
  - `refs_test.ts`, `read_test.ts`에 위 요구 테스트
- 후속(#175): 256KiB 읽기 창을 실제 I/O worker로 읽으면 worker 응답의 base64가 감독 control frame 한도(256KiB)를 넘어 세션이 닫히고 읽기가 `corrupt`로 끝났다. fake `bytes.read`는 이 경로를 지나지 않아 잡지 못했다. `blob.read`의 바이트를 JSON control frame 대신 요청 channel의 byte chunk frame으로 돌려 두 한도를 함께 지킨다(architecture 5.5).

### T15 redaction 규칙 엔진

- 상태: 완료 (#71)
- 등급: 기본
- concern: platform/redaction
- 요구: platform/redaction#R1, R2, R3, R4, R5, R6, R14, R16, R17
- 자리: packages/platform/redaction/
- 쓰는 contract: redaction
- 내놓는 contract: redaction(Redactor interface, RedactionInput·RedactionResult·Omission)
- slice: documents
- 선행: platform#T8, contracts#T12
- 완료: 아래 확인이 통과한다
  - 알려진 값 registry: 보호 메모리에 원문 전체를 두고 긴 값부터 정확히 검사한다. 길이·개수로 빼지 않는다(R1).
  - 고정 gitleaks prefix·PEM 규칙 묶음의 content hash를 입력·출력이 함께 쓴다. OpenAI·Anthropic·GitHub·AWS·Slack key, JWT·PEM fixture(R2).
  - Authorization·Cookie, URL 인증, JSON의 secret·token·password·credential 값을 중첩 구조·오류까지 지운다(R3). 대체는 `*` 하나(R6).
  - audience가 세션 입력·질문 답이면 secret 발견 때 전체 제출을 막고 보호 입력 안내만 돌려준다(R4).
  - stream은 알려진 값의 최장 길이만큼 보류 구간을 두고 검사한 prefix만 내보낸다(R5).
  - 1MiB·깊이 16·4,096 항목·5초를 넘거나 불확실하면 원문 없이 Omission만(R14). 저장 때 redaction한 자료도 반환 전 현재 규칙으로 다시 검사한다(R16). 삭제·차단 감사에 값·hash·일부를 남기지 않는다(R17).
  - `rules_test.ts`, `stream_test.ts`에 위 요구 테스트

### T16 redaction 안전 필드, 표본, 화면 shape

- 상태: 완료 (#81)
- 등급: 기본
- concern: platform/redaction
- 요구: platform/redaction#R7, R8, R9, R10, R11, R12
- 자리: packages/platform/redaction/
- 쓰는 contract: redaction
- 내놓는 contract: redaction(안전 필드·private 필드·표본 경로 선언)
- slice: documents
- 선행: platform#T15
- 완료: 아래 확인이 통과한다
  - 결과에 가린 값의 type·길이·점 개수를 드러내는 필드가 없다(R7).
  - 소유 concern이 선언한 안전 필드만 남기고 미선언 값·이름·연락처·이메일·경로를 뺀다(R8). 필드명 변경을 익명화로 보지 않고 가명 비교 범위를 명시한다(R9).
  - 표본은 명시 경로만 secret 처리 뒤 최대 64자·전체 2KiB, ID형 문자열은 표본 안 가명(R10). 단독·중간 wildcard 경로 선언은 거절(R11).
  - 화면 문자열 80자 초과는 안전 shape, private 필드는 길이와 무관하게 통째로 뺀다. 짧은 이메일도 예외가 아니다(R12).
  - `fields_test.ts`, `samples_test.ts`에 위 요구 테스트

### T56 confirmation handle 발급·검증·소비

- 등급: 기본
- concern: platform/approvals, platform/identity
- 요구: platform/approvals#R3, R4, R5
- 자리: packages/platform/identity/, packages/platform/ledger/
- 쓰는 contract: confirmation handle, supervisor pipe(main↔core)
- 내놓는 contract: confirmation handle(main↔core 발급·사용 메시지, command 요청의 `confirmation`)
- slice: documents
- 선행: platform#T2, platform#T9, contracts#T13
- 상태: 완료 (#117)
- 완료: 아래 확인이 통과한다
  - handle은 main↔core 비공개 통로에서만 발급되는 메모리 값이고 core epoch·main 연결·window·정확한 대상·내용 기준·허용 결정·120초에 묶인다. ledger·fingerprint·event·log에 원문이 없다.
  - 사람 클릭이 필요한 command(documents의 파일 지우기, approval 결정 등)는 등록 때 handle 필요를 선언하고, writer가 transaction 안에서 현재 상태와 함께 검증·소비한다. handle이 없거나 대상·내용이 다르면 거절한다(R3, R5).
  - 창 닫기·main/core 재시작은 handle을 무효로 한다. commit 실패면 살아 있는 handle의 예약만 풀고 만료·종료 handle은 되살리지 않는다. commit 뒤 응답 유실의 같은 key는 저장 결과를 먼저 돌려준다. 침묵·창 닫기는 결정이 아니다(R4).
  - handle이 필요한 `file`·`worker` route(documents의 `files.delete` 등)는 ledger를 쓰지 않으므로, core의 handle registry가 대상(예: canonical 경로·base_hash·동작)과 맞는지 확인하고 메모리에서 원자적으로 소비한 뒤에만 worker로 넘긴다. 소비 실패·만료·불일치면 넘기지 않는다. 넘긴 뒤 worker가 `conflict`를 내도 handle은 소비된 채이고 사람이 다시 확인한다. 결과 기록은 소유 concern의 뒤 command(documents의 `file.record_result`)가 맡는다. 소비만 하는 빈 writer transaction은 만들지 않는다(ledger#R22).
  - `confirmation_test.ts`에 위 요구 테스트, flow organize-documents의 파일 지우기 단계 통합 테스트(shell#T22와 함께)

## agent

### T17 notification 반응 처리기와 생성·읽음

- 상태: 완료 (#177)
- 등급: 기본
- concern: platform/notifications
- 요구: platform/notifications#R1, R2, R3, R4, R5, R6, R7, R8, R11
- 자리: packages/platform/notifications/
- 쓰는 contract: notification, event 구독, 등록 interface
- 내놓는 contract: notification(Notification, 계기 표, notifications get·list·create·read route)
- slice: agent
- 선행: platform#T4, platform#T14, platform#T15, contracts#T22
- 완료: 아래 확인이 통과한다
  - core의 독립 비동기 루프가 `notifications` cursor부터 event batch를 읽는다. 계기 있으면 `create_notification`(source 재검사, notification·`NotificationCreated`·cursor를 한 transaction), 없으면 cursor만 올린다(R1, R2).
  - 계기 표와 처리기를 만들고, 각 source는 그 event contract가 생기는 작업에서 켠다: T29(approval·question·assignment), T53(context watch), T33(release activation), T36(ticket), T39(문제).
  - `source_seq UNIQUE`로 같은 사실은 최대 1개, 재시작·재전달로 늘지 않는다(R4).
  - 제목·대상·변화·사람 행동·결과 열기 경로는 source 사실에서 만들고 redaction을 거친다. 본문·대화·업무 상태를 복사하지 않는다(R3).
  - `mark_notification_read`는 처음 `read_at`과 `NotificationRead`를 한 번, 반복은 unchanged. 읽음은 재시작 뒤에도 남는다(R5).
  - 읽음·클릭이 승인·답·닫힘을 만들지 않고 새 run·닫힌 세션 재개를 만들지 않는다(R6, R7). 전달 실패로 버리지 않고 model call을 쓰지 않는다(R8). 발생 순서대로 모두 다시 읽을 수 있다(R11).
  - `notifications_test.ts`에 위 요구 테스트
  - flow answer-question·resume-agent-session의 notification 단계 통합 테스트
  - open-issues의 platform/notifications#Q4는 lead 결정 (b)로 해소했다: compare `{processed_through_seq}`를 유지하고 contracts의 `createNotificationInputSchema`에 `subscriber: z.literal("notifications")`를 둔다. 낡은 cursor 위치의 생성은 conflict다.

### T18 Tx 안에서 다른 owner의 등록 command 부르기

- 상태: 완료 (#83)
- 등급: 기본
- concern: platform/ledger
- 요구: platform/ledger#R3, R12, R13
- 자리: packages/platform/ledger/
- 쓰는 contract: 등록 interface
- 내놓는 contract: 등록 interface(Tx의 등록 command dispatch)
- slice: agent
- 선행: platform#T2, contracts#T6(`tx.call`)
- 완료: 아래 확인이 통과한다
  - command handler가 Tx로 다른 concern의 등록 command(예: lophn-agent FinishToolCall → documents save_version, WaitRun → `create_approval_request`, question option 적용 → 소유 command)를 같은 transaction에서 부른다. 불린 command는 원래 AuthenticatedContext로 자기 actor 상한·schema·CAS를 다시 검사한다.
  - event는 같은 transaction의 seq로 차례대로 남고 command 결과는 바깥 command 하나만 저장된다. 어느 하나라도 실패하면 전체 rollback이다.
  - 부른 쪽이 상대 표를 직접 읽거나 쓰는 길이 없다. 등록되지 않은 이름, 자기 자신을 다시 부르는 순환, 깊이 4 초과는 거절한다.
  - `dispatch_test.ts`에 위 요구 테스트(두 테스트 concern으로)

### T19 secret 참조와 OS keychain adapter

- 상태: 완료 (#85)
- 등급: 최상위
- concern: platform/secrets
- 요구: platform/secrets#R1, R2, R4, R6, R7, R8
- 자리: packages/platform/secrets/, apps/worker/platform/
- 쓰는 contract: secret, supervisor pipe
- 내놓는 contract: secret(`/v1/secrets/list·set·remove·cleanup`, SecretPreparation, `secret.prepare` 통로)
- slice: agent
- 선행: platform#T8, platform#T15, contracts#T23
- 완료: 아래 확인이 통과한다
  - I/O worker의 OS adapter가 Linux Secret Service에 값을 둔다. 값은 argv·환경 변수·파일에 가지 않는다(→ Q7). macOS·Windows adapter는 T49.
  - 보호 입력은 전용 pipe 작업 `secret.prepare`로만 받는다. 세션 메시지·agent·외부 MCP 경로가 없다(R2).
  - `SetSecret`·`RemoveSecret`은 이전 `sealed_ref`·revision CAS를 통과할 때만 바꾸고 실패하면 이전 참조를 유지한다. ledger·event·설정에는 이름과 참조만(R1, R6).
  - `secrets/list`는 허용 이름·설정 여부만, 권한 없는 이름과 없는 이름은 같은 거절(R4).
  - 교체·제거 뒤 `reference_blocked`, `os_deleted`, `processes_ended`를 각각 실제 관측으로 보여 준다(R7).
  - keychain 없음·잠김은 secret 기능만 `unavailable`, 파일 볼트·환경 변수 fallback 없음. 테스트는 fake adapter와 실제 Linux adapter 둘 다(R8)
  - 새 값은 redaction 알려진 값 registry에 등록된다.
  - `secrets_test.ts`에 위 요구 테스트

### T20 secret 전송 부착과 갱신 결과 저장

- 상태: 완료 (#96)
- 등급: 기본
- concern: platform/secrets, platform/security
- 요구: platform/secrets#R3, R5, R11, platform/security#R9
- 자리: packages/platform/secrets/
- 쓰는 contract: secret, lophn-agent의 provider adapter 경계
- 내놓는 contract: secret(전송 부착 interface, 갱신 결과 저장 interface)
- slice: agent
- 선행: platform#T19
- 완료: 아래 확인이 통과한다
  - 신뢰 provider adapter·외부 MCP transport가 자기 machine credential로 참조·revision·목적지·용도를 보내면 core가 scope·process 생존·허용을 확인하고 I/O 보호 adapter가 값을 전송 callback 메모리에만 넘긴다(R5).
  - redirect마다 목적지를 다시 검사하고 다른 host에 인증을 넘기지 않는다(security R9).
  - 갱신 결과는 keychain에 먼저 준비하고 값 없는 SecretPreparation과 CAS로 소유 concern command에 제출한다. 실패하면 이전 참조와 고아 정리(R11).
  - agent가 받을 수 있는 것은 이름·사용처·이유뿐이고 원문 붙여 넣기를 요구하는 경로가 없다(R3).
  - `attach_test.ts`에 위 요구 테스트, flow connect-provider의 secret 단계 통합 테스트

### T21 approval request 생성·조회·만료·취소

- 등급: 기본
- concern: platform/approvals
- 요구: platform/approvals#R1, R2, R6, R12, R13, R14, R17
- 자리: packages/platform/approvals/
- 상태: 완료 (#166)
- 쓰는 contract: approval, blob, redaction
- 내놓는 contract: approval(ApprovalAction·ApprovalEffect, binding hash, approvals get·list·create·expire·cancel route)
- slice: agent
- 선행: platform#T14, platform#T15, contracts#T22
- 완료: 아래 확인이 통과한다
  - `create_approval_request`는 요청자·역할·tool·MCP, 정확한 대상, redaction한 미리보기, 이유, 변경 범위, 외부 전송·수신처, 되돌림을 빠짐없이 요구한다. 수리면 보존 데이터·검증 기준도(R1, R2).
  - 요청자·동작·영향·설명·기한은 생성 뒤 바뀌지 않고 끝난 결정은 다시 열리지 않는다(R6).
  - 기본 기한 없음. 지정 기한이면 machine 타이머가 `expire_approval_request`를 내고 그 뒤 결정·사용을 거절한다(R12).
  - 사람·원래 요청자·machine(원래 일 종료) 취소(R13). 거절 이유는 redaction 뒤 요청 역할에 그대로, 다른 대기는 유지(R14).
  - get·list read는 판단할 동작·대상·이유·변경·외부 전송·보존·되돌릴 수 없는 영향을 요약하되 R1·R2 항목을 빠뜨리지 않는다(R17).
  - `requests_test.ts`에 위 요구 테스트

### T22 approval 허락·거절

- 등급: 기본
- concern: platform/approvals
- 요구: platform/approvals#R3, R4, R5, R15, R16
- 자리: packages/platform/approvals/
- 쓰는 contract: confirmation handle, lophn-agent의 handoff 계보 판정
- 내놓는 contract: approval(grant·reject route)
- slice: agent
- 선행: platform#T21, platform#T56, contracts#T26(`runs/read`의 original_message·handoff sender_run로 계보 판정), lophn-agent#T10, lophn-agent#T32
- 완료: 아래 확인이 통과한다
  - `grant_approval_request`·`reject_approval_request`는 T56의 handle을 writer transaction에서 현재 request 상태·내용·기한과 함께 검증·소비하고 결정을 저장한다. handle 없이는 user token으로도 안 된다. 앱·agent·MCP는 자기 요청을 허락하지 못한다(R3). 기본 선택·침묵·창 닫기·읽음·질문 답은 결정이 아니다(R4).
  - 대상·입력·비교 기준·assignment·tool이 바뀌면 거절하고 새 request가 필요하다(R5).
  - 거절·만료·취소는 미실행 종료이고 사람 결정으로 구별된다(R15). 같은 run과 handoff 계보에서 거절된 같은 동작·대상·입력은 다시 묻지 않는다(R16).
  - `decisions_test.ts`에 위 요구 테스트, flow approve-action 통합 테스트(shell#T22·T29의 confirmation window와 함께)

### T23 approval 적용과 한 번 사용

- 등급: 기본
- concern: platform/approvals
- 요구: platform/approvals#R7, R9, R10, R11
- 자리: packages/platform/approvals/
- 쓰는 contract: approval, 등록 interface
- 내놓는 contract: approval(`/v1/approvals/apply`, Tx의 approval 사용)
- slice: agent
- 선행: platform#T22, platform#T18, contracts#T22(`Tx.useApproval`)
- 완료: 아래 확인이 통과한다
  - `apply_approved_action`은 현재 권한·원래 run·대상·CAS·정확 action → `approval_uses` INSERT → 소유 command 접수·변경·event → 결과를 한 transaction에 확정한다. approval만 먼저 소비하는 공개 command가 없다(R7, R11).
  - 중복 전달·동시 사용·실패·unknown 뒤 재호출은 같은 receipt를 돌려주고 새 동작을 만들지 않는다(R7).
  - 허락 저장과 적용 성공을 구별해 보여 준다(R9). 고정 범위 밖 동작·범위 확대를 허락하지 않는다(R10).
  - `apply_test.ts`에 위 요구 테스트

### T24 agent credential, run 연결, QuestionActionEvidence

- 등급: 기본
- concern: platform/identity, platform/ledger
- 요구: platform/ledger#R11, platform/identity#R14
- 자리: packages/platform/identity/, packages/platform/ledger/
- 쓰는 contract: 인증 값, QuestionActionEvidence, lophn-agent의 run·assignment 유효성 read와 question option action read
- 내놓는 contract: agent credential 발급(agent runtime 경계)
- slice: agent
- 선행: platform#T9, contracts#T28(QuestionActionEvidence), contracts#T26(`runs/read`), lophn-agent의 question contract
- 상태: 완료 (#130)
- 완료: 아래 확인이 통과한다
  - 유효 assignment·run 시작에서 agent runtime에 `agent:<asg>` credential을 주고 run 종료·멈춤·감독 상실에 끝낸다. agent runtime 자체는 machine credential을 받는다.
  - agent scope에는 lophn-agent가 계산한 AgentAppScope(contracts/lophn-agent 타입)가 실리고 AuthenticatedContext로 apps 연결 검사에 전달된다. platform은 그 내용을 해석하지 않고 상한을 넓히지 못하게만 한다(lophn-agent 요청). identity domain model의 CredentialScope를 같은 PR에서 고친다.
  - command의 run은 자격에 묶인 run만이고 끝난 run의 늦은 제출은 감사 보완만 받는다(ledger R11).
  - QuestionActionEvidence는 정본 질문의 실제 고른 option·고정 action과 제출 동작 전체·CAS가 같고 되돌릴 수 있는 동작일 때만 user로 한 번 기록한다. 자유 답·일반 machine의 user 주장은 거절(identity R14).
  - `agent_credential_test.ts`, `question_evidence_test.ts`에 위 요구 테스트

### T25 settings registry, 병합, 검증

- 등급: 기본
- concern: platform/settings
- 요구: platform/settings#R1, R2, R4, R5, R6, R8, R9, R10, R11, R12, R13, R14, R15, R16
- 자리: packages/platform/settings/
- 쓰는 contract: settings, 등록 interface
- 내놓는 contract: settings(SettingDefinition 등록 interface, EffectiveSetting, settings definitions·get route)
- slice: agent
- 선행: platform#T9, contracts#T24
- 상태: 완료 (#122)
- 완료: 아래 확인이 통과한다
  - 각 concern이 공개한 항목만 받는다. 설명·종류·기본값·허용값·단위·층·적용 시점이 없으면 등록 거절(R1, R4).
  - `builtin < common` 두 층만, object 항목별·scalar/array 전체 교체, 생략과 null·빈 목록·false 구별(R5, R8, R9). 작업 폴더·세션·환경 변수·CLI 인자는 층이 아니다(R6).
  - 선택 원본은 ledger 하나, 적용값은 메모리. 항목마다 적용값·정한 층·위아래 선택·판을 읽는다(R2, R10).
  - 층별 문법·항목·타입·범위 → 병합 뒤 필수·관계·대상(소유 concern 검증) 순서. 모르는 항목·틀린 타입은 거절, 변환·오타 수정 없음(R11–R13). 오류는 항목·층·기대·고칠 방법만, secret·문서 전체 없음(R14).
  - secret 원문을 거절하고 보호 참조만 받는다(R15). 어떤 층도 권한·안전 금지·credential 결정·subagent 없음 규칙을 풀지 못한다(R16).
  - `registry_test.ts`, `merge_test.ts`에 위 요구 테스트

### T26 settings apply, reload, 이력

- 상태: 완료 (#131)
- 등급: 기본
- concern: platform/settings
- 요구: platform/settings#R7, R17, R18, R19, R20, R21, R22, R23, R24, R25
- 자리: packages/platform/settings/
- 쓰는 contract: settings, event 구독
- 내놓는 contract: settings(apply·reload·history route, SettingsChanged·SettingsReloaded event)
- slice: agent
- 선행: platform#T25
- 완료: 아래 확인이 통과한다
  - `ApplySettings`는 사람의 명시 apply만, 시작 판 CAS, 모든 영향 concern 적용값까지 검증한 뒤 전부 저장 또는 전부 거절(R17–R19).
  - 이력은 주체·시각·항목·전후·영향 concern·새 판. 같은 내용 다시 읽기는 새 판이 아니다(R20).
  - `ReloadSettings`는 저장 선택과 내장 기본값을 처음부터 병합해 통째로 교체, 실패면 마지막 성공 판 유지(R21, R22).
  - 유효 선택도 마지막 성공값도 없으면 agent 작업만 막는다(R23).
  - 결과는 즉시 효력·다음 run 효력을 구별하고 바뀌지 않은 provider·extension을 재연결하지 않는다(R24, R25). judgment·organizing 기본값은 새 preset 후보일 뿐 기존 preset을 바꾸지 않는다(R7).
  - `apply_test.ts`, `reload_test.ts`에 위 요구 테스트, flow connect-provider의 설정 단계 통합 테스트

### T27 settings TOML 교환, 설명, lophn 제안

- 등급: 기본
- concern: platform/settings
- 요구: platform/settings#R3, R26, R27, R28, R29, R30
- 자리: packages/platform/settings/, apps/worker/platform/
- 쓰는 contract: settings, QuestionActionEvidence
- 내놓는 contract: settings(TOML import·export pipe 작업)
- slice: agent
- 선행: platform#T26, platform#T24
- 상태: 진행 (#153) — 남은 것: R29(machine이 질문 고정 option action 근거를 검증한 apply는 ApplySettings route actors에 machine이 필요해 contract 변경이 먼저다)와 flow ask-lophn-help 설정 단계 통합 테스트
- 완료: 아래 확인이 통과한다
  - UTF-8 TOML 1.0 format 1만 worker에서 parse·redaction·전체 검증 뒤 `ApplySettings`로 제출한다. JSON5·YAML·환경 치환·include·command·원격 URL은 거절, 모르는 format은 거절(R3, R26).
  - definitions read는 이름·한 줄 설명·현재·기본값의 뜻·영향·위험·되돌림·적용 시점을 주고 설명 없는 항목은 공개하지 않는다(R27, R28).
  - lophn 역할의 제안은 질문의 고정 option action → QuestionActionEvidence → `ApplySettings`로만 적용한다(R29).
  - read 결과가 기본 정보와 펼칠 정보(층·판·format)를 나눠 준다(R30, 화면은 shell).
  - `toml_test.ts`, `definitions_test.ts`에 위 요구 테스트, flow ask-lophn-help의 설정 단계 통합 테스트

### T28 data 직렬화와 출처 유지

- 상태: 완료 (#124)

- 등급: 기본
- concern: platform/security
- 요구: platform/security#R10, R11
- 자리: packages/platform/security/
- 쓰는 contract: data 직렬화
- 내놓는 contract: data 직렬화(agent runtime·coding repair context가 entry로 받아 쓰는 interface, TrustClass)
- slice: agent
- 선행: platform#T9, contracts#T12(data 직렬화·TrustClass)
- 완료: 아래 확인이 통과한다
  - 문서·제목·주소·앱 응답·log·summary·수리 자료의 문자열을 구조 필드의 data로 직렬화하고, 경계 표식을 흉내 낸 문자열이 지시 영역으로 나가지 못한다(R10).
  - summary·compaction·handoff에 범위·고정 판·출처·분류가 남고 출처 불명은 data다(R11).
  - `data_envelope_test.ts`에 위 요구 테스트(경계 탈출 fixture)

### T29 notification 계기: approval, question, assignment

- 상태: 진행 (#189) — 남은 것: lophn-agent questions·assignments의 QuestionCreated·AssignmentPaused 발생 작업
- 등급: 좁은
- concern: platform/notifications
- 요구: platform/notifications#R1, R2
- 자리: packages/platform/notifications/
- 쓰는 contract: notification, lophn-agent의 QuestionCreated·AssignmentPaused event
- 내놓는 contract: 없음
- slice: agent
- 선행: platform#T17, platform#T21, lophn-agent의 event contract
- 완료: 아래 확인이 통과한다
  - `ApprovalRequestCreated`, `QuestionCreated`는 항상, `AssignmentPaused`는 actor=machine이고 반복 실패·대상 보관일 때만 만든다. handoff 종료·run 종료는 만들지 않는다.
  - `triggers_test.ts`에 R1, R2 테스트

### T30 test 자식 메모리 상한 adapter

- 상태: 진행 — 남은 것: Deno 대상은 soft RLIMIT_AS를 시작 전에 거절한다. /bin/true 프로브 통과만으로 Deno에 soft를 쓰지 않는다
- 등급: 기본
- concern: platform/security
- 요구: platform/security#R3, problems/tests#R20
- 자리: packages/platform/security/
- 쓰는 contract: supervisor pipe
- 내놓는 contract: 자식 process 메모리 상한 interface(problems test runner가 entry로 받음)
- slice: agent
- 선행: platform#T7, contracts#T6(kind launch spec의 메모리 상한, 결과 `hard`|`soft`|`unavailable`)
- 완료: 아래 확인이 통과한다
  - Linux에서 자식 process 전체 메모리 536,870,912 bytes를 cgroup v2로 강제한다(hard, → Q10). interface는 적용한 방식(`hard`|`soft`)을 돌려주고 test result에 남게 한다. 어떤 방식도 걸 수 없으면 시작 전에 `unavailable`을 돌려주고 상한 없이 띄우지 않는다.
  - `memory_limit_test.ts`에 위 요구 테스트(상한을 넘는 fixture가 실제로 죽는다)

### T57 현재 보기 전달(workspace relay)

- 상태: 완료 (#148)
- 등급: 기본
- concern: platform/api, platform/identity
- 요구: platform/identity#R3, R8, platform/redaction#R5, lophn-agent/harness/prompt-assemble#R28
- 자리: packages/platform/api/
- 쓰는 contract: contracts#T25의 CurrentViewState, contracts#T26(`runs/read`), 인증 값
- 내놓는 contract: 없음(route 정의는 contracts#T25의 `contracts/shell/workspace.ts`, route kind `memory`·`defineMemory`; 이 작업은 core에 등록하고 구현한다)
- slice: agent
- 선행: platform#T24, platform#T6, contracts#T25, contracts#T26
- 완료: 아래 확인이 통과한다
  - `memory` route kind는 ledger queue와 reader를 거치지 않고 API loop의 작은 메모리 handler로 돈다. 인증·한도 검사는 다른 route와 같다.
  - shell main(user)만 창마다 `publish {window_ref, generation, observed_at, summary, tab_pages}`, `bind {session, window_ref}`, `unpublish {window_ref}`를 보낸다. summary ≤2048 bytes, 탭 page 20개, 본문·초안·터미널 출력·DOM·screenshot은 schema가 거절한다.
  - agent runtime은 자기 run의 session으로만 `read {session}`을 부른다. run→session은 `runs/read`로 확인하고 다른 session은 부재와 같다(identity R3, R8). 반환 전에 redaction을 거친다(redaction R5).
  - 값은 core 메모리에만 있고 ledger·blob·log에 없다. 크기는 창 수 × (2048 bytes + 탭 page)로 묶인다. main 연결이 끊기거나 core epoch가 바뀌면 그 main의 값은 모두 `disconnected`, 결합 없는 주기 run은 `unavailable`이며 옛 값을 `current`로 주지 않는다(prompt-assemble#R28).
  - architecture/platform 5.1 route 목록을 같은 PR에서 고친다(lead 결정, Q14).
  - `workspace_test.ts`에 위 요구 테스트

## context

### T53 notification 계기: context watch 변화

- 등급: 좁은
- concern: platform/notifications
- 요구: platform/notifications#R1, R3, R7
- 자리: packages/platform/notifications/
- 쓰는 contract: notification, documents의 ContextWatchedItemChanged event
- 내놓는 contract: 없음
- slice: context
- 선행: platform#T17, documents의 ContextWatchedItemChanged contract
- 완료: `triggers_test.ts`에 machine이 watch 변화·section 소실을 확정한 `ContextWatchedItemChanged`만 계기가 되는 R1 테스트와 notification이 새 run을 만들지 않는 R7 테스트, flow build-context의 notification 단계 통합 테스트

## apps

### T31 app credential과 앱 secret의 grant 검사

- 상태: 완료 (#136)
- 등급: 기본
- concern: platform/identity, platform/secrets
- 요구: platform/secrets#R10
- 자리: packages/platform/identity/, packages/platform/secrets/
- 쓰는 contract: 인증 값, secret, apps의 현재 grant read와 앱 실행 credential 조건
- 내놓는 contract: app credential 발급(앱 supervisor의 신뢰 runtime 경계)
- slice: apps
- 선행: platform#T20, apps의 grant·runtime contract
- 완료: 아래 확인이 통과한다
  - 앱 supervisor가 고정 app·release·process·mode로 `app:<app>` credential을 감독 pipe로 요청해 받는다. 앱 사용자 코드에는 token이 없다. 종료·판 교체·회수에 폐기한다.
  - 앱 direct 연결과 confirm 실행 증명은 새 token 종류가 아니라 apps가 서명하는 진술이다(→ Q15). platform은 `credential_ref`·기한과 core epoch만 준다. identity domain model의 "정할 것"을 같은 PR에서 이 내용으로 채운다.
  - 앱 secret 전송은 현재 grant만 보고, 호출마다 approval을 요구하지 않고, caller가 사람·agent·automation·다른 앱이라는 이유로 막지 않는다(R10).
  - `app_secret_test.ts`에 R10 테스트, flow manage-app-permissions의 secret 단계 통합 테스트
  - R10 끝단(실제 grant 판정)은 apps#T4가 SecretAllowance를 채울 때 증명한다. platform 쪽은 port가 등록되지 않으면 attach·refresh가 forbidden인 fail closed다.

### T32 confirm 앱 command의 approval 사용

- 등급: 기본
- concern: platform/approvals
- 요구: platform/approvals#R8
- 자리: packages/platform/approvals/
- 쓰는 contract: approval, apps의 invocations 접수 command
- 내놓는 contract: 없음
- slice: apps
- 선행: platform#T23, apps의 invocations contract
- 완료: 아래 확인이 통과한다
  - confirm 앱 command의 request는 실제 호출 주체를 요청자로 두고 사람 결정과 구별하며 정확한 앱·release·command·입력에 묶인다. invocations의 접수와 approval 사용이 한 transaction이고 agent ask와 겹치면 한 번만 소비한다(R8).
  - `confirm_test.ts`에 R8 테스트, flow use-app-command 통합 테스트

### T33 notification 계기: release activation 실패

- 등급: 좁은
- concern: platform/notifications
- 요구: platform/notifications#R1
- 자리: packages/platform/notifications/
- 쓰는 contract: apps의 ReleaseActivationFailed event
- 내놓는 contract: 없음
- slice: apps
- 선행: platform#T17, apps의 event contract
- 완료: `triggers_test.ts`에 `ReleaseActivationFailed` 계기 R1 테스트

## coding-agent

### T34 coding agent credential: 발급, keychain, loader 전달

- 등급: 최상위
- concern: platform/identity, platform/secrets
- 요구: platform/identity#R5, R15, platform/secrets#R12
- 자리: packages/platform/identity/, packages/platform/secrets/
- 쓰는 contract: 인증 값, secret, coding-agent의 connection command와 digest·회수 read
- 내놓는 contract: coding credential 보호 전달(신뢰 MCP·CLI loader와 TUI child)
- slice: coding-agent
- 선행: platform#T19, platform#T22, contracts#T47(`CodingAgentConnectionAuth` port와 loader 보호 전달 요청), coding-agent#T9
- 완료: 아래 확인이 통과한다
  - 사람의 connection 결정 뒤 인증 경계가 token을 만들고 keychain에 준비하고 digest만 connection command에 제출한다. commit 실패·중단 token은 쓸 수 없고 고아를 정리한다(identity R5, secrets R12).
  - 신뢰 loader가 현재 connection·scope·process generation을 확인한 지정 child에만 non-inheritable 보호 통로로 넘긴다. 일반 shell·renderer·coding agent 요청으로는 열리지 않는다(identity R15).
  - lophn이 [Start]로 띄운 coding TUI 프로세스 자체에는 token이 가지 않고 connection 참조만 간다. 그 TUI 아래에서 시작한 lophn MCP·CLI child가 loader로 받는다. TUI 전용 보호 전달 길은 따로 없다.
  - 회수는 keychain 삭제와 별개로 모든 새 요청에서 즉시 적용된다.
  - `coding_credential_test.ts`에 위 요구 테스트, flow connect-coding-agent의 credential 단계 통합 테스트

### T35 coding harness 설정 검증 연결

- 등급: 좁은
- concern: platform/settings
- 요구: platform/settings#R31
- 자리: packages/platform/settings/
- 쓰는 contract: coding-agent의 harness 설정 검증
- 내놓는 contract: 없음
- slice: coding-agent
- 선행: platform#T27, coding-agent의 harnesses contract
- 완료: `coding_settings_test.ts`에 R31 테스트(enabled·기본 harness·profile은 소유 검증, 실행 파일 경로·감지·receipt는 TOML export에 없음)

### T36 notification 계기: ticket 확인·검사 실패

- 등급: 좁은
- concern: platform/notifications
- 요구: platform/notifications#R1, R2
- 자리: packages/platform/notifications/
- 쓰는 contract: coding-agent의 TicketConfirmed·TicketCheckFailed event
- 내놓는 contract: 없음
- slice: coding-agent
- 선행: platform#T17, coding-agent의 event contract
- 완료: `triggers_test.ts`에 두 계기와 claim·완료 보고 등 비계기의 R1, R2 테스트

### T55 lophn daemon 시작·중지와 로컬 상태

- 상태: 완료 (#157)
- 등급: 기본
- concern: platform/install-and-update
- 요구: platform/install-and-update#R10, R12
- 자리: packages/platform/install-and-update/, apps/core/
- 쓰는 contract: `H/run` 위치 metadata, shell의 Electron main 실행 옵션
- 내놓는 contract: `H/run` 위치 metadata schema와 daemon 시작·중지 방법(coding-agent/cli#R8의 `lophn daemon`이 씀)
- slice: coding-agent
- 선행: platform#T9, contracts#T6(`H/run` metadata), shell#T51(`--tray`, second-instance `--quit`)
- 완료: 아래 확인이 통과한다
  - 시작: launcher가 창 없이 Electron main을 띄우고 main이 core를 띄운다. 이미 실행 중이면 두 번째 instance를 열지 않고 실행 중이라고 알린다(R10). Electron 없는 server 실행은 없다(R12).
  - 중지: OS single-instance 통로로 실행 중인 Electron main에 명시 종료를 요청하고 main이 정상 종료 순서(T9)를 밟는다. API token이 필요 없고 coding credential을 쓰지 않는다.
  - 상태·log: OS 사용자 권한으로 `H/run` 위치 metadata와 instance lock, `H/logs`의 안전 log를 읽는다. 원문 credential은 어디에도 없다.
  - `daemon_test.ts`에 R10, R12 테스트

## problems

### T38 lophn 내부 오류의 진단 분류

- 상태: 완료 (#80)
- 등급: 좁은
- concern: platform/diagnostics
- 요구: platform/diagnostics#R1
- 자리: packages/platform/diagnostics/
- 쓰는 contract: supervisor pipe의 diagnostic 메시지
- 내놓는 contract: 없음
- slice: problems
- 선행: platform#T8
- 완료: `classify_test.ts`에 R1 테스트(core·SDK·desktop 실패는 `lophn_internal` 진단이고 앱 문제로 가지 않는다; 출처 불명 관측·잘못된 보고는 진단으로 남는다)

### T39 notification 계기: 운영 보고 문제

- 상태: 진행 (#189) — 남은 것: problems/closing의 ProblemClosed·ProblemReopened 발생 작업
- 등급: 좁은
- concern: platform/notifications
- 요구: platform/notifications#R1, R2
- 자리: packages/platform/notifications/
- 쓰는 contract: problems의 ProblemOpened·ProblemReopened·ProblemClosed event
- 내놓는 contract: 없음
- slice: problems
- 선행: platform#T17, problems의 event contract
- 완료: `triggers_test.ts`에 운영 보고 문제만 계기가 되고 추가 report는 만들지 않는 R1, R2 테스트

## operator

platform 작업이 없다. Operator assignment 허락의 고정 범위는 T23(approvals#R10)이 덮는다.

## operations

### T40 migration 완성: 정지, 복구본, 검증

- 상태: 완료 (#149)
- 등급: 기본
- concern: platform/backup-and-migration
- 요구: platform/backup-and-migration#R2, R3, R5, R7, R18
- 자리: packages/platform/backup-and-migration/, apps/core/
- 쓰는 contract: supervisor pipe
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T9, platform#T13
- 완료: 아래 확인이 통과한다
  - 미적용 step이 있으면 새 command·준비를 막고 짧은 쓰기를 끝내고 worker를 정지해 정상 writer와 migration writer가 겹치지 않는다(R2).
  - I/O worker가 SQLite backup API로 `backups/migrations/s<N>-<stamp>/` 복구본을 만들고 integrity 통과 뒤에만 시작한다(R3).
  - 완료 뒤 FK·unique·불변 보호 검사, ID·actor·event 순서·blob 참조 보존(R5). 앞으로만 간다(R7). 복구본은 사람의 명시 삭제만(R18).
  - `migration_test.ts`에 위 요구 테스트, flow update-lophn의 migration 단계 통합 테스트

### T41 backup 생성, 검증, 보존

- 등급: 기본
- concern: platform/backup-and-migration
- 요구: platform/backup-and-migration#R8, R9, R10, R11, R12
- 자리: packages/platform/backup-and-migration/, apps/worker/platform/
- 쓰는 contract: blob
- 내놓는 contract: backups(`/v1/backups/list·get`, manifest format 1)
- slice: operations
- 선행: platform#T14, platform#T40, contracts#T45
- 상태: 완료 (#169)
- 완료: 아래 확인이 통과한다
  - 하루 한 번 I/O worker가 SQLite online backup으로 snapshot S를 만들고 S의 모든 `blob_refs` blob과 사람의 설정 선택을 함께 담는다(R8, R9).
  - 그동안 GC·삭제를 막고 integrity·blob 존재·실제 sha256을 모두 통과한 묶음만 `complete=true`(R10).
  - manifest에 앱 DB·외부 원본·keychain·credential이 빠졌다는 안내가 있다(R11). 완료 7개 보존, 실패·미완성 때문에 마지막 완료를 지우지 않는다(R12).
  - `backup_test.ts`에 위 요구 테스트

### T42 restore와 derived 재생성

- 등급: 기본
- concern: platform/backup-and-migration, platform/ledger
- 요구: platform/backup-and-migration#R13, R14, platform/ledger#R19
- 자리: packages/platform/backup-and-migration/, apps/core/
- 쓰는 contract: approval 또는 confirmation handle(사람 확인), documents의 derived 초기화
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T41, platform#T22
- 완료: 아래 확인이 통과한다
  - 사람이 잃을 S 뒤 기록 범위를 확인하면 모든 writer·worker·앱·agent를 정지하고 현재 자료를 따로 보존한 뒤 staging 검증본으로 교체한다(R13).
  - 새 epoch·새 `ledger_id`로 실행 credential을 다시 발급하고 platform의 derived(api-subscriptions)와 전송 cursor를 복원 ledger 기준으로 다시 만든다. 소유 derived는 기록한 `ledger_id`가 `platform/status`와 다르면 버리고 다시 만든다(documents#T13). 다른 ledger의 같은 seq를 이어 처리하지 않는다(R14).
  - 결정적 derived는 다시 만들고 model 요약은 같은 출력이라고 표시하지 않는다(ledger R19).
  - `restore_test.ts`에 위 요구 테스트, flow backup-and-restore E2E 단계(`e2e/flows/backup-and-restore_test.ts`)

### T43 재시작 복구 조정과 기동 순서

- 등급: 기본
- concern: platform/backup-and-migration, platform/install-and-update
- 요구: platform/backup-and-migration#R15, R16, platform/install-and-update#R11
- 자리: apps/core/, packages/platform/backup-and-migration/
- 쓰는 contract: apps의 invocation·release activation 복구, lophn-agent의 run 복구
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T40, platform#T26, 소유 팀의 복구 contract
- 완료: 아래 확인이 통과한다
  - 기동 순서: single instance → 설정 검증 → ledger 무결성·schema → 중단 작업 점검 → cursor 복원 → 인증된 API → 앱 감독 → 주기 접수(install R11).
  - SQLite 복구와 schema 점검 뒤 정상 read를 열고 전체 scan·index·큰 hash를 기다리지 않는다(R15).
  - 미완료 invocation·release activation·run·approval 대기를 소유 concern이 실제 관측으로 점검하게 하고, 모르면 unknown과 근거를 남긴다. 전역 barrier가 없다(R16).
  - `startup_test.ts`에 위 요구 테스트, flow work-offline·resume-agent-session의 재시작 단계 통합 테스트

- 상태: 진행 (#162) — 남은 것: 소유 concern의 복구 command(invocation·release activation·run·approval 대기)가 연결되면 점검이 실제 관측으로 확정한다

### T44 blob GC와 보존 정리

- 등급: 기본
- concern: platform/blob-store
- 요구: platform/blob-store#R8, R9, R10, R11, R13
- 자리: packages/platform/blob-store/, apps/worker/platform/
- 쓰는 contract: blob
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T41
- 완료: 아래 확인이 통과한다
  - 기동·매일 필요 여부만 관측하고, 실제 GC는 새 준비·command 차단·writer 정지 뒤 고정 `blob_refs` 전체와 대조한다. 보관·옛 판·감사 참조를 살린다(R8, R10).
  - 미참조 확인 7일 뒤에만 삭제, 재시작 tmp는 진행 중 아님을 확인한 뒤 정리(R9).
  - 큰 자료 종류(model 호출 본문·snapshot 첨부·trace·운영 log)는 종류별 상한을 넘으면 오래된 것부터 정리하고 읽으면 "정리됨" 이유를 준다. 변경 기록·결정·확정 결과는 지우지 않는다(R13).
  - 참조 차단·반환 차단·OS 삭제·다른 사본 잔존을 구별해 표시한다(R11). backup 중 GC 불가.
  - `gc_test.ts`에 위 요구 테스트

- 상태: 진행 (#181) — 남은 것: 정지 유지보수 조립에서 collectGarbage·trimCapacity 부르기, 준비 purpose가 capacity category 기록

### T45 secret export와 import

- 상태: 완료 (#92)
- 등급: 기본
- concern: platform/secrets
- 요구: platform/secrets#R9
- 자리: packages/platform/secrets/
- 쓰는 contract: secret
- 내놓는 contract: secret(`secret.export`·`secret.import` pipe 작업)
- slice: operations
- 선행: platform#T19
- 완료: `export_test.ts`에 R9 테스트(format 1 metadata 인증, Argon2id 64MiB·3회·p1·salt 16 bytes, AES-256-GCM nonce 12 bytes, 수정·틀린 암호 전체 거절, 평문 중간 파일 없음, import 실패는 기존 참조 유지), flow backup-and-restore의 secret 이전 단계

### T46 OS notification 표시와 전달 실패

- 등급: 기본
- concern: platform/notifications
- 요구: platform/notifications#R9, R10, R12
- 자리: packages/platform/notifications/
- 쓰는 contract: notification, shell의 표시 경로
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T17, shell#T56
- 완료: 아래 확인이 통과한다
  - OS 표시는 사람이 켰을 때만, redaction한 최소 제목·대상 열기만 shell main에 준다(R9).
  - 전달 실패는 retry 업무 표 없이 다음 조회에서 안전 이유로 보인다(R10). 자동 표시는 focus·문서·앱을 바꾸지 않는다(R12).
  - `os_display_test.ts`에 위 요구 테스트, flow catch-up-notifications E2E 단계(shell과 함께)

### T47 doctor와 보안 진단

- 상태: 진행 (#180) — 남은 것: core.ts에 doctor·diagnostics source 연결, apps grant 위험 read·SDK hash contract가 생기면 관측 파일 대신 그 read로 교체
- 등급: 기본
- concern: platform/diagnostics
- 요구: platform/diagnostics#R4, R5, R6, R9, R10
- 자리: packages/platform/diagnostics/, apps/worker/platform/
- 쓰는 contract: redaction, apps의 grant 위험 read와 SDK hash
- 내놓는 contract: diagnostics(`/v1/diagnostics/list·check`)
- slice: operations
- 선행: platform#T16, platform#T41, apps의 grant·sdk contract
- 완료: 아래 확인이 통과한다
  - 디스크 부족·ledger 손상은 플랫폼 실패로 보이고 성공을 log로 대신하지 않는다(R4). 상세는 redaction 통과분만(R5).
  - 권한 부여·회수·secret 사용·인증 실패·Origin 거부·권한 밖 접근을 보안 진단으로 구별하되 원본은 소유 concern의 event다(R6).
  - doctor가 worker에서 SDK 같은 version의 hash 차이, 실행 자격 권한, 너무 넓은 grant, file+network grant, 오래 안 쓴 grant, log의 미가공 key 패턴을 원문 없이 보고한다(R9, R10).
  - `doctor_test.ts`에 위 요구 테스트, flow install-lophn의 상태 점검 단계

### T48 Linux 설치 묶음(.deb)

- 등급: 기본
- concern: platform/install-and-update, platform/security
- 요구: platform/install-and-update#R1, R2, R3, R4, R5, R6, R8, platform/security#R4, R5
- 자리: packages/platform/install-and-update/, tools/ (packaging script)
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T43, shell#T57
- 완료: 아래 확인이 통과한다
  - `/opt/lophn/`에 Deno binary·platform source·lock·vendor·desktop·skills·sdk·guides(자리는 이 작업이 정하고, 원문은 lophn-agent의 `packages/lophn-agent/roles/lophn/guides/`에서 복사한다. architecture 3.1을 같은 PR에서 고친다), `/usr/bin/lophn-desktop`·`lophn`·`lophn-mcp` launcher. 시작에 의존성 다운로드가 없다(R4, R5, R6).
  - Chromium sandbox 파일 root 소유·4755와 Ubuntu 24.04 이상에서 실제 sandbox 활성 검사. sandbox를 끈 실행은 배포 테스트 통과로 세지 않는다(R2, R3, security R4).
  - Deno cache `~/.cache/lophn/deno`를 지워도 H가 그대로다(R8). 의존성은 lock과 integrity hash로 고정(security R5).
  - 실제 build·설치·기동·앱 호출·backup restore를 Ubuntu에서 확인하기 전에는 Linux 배포를 사용 가능으로 표시하지 않는다(R1 Linux).
  - flow install-lophn E2E 단계(Linux)

### T49 macOS·Windows 설치 묶음과 OS adapter

- 등급: 최상위
- concern: platform/install-and-update, platform/secrets, platform/responsiveness
- 요구: platform/install-and-update#R1
- 자리: packages/platform/install-and-update/, packages/platform/secrets/, packages/platform/responsiveness/
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T48, shell#T57
- 완료: 아래 확인이 통과한다
  - macOS `Lophn.app/Contents/Resources/`, Windows `Lophn/resources/` 묶음, 서명·공증 검증
  - macOS Keychain·Windows Credential Manager adapter, Windows Job Object 자식 종료, 감독 frame 통로 동작(→ Q2), 소유자 전용 ACL 검사
  - 자식 메모리 상한: Windows는 Job Object(hard), macOS는 `--v8-flags=--max-old-space-size`와 짧은 주기의 process tree RSS watchdog(넘으면 그룹 종료, soft)(lead 결정, Q10)
  - 각 OS에서 실제 설치·기동·앱 호출·backup restore를 확인하기 전에는 사용 가능으로 표시하지 않는다(R1).

### T50 lophn update 절차

- 등급: 기본
- concern: platform/install-and-update
- 요구: platform/install-and-update#R13, R14, R15
- 자리: packages/platform/install-and-update/, apps/core/
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T40, platform#T48
- 완료: 아래 확인이 통과한다
  - 사람이 새 .deb를 설치하는 수동 update만. 자동 다운로드·설치·무단 재시작 없음(R13).
  - 진행 작업과 플랫폼을 정상 정지한 뒤 설치 파일만 바꾸고 H를 초기화하지 않으며, schema 변경은 T40의 검증 복구본 뒤 migration(R14). 기술 기반은 Electron·Deno·SQLite·MCP/CLI 그대로(R15).
  - flow update-lophn E2E 단계

### T51 응답성 측정 harness와 목표

- 등급: 기본
- concern: platform/responsiveness
- 요구: platform/responsiveness#R6, R7, R8, R10
- 자리: packages/platform/responsiveness/, tools/
- 쓰는 contract: platform client
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T11, platform#T43
- 완료: 아래 확인이 통과한다
  - 4 logical CPU·16GiB·SSD 기준, warm-up 30초 뒤 5분·대상별 1,000개 이상 요청, 성공·오류·timeout을 따로 세고 queue 대기와 실행 시간을 따로 기록한다(R8, R10).
  - 작은 read·앱 read command p95 200ms·p99 500ms, shell 첫 반응 p95 100ms·p99 250ms(R6), 작은 command·64KiB 저장 p95 500ms·p99 1,000ms, 제어 접수 p95 200ms·p99 500ms(R7) 결과 보고
  - `deno task e2e`에서 도는 측정 시나리오

### T52 부하 시나리오와 직접 통로 확인

- 등급: 기본
- concern: platform/responsiveness
- 요구: platform/responsiveness#R2, R5, R9
- 자리: packages/platform/responsiveness/, tools/
- 쓰는 contract: platform client, apps의 앱 통로
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T51
- 완료: 아래 확인이 통과한다
  - 100,000파일·10GiB scan·hash·index, 1GiB 압축, 60초 model·test, 정체 앱, 동시 관리 요청 10개를 각각·함께 걸고 T51 목표를 잰다(R9).
  - 일반 앱 화면·read·command가 core·invocation 기록을 기다리지 않는다(R2). 한 앱의 무한 loop·crash가 다른 앱·shell 조작을 막지 않는다(R5, Electron main 쪽은 shell과 함께).
  - flow work-offline E2E의 응답성 단계


### T54 operations slice flow E2E

- 등급: 기본
- concern: platform/install-and-update, platform/backup-and-migration, platform/notifications, platform/responsiveness
- 요구: platform/install-and-update#R11, platform/backup-and-migration#R13, R15, R16, platform/notifications#R11, platform/responsiveness#R1
- 자리: e2e/flows/
- 쓰는 contract: platform client, contracts#T10의 E2E harness
- 내놓는 contract: 없음
- slice: operations
- 선행: platform#T42, platform#T43, platform#T46, platform#T48, platform#T50, platform#T52, contracts#T10, shell#T28, shell#T56, shell#T57, shell#T58, shell#T59
- 완료: 아래 확인이 통과한다
  - `e2e/flows/install-lophn_test.ts`, `update-lophn_test.ts`, `backup-and-restore_test.ts`, `catch-up-notifications_test.ts`, `work-offline_test.ts`가 flow 문서의 단계·다른 갈래·끝을 그대로 돈다(Linux, fake provider와 fixture).
  - `deno task e2e`에서 operations slice의 다섯 flow가 모두 통과한다.

---

## 요구 덮기

| concern | 요구 수 | 덮은 수 | 작업 |
|---|---|---|---|
| platform/api | 7 | 7 | T4, T6, T12 |
| platform/approvals | 17 | 17 | T21, T22, T23, T32, T56 |
| platform/backup-and-migration | 18 | 18 | T1, T7, T40, T41, T42, T43, T54 |
| platform/blob-store | 13 | 13 | T13, T14, T44 |
| platform/diagnostics | 12 | 12 | T6, T8, T9, T38, T47 |
| platform/identity | 15 | 15 | T5, T6, T11, T14, T24, T34, T57 |
| platform/install-and-update | 15 | 15 | T9, T43, T48, T49, T50, T54, T55 |
| platform/ledger | 23 | 23 | T1, T2, T3, T4, T9, T18, T24, T42 |
| platform/notifications | 12 | 12 | T17, T29, T33, T36, T39, T46, T53, T54 |
| platform/redaction | 16 | 16 | T8, T15, T16, T57 |
| platform/responsiveness | 10 | 10 | T8, T10, T11, T12, T51, T52, T54 |
| platform/secrets | 12 | 12 | T19, T20, T31, T34, T45 |
| platform/security | 11 | 11 | T6, T7, T20, T28, T30, T48 |
| platform/settings | 31 | 31 | T25, T26, T27, T35 |
| 합 | 213 | 213 | |

slice별 작업 수: skeleton 10, documents 7, agent 15, context 1, apps 3, coding-agent 4, problems 3, operator 0, operations 14. 모두 57개. (context slice는 documents와 agent 뒤다. 번호는 다른 팀에 알린 뒤 바꾸지 않으므로 T53–T57은 자기 slice 자리에 있다.)

## 질문

추천안으로 계획을 썼다. lead가 다르게 정하면 고친다.

- **Q1 core 모듈 자리(lead 결정: 추천대로).** architecture 2.2의 `commands`, `reads`, `events`, `supervisor`는 code-map에 줄이 없다. 추천: command·read·event는 `packages/platform/ledger/`, 신뢰 child 감독은 `packages/platform/responsiveness/`에 두고 architecture/platform.md 2.2를 code-map에 맞게 T1·T7 PR에서 고친다.
- **Q2 감독 통로(정함).** architecture의 "상속된 비공개 pipe"를 child의 stdin·stdout pipe 위 길이 prefix binary frame(JSON 제어 frame과 byte chunk frame)으로 정했다. 모든 신뢰 child와 Electron main↔core가 같은 codec(contracts#T6)을 쓴다. Node IPC channel은 JSON만 실어 blob·file 바이트에 맞지 않고, Node 부모가 준 fd 3 pipe는 Deno 자식에서 EBADF였다(Linux에서 확인). architecture 2.4의 "stdout을 제어 통로로 쓰지 않는다"는 "stdout은 감독 frame 전용, 그 밖의 출력은 stderr, stderr는 제어·성공 근거가 아니다"로 T7 PR에서 고친다.
- **Q3 다른 팀의 통합 테스트가 core를 띄우는 법(lead 결정).** 다른 팀 `*_test.ts`는 `apps/core/testing/`만 import할 수 있다(code-map에 반영됨). harness는 T9가 만든다.
- **Q4 여러 팀이 같이 쓰는 entry(lead 결정).** platform이 skeleton에서 registry를 만들고(T8, T9), 각 팀은 `apps/core/<팀>.ts`와 `apps/worker/<팀>/`만 고친다.
- **Q5 `events.run` FK(lead 결정: 추천대로).** domain model은 `events.run → runs.id`인데 run 표(lophn-agent)는 skeleton에 없다. 추천: 첫 release 전까지 schema step은 고쳐 쓸 수 있고 개발 데이터는 다시 만든다. run 표가 들어올 때 schema 조립 순서에서 run 표를 앞에 두고 FK를 더한다.
- **Q6 blob 준비 통로(정함).** 문서 worker 같은 신뢰 child는 감독 pipe의 byte chunk frame으로 바이트를 보내고, core는 해석·hash 없이 backpressure를 지키며 I/O worker로 넘긴다. hash·fsync·설치는 I/O worker만 한다. 새 endpoint·token 종류를 만들지 않는다. file route(T12)의 바이트도 같은 길이다.
- **Q7 OS keychain 접근(lead 결정: 추천대로).** 일반 `--allow-ffi` 금지와 keychain 호출이 부딪힌다. 추천: I/O worker 안 OS adapter 진입점에서만 Linux `secret-tool`(값은 stdin), macOS `security`(값은 prompt 입력으로), Windows Credential Manager는 그 진입점에 한정한 FFI. 값이 argv·환경 변수에 가지 않는 방법만 쓴다.
- **Q8 problems의 상시 worker(lead 결정: 추천대로).** problems 팀은 report collector와 test runner control을 core가 상시 감독하는 `apps/worker` kind로, 실제 test 자식만 요청마다 띄우자고 한다. architecture/platform 2.1은 "상시 5개, test runner는 bounded"라고 적었다. 추천: 동의한다. supervisor가 kind마다 상시·요청 시 정책을 받고 architecture 2.1 문장을 고친다.
- **Q9 worker 전달 route kind(lead 결정: 추천대로).** documents의 원본 파일 읽기(`file`)와 problems의 report·request-test는 core가 인증만 하고 worker로 넘겨야 한다. `file`은 architecture에 있고, JSON을 넘기는 `worker` kind를 더하는 contract 변경을 contracts 팀에 요청한다(T12).
- **Q10 test 자식 메모리 상한(lead 결정).** Linux는 cgroup v2, Windows는 Job Object로 hard 강제한다. macOS는 unavailable로 두지 않고 V8 heap 상한(`--max-old-space-size`)과 process tree RSS watchdog으로 soft 강제한다. interface가 방식(`hard`|`soft`)을 돌려주고 test result에 남긴다(T30, T49).
- **Q11 command_results의 다른 principal 조회(정함).** `command_results`는 platform 표이고 자기 principal의 결과만 읽힌다(`commands/result`). owner read에 다른 principal 조회를 열지 않는다. problems의 test 요청처럼 요청자와 runner가 함께 봐야 하는 기록은 problems 소유 append-only 표로 둔다(problems 팀에 알림).
- **Q12 ledger 식별(lead 결정: 추천대로).** restore 뒤 derived가 다른 ledger의 같은 seq를 이어 처리하지 않으려면(backup-and-migration#R14) 소유 worker가 ledger 교체를 알아야 한다. 추천: `platform/status`에 `ledger_id`(ledger를 만들거나 복원할 때마다 새 값)를 두고 derived 출처에 함께 적는다.
- **Q13 공통 오류 코드 수(lead 결정).** internal을 포함한 7개다. lead가 docs/dev/architecture.md를 고쳤다.
- **Q14 workspace relay(lead 결정).** shell 팀 제안을 받아 T57(agent slice)로 더했다. core 메모리에만 두고 shell main이 쓰고 agent runtime이 자기 session만 읽는다. architecture/platform 5.1을 같은 PR에서 고친다.
- **Q16 doctor 관측 원본(진행, T47 #180).** apps의 grant 위험 read와 SDK hash contract가 아직 없어 doctor는 데이터 root의 관측 파일(grants.json, sdk.json, credential 파일, logs/)을 임시 입력으로 읽고, core.ts에는 doctor·diagnostics source를 연결하지 않았다. contract가 생기면 관측 파일을 그 read로 바꾸고 core.ts에 연결한다.
- **Q15 앱 연결 진술(lead 결정: 추천대로).** apps 팀 제안: AppConnection·ConfirmExecutionProof는 새 token·actor가 아니라 core 안 apps 제어 adapter가 core 시작마다 만든 Ed25519 key로 서명한 진술이고, 기한은 AppConnection 최대 10분(원래 credential 기한 이하), proof 120초다. platform은 `credential_ref`·기한만 주고 회수는 소유 event(grant 회수, assignment 멈춤, connection 회수, run 종료)와 core epoch로 판단한다. 추천: 동의한다. 별도 platform 회수 event는 만들지 않는다.
- **Q16 coding connection 생성 결정(정함).** architecture/platform 5.6 표(`coding_agent`는 "confirmation window의 connection 결정 뒤 발급")와 마지막 절("보호 화면의 exact scope 결정")이 coding-agent/connection#R2·D19(사람의 harness 연결·범위 선택이 허락, 확인 창 없음, 회수만 confirmation window)와 부딪힌다. platform/identity#R5도 "사람의 harness 연결 선택"이다. architecture를 R2에 맞춰 T5 PR에서 고친다.
- **Q17 confirmation handle 시점(정함).** documents slice의 파일 지우기(organize-documents)가 confirmation window를 쓴다. 그래서 handle 발급·검증·소비를 T56(documents slice)으로 떼었고, approval의 허락·거절만 T22(agent slice)에 남겼다.
- **Q18 Tx approval 적용 연결(정함).** contracts#T22의 필수 `Tx.useApproval`과 T1 실행기가 함께 합쳐지기 전에 생긴 누락을 복구한다. T23의 정확한 action 검사·`approval_uses` 기록이 들어오기 전에는 `unavailable`로 거절하며, 성공한 사용이나 receipt를 만들지 않는다. T23에서 이 거절을 실제 구현으로 바꾼다.
- **Q20 blob 읽기 응답 통로(추천안, T14 후속).** 256KiB 읽기 창(blob-store#R7)을 base64로 JSON control frame에 실으면 감독 control frame 한도(256KiB, contracts#T6)를 넘는다. control frame 한도는 제어 메시지의 상한을 지키려고 있는 것이고 바이트는 byte chunk frame의 몫이다(Q2, Q6). 그래서 한도를 올리지 않고 core↔I/O worker의 `blob.read` 바이트만 요청 channel의 byte chunk frame으로 옮겼다. `/v1/blobs/read`의 BlobReadResult(base64)는 그대로다.
- **Q19 command 행·CAS 한도(lead 결정).** caller의 변경 행 수 주장과 compare의 top-level key 수는 실제 한도가 아니다. 변경 행은 `Tx.sql`·`emit`·`advanceSubscriberCursor`의 SQL마다 같은 연결 `total_changes()`의 앞뒤 차이로 event·cursor 행과 RETURNING·trigger 변경까지 실제로 세어 transaction 안에서 누적하고 1,000개 초과면 전체 rollback한다. `Tx.sql.get`·`all`로 행을 바꾸면 SQL 문장 모양과 상관없이 거절하고 rollback한다. 실행기의 `command_results` 한 행만 이 수에서 뺀다. CAS는 handler 전에 parse된 compare의 leaf 수를 중첩 object·배열까지 재귀로 세어 256개 초과면 `invalid_input`으로 거절하고 handler를 부르지 않는다. 실제 비교 횟수가 아니라 받은 비교 대상의 상한이다. 모든 owner handler에 필수 preflight member를 더하지 않고 `CommandDefinition`·`Tx` contract는 그대로 둔다. 동작이 숨고 비동기·복사에서 새어 나가는 compare proxy는 쓰지 않는다.
