---
type: plan
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# contracts 팀 계획

contracts 팀은 `packages/contracts/`(최상위 사이 contract), `packages/base/`(id, clock, Result와 공통 오류 코드, canonical JSON, log), 저장소 바닥(루트 `deno.json` workspace, `deno task check`·`dev`·`e2e`, `deno fmt`·`deno lint` 설정, `tools/`의 공통 개발 도구)을 맡는다. `tools/fake-provider/`는 lophn-agent 팀, `fixtures/projects/`는 documents 팀, `fixtures/apps/`는 apps 팀이 만든다.

요구 덮기는 contract 목록 덮기로 한다. [architecture/README.md](../architecture/README.md) 4장의 contract 23개와, 4장 표에는 없지만 최상위 사이를 지나는 contract마다 어느 작업이 만드는지를 끝의 "요구 덮기"에 적는다.

## 진행 방식

- **한 slice 앞서 간다.** slice X의 contract 작업은 slice X의 다른 팀 작업보다 먼저 main에 들어간다(contracts.md 병합 순서). 다른 팀은 자기 작업의 `선행:`에 여기 작업 id를 적는다.
- **요청을 받아 작업에 넣는다.** 다른 팀이 보낸 contract 요청은 해당 작업의 `받은 요청:` 줄에 팀 이름으로 적는다. 바꿀 것이 생기면 같은 작업을 고치거나 새 작업을 더한다.
- **소유 팀이 review한다.** contracts 팀 member가 review 기록을 남기고 합친 뒤, 그 contract의 소유 팀에 review를 요청한다(이름·필드·오류가 architecture 5장과 domain model 그대로인지). 기다리는 팀을 막지 않기 위해서다. 소유 팀이 고칠 것을 보내면 후속 contracts PR로 고친다.
- **쓰는 쪽을 함께 고친다.** contract를 바꿀 때는 쓰는 코드를 모두 찾아 같은 PR에서 고치거나, 고칠 팀에 작업을 만들고 알린다(contracts.md).

## contract 코드 공통 규칙

모든 contract 작업과 base 작업에 붙는다. worker 프롬프트에 그대로 넣는다.

