# test-core: packages/core 전체 test의 교훈

범위를 줄여 본 결과다(사람 지시: 교훈 뽑을 만큼만). 본 file은 대략 25개이고, 나머지는 grep 집계로 규모를 잡았다. 경로는 모두 `packages/core/` 기준이다.

## 규모 (집계)

| 영역 | test file | 줄 | Deno.test(대략) |
|---|---|---|---|
| lophn-agent | 220 | 86.7k | 1,776 |
| projects | 155 | 58.4k | 1,315 |
| apps | 144 | 45.8k | 777 |
| problems | 74 | 27.3k | 368 |
| storage | 49 | 14.1k | 301 |
| server | 31 | 8.4k | 144 |
| supervision | 23 | 4.5k | 127 |
| testing/ (helper 안의 *_test.ts) | 25 | 6.6k | 71 |
| 나머지(approvals, config, events, main, notifications, secrets...) | 약 85 | 약 28k | 약 400 |
| core 합계 | 약 760 | 약 278k | 약 5,290 |

core만으로 test 줄의 약 60%, Deno.test의 약 60%다. 가장 큰 file: `projects/contexts/ledger/adapter_test.ts` 2,922줄, `projects/contexts/api/commands_test.ts` 2,224줄, `projects/contexts/connection_test.ts` 1,847줄, `testing/lophn-agent-questions_test.ts` 1,833줄(helper 폴더 안에 있는 test).

core 영역 grep 집계(file 수 / 호출 수):
- `createCoreHarness` 40 / 104, `startCore(` 81 / 108, `createLedgerHarness(` 46 / 91
- `Deno.Command`(subprocess) 48 / 77, `Deno.serve|listen` 11 / 14
- `Deno.makeTempDir` 224 / 490, `setTimeout|sleep|delay` 109 / 230
- `sanitize*: false` 3 file / 6곳 (적다. 이건 문제 아님)
- source를 글로 읽는 test는 아래 2번 참고

## 1. 쓸모없는 test의 종류

### 1-1. 이름에 요구 ID가 있음: 사실상 전부 (약 99%)
`Deno.test` 이름 5,287개 중 약 5,250개가 `#R<번호>`를 달고 있고, 약 1,500개는 거기에 `[ctx-T9b]`, `[agent-I4]`, `[agent-RW3d]`, `[ctx-I55b]` 같은 작업 번호까지 붙는다. 예:
- `projects/contexts/connection_test.ts`: `documents/contexts#R20 #R21 [ctx-T9b]: ...`
- `lophn-agent/models/wire_test.ts`: `lophn-agent/harness/model#R22 [agent-I4]: ...`
- `lophn-agent/usage/usage_test.ts`: `lophn-agent/harness/usage#R1`~`#R8`
- 한 이름에 요구를 여럿 건 것도 많다: `platform/blob-store#R5 #R6 #R7 platform/identity#R9: ...`

AGENTS.md가 금지한 모양이 core test 전체의 기본 모양이다. 요구마다 test를 한두 개씩 붙이는 방식(`usage#R1~R8`이 R마다 test 1개)이 이 이름에서 그대로 보인다. 요구 목록을 test로 옮긴 것이지, "깨지면 곤란한 것"을 고른 게 아니다. 이름도 길어서(문장 전체가 한국어/영어 설명) 무엇이 지켜지는지 읽기 전에 요구 문서를 열어야 한다.

### 1-2. 소스·repo를 글로 읽어 검사함 (몇 file, 개수는 적지만 정책 위반)
- `lophn-agent/models/wire_test.ts:316`: `wire.ts`를 `readTextFile`해서 `claude|opus|sonnet|...`가 없는지 regex로 본다. 'model 이름으로 분기하지 않는다'를 소스 문자열로 검사.
- `lophn-agent/agents/no-presets_test.ts`: repo 전체 .ts를 `readDirSync`로 훑어 `presets/mod.ts` import가 없는지 본다.
- `lophn-agent/no-scheduling_test.ts`: repo 전체를 훑어 옛 폴더·contract 이름이 코드에 안 나오는지 본다. 폴더 존재 확인(`statSync`)도 한다.
- `lophn-agent/session/rewind/removed_test.ts`: 지운 파일 13개가 없는지 `existsSync`로, route 이름에 `RevertRun`이 없는지 본다.
- 이 묶음 전체: "없어졌음을 확인하는" test. 지운 것이 다시 생기는 것은 test 아니라 review가 볼 일이다. 이런 file 전부 삭제 대상. `grep` 기준으로 같은 종류(`lophn-agent/*/no-*`, `removed*`)가 core에 5개 보였고, 전체 repo 대상으로는 더 있을 것이다.

