# workspace-session

session의 workspace와 열림·끝남·fork·rewind의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/workspace-session.md`.

## `shell.run`이 file 범위와 rewind를 거치지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-workspaces]
```

지금: project와 app workspace 종류의 tool 목록에 `shell.run`이 있다(`packages/protocol/lophn-agent/tool-lists.ts`의 `WORK_TOOLS`). home에는 없다. `packages/core/lophn-agent/tools/shell/run.ts`의 `runShell`은 범위의 base 폴더에서 `/bin/sh`를 띄운다. 자식 process에는 아무 권한 제한이 없다. OS sandbox는 없다. 판정은 shell 규칙(제품 floor·ask, Settings의 전역·project 층, `architecture/approval.md`)이 하고 effect는 `external`이다. 규칙에 걸리지 않는 명령은 묻지 않고 돈다. rewind 기록은 `file.write`·`file.edit`만 남긴다(`packages/core/agent-workspaces/hooks.ts`의 `FILE_HOOKS`).

영향: agent가 shell로 file 범위 밖 파일을 읽고 쓰거나 지워도 막는 것이 없다. 그렇게 바꾼 사람의 파일은 session rewind로 되돌아오지 않는다. AGENTS.md "속도"가 막으라는 agent 실수(데이터 잃기, 폴더 밖 쓰기)다. workspace 종류의 file 범위(project는 project 폴더, 받은 domain 폴더, `workflows/`, app은 앱 source와 받은 domain 폴더)도 shell로는 지켜지지 않는다.

고치려면:
- project workspace 종류의 목록에서 `shell.run`을 뺀다. 작음. 계산이나 변환이 필요한 일은 내장 tool과 앱 command로 한다. app workspace는 앱 test와 type 검사(A6)에 shell이 필요해 남는다.
- `shell.run`을 OS sandbox(bubblewrap 등)로 범위 폴더만 보이게 띄우고, 쓰기는 rewind 기록을 위해 막는다(읽기 전용). 중간~큼. 플랫폼마다 다르다.

추천: 첫째. project workspace에서 shell이 필요한 경우를 아직 보지 못했다.

정한 것(사람, 2026-10-19): 일단 그대로 둔다.

## 끝내는 기록이 실패한 turn이 running으로 남아 session이 막힌다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: loop는 끝낼 때 `ports.finish`(`FinishTurn`)가 실패하면 `finish_failed`를 돌려준다(`run-loop/turn.ts`). 사람이 먼저 멈춘 경우가 아니면 그대로 끝이다. driver(`packages/core/lophn-agent/run-loop/driver.ts`)는 loop가 던진 예외만 `.catch`에서 `turn.closeStarted("loop_threw")`로 닫고, `done`이 값으로 돌려준 `finish_failed`는 그냥 `finally`로 넘긴다. 그 뒤 `release`로 session을 풀지만 turns 행은 `running`이다. `finish_failed`를 처리하는 곳은 코드에 더 없다(`grep finish_failed`).
- 새 입력이 오면 `StartTurn`이 "the session already has a running turn"으로 `conflict`가 난다(`run-loop/commands.ts`).
- 메시지 접수는 `hasRunningTurn`(`session/message-commands.ts`)이 true라 도는 turn에 끼우는 것(steer)으로 보고 queue에만 넣는다. loop는 이미 없으므로 아무도 읽지 않는다.
- 이 상태는 core를 다시 켜서 `interrupted(restarted)`로 닫기 전까지 간다.

영향: `FinishTurn`이 거절되거나(예: 결과 blob이 core의 본문 한도를 넘음, ledger 오류) session 하나가 새 입력을 받아도 응답하지 않는다. 사람 눈에는 session이 멈춘 것으로 보이고 core를 재시작해야 풀린다. 이미 닫은 같은 종류의 문제(loop가 던진 경우)가 값으로 돌아오는 경우에 남은 것이다.

고치려면:
- driver가 `done`이 `finish_failed`를 돌려주면 `closeStarted`로 failed(`internal`)로 닫는다. 작음. 닫는 command도 실패하면 로그만 남고 같은 상태이므로 그 경우의 복구는 재시작에 맡긴다. 추천.
- `FinishTurn`이 실패해도 core가 turn을 닫는 길을 둔다(예: `StopTurn`을 스스로 부름). 중간.
