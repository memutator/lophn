# harness-gui

lophn 터미널 탭 안 harness GUI(`claude gui` 등)와 harness adapter. `project-docs/architecture/harness-gui.md`.

## adapter 넷이 줄 세우기 code를 따로 가진다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: 도는 중에 보낸 메시지를 줄에 세우고 고치고 옮기고 turn 뒤에 보내는 code(`resendQueue`와 `edit_queued`·`move_queued` 처리)가 `claude.ts`, `codex.ts`, `opencode.ts`, `omp.ts`에 각자 복사돼 있다. 뒤의 셋이 `claude.ts`를 본떠 썼다.

영향: 줄 세우기 bug를 고치면 네 곳을 같이 고쳐야 하고, 하나만 고치면 harness마다 동작이 갈린다.

고치려면:
- 같은 폴더에 줄 file 하나(queue와 그 입력 처리, 다음 turn에 넣을 callback을 받는다)를 두고 넷이 쓴다. 작음. 추천.

## Claude GUI의 `!` 출력이 끝나야 보인다

```yaml
kind: defect
modules: [packages/shell/main]
```

지금: `claude.ts`는 `!` 출력을 process가 끝날 때 tool item `body`에 한 번에 싣는다(ACP에 도는 tool의 본문 갱신이 없다). shell은 `/bin/sh`로 박혀 있다. cwd는 앞 `!`가 끝난 곳에서 이어진다.

영향: 오래 도는 `!` 명령은 끝날 때까지 출력이 비어 보인다. Windows에서는 `!`가 돌지 않는다.

고치려면: 출력 흐름은 tool body를 덧붙이는 갱신이 ACP에 생길 때 같이 한다. 작음.