### 1-3. 옛 설계를 지키는 test (이름이 "없어졌다"를 명시)
위 1-2의 `no-scheduling`, `no-presets`, `removed`가 정확히 이 종류다. `removed_test.ts` 주석이 "옛 설계는 고치지 않고 지운다"고 쓰면서 그 부재를 test로 박았다. 호환성 절의 의도(옛 것을 깨끗이 지운다)는 지우는 것으로 끝나야지 부재 test를 남기면 안 된다. 또 `apps/packages/template/template_test.ts`가 템플릿 `AGENTS.md`/`CLAUDE.md`의 내용을 `includes`/`assertEquals`로 확인하는 것처럼 생성된 문서의 문구를 검사하는 것도 이 부류다(`template_test.ts:212-230`).

### 1-4. 문구·렌더 결과의 세부 확인 (lophn-agent 쪽에 많음, 약 5~10%로 추정)
- `lophn-agent/prompt-assembly/context-material_test.ts`: prompt 재료 text의 "머리에 context 이름·id, 이어서 type·뜻·개수와 관계와 용어집" 순서와 byte가 같다는 것을 본다. "관점·watch·변경됨 표시... 자료에 없다"처럼 문구에 없는 것까지 부정 검사한다.
- `apps/connections/app-tools_test.ts:231,316`: `summary.includes("source 연결됨")`, `"source 미연결"` 같은 한국어 문구 검사.
- prompt-assembly 폴더(7개 test file, 3,287줄)는 prompt 문자열 구성이 거의 전부다. 문구가 바뀌면 같이 깨진다. 진짜 지킬 것은 '권한 밖 context는 안 드러난다', '비밀이 prompt에 안 간다' 정도다.

### 1-5. 같은 동작을 여러 file이 확인함 (겹침)
- prompt-assembly 폴더 안에서 `material_test.ts`(351줄), `context-material_test.ts`(276줄), `context-materials_test.ts`(605줄), `context-overview_test.ts`(292줄)가 모두 `prompt-assemble#R4/R5` 이름으로 "context마다 자료 하나, 같은 입력은 같은 byte, 같은 context는 한 번만"을 각자 다시 본다.
- `context-materials_test.ts`에서 "같은 판과 같은 시작 개수는 byte가 같다(R5)", "로드한 자료의 본문은 렌더 결과와 byte가 같고...(R5)", "같은 context가 여러 번 있어도 한 번만(R5)"가 이름만 달리 줄줄이 있다.
- `testing/lophn-agent-rewind-*_test.ts` 4개, `testing/lophn-agent-questions-*_test.ts` 3개와 `lophn-agent/session/rewind/`, `lophn-agent/questions`류 폴더가 같은 영역을 이중으로 본다(테스트 helper 폴더 안에 test가 25개 있는 것 자체가 이상하다. 아래 2번 참고).
- 권한 쪽도 `apps/permissions/commands_test.ts`(R1, R2, R3, R24, R26, R27을 각각 별도 test + 별도 core)가 "grant는 approval을 거쳐야 한다"를 변형만 바꿔 되풀이한다.

