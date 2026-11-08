# coding-agent

외부 coding agent 연결 장치(CLI, 제품 감지, hook 설치)다. `project-docs/architecture/coding-agent.md`.

## binary help에 사람 token으로는 거절되는 명령이 보인다

```yaml
kind: bug
modules: [packages/cli, packages/core]
```

- 지금: binary `lophn`(`packages/cli/main.ts`)은 명령 표 `COMMANDS` 전부를 help에 보이고 user token으로 부른다. 그런데 route가 actor `agent`만 받는 명령은 core가 `forbidden`으로 거절한다: `job.create`(`jobCreate`), `call.send`·`call.reply`·`session.list`(`calls.*`), `package.publish`. 읽기 route(`app.tool_index`, `declaration.check`, `packages.builtin`)는 actor에 `user`를 더해 binary에서도 된다.
- 영향: 사람 터미널의 coding agent가 help를 보고 이 명령을 부르면 이유 없이 `forbidden`을 받는다. lophn이 띄운 harness agent turn은 env의 turn 자격(`LOPHN_AGENT_CREDENTIAL`)으로 `call.*`·`session.list`를 부른다(`architecture/coding-agent.md`의 "harness agent"). 사람 터미널의 coding agent에는 아직 신원이 없다.
- 고치려면: 쓰기(`job.create`, `package.publish`)와 session 사이 메시지(`call.*`)는 coding agent의 신원이 정해질 때 연다(`project-docs/products/roadmap/command-surface.md` 15, `project-docs/products/roadmap/workflow.md`). 그때까지 binary help에서 binary가 부를 수 없는 명령을 빼거나 표시한다. 추천: coding agent 신원과 같이 연다.

## fork한 harness session이 harness 쪽 앞 대화를 물려받지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

- 지금: fork한 harness session(`packages/core/lophn-agent/workspaces/lifecycle.ts` `startSession`)은 외부 session id(`sessions.harness_session`)를 물려받지 않아 harness 쪽 대화가 새로 시작한다. (같이 적었던 steer는 고쳤다: harness session은 ACP `steer` capability가 꺼져 있고 send-now가 `unavailable`이다.)
- 영향: 사람이 harness session을 fork하면 harness가 앞 대화를 모른다.
- 고치려면: headless resume이 fork를 지원하는 harness(`claude --resume --fork-session` 등)만 id를 물려주고 나머지는 지금처럼 새로 시작한다(중간).

## opencode harness agent는 사람의 opencode 권한 설정대로 돈다

```yaml
kind: bug
modules: [packages/protocol/coding-agent]
```

- 지금: Claude Code는 `--permission-mode acceptEdits`(Bash 거절), Codex는 `-s workspace-write`로 띄운다(`packages/protocol/coding-agent/headless/`). opencode `run`에는 권한 flag가 없어 아무것도 넘기지 않고, 정의의 `permissions.deny`가 있으면 Codex·opencode는 띄우지 않는다.
- 영향: opencode agent는 사람의 opencode 설정(기본은 대부분 허락)으로 shell과 폴더 밖 쓰기를 한다. 사람이 자기 터미널에서 opencode를 쓸 때와 같다(사람, 2026-11-04: 이대로 둔다).
- 고치려면: opencode의 config env(inline config의 `permission`)로 bash deny, 바깥 폴더 deny를 넘기고 실제 실행으로 확인한다(작음).

## TUI 탭 hold가 끊기는 두 틈

```yaml
kind: bug
modules:
  - packages/core/host-queue
  - packages/shell/main
  - packages/shell/renderer
```

- 지금: core는 `tabs/open --tui` 때 30초 예약 hold를 걸고 shell main의 heartbeat(`host/take {tui}`)로 잇는다(`packages/core/host-queue/hold.ts`). heartbeat 목록은 renderer가 탭을 만든 순간 `shell:surface-report {tui}`로 알린 것이다(`packages/shell/main/terminal/harness-tui.ts`). 두 경우에 그 사이가 빈다. (1) 그 workspace를 보이는 창이 없어 요청이 host queue에서 30초 넘게 기다리면 예약이 끝나 headless turn이 시작할 수 있고, 뒤에 탭이 생기면 TUI가 그 turn과 겹친다(`tabs/open`은 연 때만 도는 turn을 거절한다). (2) 창 reload나 앱 재시작으로 layout에서 되살아난 TUI 탭은 생성 보고가 없어 hold되지 않는다.
- 영향: 한 CLI session에 headless process와 TUI process가 같이 써 그 CLI의 대화 기록이 섞이거나 깨질 수 있다. 사람이 TUI에서 한 일이 headless turn과 엉킨다.
- 고치려면: (작음) shell main이 탭을 만들 때 harness session이 돌고 있으면 탭을 열지 않고 retry로 둔다. (작음) renderer가 layout을 다 읽은 뒤 남아 있는 `host:` 터미널 탭 가운데 TUI 탭을 다시 알린다. 추천은 둘 다다.
