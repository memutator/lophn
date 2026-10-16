# test 교훈 (2026-10-16)

test는 전부 새로 쓴다(사람 결정). 이 문서는 새로 쓰기 전에 지금 test에서 배운 것을 적는다.

- **조사 방식.** 전수 조사가 아니다. 세 영역(core / shell·design·sdk·protocol / e2e·coding-agent·check 파이프라인)에서 file 100개 안팎을 골라 읽었고, 대표 file 몇 개만 시간과 메모리를 쟀다.
- **원본.** 영역별 보고는 `test-survey/{core,ui,pipeline}.md`에 있다.
- **수치의 정확도.** 정규식 집계는 대략이고, 잰 값은 같은 기계에서 다른 일이 돌던 때라 ±20% 흔들린다.
- **기준.** 저장소 AGENTS.md의 "속도" 절(사람이 씀)이다. 이 문서는 그 절에 근거와 세부를 더한다.

## 1. 숫자로 본 지금 (main `d71e31d8`)

| 무엇 | 값 |
|---|---|
| test file | 1,503 |
| test 줄 | 약 45만. 제품 코드(2,306 file, 약 39만 줄)보다 크다 |
| `Deno.test` | 8,788. core가 약 60%(약 5,290) |
| 이름에 요구 ID나 작업 번호가 있는 test | 약 99%(core, UI 모두). 작업 번호 꼬리표(`[agent-I33a]`)도 core 약 1,500개, UI 약 830개 |
| test가 도는 길 | 셋으로 갈라져 있다: `deno test`, tsx를 esbuild로 묶어 도는 bundle runner 8개, shell main의 `node --test` |
| full check(`deno task check`) | fmt, lint, deps, contract-coverage, `deno check`, `deno test`, shell main `npm run check`, docs를 순서대로만 돈다. 실패해도 멈추지 않는다 |

## 2. 왜 40~60분 걸리고 CPU와 RAM을 많이 쓰나

원인을 큰 것부터 적는다.

1. **test가 너무 많고 하나씩 돈다.**
   - `deno test`에 `--parallel`이 없어 file 하나씩 돌고, 24 core 기계에서 1 core 안팎만 쓴다.
   - file마다 약 0.15~0.2초 고정 비용(module 로드, isolate 준비)이 들어, 1,503 file이면 이것만 3~5분이다.
2. **준비가 무겁고 test마다 되풀이한다.**
   - core를 통째로 띄우는 비용: `createCoreHarness`는 0.65~1.0초(HTTP 서버, ledger, worker 전부)다. 이를 쓰는 file이 core 40, `startCore` 81, `createLedgerHarness`(0.26초) 46이고, 대부분 test마다 새로 띄운다.
   - 이런 file 하나가 test 15~30개에 11~21초, 최대 RSS 약 1.4~1.5GB다.
   - UI 쪽: 진짜 core를 띄우는 renderer test가 약 17번(번당 4~5초)이다. esbuild bundle runner는 `design/components_test.ts` 하나가 8.95초에 RSS 3.25GB다. test 본문은 대부분 ms다.
3. **실제 시간을 기다린다.** 실제 sleep·poll이 core 109 file이다. 예: coding-agent `loading_test.ts`는 timeout 1.9초를 그대로 기다린다.
4. **process와 파일 I/O.** subprocess(`Deno.Command`)가 core 48 file, temp dir가 224 file이다.
5. **안 도는 test도 비용을 낸다.** e2e flow는 check에서 `ignore`인데도 module 로드와 type check를 한다. `report-app-problem_test.ts` 하나가 4초, 0.9GB다.
6. **`deno check`는 주범이 아니다.** workspace 전체가 약 40~60초, 3~4GB로, 메모리 피크만 만든다.
7. **같은 도구를 두 번 돈다.** shell main의 `npm run check`가 fmt, lint, check, test를 한 번 더 돈다.

`--parallel`만 켜면 시간은 준다(coding-agent 19초 → 4.4초). 그러나 메모리가 0.35GB에서 3.2GB로 늘어, 지금 test 그대로면 RAM이 수십 GB로 튈 수 있다. 근본 해결은 test 수와 준비 비용을 줄이는 것이다.

## 3. 쓸모없는 test의 종류

