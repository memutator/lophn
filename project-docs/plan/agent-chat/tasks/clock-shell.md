# clock-shell

"Worked for"와 일하는 중 줄이 active(사람 기다림 제외)를 보인다: `WorkingRow`는 `active + (now − 기준 시각)`으로 기다림 뒤에 건너뛰지 않고 `role="status"`를 갖는다. 도는 중 `TurnEnded`와 snapshot의 `tailOf`가 같은 함수로 시간을 만들고, 기다린 시간이 있었던 turn은 완료 줄 tooltip에 기다린 시간(wall − active)을 보인다. `duration`은 60분 이상을 `1h 5m`으로 쓴다. `secondsBetween`과 `WorkedFor` 주석의 틀린 이름·설명은 지운다.

- 단위: clock (wave 3)
- 선행: reasoning-shell. 같은 thread file을 고친다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/activity/worked-for.tsx`
  - `packages/shell/renderer/conversation/message-list/agent-turn.tsx`
  - `packages/shell/renderer/conversation/agent-tab-data.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/agent-thread.tsx`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/design/wording/catalog/{conversation,conversation.placeholders}.ts` (공용, key만 더한다)
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`("agent event와 화면": snapshot을 읽고 그 뒤 event로 고친다), `project-docs/architecture/approval.md`(사람 기다림은 turn 안 request와 질문이고 turn은 그동안 기다린다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 element `shell`, interface `event-stream`(`TurnStarted`, `TurnResumed`, `TurnEnded.active_ms`), `core-api`(session snapshot의 `elapsed`, `ListTurns`의 `TurnRecord`), `design-api`(`Tooltip`, `Shimmer`, `useDelayedLoading`). `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/agent-chat/README.md` "정한 것"의 "Worked for는 active", `project-docs/products/roadmap/agent-chat.md` 6과 "지금 코드 > 시간"
  - 계약: `project-docs/plan/agent-chat/tasks/chat-protocol.md`(`TurnResumed`, `TurnEnded.active_ms`, snapshot `elapsed`), `clock-core.md`(끝난 turn의 active는 끝난 순간까지 마감한 값이고 멈춤·실패·끊김도 같다)
  - 본보기(화면): `tools/wireframes/pages/screens/agent.tsx`의 page `new-agent-approval-states`(끝난 turn, 승인 넷), `new-agent-skip`(`report`와 같은 대화, "Worked for"), `new-agent-conversation`(일하는 중 줄)
  - skill: `.claude/skills/wording/SKILL.md`, `.claude/skills/ui-design/SKILL.md`
  - 코드:
    - protocol: `packages/protocol/events/agent.ts`, `packages/protocol/events/snapshot.ts`(`elapsed`), `packages/protocol/lophn-agent/turn-values.ts`(`TurnRecord.started_at`·`finished_at`·`elapsed.active_ms`)
    - 화면 값: `packages/shell/renderer/conversation/agent-tab-source.ts`(`TurnView`, `ThreadTurnEnd`), `agent-tab-data.ts`(`foldEvent`의 `TurnStarted`·`TurnEnded`, `settle`), `agent-tab-core-source-thread.ts`(`secondsBetween`, `tailOf`, `readThread`의 `turn`), `agent-tab-fake-source.ts`(`working()`, `turn-end` 줄, `send`, `stop`, `approval-states` 장면)
    - 그리기: `packages/shell/renderer/conversation/activity/worked-for.tsx`(`duration`, `WorkedFor`), `message-list/agent-turn.tsx`(`WorkingRow`), `agent-view.tsx`(`working`), `agent-thread.tsx`(`WorkingRow`, `WorkedFor`를 부르는 곳), `packages/design/components/overlay/tooltip/tooltip.tsx`
    - 문구: `packages/design/wording/catalog/conversation.ts`의 `conversation.label.duration-*`, `worked-for`, `stopped-after`, `status-working`
- 계약:
  - 쓰는 것: `chat-protocol`의 `TurnEnded.active_ms`, `TurnResumed`(`at`, `active_ms`), snapshot `elapsed`; `TurnRecord`(`packages/protocol/lophn-agent/turn-values.ts`)의 `started_at`·`finished_at`·`elapsed`; `clock-core`가 채운 값.
  - 내놓는 것: 시간 단위가 있는 `duration(ms)`(`activity/worked-for.tsx`). `tool-title-shell`이 call마다 걸린 시간에 쓴다.

## 할 일

정한 것(살 단계):
- 끝 줄의 시간을 만드는 같은 함수 `turnEndTimes`는 화면 값 type 옆(`agent-tab-source.ts`)에 둔다. 도는 중 접기(`agent-tab-data.ts`)와 snapshot(`agent-tab-core-source-thread.ts`)이 둘 다 이미 이 file을 import한다. component file(`worked-for.tsx`)을 data file이 import하지 않게 한다.
- active를 모르면(`TurnEnded.active_ms`가 null, coding agent) wall을 active로 쓰고 기다림은 0이다. 시작 시각도 모르면 0이다.
- tooltip은 기다린 시간이 1초 이상일 때만 단다(`duration`이 "0s"를 내지 않게).
- 60분 이상은 시와 분만 쓰고 초는 버린다. 분이 0이면 `1h`다.
- `TurnView.elapsed`가 없으면(snapshot에 칸이 없음) `startedAt`부터 0으로 센다. `startedAt`도 없으면(보낸 말을 아직 받지 않음) 줄이 처음 선 때부터 센다(지금 동작).
- 기다린 시간 tooltip의 말은 `conversation.label.waited-for` "Waited {duration} for you"다.

1. `packages/shell/renderer/conversation/agent-tab-source.ts` (근거: roadmap 6 "shell", 계약 snapshot `elapsed`·`TurnResumed`)
   - `TurnView`에 `readonly elapsed: { readonly activeMs: number; readonly at: string } | null`. 주석: 도는 turn이 `at`까지 일한 시간(사람 기다림 제외). 일하는 중 줄은 `activeMs + (now − at)`을 보인다. 모르면 null.
   - `ThreadTurnEnd`의 `durationMs`를 지우고 `activeMs`(agent가 일한 시간, 사람 기다림 제외)와 `waitedMs`(사람을 기다린 시간, wall − active)를 둔다.
   - `export function turnEndTimes(startedAt: string | null, finishedAt: string, activeMs: number | null): { activeMs: number; waitedMs: number }`: wall은 `max(0, finishedAt − startedAt)`(시작을 모르면 없음), active는 `activeMs ?? wall ?? 0`, 기다림은 `max(0, wall − active)`(wall이 없으면 0). 위 정한 것.
2. `packages/shell/renderer/conversation/activity/worked-for.tsx` (근거: roadmap 6 "`duration`에 시간 단위", "tooltip에 기다린 시간")
   - `duration(ms)`: 반올림한 초를 시·분·초로 나눠 1시간 이상이면 `conversation.label.duration-hours`(분이 0) 또는 `conversation.label.duration-hours-minutes`, 그 아래는 지금 셋 그대로다. 위 주석을 "1분 미만은 18s, 1시간 미만은 1m 15s, 그 위는 1h 5m"로 고친다.
   - `WorkedForProps`를 `{ activeMs: number; waitedMs: number; stopped?: boolean }`로 바꾼다. 틀린 주석 "turn이 일한 시간(ms). trace의 times.active_ms다."를 지우고 "agent가 일한 시간(사람 기다림 제외). core가 turn 끝에 마감한 값이다"로 쓴다.
   - `waitedMs >= 1000`이면 `<p>`를 `Tooltip`(`@lophn/ui/overlay`)으로 감싸고 content는 `t("conversation.label.waited-for", { duration: duration(waitedMs) })`다. "Stopped after"도 같다.
   - 머리 주석("일이 끝난 뒤 남는 회색 … 줄")에 시간 단위와 tooltip을 반영한다.
3. `packages/shell/renderer/conversation/message-list/agent-turn.tsx` (근거: roadmap 6 "`WorkingRow`는 `active + (now − 기준 시각)`", "`role="status"`")
   - `WorkingRow({ clock, now }: { clock: { activeMs: number; at: number } | null; now: () => number })`. 걸린 시간은 `clock`이 있으면 `clock.activeMs + now() − clock.at`, 없으면 줄이 처음 선 때(`useState(now)`)부터다. 0보다 작으면 0이다. 300ms 지연, 1초 tick, 10초 문턱은 그대로다.
   - 줄의 `div`에 `role="status"`를 주고, 걸린 시간 `span`에 `aria-hidden="true"`를 준다(1초마다 바뀌는 숫자를 읽지 않는다).
   - 위 주석의 "`since`를 모르면"을 새 규칙으로 고친다.
4. `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts` (근거: roadmap 6 "같은 함수", "`secondsBetween` … 지운다")
   - `secondsBetween`을 지운다. `tailOf`의 `turn-end`는 `turnEndTimes(turn.started_at, at, turn.elapsed.active_ms)`의 `activeMs`·`waitedMs`를 싣는다.
   - `readThread`의 `turn`에 `elapsed`: 도는 turn이고 session snapshot의 `elapsed?.turn`이 그 turn이면 `{ activeMs: elapsed.active_ms, at: elapsed.at }`, 아니면 null이다.
5. `packages/shell/renderer/conversation/agent-tab-data.ts` (근거: 계약 `TurnResumed`, `TurnEnded.active_ms`)
   - `TurnStarted`: 새 `TurnView`에 `elapsed: { activeMs: 0, at: event.at }`.
   - `TurnResumed` case를 더한다: `view.turn?.id === turn`이면 `turn: { ...view.turn, elapsed: { activeMs: active_ms, at: event.at } }`, 아니면 그대로다.
   - `TurnEnded`: `durationMs` 계산(`event.at − startedAt`)을 지우고 `turnEndTimes(startedAt, event.at, active_ms)`를 끝 줄에 싣는다. 끝난 `TurnView`는 `elapsed: null`이다.
   - `foldEvent` 위 주석에 `TurnResumed`를 한 줄 더한다.
6. `packages/shell/renderer/conversation/agent-view.tsx`
   - `working`을 `{ clock }`로 바꾼다. `active.elapsed`가 있으면 `{ activeMs, at: Date.parse(at) }`, 없고 `active.startedAt`이 있으면 `{ activeMs: 0, at: Date.parse(startedAt) }`, 그 밖(아직 turn이 없는 보내는 중)은 null이다. 질문·승인을 기다리는 동안 줄이 없는 것은 지금 그대로다.
7. `packages/shell/renderer/conversation/agent-thread.tsx`
   - `AgentThreadProps.working`을 `{ readonly clock: { activeMs: number; at: number } | null } | null`로 바꾸고 주석을 고친다. `WorkingRow`에 `clock`을 넘긴다.
   - `WorkedFor`에 `activeMs={entry.activeMs}`, `waitedMs={entry.waitedMs}`를 넘긴다.
8. `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
   - 모든 `TurnView`에 `elapsed`: `working()`과 `send`가 여는 turn은 `{ activeMs: 0, at: <시작 시각> }`, 끝났거나 기다리는 turn은 null이다.
   - `turn-end` 줄(`report`, archive한 session, `stop`)의 `durationMs`를 `activeMs`로 옮기고 `waitedMs: 0`.
   - `approval-states` 장면 끝에 끝 줄 하나: `{ kind: "turn-end", id: "end-1", at: at(43), turn: turn1, outcome: "completed", activeMs: 3_900_000, waitedMs: 300_000 }`. "Worked for 1h 5m"과 tooltip "Waited 5m for you"를 gallery에서 본다.