1. **자리.** `packages/contracts/<최상위>/`에 그 최상위가 내놓는 것만 둔다. 파일은 resource나 값 묶음 하나에 하나(`documents/projects.ts`)이고 `mod.ts`가 전부 내보낸다. 400줄을 넘으면 나눈다. 다른 package는 `@lophn/contracts/<최상위>`(workspace exports)로만 가져온다.
2. **이식성.** contracts와 base는 Deno와 Node(Electron main의 type stripping·tsc) 양쪽에서 돈다. import는 상대 경로(`.ts` 확장자 포함)와 bare `zod`만 쓴다(base는 상대 경로만). `Deno.*`, `node:*`, `npm:`, `jsr:`, URL import를 쓰지 않는다. 전역은 `crypto`, `TextEncoder`, `TextDecoder`, `URL`만 쓴다. member `deno.json`에 `compilerOptions.erasableSyntaxOnly: true`를 두어 enum·namespace·parameter property를 막는다.
3. **방향.** base는 아무것도 import하지 않는다. contracts는 base와 zod만 import한다(code-map, lead 결정). `contracts/<최상위>`는 `contracts/platform`의 공통 값과 다른 최상위 contracts의 ID·값 type을 가리킬 수 있다. 순환은 금지다(T8 테스트).
4. **schema.** Zod 4 한 가지로 쓴다. 입력 schema는 `z.strictObject`(모르는 field 거절), 출력 schema는 `z.object`(같은 major에서 선택 field가 더해져도 읽는 쪽이 깨지지 않는다, platform/api#R6)다. `z.coerce`와 숫자 문자열 자동 변환은 쓰지 않는다. seq는 십진 문자열, 시각은 UTC ISO 8601 밀리초 문자열, ID는 접두사 schema, hash는 소문자 hex sha256이다. 예외는 blueprint 하나다(T33, lead 승인).
5. **이름.** route는 `defineCommand`·`defineRead`·`defineFile`(T5)로, event는 `defineEvent`(T7)로 적는다. command·event·값·field 이름은 architecture 5장과 domain model 그대로다(field는 snake_case, TS type은 PascalCase). 새 동의어를 만들지 않는다.
6. **구현 없음.** handler, SQL, 파일·network IO를 두지 않는다. 둘 수 있는 함수는 작은 client 생성 함수(T5 RPC, T34 앱 통로), 문법 schema의 parse·format(T14 Address), 감독 pipe frame codec(T6)뿐이다.
7. **오류.** 각 route는 낼 수 있는 오류 코드를 공통 7종(`invalid_input`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `unavailable`, `internal`) 안에서 적는다.
8. **사람 결정.** confirmation window가 부르는 command는 `CommandEnvelope.confirmation`(T13의 handle 참조), CAS(`compare`), 같은 idempotency key를 받고, 표시에 쓰는 read를 route 정의의 `display_read`로 짝지어 적는다.
9. **테스트.** 대상 옆 `*_test.ts`. 이름은 그 contract의 겉모양을 정하는 요구 번호로 시작한다(`Deno.test("documents/projects#R3: ...")`). 작업마다 최소한: route·event 이름 표가 architecture 5장과 같다, 예시 입력이 통과한다, 모르는 field·틀린 값·틀린 ID 접두사를 거절한다, 오류 코드가 공통 7종 안이다.

## skeleton

### T1 Deno workspace와 check 명령

- 상태: 완료 (#3)
- 등급: 기본
- concern: 저장소 바닥
- 요구: 없음(docs/dev/stack.md의 "check 명령 하나"와 판 고정)
- 자리: `deno.json`, `deno.lock`, `tools/check.ts`, `tools/check_test.ts`, `.gitignore`
- 쓰는 contract: 없음
- 내놓는 contract: `deno task check`
- slice: skeleton
- 선행: 없음
- 완료: 아래 확인이 통과한다
  - 루트 `deno.json`: `workspace: ["./packages/*", "./apps/*"]`(deno.json 없는 `apps/shell`은 지나간다), `imports`에 `zod`(npm 4.6.5)와 `@std/assert`(jsr) 판 고정, `lock.frozen: true`, lint에서 `no-slow-types` 제외(JSR 배포를 하지 않는다), fmt·lint 대상은 코드(ts, tsx, js, json, jsonc)이고 `docs/`·`open-issues.md`·`node_modules`·`.dev-data`·`.claude`·`dist`는 뺀다(lead 결정).
  - `tools/check.ts`: stack.md의 다섯 단계를 차례로 모두 돌리고 끝에 단계별 결과를 표로 보인다. 하나라도 실패면 exit 1. `deno test`는 `--allow-all --permit-no-files`로 돌고 `e2e/`는 뺀다(E2E는 `deno task e2e`로 따로 돈다). 4단계는 `apps/shell/main/package.json`이 없으면 "건너뜀: apps/shell/main 없음"을 결과 표에 따로 보인다.
  - `check_test.ts`: 단계 순서, 실패 집계, 건너뜀 표시를 주입한 runner로 확인한다.
  - 정한 판(Deno 2.9.7, zod 4.6.5, @std/assert)을 이 PR에서 docs/dev/stack.md에 적는다(lead 결정).

### T2 의존 규칙·이름·이식성 검사

- 상태: 완료 (#7)
- 등급: 기본
- concern: 저장소 바닥
- 요구: 없음(docs/dev/code-map.md 의존 규칙, docs/dev/architecture.md 이름, docs/dev/contracts.md)
- 자리: `tools/check-deps.ts`, `tools/deps-imports.ts`, `tools/deps-workspace.ts`, `tools/check-deps_test.ts`, `tools/check.ts`(1단계에 연결). fixture는 테스트가 임시 폴더에 만든다
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: skeleton
- 선행: contracts#T1
- 완료: 아래 확인이 통과한다
  - 정적 import·export·동적 import 문을 읽어 거절한다: base가 무엇이든 import, contracts가 base·zod 밖을 import, contracts·base의 `npm:`·`jsr:`·`node:`·URL specifier, `packages/<최상위>/<leaf>`가 같은 최상위 다른 leaf의 `mod.ts` 밖 파일을 import, 다른 최상위 package를 contracts 없이 import, `apps/shell`이 contracts·design·sdk 밖 package를 import, `contracts/<최상위>` 사이 순환.
  - `packages/`·`apps/`·`tools/` 경로와 파일 이름의 판·단계·작업 번호(`v2`, `m1`, `milestone`, `phase-2`, `w07`, `new-`, `old-`, `legacy-`, `-next`)를 거절한다.
  - contracts·base member `deno.json`에 `erasableSyntaxOnly`가 있는지 본다.
  - 규칙마다 통과·거절 fixture 테스트가 있다.

### T3 base: Result·오류 코드·Clock·IdSource·Random·Seq

- 상태: 완료 (#5)
- 등급: 기본
- concern: platform/ledger, platform/api (값만 base에 둔다)
- 요구: (작업별 요구 번호는 아래 "요구 번호" 절)
- 자리: `packages/base/` — `deno.json`, `mod.ts`, `result.ts`, `errors.ts`, `clock.ts`, `id.ts`, `random.ts`, `seq.ts`, 각 `_test.ts`
- 쓰는 contract: 없음
- 내놓는 contract: base 공통 값
- 받은 요청: platform(ErrorCode 7개, Result, Clock, IdSource, Seq), lophn-agent
- slice: skeleton
- 선행: contracts#T1
- 완료: 아래 확인이 통과한다
  - `ErrorCode`는 `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `unavailable`, `internal` 7개이고 이 순서다(docs/dev/architecture.md와 같다). `LophnError {code, message, details?}`, `Result<T, E = LophnError>`, `ok`·`err`, 원문 없이 `internal`로 바꾸는 helper.
  - `Clock {now(): string, nowMs(): number}`: `now()`는 `YYYY-MM-DDTHH:mm:ss.sssZ`만 낸다. `systemClock`, 테스트용 `manualClock`.
  - `RandomSource {fill(bytes)}`: `cryptoRandom`과 테스트용 결정적 source.
  - `createIdSource({clock, random})`의 `newId(prefix)`는 `<prefix>_<ulid>`를 낸다: 접두사 소문자 3자, ULID 소문자 Crockford 26자·첫 글자 `0`~`7`, 같은 밀리초 안에서 단조 증가. `parseId`. 접두사 목록 자체는 contracts/platform(T5)이 갖는다.
  - `Seq`: 십진 문자열(앞자리 0 없음, 0 이상 2^63−1 이하) ↔ bigint, 위치 P 다음 시작 위치 계산.

### T4 base: canonical JSON·sha256·log

- 상태: 완료 (#6)
- 등급: 기본
- concern: platform/ledger, platform/diagnostics (값만 base에 둔다)
- 요구: platform/ledger#R13; platform/diagnostics#R2, R3, R11
- 자리: `packages/base/` — `canonical-json.ts`, `hash.ts`, `log.ts`, 각 `_test.ts`
- 쓰는 contract: 없음
- 내놓는 contract: base 공통 값
- 받은 요청: platform(RFC 8785, sha256, 안전 log interface)
- slice: skeleton
- 선행: contracts#T1
- 완료: 아래 확인이 통과한다
  - `canonicalize(value)`: RFC 8785. UTF-16 code unit 순 key 정렬, ECMAScript 숫자 직렬화, NaN·Infinity·undefined·함수·bigint 거절. RFC 8785 부록의 예시가 같은 bytes로 나온다.
  - `sha256Hex(bytes | string)`(Web Crypto, async)와 `fingerprint(value) = sha256Hex(canonicalize(value))`.
  - `Logger`: level debug·info·warn·error, 기본 info. 기록은 `{at, level, component, event, message?, fields}`. sink와 field filter(redaction이 주입)를 받는다. 부르는 쪽은 sink를 기다리지 않고, 대기 bytes 한도(기본 1MiB)를 넘으면 버리고 버린 수를 다음 기록에 남긴다.

### T5 contracts/platform: transport·route 정의·envelope·오류·ID·client

- 상태: 완료 (#9)
- 등급: 기본
- concern: platform/api, platform/ledger
- 요구: platform/api#R1–R4, R6; platform/ledger#R5, R8, R9, R12–R14, R20; platform/identity#R10–R13; platform/security#R6, R8
- 자리: `packages/contracts/deno.json`, `packages/contracts/platform/` — `mod.ts`, `route.ts`, `envelope.ts`, `errors.ts`, `ids.ts`, `values.ts`, `limits.ts`, `client.ts`, 각 `_test.ts`
- 쓰는 contract: 없음
- 내놓는 contract: command, read (transport와 envelope)
- 받은 요청: platform(transport, command body·응답, read 응답, client, route kind `worker`, DerivedProvenance), shell(API client 모양), documents(route kind `file`), problems(route kind `worker`)
- slice: skeleton
- 선행: contracts#T3
- 완료: 아래 확인이 통과한다
  - `packages/contracts/deno.json`: `@lophn/contracts`, 최상위마다 exports(`./platform` → `./platform/mod.ts`), `erasableSyntaxOnly`.
  - `defineCommand`·`defineRead`·`defineFile`·`defineWorker`: `{resource, method, name, input, output, compare?, actors, errors, display_read?}`. 경로는 `POST /v1/<resource>/<method>` 정확히 세 구간, major는 1뿐. route kind는 `command | read | file | worker`다. file route는 worker로 넘겨 성공에 바이트와 Content-Type을 내고, worker route는 worker로 넘겨 JSON을 낸다(ledger queue를 거치지 않는다).
  - `CommandRequest {input, idempotency_key, compare, run?, prepared: [], confirmation?}`: key는 UTF-8 1~128 bytes, 본문 actor 없음. `CommandResponse {result, first_seq, last_seq, replayed}`(seq는 함께 null이거나 함께 값). read 공통 page 값 `as_of_seq`, `next_cursor`, 잘림·생략 범위.
  - `ErrorBody {error: {code, message, details?}}`와 HTTP 400·401·403·404·409·503·500 대응표.
  - 한도 상수: RPC JSON 256KiB·깊이 16·항목 4,096, header 8KiB.
  - ID 접두사 30개(domain-model/platform/ledger.md 표)와 접두사별 ID schema, `At`, `DurationMs`, `Seq`, `Sha256`, `ArchiveState`, `DerivedProvenance`.
  - `createRpcClient({baseUrl, token, fetch})`의 `call(route, body)`: 입력을 schema로 검사해 보내고 출력을 schema로 읽어 `Result`로 돌려준다. 재시도하지 않는다.

### T6 contracts/platform: identity·handler 등록·Tx port·감독 pipe·skeleton route

- 상태: 완료 (#13)
- 등급: 기본 (모든 팀의 ledger 모듈이 구현한다. platform 팀 review 필수)
- concern: platform/identity, platform/ledger, platform/api
- 요구: platform/identity#R1–R3, R6, R10, R11, R14; platform/ledger#R11; platform/backup-and-migration#R1
- 자리: `packages/contracts/platform/` — `identity.ts`, `registration.ts`, `ports.ts`, `supervision.ts`, `platform-routes.ts`, 각 `_test.ts`
- 쓰는 contract: command, read (T5)
- 내놓는 contract: 인증(actor·context 값), handler 등록 interface, 감독 pipe
- 받은 요청: platform(identity 값, 등록 interface, supervisor pipe, skeleton route, 2차의 credential_ref·launch spec·DiagnosticKind·app credential 요청·worker 전달·ledger_id), documents(Tx 안 동기 port), lophn-agent(같은 transaction의 다른 owner command dispatch), apps(Tx 조합 함수, AppConnection 진술에 쓰는 credential_ref·기한), problems(자식 process 메모리 상한), apps(DiagnosticKind 두 종류)
- slice: skeleton
- 선행: contracts#T5
- 완료: 아래 확인이 통과한다
  - identity: actor 다섯 종류(`user`, `coding_agent:<cac>`, `agent:<asg>`, `app:<app>`, `machine`)의 parse·format, `CredentialScope`, `CredentialConditions`(소유 concern이 정한 조건 값을 싣는 자리; 예: lophn-agent의 `AgentAppScope`), `AuthenticatedContext {principal, actor, scope, conditions, credential_ref, expires_at?}`. credential_ref는 token이 아닌 불투명 값이다. token 원문 field는 없다.
  - 등록 interface: `CommandDefinition {route, handle(tx, ctx, input, compare) → Result}`(동기, Promise 금지를 type으로 막는다), `ReadDefinition {route, handle(snapshot, ctx, input) → Result}`, `SchemaStep {id, sql}`, `Tx {sql 실행(prepare·run·get·all), emit(event, subject, payload) → seq, now(), newId(prefix), port(key), call(route, input, compare)}`, `ReadSnapshot {읽기 전용 sql, as_of_seq, port(key)}`. `tx.call`은 다른 owner가 `dispatchable`로 등록한 command를 같은 transaction·같은 actor로 부른다(approval 적용, FinishToolCall의 문서 저장, question option 적용).
  - port: `definePort<T>(name)`로 만든 typed key. 소유 contracts가 port interface를 선언하고(예: documents의 자리 이름 예약, coding-agent의 ticket claim 확인), core 조립이 구현을 주입한다.
  - 감독 pipe: 통로는 부모가 만든 child의 stdin(부모→자식)·stdout(자식→부모) pipe이고 그 위에 길이 prefix binary frame `[u32 BE 길이][u8 종류][u32 channel][payload]`를 쓴다(platform 팀 결정). 종류는 json(제어 메시지, UTF-8 JSON)·bytes(chunk, 최대 1MiB)·end·abort, channel 0은 제어이고 그 밖은 stream(blob.prepare, file 등)마다 하나, backpressure는 stream별 credit(json 메시지로 window를 준다). frame이 아닌 stdout 바이트는 protocol 위반이다. codec(encode·decode)은 이 작업의 `supervision.ts`에 둔다. 메시지: 부모→자식 `hello {core_epoch, process_identity, kind, task, scope, credential, api_port}`, 자식 `ready`, 부모 `stop {grace_ms}`, 자식 `stopped`, Electron main↔core 첫 메시지 `{user_token, api_port, core_epoch}`와 ready, worker 전달 요청·응답과 byte chunk 메시지, 앱 supervisor→core app credential 요청, diagnostic 메시지와 `DiagnosticKind` 고정 목록(lophn 내부, 출처 불명 관측, 잘못된 보고, shell main의 view 수명, apps의 invocation 후행 전달 손실 `{app, lost_messages, lost_bytes, first_lost_at, reason: memory_limit | non_retryable_error}`, apps의 log 줄 손실 `{app, invocation?, dropped_lines, reason: buffer_limit | unsafe_truncation}`). 진단 payload는 redaction 뒤 숫자·ID만 담는다. shell main의 diagnostics도 HTTP route가 아니라 이 메시지로 보낸다. 모든 신뢰 child와 Electron main↔core가 이 하나를 쓴다.
  - kind launch spec: 고정 entry, `--allow-read`·`--allow-write`·`--allow-net` 목록, 특정 실행 파일만의 `--allow-run`, 이름을 정한 `--allow-env`, 상시·요청 시 정책, 자식 process 메모리 상한. 메모리 상한 적용 결과는 `hard`(Linux cgroup v2, Windows Job Object) · `soft`(macOS의 V8 heap 상한과 process tree RSS watchdog)이고 어느 쪽도 못 걸면 `unavailable`이다(lead 결정). problems의 test result가 이 방식을 남긴다.
  - `H/run` 위치 metadata `{format: 1, api_port, core_epoch, started_at}`: core가 시작 때 쓰고 정상 종료 때 지운다. credential·token은 없다. coding-agent의 `lophn daemon status`와 MCP·CLI의 daemon 찾기가 읽는다.
  - route: `/v1/platform/status`(출력에 ledger 생성·복원마다 바뀌는 `ledger_id`), `/v1/platform/health`, `/v1/identity/current`, `/v1/commands/result`. `/v1/commands/result`는 자기 principal의 결과만 읽는다(platform·problems 합의).
  - type 수준 테스트: 예시 CommandDefinition이 `deno check`를 통과하고 async handler는 거절된다.

### T7 contracts/platform: event envelope·구독

- 상태: 완료 (#10)
- 등급: 기본
- concern: platform/api, platform/ledger
- 요구: platform/api#R5, R7; platform/ledger#R3, R8, R9, R15; platform/security#R8
- 자리: `packages/contracts/platform/` — `events.ts`, `event-stream.ts`, `registration.ts`(Tx에 cursor), 각 `_test.ts`
- 쓰는 contract: command, read (T5)
- 내놓는 contract: event 구독
- 받은 요청: platform(EventEnvelope, events/list, WS frame, close code), documents·problems(subscriber cursor, 반응 key)
- slice: skeleton
- 선행: contracts#T5
- 완료: 아래 확인이 통과한다
  - `EventEnvelope {seq, type, subject, actor, run, payload, at}`와 `defineEvent(type, {subject, payload})`. type은 `<Entity><과거형 동사>` PascalCase.
  - `/v1/events/list {after_seq, types?, subjects?, limit?}` → `{events, scanned_through_seq, head_seq, as_of_seq, next_cursor, omitted?}`, `/v1/events/advance-cursor`(`AdvanceSubscriberCursor`, 반응 key `(subscriber, cause_seq, reaction)`). `Tx.advanceSubscriberCursor(subscriber, through_seq)`로 반응 command와 cursor를 같은 transaction에 확정한다.
  - WS `GET /v1/events/subscribe`, subprotocol `lophn.events.1`, frame `subscribe {from_seq(포함), types, subjects, subscriber?, limit}`·`events`·`ack`·`unavailable`, close 1013(느린 구독)·1008(자격 회수), batch 256개·256KiB. 처리 위치 P 다음 `from_seq` 계산 helper.

### T8 contracts 모음·전역 유일성·coverage 도구

- 상태: 완료 (#17)
- 등급: 기본
- concern: 저장소 바닥
- 요구: 없음(architecture/README.md 4장)
- 자리: `packages/contracts/mod.ts`, `packages/contracts/registry_test.ts`, `tools/contract-coverage.ts`, `tools/contract-coverage_test.ts`, `deno.json`(task `contracts:coverage`), `docs/architecture/README.md`(4장 표)
- 쓰는 contract: T5, T7
- 내놓는 contract: `ALL_ROUTES`, `ALL_EVENTS`(core 조립이 route registry를 만들 때 쓴다)
- slice: skeleton
- 선행: contracts#T6, contracts#T7
- 완료: 아래 확인이 통과한다
  - 테스트: 모든 최상위의 `(resource, method)`, command 이름, event type, ID 접두사가 유일하고 contracts 사이 순환이 없다.
  - docs/architecture/README.md 4장 표에 "요구 덮기"의 "4장 표 밖의 최상위 사이 contract" 15행을 더한다(lead 결정). 그 뒤로 이 표들은 4장 표를 가리킨다.
  - `deno task contracts:coverage`: `docs/architecture/*.md` 5장의 `/v1/<resource>/<method>` 경로와 event 이름을 읽어 contracts에 있는 것·없는 것을 최상위·절마다 보인다. 이 작업에서는 보고만 하고 관문은 T46에서 켠다.

### T9 `deno task dev`

- 등급: 좁은
- concern: 저장소 바닥
- 요구: 없음(docs/dev/stack.md "개발 환경")
- 자리: `tools/dev.ts`, `tools/dev_test.ts`, `deno.json`(task `dev`, `dev:core`)
- 쓰는 contract: 감독 pipe(T6)
- 내놓는 contract: `deno task dev`, `deno task dev:core`
- slice: skeleton
- 선행: contracts#T1, platform#T9(core entry), lophn-agent#T2(fake provider), shell#T3(Electron main 시작과 core 띄우기)
- 완료: 아래 확인이 통과한다
  - `.dev-data/`를 만들고 `LOPHN_HOME=<저장소>/.dev-data`로 넘긴다. 실제 `~/.lophn`을 건드리지 않는다. core는 `deno run <권한> apps/core/main.ts [--port=<n>]`로 시작한다(platform 팀이 정함).
  - `deno task dev`는 `npm --prefix apps/shell/main run dev -- --home <저장소>/.dev-data`로 shell main을 띄운다(Electron main이 core를 띄우고 core가 나머지 신뢰 child를 띄운다). `deno task dev:core`는 core만 같은 데이터 root로 띄운다. shell이 없는데 `dev`를 부르면 이유를 말하고 끝난다.
  - `tools/fake-provider/`를 함께 띄우고 그 loopback 주소를 `LOPHN_FAKE_PROVIDER_URL`로 core에 넘긴다(그 값으로 개발 provider 정의를 seed하는 일은 lophn-agent#T3). 실제 provider는 `LOPHN_LIVE_PROVIDER=1`일 때만 쓴다.
  - Ctrl+C에 띄운 프로세스를 정리한다.
  - `dev_test.ts`: 데이터 root가 저장소 밖으로 가지 않고 인자가 정해진 대로 만들어진다.

### T10 E2E harness와 skeleton smoke

- 등급: 기본
- concern: 저장소 바닥
- 요구: 없음(docs/dev/tasks.md "테스트"의 E2E)
- 자리: `e2e/`(harness와 `e2e/flows/`, docs/plan/README.md "E2E"), `deno.json`(task `e2e`)
- 쓰는 contract: 감독 pipe(T6), platform status route(T6)
- 내놓는 contract: `deno task e2e [flow...]`, flow E2E 자리 `e2e/flows/<flow 이름>_test.ts`
- slice: skeleton
- 선행: contracts#T9, shell#T9(첫 창), platform#T9(core 시작)
- 완료: 아래 확인이 통과한다
  - harness: 임시 `LOPHN_HOME`, Playwright로 Electron shell 띄우기·닫기(Electron 실행 파일은 `apps/shell/main/node_modules/electron`에서 찾는다), `fixtures/` 아래 예시를 임시 폴더로 복사하는 helper. Deno test에서 Playwright의 Electron 실행이 되는지 먼저 확인한다. 안 되면 `e2e/`에만 Node용 `package.json`·lock을 두고 `deno task e2e`가 Node로 Playwright를 부른다(stack.md의 예외, lead 결정).
  - skeleton smoke: shell 창이 뜨고, core 준비 상태가 화면에 보이고, 창을 닫고 종료하면 core가 정상 종료한다.
  - skeleton smoke는 `e2e/flows/skeleton_test.ts`다. 다른 slice의 flow E2E는 docs/plan/README.md "E2E" 표의 팀이 이 자리에 쓴다.

## documents

### T11 contracts/platform: blob·pipe 작업 호출

- 상태: 완료 (#18)
- 등급: 기본
- concern: platform/blob-store
- 요구: platform/blob-store#R1, R3–R7, R9, R11–R13; platform/ledger#R22
- 자리: `packages/contracts/platform/` — `blob.ts`, `pipe-ops.ts`, `registration.ts`(Tx에 blob 참조 등록 추가), 각 `_test.ts`
- 쓰는 contract: T5, T6
- 내놓는 contract: blob
- 받은 요청: documents(blob.prepare stream, blob.read, purpose 이름 document_file·content_list·format_module·diagnostics·series_draft), problems(보존 등급), lophn-agent(blob prepare·read)
- slice: documents
- 선행: contracts#T6
- 완료: 아래 확인이 통과한다
  - `/v1/blobs/read`: 허용 owner·고정 판·field에서 해석한 참조와 바이트 구간 → `BlobReadResult`와 base64 bytes.
  - pipe 작업 `blob.prepare`: principal·등록 purpose·bytes stream chunk·예상 hash? → `PreparedBlob {preparation, principal, purpose, hash, size_bytes}`.
  - purpose 등록 모양과 `BlobFieldDefinition {owner_kind, field, retention(영구 | 상한 종류), 일반 읽기 허용}`: 소유 concern이 자기 contracts에 등록한다. `BlobReadResult`는 정리됨 같은 부재 이유를 구별한다.
  - 한도 상수: 준비 blob 1GiB, chunk 1MiB, JSON read 구간 256KiB, 준비 참조 수명 10분.
  - `Tx.registerBlobRef`.

### T12 contracts/platform: redaction

- 상태: 완료 (#23)
- 등급: 기본
- concern: platform/redaction
- 요구: platform/redaction#R2–R4, R6, R8–R12, R14, R15, R17
- 자리: `packages/contracts/platform/redaction.ts`, `redaction_test.ts`
- 쓰는 contract: T5, T11
- 내놓는 contract: redaction
- 받은 요청: platform(Redactor, 선언 모양, TrustClass), problems(글·JSON·stack·log redaction 함수 contract), lophn-agent, documents
- slice: documents
- 선행: contracts#T11
- 완료: 아래 확인이 통과한다
  - pipe 작업 `redaction.check`: `RedactionInput {source, media_type, audience, safe_fields, private_fields, private_regions}` → `RedactionResult {rule_revision, status, content, redacted_items, omissions}`, `Omission`.
  - 상수: 검사 단위 1MiB·깊이 16·항목 4,096·5초, 대체 문자 `*` 하나, 표본 64자·전체 2KiB, 화면 문자열 80자.
  - entry가 끼워 주는 `Redactor` interface, 안전 필드·private 필드·표본 경로 선언 모양, 자료 직렬화 interface와 `TrustClass`(platform 2차).

### T13 contracts/shell: confirmation window

- 상태: 완료 (#21)
- 등급: 기본
- concern: shell/confirmation-window, platform/identity
- 요구: shell/confirmation-window#R1, R4, R6, R9; platform/identity#R14; platform/secrets#R2; shell/app-frame#R7; shell/terminal#R10
- 자리: `packages/contracts/shell/` — `mod.ts`, `confirmation.ts`, `launch.ts`, 각 `_test.ts`; `packages/contracts/platform/confirmation-handle.ts`
- 쓰는 contract: T5, T6
- 내놓는 contract: confirmation window
- 받은 요청: shell(열기 요청 종류, 결과, IPC 이름, 실행 intent·창 열기 링크), platform(handle 등록, 설치의 `--quit`·`--tray`), coding-agent(확인 창 링크), problems(문제 결정 handle binding), documents(files.delete 사람 결정), lophn-agent(확인 창이 부르는 command의 handle·CAS·표시 read)
- slice: documents (organize-documents가 처음 지난다)
- 선행: contracts#T6
- 완료: 아래 확인이 통과한다
  - main service `confirmation.open({request, comparison, parentWindow})`: request는 `approval_request | question_option_action | owner_decision | secret_input`. shell 크롬의 외부 링크는 확인 없이 OS 브라우저로 열므로(D21) 종류에 없다. owner_decision은 `{concern, decision, targets, input, comparison}`이고 decision 이름은 소유 contracts가 등록한다.
  - 결과 `{outcome: "decided", receipt} | {outcome: "dismissed"}`. secret_input 결과에는 안전 참조·저장 결과만 있다.
  - IPC 이름과 payload schema: `shell:confirmation-open`, `confirmation:display`, `confirmation:submit {displayId, decision, input?}`, `confirmation:cancel`. preload API type(`lophnShell.openConfirmation`, `lophnConfirmation.getDisplay·submit·cancel`).
  - main↔core handle 등록 message: 창 ID·대상 참조·내용 기준 hash·허용 결정 집합·기한(발급 뒤 120초와 대상 기한 중 이른 것) → handle 참조. T5 `CommandRequest.confirmation`이 쓰는 참조 schema.
  - command·file·worker route 정의에 "사람 결정 handle 필요" 선언(`confirmation: "required"`)과 handle을 묶는 결합 대상 선언(입력에서 뽑는 필드, 예: files.delete의 canonical 경로·base_hash·동작)을 더한다. 이 선언이 있는 route는 `confirmation`이 없는 요청을 type과 schema에서 거절한다. file·worker route는 core가 handle을 메모리에서 소비한 뒤에만 worker로 넘기고 ledger에는 쓰지 않는다(platform#T56이 구현).
  - 확인 창을 여는 계기는 core event(`ApprovalRequestCreated`, `QuestionCreated`)를 main이 구독해 얻는다. 별도 열기 통로를 만들지 않는다.
  - shell 실행 intent와 창 열기 링크(shell 공통 파일 `packages/contracts/shell/launch.ts`): 링크 `lophn://things-to-confirm/<id>`, 실행 인자 `--open-app <app ID>`, `--tray`, `--quit`. coding-agent의 CLI `open`과 platform 설치·update가 쓴다.

### T14 contracts/documents: 공통 값·Address·project·자리 이름 port

- 상태: 완료 (#28)
- 등급: 기본
- concern: documents/addressing, documents/projects
- 요구: documents/addressing#R1–R4, R10; documents/projects#R1–R5, R7, R9, R12
- 자리: `packages/contracts/documents/` — `mod.ts`, `values.ts`, `address.ts`, `projects.ts`, `places.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6, T7
- 내놓는 contract: 파일 준비 결과(`/v1/projects/preview_tracking`), documents 도메인 command·read(project)
- 받은 요청: documents(Address 문법, project command·read, 자리 이름 예약 port), apps(app.create 안의 자리 이름 예약)
- slice: documents
- 선행: contracts#T7
- 완료: 아래 확인이 통과한다
  - `Slug`, `PlaceRef`, `Address`, `DocumentRef`, `ResolvedAddress` schema와 parse·format(shell·MCP·CLI가 같은 문법을 쓴다).
  - `/v1/projects/{create,update,set_tracking,archive,unarchive,list,get,resolve,preview_tracking}`, `TrackingPreview`, event `ProjectCreated`·`ProjectUpdated`·`ProjectTrackingChanged`·`ProjectArchived`·`ProjectUnarchived`.
  - port `PlaceNameReservation`(같은 transaction에서 이름 예약·현재 예약 확인).

### T15 contracts/documents: document·version·파일 준비 결과

- 상태: 완료 (#39)
- 등급: 기본
- concern: documents/versions, documents/file-tracking
- 요구: documents/versions#R1, R3, R6, R8–R10, R16
- 자리: `packages/contracts/documents/` — `documents.ts`, `versions.ts`, 각 `_test.ts`
- 쓰는 contract: T11, T14
- 내놓는 contract: 파일 준비 결과, documents 도메인 command·read(document)
- 받은 요청: documents(prepare·save·restore, PreparedVersion, FileObservationBasis, SaveResult, FormatRef)
- slice: documents
- 선행: contracts#T11, contracts#T14
- 완료: 아래 확인이 통과한다
  - `/v1/documents/{prepare,save,restore,update,set_source,archive,unarchive,move,rename,list,get,resolve,export}`.
  - `PreparedVersion`, `FileObservationBasis`, `SaveResult(saved | unchanged)`, `FormatRef`, `Document`, `Version`, `ContentFile`, `DocumentFileInput`(prepared blob 또는 기존 permanent 참조). prepare 입력은 hash metadata만 받지 않고 trusted content 참조의 purpose·hash·bytes를 결합한다. format 입력은 신규 MIME 기본 implicit 또는 기존 base_version의 exact contract를 쓰기 위해 생략할 수 있고 PreparedVersion 결과의 FormatRef는 필수다.
  - event `DocumentCreated`, `DocumentSaved`, `DocumentUpdated`, `DocumentSourceChanged`, `DocumentArchived`, `DocumentUnarchived`, `DocumentRestored`, `DocumentMoved`, `DocumentRenamed`.
  - document.move·rename은 `QuestionActionEvidence`로 actor=user 적용 경로를 갖는다(값 type은 T28, 여기서는 dispatchable 표시).

### T16 contracts/documents: 파일 쓰기

- 등급: 기본
- concern: documents/file-tracking
- 요구: documents/file-tracking#R2, R9, R11, R15, R16
- 자리: `packages/contracts/documents/files.ts`, `files_test.ts`
- 쓰는 contract: T5, T11, T13
- 내놓는 contract: 파일 쓰기
- 받은 요청: documents(files 경로, FileTarget, FileWriteRequest, FileOperationResult, FileStatus), shell
- slice: documents
- 선행: contracts#T13, contracts#T15
- 완료: 아래 확인이 통과한다
  - `/v1/files/{list,read,status,watch,write,rename,delete,record_result}`(read는 file route, record_result는 machine).
  - `FileTarget(project_file | working_copy | instruction_file)`, `FileWriteRequest`, `FileOperationResult`(`written | renamed | deleted | unverified`, `recorded | unverified`, version_result 다섯 값), `FileStatus`.
  - event `FileWritten`, `FileRenamed`, `FileDeleted`. files.delete의 사람 결정은 T13의 owner_decision으로 등록한다.

### T17 contracts/documents: format 실행

- 등급: 기본
- concern: documents/formats
- 요구: documents/formats#R1–R5, R8, R10–R17, R20
- 자리: `packages/contracts/documents/formats.ts`, `formats_test.ts`
- 쓰는 contract: T5, T11
- 내놓는 contract: format 실행
- 받은 요청: documents(FormatDeclaration, FormatDiagnostic, SectionExtractionResult, ExtractedSection)
- slice: documents
- 선행: contracts#T15
- 완료: 아래 확인이 통과한다
  - `/v1/formats/{list,get,validate,extract}`, 정확한 module_hash 입력, 검사 결과(passed/failed, 위치 있는 diagnostics), 추출 결과(`ready | unsupported | unverified | failed`와 section 값).
  - 내장 format별 media type 상수.

### T18 contracts/documents: outline·read·search·history·diff·guide

- 등급: 기본
- concern: documents/outline-and-search
- 요구: documents/outline-and-search#R1, R3–R8, R10–R12, R14, R18, R22, R23, R26
- 자리: `packages/contracts/documents/` — `outline.ts`, `read.ts`, `search.ts`, `guides.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T14, T15
- 내놓는 contract: outline·search 읽기
- 받은 요청: documents(OutlinePage, ReadResult, SearchResult, IndexCoverage, Section, LineRange, BundledGuide, cursor), lophn-agent, coding-agent, shell
- slice: documents
- 선행: contracts#T15
- 완료: 아래 확인이 통과한다
  - `/v1/outline/{root,place,context,document,series}`, `/v1/documents/{read,file,history,section_history,diff}`, `/v1/search/{query,status}`, `/v1/guides/{list,get,outline,read}`.
  - 예산 상수(root 1,500, place·context 3,000, document 2,000 추정 token·depth 2, 본문 12,000 codepoint, 추정 token = codepoint/3 올림), glossary 첫 page 30개.

### T19 contracts/documents: series·saved view

- 등급: 기본
- concern: documents/series, documents/outline-and-search
- 요구: documents/series#R1–R8, R11, R12
- 자리: `packages/contracts/documents/` — `series.ts`, `views.ts`, 각 `_test.ts`
- 쓰는 contract: T14, T15, T18
- 내놓는 contract: outline·search 읽기(saved view, series.next), documents 도메인 command(series, view)
- 받은 요청: documents
- slice: documents
- 선행: contracts#T18
- 완료: 아래 확인이 통과한다
  - `/v1/series/{list,get,next,create,update,set_draft,clear_draft,add_instance,update_instance,remove_instance,archive,unarchive}`, `NextSuggestion`, event `Series*` 9개.
  - `/v1/views/{list,get,open,save,update,delete}`, 정렬 값 4개, `document_status`, event `SavedViewCreated`·`SavedViewUpdated`·`SavedViewDeleted`.

### T20 contracts/apps: App 등록·실행 상태

- 상태: 완료 (#41)
- 등급: 기본
- concern: apps/registration, apps/runtime
- 요구: apps/registration#R2–R4, R8, R10; apps/runtime#R2, R13, R14, R18, R22, R25–R28; apps/automations#R4, R10; apps/data#R13
- 자리: `packages/contracts/apps/` — `mod.ts`, `apps.ts`, `runtime.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T7, T14(자리 이름 port)
- 내놓는 contract: 앱 영역 command·read(app)
- 받은 요청: apps(C-apps-1), documents(App 존재·status·slug read)
- slice: documents (documents가 자리 해석에 App read를 쓴다)
- 선행: contracts#T14
- 완료: 아래 확인이 통과한다
  - `/v1/apps/{create,connect_source,archive,unarchive,enable_execution,disable_execution,record_started,record_stopped,record_unavailable,list,get,runtime,logs,automations,export}`.
  - `App`(필수 revision은 그 App의 마지막 변경 event seq), `RuntimeState {state: preparing | stopped | running | unavailable, termination_pending, reason?}`, `RuntimeObservation`, `ReadyAttestation`. logs 입력은 `limit?`, `max_bytes?`(positive safe integer), 출력은 `{state: none | off | timeout | ok, lines, collected_at, truncated}`(최대 200줄·줄당 300자). `ok`의 빈 lines도 정상이고 부분 확보나 cap은 `truncated=true`다. snapshot caller는 `limit=30`, `max_bytes=65_536`을 쓴다.
  - event `AppCreated`, `AppSourceConnected`, `AppArchived`, `AppUnarchived`, `AppExecutionEnabled`, `AppExecutionDisabled`, `AppStarted`, `AppStopped`, `AppUnavailable`.

### T47 contracts/coding-agent: connection

- 상태: 완료 (#31)
- 등급: 기본
- concern: coding-agent/connection
- 요구: coding-agent/connection#R1–R4, R15, R17
- 자리: `packages/contracts/coding-agent/` — `mod.ts`, `connections.ts`, `connection-auth.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6, T7, T13
- 내놓는 contract: coding agent 통로(connection core RPC), connection 인증 port
- 받은 요청: coding-agent(1a), platform(인증이 매 요청 부르는 connection read, loader의 보호 전달 요청)
- slice: documents (coding-agent의 MCP·CLI 문서 tool과 platform 인증이 documents slice부터 쓴다)
- 선행: contracts#T13
- 완료: 아래 확인이 통과한다
  - `/v1/coding_agent_connections/{list,show,create,revoke}`, `ConnectionScope`(전체 / 앱 하나), revoke의 owner_decision 등록, 원문·hash 없는 connection 출력.
  - port `CodingAgentConnectionAuth(principal)` → `{connection, state, scope, token_digest}`: platform 인증이 매 요청 같은 read 연결로 부른다.
  - loader가 keychain credential의 보호 전달을 요청하는 message 모양(T6 감독 pipe 위).
  - event `CodingAgentConnectionCreated`, `CodingAgentConnectionRevoked`.

### T48 contracts/coding-agent: MCP·CLI 공통 출력과 문서 tool

- 등급: 기본
- concern: coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/mcp-server#R1, R3–R16; coding-agent/cli#R2–R5, R11–R15, R20, R22
- 자리: `packages/contracts/coding-agent/` — `output.ts`, `mcp-core.ts`, `cli-core.ts`, 각 `_test.ts`
- 쓰는 contract: T14–T19, T47
- 내놓는 contract: coding agent 통로(MCP·CLI 공통 출력, core toolset 문서 tool)
- 받은 요청: coding-agent(2a)
- slice: documents
- 선행: contracts#T19, contracts#T47
- 완료: 아래 확인이 통과한다
  - 성공 `{summary, data, next}`, 실패 `{code, message, details}`, MCP 결과는 `structuredContent`와 같은 뜻의 JSON text content를 둘 다 보낸다(Codex는 structured만, Gemini CLI·OpenCode는 text만 model에 넣는다), `effect_unknown` 진단, MCP protocol 오류 -32700·-32600·-32601·-32602와 `isError`, CLI exit 0·1·2·3·4·5·6, 범위 표기 `S / A / G / ALL`, toolset 규칙(`core` 기본, `app`은 `--toolsets core,app`·`LOPHN_MCP_TOOLSETS`, `ops`·`catalog`·`all` 거절), `readOnlyHint` 규칙.
  - MCP `lophn_index`, `lophn_project`, `lophn_document`, `lophn_read`, `lophn_save`, `lophn_format`, `lophn_series`의 op와 입력 schema(document list 1~500).
  - 대응 CLI `index`, `search`, `read`, `document list|history|diff`, `save`, `format`, `project`, `series`의 위치 인자·선택값과 공통 선택값(`--json`, `--connection`, `--daemon-url`, `--app`, `--base-revision`, `--idempotency-key`, `--input`·`--input-file`).

## context

context slice가 쓰는 contract(T21 context·term, T26–T28 agent run)는 모두 agent slice 작업으로 먼저 들어간다. context slice만의 contract 작업은 없다.

## agent

context slice는 agent 뒤다(docs/plan/README.md). 아래 묶음은 agent slice가 시작하기 전, 곧 documents slice 동안 main에 넣는다.

### T21 contracts/documents: context·term

- 등급: 기본
- concern: documents/contexts, documents/terms
- 요구: documents/contexts#R1, R2, R9–R11, R14; documents/terms#R1, R4
- 자리: `packages/contracts/documents/` — `contexts.ts`, `terms.ts`, 각 `_test.ts`
- 쓰는 contract: T14, T15, T18
- 내놓는 contract: documents 도메인 command·read(context, term)
- 받은 요청: documents, lophn-agent(context·term 변경 command)
- slice: agent (documents의 구현은 context slice지만 coding-agent의 context tool(T49)과 lophn-agent가 agent slice에서 contract를 먼저 쓴다)
- 선행: contracts#T18
- 완료: 아래 확인이 통과한다
  - `/v1/contexts/{create,update,set_item,remove_item,archive,unarchive,record_watch_change,list,get,related,export}`, `/v1/terms/{propose,define,update,archive,unarchive,list,get}`.
  - event `Context*` 7개, `Term*` 5개. term.define은 사람 또는 `QuestionActionEvidence` 경로만 받는다.

### T22 contracts/platform: approval·notification

- 상태: 완료 (#30)
- 등급: 기본
- concern: platform/approvals, platform/notifications
- 요구: platform/approvals#R1–R10, R12–R15; platform/notifications#R1–R5, R9, R10; platform/backup-and-migration#R16
- 자리: `packages/contracts/platform/` — `approvals.ts`, `notifications.ts`, `registration.ts`(approval 사용), 각 `_test.ts`
- 쓰는 contract: T5, T6, T7, T13, T4(fingerprint)
- 내놓는 contract: approval, notification
- 받은 요청: platform(ApprovalAction·ApprovalEffect·ApprovalUse, binding hash, `Tx.useApproval`, Notification), lophn-agent(approval request 생성·한 번 사용), apps(confirm invocation의 approval 사용), shell(대기 목록·결정 command에 handle 결합)
- slice: agent
- 선행: contracts#T13
- 완료: 아래 확인이 통과한다
  - `/v1/approvals/{get,list,create,grant,reject,expire,cancel,apply}`, `ApprovalRequest`, action `{concern, command, caller, targets, input, comparison}`, `input_hash`·`binding_hash`는 RFC 8785 정규화의 sha256, `ApprovalUse`.
  - `/v1/notifications/{get,list,create,read}`, `Notification`, 계기 event 표 상수(platform 5.10).
  - event `ApprovalRequest*` 5개, `NotificationCreated`, `NotificationRead`. grant·reject는 `confirmation` 필수.
  - `Tx.useApproval`: 정확한 action 일치 확인과 approval_uses 기록을 소유 변경과 같은 transaction에서 한다.
  - notification 계기 표는 source event 이름과 생성 조건만 적는다. payload type은 소유 contracts(T21, T26, T27, T28, T36, T40, T41)에서 가져오고, 아직 없는 소유 event는 그 작업이 들어올 때 표에 이어 붙인다.

### T23 contracts/platform: secret

- 상태: 완료 (#36)
- 등급: 기본
- concern: platform/secrets
- 요구: platform/secrets#R1–R9, R11, R12
- 자리: `packages/contracts/platform/secrets.ts`, `secrets_test.ts`
- 쓰는 contract: T5, T6, T11, T13
- 내놓는 contract: secret
- 받은 요청: lophn-agent(secret 전송 부착·refresh 결과 보관), apps(앱 secret 사용), shell(보호 입력 → 안전 참조)
- slice: agent
- 선행: contracts#T13
- 완료: 아래 확인이 통과한다
  - `/v1/secrets/{list,set,remove,cleanup}`, `SecretPreparation`, cleanup 결과 `reference_blocked / os_deleted / processes_ended`.
  - 내부 pipe 작업 `secret.prepare`, `secret.send`(전송 부착), 갱신 결과 저장의 입력·출력·오류. 값 field는 callback 메모리 type으로만 둔다.
  - export·import 형식 상수(format 1, Argon2id 64MiB·3회·parallelism 1·salt 16 bytes, AES-256-GCM nonce 12 bytes).
  - event `SecretSet`, `SecretRemoved`.
  - main↔core private comparison request·response는 표시 revision으로 이전 참조 CAS를 얻고, parent/child·HTTP·renderer에는 열지 않는다.

### T24 contracts/platform: settings registry

- 상태: 완료 (#12)
- 등급: 기본
- concern: platform/settings
- 요구: platform/settings#R1, R3, R5, R9–R15, R19, R20, R25–R29, R31
- 자리: `packages/contracts/platform/settings.ts`, `settings_test.ts`
- 쓰는 contract: T5, T6, T7
- 내놓는 contract: settings(4장 표 밖, T8에서 4장 표에 더함)
- 받은 요청: lophn-agent(run 한도, MCP server 설정·tool 분류, skill root, catalog 자동 갱신), shell(theme override, 읽기 폭, OS notification opt-in)
- slice: agent
- 선행: contracts#T7
- 완료: 아래 확인이 통과한다
  - `/v1/settings/{definitions,get,history,apply,reload}`, `EffectiveSetting`, 판 이력.
  - `SettingDefinition` 등록 모양: 이름·한 줄 설명·값의 뜻·영향 기능·위험·되돌림·적용 시점의 message key와 schema. 설명 없는 정의는 type에서 막는다. 소유 concern이 자기 contracts에 정의를 둔다.
  - event `SettingsChanged`, `SettingsReloaded`.

### T25 contracts/shell: 현재 보기 상태

- 상태: 완료 (#38)
- 등급: 기본
- concern: shell/workspace
- 요구: shell/workspace#R1, R3, R9–R11; platform/redaction#R12
- 자리: `packages/contracts/shell/workspace.ts`, `workspace_test.ts`, `packages/contracts/platform/route.ts`(kind `memory`)
- 쓰는 contract: T5, T14
- 내놓는 contract: 현재 보기 상태(4장 표 밖, T8에서 4장 표에 더함)
- 받은 요청: shell(CurrentViewState, relay message), platform(relay route 넷, route kind `memory`), lophn-agent(observed_at·generation 포함)
- slice: agent
- 선행: contracts#T14
- 완료: 아래 확인이 통과한다
  - `CurrentViewState {window_ref, generation, observed_at, project, tabs, focused_pane, selection, app_view, availability: current | disconnected | unavailable, omissions}`. selection은 판·절·줄 범위만, app_view는 app·release·mode·surface·view generation만.
  - 상수: 요약 2048 bytes, 탭 page 20개.
  - workspace relay route(core 메모리, platform#T57 구현): `/v1/workspace/publish {window_ref, generation, observed_at, summary(2048 bytes 이하), tab_pages}`, `/v1/workspace/bind {session, window_ref}`, `/v1/workspace/unpublish {window_ref}`는 user만, `/v1/workspace/read {session, page?}` → `{availability: current, observed_at, generation, summary, tab_page?, next_page?} | {availability: disconnected | unavailable, reason}`는 agent만. `page`는 요청하는 tab page index, `next_page`는 다음 index이고 `tab_page`는 최대 20개의 typed tab 참조다. summary만 받는 첫 read는 `tab_page`를 생략할 수 있다.
  - ledger를 쓰지 않는 core 메모리 route를 위해 route kind `memory`와 `defineMemory`를 T5의 route 정의에 더한다(platform 추천). relay route는 contracts/shell에 둔다. CurrentViewState가 shell 값이고, contracts/platform이 contracts/shell을 가리키면 최상위 사이 순환이 되기 때문이다.

### T26 contracts/lophn-agent: run·session·message·occurrence

- 등급: 기본
- concern: lophn-agent/harness/run-loop, lophn-agent/harness/waiting-and-recovery, lophn-agent/conversation, lophn-agent/scheduling
- 요구: lophn-agent/conversation#R1–R5, R7–R10, R12–R14, R16, R17; lophn-agent/harness/run-loop#R1–R3, R6, R7, R18–R20; lophn-agent/harness/waiting-and-recovery#R1, R3, R5–R7, R10; lophn-agent/scheduling#R1, R4–R7; lophn-agent/handoff#R3, R8; lophn-agent/harness/prompt-assemble#R19, R20; lophn-agent/roles/operator#R6
- 자리: `packages/contracts/lophn-agent/` — `mod.ts`, `runs.ts`, `sessions.ts`, `messages.ts`, `occurrences.ts`, `scope.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6, T7, T25
- 내놓는 contract: agent run
- 받은 요청: lophn-agent(A1, A2의 session·message, A7의 MessageContent, AgentAppScope), shell(요청·steering·stop·재개)
- slice: agent
- 선행: contracts#T25
- 완료: 아래 확인이 통과한다
  - `/v1/runs/{accept,start,checkpoint,finish,stop,confirm-next,wait,resolve-wait,correct-waiting,recover,read,list,result}`, `/v1/assignment-occurrences/{process,list}`, `/v1/sessions/{open,change-work-place,close,read,list}`, `/v1/messages/{receive,execute-stored,record,apply,assign,list}`.
  - `Run`, run source(사람 Message / 주기 회차 / handoff), `Session`, `Message`(mode correction·request), `MessageContent`(text·visual 블록 순서).
  - `AgentAppScope {role, assignment, apps: [{app, commands, effects, revert_required, confirm_allowed}]}`: StartRun 때 `agent:<asg>` credential의 conditions로 실린다.
  - event `Run*` 7개, `Session*` 3개, `Message*` 4개, `AssignmentScheduleAdvanced`.

### T27 contracts/lophn-agent: preset·assignment

- 등급: 기본
- concern: lophn-agent/presets, lophn-agent/assignments, lophn-agent/instructions
- 요구: lophn-agent/presets#R1–R3, R5–R7, R9, R11, R13, R15, R16; lophn-agent/assignments#R2–R6, R9, R10, R16, R17; lophn-agent/extensions#R30, R31; lophn-agent/scheduling#R1, R3; lophn-agent/harness/provider#R8; lophn-agent/harness/model#R8; lophn-agent/harness/tools#R10; lophn-agent/roles/context-engineer#R12
- 자리: `packages/contracts/lophn-agent/` — `presets.ts`, `assignments.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6, T22
- 내놓는 contract: agent run(preset·assignment)
- 받은 요청: lophn-agent(A2, 지침 첨부·Operator 출력 read), documents(지침 값, 같은 transaction의 지침 첨부·Operator 출력 port)
- slice: agent
- 선행: contracts#T26
- 완료: 아래 확인이 통과한다
  - `/v1/presets/{register-default,create,revise,read,list,instruction-attachments}`, `/v1/assignments/{create-builtin,create-app-engineer,apply-operator,change-preset,pause,resume,withdraw,read,list,outputs}`. instruction-attachments는 {document} → 그 문서를 지침으로 붙인 preset·revision 목록(현재 assignment가 쓰는 판인지 표시), outputs는 {document} → 그 문서를 출력으로 가진 Operator `{assignment, revision, state}` 또는 없음.
  - `Preset` 구성, `OperatorApprovalBundle`. apply-operator는 approval과 confirmation 표시 read(assignments/read)를 짝짓는다.
  - lophn-agent/instructions의 지침 값 `InstructionLocation {layer: global | project | app, place}`, `InstructionAttachment {preset, revision, document, order}`. LOPHN.md 자리 규칙은 documents가 갖고, documents의 `FileTarget`·`FileObservationBasis`의 instruction_file 가지가 `InstructionLocation`을 가리킨다.
  - documents가 document.save·move·set_source의 transaction에서 현재 상태로 판정하는 port 두 개(구현 lophn-agent): `InstructionAttachments(document) → {preset, revision}[]`(비어 있지 않으면 agent·coding_agent·app 쓰기 forbidden, documents/versions#R20), `OperatorOutput(document) → {assignment, revision, state} | null`.
  - event `PresetCreated`, `PresetRevised`, `Assignment*` 5개.

### T28 contracts/lophn-agent: question·handoff·revert

- 등급: 기본
- concern: lophn-agent/questions, lophn-agent/handoff, lophn-agent/revert
- 요구: lophn-agent/questions#R2–R4, R6–R10, R13, R14, R16; lophn-agent/handoff#R1–R3, R8, R9; lophn-agent/revert#R1, R3, R4, R6, R7, R10, R11; lophn-agent/roles/app-engineer#R7; lophn-agent/roles/lophn#R5, R21, R22
- 자리: `packages/contracts/lophn-agent/` — `questions.ts`, `handoffs.ts`, `reverts.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6, T13, T22
- 내놓는 contract: agent run(질문·handoff·revert)
- 받은 요청: lophn-agent(A3, A7의 QuestionOptionAction), platform(QuestionActionEvidence), shell
- slice: agent
- 선행: contracts#T26
- 완료: 아래 확인이 통과한다
  - `/v1/questions/{create,answer,defer,cancel,expire,apply-option,read,list}`, `/v1/handoffs/{submit,status,result}`, `/v1/reverts/{checkpoint,finish,apply,preview,list}`.
  - `QuestionOptionAction {concern, command, targets, input, comparison}`(owner가 dispatchable command를 등록), `QuestionActionEvidence`. answer·revert_run은 confirmation과 표시 read(questions/read, reverts/preview)를 짝짓는다.
  - event `QuestionCreated`, `QuestionAnswered`, `QuestionExpired`, `QuestionCancelled`, `RevertStarted`, `RevertApplied`, `RevertBlocked`, `RevertFinished`.

### T29 contracts/lophn-agent: provider·credential·model call·catalog

- 등급: 기본
- concern: lophn-agent/harness/provider, lophn-agent/harness/model, lophn-agent/harness/usage
- 요구: lophn-agent/harness/provider#R1–R6, R8, R9, R11–R13, R16, R19–R23, R25–R27, R29, R30; lophn-agent/harness/model#R1–R3, R5, R7–R13, R15–R20; lophn-agent/harness/usage#R2–R9; lophn-agent/harness/prompt-assemble#R1, R8, R9, R19, R25, R26, R28; lophn-agent/instructions#R7, R8; lophn-agent/harness/run-loop#R11
- 자리: `packages/contracts/lophn-agent/` — `providers.ts`, `model-calls.ts`, `models.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6, T23
- 내놓는 contract: agent run(provider·model call 기록). model 호출 자체(`invokeModelCall`)는 다른 최상위가 부르지 않으므로 lophn-agent 안쪽에 둔다.
- 받은 요청: lophn-agent(A4), shell(connect-provider, OAuth 입력은 secret 입력), lead(D31: Anthropic은 API key만, OAuth는 ChatGPT의 Sign in with ChatGPT와 xAI의 SuperGrok만; Claude OAuth 자리는 두지 않는다)
- slice: agent
- 선행: contracts#T23, contracts#T26
- 완료: 아래 확인이 통과한다
  - `/v1/providers/{register,change,record-check,read,list,login-begin,login-complete,login-cancel,test}`, `/v1/provider-credentials/{register,change,refresh-result,record-availability,list}`, `/v1/model-calls/{start,finish,supplement,read,list}`, `/v1/agent-model-defaults/{change,read}`, `/v1/agent-model-catalog/{read,refresh}`.
  - protocol 이름 `anthropic-messages`, `openai-responses`, `openai-chat-completions`. ModelCall 결과 `complete / partial / failed / cancelled / uncertain`, cost 종류 `reported / estimated / subscription / free / unknown`.
  - event `ProviderRegistered`, `ProviderChanged`, `ProviderChecked`, `ModelDefaultsChanged`, `ModelCallStarted`, `ModelCallFinished`, `ModelCallSupplemented`.

### T30 contracts/lophn-agent: tool call·trace·usage·visual block

- 등급: 기본
- concern: lophn-agent/harness/tools, lophn-agent/observability, lophn-agent/visuals
- 요구: lophn-agent/harness/tools#R1–R4, R6–R16, R18–R20; lophn-agent/harness/tool-judgment#R1–R3, R5, R8–R12; lophn-agent/harness/run-loop#R13, R15; lophn-agent/harness/waiting-and-recovery#R2, R3, R5, R10; lophn-agent/extensions#R6, R7, R12, R13, R16, R19, R22, R23, R25–R29; lophn-agent/observability#R1–R10, R14, R16–R20, R25, R26; lophn-agent/harness/usage#R5–R10; lophn-agent/visuals#R1–R7
- 자리: `packages/contracts/lophn-agent/` — `tool-calls.ts`, `traces.ts`, `visuals.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6, T26
- 내놓는 contract: agent run(tool call·trace), 시각 블록(4장 표 밖, T8에서 4장 표에 더함)
- 받은 요청: lophn-agent(A5, A7의 VisualBlock), shell(블록 schema·문서로 남기기)
- slice: agent
- 선행: contracts#T24, contracts#T26
- 완료: 아래 확인이 통과한다
  - `/v1/tool-calls/{request,decide,start,finish,record-read,supplement,read,list}`, `/v1/agent-traces/{read,export}`, `/v1/agent-usage/read`. tool 결과 `success / failure / not_executed / uncertain`.
  - `VisualBlock`(표, bar·line·scatter, node·edge 도표, 앱 카드 참조)과 상한.
  - event `ToolCallRequested`, `ToolCallDecided`, `ToolCallStarted`, `ToolCallFinished`, `ToolCallSupplemented`.
  - 외부 MCP 서버 설정 정의(transport stdio·Streamable HTTP, 인증 none·bearer·API-key·OAuth 2.1, call timeout 1~600초, tool 분류 read·write·external)를 T24의 `SettingDefinition` 모양으로 둔다. ToolCall의 MCP 출처 field(server, 원래 이름, 설정 판, canonical 이름 `ext_<server>_<tool>`).
  - 내장 tool 이름과 입력 schema는 다른 최상위가 부르지 않으므로 contract로 두지 않는다(lophn-agent/harness/tools 안쪽). 역할별 tool 목록 요구(roles/*)도 그래서 이 작업의 요구에 넣지 않았다.

### T31 base: 주기 시점 계산

- 상태: 완료 (#8)
- 등급: 좁은
- concern: lophn-agent/scheduling, apps/automations (순수 계산만 base에 둔다)
- 요구: lophn-agent/scheduling#R2, R3, R6; apps/automations#R3
- 자리: `packages/base/schedule.ts`, `schedule_test.ts`
- 쓰는 contract: 없음
- 내놓는 contract: base 공통 값
- 받은 요청: lophn-agent(scheduling#R2의 앱 runtime scheduler 재사용)
- slice: agent
- 선행: contracts#T3
- 완료: 아래 확인이 통과한다
  - `dueTimes({first_at, every_ms, last_due_at, now})` → `{latest_due_at, missed_count, next_due_at}`. 밀리초 정수, UTC ISO 밀리초 문자열. last_due_at이 null이면 first_at부터 센다. now < first_at이면 latest_due_at은 null이다. missed_count는 latest_due_at 앞의 놓친 회차 수(latest 자신 제외)다(가장 최근 하나만 처리하고 앞은 놓침으로 기록, lophn-agent/scheduling#R6).
  - 경계: 첫 시점 전, 정확히 경계, 여러 주기 놓침, every_ms 0 이하 거절.

### T49 contracts/coding-agent: 질문·approval·context tool

- 등급: 좁은
- concern: coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/mcp-server#R17, R18; coding-agent/cli#R18, R19, R21
- 자리: `packages/contracts/coding-agent/` — `mcp-decisions.ts`, `cli-decisions.ts`, 각 `_test.ts`
- 쓰는 contract: T21, T22, T28, T48
- 내놓는 contract: coding agent 통로(core toolset 질문·approval·context tool)
- 받은 요청: coding-agent(2b)
- slice: agent
- 선행: contracts#T21, contracts#T22, contracts#T28, contracts#T48
- 완료: 아래 확인이 통과한다
  - MCP `lophn_question`(`list`, `show`), `lophn_approval`(`list`, `show`), `lophn_context`(`list`, `show`, `items`, `glossary`, `of`, `propose`)의 op와 입력 schema. answer·allow·reject·consume op는 없다.
  - CLI `question list|show|open`, `approval list|show|open`, `context list|show|items|glossary|of|propose`.

## apps

### T32 contracts/problems: problem code 선언·test 실행

- 상태: 완료 (#42)
- 등급: 기본
- concern: problems/problem-codes, problems/tests
- 요구: problems/problem-codes#R1, R2, R5, R6; problems/tests#R2, R4, R16, R19, R20
- 자리: `packages/contracts/problems/` — `mod.ts`, `problem-codes.ts`, `tests.ts`, `test-frames.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T7, T11
- 내놓는 contract: test 실행, problem code 선언(blueprint가 쓴다)
- 받은 요청: problems(C-c, ProblemCodeDeclaration, 예약 code catalog), apps(Verification read: bundle_hash·kind·pass)
- slice: apps
- 선행: contracts#T11
- 완료: 아래 확인이 통과한다
  - `ProblemCodeDeclaration {code ^[a-z][a-z0-9_]{1,47}$, message_key, message, fixer}`, 예약 code 3개(`_exception`, `_feedback`, `_invalid_report`)와 message key·en 값.
  - `/v1/problems/{request-test,record-verification,get-test-request,get-verification,list-verifications}`, `Verification`, `TestTarget`, `FrozenTest`, `TestMethod`(실행 파일을 제외한 argv `['test', ...]`·cwd·timeout_ms·기대 종료값·환경 hash), `TicketTestLink {ticket, check_index, check_hash, completion_seq}`(check_index는 ticket 조건의 position, check_hash는 그 조건의 RFC 8785 정규 JSON sha256; problems·coding-agent 이름 차이를 problems 쪽 이름으로 정했다), `ExecutionEvidence`, kind `app_test / reproduction / test_command`, 결과 `inconclusive` 포함. `request_principal`은 actor kind가 아닌 stable opaque 참조이며 GetTestRequest는 인증 principal+key로 읽고 RecordVerification은 accepted request record와 대조한다. runner만 고정 absolute Deno executable을 선택하고 현재 permission scope·realpath/symlink·lifecycle·memory·실제 판정을 검사한다.
  - test child 관측 frame `{side, test_hash, name, actual, symptom_reproduced?, expectation_met?, reason}`, frame 65,536 bytes·side 1MiB.
  - event `VerificationRecorded`.

### T33 contracts/apps: blueprint·permission·agent-context

- 등급: 기본
- concern: apps/blueprint, apps/permissions, apps/agent-context, apps/sdk
- 요구: apps/blueprint#R1, R4–R6, R10–R16, R18–R22; apps/agent-context#R1–R5; apps/automations#R1, R2, R13; apps/connections#R1; apps/permissions#R3, R5, R7–R10, R12–R14, R26, R27; apps/sdk#R2–R4, R7, R34
- 자리: `packages/contracts/apps/` — `blueprint.ts`(의존성 없는 정식 검증기), `permissions.ts`, `agent-context.ts`, `packages.ts`, 각 `_test.ts`
- 쓰는 contract: T32(problem code 선언)
- 내놓는 contract: blueprint(4장 표 밖, T8에서 4장 표에 더함), 앱 통로의 agent-context 값
- 받은 요청: apps(C-apps-2, agent-context 값), problems(release의 problem code 선언), lophn-agent(agent_context·annotation_targets·카드 화면), coding-agent(blueprint read)
- slice: apps
- 선행: contracts#T32
- 완료: 아래 확인이 통과한다
  - `Blueprint`, `ScreenDeclaration(sizes full | panel | card)`, `CommandDeclaration(effect read | write | external, confirm, input, revert)`, `CommandRevertDeclaration`, InputSchema 부분집합, `PermissionRequirement`, `AutomationDeclaration`, `DocumentDeclaration`, `SDKDependency`, `AgentContextDeclaration`, `AnnotationTargetDeclaration`, `AppCommandUseDeclaration`, `PermissionScope` 종류(fs.read, fs.write, net.fetch, net.listen, secret.use, document.save, app.call, agent.commands, automation.run).
  - blueprint 검증기는 apps/blueprint#R16에 따라 의존성 없는 하나의 정식 schema다. import 없는 순수 TS로 쓰고(Zod 없음) 이 파일 하나가 정본이며 `@lophn/blueprint`(packages/sdk)는 이것을 다시 내보낸다(apps 팀 합의, lead 승인).
  - 검증기에 들어갈 것(apps 팀 요청): InputSchema 부분집합(type 하나, enum, default, properties·required·`additionalProperties: false`, items, min/max Items·Length, minimum/maximum; `$ref`·`oneOf`·`format`·모르는 keyword 거절), default 적용 뒤 RFC 8785 정규 JSON의 sha256 input hash, 목록 key 정렬·object key 정렬·중복 거절·모르는 field와 옛 `context` 거절, revert 규칙(read·external은 supported=false, write의 supported=true면 같은 blueprint의 다른 write command), automation(`on_start` 또는 `interval_ms` ≥ 60000, command confirm=false, 고정 입력이 schema 통과), agent_context(read_command는 effect=read·confirm=false, write_command는 effect=write), app_connections(자기 앱 금지, commands 중복·wildcard 금지). 요구별 판정 테스트는 apps#T2가 apps 요구 번호로 쓴다.
  - `ScreenContextReadInput`, `AppScreenContext`(summary 2048 bytes), `AnnotationWriteInput`, `Package(kind component | capability | domain | format)`, `PackageVersion`.

### T34 contracts/apps: 앱 통로·앱 시작 입력

- 등급: 기본
- concern: apps/runtime, apps/connections, apps/agent-context
- 요구: apps/runtime#R2, R5, R7–R9, R11, R12, R15, R18, R31; apps/connections#R5–R7; apps/invocations#R7, R8, R14, R16, R17, R19; apps/automations#R5, R6, R9, R12; apps/sdk#R23, R27, R28, R30, R31, R40; apps/preview#R3, R7
- 자리: `packages/contracts/apps/` — `channel.ts`, `direct-socket.ts`, `broker.ts`, `channel-client.ts`, `app-start.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6, T33, T26(AgentAppScope)
- 내놓는 contract: 앱 통로
- 받은 요청: apps(C-apps-3), shell(screens proxy, commands/invoke), lophn-agent(agent 앱 통로, AgentCallOrigin), problems(test runner가 같은 앱 진입점을 띄운다), coding-agent(preview·read direct call)
- slice: apps
- 선행: contracts#T33
- 완료: 아래 확인이 통과한다
  - `POST /v1/apps/connect {app, mode: live | preview, screens, screen_sizes, commands, caller?, preview_nonce?}` → `{endpoint, connection}`, `AppConnection`, `AppScreenRequest`.
  - direct socket 경로(core API 아님): `GET /screens/<screen>/<path>`, `POST /_lophn/commands/{invoke,cancel,status}`, `POST /_lophn/control/{probe,open,close,shutdown}`. invoke 입력·출력과 revert 결과 `{result, revert: {invocation, receipt, expected_revision}}`.
  - broker 경로 `/_lophn/broker/{ready, invocations/submit, control/watch, automations/try_acquire, automations/release, net/fetch, secrets/use, documents/save, problems/report, apps/connect}`의 입력·출력.
  - `ConfirmExecutionProof`, `InvocationCaller`, `AppCallOrigin`(앱 수 상한 8), `AgentCallOrigin`.
  - 앱 read command 결과에 붙는 원천 상태·coverage·freshness·이어 읽기 기준(apps/invocations#R14).
  - 앱 시작 초기 입력(stdin JSON 한 줄)과 socket 경로 규칙, confirm marker 상한 4096.
  - `createAppChannelClient`: transport를 주입받는 작은 client(MCP·CLI·agent runtime·shell main이 함께 쓴다).

### T35 contracts/apps: invocation 전달

- 등급: 좁은
- concern: apps/invocations
- 요구: apps/invocations#R2–R4, R6–R11, R16–R19
- 자리: `packages/contracts/apps/invocations.ts`, `invocations_test.ts`
- 쓰는 contract: T5, T7, T22, T34
- 내놓는 contract: invocation 전달
- 받은 요청: apps(C-apps-4), problems(invocation 도착 여부 read)
- slice: apps
- 선행: contracts#T34
- 완료: 아래 확인이 통과한다
  - `/v1/invocations/{accept_confirm,record_started,record_finished,record_denied,list,get}`, `Invocation`, operation `command | start | data_change`, trigger `direct | automation | activation | restart`, status `accepted | running | succeeded | failed | denied | unknown`, summary 16KiB.
  - event `InvocationAccepted`, `InvocationStarted`, `InvocationFinished`, `InvocationDenied`.

### T36 contracts/apps: release 준비·적용·data job

- 등급: 기본
- concern: apps/releases, apps/data
- 요구: apps/releases#R1, R4–R10, R12–R16, R18, R19; apps/data#R3, R9, R10; apps/blueprint#R17
- 자리: `packages/contracts/apps/` — `releases.ts`, `data-job.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T7, T11, T22, T32, T41(ticket claim 확인 port)
- 내놓는 contract: release 준비·적용
- 받은 요청: apps(C-apps-5), problems(release read, 활성 release, ReleaseActivated, data migration 검사 job), coding-agent(연결 source의 고정 bundle·ticket 출처)
- slice: apps
- 선행: contracts#T35, contracts#T41
- 완료: 아래 확인이 통과한다
  - `/v1/releases/{prepare_bundle,preparation,cancel_preparation,prepare,start_activation,record_backup,record_data_change,record_data_restore,complete_activation,fail_activation,list,get,compare}`.
  - `Release`, `TicketSource {ticket, claim_seq}`, `Activation`, `BundleManifest`, `DataChange`, `DataResult`, `ReleaseComparison`. 상한 상수(source 64MiB, bundle 256MiB, 파일 10000개, 준비 300000ms, blueprint 추출 10초).
  - data worker job(`apps/worker` kind=data)의 입력·결과.
  - event `ReleasePrepared`, `ReleaseActivationStarted`, `ReleaseBackupRecorded`, `ReleaseDataChanged`, `ReleaseDataRestored`, `ReleaseActivated`, `ReleaseSuperseded`, `ReleaseActivationFailed`.

### T37 contracts/apps: grant·package·preview

- 등급: 기본
- concern: apps/permissions, apps/sdk, apps/preview
- 요구: apps/permissions#R1, R3, R5–R14, R21, R26–R29; apps/preview#R1–R3, R7, R9; apps/sdk#R3–R8, R13
- 자리: `packages/contracts/apps/` — `grants.ts`, `package-routes.ts`, `previews.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T7, T22, T33
- 내놓는 contract: 앱 영역 command·read(grant, package, preview)
- 받은 요청: apps(C-apps-6, C-apps-7, automation.run)
- slice: apps
- 선행: contracts#T33
- 완료: 아래 확인이 통과한다
  - `/v1/grants/{create,revoke,list}`, `Grant`(kind는 T33의 PermissionScope 종류). `automation.run`의 scope는 `{automation, command, input_hash, when: {kind: "on_start"} | {kind: "interval", interval_ms}}`이고(input_hash는 default를 채운 정규 입력의 sha256), 켜기는 approval로 grant.create, 끄기는 사람의 grant.revoke, 같은 scope의 active grant는 하나다(lead 결정).
  - `/v1/packages/{register_version,list,versions,guide,usage}`, `/v1/previews/{start,get,stop}`, `PreviewInput`.
  - event `GrantCreated`, `GrantRevoked`, `PackageVersionRegistered`.

### T38 contracts/shell: 앱 화면 틀·앱 preload bridge·feedback IPC

- 등급: 기본
- concern: shell/app-frame
- 요구: shell/app-frame#R1, R5, R6, R8, R11–R15, R22, R33, R34
- 자리: `packages/contracts/shell/` — `app-frame.ts`, `app-bridge.ts`, `feedback.ts`, 각 `_test.ts`
- 쓰는 contract: T34(AppConnection), T39(Feedback)
- 내놓는 contract: 앱 화면 틀
- 받은 요청: shell(2, 이름 맞추기, 화면 검사 host), apps(SDK가 import하는 `lophnApp` bridge), problems(feedback binding·캡처, view-error 전달, test mode 화면 검사)
- slice: apps
- 선행: contracts#T34, contracts#T39
- 완료: 아래 확인이 통과한다
  - main service `appFrame.open({app, mode, release?, screen, size, parentWindow, bounds})`·`replace`·`close`, 출력 `{view_session, app, release, mode, screen, size, connectionState}`. 이름은 contracts/apps의 `AppScreenRequest {screen, size, view_session}`과 같다.
  - shell preload IPC `shell:view-open-app`, `shell:view-open-document`, `shell:view-bounds`, `shell:views-hidden`, `shell:view-close`, push `shell:view-state`.
  - 앱 preload `lophnApp.call(command, input)` → `app:call`, `lophnApp.openExternal(url)` → `app:open-external`(HTTP·HTTPS, userinfo 없음, 8192자 이하), 내부 `app:view-error`.
  - feedback IPC `shell:feedback-begin`, `shell:feedback-submit`, `shell:feedback-cancel`, push `shell:feedback-preview`. scheme `lophn-shell`·`lophn-app`·`lophn-document`, partition 이름 규칙.
  - test mode 앱 화면 검사 host: 입력 `{bundle_screens_dir, screens, app_socket_path, deadline_ms}`, 관측 `{load, errors, feedback_check, blocked_requests}`, 통로는 상속 fd 3의 JSON lines, problems runner가 host 실행 파일을 찾는 설치 경로 규칙.

### T39 contracts/problems: 문제 보고

- 등급: 기본
- concern: problems/reporting, problems/snapshots, problems/feedback, problems/grouping
- 요구: problems/reporting#R2, R8, R12, R14, R16; problems/snapshots#R2, R4, R10, R12, R20; problems/feedback#R1, R8–R11
- 자리: `packages/contracts/problems/` — `reports.ts`, `snapshots.ts`, `feedback.ts`, `sdk-report.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T7, T11, T12, T32
- 내놓는 contract: 문제 보고
- 받은 요청: problems(C-a), apps(report·observe-exception), shell(feedback 준비·접수, app view error)
- slice: apps (problems 팀은 apps slice 전에 필요하다고 했다)
- 선행: contracts#T32
- 완료: 아래 확인이 통과한다
  - SDK 모양 `reportProblem(code, details?)` → `{report_id, completion}`, completion은 `accepted {acceptance} | failed {reason}` 최종 값으로 resolve하고 transport 실패로 reject하지 않는다. `pending`은 별도 메모리 `ReportStatus`에만 둔다.
  - `/v1/problems/{report,observe-exception,submit-feedback,record-report}`, `Report`, `Snapshot`(InvocationEvidence, ErrorEvidence, LogEvidence, ScreenEvidence, MissingReason), `GroupKey`, `Feedback`(글 1~500 scalar, 화면 상태 65536 bytes, PNG 긴 변 1600px·2097152 bytes, 전체 3145728 bytes).
  - event `ReportRecorded`, `SnapshotRecorded`, `ProblemOpened`, `ProblemObserved`.
- 구현 detail / 작은 wire 추천안 (번호 질문·owner 조율은 coordinator가 맡는다):
  - `report`, `observe-exception`, `submit-feedback`은 collector `worker` route다. ledger queue에는 machine 전용 `record-report`만 보낸다. 성공 inner output은 공통 `{report, snapshot, problem, diagnostic_scope}`이며 live는 problem 필수/scope null, preview·test는 problem null/발급 scope 필수다. RecordReport의 event 범위·replayed는 platform command response envelope만 제공한다.
  - 최초 자동 ingress는 report ID·관측 시각·안전한 code/text/details·실제 invocation만 받는다. observer 최초 ingress는 `exception-observation.ts`의 오류 이름/message/raw stack·각 누락 이유를 받아 SDK/process/view의 실제 exception을 전달하고 `_exception`은 collector가 정한다. frames/hash/blob/prepared reference는 최초 ingress에 없다. 절대 source path를 포함할 수 있는 raw stack은 authenticated observer→collector의 262,144 bytes 이하 bounded 메모리에만 있고 저장·ledger·공개 오류·diagnostics·export에는 내보내지 않는다. collector가 당시 release/source map/redaction을 적용해 relative source frame과 최대 16,384 bytes의 redacted stack typed blob을 저장형 ErrorEvidence로 준비한다. app/release/mode/principal/source는 body에 없고 인증 경계가 현재 process/view context를 별도로 전달한다. feedback 대상 app은 shell의 명시적 선택이며 credential/view scope로 다시 검사한다.
  - `ReportInput`에는 server problem이 없고 `PreparedReport`에는 report input/snapshot/group key/명시적 existing problem/typed blob source/원출처 evidence가 있다. 원출처 evidence는 platform `AuthenticatedContext`와 실제 app/release/bundle/mode/diagnostic scope/binding, 최초 report ID/hash를 forwarding한다. 이것은 caller proof가 아니다. core는 trusted 전달 경로·collector machine scope·최초 principal·현재 자격·당시 선언·최종 ID/hash·release/CAS를 runtime에서 검사한다. schema의 field 일치 검사는 인증을 대신하지 않는다.
  - content hash 입력 schema는 최종 report input(content_hash 자체 제외), snapshot, group key, explicit existing problem, purpose/hash 목록이다. server problem/event seq·일시적 preparation handle·forwarding metadata는 제외한다. caller는 canonical JSON/hash 비교를 runtime에서 하고 동일 retry는 최초 고정 내용만 보낸다. `_invalid_report` ID의 결정적 생성·원래 rpt와 분리는 collector 책임이다.
  - source=feedback의 최종 report input/output/content hash 입력에는 `_feedback`과 nonnull text hash가 필수이고 RecordReport는 report_text의 typed authority까지 검사한다. 자동 app/exception report는 화면 state·PNG hash/authority를 저장할 수 없으며 실제 missing reason은 유지한다. source=feedback에서 기존 문제를 선택하면 declared·exception 등 그 기존 GroupKey를 그대로 허용한다. 새 feedback key는 자기 최초 rpt다. canonical app+key uniqueness·실제 선택 문제 app/key 조회·source map 지문·reopen은 runtime/T40 범위다.
  - Snapshot은 항목마다 값 또는 MissingReason 정확히 하나이며 별도 lifecycle을 두지 않는다. 알려진 invocation ID/미도착 이유, 각 로그 실제 수집 시각/알려진 범위/정상 0줄, source 위치 없음 이유를 유지한다. 로그는 총 65,536 bytes만 제한하고 T20의 한 줄 300자 제한을 가져오지 않는다.
  - `report-blobs.ts`는 platform prepared/permanent reference를 사용하고 hash/size/purpose를 묶는다. schema는 typed prepared metadata 일치·항목 bytes·snapshot 준비 총 bytes·feedback JSON와 첨부 합계 bytes를 검사한다. permanent reference의 실제 size/purpose/권한, 실제 UTF-8 JSON bytes, PNG header/dimensions/bytes, redaction, 사람 선택·button view binding·관측 시각은 trusted host가 검증한다. PNG binary는 blob/file/IPC에 있고 generic JSON에 base64를 넣지 않는다. text-only/all-missing snapshot은 유효하다.
  - `sdk-report.ts`는 Zod/contracts root runtime import 없는 portable type/policy entry이며 raw ExceptionObservationInput/Error·MissingReason/invocation 구조는 공개 schema 타입과 bidirectional assignability 테스트로 맞춘다. common error와 transport-only `response_lost`를 구별하고 unavailable/lost만 `[250,1000,3000]`ms로 최대 3회 retry한다. 실제 SDK queue/observer는 problems#T5가 구현하며 observer는 원래 실패를 삼키거나 preventDefault하지 않는다.
  - 공개 mod/registry에 네 route·네 event를 추가하고 T32의 고정 다섯 route/VerificationRecorded identity membership을 보존했다. requirement-numbered schema 테스트와 doc check/full check로 확인한다.

### T40 contracts/problems: problem command·read

- 등급: 기본
- concern: problems/grouping, problems/repairs, problems/closing
- 요구: problems/grouping#R1–R4, R8; problems/repairs#R1, R2; problems/closing#R6–R9, R13
- 자리: `packages/contracts/problems/` — `problems.ts`, `fixes.ts`, `closing.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T7, T13, T39
- 내놓는 contract: 문제 보고(상태·결정 command와 조회)
- 받은 요청: problems(C-b), lophn-agent(problem.list·read·set_interpretation)
- slice: apps
- 선행: contracts#T39
- 완료: 아래 확인이 통과한다
  - `/v1/problems/{reconcile-work,link-interpretation,record-fix,close-verified,apply-decision,list,get,list-reports,get-report,get-snapshot,list-fixes}`, list limit 최대 100.
  - `InterpretationLink`, `FixRecord`, `Closure`, `UserProblemDecision`(문제 결정 handle binding은 T13 owner_decision으로 등록).
  - event `ProblemWorkStarted`, `ProblemWorkEnded`, `ProblemInterpretationLinked`, `ProblemFixRecorded`, `ProblemClosed`, `ProblemReopened`, `ProblemConfirmationRecorded`.

### T41 contracts/coding-agent: ticket

- 등급: 기본
- concern: coding-agent/tickets
- 요구: coding-agent/tickets#R1, R2, R4, R7, R10, R12, R19, R22
- 자리: `packages/contracts/coding-agent/` — `tickets.ts`, `ports.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6, T7, T13, T32(TicketTestLink), T47
- 내놓는 contract: coding agent 통로(ticket core RPC), ticket claim 확인 port
- 받은 요청: coding-agent(ticket 부분, lead 결정의 readiness·make_ready), lophn-agent(ticket create·list·read), problems(ticket read와 Ticket event), apps(release.prepare 안 ticket claim 확인)
- slice: apps (apps의 release 준비와 E2E, problems·lophn-agent가 apps slice부터 쓴다)
- 선행: contracts#T32, contracts#T47
- 완료: 아래 확인이 통과한다
  - `/v1/tickets/{list,show,checks,create,make_ready,claim,renew_claim,release_claim,report_completion,expire_claim,record_checks,cancel}`.
  - `Ticket.readiness: needs_confirmation | ready`와 `needs: string[]`(needs_confirmation일 때 1~12개, 각 1~200자). needs_confirmation 생성은 근거·채택 답·조건이 비거나 일부여도 되고 repair는 problems 1~12개가 필수다. `ticket.make_ready`(user·lophn·App Engineer agent, base_revision, references·adoption_questions·conditions·inspect·preserve 전체).
  - read `getTicket` 출력: state, readiness, app, kind, problems, claim `{connection, claim_seq, expires_at}`, completion_seq, conditions `[{position, kind, 입력, condition_hash}]`(condition_hash는 조건의 RFC 8785 정규 JSON sha256).
  - port `TicketClaimCheck({ticket, claim_seq, connection, now})` → `{ok: true, expires_at} | {ok: false, reason: missing | expired | released | revoked | changed | wrong_connection | not_ready | ticket_closed}`. apps의 release 준비 transaction에서 부른다.
  - event `TicketCreated`(payload에 readiness), `TicketMadeReady {app, kind, problems}`, `TicketClaimed`, `TicketClaimRenewed`, `TicketClaimReleased {reason: returned | expired | connection_revoked}`(만료 전용 event 없음), `TicketCompletionReported`, `TicketChecksRecorded`, `TicketConfirmed`, `TicketCheckFailed`, `TicketCancelled`.

### T50 contracts/coding-agent: 앱·SDK·ticket tool

- 등급: 기본
- concern: coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/mcp-server#R19–R23, R26–R29, R32–R35; coding-agent/cli#R24–R32, R36, R37, R41
- 자리: `packages/contracts/coding-agent/` — `mcp-app.ts`, `cli-app.ts`, `release-exclude.ts`, 각 `_test.ts`
- 쓰는 contract: T33, T34, T36, T37, T41, T48
- 내놓는 contract: coding agent 통로(app toolset)
- 받은 요청: coding-agent(2c), apps(release bundle에서 뺄 개발 도구 경로)
- slice: apps
- 선행: contracts#T36, contracts#T37, contracts#T41, contracts#T48
- 완료: 아래 확인이 통과한다
  - MCP `lophn_app`(op 16개, `environment: preview | live`, validate 출력은 prepare_bundle의 diagnostics·bundle_hash, logs는 한 번에 1~200줄과 cursor, invocation 최대 20개), `lophn_sdk`(`catalog`, `show`, `add`), `lophn_ticket`(`list`, `show`, `checks`, `claim`, `renew`, `release`, `report`; list 1~20)의 op와 입력 schema.
  - blueprint 유래 read tool 이름 `lophn_app_<app ID sha256 hex 앞 12자>_<command 이름 sha256 hex 앞 16자>`(39자; Gemini CLI가 `mcp_<server>_<tool>`을 63자에서 해시 없이 자르므로 줄였다). 원 앱 이름·command 이름은 description에 넣고, 충돌은 discovery 실패다. 바깥 입력은 `input`, `environment`, `timeout_ms`.
  - `test`, `preview_start`, `release_prepare` op의 출력은 접수와 다음 read다(오래 걸리는 일을 tool 응답에서 기다리지 않는다; OpenCode 기본 tool timeout 30초).
  - CLI `app ...`, `sdk ...`, `app command|invocation|automation run`, `app start|stop|release activate`, `ticket ...`.
  - release bundle에서 빼는 개발 도구 경로 상수(`AGENTS.md`, `CLAUDE.md`, `bin/lophn`, `.mcp.json`, `.claude/settings.local.json`, 제품 skill 사본, 제품 local hook 설정). apps의 bundle 준비가 쓴다.

## coding-agent

### T42 contracts/coding-agent: session summary·TUI 시작

- 등급: 기본
- concern: coding-agent/sessions, coding-agent/harnesses
- 요구: coding-agent/sessions#R3, R6, R7; coding-agent/harnesses#R1, R3, R9, R10
- 자리: `packages/contracts/coding-agent/` — `sessions.ts`, `launch.ts`, `harnesses.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6
- 내놓는 contract: coding agent 통로(session summary), coding TUI 시작(4장 표 밖, T8에서 4장 표에 더함)
- 받은 요청: shell(LaunchPlan, human_start_handle, operation_id), coding-agent(harness JSON 출력, session plan, 관측 NDJSON, harness 설정 key)
- slice: coding-agent
- 선행: contracts#T24, contracts#T41, contracts#T47
- 완료: 아래 확인이 통과한다
  - `/v1/coding_agent_sessions/summary` → `CodingAgentSessionSummary`.
  - `LaunchPlan`(executable·argv·cwd·첫 prompt), `human_start_handle`, `operation_id`, 시작 결과 `started | unknown | failed`.
  - harness 관측 값(감지·version·인증·설치 receipt outcome `changed / unchanged / skipped / conflict / failed`, loading 단계 `success / failure / unknown`).
  - `lophn harness list|detect|refresh|inspect|plan|install|update|remove`와 `lophn doctor`의 JSON 출력(`HarnessDetection`, `HarnessIntegrationObservation`, resource별 결과와 receipt, 기본 harness 제안). shell 연결 화면이 child로 부른다.
  - `lophn session plan` 입력·출력(`CodingAgentLaunchPlan`, `prompt_delivery {mode: argv | stdin_after_ready, readiness, deadline_ms: 10000}`), terminal host 관측 socket의 NDJSON(`HarnessSessionObservation` evidence, host가 runtime_ref·generation을 붙인다), 환경 변수 이름 `LOPHN_TERMINAL_OBSERVE`.
  - harness 설정 key(enabled, nullable 기본 harness, profile)의 `SettingDefinition`(T24 모양).

### T43 contracts/coding-agent: MCP·CLI의 session·설치·안내

- 등급: 기본
- concern: coding-agent/mcp-server, coding-agent/cli, coding-agent/guides
- 요구: coding-agent/guides#R2, R23, R24; coding-agent/cli#R9, R10, R40
- 자리: `packages/contracts/coding-agent/` — `mcp-session.ts`, `cli-setup.ts`, `guides.ts`, 각 `_test.ts`
- 쓰는 contract: T42, T48
- 내놓는 contract: coding agent 통로(session tool, 설치·점검 CLI)
- 받은 요청: coding-agent(2e)
- slice: coding-agent
- 선행: contracts#T42, contracts#T48
- 완료: 아래 확인이 통과한다
  - MCP `lophn_session`(op `summary`)의 입력·출력.
  - CLI `harness`, `doctor`, `daemon start|stop|status|logs`, `session summary|plan`, `mcp config`, `connection list|show|create|revoke|install`, `skills list|install`의 입력과 사람 전용 표시.
  - 배포 skill 이름 4개(`lophn-navigate`, `lophn-save`, `lophn-build-app`, `lophn-repair`), hook 출력 상한(10줄·1,200 code point·문제 3개, 전체 5초·core 3초, 장애·빈 결과는 빈 stdout·exit 0).

## problems

### T44 contracts/coding-agent: repair context·문제 tool

- 등급: 기본
- concern: coding-agent/repair-context
- 요구: coding-agent/repair-context#R3–R12, R15, R17; coding-agent/mcp-server#R24, R25
- 자리: `packages/contracts/coding-agent/` — `repair-context.ts`, `mcp-problem.ts`, 각 `_test.ts`
- 쓰는 contract: T36(release 보존 참조), T39, T40, T41
- 내놓는 contract: coding agent 통로(repair context, 문제 tool)
- 받은 요청: coding-agent(2d)
- slice: problems
- 선행: contracts#T40, contracts#T41, contracts#T48
- 완료: 아래 확인이 통과한다
  - `/v1/repair_context/{summary,bundle,more}`, `RepairContext` 15절 순서 상수, 절별 상한 표, 전체 24,576 UTF-8 bytes·300줄, 추가 page 상한(log 200줄, occurrences 20개, source_diff 300줄, screen 24,576 bytes), image 2,097,152 bytes, cursor는 opaque 문자열.
  - MCP `lophn_problem` op(`list`, `show`, `snapshot`, `fix_records`, `summary`, `bundle`, `more`, `record_fix`, `test`)과 CLI `problem list|show|snapshot|fix-records|summary|bundle|more|record-fix|test|attachment open|report|request-repair|confirm|dismiss`. coding 쓰기는 현재 ticket·claim_seq 필수.

## operations

### T45 contracts/platform: backup·diagnostics·install-and-update

- 상태: 완료 (#25)
- 등급: 기본
- concern: platform/backup-and-migration, platform/diagnostics, platform/install-and-update
- 요구: platform/backup-and-migration#R3, R6, R8, R10–R12; platform/diagnostics#R1, R2, R4–R6, R8–R10; platform/install-and-update#R1, R2, R6–R8, R10; shell/desktop#R20
- 자리: `packages/contracts/platform/` — `backups.ts`, `diagnostics.ts`, `install.ts`, 각 `_test.ts`
- 쓰는 contract: T5, T6
- 내놓는 contract: platform 운영 read
- 받은 요청: shell(install-and-update의 daemon 상태·시작·정상 정지·설치 판 호환; skeleton에 필요한 시작·정지는 T6의 감독 pipe에 먼저 둔다)
- slice: operations
- 선행: contracts#T6, contracts#T12(진단 기록이 RedactionResult를 쓴다)
- 완료: 아래 확인이 통과한다
  - `/v1/backups/{list,get}`, `/v1/diagnostics/{list,check}`, `BackupManifest` format 1·검사 상태, 진단 항목(구성 요소·관측 시각·오류 종류·안전 위치), 설치 판·schema 호환 상태.

### T46 contract 덮기를 check 관문에

- 등급: 좁은
- concern: 저장소 바닥
- 요구: 없음(architecture/README.md 4장)
- 자리: `tools/contract-coverage.ts`, `tools/check.ts`
- 쓰는 contract: 모든 contract
- 내놓는 contract: 없음
- slice: operations
- 선행: contracts#T45와 이 계획의 다른 contract 작업 전부
- 완료: 아래 확인이 통과한다
  - `deno task contracts:coverage`가 architecture 5장의 모든 경로·event에 대해 빠짐 0을 보인다.
  - `deno task check`의 1단계가 coverage 빠짐을 실패로 센다. 이후 architecture 5장에 경로를 더하면 contract가 함께 들어와야 check가 통과한다.

## 요구 덮기

### architecture 4장 contract

| contract | 소유 | 작업 |
|---|---|---|
| command | platform | T5(envelope·응답), T6(등록 interface·Tx) |
| read | platform | T5(page 값), T6(ReadDefinition·snapshot) |
| event 구독 | platform | T7 |
| blob | platform | T11 |
| 인증 | platform | T6(actor·context), T13(confirmation handle) |
| secret | platform | T23 |
| redaction | platform | T12 |
| approval | platform | T22 |
| notification | platform | T22 |
| 파일 준비 결과 | documents | T14(preview_tracking), T15 |
| 파일 쓰기 | documents | T16 |
| format 실행 | documents | T17 |
| outline·search 읽기 | documents | T18, T19 |
| 앱 통로 | apps | T34(+ T33 agent-context 값) |
| invocation 전달 | apps | T35 |
| release 준비·적용 | apps | T36 |
| 문제 보고 | problems | T39, T40 |
| test 실행 | problems | T32 |
| agent run | lophn-agent | T26, T27, T28, T29, T30 |
| model 호출 | lophn-agent | 없음 — 다른 최상위가 부르지 않는 runtime 안쪽 interface다. provider·ModelCall 기록 route는 T29 |
| coding agent 통로 | coding-agent | T47(connection), T41(ticket), T42(session summary), T48·T49·T50·T43(MCP·CLI), T44(repair context·문제 tool) |
| confirmation window | shell | T13 |
| 앱 화면 틀 | shell | T38 |

### 수

- 4장 contract: 23개 중 22개를 작업이 만든다. 남은 하나(model 호출)는 쓰는 최상위가 없어 일부러 두지 않는다.
- 4장 표 밖 최상위 사이 contract: 15개, 모두 작업이 있다.
- 작업 50개: skeleton 10, documents 12, agent 12, apps 11, coding-agent 2, problems 1, operations 2 (context·operator slice만의 contract 작업은 없다).
- 작업의 `요구:` 줄은 contract 겉모양(이름·입력·출력·오류·한도·event)을 정하는 요구만 가리킨다. 동작 요구는 각 최상위 팀 계획이 덮는다. 가리키는 요구 수: platform 125/213, documents 73/143, apps 128/222, problems 36/116, lophn-agent 213/437, coding-agent 97/191, shell 24/178.

### contracts에 두지 않는 것

- model 호출의 `invokeModelCall`, lophn-agent 내장 tool 이름과 입력 schema, skill 발견 schema: 다른 최상위가 부르지 않는 lophn-agent 안쪽이다.
- design token·theme 값, wording message key와 en catalog(shell/design-system, shell/wording, apps/sdk#R41): `packages/design`(shell 소유)이 정본이고 shell·SDK UI·problems의 예약 문구가 그것을 import한다.
- 각 최상위 안쪽의 worker 작업 payload 가운데 그 최상위 밖으로 나가지 않는 것(예: documents worker 안의 format child 통신).

### 최상위 소유 도메인 command·read (4장 contract가 아닌 각 architecture 5장의 경로)

| 묶음 | 작업 |
|---|---|
| documents 도메인 command·read(project, document, context, term, series, view) | T14, T15, T19, T21 |
| 앱 영역 command·read(app, grant, package, preview) | T20, T37 |
| platform 운영 read(status, health, settings, backup, diagnostics) | T6, T24, T45 |

### 4장 표 밖의 최상위 사이 contract (4장 표에 있다)

| contract | 소유 → 쓰는 쪽 | 작업 |
|---|---|---|
| handler 등록 interface·Tx·port·같은 transaction dispatch | platform → 모든 최상위 | T6 |
| 감독 pipe(hello·ready·stop, main↔core) | platform → 모든 신뢰 child, shell | T6 |
| settings registry | platform → shell, lophn-agent, 정의를 등록하는 모든 최상위 | T24 |
| 현재 보기 상태 | shell → lophn-agent | T25 |
| 시각 블록 | lophn-agent → shell | T30 |
| AgentAppScope | lophn-agent → platform(conditions), apps(connect) | T26 |
| blueprint·permission 종류·problem code 선언 | apps·problems → problems, coding-agent, lophn-agent, sdk | T32, T33 |
| 앱 시작 입력·data job | apps → problems(test runner) | T34, T36 |
| 자리 이름 예약 port | documents → apps | T14 |
| 지침 첨부·Operator 출력 port | lophn-agent → documents | T27 |
| connection 인증 port | coding-agent → platform | T47 |
| release bundle에서 빼는 개발 도구 경로 | coding-agent → apps | T50 |
| ticket claim 확인 port | coding-agent → apps | T41 |
| coding TUI 시작 | coding-agent → shell | T42 |
| 주기 시점 계산 | base → lophn-agent, apps | T31 |

### base와 저장소 바닥

| 것 | 작업 |
|---|---|
| Result, 공통 오류 코드 | T3 |
| id, clock, random, seq | T3 |
| canonical JSON, sha256 fingerprint | T4 |
| log | T4 |
| 주기 시점 계산 | T31 |
| 루트 workspace, fmt·lint 설정, `deno task check` | T1 |
| 의존 규칙·이름·이식성 검사 | T2 |
| contracts 모음, coverage | T8, T46 |
| `deno task dev` | T9 |
| `deno task e2e`, E2E harness | T10 |

## 질문

lead가 모두 답했다(docs/dev에 반영됨).

- Q1 contracts → base 한 방향 import 허용. code-map에 반영.
- Q2 공통 오류 코드는 internal 포함 7개. docs/dev/architecture.md에 반영.
- Q3 E2E는 T10에서 Deno로 Playwright Electron 실행을 확인하고, 안 되면 `e2e/`에만 Node `package.json` 예외를 쓴다.
- Q4 정한 판은 T1 PR에서 stack.md에 적는다.
- Q5 check에 의존 규칙 검사 단계를 넣는다(T2). contract coverage 관문은 나중(T46).
- Q6 `deno fmt`·`deno lint` 대상에서 docs/ Markdown을 뺀다.
- Q7 architecture/README.md 4장 표의 15행 추가는 T8 PR에서 한다.
- Q8 `packages/contracts/mod.ts`는 code-map에 들어갔다.
- Q9 T47 보호 credential 전달은 `mcp_cli_loader`만 허용한다. coding-agent 계획 Q6의 정함대로 TUI에는 connection 참조만 가고 token은 그 아래 MCP·CLI loader가 받는다. TUI 전용 purpose·start operation 필드는 두지 않는다.
- Q10 T7의 HTTP `events/list` 출력에도 공통 read metadata를 붙인다. `scanned_through_seq`는 구독 처리 위치, `head_seq`는 event head이고, `as_of_seq`는 read snapshot 위치라 서로 대신하지 않는다. WS `events` frame은 read 응답이 아니므로 바꾸지 않는다(platform T3/T4 요청).
- Q11 T23 secret 이름은 event subject의 key와 같은 `[A-Za-z0-9_.:-]+`로 정한다(추천안, 새 길이 한도는 두지 않음). 공개 status에는 안전한 revision만 주고, 교체·제거의 이전 sealed_ref CAS는 main↔core private comparison read로만 얻는다(lead·platform·shell 합의). 요청의 `expected_revision`이 현재와 다르면 `conflict`로 재표시하고, 성공 compare는 그 revision과 같아야 하며 writer가 최종 CAS를 다시 검사한다. 이 read를 HTTP·renderer·agent·app·parent/child worker op로 넓히지 않는다. raw secret은 trusted callback 메모리 인자에만 두고 adapter context는 supervisor가 주입한 현재 process·task·scope를 재검사한다.
- Q12 T25 relay는 core-local raw JSON `memory` route로 둔다(platform·shell 소비 review 완료). command의 ledger queue/idempotency, read의 SQLite snapshot, worker의 child dispatch를 UI relay에 빌리지 않는다. publish와 nested 입력은 strict safe refs만 받고, 출력은 additive다. current read는 summary-only 첫 응답 또는 요청 index의 `tab_page`(최대 20개)를 주며 `next_page`는 다음 index다. 실제 registry·generation·창/session binding·scope·redaction·단절 처리는 shell#T26과 platform#T57이 검사한다.
- Q13 T15 prepare 파일은 metadata와 prepared blob 또는 기존 permanent 참조를 함께 받는다(documents 소비 review 완료). hash 단독 주장은 원문 권한이 아니며 trusted worker가 principal·현재 owner/key/field 권한·prepared TTL을 검사한다. 새 파일은 `document_file` purpose·hash·size, 기존 참조는 hash를 입력과 결합한다. prepare format만 생략 가능하고 신규 MIME 기본 implicit/기존 base_version exact 계약을 worker가 고르며 결과는 exact FormatRef 필수다. agent 목록에서 disk source·files를 빼도 place/name·agent/run invariant를 유지한다. export는 고정 manifest 뒤 T18의 documents/file을 통해 원문 bytes/MIME를 읽고 JSON에 bytes를 중복 싣지 않는다.
- Q14 T20의 `App.revision`은 해당 App의 마지막 변경 event seq이고, 전역 read snapshot의 `as_of_seq`로 대신하지 않는다(apps·documents 소비 review 완료). App get/list와 등록·source·보관·실행 허용 command 결과에서 revision을 보존해 CAS를 조립한다. logs는 source/buffer 없음 `none`, 수집 꺼짐 `off`, 예산 안 완료 못 함 `timeout`, 조회 성공 `ok`로 구별한다(apps·problems 합의). `ok`의 빈 lines도 정상이며 부분 확보·cap은 `truncated=true`; `collected_at`은 실제 수집 시각 또는 null이다. 입력의 `max_bytes`는 positive safe integer이며 runtime 200줄·줄당 300자 cap과 snapshot caller 30줄·65,536bytes를 섞지 않는다. 현재 scope·supervisor 신원·실제 관측·redaction과 writer 최종 CAS는 구현이 검사한다.
- Q15 T32의 `Verification.request_principal`은 actor kind가 아닌 인증 주체의 stable opaque 참조로 정하고 공백뿐인 값은 거절한다(problems·apps 소비 review 완료). `GetTestRequest`는 인증 principal와 key로 기존 accepted command record를 읽고, `RecordVerification`은 같은 request의 principal·hash와 대조한다. 별도 request lifecycle entity를 만들지 않는다. `TestMethod.argv`는 executable을 제외한 `['test', ...]`이며 runner만 고정 absolute Deno executable을 고른다. schema의 argv·cwd 검사는 lexical 입력 한도일 뿐 현재 grant scope·realpath/symlink·OS lifecycle/memory 격리·실제 test 판정을 증명하지 않는다. 빈 failure_paths는 선언이 없는 경우의 값이고 전체 선언 coverage와 hash 일치는 runner가 검사한다. 공용 Tx member는 더하지 않는다.
