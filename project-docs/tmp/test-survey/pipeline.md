# test-pipeline: full check 파이프라인, e2e, coding-agent, tools

범위를 줄여서 본 것이다(전수 아님). 재 본 것은 작은 것뿐이고, full check, 전체 `deno test`, core·shell test는 돌리지 않았다. 아래 "추정"은 그 한계 안의 추정이다.

## 1. 파이프라인 구조 (`tools/check.ts`, `deno.json`)

- 단계는 fmt, lint, deps, coverage, check, test, shell, docs 순으로 **직렬**이다. `runSteps`가 for 루프로 하나씩 돌린다. 앞 단계가 실패해도 뒤 단계를 계속 돌린다(실패를 모아서 마지막에 표로 보인다). 그래서 fmt가 깨져도 40분을 다 쓴다. fail-fast가 없다.
- `deno test --allow-all --permit-no-files`에 `--parallel`이 없다. Deno는 **file을 하나씩 직렬로** 돌린다(file마다 새 isolate). 24 core 기계에서 1 core 안팎만 쓴다.
- "CPU와 RAM을 많이 잡아먹는다"는 느낌의 출처는 test 단계 자체보다 file마다 core·ledger·DB를 통째로 올리는 준비와, 중간에 도는 `deno check`(workspace 전체)·Electron·subprocess로 보인다. test 단계는 직렬이라 평균 CPU는 낮고 시간만 길다.
- `deno test`는 기본으로 type check도 한다. check 단계에서 `deno check`를 이미 돌렸으니 같은 graph를 또 본다. type check cache가 맞으면 거의 공짜지만, test file이 `deno check` 대상과 다른 graph(workspace 밖 file, tsx exclude 등)이면 다시 비용이 든다. 이번에 coding-agent에서 `--no-check`와 기본이 같은 시간(19.07초 대 19.10초)이었다. cache가 맞은 경우라서, 이 부분은 큰 비용이 아니라고 본다.
- `deno.json`의 test exclude가 `*_test.tsx`를 다수 뺀다(design components, chart, reading, renderer, sdk). 그런데 `deno check`는 exclude에 안 걸린 한 이 file들도 본다. 즉 test로 돌지 않는데 type check만 받는 tsx test가 많다. renderer `_test.tsx` 173개(47k줄)는 check 비용만 내고 안 돈다. 도는지 안 도는지 불명확한 test 묶음이라 그 자체가 지울 후보다.
- check 단계에서 `e2e/`도 돈다(`e2e/flows/*_test.ts`가 일반 `deno test` 대상). 그런데 flow 대부분이 `LOPHN_E2E=1`과 DISPLAY가 없으면 `ignore`다.

## 2. 측정값 (이 기계: 24 core, RAM 29GB, Deno 2.9.7)

| 대상 | 시간 | 최대 메모리 | 비고 |
|---|---|---|---|
| `deno check` base 1개 module | 0.44초 | 0.2GB | |
| `deno check` coding-agent 210 file 전부 | 4.3초 | 0.9GB | |
| `deno check` protocol 376 file | 5.3초 | 1.0GB | |
| `deno check` design 170 file | 3.3초 | 0.5GB | |
| `deno check` **core 2,048 file** | **17.2초** | **2.6GB** | user 24초 |
| `deno test` base 15 file 직렬 / `--parallel` | 1.0초 / 0.18초 | 0.3GB / 0.8GB | |
| `deno test` coding-agent 83 file, 599 test, 직렬 | 19.1초 | 0.35GB | test 시간 합은 약 7.7초 |
| 같은 것 `--parallel` | **4.4초** | **3.2GB** | user+sys 41초 |
| `deno test e2e/` 50 file (DISPLAY 없음) | 22초 | 0.8GB | 126 test 중 64 skipped |