### 1-6. 내부 구현을 mock으로 확인함
- `projects/contexts/connection_test.ts` 뒤쪽 약 20개 test는 `0.1ms~20ms`에 끝나는 순수 mock test다: "worker에게 보내는 내용이 이러이러하다", "한 번 더 보낸다", "scan을 공유한다", "submit이 narrow credential로 간다", "dispatcher가 붙은 뒤에만 index를 catch up한다". 호출 횟수·보내는 인자를 확인하는 구현 결속 test다.
- `lophn-agent/prompt-assembly/*_test.ts`의 `instructionSource`처럼 "읽은 횟수를 세는 가짜"를 두고 `state.reads` 등을 assert한다(`assemble_test.ts:20-70`). 구현이 읽기를 합치면 동작은 같아도 깨진다.
- `apps/connections/operations_test.ts`, `apps/runtime/connect_test.ts` 등 `assertEquals(..., JSON...)` 형태가 많은 file이 있다(grep 상 각각 13, 15곳).

### 1-7. type/schema가 이미 보장하는 것을 다시 확인함 (약 5%)
- `safeParse|.parse(`이 core test에 690곳, schema 이름과 함께 쓰는 file이 79개다. 일부는 입력 검증이 목적이라 정당하지만, `lophn-agent/harness/provider#R1: 내장 정의는 지원 대상 전체를 담고 schema로 검증된다`처럼 이름부터 "schema 통과"를 확인하는 것이 있다.
- `apps/runtime#R9: client는 답의 모양을 검사하고...`, `platform/responsiveness#R1: 기한과 응답 상한은 route 등록값이고...`처럼 등록 table/상수를 그대로 읽어 같다고 확인하는 것도 있다.

### 1-8. 한 file이 요구 하나씩 test를 나열 (유형: 요구 목록의 복사)
`lophn-agent/usage/usage_test.ts`는 21개 test 전부가 `usage#R1..R8`을 하나씩 한다. "unknown usage stays null, not zero", "the five cost kinds stay apart", "estimated amount keeps basis and currency apart" 처럼 필드 하나의 보존을 test 하나로 한다. 이것들은 하나의 round-trip test 한두 개로 충분하다.

### 1-9. 거대한 file, 거대한 fixture
상위 20개 file이 모두 1,000줄을 넘는다. `projects/contexts/ledger/adapter_test.ts` 2,922줄, `projects/contexts/api/commands_test.ts` 2,224줄. file 하나가 helper(`open`, `login`, `createApp`, `approvalId`...)와 권한 목록(`USER_OPERATIONS` 10개, `MACHINE_OPERATIONS` 10개)을 자체로 복사해 두고 있다. `apps/permissions/commands_test.ts`, `projects/file-tracking/routes/files_test.ts`, `storage/blobs/child-prepare_test.ts`는 각각 `login/accept/until/ledger/sha` 같은 같은 모양의 helper를 따로 갖고 있다(core harness를 쓰면서도 `acceptTestCredential`+`record`를 다시 구현).

### 1-10. 사소한 함수
이 영역에서는 눈에 띄는 비율은 아니다(전반적으로 test가 "행동" 단위를 본다). 다만 `lophn-agent/models/wire_test.ts`는 15개 중 대부분이 'effort/speed 값이 request body의 어떤 필드로 가는지' 변환표를 하나하나 쓴 것이다(12개 이상이 provider별 한 줄 변환). 표 자체를 snapshot처럼 박은 모양이다.

## 2. 느리고 무거운 것

### 2-1. helper의 실제 비용 (재 본 값)
repo 밖 scratchpad의 `boot-cost.ts`로 `packages/core/testing/`의 helper를 5번씩 띄웠다 닫았다(24 core 머신, 같은 process, warm).

| helper | 1회 열고 닫는 시간 | 비고 |
|---|---|---|
| `createCoreHarness()` (옵션 없음) | 약 0.63~0.73초 | `startCore` 전체: ledger, writer/reader Worker, HTTP 서버, 임시 홈 |
| `createCoreHarness({ io: true })` | 약 1.0초 | I/O worker까지. approval·blob을 쓰는 test는 거의 `io: true` |
| `createLedgerHarness(...)` | 약 0.26초 | SQLite+writer Worker 1개+reader Worker 2개 |

process RSS는 core 5번 반복 뒤에 약 460~470MB이다(child까지 합치면 더 큼).

그리고 이 비용을 test마다 한 번씩 낸다. 대표 file을 돌린 결과(`deno test --allow-all <file>`, type check 포함 wall, 최대 RSS):

