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

## App Engineer의 `session.list`는 열린 coding session을 보여 주지 않는다

```yaml
kind: bug
modules: [packages/core/router, packages/core/main]
```

지금: `session.list`(`packages/core/lophn-agent/tools/call/sessions.ts` `listSendable`)는 router read(`packages/core/router/reads.ts` `sendableRead`)의 `directory.listOpen()`과 `queued_coding`을 돌려준다. coding session은 `withCodingSessions`(`packages/core/main/daemon/wiring/router-registration.ts`)가 `find`에만 더해 `listOpen`에 없다. 그래서 App Engineer가 열린 coding session id를 아는 길은 coding agent가 보낸 call의 봉투뿐이다.

영향: 봉투가 없는 turn(같은 앱의 새 App Engineer session, 사람이 "그 coding agent에게 이렇게 전해"라고 할 때)에서 App Engineer가 도는 coding session에 말을 걸 id를 찾지 못한다. `to:{role:"coding_agent", place}`는 새 맡기기라 줄에 선다.

고치려면: `withCodingSessions`가 `listOpen`에도 ended 아닌 coding session을 더한다(작음). 추천.

## 첫 신호 대기 항목은 터미널이 열릴 때 runtime을 받은 창에만 뜬다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: `coding_start` 항목(`packages/shell/renderer/desktop/connection/events/waiting-store.ts` `watchStart`)은 `TerminalApi.onRuntime`으로 터미널이 열리는 것을 본 창의 store만 센다. 터미널이 열린 뒤에 만든 창은 그 runtime event를 받지 못해 항목이 없다. event stream이 끊긴 사이 첫 신호를 들은 session의 runtime event가 다시 붙은 뒤 오면 `done`에 없어 5초 뒤 항목이 다시 뜨고, 다음 snapshot까지 남는다.

영향: 사람이 뒤에 연 창에서 일하면 trust 화면에서 멈춘 맡기기를 알지 못한다(먼저 연 창에는 뜬다). 다시 붙은 뒤에는 이미 시작한 session에 "Check the terminal"이 잠깐 잘못 뜰 수 있다.

고치려면: snapshot에서 `state === "unknown"`인 열린 coding session도 세고, runtime으로 센 session도 snapshot의 state로 거른다(작음). 추천.
