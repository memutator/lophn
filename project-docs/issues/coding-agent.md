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