| file | test 수 | 테스트 시간 | wall | 최대 RSS | 시간을 쓴 곳 |
|---|---|---|---|---|---|
| `apps/permissions/commands_test.ts` | 15 | 21s | 29.2s | 1.56GB | test마다 `open()`이 `createCoreHarness({io:true})` + login 2개 + team 모듈 dynamic import. test당 1~2초(`Listening on...` 출력이 test마다 나온다) |
| `storage/blobs/child-prepare_test.ts` | 15 | 11s | 18.9s | 1.44GB | `withCore`가 test마다 `startCore`, 그리고 `Deno.Command(Deno.execPath())`로 자식 deno process를 test마다 띄움 |
| `lophn-agent/tools/handoff/flow_test.ts` | 11 | 13s | 21.4s | 1.43GB | test당 core 1개(약 1.2초) |
| `projects/contexts/connection_test.ts` | 30 | 21s | 29.7s | 1.47GB | 앞 10개 test가 각 1~3초(core+worker), 뒤 20개는 mock이라 0.1~20ms. 한 test가 2초(timer) |
| `lophn-agent/usage/usage_test.ts` | 21 | 8s | 13.4s | 0.82GB | test마다 ledger harness 1개(약 0.33초 x 21 = 약 7s). 하는 일은 usage 기록 필드 보존 |
| `lophn-agent/models/wire_test.ts` (대조군) | 15 | 7ms | 2.0s | 0.59GB | 순수 함수. 7ms. wall 2초는 deno 시작+type check |
| `apps/permissions/broker/fs-boundary_test.ts` | 2 | 43ms | 0.57s | 0.30GB | subprocess 1개로 sandbox 경계 12개를 한 번에 probe |

- 읽을 점: core를 띄우는 test는 test당 1~2초, file 하나가 15~30초와 1.4~1.5GB다. 순수 test는 같은 개수가 ms 단위다. `wall - test 시간`인 7~9초는 `deno test`가 file마다 하는 type check(`Check ...`)와 Worker 모듈 check다. 같은 이유로 `deno check` 전체가 느릴 것이다.
- 외삽: core 띄우는 file이 약 120개(`createCoreHarness` 40 + `startCore` 81 중 겹침 제외), ledger harness file이 46개. 한 file이 15~30초라 가정하면 이것만 core 영역 test 시간이 수십 분이고, `deno test`가 file을 병렬로 돌리면 RSS가 file 수 x 1.5GB로 늘어 29GB 머신(이번에 이미 22GB 사용 중)에서 메모리 압박의 직접 원인이 된다.
- 즉 "full check 40~60분, cpu/ram 많이 먹음"의 주범은 (a) test당 core 통째 부팅, (b) 요구 하나당 test 하나로 늘어난 test 개수의 곱, (c) file마다 하는 type check다.

### 2-2. 준비를 file 안에서 되풀이
- `apps/permissions/commands_test.ts`: 15개 test가 같은 `open()`을 각각 한다. 동적 import 3개(`projects/register.ts`, `apps/register.ts`, `./testing/mod.ts`) + core + user/machine credential 2개를 test마다 만든다. 대부분의 test는 서로의 상태를 안 보므로 file당 core 1개를 공유하고 test마다 app slug만 바꿔도 된다.
- `child-prepare_test.ts`: `withCore`가 test 15개 각각 `startCore` + 자식 `deno run` 1개씩. 이 file의 진짜 가치인 'credit·abort·크기 상한'은 core 없이 handler 단위로 볼 수 있다.
- `usage_test.ts`: ledger harness를 test마다 연다. 같은 기록 round-trip을 필드별로 쪼개서 열기 비용을 21번 낸다.

