# test

지금까지의 test는 모두 지웠다(2026-10-16). 왜 그랬는지와 근거는 `../tmp/test-lessons.md`에 있다. 새 test는 이 규칙으로 쓴다.

## 언제 쓰나

test는 깨지면 정말 곤란한 것에만 쓴다.
- 사용자 데이터를 잃거나 망가뜨리는 규칙(저장, 되돌림, migration, 충돌)
- 권한, secret, sandbox의 경계(Gate 판정, grant, 앱 process가 닿는 것)
- program이 하는 결정적 판정(위반 감지, 선언 비교, 상태 전이의 거절)
- 두 번 이상 고친 버그

**위험 하나에 test 하나다.** 요구 하나에 test 하나가 아니다. 작업 하나에 test는 몇 개면 충분하다.

## 쓰지 않는 test

- 화면, 문구, CSS, DOM 세부, 디자인 상수. 화면 쪽에서 지킬 것(파일 저장 충돌 등)은 화면 아래 층에서 본다.
- schema가 이미 보장하는 것(zod parse의 성공과 실패). 상한과 경계값처럼 판정이 있는 것만 본다.
- 소스나 문서를 글로 읽어 검사하는 test. 구조 규칙은 lint와 `check-deps`가 맡는다.
- "옛 것이 없어졌음"을 지키는 test, 옛 설계를 지키는 test.
- mock으로 호출 횟수와 인자를 세는 test. 바깥 결과로 판정한다.
- 이미 다른 test가 보는 동작. 한 동작은 한 층에서만 본다.
- 사소한 함수(getter, 상수, 한 줄 변환).
- 조건이 안 맞으면 skip이나 return으로 그냥 통과하는 test.
- 성능 감시. 재는 것은 test가 아니라 따로 도는 script다.

## 모양

- **이름**은 확인하는 결과 한 문장이다. 예: `Deno.test("approval 없이 grant가 생기지 않는다", ...)`. 요구 ID와 작업 번호를 넣지 않는다.
- **판정**은 바깥 결과로 한다: 거절 code, 생기지 않은 row, 파일 byte, 허용과 차단.
- **여러 경우**는 준비를 한 번 하고 표로 돌린다. 본보기는 sandbox 경계 12개를 subprocess 한 번에 probe하던 옛 `fs-boundary` test다.
- **준비는 가볍게**, file당 한 번 한다. 가벼운 쪽부터 고른다.
  1. 순수 함수
  2. handler 하나(가짜 저장소)
  3. 저장소만(SQLite 하나)
  4. core 전체
  - core 전체는 경계를 볼 때만 쓰고 file 안에서 공유한다. 준비가 던져도 자원이 닫히게 만든다.
- **시각과 timer**는 주입한다(Clock, 수동 clock). 실제 시간을 기다리지 않는다.
- **사람의 data root**를 쓰지 않는다. 임시 폴더와 비운 환경(`clearEnv`, 임시 HOME)을 쓴다.
- **자원 정리 검사**를 끄지 않는다(`sanitizeOps`, `sanitizeResources`).
- **test file**은 대상 바로 옆에 `*_test.ts`로 둔다. helper는 작게 두고, 거대한 시나리오 helper를 만들지 않는다.
- **model이 끼는 부분**은 fake provider의 script나 녹화 응답으로 본다. model 판단의 품질은 test가 아니라 eval이 잰다.

## 사람에게 묻는 test

다음 test는 새로 만들기 전에 사람에게 묻는다(AGENTS.md).
- subprocess, Worker, 서버, 브라우저를 띄우는 test
- E2E

만들면 한 번 띄워 여러 경우를 표로 보는 모양으로 한다. E2E는 flow 하나에 핵심 경로 하나다.

## 돌리기

- 작업 중에는 바꾼 곳의 test만 돌린다(`deno test <파일이나 폴더>`).
- check 파이프라인(아래)은 끝낼 때 돌린다.

## check 파이프라인

`deno task check`는 빠른 check다. 1분 안쪽을 목표로 한다.
- fmt, lint, deps, 바뀐 package의 `deno check`와 test를 돈다.
- 바뀐 package는 `git diff`로 고르고, 이 문서의 import 방향으로 그 package를 쓰는 package까지 넓힌다.
- 서로 독립인 단계는 동시에 돌고, 첫 실패에서 멈춘다.

`deno task check:full`은 머지 전에 돈다.
- 전부를 돈다. `deno test`는 `--parallel`과 `DENO_JOBS` 제한(예: 8)으로 돈다.
- `deno check`가 끝난 뒤라 test는 `--no-check`로 돈다.
- test가 도는 길은 `deno test` 하나다. 따로 묶는 runner와 두 번째 check는 두지 않는다.

이 파이프라인은 리팩터링의 첫 작업에서 만든다([workflow.md](workflow.md)).
