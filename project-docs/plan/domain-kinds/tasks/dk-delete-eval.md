# dk-delete-eval

테스트와 eval 쪽에서 context를 지운다: 지운 기능의 e2e file, eval의 context 재료·restore·registry 항목·시나리오 문구를 없애고, 세무 재료는 kind 파일(`kinds.yaml`)을 직접 놓는 재료로 다시 쓴다. e2e는 돌리지도 고치지도 않지만(README "e2e") 지운 기능을 가리키는 줄은 같이 없앤다.

코드 이름은 아직 `project`·`project_manager`다. 새 내장 skill 이름은 **`kinds-yaml`**이다(`dk-skill`이 만든다. 이 task는 이름 문자열만 쓴다).

- 단위: cleanup (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/pm-context_test.ts`
  - `tests/e2e/pm-tools_test.ts`
  - `tests/e2e/agent-call_test.ts`
  - `tests/e2e/session_test.ts`
  - `tests/support/fake-server/server_test.ts`
  - `tests/eval/restore/`
  - `tests/eval/types.ts`
  - `tests/eval/runner/experiment.ts`
  - `tests/eval/materials/tax-receipts/`
  - `tests/eval/materials/tax-kinds/`
  - `tests/eval/materials/operators-home/`
  - `tests/eval/scenarios/operator/common.ts`
  - `tests/eval/scenarios/operator/O4.scenario.ts`
  - `tests/eval/scenarios/operator/O6.scenario.ts`
  - `tests/eval/scenarios/operator/O7.scenario.ts`
  - `tests/eval/scenarios/operator/T19-op.scenario.ts`
  - `tests/eval/versions/versions_test.ts`
  - `tests/eval/registry/tool/context.draft.json`
  - `tests/eval/registry/tool/context.get.json`
  - `tests/eval/registry/tool/context.list.json`
  - `tests/eval/registry/tool/context.search.json`
  - `tests/eval/registry/tool/context.submit.json`
  - `tests/eval/registry/tool/context.test.json`
  - `tests/eval/registry/tool/context.violations.json`
  - `tests/eval/registry/tool/glossary.set.json`
  - `tests/eval/registry/skill/context-init.json`
  - `tests/eval/registry/skill/context-update.json`
  - `tests/eval/registry/skill-description/context-init.json`
  - `tests/eval/registry/skill-description/context-update.json`
  - `tests/eval/registry/material/tax-receipts.json`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`("e2e", "정한 것"), `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/eval.md`(재료, 버전: "재료·시나리오의 n은 쓴 사람이 정하고 registry는 같은 n의 내용이 바뀌면 거절한다", 재료·registry·runs data는 `deno.json`의 `fmt.exclude`), `project-docs/architecture/testing.md`
  - 지금 코드: `tests/eval/restore/context.ts`(PM이 `context_draft`로 만드는 fake 대본), `restore/mod.ts:16,33,49`, `restore/manifest.ts`(`ID_PREFIX`), `restore/operators.ts`(`contexts`), `restore/hash.ts`의 `contentHash`, `restore/projects.ts`(project 폴더를 `core.run.work`에 놓고 등록), `tests/eval/materials/tax-receipts/1/`(옛 context 재료), `tests/eval/materials/operators-home/1/files/operators.json`
  - 계약: `packages/protocol/projects/kinds-file.ts`(`kindsFilePath`, 형식은 `kindsFileSchema`)
- 계약:
  - 쓰는 것: `kindsFilePath(dataRoot, project)`. 데이터 root는 `core.run.home`이다(`tests/support/core/mod.ts`의 `Core.run.home`으로 확인한다)
  - 내놓는 것: material kind `kinds`(옛 `context` 대신), 재료 `tax-kinds@1`, `operators-home@2`

## 할 일

1. **e2e (돌리지 않는다)**
   - `tests/e2e/pm-context_test.ts`를 지운다.
   - `pm-tools_test.ts`: `skill_read { name: "context-init" }`를 `"kinds-yaml"`로 바꾼다(그 밖의 줄은 context와 무관하다. 이 file의 context 부분은 이 한 줄뿐이다).
   - `agent-call_test.ts:64,74`, `session_test.ts:212`, `tests/support/fake-server/server_test.ts:98,113`: PM을 가르려고 `context_draft` tool 이름을 쓰던 곳이다. PM의 tool 목록에서 그 이름이 없어진다. PM lane 판정을 "tool 목록에 `operator_create`가 있고 `ticket_create`·`app_create`가 없다"로 바꾼다. `server_test.ts`는 합성 요청(`{ tools: [{ name: … }] }`)이라 이름만 맞으면 되므로 같은 합성 이름(예 `operator_create`)으로 바꾼다. 이 test는 `deno task check`가 돈다 — 통과해야 한다. e2e 쪽은 type만 맞고 돌리지 않는다.
2. **eval restore**
   - `tests/eval/restore/context.ts`를 지우고 `restore/kinds.ts`를 만든다: material `kinds`는 `files/spec.json`(`{ "project": "tax" }`)과 `files/kinds.yaml`을 가진다. `restoreKinds(ctx, material)`은 `ctx.world.projects[spec.project]`가 없으면 `invalid_input`, 있으면 `kindsFilePath(core.run.home, projectId)`에 `kinds.yaml`을 쓴다(폴더는 만든다). 옛 restore가 fake PM 대본으로 draft 길을 지나던 일은 필요 없다 — kind 파일은 release 없이 바로 쓰인다.
   - `restore/mod.ts`의 `case "context"`를 `case "kinds"`로, `world`의 `contexts: {}`를 지운다. `manifest.ts`의 `ID_PREFIX`에서 `context: "ctx"`를 `kinds: "prj"`로(이 재료는 `ids`가 비어 있어 접두는 쓰이지 않는다. type이 요구한다). `tests/eval/types.ts`: `MaterialKind`의 `"context"`를 `"kinds"`로, `WorldIds.contexts`(≈:104)를 지운다. `restore/operators.ts`: `contexts` 처리(`resolveContext`)를 지운다. `restore/save.ts`에 `context` 분기가 있으면 같이 정리한다(`rg -n "context" tests/eval/restore`로 확인).
3. **재료**: `materials/tax-receipts/`를 지우고 `materials/tax-kinds/1/`을 만든다. `kinds.yaml`은 옛 `bundle.json`의 `Receipt` type(frontmatter `slug`·`store`·`amount`·`date`, 파일 `receipts/*.md`, key `slug`, 필수 칸 넷)을 roadmap 예(`project-docs/products/roadmap/domain.md` "재료 schema")의 모양으로 옮긴다:
   ```yaml
   kinds:
     - name: receipt
       summary: A receipt kept for the tax return
       files: [receipts/*.md]
       key: slug
       fields:
         slug: { type: string, required: true, pattern: "^[a-z0-9-]+$" }
         store: { type: string, required: true }
         amount: { type: number, required: true }
         date: { type: date, required: true }
   ```
   `material.json`: `{ kind: "kinds", ids: {}, needs: ["projects-home@1"], parent: null, produced_by: null, content_hash }`. `content_hash`는 `restore/hash.ts`의 `contentHash(files)`로 계산한다(작은 임시 script를 `.dev-data/dk-delete-eval/`에서 돌리고 commit하지 않는다).
   `materials/operators-home/`: `2/`를 만든다(`1/`은 지운다). `operators.json`에서 `세무정리`의 `contexts`를 빼고 body의 "영수증 context를"을 "영수증 kind를"로, `needs`를 `["apps-home@1","projects-home@1","tax-kinds@1"]`로, `content_hash`를 다시 계산한다. `ids`는 그대로다.
4. **시나리오**: `scenarios/operator/common.ts`의 `OPERATOR_WORLD`에서 `"tax-receipts@1"`을 `"tax-kinds@1"`로, `"operators-home@1"`을 `"operators-home@2"`로 바꾸고 그 위 주석의 `operators-home@1`도 맞춘다. 이 file은 operator 폴더 시나리오 전부의 hash에 들므로(`common.ts` 첫 주석) **`O4`·`O6`·`O7`·`T19-op` 넷의 `n`을 모두 하나씩 올린다**(내용 hash가 바뀌면 registry가 같은 n을 거절한다). `O6.scenario.ts`는 출처 주석과 `REQUEST`의 "context 계약"을 kind 파일 말로 바꾼다("영수증 kind에 '공급자' 칸이 필요한데 kinds.yaml에 없네. 일은 계속해 줘"). 판정(PM에게 call하는지)은 그대로다. 그 밖의 시나리오는 이 재료를 쓰지 않는다(`rg -n "tax-receipts|operators-home|OPERATOR_WORLD" tests/eval`로 확인).
5. **registry**: 위 소유의 `tests/eval/registry/**` 항목은 지운 tool·skill·재료의 기록이다. 지운다. 나머지 registry(`instruction`, `guide`, `template`, 새 tool·skill)는 eval을 돌릴 때 registry가 스스로 더하므로 손으로 고치지 않는다.
6. `tests/eval/versions/versions_test.ts:143`의 분류 예시 경로 `skills/context-init/SKILL.md`·`skill:context-init`을 `skills/kinds-yaml/SKILL.md`·`skill:kinds-yaml`로 바꾼다. `runner/experiment.ts:278`의 주석 "(앱, project, Operator, context)"에서 context를 뺀다. (`tests/eval/versions/files.ts`의 `TOOL_FILES` 정리는 tool file을 지우는 `dk-delete-context-tools`가 한다.)

## 정한 것

- 재료 이름은 `tax-kinds`, kind 이름은 `kinds`다. 옛 `tax-receipts@1`은 옛 모델의 재료라 고쳐 살리지 않고 지운다(AGENTS.md "호환성").
- eval을 돌리지 않는다(진짜 provider는 사람의 허락이 필요하다). 재료가 core에서 실제로 복원되는지는 이번에 확인하지 못한다 — 보고의 알려진 미완 동작으로 적는다.

## 끝남

- `deno task check`가 통과한다(`tests/support/fake-server/server_test.ts`, `tests/eval/**/*_test.ts` 포함).
- 위험 test: 없음(지운 기능의 test를 지우고 이름 문자열을 맞췄다).
- 남지 않음: `rg -n "context" tests/eval tests/e2e tests/support --glob '!tests/eval/runs/**' --glob '!tests/eval/scorecards/**' --glob '!tests/eval/registry/instruction/**' --glob '!tests/eval/registry/guide/**' --glob '!tests/eval/registry/template/**'`에서 SetupContext·TurnContext·AuthenticatedContext 같은 무관한 코드 단어와 `opening_context`를 뺀 줄이 0이다. `rg -n "context_draft|context-init|context-update|restoreContext|tax-receipts" tests`가 `runs/`·`scorecards/` 밖에서 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 새 재료 `tax-kinds@1`의 실제 복원은 확인하지 못했다(eval을 돌리지 않았다).