### 2-3. subprocess, 서버, timer
- `Deno.Command` 48 file / 77곳. 대표: `child-prepare_test.ts`(test마다 `deno run` child), `projects/file-tracking/routes/files_test.ts`(core가 coordinator를 띄우는 자식 process까지 거침), `projects/contexts/worker/run_test.ts`, `apps/runtime/memory_test.ts`(`/proc/<pid>/status`를 읽어 메모리를 재는 test: 환경 의존), `lophn-agent/run-loop/runtime-child_test.ts`.
- `setTimeout|sleep|delay` 109 file / 230곳. `files_test.ts`는 `until(...)`로 200ms 간격 poll, timeout 40초. 관측 loop를 기다리는 test는 시계(`manualClock`)가 있는데도 실제 시간을 쓴다. `connection_test.ts`도 test 하나가 실제로 2~3초 sleep.
- `Deno.makeTempDir` 224 file / 490곳. 대부분 정리하지만, `storage/ledger/writer-boundary_test.ts` 같은 곳은 test마다 temp dir+SQLite file+Worker를 만들고 assert 중간에 실패하면 `remove`가 안 불리는 모양이다(try/finally 없음, `writer-boundary_test.ts:13-31`).
- esbuild는 core test에서는 1 file뿐이라 문제 아님. `sanitizeOps/Resources: false`는 3 file/6곳으로 적다.
- 반복해서 stdout에 `Listening on http://[::1]:...`가 test마다 나온다: core를 띄우는 비용이 test 수만큼 곱해진다는 가장 눈에 띄는 증거.

### 2-4. helper 설계 자체가 test를 무겁게 유도
`packages/core/testing/`
- `core.ts`(253줄): `createCoreHarness`가 항상 `startCore` 전체(HTTP 서버+ledger+worker들)를 띄운다. 비용을 줄이는 옵션이 없다. 'ledger만', 'route만' 같은 가벼운 단계가 없다. 그래서 권한 판정 하나를 보려 해도 core를 통째로 띄운다.
- `ledger.ts`/`ledger-worker.ts`/`ledger-channel.ts`/`ledger-registration.ts`(합 약 740줄): 실제 SQLite file + writer Worker + reader Worker 2개. 진짜 DB 동작을 보는 데는 적합하지만, 호출이 46 file/91곳이고 대부분 test마다 새로 연다.
- `approvals-fixture.ts`(210줄, 42 file이 import): 실제 core의 HTTP route로 `call(...)`, SQLite를 직접 읽는 `inspect`. 이 helper를 쓰는 test는 반드시 core를 띄워야 한다.
- world 계열(`run-recovery-world.ts` 604줄, `tool-judgment-world.ts` 531줄, `waiting-world.ts` 507줄, `question-world.ts` 429줄, `coding-agent-scope.ts` 437줄, `problems-reproduction.ts` 430줄, `problems-app-test.ts` 405줄)은 합 약 3,300줄의 큰 시나리오 준비다. 이 world를 import하는 test는 `testing/` 안에 같이 25 file(6.6k줄) 있고, 제품 폴더(`lophn-agent`, `problems`) 안의 test와 같은 영역을 이중으로 다룬다. '무엇을 보는 test인가'를 파악하려면 world 600줄을 먼저 읽어야 한다.
- import 빈도: `testing/mod.ts` 177, `ledger.ts` 42, `approvals-fixture.ts` 42, `core.ts` 40, `close-on-throw.ts` 35, `tool-judgment-world.ts` 13. `close-on-throw.ts`(35 file이 쓴다)가 있다는 것 자체가 "준비가 던지면 core가 안 닫혀 test process가 멈춘다"는 문제를 땜질로 막아 온 흔적이다. 새 design에서는 core를 띄우지 않는 test라야 이 문제가 없다.

## 3. 값진 test (남길 만한 모양)

