# multi-device-fixes

- 목표: 올라간 네 일("가리키는 법", `device-roster`, `core-terminals`, `core-setup`)의 review에서 확인한 구멍을 고친다. 권한 경계가 뚫린 곳, 명단의 서명 규칙, 사용자 data를 옮기는 길, 설치본에서 안 될 곳이다. 다음 계획(`one-screen`, `carry-paths`, `remote-use`)이 이 위에 선다.
- 재료: review `reports/multi-device/review-project-address.md`, `review-device-roster.md`, `review-core-terminals.md`, `review-core-setup.md`(finding마다 file과 줄, 가장 작은 고침이 있다), change-log `project-docs/products/change-log/0.23/{project-address,device-roster,core-terminals,core-setup}.yaml`, `project-docs/architecture/remote.md`, `terminal-agent.md`, `approval.md`, `agent-definition.md`, `project-identity.md`
- 범위 밖: review가 "돌려 보지 못했다"로 적은 것을 실제 기기로 확인하기(사람에게 부탁한다), 새 기능, 다음 계획의 일(다른 기계의 터미널을 보는 route 열기, agent와 앱이 다른 기계를 부르기)

## 정한 것

review의 finding을 그대로 고친다. finding에 없는 것을 넓혀 고치지 않는다. 아래는 고치는 방향을 정해야 했던 것이다.

경계:
- **터미널을 열면서 치는 것도 입력이다.** `terminals/open`의 `command`와 `resume`은 `terminals/input`과 같은 자격을 본다. 허락이 없는 기기는 빈 터미널만 연다. (agent: 계획이 정한 "입력 자격"의 빠진 입구다)
- **터미널 입력을 허락받은 기기는 그 기계의 어느 터미널에나 친다.** 보이는 터미널로 좁히지 않는다. 그 허락이 그 기계를 온전히 다루는 권한이다(`core-setup`이 같은 선으로 사람의 route를 열었다). 문서에 적는다. (agent)
- **다른 기계를 부르는 route는 그 기계의 화면만 부른다.** `machines/call`·`machines/watch`는 shell main이 받은 capability가 있어야 한다. 사람의 CLI token으로는 못 부른다(지금은 CLI가 허락받은 컴퓨터를 거쳐 다른 기계의 사람 route와 자동 확인에 닿는다). CLI에서 다른 기계를 부르는 것은 `remote-use`가 요청한 쪽을 실어서 연다. (agent: "agent와 CLI에는 열지 않는다")
- **허락이 있어도 열지 않는 것에 저장소의 이름도 든다.** 기기 자격은 `secrets/*`로 site login vault(`login.`)와 구독 token(`provider-oauth.`) 이름을 쓰거나 지우지 못한다. `remote.*` 설정도 기기 자격으로는 바꾸지 못한다(기기·명단 관리와 같은 종류다). (agent)
- **명단을 바꾸는 CLI 명령은 lophn의 터미널 탭 안에서 거절한다**(`lophn remote invite|join|remove`). 그 안에서는 사람과 거기서 도는 coding agent를 가릴 수 없다. 읽는 명령(`devices`)은 된다. 화면 없는 기계는 SSH의 터미널에서 한다. 먼저 터미널 탭의 `lophn`이 어떤 자격을 받는지 code로 확인하고, 사람 자격이 아니면 이 항목은 하지 않고 보고한다. (agent: review가 확인하지 못한 것)

명단:
- **쓰인 초대장은 그것으로 든 기기를 빼도 쓰인 것이다.** (agent: 계획의 "한 번 쓰인 것을 다시 받지 않는다")
- **빼기는 key로만 센다.** 빼기 항목의 id는 그 key의 항목에서 얻고, 남의 id를 실은 빼기로 다른 기기를 지우지 못한다. (agent)
- **모르는 서명자의 항목은 따로 센다.** 상한을 따로 두고, 믿는 항목과 빼기를 밀어내지 못한다. 상한에 닿아도 빼기는 저장된다. (agent)
- **엇갈린 빼기는 사람이 다시 뺀다.** 정해지지 않은 빼기에 걸린 key도 `roster/remove`로 뺄 수 있고 My devices에 "엇갈림"으로 보인다. 사람이 그 컴퓨터에서 다시 빼면 그 컴퓨터의 빼기가 되어 풀린다. (agent: review F1의 가장 작은 고침)
- **명단의 컴퓨터는 서로 대등하다.** 어느 컴퓨터나 항목에 서명하므로 컴퓨터의 터미널 입력 허락은 정직한 code에만 묶인다. 고치지 않고 `architecture/remote.md`에 적는다: 명단의 컴퓨터 하나가 뚫리면 명단 전체가 뚫린 것으로 본다. 폰의 허락은 폰이 서명하지 못하므로 지켜진다. (agent: 사람이 고른 방식 1의 성질이다)
- 규칙이 바뀌면 옛 판과 새 판이 같은 명단을 다르게 본다. protocol 판을 올려 섞이지 않게 한다. (agent)

data:
- **git을 읽지 못한 것은 "git이 아니다"가 아니다.** git이 없거나 거절하면 그 project의 저장소 종류와 id를 건드리지 않는다. 폴더에 `.git`이 없을 때만 git이 아닌 것으로 본다. 이미 잘못 붙은 id가 있는지는 고칠 수 없다(구별할 기록이 없다). 이슈로 남긴다. (agent)
- **id를 모으는 고침은 다시 해도 같다.** `shell.devices`의 기기 id는 명단을 저장할 때마다 접힌 쌍 전부에 대해 고친다. (agent)
- 폰 target의 이름은 명단에서 온다(없앤 별명을 읽지 않는다).

