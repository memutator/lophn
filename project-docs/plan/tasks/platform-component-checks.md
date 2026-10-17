# platform-component-checks

`diagnostics.status`가 core와 ledger만 점검해 events와 agent runtime이 죽어도 정상으로 보이는 문제를 고친다. events와 agent runtime의 owner wiring이 자기 점검을 `ctx.componentChecks`에 더한다. 나머지 component(앱 supervisor, sandbox)는 이 task 밖이다.

- 단위: platform (wave 2)
- 선행: platform-crash-diagnostics. 같은 `wiring/lophn-agent-runtime.ts`를 이어 고친다.
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/events.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "Diagnostics 점검이 core·ledger 둘뿐이다" (정한 것: events와 agent runtime 점검만 더한다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `events`, `lophn-agent`, `diagnostics`, `project-docs/module-catalog.yaml`의 `packages/core/main`(wiring file끼리 import하지 않는다)
  - 코드: `core/diagnostics/{components,ports}.ts`(`ComponentCheck`, 점검 하나는 2초 안에 끝나야 하고 불가에는 이유가 있어야 하며 이유에 경로·key·값을 담지 않는다), `core/main/daemon/wiring/diagnostics.ts`의 core·ledger 점검 한 쌍(본보기), `core/supervision/responsiveness/supervisor.ts`의 `observation(kind)`
- 계약:
  - 쓰는 것: `ComponentCheck`(`component`는 `DIAGNOSTIC_COMPONENTS`의 `"events"`, `"agent-runtime"`), `ctx.componentChecks.push`, `ctx.io.observation(AGENT_RUNTIME_KIND)`
  - 내놓는 것: 없음. protocol은 바꾸지 않는다.

## 할 일

1. `wiring/events.ts`: events wiring이 쥔 것(ledger 읽기 연결 `connection`, Reactor `reactor`)으로 점검을 짓는다. `prepare` 끝에서 `ctx.componentChecks.push({ component: "events", check })`.
   - 점검: `connection`이 열려 있고 Reactor가 `start`된 뒤여야 한다(wiring 닫힘 안에 `let started = false`를 두고 `start`에서 true, `closeWork`에서 false). 그 위에 `sql.get("select 1 as found from events limit 1", [])`를 한 번 읽어 던지지 않으면 `{ available: true }`.
   - 불가 이유(고정 문장, 경로·값 없음): 연결/Reactor가 없으면 "events 연결이나 Reactor가 아직 없다", 읽기가 던지면 "events를 읽지 못한다".
   - Reactor가 막혔는지(backoff)는 보지 않는다. `ReactorRunner`에 상태를 내는 칸이 없고 이 task가 events 모듈을 고치지 않는다. 보고의 "알려진 미완 동작"에 적는다.
2. `wiring/lophn-agent-runtime.ts`: `prepare`에서 `ctx.componentChecks.push({ component: "agent-runtime", check })`.
   - 점검: `ctx.io.observation(AGENT_RUNTIME_KIND)`(`check` 안에서 읽는다. `ctx.io`가 `prepare` 시점에는 아직 없을 수 있다). `available`이면 `{ available: true }`, 아니면 `{ available: false, reason: "agent runtime이 준비되지 않았다" }`(observation의 `reason`은 그대로 쓰지 않는다: 안에 무엇이 들어올지 모른다).
3. 이 task는 `closeWork` 등 종료 순서를 바꾸지 않는다. 점검 함수는 종료 뒤에도 던지지 않고 불가를 돌려야 한다(`ComponentCheck`가 던져도 `runComponentChecks`가 불가로 막지만 이유가 "check failed"가 되므로 이 점검에서 직접 막는다).

## 정한 것

- 점검이 보는 것은 "살아 있음"(연결 열림, 읽기 한 번, child ready)뿐이다. "마지막 응답 시각"은 보지 않는다(이슈의 "정하는 쪽이 일"을 가장 단순한 쪽으로 정함).
- 앱 supervisor와 sandbox 점검은 이슈의 정한 것이 아니라 하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(점검은 화면에 보이는 상태이고 내부 구현이다).
- 직접 확인: `mkdir -m 700 -p $PWD/.dev-data/platform-component-checks && export LOPHN_HOME=$PWD/.dev-data/platform-component-checks`로 core를 띄우고 `diagnostics.status`를 한 번 읽어(HTTP 또는 repo의 기존 read 도구) 목록에 `events`와 `agent-runtime`이 `available`로 나오는지 본다. `$!`로 받은 PID만 끈다. 실제 `~/.lophn`은 건드리지 않는다.
- 남지 않음: `grep -n "componentChecks.push" packages/core/main/daemon/wiring/*.ts`에 `diagnostics.ts`, `events.ts`, `lophn-agent-runtime.ts`가 나온다.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: Reactor backoff 상태를 점검이 보지 못한다
