# role-rules-instructions

`instructions/files.ts`(GetInstructions를 reader Worker에서 서빙하는 file)에서 숨은 SQL과 role 분기를 걷어낸다. SQL 세 곳(project 폴더, 앱이 든 project, project 존재)은 projects·apps의 `lookups.ts`로, role별 정의 file 자리와 "다른 project 지침은 lophn만 읽는다" 규칙은 `agent-roles`로 옮기고, 둘을 아는 새 team file이 `files.ts`의 factory에 꽂는다. `issues/layers.md`의 "`instructions/files.ts`의 SQL" 고치기("`role-ports`와 같은 방법이다")가 이 task다.

- 단위: role-rules (wave 2)
- 선행: role-rules-agent-files, role-rules-session-places. agent-files가 만든 표의 `slotOf`로 정의 file 자리를 구하고, session-places가 protocol에 더한 `agentRefOfColumns`로 session 행에서 ref를 만든다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/instructions/files.ts`
  - `packages/core/lophn-agent/instructions/read_test.ts`
  - `packages/core/projects/lookups.ts`
  - `packages/core/apps/lookups.ts`
  - `packages/core/main/daemon/wiring/instructions-registration.ts`
  - `packages/core/agent-roles/place/instruction-rules.ts`
  - `packages/core/agent-roles/place/instruction-rules_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(harness와 lophn domain 절), `project-docs/architecture/agent-definition.md`
  - 이슈: `project-docs/issues/layers.md`(첫 절 "harness 폴더에 domain protocol import와 role 이름이 25개 file에 남았다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `agents`, `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/agent-roles`
  - 본보기: 지난 계획이 같은 일을 나눈 방식은 `project-docs/products/change-log/0.2.0.md`의 "lophn-agent를 harness, role 층, domain tool로 나눔"(role 층이 값·규칙을 갖고 harness는 조립이 넘긴 것으로 돈다. `main/daemon/wiring/lophn-agent-team.ts`가 꽂는다)
  - 지금 코드(열어서 확인함): `instructions/files.ts`의
    - `projectFolder`: `project_folders`에서 position 첫 폴더
    - `projectOfApp`: `apps.source_path`와 `project_folders` join `projects`(active)에서 가장 안쪽 폴더를 가진 project
    - `readInstruction`의 project 존재 확인(`projects`)
    - `agentFilePath`: role별 정의 file 자리(`agents/store.ts`의 `slotOf`와 같은 배치의 사본)
    - `session.role !== "lophn"`: 다른 project 지침 거절
  - 팀 file 본보기: `main/daemon/wiring/rewind-registration.ts`(reader Worker가 import하는 `createReaderRegistration`), `main/daemon/wiring/lophn-agent-team.ts`
  - 제약: `files.ts`는 동기 file API(`Deno.openSync` 등)를 쓰는 reader Worker 전용이다. core main thread graph에 이 file이나 `node:fs` 동기 import를 들이지 않는다. 지금 `main/daemon/runtime.ts`가 `TEAM_MODULES`를 main thread에서 `import`로 열어 `createReaderRegistration` 유무를 보므로, 새 team file도 top-level에서 동기 file API를 실행하지 않는다.
- 계약:
  - 쓰는 것: protocol `instructionsGet`, `instructionPreview`(바꾸지 않는다), 표의 `slotOf`, protocol `agentRefOfColumns`
  - 내놓는 것:
    - `projects/lookups.ts`: `projectFirstFolder(sql, project): string | null`, `innermostProjectOfPath(sql, path): string | null`(active project 중 폴더가 path를 품는 가장 안쪽). 기존 `projectExists`를 존재 확인에 쓴다.
    - `apps/lookups.ts`: `appSourcePath(sql, app): string | null`
    - `agent-roles/place/instruction-rules.ts`: `agentFilePathOf(root, session)`(role·place·operator id로 정의 file 경로, 못 구하면 null), `mayReadOtherProject(role): boolean`(lophn만 true)
    - harness `instructions/files.ts`: `createInstructionReads(deps): ReaderRegistration`. deps는 위 조회와 규칙을 함수로 받는다. 이 file은 `createReaderRegistration` export를 더 갖지 않는다(팀 file이 부른다).
    - 새 team file `main/daemon/wiring/instructions-registration.ts`: `export function createReaderRegistration()`가 위 deps를 꽂은 `createInstructionReads`를 돌려준다.

## 지켜야 할 것(계획 README, 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

그 밖에: harness 폴더의 비운 file에는 role 이름 문자열 리터럴(`"project_manager"`, `"app_engineer"`, `"operator"`; `tools/check-deps.ts`의 `ROLE_NAMES`)이 type 자리(`Exclude<Role, "operator">` 같은 것)까지 한 줄도 남으면 안 된다. 판정은 role 표가 함수로 내놓는다(`isOperator(role)` 꼴). `tools/check-deps.ts`는 이 task가 비운 file의 `HARNESS_LEFTOVERS` 항목만 지운다. 다른 task도 다른 줄을 고치므로 소유 줄에 두지 않았다(겹치면 lead가 rebase에서 두 쪽을 다 남긴다). 항목을 안 지우면 check가 "목록에서 빼라"고 실패한다.

## 할 일

1. `projects/lookups.ts`, `apps/lookups.ts`에 읽기 함수를 더한다. SQL 문장은 지금 `files.ts` 것을 그대로 옮긴다(동작 같음). domain끼리 import하지 않으므로 "앱이 든 project" 합성은 team file에서 `appSourcePath`와 `innermostProjectOfPath`를 이어 한다.
2. `agent-roles/place/instruction-rules.ts`에 `agentFilePathOf`, `mayReadOtherProject`를 둔다. 정의 file 자리는 표의 `slotOf`를 불러 구하고 사본을 만들지 않는다.
3. `instructions/files.ts`를 factory로 바꾼다. `FILE_NAME`, `openFile`, `bodyOf`, 읽기 한도·에러 코드는 그대로. `dataRootOf`(`agents/store.ts`)는 role을 모르므로 계속 쓴다. `loadSession`의 `sessions` 읽기는 harness 표라 남는다.
4. `main/daemon/wiring/instructions-registration.ts`를 만들어 deps를 꽂는다.
5. `instructions/read_test.ts`가 새 시그니처에 걸리면 맞춘다.
6. `agent-roles/place/instruction-rules_test.ts`에 표 test 하나: 다른 project 지침 거절 규칙(lophn은 읽고 나머지 세 role은 거절)과 role 4개의 정의 file 경로.
7. `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`에서 `instructions/files.ts` 항목을 지운다.

## 끝남

- `deno task check`가 통과한다.
- 동작을 바꾸지 않는다: role 4개(lophn, project_manager, app_engineer, operator)의 tool 목록·prompt bytes·정의 file 자리를 전후로 비교한다. 이 task가 건드리지 않는 것(tool 목록, prompt)은 소유 file 밖이라 diff에 없음을 보이면 되고, 정의 file 자리와 이름·기본 profile처럼 이 task가 옮기는 값은 옮기기 전 값을 임시 script(commit하지 않는다)로 뽑아 옮긴 뒤 값과 같음을 보인다. 확인은 unit test와 `deno task check`까지다.
- 새 E2E·subprocess·서버 test를 만들지 않는다.
- 위험 test: "lophn이 아닌 role은 다른 project의 LOPHN.md를 읽지 못한다"(`instruction-rules_test.ts`). 지침 읽기 권한 경계라 둔다.
- 남지 않음: `grep -n "project_folders\|from projects\|from apps\|join projects" packages/core/lophn-agent/instructions/files.ts`가 0줄이고 `grep -n "project_manager\|app_engineer\|\"operator\"" packages/core/lophn-agent/instructions/files.ts`가 0줄이다. `HARNESS_LEFTOVERS`에 `instructions/files.ts` 줄이 없다. `grep -n "/agents" packages/core/lophn-agent/instructions/files.ts`가 0줄이다(정의 file 경로 사본이 안 남았다).

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

- **등록할 것(필수)**: `packages/core/main/daemon/assembly.ts`의 `TEAM_MODULES`에서 `lophn-agent/instructions/files.ts` 줄을 `./wiring/instructions-registration.ts`로 바꾼다. 이 줄을 바꾸기 전에는 `files.ts`가 `createReaderRegistration`을 더 내보내지 않아 `main/daemon/runtime.ts`가 reader Worker에 붙이지 않으므로 GetInstructions의 reader 서빙이 빠진다. 같은 변경에 이 줄을 같이 고쳐도 되는지는 lead가 정한다.
