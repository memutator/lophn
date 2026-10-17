---
name: write-test
description: lophn에서 test를 새로 쓰거나 고치거나 지우기 전에 쓴다. test를 쓸지 말지 정할 때, `*_test.ts`를 만들 때, test가 느리거나 깨질 때, check 파이프라인(`deno task check`, `check:full`)을 돌릴 때. 작업을 끝내기 전 "위험 test가 필요한가" 판단에도 쓴다.
---

# test 쓰기

prototype이다. test는 적게 쓴다. 지금 test가 거의 없는 것은 일부러다(옛 test 1,503 file이 요구 하나에 test 하나로 쌓여 40~60분 걸렸다). 옛 test를 살리지 말고 이 규칙으로 새로 쓴다.

## 쓸지 정하기

깨지면 정말 곤란한 것에만 쓴다.
- 사용자 데이터를 잃거나 망가뜨리는 규칙: 저장, 되돌림(rewind, revert), migration, 충돌
- 권한, secret, sandbox 경계: Gate 판정, grant, 앱 process가 닿는 것
- program이 하는 결정적 판정: 위반 감지, 선언 비교, 상태 전이의 거절
- 두 번 이상 고친 버그

**위험 하나에 test 하나.** 요구 하나에 test 하나가 아니다. 작업 하나에 몇 개면 충분하고, 위험이 없는 작업은 test가 없어도 된다.

## 쓰지 않는 test

- 화면, 문구, CSS, DOM 세부, 디자인 상수. 화면 쪽에서 지킬 것(파일 저장 충돌 등)은 화면 아래 층에서 본다.
- schema(zod)가 이미 보장하는 것. 상한과 경계값처럼 판정이 있는 것(byte 수, 2^53)만 본다.
- 소스나 문서를 글로 읽어 검사하는 test. 구조 규칙은 lint와 `tools/check-deps.ts`가 맡는다.
- "옛 것이 없어졌음"이나 옛 설계를 지키는 test.
- mock으로 호출 횟수와 인자를 세는 test. 바깥 결과로 판정한다.
- 이미 다른 test가 보는 동작. 한 동작은 한 층에서만 본다.
- 사소한 함수(getter, 상수, 한 줄 변환).
- 조건이 안 맞으면 skip이나 return으로 그냥 통과하는 test. 준비가 없으면 실패해야 한다.
- 성능 감시. 재는 것은 test가 아니라 따로 도는 script다.

설계와 안 맞는 옛 test는 고치지 말고 지운다. 지우거나 합치는 것도 좋은 작업이다. 다만 지우는 test가 지키던 권한 경계 검사까지 같이 없애지 않는다(worker가 한 실수다).

## 모양

- 이름은 확인하는 결과 한 문장이다. `Deno.test("approval 없이 grant가 생기지 않는다", ...)`. 요구 ID와 작업 번호를 넣지 않는다.
- 판정은 바깥 결과로 한다: 거절 code, 생기지 않은 row, 파일 byte, 허용과 차단.
- 여러 경우는 준비를 한 번 하고 표로 돌린다(sandbox 경계 12개를 한 번에 probe하던 옛 `fs-boundary` test가 본보기).
- 준비는 가볍게, file당 한 번이다. 가벼운 쪽부터 고른다.
  1. 순수 함수
  2. handler 하나(가짜 저장소)
  3. 저장소만(SQLite 하나)
  4. core 전체. 경계를 볼 때만 쓰고 file 안에서 공유한다. 준비가 던져도 자원이 닫히게 만든다.
- 시각과 timer는 주입한다(Clock, 수동 clock). 실제로 기다리지 않는다.
- 사람의 data root(`~/.lophn`)를 쓰지 않는다. 임시 폴더와 비운 환경(`clearEnv`, 임시 HOME)을 쓴다.
- 자원 정리 검사(`sanitizeOps`, `sanitizeResources`)를 끄지 않는다.
- test file은 대상 바로 옆에 `*_test.ts`로 둔다. helper는 작게 둔다. 거대한 시나리오 helper를 만들지 않는다.
- model이 끼는 부분은 fake로 본다: loop는 scripted model(`tests/support/loop`), provider wire는 녹화 재생 `fetch`(`tests/support/wire`)와 `tests/fixtures/provider/`, core E2E와 `deno task dev`는 fake server(`tests/support/fake-server`). model 판단의 품질은 test가 아니라 eval이 잰다.

## 층

| 층 | 위치 | 돌리는 때 |
|---|---|---|
| unit | 코드 옆 `*_test.ts` | `deno task check` |
| harness | `tests/harness`(loop, wire) | `deno task check` |
| E2E | `tests/e2e` | `deno task e2e`. lead가 land 전에 |
| live | `tests/live` | `deno task test:live`. 사람이 key를 줄 때만 |

새 E2E flow는 contract 하나에 test 하나, 가장 싼 층, 세 질문(contract, 현실적 회귀, 왜 지금 test로 못 잡나)을 따른다.

## 사람에게 묻는 test

새로 만들기 전에 사람에게 묻는다(AGENTS.md).
- subprocess, Worker, 서버, 브라우저를 띄우는 test
- E2E

새 E2E flow도 사람에게 묻는다(첫 묶음 6개는 testing 계획이 만들었다). 허락받으면 한 번 띄워 여러 경우를 표로 보는 모양으로 한다. E2E는 flow 하나에 핵심 경로 하나다.

## 돌리기

작업 중에는 바꾼 곳의 test만 돌린다.

```sh
deno test --no-check <파일이나 폴더>
```

끝낼 때 `deno task check`를 돌린다. 머지 전에는 `deno task check:full`이다.

## check 파이프라인 (`tools/check.ts`)

| 명령 | 하는 일 |
|---|---|
| `deno task check` | 빠른 check. `git merge-base HEAD main` 이후 바뀐 package와 그것을 쓰는 package만 fmt, lint, deps, source(주석과 test 이름의 요구 ID·작업 번호·금지 낱말), modules(`project-docs/*-catalog.yaml`과 폴더 대조), docs(문서 속 저장소 path가 있는지), `deno check`, style, wording, test를 돈다. `--base <rev>`로 기준을 바꾼다 |
| `deno task check:full` | 전부. `deno test --parallel`(`DENO_JOBS` 기본 8), 앞에서 `deno check`가 끝났으니 test는 `--no-check` |

- 독립 단계는 동시에 돌고 첫 실패에서 멈춘다. 실패하면 exit 1이고 출력에 `실패`가 찍힌다.
- `tests/harness`와 `tests/support`는 check에 들고 `tests/e2e`와 `tests/live`는 안 든다.
- test가 도는 길은 `deno test` 하나다. 따로 묶는 runner와 두 번째 check를 두지 않는다.
- 함정: main에서 이미 commit한 뒤 `deno task check`를 돌리면 기준이 HEAD라 바뀐 package가 없다. 그때는 `check:full`이나 `--base`를 쓴다.
- 함정: `check:full`은 renderer build(`deno run -A packages/shell/renderer/build.ts`)를 안 본다. 화면 쪽을 건드렸으면 따로 돌린다.
- test는 고정 port나 경로를 쓰지 않는다. `--parallel`이 깨진다.
