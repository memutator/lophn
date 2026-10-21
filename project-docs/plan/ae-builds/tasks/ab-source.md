# ab-source

앱의 source 폴더를 `app.create`이 만든다. 지금은 coding agent에게 처음 넘길 때 core가 template을 깔고 commit해 잇는다(`scaffold-source.ts`의 `withScaffoldedSource`, `call` 앞 처리). App Engineer가 직접 지으면 그 넘기기가 없어 폴더가 없다(README "source 폴더 만들기를 `app.create`로 옮긴다", roadmap "정한 것(agent)"). 또 `app.connect_source`가 연결 전에 폴더가 있고 commit 있는 git 저장소인지 본다(이슈 `project-docs/issues/coding-agent.md` "`app.link_source`가 없는 폴더를 받아…"의 추천).

- 단위: source (wave 1)
- 선행: ab-coding-move. 옮긴 `packages/core/apps/coding/`의 `scaffold-source.ts`와 `coding-sessions.ts`를 고친다.
- 소유(이 task만 고친다):
  - `packages/core/apps/coding/{scaffold-source.ts,mod.ts}`(`scaffold-source.ts`는 지운다)
  - `packages/core/apps/registration/source-folder.ts`(새 file)
  - `packages/core/apps/registration/mod.ts`
  - `packages/core/apps/registration/commands.ts`(`requireWriter`와 `connectSource`의 폴더 주석만. 뼈대에 없던 줄이다. 아래 "정한 것" 1이 machine 자격을 받게 한다)
  - `packages/protocol/apps/apps.ts`(`appConnectSource`의 `actors`와 그 위 주석만. 뼈대에 없던 줄이다)
  - `packages/core/main/daemon/wiring/{coding-sessions.ts,apps.ts}`
  - `packages/core/apps/agent-tools/app.ts`(`app.create`, `app.link_source` 설명만)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "source 폴더 만들기를 `app.create`로 옮긴다"
  - 이슈: `project-docs/issues/coding-agent.md`의 "`app.link_source`가 없는 폴더를 받아 그 앱의 coding agent가 뜨지 못한다"(닫는 것은 lead다)
  - architecture: `project-docs/architecture/coding-agent.md` 58줄("source 폴더가 없는 앱은 맡길 때 core가 만든다")
  - 코드(줄은 main `dd956b49f`. coding 폴더는 ab-coding-move 뒤 `packages/core/apps/coding/`)
    - `scaffold-source.ts` 전체: `git`(39~61. 사람의 git 설정을 읽지 않는 env), `exists`, `scaffold`(75~129. 임시 폴더 `<dir>.new`에서 commit까지 만들고 옮긴다, 이미 있는 폴더는 commit이 있을 때만 쓴다, 뒤에 import map을 쓴다), `withScaffoldedSource`(133~174)
    - 본보기: `packages/core/agent-roles/agents/app-engineer.ts`의 `withAppEngineer`(앱 등록 command가 commit된 뒤 writer 밖에서 file을 만든다. `appCreate.name`으로 고른다)
    - `packages/core/apps/registration/commands.ts`: `create`(98~161. id는 tx 안에서 `tx.newId("app")`로 정해지고 agent는 id를 미리 정하지 못한다), `requireWriter`(51~62), `connectSource`(162~197. 170~172줄 주석이 "폴더 확인은 core에 두지 않는다"라고 한다)
    - `packages/protocol/apps/apps.ts`: `appConnectSource`(94~104. actors `user`, `coding_agent`, `agent`)
    - machine 자격의 본보기: `packages/core/apps/control.ts`의 `PACKAGE_PUBLISH_CONTEXT`(141~148), `appsOperationPolicies`(machine operation 상한), `packages/core/main/daemon/wiring/apps.ts` 119~121줄(`operations`, `records`)
    - release 준비가 source를 읽는 경계: `packages/core/apps/releases/prepare/git-extract.ts`의 `requireRepository`(75~112. 폴더가 git 저장소의 맨 위여야 한다)
    - writer 결과: `packages/core/storage/ledger/writer-message.ts`의 `CommandSuccess`(`result`, `replayed`)
    - 지울 쪽: `packages/core/main/daemon/wiring/coding-sessions.ts`의 `withScaffoldedSource` 조립(196~213)과 import(29~32, `ledgerSnapshot`)