| 종류 | 예 | 크기(대략) |
|---|---|---|
| 요구 하나에 test 하나를 붙임. 이름이 요구 ID 목록 | `usage_test.ts`: test 21개가 `usage#R1`~`#R8`을 field 하나씩 본다. 이름에 ID 6개를 나열한 e2e | 거의 전부 |
| 화면, 문구, CSS, DOM 세부 | renderer test 1,267개 중 약 650개. `[data-...]` selector 약 2,800번, 안내 문장 literal 수백, `"36px"` 비교 | renderer의 절반 |
| 디자인 상수를 다시 적음 | `design/tokens_test.ts`(363줄), `layout-tokens_test.ts`, `sdk/tokens/mod_test.ts` | design 쪽 |
| schema가 이미 보장하는 것 | protocol 1,019개 중 약 787개가 zod `safeParse` 성공과 실패다. route와 event 이름 목록 168개는 `tools/contract-coverage.ts`가 이미 센다 | protocol의 77% |
| 소스나 문서를 글로 읽어 검사(AGENTS.md 금지) | `*-retired_test`, `*-removed_test`, `editor/boundary_test.ts`, `sdk/ui-*/mod_test.ts` 11개(거의 복붙), `design/components/source_test.ts`, `lophn-agent/models/wire_test.ts:316`, `agents/no-presets_test.ts` | 약 30 file 이상 |
| "옛 것이 없어졌음"을 지키는 test | `no-scheduling_test.ts`, `session/rewind/removed_test.ts` | 수십 |
| 옛 설계를 지키다 이미 깨진 test | `e2e/sdk/capabilities_test.ts`의 `apps/sdk#R26`이 main에서 실패한다(기대 목록에 없는 `"retransmit"`) | 확인 1 |
| 겹침(같은 동작을 여러 층이 다시 봄) | core 통로를 contract mock(`agent-core-source_test.ts` 2,919줄), real-core, fake source 위 화면 test가 세 번 본다(`*core-source*_test` 약 9,000줄). `prompt-assembly` material file 넷이 같은 요구를 되풀이한다. `testing/` helper 폴더 안에 test file 25개가 있어 제품 폴더 test와 같은 영역을 이중으로 본다 | 넓게 |
| 내부 구현을 mock으로 셈 | `connection_test.ts` 뒤쪽 약 20개가 호출 횟수와 인자를 확인한다 | core와 UI 모두 |
| 거대한 시나리오 helper | `testing/`의 world 계열 약 3,300줄(`run-recovery-world.ts` 604줄 등). 무엇을 보는 test인지 알려면 world를 먼저 읽어야 한다 | core |
| 거대한 e2e flow | `verify-app-repair` 4,242줄 13 test, `update-lophn` 2,921줄. 깨지면 어디인지 모른다 | e2e |
| 거짓 통과 | `shell/main/scripts/stage_test.ts`는 stage dir이 없으면 skip하거나 return한다. 거의 늘 아무것도 안 본다 | 확인 1 |
| suite 안의 성능 감시 | 차트 "수만 개 시점" test 하나가 3초(bundle runner 본문 합의 56%) | 확인 몇 |
| 땜질 helper | `close-on-throw.ts`(35 file). 준비가 던지면 core가 안 닫혀 test process가 멈추는 것을 막으려고 둔 것이다 | |
| 자원 정리를 끔 | e2e 35 file이 `sanitizeOps`와 `sanitizeResources`를 124번 끈다. 새는 process, server, timer를 잡지 못한다 | e2e |

## 4. 값진 test의 모양

남길 만한 test는 작고 빠르다. 예를 들면 다음과 같다.

| test | 무엇을 지키나 | 비용 |
|---|---|---|
| `apps/permissions/broker/fs-boundary_test.ts` | subprocess 한 번으로 sandbox 경계 12개를 표(`BLOCKED`)로 probe한다. 다른 앱 DB, platform DB, credential, `../`, env, subprocess 실행이다 | 2 test 43ms |
| `sdk/cap-fs/fs_test.ts` | 권한 경계(자식 deno) | 0.59초 |
| `storage/ledger/writer-boundary_test.ts` | Worker가 죽으면 대기 command가 `unavailable`로 끝나고, scope를 줄이면 `forbidden`이다 | |
| `apps/permissions/commands_test.ts`의 셋 | approval 없이는 grant 없음, revoke는 종료 확인 근거가 있어야 됨, 정규화 안 된 scope 거절 | 15개 중 셋이면 된다 |
| `shell/main/editor/file-adapter_test.ts` | 사용자 파일 보호(저장 충돌) | |
| `protocol/lophn-agent/reverts_test.ts` | 되돌림 규칙 | 22 test 19ms |
| `prompt-assembly/hidden_test.ts` | 읽을 자격 없는 것이 prompt에 없다 | |

