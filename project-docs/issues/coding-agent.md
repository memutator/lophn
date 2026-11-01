# coding-agent

외부 coding agent 연결 장치(CLI, 제품 감지, hook 설치)다. `project-docs/architecture/coding-agent.md`.

## binary help에 사람 token으로는 거절되는 명령이 보인다

```yaml
kind: bug
modules: [packages/cli, packages/core]
```

- 지금: binary `lophn`(`packages/cli/main.ts`)은 명령 표 `COMMANDS` 전부를 help에 보이고 user token으로 부른다. 그런데 route가 actor `agent`만 받는 명령은 core가 `forbidden`으로 거절한다: `job.create`(`jobCreate`), `call.send`·`call.reply`·`session.list`(`calls.*`), `package.publish`. `app.tools`·`declaration.check`·`package.read`(built-in 길)는 route actor에 `user`를 더하기 전까지 같다.
- 영향: 사람 터미널의 coding agent가 help를 보고 이 명령을 부르면 이유 없이 `forbidden`을 받는다. 이 계획의 목적(coding agent가 같은 명령을 쓴다)이 이 명령들에서는 아직 안 된다.
- 고치려면: (가) 읽기 route는 actor에 `user`를 더한다(해가 없다). (나) 쓰기(`job.create`, `package.publish`)와 session 사이 메시지(`call.*`)는 coding agent의 신원이 정해질 때 연다(`project-docs/products/roadmap/command-surface.md` 15, `project-docs/products/roadmap/workflow.md`). 그때까지 binary help에서 binary가 부를 수 없는 명령을 빼거나 표시한다. 추천: 지금 (가), 나머지는 coding agent 신원과 같이.