- 계약:
  - 쓰는 것: `appCreate`, `appConnectSource`(`packages/protocol/apps/apps.ts`), `appDefaultSource`(`packages/protocol/apps/app-storage.ts`), template(`packages/core/apps/packages/template/`)
  - 내놓는 것:
    - `app.create`이 성공하면 누가 만들었든(사람, lophn) 그 앱의 `source_path`는 template을 깔고 첫 commit을 만든 `appDefaultSource(dataRoot, app)` 폴더다. writer 앞 처리(`source-folder.ts`, 본보기는 `withAppEngineer`)가 create 뒤에 깔고 잇는다. 이미 있는 폴더는 commit이 있을 때만 그대로 쓴다(지금 `scaffold` 규칙).
    - `app.connect_source`는 폴더가 없거나 commit 있는 git 저장소가 아니면 `invalid_input`이다. tx 안에서는 파일을 못 보므로 writer 앞에서 본다.
    - `call` 앞의 template 깔기(`withScaffoldedSource`, `sourcelessAppNamed`)가 없다.
  - 정할 것(flesh): 아래 "정한 것" 1, 2가 정했다.

## 정한 것

1. **잇기는 create가 commit된 뒤 core 안 machine 자격으로 한다(뼈대의 (b)).** 이유
   - 같은 create tx에서 `source_path`를 쓰는 길((a))은 command 전에 폴더를 깔 수 없다. 폴더 자리 `appDefaultSource(dataRoot, app)`가 앱 id에 달렸는데 id는 create tx 안에서 정해지고, agent는 id를 미리 정할 수 없다(`create`의 "only a person assigns an app id"). 그래서 (a)도 폴더는 commit 뒤에 깔아야 하고, tx 안에서 data root를 알게 할 port가 더 든다. 깔기가 실패하면 없는 폴더를 가리키는 `source_path`가 남는다.
   - (b)는 route `actors`에 `machine` 하나, `requireWriter`에 machine 한 갈래, machine 자격 하나(operation `app.connect_source` 하나만)를 더한다. 깔기나 잇기가 실패하면 앱은 `source_path: null`로 남아 상태가 거짓말을 하지 않는다.
   - lophn의 자격에는 `app.connect_source`가 없고, App Engineer 자격으로 잇는 길(지금 `withScaffoldedSource`)은 App Engineer가 create를 부르지 않아 쓸 수 없다.
2. **깔기나 잇기가 실패한 앱은 알리기만 한다.** create는 이미 commit됐으므로 결과를 오류로 바꾸지 않는다. 결과의 앱은 `source_path: null`이고, `console.error`로 이유를 남긴다. `app.create` tool 설명이 "`source_path`가 null이면 폴더를 만들지 못했다. commit 있는 git 폴더를 `app.link_source`로 잇는다"를 말한다. 다시 시도하는 장치는 두지 않는다.
3. **`app.connect_source`가 받는 폴더는 git 저장소의 맨 위이고 commit이 있어야 한다.** 이유: release 준비(`git-extract.ts`의 `requireRepository`)가 맨 위가 아닌 폴더를 `source_outside_boundary`로 거절한다. 연결 때 같은 경계로 막아야 준비에서 처음 알게 되지 않는다.
4. **새로 까는 저장소에는 저장소 안 git 설정(`user.name lophn`, `user.email lophn@localhost`, `commit.gpgsign false`)을 남긴다(planner).** 이유: 이제 App Engineer가 `shell.run`으로 commit한 뒤 `release.prepare`가 HEAD로 bundle을 만든다. 사람에게 전역 git 이름이 없으면 그 commit이 실패한다. 지금 `scaffold`는 명령마다 `-c user.name=lophn`을 넘길 뿐 저장소에 남기지 않는다. 잃는 것: 사람이 그 폴더에서 자기 터미널로 commit해도 이름이 lophn으로 남는다(저장소 설정이 전역보다 앞선다). 사람이 연결한 폴더(`app.connect_source`)의 설정은 건드리지 않는다.

## 할 일