9. wording(근거: `wording` skill): `packages/design/wording/catalog/conversation.ts`에 셋을 정렬 자리에 더하고 `deno task wording`으로 `conversation.placeholders.ts`를 다시 만든다.
   - `conversation.label.duration-hours`: "{hours, number}h"
   - `conversation.label.duration-hours-minutes`: "{hours, number}h {minutes, number}m"
   - `conversation.label.waited-for`: "Waited {duration} for you"

## 끝남

- `deno task check`가 통과한다.
- renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`가 선다.
- `deno run --allow-read tools/check-wording.ts`가 새 key에 오류를 내지 않는다.
- 위험 test: 없음. 시간과 화면이다(README "위험 test", `write-test`).
- 남지 않음: `grep -rn --exclude-dir=dist "secondsBetween\|times\.active_ms\|working\.since\|durationMs={" packages/shell tools`가 0줄이다.
- (화면) `deno task wireframes`가 되고:
  - `new-agent-approval-states` 끝에 "Worked for 1h 5m"이 있고 hover하면 "Waited 5m for you" tooltip이 뜬다.
  - `new-agent-skip`의 "Worked for 18s"에는 tooltip이 없다.
  - `new-agent-conversation`의 일하는 중 줄 `[data-working]`에 `role="status"`가 있다.
- lead가 merge 때 `deno task dev`(fake provider)로 승인을 기다린 뒤 일하는 중 줄의 시간이 건너뛰지 않는지 본다(README "lead가 할 일").

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적을 것: `TurnResumed`를 놓치면(Bus가 놓침) 다시 읽기 전까지 일하는 중 줄이 기다린 만큼 앞서 있는 것
