# turn-loop-perf

compaction이 모든 session의 turn 시작을 막지 않게 하고, turn 안에서 첫 입력 image를 한 번만 읽게 한다.

- 단위: run-loop (wave 1)
- 선행: turn-loop. 같은 file을 고친다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/**` (단 `schema.ts` 제외)
  - `packages/core/main/agent-runtime/**`
- 읽을 것:
  - `project-docs/architecture/`의 run-loop·compaction topic
  - `main/agent-runtime/product-driver.ts` 330-370행(pump), `run-loop/driver.ts` 86행
  - `run-loop/core-ports.ts` 186-206행(`inputs()`, `loadParts`)
- 계약:
  - 쓰는 것: core command. 고치지 않는다.
  - 내놓는 것: 없음

## 할 일

1. **compaction이 pump를 막음** — 사람이 요청한 Compact, "Summarize from here", auto-compact(`startNext` 안의 `deps.compact`)는 모두 model 호출인데 turn을 시작하는 같은 serial pump 안에서 inline으로 돈다. 긴 요약 하나가 다른 모든 session의 turn 시작을 늦춘다. compaction을 pump 밖에서 돌린다. 가장 단순한 길: compaction을 시작만 하고 기다리지 않으며, 그 session은 compaction이 끝날 때까지 다음 turn을 시작하지 않는다(session별 in-flight 표). 다른 session의 turn은 계속 시작된다. compaction promise의 rejection도 관찰한다.
2. **image 재읽기** — `inputs()`가 부를 때마다 첫 입력의 `loadParts`(blob 읽기)와 pipe 왕복 두 번을 한다. turn 시작, assembly 뒤, tool gate마다, conclude, facts, retry에서 불린다. turn 하나 동안 첫 입력의 parts를 한 번만 읽어 둔다(turn이 끝나면 버린다).

## 끝남

- `npm run check:full`이 통과한다(lead가 준 Windows 기준선 실패는 빼고).
- 위험 test: "한 session이 compaction 중이어도 다른 session의 turn이 시작되고, compaction 중인 session은 끝날 때까지 새 turn을 시작하지 않는다" 하나. image 캐시는 test하지 않는다(내부 구현).
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴.