설치본:
- mac 설치본에서 터미널 library의 실행 file(`spawn-helper`)에 실행 권한을 준다. mac에서 돌려 보지 못하므로 packaging code와 그 test로만 한다. 실제 확인은 사람에게 부탁한다.

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `fix-identity` | 없음 | git을 읽지 못한 project에 id를 만들지 않기, data step의 test, 앱이 받는 id가 바뀌는 경우의 문서 |
| 1 | `fix-roster` | 없음 | 명단 규칙 넷(쓰인 초대, key로 세는 빼기, 모르는 서명자 상한, 엇갈린 빼기 다시 빼기), id 모으기 다시 하기와 test, 폰 target 이름, lophn 터미널 탭에서 명단 CLI 거절, protocol 판, 남은 옛 문구 |
| 1 | `fix-terminals` | 없음 | `terminals/open`의 입력 자격, 터미널 응답 channel의 검사, extension CLI의 env, 틀린 `resume`, mac `spawn-helper`, core가 죽을 때 CLI가 남는지 확인해 이슈로, 남은 옛것과 문서 |
| 1 | `fix-setup` | 없음 | `machines/*`를 shell capability로, 기기 자격의 vault·token 이름과 `remote.*` 설정 거절, "허락이 있어도 열지 않는 것"의 test, 임시 secret 정리, 화면만 막던 로그인 종류를 core에서 거절 |

소유는 겹치지 않는다: `fix-roster`는 `packages/protocol/remote/roster*`와 `packages/core/remote/`의 명단 file, `fix-setup`은 `packages/core/remote/call.ts`와 `machines/*`의 자격, `fix-terminals`는 `packages/core/terminals`·`packages/core/extensions`·packaging. brief가 file 단위로 정한다.

## 위험 test (brief에 있다)

- 터미널 입력 허락이 없는 기기가 `terminals/open`에 `command`나 `resume`을 실으면 치지 않는다.
- 쓰인 초대장으로 든 기기를 뺀 뒤에도 그 초대장으로 다른 key가 들지 못한다.
- 남의 id를 실은 빼기가 그 id의 기기를 지우지 못한다.
- 모르는 서명자의 항목이 상한에 닿아도 빼기가 저장된다.
- 엇갈린 빼기에 걸린 key를 사람이 다시 빼면 빠진 쪽만 남고 뺀 쪽이 돌아온다.
- CLI의 사람 token으로 `machines/call`을 부르지 못한다.
- 허락받은 기기가 `roster/*`, `logins/*`, vault 이름의 `secrets/put`, `remote.*` 설정 쓰기를 부르면 `forbidden`이다.
- git이 실패하는 project에 id가 생기지 않는다.
- 폰 하나에 id가 둘이던 data root에서 id를 모은 뒤 `app_sync_log`와 `shell.devices`가 같은 id를 가리킨다.

## lead가 할 일

- 띄우기 전에 계약 commit 하나를 한다: `packages/protocol/remote/routes.ts`의 `machines/call`·`machines/watch` 입력에 `shell_capability`를 더한다(모양은 `fix-setup`의 brief에 있다). 이 file은 `fix-roster`의 것인데 `fix-setup`도 그 한 줄이 필요해서 lead가 먼저 고정한다. `fix-setup`이 merge되기 전에는 plan branch에서 다른 기계의 창이 열리지 않는다(입력이 거절된다).
- `fix-roster`는 믿음 규칙을 고친다. merge하기 전에 다른 worker(opus) 하나에게 review를 맡긴다. 볼 것: 고친 규칙으로 review의 F1~F4가 막히는가, 새로 생긴 길(다시 빼기)로 도둑이 정직한 컴퓨터를 뺄 수 있는가, 받은 순서가 달라도 같은 결과인가.
- 네 task는 서로 기대지 않는다. 한꺼번에 띄운다. `core-browser`가 같은 `allowlist.ts`를 고치고 있으니 `status.py ready`가 거르는 대로 따른다.
- review가 올리라고 한 것 가운데 이 계획이 고치지 않는 것은 이슈로 올린다(`issue` skill의 "올릴지"를 거친다): 이미 잘못 붙었을 수 있는 project id, 개발 앱의 터미널에서 친 `lophn`이 `~/.lophn`을 잡는 것.
- 실제 relay에 붙지 않는다. subprocess를 띄우는 test와 E2E는 새로 만들기 전에 사람에게 묻는다.
- `packages/mobile`을 고친 task는 그 폴더의 typecheck와 test도 통과해야 한다.
- 끝나면: review가 "stale"로 적은 문서와 catalog 줄(각 review의 "Docs and catalog pieces checked")을 고친 것을 확인하고, `architecture/remote.md`에 "명단의 컴퓨터는 대등하다"를 적고, change-log를 쓴다(`해야:` protocol 판이 오르면 폰 앱 update). 계획 폴더를 지운다.
- 사람에게: 끝난 뒤 실제 확인을 부탁한다(mac 설치본에서 터미널이 열리는지, 컴퓨터 둘과 폰 하나로 빼기와 초대가 되는지).
