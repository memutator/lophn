# compact-mid-turn

turn 안 tool loop가 예산을 넘으면 오래된 tool 결과를 지우기 전에 지금까지의 대화(이 turn의 진행 포함)를 요약하는 자동 Compact를 하고 같은 turn을 이어 간다.

- 단위: run-loop (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/**` (단 `schema.ts` 제외)
  - `packages/core/lophn-agent/session/compact.ts`, `session/compactor.ts`, `session/commands.ts`와 그 test
  - `packages/core/main/agent-runtime/**`
  - `packages/protocol/lophn-agent/sessions.ts` (Compact command 입력과 `CompactStarted` payload만)
  - `packages/protocol/events/agent.ts` (`CompactStarted`·`CompactEnded` payload만)
  - 추가 소유: `packages/core/main/daemon/wiring/acp.ts`에서 Compact event를 읽는 줄만, `packages/core/main/daemon/wiring/acp-send.ts`의 Compact 부르는 줄만
  - `project-docs`는 고치지 않는다(lead가 고친다)
- 읽을 것:
  - `project-docs/architecture/agent-definition.md`의 compact 항목과 그 앞뒤(예산, 이미지, `omitOldImages`)
  - `project-docs/architecture/workspace-session.md`의 rewind와 Compact 구간(`compaction_through_seq`)
  - `packages/core/lophn-agent/run-loop/turn.ts`의 `prepare`, `shrinkHistory`, `historyOf`, `noteUsage`, `afterOverflow`, 상수 `SHRINK_AT`·`SHRINK_TO`·`COMPACT_AT`
  - `packages/core/lophn-agent/session/compactor.ts`의 `work`, `compactNow`, `recentStart`, `visibleMessages`
  - `packages/core/lophn-agent/session/compact.ts`의 요청·확정 command와 "a turn of the session is not finished" 거절
- 계약:
  - 쓰는 것: core command StartModelCall 등. 고치지 않는다.
  - 내놓는 것: turn port `compact()`(이름은 정해도 된다) — 도는 turn이 자기 session을 Compact하고 결과(`compacted` | `skipped` | `failed`)를 돌려준다. Compact command가 그 turn이 연 요청을 받는 칸(예: 요청 입력의 `turn`). `CompactStarted`의 `turn`이 null이 아닐 수 있다.

## 할 일

1. **core가 turn 안 Compact를 받는다** (`session/compact.ts`): 지금 요청과 확정은 그 session의 turn이 끝나지 않았으면 `conflict`다. 요청이 그 도는 turn 자신의 것(machine 자격, 입력의 `turn`이 지금 도는 turn과 같음)이면 받는다. 확정 때도 같은 turn이 아직 돌고 있어야 하고, 덮는 끝은 확정 메시지다(지금 규칙 그대로). 사람·다음 turn 전 자동 Compact의 규칙은 바꾸지 않는다. `CompactStarted`의 payload `turn`에 그 turn을 싣는다.
2. **compactor** (`session/compactor.ts`): `compactNow`와 같은 길로 `compactInTurn(session, turn)`을 더한다. 요약 재료는 지금처럼 `visibleMessages`에서 `recentStart`로 최근 사람 메시지 몇 개를 남긴 앞부분이다. 이 turn이 이미 기록한 agent 메시지와 tool 결과가 재료에 들어간다(turn 안 진행도 요약에 담긴다). 요약 prompt에 "작업이 진행 중이고 요약 뒤 같은 작업을 이어 간다, 지금까지 한 일·읽은 파일의 요점·남은 일을 남긴다"는 뜻을 더한다(turn 안일 때만). 요약할 것이 없으면 `skipped`.
3. **turn loop** (`run-loop/turn.ts`): `prepare`에서 조립 추정이 예산의 `SHRINK_AT`을 넘으면, 그 turn에서 turn 안 Compact를 아직 `MID_TURN_COMPACT_MAX`(2) 번 하지 않았을 때 먼저 turn port `compact()`를 부른다. `compacted`면 context를 다시 읽고 `state.history`를 Compact가 덮은 끝 뒤의 것만 남게 맞춘 뒤(덮인 turn 안 메시지는 요약이 맡는다) 다시 조립한다. `skipped`·`failed`면 지금처럼 `shrinkHistory`로 물러난다. provider가 입력이 크다고 거절했을 때(`afterOverflow`)도 같은 순서다. 요약 중에도 멈춤(`stopped`)을 본다.
4. **연결** (`main/agent-runtime/**`): turn port `compact()`가 runtime의 compactor `compactInTurn(session, turn)`을 부르게 잇는다. 요약 call은 지금 Compact 요약과 같은 model(Model for summaries)·같은 purpose다.
5. **turn이 Compact를 정하는 규칙**(`noteUsage`의 `COMPACT_AT`, 다음 turn 전 lazy Compact)은 그대로 둔다.
6. `acp.ts`가 `CompactStarted`·`CompactEnded`를 사용량 갱신에 쓰는 곳은 turn이 null이 아닌 경우에도 그대로 동작하게만 맞춘다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test(사람의 대화를 잃거나 틀린 turn이 Compact를 확정하면 곤란하다):
  - "도는 turn은 자기 session의 Compact를 열고 확정할 수 있고, 다른 turn이나 turn 없는 요청은 그 session의 turn이 도는 동안 여전히 거절된다"
  - "turn 안 Compact 뒤 같은 turn이 이어지고, 다음 model 요청의 이력은 요약 + 덮은 끝 뒤의 메시지다(덮인 turn 안 tool 결과가 다시 실리지 않는다)"
  - "turn 안 Compact가 실패하면 오래된 tool 결과 지우기로 물러나 turn이 끝나지 않는다"
- `bash project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.
- 막히면(예: rewind가 turn 안에서 끝나는 Compact 구간을 다룰 수 없음) 추측하지 말고 할 수 있는 데까지 하고 보고한다.

## 보고

brief-template의 보고 꼴. rewind와 turn 안 Compact 구간이 같이 있을 때의 동작을 확인해 적는다.