공통점은 다섯이다.
1. 지키는 것이 데이터 손실, 권한, secret, sandbox 경계, 되돌림이다.
2. 준비는 한 번이고, 여러 시도를 표로 돌린다.
3. 사람의 data root를 쓰지 않는다(`clearEnv`, 임시 HOME).
4. pass/fail이 분명한 결정적 판정이다.
5. 내부(호출 횟수, 인자)가 아니라 바깥 결과(거절 code, 생기지 않은 row, 파일 byte)를 본다.

## 5. 새로 쓸 때의 규칙

AGENTS.md "속도" 절의 규칙을 이번 근거로 구체화했다.

1. **위험 하나에 test 하나.**
   - 요구 하나에 test 하나가 아니다. test는 데이터 손실, 권한·secret·sandbox 경계, 되돌림, 두 번 이상 고친 버그에만 쓴다. 영역마다 지금의 1/5~1/10이면 충분해 보인다.
   - 한 file 안의 field별 round-trip은 하나로 합친다.
2. **이름은 결과 한 문장이다.** 요구 ID와 작업 번호는 넣지 않는다.
3. **화면, 문구, CSS, 디자인 상수는 test하지 않는다.**
   - 화면 쪽에서 지킬 것(파일 저장 충돌 등)은 화면 아래 층에서 본다.
   - 문구 규칙은 lint 도구로 돌리고 test로 돌리지 않는다.
4. **schema를 다시 말하지 않는다.** zod parse 성공과 실패는 쓰지 않고, 상한과 경계값(byte 수, 2^53 등)처럼 결정적 판정만 본다. 이름 목록은 contract-coverage가 맡는다.
5. **소스를 글로 읽는 test, "없어졌음" test, 옛 설계를 지키는 test는 만들지 않는다.** 구조 규칙은 lint와 `check-deps`가 맡는다.
6. **mock으로 호출 횟수와 인자를 세지 않는다.** 바깥 결과로 판정한다.
7. **한 동작은 한 층에서만 본다.** contract mock, 진짜 core, 화면 셋이 같은 통로를 다시 보지 않게 한다.
8. **준비는 가볍고 file당 한 번이다.**
   - test helper에 가벼운 단계를 둔다: 순수 함수, handler 하나, ledger만, core 전체.
   - core 전체는 경계 test에만 쓰고 file 안에서 공유한다.
   - 준비가 던져도 자원이 닫히는 구조로 만들어 땜질 helper가 필요 없게 한다.
9. **실제 시간을 기다리지 않는다.** timer와 poll은 clock 주입(`manualClock`)으로 한다.
10. **subprocess, Worker, 서버, 브라우저, e2e는 새로 만들기 전에 사람에게 묻는다(AGENTS.md).**
    - 만들면 `fs-boundary` 모양(한 번 띄우고 표로 probe)으로 한다.
    - e2e flow 하나에 핵심 경로 하나다.
11. **skip이나 return으로 빠지는 test는 만들지 않는다.** 준비가 없으면 실패해야 한다.
12. **자원 정리 검사를 끄지 않는다**(`sanitizeOps` 등).
13. **`testing/`에는 helper만 둔다.** 거대한 world 시나리오 helper는 만들지 않는다. test가 필요로 하는 만큼만 작게 둔다.
14. **성능 감시는 suite 밖에 둔다**(따로 재는 script).

## 6. check 파이프라인

1. **빠른 check와 full check를 나눈다.**
   - 빠른 것: fmt, lint, deps, coverage, 바뀐 package의 `deno check`와 test. 목표는 1분 안쪽이다.
   - full: 전부. 머지 전에 돌린다.
2. **바뀐 곳만 돌린다.** `git diff`로 package를 고르고, code-map의 import 방향으로 그 package를 쓰는 package까지 넓힌다.
3. **첫 실패에서 멈춘다.** 서로 독립인 단계(fmt, lint, deps, coverage, docs)는 동시에 돈다.
4. **`deno test --parallel`은 `DENO_JOBS`로 제한해 켠다(예: 8).** 고정 port나 경로를 쓰는 test가 없어야 한다.
5. **e2e는 `deno.json`의 `test.exclude`로 일반 test에서 뺀다.** e2e를 돌리는 task는 따로 둔다.
6. **`deno check`가 끝난 뒤의 `deno test`는 `--no-check`로 돈다.**
7. **test가 도는 길을 하나로 줄인다.** bundle runner와 shell main의 두 번째 check를 줄인다. 이건 refactor session이 정할 일이다.

## 7. 이 문서를 쓰는 곳

- 리팩터링과 구현 계획을 세울 때 test 쪽 기준으로 쓴다.
- 코드 저장소의 `docs/dev/`는 없앤다(사람, 2026-10-16). 5장과 6장의 규칙은 `../dev/testing.md`로 옮겼다.