1. `packages/core/apps/registration/source-folder.ts`를 만든다(근거: README, "정한 것" 1~4).
   - `scaffold-source.ts`에서 `git`, `exists`, `scaffold`를 옮긴다. `ScaffoldTarget`은 create 결과의 앱(`id`, `slug`, `name`)에서 채운다.
   - `scaffold`의 새 저장소 만들기: `init -q` 뒤 `config user.name lophn`, `config user.email lophn@localhost`, `config commit.gpgsign false`를 저장소 안 설정으로 쓰고, 그다음 `add -A`, `commit`. 명령마다 넘기던 `-c user.name=…`, `-c user.email=…`, `-c commit.gpgsign=false`는 지운다. 사람의 전역·system git 설정을 읽지 않는 env(`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`)는 둔다(사람의 hook과 서명 설정이 깔기에 끼지 않게).
   - 이미 있는 폴더를 다시 쓸 때(commit이 있음)는 설정을 쓰지 않는다. 앞서 lophn이 깔다 끊긴 폴더면 이미 설정이 있다.
   - 연결 전 확인 함수: 폴더의 realpath가 있고, `git -C <폴더> rev-parse --show-toplevel`의 realpath가 폴더의 realpath와 같고, `git -C <폴더> rev-parse --verify HEAD`가 성공해야 통과다. 아니면 `err({ code: "invalid_input", message })`(없음, 저장소의 맨 위가 아님, commit이 없음을 message로 가른다). git을 띄우지 못하면(throw) `unavailable`이다.
   - machine 자격: `SOURCE_FOLDER_PRINCIPAL = "machine:apps-source"`와 `SOURCE_FOLDER_CONTEXT`(actor `machine`, scope operations `[appConnectSource.name]`, targets `{}`, conditions `{}`, credential_ref는 principal). 본보기는 `PACKAGE_PUBLISH_CONTEXT`.
   - writer 앞 처리 `withSourceFolder(inner, { dataRoot, writer: () => Writer })`
     - `envelope.command === appConnectSource.name`: 위 확인을 먼저 돌리고, 떨어지면 그 오류를 돌려준다. 통과하면 `inner.command`.
     - 그 밖: `inner.command`를 먼저 부른다. 결과가 실패이거나 `replayed`이거나 command가 `appCreate.name`이 아니면 그대로 돌려준다.
     - create가 처음 성공했으면 `scaffold` 뒤 `deps.writer().command(SOURCE_FOLDER_CONTEXT, { command: appConnectSource.name, input: { app, source_path }, compare: { base_revision: <create 결과의 revision> }, idempotency_key: crypto.randomUUID(), prepared: [] })`. 전체 writer를 지나므로 위 확인도 한 번 더 돈다.
     - 성공하면 create 결과의 `result`를 잇기 결과의 앱(`source_path`와 revision이 채워짐)으로 바꿔 돌려준다. 깔기나 잇기가 실패하면 "정한 것" 2대로 create 결과 그대로 돌려주고 `console.error`에 앱 id와 이유를 남긴다.
   - `registration/mod.ts`에서 `withSourceFolder`, `SOURCE_FOLDER_CONTEXT`를 내보낸다.
2. machine 자격이 `app.connect_source`를 부를 수 있게 한다.
   - `packages/protocol/apps/apps.ts`: `appConnectSource.actors`에 `"machine"`을 더하고 위 주석("source 연결은 user, 그 앱 범위 connection, 그 앱의 App Engineer만 받는다")에 "core가 새 앱의 source를 이을 때 machine"을 더한다.
   - `registration/commands.ts`의 `requireWriter`: `kind === "machine"`이면 통과한다. machine 자격은 core 안에서만 만들고 operation 상한이 그 하나다. 주석을 맞춘다. `connectSource`의 170~172줄 주석을 "폴더 확인(있고, git 저장소의 맨 위이고, commit이 있음)은 tx 밖 writer 앞(`source-folder.ts`)이 한다"로 고친다.
   - `wiring/apps.ts`: `operations`에 `{ name: appConnectSource.name, actors: ["machine"], kind: "command" }`를 더하고(`appsOperationPolicies()` 뒤에 펼쳐 붙인다), `records`에 `SOURCE_FOLDER_CONTEXT`를 더한다.
