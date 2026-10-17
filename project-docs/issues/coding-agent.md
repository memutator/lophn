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

## 전역 hook command가 PATH의 `lophn`을 부른다

```yaml
kind: bug
modules: [packages/coding-agent]
```

지금: 전역 hook은 `lophn hook <harness> <event>`이고 `lophn`이 PATH에 있다고 본다. 개발 실행(`LOPHN_CLI`)에서는 PATH의 `lophn`이 없거나 다른 판이라 전역 hook이 맞지 않는다.

영향: 개발 중에는 coding session의 turn 끝 신호가 안 오거나 설치된 판의 core로 간다.

고치려면: 개발 실행에서는 hook command에 `LOPHN_CLI` 경로를 쓴다(작음). 다만 전역 설정에 개발 경로가 남는다.

## OpenCode가 turn 끝을 event 둘로 내서 TurnEnded가 두 번 간다

```yaml
kind: bug
modules: [packages/coding-agent, packages/protocol, packages/core/apps]
```

지금: 설치된 OpenCode(1.18.35)는 idle이 되면 canonical `session.status`(idle)를 낸 뒤 deprecated `session.idle`을 이어서 낸다(같은 판에서 도는 다른 도구의 plugin이 이 순서를 전제로 둘째를 거른다). `protocol/coding-agent/hook-signal.ts`의 `HOOK_EVENT_TABLE.opencode`는 둘 다 `TurnEnded`로 바꾸고, plugin(`harnesses/install.ts`의 `opencodePlugin`)도 둘 다 넘긴다. `core/apps/tickets/coding/hook.ts`의 `TurnEnded` 처리는 중복을 가리지 않는다. 첫 신호가 `drain`으로 대기열의 다음 메시지를 넣어 `inflight`를 켜면, 둘째 신호가 `running`·`inflight`를 다시 끄고 `TurnEnded` event를 한 번 더 낸다.

영향: OpenCode로 맡기면 turn마다 `TurnEnded`가 두 번 기록되고, 대기열에 메시지가 둘 이상일 때 앞 메시지가 아직 turn으로 이어지기 전에 다음 메시지가 들어가 순서가 겹친다.

고치려면: `HOOK_EVENT_TABLE.opencode`에서 `session.idle`을 빼고 `session.status`(idle)만 쓴다(작음). 실제 OpenCode에 맡겨 보지는 못했다. `.ts` plugin이 로드되는지와 plugin 실행기에서 `node:child_process`의 spawn이 되는지는 아직 모른다.
