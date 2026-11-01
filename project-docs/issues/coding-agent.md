# coding-agent

외부 coding agent 연결 장치(CLI, 제품 감지, hook 설치)다. `project-docs/architecture/coding-agent.md`.

## binary help에 사람 token으로는 거절되는 명령이 보인다

```yaml
kind: bug
modules: [packages/cli, packages/core]
```

- 지금: binary `lophn`(`packages/cli/main.ts`)은 명령 표 `COMMANDS` 전부를 help에 보이고 user token으로 부른다. 그런데 route가 actor `agent`만 받는 명령은 core가 `forbidden`으로 거절한다: `job.create`(`jobCreate`), `call.send`·`call.reply`·`session.list`(`calls.*`), `package.publish`. 읽기 route(`app.tool_index`, `declaration.check`, `packages.builtin`)는 actor에 `user`를 더해 binary에서도 된다.
- 영향: 사람 터미널의 coding agent가 help를 보고 이 명령을 부르면 이유 없이 `forbidden`을 받는다. 이 계획의 목적(coding agent가 같은 명령을 쓴다)이 이 명령들에서는 아직 안 된다.
- 고치려면: 쓰기(`job.create`, `package.publish`)와 session 사이 메시지(`call.*`)는 coding agent의 신원이 정해질 때 연다(`project-docs/products/roadmap/command-surface.md` 15, `project-docs/products/roadmap/workflow.md`). 그때까지 binary help에서 binary가 부를 수 없는 명령을 빼거나 표시한다. 추천: coding agent 신원과 같이 연다.

## coding agent에게 준 공유 skill을 끄는 화면이 없다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/approvals]
```

지금: `lophn app share --coding-agents`를 승인하면 앱 slug가 설정 `coding-agent.shared_apps`에 들어가고, `lophn harness sync-skills`가 그 앱의 public skill을 harness skill 폴더에 깐다. 그 목록에서 앱을 빼는 화면은 없다. 사람은 `~/.lophn/settings.json`을 직접 고쳐야 하고, 고치면 다음 sync가 사본을 지운다.

영향: coding agent가 더 이상 그 앱의 skill을 보지 않게 하려는 사람이 설정 파일 key 이름을 알아야 한다.

고치려면: Settings의 coding agent 쪽에 공유 앱 목록과 빼기를 둔다(작음). 추천.
