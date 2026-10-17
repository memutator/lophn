# role-rules-data-folder

`<data root>/projects/<id>`·`<data root>/apps/<id>` 아래 lophn data 폴더 규칙(agents 폴더, project id 폴더 이름)을 `agent-roles`에 한 곳으로 모은다. 지금은 `agents/store.ts`의 `placeAgentsFolder`, `instructions/files.ts`의 `agentFilePath`, `extensions/project-settings.ts`의 `projectFolderOf`, `extensions/project-servers.ts`의 문자열이 같은 규칙을 따로 짠다. 이 task는 규칙을 새 file에 두기만 하고 쓰는 곳을 고치지 않는다. 쓰는 곳은 다음 task들이 바꾼다.

- 단위: role-rules (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/place/data-folder.ts`
  - `packages/core/agent-roles/place/data-folder_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(harness와 lophn domain 절), `project-docs/architecture/agent-definition.md`
  - 이슈: `project-docs/issues/layers.md`(첫 절 "harness 폴더에 domain protocol import와 role 이름이 25개 file에 남았다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `agents`, `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/agent-roles`
  - 본보기: 지난 계획이 같은 일을 나눈 방식은 `project-docs/products/change-log/0.2.0.md`의 "lophn-agent를 harness, role 층, domain tool로 나눔"(role 층이 값·규칙을 갖고 harness는 조립이 넘긴 것으로 돈다. `main/daemon/wiring/lophn-agent-team.ts`가 꽂는다)
  - 지금 사본: `packages/core/lophn-agent/agents/store.ts`(`placeAgentsFolder`, `slotOf` 위 주석의 배치표), `packages/core/lophn-agent/instructions/files.ts`(`agentFilePath`), `packages/core/lophn-agent/extensions/project-settings.ts`(`projectFolderOf`·`projectSkillsOf`·`projectExtensionsPathOf`), `packages/core/lophn-agent/extensions/project-servers.ts`(`PROJECT_ID`, `${root}/projects/...`)
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/places.ts`의 `Place`
  - 내놓는 것(다음 task가 기대는 모양, 이름은 이대로):
    - `placeDataFolder(root: string, place: Place): string` = `<root>/projects/<id>` 또는 `<root>/apps/<id>`
    - `placeAgentsFolder(root: string, place: Place): string` = `placeDataFolder`/agents
    - `lophnAgentsFolder(root: string): string` = `<root>/agents`
    - `projectsDataArea(root: string): string` = `<root>/projects`
    - `projectIdOfFolder(name: string): string | null`: `prj_` 모양 폴더 이름만 project id로 돌려준다(`project-servers.ts`의 `PROJECT_ID` 규칙 그대로)

## 지켜야 할 것(계획 README, 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

그 밖에: harness 폴더의 비운 file에는 role 이름 문자열 리터럴(`"project_manager"`, `"app_engineer"`, `"operator"`; `tools/check-deps.ts`의 `ROLE_NAMES`)이 type 자리(`Exclude<Role, "operator">` 같은 것)까지 한 줄도 남으면 안 된다. 판정은 role 표가 함수로 내놓는다(`isOperator(role)` 꼴). `tools/check-deps.ts`는 이 task가 비운 file의 `HARNESS_LEFTOVERS` 항목만 지운다. 다른 task도 다른 줄을 고치므로 소유 줄에 두지 않았다(겹치면 lead가 rebase에서 두 쪽을 다 남긴다). 항목을 안 지우면 check가 "목록에서 빼라"고 실패한다.

## 할 일

1. `packages/core/agent-roles/place/data-folder.ts`를 만들고 위 함수를 둔다. 값은 지금 사본과 byte 단위로 같다(근거: 위 "지금 사본" file들). `agent-roles`는 harness를 import할 수 있으나 이 file은 `protocol`만 import한다.
2. `packages/core/agent-roles/place/data-folder_test.ts`에 표 test 하나: project place, app place, lophn의 agents 폴더, project id 폴더 이름 판정(`prj_...` 허용, 그 밖의 이름 거절).
3. 쓰는 곳은 고치지 않는다. 지금 사본이 남아 있어도 이 task의 check는 통과한다.

## 끝남

- `deno task check`가 통과한다.
- 동작을 바꾸지 않는다: role 4개(lophn, project_manager, app_engineer, operator)의 tool 목록·prompt bytes·정의 file 자리를 전후로 비교한다. 이 task가 건드리지 않는 것(tool 목록, prompt)은 소유 file 밖이라 diff에 없음을 보이면 되고, 정의 file 자리와 이름·기본 profile처럼 이 task가 옮기는 값은 옮기기 전 값을 임시 script(commit하지 않는다)로 뽑아 옮긴 뒤 값과 같음을 보인다. 확인은 unit test와 `deno task check`까지다.
- 새 E2E·subprocess·서버 test를 만들지 않는다.
- 위험 test: "사람의 agent 정의·project 설정이 놓이는 data root 아래 자리가 전과 같다"(`data-folder_test.ts`, 표 하나). 정의 file을 찾지 못하면 사람이 만든 Operator가 사라진 것처럼 보이는 규칙이라 둔다.
- 남지 않음: 이 task가 지우는 것은 없다. 사본 제거는 `role-rules-agent-files`·`role-rules-instructions`·`role-rules-extensions`의 끝남이 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

