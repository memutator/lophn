# ap-settings-edit

`settings_edit` intent를 쓰는 곳을 지운다. 지침 파일(`LOPHN.md`) 쓰기와 `operator.create`·`operator.update`는 묻지 않는다. 쓰기 전 rewind 기록(`aroundWrite`)은 그대로 둔다.

- 단위: settings-edit (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/hooks.ts`
  - `packages/core/agent-roles/hooks_test.ts`
  - `packages/core/agent-roles/tools/operator.ts`
  - `packages/core/lophn-agent/tool-judgment/intents.ts`(지운다)
  - `packages/core/lophn-agent/tool-judgment/mod.ts`
  - `packages/core/lophn-agent/tools/ports.ts`
  - `packages/core/lophn-agent/tools/bundles/file.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/approval.md`(흐름 아래 "지침 파일(`LOPHN.md`) 쓰기만 '설정 고치기'로 본다", "agent는 자기 grant를 넓히지 못한다"), `project-docs/architecture/agent-definition.md`("file tool은 place 폴더 안에 가둔다", "agent 정의는 lophn data에 있어 file tool이 닿지 않는다", "Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다"), `project-docs/architecture/place-session.md`(file tool 범위와 rewind: 사람의 폴더가 없는 project의 `LOPHN.md`는 PM 범위 밖이다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tools`, `approvals`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`(file tool hook), `packages/core/lophn-agent`
  - 제품 결정: `project-docs/products/roadmap/approval.md`의 "묻지 않는 것"(지침 파일 쓰기)과 "정한 것 (agent)"의 "`LOPHN.md` 쓰기를 묻지 않는다", "Operator 정의의 skip 기본값 칸은 사람만 쓴다"(근거 줄의 `operator.update`), `project-docs/plan/approval-simplify/README.md`의 "순서"(지우기 목록의 `settings_edit`)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `settingsEditIntent`가 없다. `FileHooks`에 `writeGate`가 없다(`aroundWrite`만 남는다). `operator.create`, `operator.update`, `file.write`, `file.edit`에 `gate`가 없다. 옛 Gate의 `settings_edit` 줄, intent의 `settings_edit` 종류, grant의 `settings` 줄은 남는다(ap-ask-turn과 ap-cleanup이 지운다).

## 할 일

줄 번호는 main `8c243da91` 기준이다.

1. file hook(`packages/core/agent-roles/hooks.ts`)
   - `writeGate`(16-32)와 그것만 쓰는 `isInstructionFile`(7-11)을 지운다. `settingsEditIntent` import(4)를 지운다.
   - 13-14 주석을 "file.write와 file.edit에 role 층이 끼우는 규칙이다: 쓰기 전에 pre-image를 남긴다(기록이 실패해도 쓰기는 막지 않는다). 지침 파일(`LOPHN.md`)도 묻지 않고 쓰고 rewind로 되돌린다"로 바꾼다. 7-8 주석 가운데 남길 뜻(agent 정의는 lophn data에 있어 file tool이 닿지 않는다)은 이 주석에 합친다.
   - `aroundWrite`는 그대로 둔다.
2. `packages/core/agent-roles/hooks_test.ts`를 지운다. 그 file의 test 하나는 `writeGate`가 `LOPHN.md`에만 `settings_edit` 요청을 내는지 본다. 설계에서 그 물음이 없어진다(roadmap "`LOPHN.md` 쓰기를 묻지 않는다").
3. port(`packages/core/lophn-agent/tools/ports.ts`): `FileHooks.writeGate`(35)와 `GateRequest` import(12)를 지우고, 31-33 주석을 "aroundWrite는 실제 쓰기(run)를 감싼다. 쓰기 기록을 어디에 남기는지는 harness가 모른다"로 줄인다. `ToolGatePort`는 그대로다.
4. file tool(`packages/core/lophn-agent/tools/bundles/file.ts`): `file.write`(42-43)와 `file.edit`(58-59)의 `gate:`를 지운다. 17줄 주석 "쓰기의 Gate와 쓰기 기록은 hook이 맡는다"를 "쓰기 기록은 hook이 맡는다"로 바꾼다.
5. Operator tool(`packages/core/agent-roles/tools/operator.ts`): `gateFor`와 그 주석(68-83), 두 tool의 `gate:`(129, 169), import의 `settingsEditIntent`(12)와 `GateRequest`(19)를 지운다. `ToolContext` import는 `domainIdsOf`·`resolvePlace`가 계속 쓴다. 입력에서 grant와 `mcp_servers`를 빼는 규칙(33-37)은 그대로다.
6. `packages/core/lophn-agent/tool-judgment/intents.ts`를 지우고 `packages/core/lophn-agent/tool-judgment/mod.ts`에서 `settingsEditIntent` export 줄(1)을 지운다. `createToolGate` export는 `packages/core/main/daemon/wiring/approvals.ts`가 쓰므로 남긴다(ap-ask-turn이 정리한다).
7. 문서(`architecture/approval.md`, `agent-definition.md`)는 lead가 계획 끝에 고친다(README "lead가 할 일"). 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 물음을 지우는 일이다. `LOPHN.md` 쓰기를 되돌리는 길(`aroundWrite`의 pre-image 기록)은 바뀌지 않는다. `packages/core/lophn-agent/tools/registry_test.ts`의 gate 있는 가짜 `operator.update`는 그 file 안 fixture라 이 task와 상관없이 통과한다.
- 남지 않음:
  - `grep -rn "settingsEditIntent\|writeGate\|isInstructionFile" packages tools`가 0줄이다.
  - `grep -n "gate" packages/core/agent-roles/tools/operator.ts packages/core/lophn-agent/tools/bundles/file.ts packages/core/agent-roles/hooks.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". lophn guide가 이 task 뒤 틀린 말을 한다. 소유 밖이니 고치지 말고 여기 적는다: `packages/core/agent-roles/roles/lophn/guides/instructions.md`("an agent cannot create or save `LOPHN.md` … without your permission"), `questions-and-decisions.md`("a change to lophn settings"), `roles-and-grants.md`("changing lophn settings asks")
