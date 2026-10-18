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
## `package.publish`가 늘 "the app source has no commit"으로 떨어진다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/lophn-agent]
```

지금:
- agent tool `package.publish`(`packages/core/apps/agent-tools/package.ts`)는 앱 source의 HEAD를 `headOf`가 `new Deno.Command("git", ...)`로 읽는다.
- 이 handler는 agent runtime child 안에서 돈다. 그 process의 `allow_run`은 MCP server와 `/bin/sh`뿐이다(`packages/core/lophn-agent/tools/runtime-permissions.ts`). `git`을 띄우면 `NotCapable`이 나고 `headOf`는 `catch`에서 `null`을 돌려준다.
- 그래서 tool은 늘 `unavailable`("the app source has no commit")로 답한다. commit이 있어도 같다.

영향: App Engineer가 package를 낼 수 없다. 앱 사이 재사용 길이 처음부터 막혀 있다. eval의 `date-range@1` 재료(되살리기가 fake App Engineer의 `package.publish`를 쓴다)와 calendar-mvp의 재사용 확인이 되살리기에서 떨어진다.

고치려면:
- core 쪽 memory route `package.publish`(`packagePublish`)가 앱의 `source_path`에서 HEAD를 읽고, tool은 commit을 넘기지 않는다(작음). core process는 git을 이미 띄운다. tool 입력 schema에서 `commit`을 빼는 protocol 변경이 같이 간다. 추천.
- agent runtime의 `allow_run`에 git 절대 경로를 더한다(작음). 잃는 것: agent runtime 안의 모든 tool이 git을 띄울 수 있게 된다. 평범한 `"git"`은 runtime이 다시 뜨지 못했다(절대 경로가 필요하다).
