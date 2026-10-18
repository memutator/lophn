# ec-fix-source

lophn이 새로 만든 앱(source 폴더 없음)을 App Engineer가 coding agent에 맡기면 `no_source_folder`로 떨어지는 bug를 고친다. coding session을 열 때 source가 없으면 core가 template을 정해진 자리에 깔고 git으로 commit한 뒤 앱에 잇고, 그 폴더로 session을 연다.

- 단위: ec-fix-source (wave 5)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/tickets/coding/**`
  - `packages/core/main/daemon/wiring/coding-sessions.ts`
  - `packages/core/apps/registration/**`(source를 잇는 command를 core 안에서 부르는 데 필요한 만큼만)
- 읽을 것:
  - 이슈: `project-docs/issues/coding-agent.md`의 절 "lophn이 새로 만든 앱은 coding agent에 맡길 수 없다"(정한 것 포함). 이슈는 lead가 닫는다
  - architecture: `project-docs/architecture/coding-agent.md`, `project-docs/architecture/place-session.md`(51~56줄: 앱 source는 App Engineer의 place 폴더이고, 폴더 목록이 바뀌면 agent runtime process를 다시 띄워 돌던 turn이 끊긴다)
  - 지금 길: `packages/core/apps/tickets/coding/launch.ts`의 `resolveLaunch`(`no_source_folder`), `transport.ts`의 `start`, `packages/core/apps/agent-tools/app.ts`의 `app.link_source`, `packages/core/apps/registration/commands.ts`(source_path를 바꾸는 command)
  - template: `packages/core/apps/packages/template/`(`builtinTemplate`, `scaffoldApp`), `tests/support/app/source.ts`(test가 template을 깔고 git init·commit하는 순서. 사람 git 설정을 읽지 않는 `GIT_ENV`와 `-c user.name=... -c commit.gpgsign=false`)
  - git: `packages/core/apps/releases/prepare/git-extract.ts`의 `GitRunner`
- 계약:
  - 쓰는 것: route와 command는 이미 있는 것만. protocol은 바꾸지 않는다. 바꿔야 하면 보고에 요청으로 적는다.
  - 내놓는 것: source가 없는 앱에 coding session을 맡기면 `<data root>/apps/<app id>/source`에 template(slug는 앱 slug, title은 앱 이름)이 깔리고 commit 하나가 생기며 앱의 `source_path`가 그 폴더가 된다. 그 뒤는 지금 길 그대로다.

## 할 일

1. source가 없을 때 위 자리에 깔고 잇는 일을 core에 둔다. 때는 App Engineer의 coding `call`이 session을 열기 전이다. tx 안에서는 async I/O를 할 수 없으니 tx 밖(call을 받는 handler나 transport 바로 앞)에서 하고, 잇기는 이미 있는 source 연결 command로 한다.
   - 폴더가 이미 있으면 덮어쓰지 않는다(그 앱에 이미 깔았던 것이면 그대로 잇는다, 아니면 오류).
   - git은 사람의 설정을 읽지 않는다(`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, 이름·email·gpgsign을 `-c`로).
2. **돌던 turn이 끊기지 않아야 한다.** source를 이으면 agent runtime이 새 권한으로 다시 뜬다(`place-session.md`). 그 순간 App Engineer의 turn(지금 `call` tool을 부른 그 turn)이 끊기면 안 된다. 먼저 fake provider probe로 지금 동작을 확인한다. 끊기면 끊기지 않는 길을 고른다(예: 그 앱 폴더가 이미 runtime 권한 안이라 다시 뜰 필요가 없게, 또는 다시 뜨기를 turn 끝으로 미루기). 어느 길도 작게 안 되면 멈추고 보고한다.
3. App Engineer 지침과 tool 설명은 바꾸지 않는다.

## 끝남

- `deno task check:full`이 통과한다. core가 두 번 뜬다.
- 확인(commit하지 않는 probe, `.dev-data/ec-fix-source/`): fake provider로 source 없는 앱을 `apps/create`로 만들고, App Engineer가 `ticket.create` 뒤 coding agent에게 `call`하면 core가 `coding_terminal` `open` frame을 보낸다(`tests/support/gateway`로 받는다). 그 plan의 `cwd`가 `<home>/apps/<id>/source`이고 그 폴더에 commit이 있다. App Engineer의 그 turn이 `completed`로 끝난다. 진짜 provider와 진짜 claude는 쓰지 않는다.
- 위험 test: 없음(git subprocess가 든다. 사람 확인 없이 만들지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것: 문서에 답이 없어 worker가 정한 것(특히 2의 길)
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