- `apps/permissions/broker/fs-boundary_test.ts`(2 test, 43ms): 실제 sandbox 안에서 subprocess 한 번으로 12개 경계(다른 앱 db, platform db, credential, `../` traversal, env, subprocess 실행)를 `BLOCKED` 목록으로 probe하고 읽기/쓰기가 막혔는지 본다. `clearEnv` + 임시 HOME으로 사람 데이터 root를 안 연다. 사람 기준(sandbox 경계)에 정확히 맞고, 준비 1회 + 결과 표 비교 모양이라 싸다. 이 모양이 이 영역에서 가장 좋은 예.
- `storage/ledger/writer-boundary_test.ts`: Worker crash 시 대기 중 command가 `unavailable`로 끝나고 이후 command도 계속 `unavailable`(R6), Worker가 scope를 줄이면 `forbidden`(R20). 데이터 손실·권한 경계다. 다만 test마다 temp dir+Worker를 만들고 try/finally가 없다.
- `apps/permissions/commands_test.ts`의 핵심: "approval 적용이 없으면 grant가 생기지 않는다", "revoke는 종료 확인 근거가 있어야 revoked", "정규화되지 않은 scope·source를 감싸는 경로는 grant로 만들지 않는다". 권한 경계이고 실제 core+HTTP로 보므로 값지다. 15개 중 이 세 가지 정도로 줄여도 된다.
- `lophn-agent/usage`에서 '상태 불명은 null이지 0이 아니다', '실패 본문을 저장하지 않는다(no error body)': 데이터 정확성·secret 노출 방지 몇 개만 남기고 나머지 필드 보존 test는 합친다.
- `lophn-agent/prompt-assembly/hidden_test.ts`(78줄), 읽을 자격 없는 project의 context는 아무것도 안 드러난다(`context-materials_test.ts`): 권한 경계. 문구 대신 '들어가면 안 되는 것이 prompt에 없다'만 본다.
- `lophn-agent/models/wire_test.ts`의 효과적인 면: 15개가 7ms. 순수 함수 test는 이렇게 싸다. 하지만 값은 'model 이름이 아니라 축과 값으로 patch를 만든다' 1~2개로 충분.
- 좋은 모양의 공통점: (1) 경계가 데이터 손실·권한·secret·sandbox다. (2) 준비 1회로 여러 시도를 표(`BLOCKED` 목록)로 돌린다. (3) 사람 data root를 상속하지 않는다(`clearEnv`, 임시 HOME). (4) 결과가 pass/fail이 분명한 결정적 판정이다. (5) 구현 내부(호출 횟수, 인자)가 아니라 바깥 결과(거절 code, 생기지 않은 row)를 본다.

## 4. 새로 쓸 때 교훈 (요약)

1. 이름에서 `#R`·`[xxx-T9]`를 없앤다(현재 99%가 위반). 요구 하나에 test 하나가 아니라 위험 하나에 test 하나로 바꾸면 file당 test가 대폭 줄어든다. 영역별로 5~10배 줄일 수 있어 보인다.
2. "없어졌음을 확인하는" test와 repo를 글로 읽는 test(`wire.ts` regex, `no-presets`, `no-scheduling`, `removed`)는 통째로 삭제.
3. core 통째 부팅(`createCoreHarness` 0.7~1.0초, 1.4GB급 process)은 권한·데이터 손실의 경계 확인에만 쓰고, file당 1개를 공유한다. 나머지는 ledger/handler 단위나 순수 함수로 본다. `createLedgerHarness`(0.26초)도 file당 1개를 공유한다.
4. 필드 하나씩 쪼갠 round-trip test(`usage#R1~R8`)는 하나로 합친다. mock으로 호출 횟수·인자를 세는 test는 지운다.
5. 같은 영역을 `testing/`과 제품 폴더가 이중으로 보는 구조를 없앤다. `testing/`에는 helper만 둔다(지금 25개 test file이 helper 폴더에 있다). world 계열 helper(600줄)는 새 test가 필요로 하는 만큼만 새로 만든다.
6. subprocess·Worker·서버를 띄우는 test는 sandbox 경계처럼 지킬 가치가 큰 것(`fs-boundary` 모양)만 남긴다. 실제 sleep·poll은 `manualClock`으로 바꾼다.
7. 같은 준비(login, 권한 목록, helper 복사)를 file마다 복사하지 않는다. 공유 helper는 가볍게 유지하되, 각 file은 하나만 준비한다.

## 부록: 시간 측정에 쓴 것
- 측정 로그: `scratchpad/core-time/`
- helper 부팅 비용 script: `scratchpad/boot-cost.ts`
- 측정 시점에 다른 worker도 같은 머신에서 일하고 있어 수치는 +-20% 정도 흔들릴 수 있다. 저장소 파일은 건드리지 않았다.
