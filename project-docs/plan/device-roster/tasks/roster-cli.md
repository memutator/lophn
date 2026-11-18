# roster-cli

화면 없는 기계를 사람의 터미널에서 명단에 넣고 다룬다: `lophn remote on | invite | join <초대장> | devices | remove <기기>`. agent의 shell과 `lophn` tool은 부르지 못한다.

- 단위: roster (wave 3)
- 선행: roster-core. `join`이 부르는 `roster/join`의 handler는 같은 wave의 `roster-links`가 만들지만 route 모양은 `roster-contract`가 고정했으므로 같이 돈다.
- 소유(이 task만 고친다):
  - `packages/cli/commands/remote.ts`(새 file)
  - `packages/cli/commands/mod.ts`
  - `project-docs/flows/areas/cli.yaml`
- 읽을 것:
  - 계획 README "정한 것 › 들이기"("화면 없는 기계는 CLI로 한다")
  - `project-docs/plan/device-roster/tasks/roster-contract.md` "모양"의 `roster/list|invite|join|remove`, `machines/list`
  - architecture: `project-docs/architecture/remote.md`(명단 절), `approval.md` "사람의 허락이 드는 설정"(`remote.*`는 agent 자격만 막는 잠긴 설정)
  - 본보기: `packages/cli/commands/machine.ts`(사람만 쓰는 명령, `workspaces: []`), `packages/cli/commands/settings.ts`(`settingsUpdate`를 부르는 길)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/cli`
- 계약:
  - 쓰는 것: route `roster/list`, `roster/invite`, `roster/join`, `roster/remove`, `machines/list`(모두 actor user), `settingsUpdate`
  - 내놓는 것: 없음

## 할 일

1. `packages/cli/commands/remote.ts`에 명령 다섯을 `defineCommand`로 둔다. 모두 `workspaces: []`(lophn agent의 `lophn` tool에 실리지 않는다). agent의 shell에서 binary로 부르면 agent 자격이라 route의 actor user에서 `forbidden`이다(지금 `machine.forget`과 같다).
   - `remote.on`: `settingsUpdate`로 `remote.enabled`를 true로 한다. 거절(`rejected`)이 있으면 그대로 오류로 낸다. relay 설정은 건드리지 않는다.
   - `remote.invite [--terminal-input <true|false>] [--long]`(터미널 입력 기본 true. Settings의 "Let the new device type in terminals" 기본과 같다. `--long`은 `lifetime: "long"`(7일)이고 없으면 `"short"`(30분)다. description은 새 기기가 이 컴퓨터와 같이 켜질 수 없을 때(dual boot, 집과 직장) `--long`을 쓰라고 말한다): `roster/invite`를 부르고 초대장 글(`invite`의 JSON 한 줄)과 끝나는 때를 낸다. 다른 기기의 `lophn remote join`이나 폰의 "Enter code"에 그대로 넣는 글이다. remote가 꺼져 있으면 core의 `unavailable`을 그대로 내고 description이 `lophn remote on`을 먼저 하라고 말한다.
   - `remote.join <text>`(positional): `roster/join`. 결과는 들어간 기기 id, 초대한 기계, `pending`이다. `pending`이면 summary가 "초대한 컴퓨터에 아직 닿지 못했다. 그 컴퓨터를 믿는 컴퓨터에 닿거나 폰이 소식을 나르면 끝난다"를 말한다. 오류의 `details.reason`(`expired`, `used`, `untrusted`, `removed`, `this_computer`)을 사람이 읽을 말로 summary에 싣는다.
   - `remote.devices`: `roster/list`와 `machines/list`를 읽어 기기마다 id, kind, 이름, os, 터미널 입력, 이 컴퓨터인가, 컴퓨터면 연결 상태와 길을 낸다. 이름은 명단의 이름 하나다.
   - `remote.remove <device>`(positional, `dev_` id): `roster/remove`. 이 컴퓨터 자신이면 core의 `invalid_input`을 그대로 낸다.
2. `packages/cli/commands/mod.ts`의 `COMMANDS`에 `REMOTE_COMMANDS`를 더한다.
3. description은 영어로, 명령이 무엇을 하는지와 다른 명령과의 관계(invite → 다른 기계에서 join, remove는 모든 기계에 퍼진다)를 쓴다. 요구 ID나 작업 번호를 넣지 않는다.
4. flows(`flows` skill): `project-docs/flows/areas/cli.yaml`에 다섯 명령의 entry와 outcome(성공, remote 꺼짐, 거절 이유)을 더한다.

정한 것:
- `remote off`는 두지 않는다. 이유: README가 정한 명령 목록에 없고 `lophn settings set remote.enabled false`로 된다.
- 터미널 입력 허락을 바꾸는 명령은 두지 않는다. 이유: README의 CLI 목록에 없다(Settings와 `roster/set_terminal_input`이 한다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. 사람만 부를 수 있는 경계는 route의 actor가 지키고 `roster-links`의 test가 본다. 명령 parsing과 출력은 test하지 않는다.
- 남지 않음: 이 task는 옛 이름을 지우지 않는다. `grep -rn "pairing/start\|pairing\.start" packages/cli`가 0줄이다.
- core를 띄우는 test를 만들지 않는다. 손으로 볼 때는 개발 root에서 먼저 `lophn settings set remote.relay ""`를 한 뒤 `lophn remote on`을 한다(실제 relay에 붙지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## 계약 review 뒤 바뀐 것 (lead가 더함)

`roster/invite` 입력에 `kind`(computer | phone)가 생겼다(샌 폰 초대장으로 컴퓨터가 들지 못하게). 명령은 `lophn remote invite <phone|computer> [--terminal-input …] [--long]`이다(positional kind, 기본 없음). `join`의 거절 reason에 `id_taken`, `key_taken`이 더해졌다.
