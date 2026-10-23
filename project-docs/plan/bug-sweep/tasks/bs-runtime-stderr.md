# bs-runtime-stderr

agent runtime child가 stderr에 쓴 진단 줄을 core가 버리지 않고 core stderr에 접두를 붙여 쓰게 한다. 개발자가 core.log에서 `turn start failed: ...` 같은 원인 글을 볼 수 있게 하려는 것이다.

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/runtime.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`("지금", "고치려면"의 추천안)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/supervision`(boundary `supervision`), `packages/core/lophn-agent`(boundary `lophn-agent`), `packages/core/main`(boundary `core`)
  - 본보기: `runtime.ts`의 `diagnostic?` dep(같은 꼴의 주입), `lophn-agent-runtime.ts`의 ``console.error(`agent runtime: ...`)``
- 계약:
  - 쓰는 것: `ChildCallbacks.onStderr?(line: string)`(`packages/core/supervision/responsiveness/slot.ts`). supervisor의 `drainStderr`(`responsiveness/run.ts`)가 줄 단위(최대 `STDERR_LINE_MAX`)로 부른다. 원문은 보관하지 않는다. 바꾸지 않는다.
  - 내놓는 것: `AgentRuntimeDeps`에 선택 dep `stderr?(line: string): void` 하나.

이슈와 코드가 어긋난 곳: 이슈는 "daemon wiring이 agent runtime slot에 `onStderr`를 건다"고 하지만 slot의 callbacks 객체는 wiring이 아니라 `packages/core/lophn-agent/run-loop/runtime.ts`의 `startAgentRuntimeChild` 안 `callbacks()`가 만든다(`onMessage`·`onFrame`·`onEnd`). wiring(`lophn-agent-runtime.ts`)은 `startAgentRuntimeChild`의 deps를 채울 뿐이다. 그래서 두 file을 고친다. 이슈의 modules에 `packages/core/lophn-agent`가 빠져 있다. `grep -rn onStderr packages/core`가 정의와 부르는 곳(`slot.ts`, `run.ts`)뿐이라는 말은 맞다.

## 할 일

1. `runtime.ts`: `AgentRuntimeDeps`에 `stderr?(line: string): void`를 더한다(주석은 "child가 stderr에 쓴 줄. 진단 원문은 child가 이미 안전화해서 쓴다"). `callbacks()`가 돌려주는 객체에 `onStderr: (line) => deps.stderr?.(line)`를 더한다. child가 갈릴 때마다 `callbacks()`가 새로 불리는 구조(`updateSpec`)라 새 generation도 같은 dep을 쓴다.
2. `lophn-agent-runtime.ts`: `startAgentRuntimeChild({...})` 호출에 ``stderr: (line) => console.error(`agent runtime: ${line}`)``를 더한다(접두는 같은 file의 기존 `agent runtime:`과 맞춘다). 다른 wiring이 로그를 쓰는 방법(`console.error`)과 같다. 줄 필터나 가공은 하지 않는다: child가 이미 redaction해서 쓰므로 그대로 옮긴다.
3. 문서는 이 task가 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음. (`grep -rn "onStderr" packages/core`에 `runtime.ts`가 더해진 것이 정상이다.)

## 보고

- 바꾼 file
- 통과한 check
- 무겁게 짠 것 / 알려진 미완 동작 (없으면 "없음")
