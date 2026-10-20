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

## example을 고친 reported ticket을 다시 넘기면 거절되고 model은 이유를 모른다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/agent-roles, packages/core/lophn-agent]
```

지금: coding agent가 보고하면 program이 ticket의 examples를 돌린다. 떨어지면 `ticket_check_results`에 fail만 남고 ticket은 `reported` 그대로다(`apps/tickets/checks.ts`). App Engineer 지침(`agent-roles/roles/app-engineer/prompt.md`)은 "example 자체가 틀렸으면 `ticket.update`로 고치고 coding agent에게 다시 넘긴다"고 한다. `ticket.update`(`apps/tickets/commands.ts`)는 goal과 check만 바꾸고 state는 두며, 맡기기 시작(`apps/tickets/coding/transport.ts`의 `start`)은 `open`이나 `failed` ticket만 받아 `ticket_unavailable`(code `unavailable`)로 거절한다. `ticket.verify`에 `failed`를 먼저 넣어야 다시 넘길 수 있는데 지침에 그 순서가 없다. model이 받는 글은 `lophn-agent/tools/work.ts`의 `FAILURE_SUMMARIES`가 code마다 고정한 "tool is unavailable"뿐이라 `details.reason`이 닿지 않는다. 재현: eval `calendar-user` 첫 run. examples step 3이 떨어졌고, App Engineer는 지침대로 `ticket.update` 뒤 `call to:{role:"coding_agent", place}`을 했다가 `unavailable`을 두 번 받고 turn을 끝냈다. 앱은 켜지지 않았다. 앞서 `calendar-mvp` run 하나도 다시 넘기기에서 같은 글로 멈췄다(detail은 확인 못 함).

영향: 첫 보고의 examples가 떨어진 앱 만들기가 그 자리에서 멈춘다. 사람은 만들다 만 앱을 받고, App Engineer는 무엇을 해야 풀리는지 알 길이 없다.

고치려면:
- examples가 떨어지면 program이 ticket을 `failed`로 둔다. examples를 못 넘긴 ticket은 어차피 verified가 될 수 없다(작음. `checks.ts`에서 verdict를 같이 쓴다. App Engineer의 `ticket.verify` 실패 기록 단계가 빠진다). **추천.**
- 지침에 "`ticket.verify` `failed` → `ticket.update` → 다시 넘기기" 순서를 쓴다(작음. model이 빼먹으면 그대로 막힌다).
- coding 시작 실패의 `details.reason`(`not_connected`, `cannot_launch`, `no_source_folder`, `ticket_unavailable`)을 model 글에 붙인다(작음. 넷 다 범위 밖 대상의 이름이나 존재를 드러내지 않는다). 추천안과 같이 한다.
