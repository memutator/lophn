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
