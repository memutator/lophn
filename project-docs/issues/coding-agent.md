# coding-agent

App Engineer가 ticket을 외부 coding agent에게 맡기는 길(session, 터미널, CLI, ticket)이다. `project-docs/architecture/coding-agent.md`.

## codex는 새로 놓은 hook을 사람이 `/hooks`에서 trust해야 쓴다

```yaml
kind: bug
modules: [packages/coding-agent]
```

지금: codex는 새로 놓이거나 바뀐 hook을 사람이 codex 안의 `/hooks`에서 trust하기 전까지 건너뛴다(learn.chatgpt.com/docs/hooks). trust 기록은 `~/.codex/config.toml`의 `[hooks.state."...hooks.json:stop:0:0"] trusted_hash`다. `harness install`은 toml을 쓰지 않는다. 설치된 codex 0.161.0 binary에도 `hooks need review before they can run` 문구와 `trusted_hash` 칸이 있다.

영향: codex에 맡기면 첫 번(그리고 hook이 바뀐 뒤)에는 사람이 trust할 때까지 turn 끝 신호가 안 와서 state가 unknown이다.

고치려면:
- 그대로 두고 confirm 화면에서 "codex에서 /hooks로 trust하라"를 알린다(작음).
- `config.toml`에 trust 기록을 쓴다(중간. toml을 고치는 코드와 hash 규칙을 알아야 한다).

## Claude Code가 coding session마다 folder trust를 묻는다

```yaml
kind: bug
modules: [packages/coding-agent, packages/protocol]
```

지금: Claude Code(2.1.302)는 처음 여는 폴더마다 folder trust 화면을 띄우고, 고를 때까지 hook이 돌지 않는다. 앱 source 폴더는 자기 `.git`을 가진 새 project라, 상위 폴더(`/tmp/lophn-eval`)를 믿어 두어도 다시 묻는다. 이 화면을 넘기는 CLI flag가 없어 launch plan(`packages/protocol/coding-agent/launch-plan.ts`)도 넘기지 못한다.

영향: 사람이 터미널 앞에 없으면 첫 session이 trust 화면에서 멈춘다. 데스크톱에서는 사람이 앱마다 한 번 골라야 한다. eval의 calendar-diagnose 첫 run에서는 터미널 셋이 모두 이 화면에서 2분 뒤 `no_session_start`로 끊겼다.

고치려면:
- 제품: 첫 session을 열기 전에 사람에게 "Claude Code에서 이 폴더를 믿어야 한다"고 알린다(작음). 또는 `~/.claude.json`에 trust 기록을 쓴다(중간. 사람의 설정 file을 고친다).
- eval: driver가 trust 화면 글을 보면 "Yes"를 고르고 기록에 남긴다(작음). 사람이 정했다.

정한 것: eval은 driver가 대신 고르고 `CodingTrace.trust_answered`에 남긴다(사람). 제품 쪽은 그대로 열어 둔다.

## coding agent의 message에 App Engineer가 글로만 답하면 터미널에 가지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/coding-agent]
```

지금: coding agent가 `lophn message send`로 물으면 core가 그것을 맡긴 App Engineer에게 `reply: "none"` call로 넣는다(`packages/core/apps/tickets/coding/message.ts` `applyMessage`). 보낸 쪽이 agent가 아니라 call 행과 id가 없다. App Engineer가 보는 봉투는 `<lophn-call from="coding_agent:ses_…" call="" reply="none">`이다(`packages/core/lophn-agent/run-loop/input-text.ts` `callText`). 답하는 법은 `reply === "result"`일 때만 적힌다. App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md`)은 "Answer, or fix the blueprint and dependency and tell it"뿐이다. 터미널에 닿는 길은 `call`의 `to:{session}`, `reply:"conversation"`이다.
- calendar-mvp 첫 run: App Engineer가 `to:{role:"coding_agent", place}`로 한 번 실패한 뒤 `to:{session}`로 답했고, coding agent는 이어 끝냈다.
- 저장되지 않은 calendar-diagnose run: App Engineer가 `guide.read`·`ticket.get` 뒤 글로만 답했다(중국어였다). `coding_inputs`가 비었고, coding agent는 `Stop` 뒤 11분 동안 답을 기다리다 lead가 run을 멈췄다.
- `lophn message send --help`는 `refs (선택, array)`로만 적어, coding agent가 객체를 넣고 `invalid_input`을 한 번 받았다.

영향: App Engineer가 글로 답하면 coding agent는 답을 못 받고 멈춘다. 사람이 터미널을 보지 않으면 ticket이 끝나지 않는다.

고치려면:
- (가) 봉투와 지침: `from.kind === "coding_agent"`인 call의 봉투에 "글은 터미널에 가지 않는다. `call`의 `to:{session:<id>}`, `reply:"conversation"`으로 답한다" 한 줄을 넣고, App Engineer 지침에 같은 길을 적는다. `--help`에 refs가 ticket id 문자열의 배열이라고 적는다(작음). 봉투는 받은 turn과 뒤 이력에서 같은 함수로 만들어 cache가 깨지지 않는다. 지침을 고치면 prefix가 한 번 바뀐다.
- (나) message를 call 행으로 남겨 `reply`로 답하게 한다(중간). call store와 `router.reply`가 coding session을 받는 쪽으로 다뤄야 하고, message마다 행이 생긴다.
- (다) 그 turn의 마지막 글을 core가 터미널로 보낸다(중간). 그 글은 사람에게 쓴 요약이라 터미널에 잡음이 들어가고, 한 turn에 사람 말과 coding agent의 물음이 섞이면 가를 수 없다.
추천: (가).