### type check의 크기 추정
- core가 2,048 file에 17초이므로 file당 8ms 안팎이다. workspace 전체(약 3,800 file 안팎: core 2,048, shell 627+, protocol 376, coding-agent 210 등)는 **대략 40~60초, 3~4GB**다. 40~60분의 주범이 아니다. 다만 메모리 피크는 이 단계가 만든다.
- `deno check`의 cache가 비면 처음 한 번은 더 걸릴 수 있다. 이번 측정은 일부가 cache에 있었을 수 있다.

### test 단계의 추정
- 직렬이다. coding-agent에서 file당 약 0.23초(19.1초 / 83 file)이고, 그중 test 본문은 약 0.09초(7.7초 / 83)고 나머지 약 0.14초는 file마다의 module 로드와 isolate 준비다. 1,503 file에 그대로 곱하면 순수 오버헤드만 약 3.5분이다.
- 나머지 40분대는 coding-agent로는 설명이 안 된다. coding-agent의 무거운 곳은 launch_test(3.3초: 실제 CLI process를 띄움), loading_test(2.4초: 응답 timeout 1.9초를 실제로 기다림)뿐이다. 이 정도 규모가 core(798 file, 277k줄), shell(274 file), protocol(160 file)에 같은 비율로 있다면 직렬 시간은 수십 분이 된다. 이 부분은 core·shell 담당 worker의 측정을 따라야 한다. 내 쪽의 확인 가능한 사실은 "직렬이라서 1 core만 쓰고 file 수에 정비례한다"는 것이다.

### 병렬의 효과
- coding-agent는 `--parallel`로 19초가 4.4초가 됐다(4.3배). 대신 메모리가 0.35GB에서 3.2GB로 늘고 CPU 41초를 썼다. 같은 비율이면 전체 test는 사용자가 지금 겪는 "CPU·RAM 많이 씀"을 병렬로 압축해서 일으킨다. 즉 지금 느린 것은 병렬이 없어서이고, 병렬을 켜면 시간은 줄지만 RAM이 몇십 GB 단위로 튈 수 있다(`DENO_JOBS`로 제한 필요). 근본 해결은 test 수와 준비 비용을 줄이는 것이다.

## 3. e2e/ 의 문제

- `e2e/`의 test file은 50개, 24k줄이다. `Deno.test`는 124개이고 flow file이 매우 크다: verify-app-repair 4,242줄(13 test), update-lophn 2,921줄(8 test), report-app-problem 1,469줄(1 test), connect-apps 1,244줄(2 test), first-project 808줄, run-app-automation 859줄(1 test).
- flow는 `ignore: Deno.env.get("LOPHN_E2E") !== "1"`로 check에서는 꺼져 있다. 그러면 check 단계에서 해당 file은 **돌지는 않으면서 module 로드와 type check 비용만 낸다**. 예: report-app-problem_test.ts 한 file이 ignore 상태로 4.1초, 0.9GB다(core graph를 import하기 때문). build-context_test.ts는 1.9초, 0.5GB다.
- 거의 모든 e2e file(35개)이 `sanitizeOps/sanitizeResources/sanitizeExit: false`를 124번 쓴다. 자원 누수를 끄는 옵션이라 새는 process·server·timer를 test가 못 잡는다. 이름이 비슷한 flow file(`*-app-*`)이 서로 겹치는 동작을 확인할 가능성이 크다(이번에 안 읽었다).
- 값이 큰 만큼 개수가 적다: 하나의 `Deno.test`가 수백~1,400줄이다. 한 test가 flow 전체를 따라가므로 실패했을 때 어디가 깨졌는지 알기 어렵고 test 하나가 매우 느리다.
- `e2e/coding-agent/repair-steps/stages_test.ts`는 test 1개에 6.2초가 걸린다(e2e 전체 test 시간의 절반). `e2e/sdk/cap-schedule/screen-context-world_test.ts` 1.6초, `e2e/sdk/format-document` 1.5초(format 등록·module_hash 확인).
- **지금 main에서 실패하는 test가 있다**: `e2e/sdk/capabilities_test.ts`의 `apps/sdk#R26: cap-problem needs no extra permission and exposes no way to close`가 기대 목록에 없는 `"retransmit"`가 실제에 있어서 깨진다. 옛 설계 test가 방치된 예다. 브리프가 말한 "옛 설계를 지키는 test"의 확인된 사례다(check가 40분 뒤에야 알려 주는 종류).
- test 이름에 요구 ID가 거의 전부 붙어 있다(`apps/sdk#R26`, `coding-agent/harnesses#R3`, `documents/contexts#R1 documents/contexts#R20 ...`). AGENTS.md의 "테스트 이름에 요구 ID 금지"와 어긋난다. e2e 126개 중 거의 전부, coding-agent 599개 중 대부분이 해당한다(대략 95% 이상으로 보인다). 한 test 이름에 요구 ID 6개를 나열한 것도 있다(report-app-problem, build-context).
- `e2e/harness_test.ts`(8 test)는 harness 함수(`pickPageTarget`, `electronArgs`, `readEvaluation`, `e2eEnabled`)를 확인한다. 값은 작고 harness 자체의 내부 구현이다. e2e 자체를 줄이면 harness와 함께 지울 후보다.

