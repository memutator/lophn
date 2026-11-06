# harness-gui

lophn 터미널 탭 안 harness GUI(`claude gui` 등)와 harness adapter. `project-docs/architecture/harness-gui.md`.

## `claude`가 끝나면 그 GUI에서 더 이어 갈 수 없다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: `claude.ts`는 SDK의 `for await`가 끝나거나 throw하면 `dead`를 두고 실패한 turn을 하나 낸다(`failure`). 그 뒤의 `send`는 사람 메시지를 보이고 곧바로 같은 오류로 실패한 turn이 된다(`sendText`). `dead`를 되돌리는 곳이 없고, session menu에서 같은 session을 고르면 `openSession`이 아무것도 하지 않는다.

영향: CLI가 죽거나 끝난 뒤에는 사람이 TUI로 넘겼다가 GUI로 다시 와야(새 adapter가 같은 session id로 resume한다) 이어 간다.

고치려면:
- 다음 `send`에서 같은 session id로 `reopen`해 query를 다시 열고 `dead`를 비운 뒤 그 메시지를 넣는다. 작음. 추천.
- GUI에 "CLI가 끝났다"를 보이고 입력창을 막는다. 작음. 이어 가기는 여전히 toggle로만 된다.

## adapter 넷이 줄 세우기 code를 따로 가진다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: 도는 중에 보낸 메시지를 줄에 세우고 고치고 옮기고 turn 뒤에 보내는 code(`resendQueue`와 `edit_queued`·`move_queued` 처리)가 `claude.ts`, `codex.ts`, `opencode.ts`, `omp.ts`에 각자 복사돼 있다. 뒤의 셋이 `claude.ts`를 본떠 썼다.

영향: 줄 세우기 bug를 고치면 네 곳을 같이 고쳐야 하고, 하나만 고치면 harness마다 동작이 갈린다.

고치려면:
- 같은 폴더에 줄 file 하나(queue와 그 입력 처리, 다음 turn에 넣을 callback을 받는다)를 두고 넷이 쓴다. 작음. 추천.

## Codex subagent 이벤트가 lane이 열리기 전이나 다시 연 뒤에 빠진다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: `codex.ts`는 `spawnAgent` item이 끝나 자식 thread id를 본 뒤에 자식 lane을 연다. 그 전에 온 자식 thread 이벤트는 모르는 thread라 버린다. 다시 열면(resume) 자식 대화를 `thread/turns/list`로 다시 그리지만 자식 thread를 구독하지 않는다.

영향: 녹화에서는 순서가 맞았지만 보장되지 않는다. 자식의 첫 메시지·tool 줄이 subagent 보기에서 빠질 수 있다. GUI를 다시 연 뒤 아직 도는 subagent는 흘러나오지 않고 끝날 때까지 멈춘 것처럼 보인다.

고치려면: 모르는 thread의 이벤트를 짧게 쌓아 두고 spawn item이 그 thread id를 알리면 lane에 붓는다. resume 때 도는 자식(`agentsStates`)마다 `thread/resume`으로 구독한다. 작음.

## Claude GUI의 `!`는 한 번마다 새 shell이고 출력이 끝나야 보인다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: `claude.ts`는 `!`마다 `/bin/sh -c`를 새로 띄우고 출력을 process가 끝날 때 tool item `body`에 한 번에 싣는다(ACP에 도는 tool의 본문 갱신이 없다).

영향: `!cd sub` 뒤의 `!ls`는 원래 폴더에서 돈다(Claude Code TUI는 bash mode의 `cd`가 이어진다). 오래 도는 `!` 명령은 끝날 때까지 출력이 비어 보인다.

고치려면: cwd만 이어 가려면 adapter가 `cd`로 시작하는 명령의 결과 cwd를 기억한다. 출력 흐름은 tool body를 덧붙이는 갱신이 ACP에 생길 때 같이 한다. 작음.