3. `wiring/apps.ts`의 `writer`를 `withSourceFolder(<지금의 조립>, { dataRoot: ctx.root.path, writer: () => ctx.writer })`로 감싼다. 잇기 command는 `ctx.writer`(모든 wiring의 writer를 지난 것)로 낸다.
4. `scaffold-source.ts`를 지우고 `packages/core/apps/coding/mod.ts`의 그 export 줄을 지운다. `wiring/coding-sessions.ts`에서 `withScaffoldedSource` 조립과 import(`sourcelessAppNamed`, `withScaffoldedSource`, `ledgerSnapshot`)를 지운다. `writer`는 `withCodingBody(withAfterCommit(inner, relay.apply), …)`가 된다. coding 쪽 `launch.ts`의 `no_source_folder`는 그대로다(연결 장치).
5. `agent-tools/app.ts`의 설명
   - `app.create`: 만들면 앱 template에서 시작한 git 저장소가 그 앱의 source 폴더로 생긴다. 결과의 `source_path`가 null이면 폴더를 만들지 못한 것이고 `app.link_source`로 잇는다.
   - `app.link_source`: 이을 폴더는 git 저장소의 맨 위이고 commit이 하나 이상 있어야 한다. 상대 경로는 지금처럼 place의 첫 폴더에서 시작한다.
6. (worker는 고치지 않는다. lead가 이 task branch에서 merge 전에 고친다. 안 고치면 docs check가 떨어진다) `project-docs/architecture/coding-agent.md` 58줄 항목을 새 동작으로 고친다: 앱의 source 폴더는 `app.create`가 commit된 뒤 core가 만든다(`<data root>/apps/<app>/source`, `appDefaultSource`, 저장소 안 git 설정, core 안 machine 자격으로 `app.connect_source`, `packages/core/apps/registration/source-folder.ts`). 이미 있는 폴더는 commit이 있을 때만 쓴다. `app.connect_source`는 git 저장소의 맨 위이고 commit이 있는 폴더만 받는다. 그 문서의 다른 줄은 계획 끝에 lead가 고친다.
7. 바꾼 곳의 test: `deno test --no-check packages/core/apps/registration`. 그리고 `deno task dev`(개발 data `.dev-data/`)로 앱 하나를 만들어 `<.dev-data의 data root>/apps/<app>/source`에 commit 하나와 `.git/config`의 `user.name = lophn`이 있는지, `app.get`의 `source_path`가 그 폴더인지 손으로 본다. 사람의 `~/.lophn`은 쓰지 않는다.

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(새 operation과 자격 기록).
- 손 확인(할 일 7): 새 앱의 source 폴더에 첫 commit이 있고, 저장소 안 설정에 `user.name`, `user.email`, `commit.gpgsign=false`가 있고, `source_path`가 이어져 있다. 그 폴더에서 `GIT_CONFIG_GLOBAL=/dev/null git commit --allow-empty -m x`가 이름 오류 없이 된다.
- 위험 test: 없음. 확인과 깔기는 git subprocess를 띄워야 볼 수 있다(AGENTS.md: subprocess를 띄우는 test는 사람에게 먼저 묻는다). 경계도 data 손실이 아니다. 필요하다고 보면 만들지 말고 보고에 적는다.
- 남지 않음: `git grep -n "withScaffoldedSource\|sourcelessAppNamed\|scaffold-source" -- packages tools project-docs/architecture`가 0줄이다. `git grep -n "user.name=lophn" -- packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check와 손 확인 결과
- 등록할 것: 없을 것이다(`operations`, `records`는 소유한 `wiring/apps.ts` 안이다). 있으면 적는다.
- 안 쓰게 된 export: coding 쪽 `startFailure`의 `no_source_folder`를 부르던 곳이 줄었는지
- 정한 것: 위 "정한 것" 1~4를 그대로 했는지, 문서에 답이 없어 더 정한 것
- 넘길 줄: `project-docs/architecture/coding-agent.md` 58줄. `packages/core/agent-roles/roles/app-engineer/prompt.md` 86~88줄("A new app has none … Link a source with `app.link_source` only when …")이 틀리게 된다. ab-prompt가 다시 쓴다. 고치지 않고 적는다.
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 깔기나 잇기가 실패한 앱은 `source_path: null`로 남고 저절로 다시 시도하지 않는다. 고치려면 `app.link_source`로 commit 있는 git 폴더를 잇는다. 그 밖에 있으면 적는다.