## 4. coding-agent/ (83 file, 21k줄, 599 test, 약 19초 직렬)

- 전체적으로 가볍다. test 본문 합이 7.7초이고 상위 2 file(launch_test 3.3초, loading_test 2.4초)이 그중 5.7초다.
- 느린 것은 둘이다. 실제 CLI process를 띄우는 `launch_test.ts`(`Deno.Command`, `coding-agent/cli#R40 ... 실제 CLI proce...` 2.5초)와, 응답 timeout을 실제 시간으로 기다리는 `harnesses/loading_test.ts`("응답 timeout은 성공도 실패도 아닌 unknown이다" 1.9초). 후자는 clock이나 짧은 timeout 주입으로 수 ms가 될 수 있다. 가짜 시계가 `packages/base/clock.ts`에 이미 있다.
- subprocess·server를 쓰는 file이 3개씩(`Deno.Command`, `Deno.serve`)이라 적다. temp dir를 쓰는 file이 20개, 대체로 가볍다.
- 큰 file: `connection/app-ops_test.ts` 1,240줄, `harnesses/catalog/adapters-main_test.ts` 808줄 + `adapters-more_test.ts` 496줄(같은 이름 묶음: adapter 7종을 같은 모양으로 확인함 -> 겹침·표 형태 후보), `cli/launch_test.ts` 754줄, `harnesses/integration/apply_test.ts` 667줄, `harnesses/loading_test.ts` 598줄. 이번에는 내용을 읽지 않았다.
- 좋은 모양으로 보이는 것(이름만 보고 한 추정): `e2e/coding-agent/adapter-install_test.ts` "고른 target만 바꾸고 다른 제품 설정은 읽지도 만들지 않는다"(사용자 설정 보호, 0.02초), `launch_test`의 "같은 권한의 process는 고른 파일·integrations·instance lock 밖에는 쓰지 못한다"(sandbox 경계, 0.77초), `credential/helper_test.ts`의 "동시 요청은 helper를 한 번만 부른다"(secret). 이런 test는 짧고 한 가지 경계를 확인한다.

## 5. tools/ (18 test file, 4.3k줄, `Deno.test` 95개)

이번에 시간은 재지 않았다. 구조만 본다. `tools/check.ts`의 `runSteps`를 fake runner로 확인하는 순수 test가 있는 것으로 보이고, 가벼울 것이다. `check-deps.ts`, `contract-coverage.ts`, `check-docs.ts`는 문서·소스를 글로 읽어 검사하는 도구이며 `--allow-read`만 쓴다. 도구 자체는 AGENTS.md가 정한 것이라 남겨 둘 대상이다. 단 이들의 test가 소스·문서를 글로 읽는지는 확인하지 못했다.

## 6. 빨라질 구조 제안

우선순위는 효과가 큰 것부터다.

