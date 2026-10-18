# ch-trust

Claude Code는 처음 여는 폴더마다 folder trust 화면을 띄우고, 사람이 "Yes"를 고를 때까지 hook이 돌지 않는다. 그래서 lophn은 SessionStart 신호를 못 받고, 사람이 그 탭을 보고 있지 않으면 맡기기가 조용히 멈춘다. 터미널 탭을 열었는데 첫 hook 신호가 아직 없는 coding session을 대기 목록에 "터미널에서 확인이 필요할 수 있다" 항목으로 보이고(누르면 그 탭으로 focus), 첫 신호나 session 끝에 지운다. 화면 글자를 읽어 trust 화면을 알아보지 않고(architecture/coding-agent.md "harness의 권한 물음에 lophn 화면으로 답하지 않는다"), `~/.claude.json`을 쓰지 않는다. core는 바꾸지 않는다.

- 단위: ch-trust (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/connection/events/waiting-store.ts`
  - `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts` (생성자 호출만 맞춘다)
  - `packages/shell/renderer/desktop/connection/events/hooks.tsx` (`EventsProvider`가 터미널 bridge를 넘긴다)
  - `packages/shell/renderer/desktop/connection/waiting/model.ts` (`cardOf`)
  - `packages/shell/renderer/desktop/connection/waiting/waiting-panel.tsx` (`GROUPS`, `card` switch)
  - `packages/design/wording/catalog/data.ts`, `packages/design/wording/catalog/data.placeholders.ts` (`deno task wording`이 쓴다)
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`("지키는 것"의 상태는 hook에서만 / 권한 mode는 lophn이 정하지 않는다 / session의 끝은 process exit)
  - 이슈: `project-docs/issues/coding-agent.md`의 "Claude Code가 coding session마다 folder trust를 묻는다"(닫는 것은 lead)
  - 지금 코드(core): `packages/core/apps/tickets/coding/store.ts`(`stateOf`: `permissions`가 있으면 waiting, `heard`가 아니면 unknown), `hook.ts`(첫 신호에서 `ensureStarted`가 `SessionStarted` event를 낸다), `packages/core/main/daemon/wiring/session-snapshots.ts`(열린 coding session을 `state: stateOf(row)`로 싣는다)
  - 지금 코드(shell): `packages/shell/ipc/terminal.ts`(`TerminalApi.onRuntime`, `TerminalRuntime`의 `coding_session`·`launch_kind`·`product`·`state`), `packages/shell/main/desktop/wiring/coding.ts`(`publish`가 runtime을 모든 창에 보낸다), `renderer/terminal/use-terminal-open-requests.ts`(`requestOf`), `renderer/terminal/store.ts`(`focusSession`), `waiting/cards/coding-card.tsx`
  - wording: `.claude/skills/wording/SKILL.md`
- 계약:
  - 쓰는 것: `TerminalApi.onRuntime`(`globalThis.lophnTerminal`, 없으면 null), bus event `SessionStarted`·`SessionEnded`, `readSessionSnapshots`의 `state`, `HOOK_EVENT_TABLE`(`packages/protocol/coding-agent/hook-signal.ts`), 기존 `onAnswerInTerminal`(= `TerminalStore.focusSession`)
  - 내놓는 것: `WaitingEntry`에 `Common & { kind: "coding_start" }`(request 없음, id는 `start:<session>`). 다른 task가 기대는 것은 없다.

## 할 일

1. 조건은 shell에서 계산한다(`waiting-store.ts`). 이유: core는 터미널이 열린 때 event를 내지 않고 시계도 못 밀어 delay를 못 걸며, shell은 runtime을 이미 받고, "첫 신호"의 근거는 그대로 core의 event와 snapshot 하나다. `createWaitingStore(client, now, terminals)`에 `terminals: Pick<TerminalApi, "onRuntime"> | null`과 timer(`setTimeout` 꼴)를 인자로 받는다(전역을 읽지 않는다). 지금 호출은 `hooks.tsx`와 `waiting-store_test.ts`뿐이다.
2. `start()`에서 `terminals.onRuntime`을 듣는다. `launch_kind === "coding_tui"`, `coding_session`이 있고, state가 `starting`·`running`이고, `product`의 `HOOK_EVENT_TABLE`에 `SessionStarted` 신호가 있는 session만 "첫 신호 대기"로 센다. 이유: OpenCode는 SessionStart hook이 없어 첫 신호가 첫 turn 끝이라 항목이 오래 남는다. runtime은 state가 바뀔 때마다 다시 오므로 session당 처음 본 시각만 기억한다.
3. delay: 센 뒤 `STARTING_QUIET_MS`가 지나도 신호가 없을 때만 `put`한다. 정상 시작에 깜빡이지 않게 한다. 정상 SessionStart가 얼마나 빨리 오는지 적힌 곳은 코드에도 문서에도 없다(eval driver의 `no_session_start`은 2분 기한이다). 5000ms 상수는 worker가 정한다(보고의 "정한 것"에 쓴다).
4. 지우는 때: `SessionStarted`(어느 첫 신호든 core가 이 event로 알린다), `SessionEnded`, runtime state `exited`·`unknown`, `replace()`의 snapshot에서 그 session이 없거나 `state !== "unknown"`. 지울 때 timer도 푼다. `start()`의 해지 함수도 timer를 푼다. `WAITING_CONDITION`에 `SessionEnded`를 더한다.
5. 카드: `model.ts` `cardOf`와 `waiting-panel.tsx`를 맞춘다. `GROUPS`는 permission 묶음에 `coding_start`를 넣고, `card`는 기존 `CodingCard`를 그대로 쓴다([Answer in terminal]이 `onAnswerInTerminal(entry.session)`으로 간다). 결정 단추가 없으니 `decide.ts`에는 닿지 않는다. TypeScript가 `WaitingEntry`를 쓰는 곳(`settled.ts`, `decide.ts`)의 빠진 case를 알려 준다.
6. wording: `catalog/data.ts`(waiting.* 문구가 있는 catalog)에 `waiting.title.coding-start`(마침표 없음), `waiting.notice.coding-start`(문장, 마침표 있음)를 더한다. 화면 문구는 영어다. 예: "Check the terminal", "The coding agent hasn't reported in yet. You may need to confirm something in its terminal tab, such as trusting the folder." 그다음 `deno task wording`, `deno run --allow-read tools/check-wording.ts`(`deno task check`의 "wording" 단계).
7. 문서는 고치지 않는다(`coding-agent.md`는 같은 wave의 ch-reply가 갖는다). 보고의 "넘길 줄"에 lead가 넣을 글을 적는다: `architecture/coding-agent.md` "지키는 것"의 "coding agent의 권한 mode는 lophn이 정하지 않는다" 아래에 한 항목을 더한다. 터미널을 열고 첫 신호가 없는 session은 일정 시간 뒤 대기 목록에 "확인이 필요할 수 있다"로 보이고, 첫 신호나 끝에 지운다. lophn은 trust 화면을 읽지 않고 답하지 않는다. "왜 이 모양인가"에도 한 줄(core에 두지 않은 이유).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 사용자 data, 권한, 경계를 건드리지 않는 표시이고 항목이 남아도 해가 없다. 새 subprocess·browser·E2E test는 만들지 않는다(사람에게 먼저 묻는다). `waiting-store_test.ts`는 호출 모양만 맞춘다.
- 손으로 보기(lead): `deno task dev`에서 hook을 부르지 않고 sleep만 하는 가짜 `claude`를 PATH 앞에 두고 App Engineer가 ticket을 맡기게 한다. 5초쯤 뒤 알림 단추에 1이 뜨고 항목을 누르면 그 coding 탭으로 focus가 간다. 그 탭에서 `lophn hook claude SessionStart`를 부르거나 process를 끝내면 항목이 사라진다. 진짜 Claude Code는 trust 화면에서 멈춘 채 같은 항목이 뜨고 "Yes" 뒤에 사라진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(delay 값, 문구)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 터미널이 열린 뒤에 만든 창은 그 runtime event를 못 받아 항목이 안 뜬다(고치려면 snapshot에서 `unknown`인 coding session도 센다). dev-mock·gallery는 터미널 bridge가 없어 이 항목이 없다.
