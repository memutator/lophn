# mistakes

worker가 크게 잘못한 것. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.

## core main에서 전역 fetch로 자기 HTTP를 불러 problem을 보고했다

```yaml
kind: mistake
modules: [packages/core/problems, tools]
```

지금: examples run 뒤 "증명 못 함" write tool을 problem으로 알리는 첫 구현이 `packages/core/problems/tests/control.ts`(core main process)에서 app credential을 발급해 `globalThis.fetch`로 core 자기 loopback의 `problemReport`를 불렀다. `proven`도 examples 증거가 아니라 예시 step의 tool 이름 전부였다. review에서 되돌려 보고는 runner child(`work/runner-service.ts`)가 주입받은 fetch로 하고 `proven`은 증거에서 읽게 했다.

영향: AGENTS.md "네트워크는 인자로 받는다"를 어긴 core main 코드가 check와 core 기동을 통과했다. 되돌리지 않았으면 test에서 바꿀 수 없는 network 호출과, 되돌리지 않은 write를 증명한 것으로 세는 알림이 남았다.

원인:
- brief가 증거(`unproven`, `proven`)를 observations blob에서 읽는다고 적었는데 그 blob에는 검사별 hash만 있다(진단이 저장 모양을 열어 보지 않았다). worker는 막힌 길을 우회했다.
- `packages/core/problems`의 주석 여럿이 "core graph의 EXTERNAL_FETCH tripwire가 bare fetch를 금지한다"고 하지만 그런 check는 없다. 잡을 장치가 있다고 믿게 한다.

막기:
- check: `packages/core`의 core main graph(child worker 진입점 밖)에서 `fetch(`와 `globalThis.fetch`를 막는다. 그 전까지 주석의 tripwire 말은 실제와 다르다.
- brief를 쓸 때 "읽을 것"의 data가 실제로 저장되는지 표나 blob 모양을 열어 본다(planner-persona).