1. **test 개수를 줄인다**(가장 큰 효과). 직렬 시간이 file 수에 정비례한다(file당 약 0.2초 + 본문). 1,503 file에서 겹치는 것, 요구 ID 한 줄 확인, 옛 설계를 지키는 test를 지우면 선형으로 준다.
2. **check를 둘로 나눈다.**
   - `deno task check`(빠른 것): fmt, lint, deps, coverage, 바뀐 곳의 `deno check`, 바뀐 package의 test. 목표는 1분 안쪽.
   - `deno task check:full`(CI나 머지 전): 지금 전체. 직렬이 아니라 단계 간 병렬(fmt·lint·deps·coverage·docs는 서로 독립이라 동시에 가능)로 한다.
3. **바뀐 곳만 돌린다.** `git diff --name-only`로 package를 정하고, `code-map.md`의 import 방향으로 그 package를 import하는 package까지(core를 import하는 것은 core뿐이라 대부분 닫힌다) 골라 `deno check <package>`와 `deno test <package>`를 돌린다. 이번 측정으로 package 하나의 check는 coding-agent 4초, core 17초다.
4. **`deno test`에 `--parallel`을 켜되 `DENO_JOBS`를 제한한다.** coding-agent에서 4.3배 빨라졌고 메모리는 9배다. 8~12 job 정도가 현실적이다. 다만 temp port·고정 경로를 쓰는 test는 병렬에서 깨질 수 있어 직렬로만 도는 test는 먼저 찾아야 한다(이번에는 확인 못 함).
5. **무거운 test를 따로 둔다.** subprocess·server·실제 timer·esbuild·Electron을 쓰는 file은 `*_slow_test.ts` 같은 규칙이 아니라 디렉터리(예: `e2e/`)로 모아 `deno task check:full`에서만 돌린다. 지금 `e2e/flows`는 ignore 상태로도 check마다 module 로드 비용을 낸다. 일반 `deno test`에서 e2e를 `deno.json`의 `test.exclude`로 빼면 check 단계에서 약 20초와 0.9GB가 즉시 준다(e2e 폴더 전체의 실측 22초).
6. **`deno test`의 type check를 끈다**(`--no-check`). 앞 단계 `deno check`가 이미 봤기 때문이다. 이번 측정은 cache가 맞아 차이가 없었으나, 맞지 않는 file이 있으면 두 번 비용이다. tsx test처럼 exclude된 file이 `deno check`에는 걸리는지 `deno.json` 설정을 정리하는 것이 먼저다.
7. **fail-fast.** `runSteps`가 첫 실패에서 멈추게 한다(fmt·lint 실패에 40분을 쓰지 않는다). 빠른 단계를 앞에 두는 현재 순서는 좋으니 이것만 더하면 된다.
8. **실제 시간 대기 제거.** `loading_test`의 1.9초 timeout처럼 실제로 기다리는 test는 clock 주입으로 바꾼다. coding-agent 직렬 시간의 10%를 한 test가 쓴다.
9. **e2e flow 크기.** 수백~수천 줄 flow(verify-app-repair 4,242줄, update-lophn 2,921줄)는 사람이 AGENTS.md대로 "E2E는 새로 만들기 전에 묻는다"로 정한 이상, 새로 쓸 때 flow 하나에 핵심 경로 하나만 두는 쪽이 맞아 보인다.

## 7. 한계

- core·shell·protocol의 test 시간은 재지 않았다. 사용자 말의 40~60분 중 실제로 어느 단계가 얼마를 쓰는지는 이 보고만으로 확정할 수 없다. 내가 확인한 사실은 (a) test가 직렬이고, (b) 1 file당 약 0.2초 고정 비용이 있고, (c) `deno check`는 1분 안팎이며 40분의 주범이 아니라는 것, (d) `--parallel`이 시간은 크게 줄이고 메모리는 크게 늘린다는 것이다.
- 측정 중간 산출물: `scratchpad/e2e.junit.xml`, `ca.junit.xml`(coding-agent), 변환 script `junit.py`.
