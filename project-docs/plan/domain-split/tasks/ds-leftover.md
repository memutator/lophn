# ds-leftover

이 계획의 마지막 정리다. 앞 task들이 "안 쓰게 된 export"와 "무겁게 짠 것"으로 남긴 것을 지우고, Drafts를 치우고, 옛 이름이 어디에도 남지 않았는지 한 번에 훑는다. 새 동작은 만들지 않는다. 문서(architecture, PRODUCT, catalog)는 lead 몫이라 고치지 않는다.

- 단위: leftover (wave 5)
- 선행: ds-shell-window, ds-coding-location, ds-tool-rename
- 소유(이 task만 고친다):
  - `packages/base`
  - `packages/coding-agent`
  - `packages/core`
  - `packages/design`
  - `packages/protocol`
  - `packages/sdk`
  - `packages/shell`
  - `tests/e2e`
  - `tests/eval`
  - `tests/support`
  - `tools/check-deps.ts`
  - `tools/wireframes`
- 읽을 것:
  - 계획: `project-docs/plan/domain-split/README.md`, 앞 task의 보고에서 lead가 이 brief 끝 "넘겨받은 것"에 옮겨 적은 목록
  - orchestrate 함정: `.claude/skills/orchestrate/SKILL.md`("지우거나 옮기거나 값을 바꾼 이름·숫자는 grep해 주석과 오류 메시지에 남은 것도 고친다", "route를 지우면 method를 문자열로도 grep한다")
  - 코드: `packages/protocol/domains/{domains,domain-routes}.ts`(중복 read 정의), `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`
- 계약:
  - 쓰는 것: 없음.
  - 내놓는 것: 없음.

## 넘겨받은 것

(lead가 앞 task 보고의 "안 쓰게 된 export", "무겁게 짠 것", "알려진 미완 동작"을 여기에 옮겨 적는다)

## 할 일

1. **중복 read 정의.** `packages/protocol/domains/domain-routes.ts`와 `domains.ts`에 남은 `domainList`·`domainGet`(같은 이름의 `domainApi.list/get`과 중복)을 지우고, 쓰는 곳(`packages/core/apps/agent-tools/{app,package}.ts`, `packages/core/lophn-agent/tools/call/target.ts`, `packages/core/lophn-agent/tools/bundles/call.ts`, `packages/core/agent-roles/tools/operator.ts`)을 `domainApi.list/get`으로 바꾼다. route 이름 문자열(`domain.list`)로 credential 상한을 대조하는 곳(`packages/core/agent-roles/credentials.ts`)이 그대로인지 확인한다.
2. **안 쓰게 된 export.** 넘겨받은 목록의 export를 `grep`으로 쓰는 곳이 없음을 확인하고 지운다. 쓰는 곳이 남아 있으면 지우지 않고 보고한다.
3. **Drafts.** `tools/wireframes/drafts/domain-project/`를 지우고 `tools/wireframes/drafts/index.tsx`의 `draftsArea.pages`를 빈 목록으로 돌린다(고른 안은 이미 Screens로 옮겨졌다).
4. **tools/check-deps.ts.** `HARNESS_LEFTOVERS`의 file 목록과 이유 문구가 새 이름·경로와 맞는지, 위반이 사라진 file은 목록에서 빠졌는지 본다(check가 빼라고 알려 준다). `ROLE_NAMES`·`CORE_DOMAINS`가 새 이름이다.
5. **옛 이름 훑기.** 아래 "남지 않음"을 모두 돌려 남은 줄을 고친다. 주석·오류 메시지·wording 표시 문구·test 이름 속의 옛 말(`Project Manager`, `PM`, "app-api", "context" 계열 `contexts`/`context_binding`)을 포함한다. 뜻이 바뀌는 곳은 고치지 않고 보고한다.
6. **e2e·eval.** `tests/e2e`, `tests/eval`, `tests/support`의 type 오류가 없는지 `deno task check:full`로 본다. 기계적으로 막는 곳만 고친다. 돌리지 않는다.
7. **죽은 코드.** 앞 task가 임시로 둔 것(예: 런처의 임시 등록 흐름, `[{id: 창 id}]` 임시 domain 목록)이 남았으면 지운다. `TODO`·`FIXME`를 지운다.

## 끝남

- `deno task check:full`이 통과한다. `project-docs/plan/tools/lead/boot.sh`, `deno run -A packages/shell/renderer/build.ts`, `deno task wireframes`가 된다.
- 위험 test: 없음. 지운 export의 test는 같이 지운다.
- 남지 않음(0줄. `tests/eval/runs`, `tests/eval/materials`, `project-docs/plan`, `project-docs/products`, `.claude/worktrees`는 뺀다):
  - 경계 뜻의 옛 이름: `grep -rnE "project_manager|ProjectManager|projectManager|Project Manager" packages tools tests`
  - `grep -rnE 'idSchema\("prj"\)' packages`는 `packages/protocol/projects/`와 project 창 쪽(shell)뿐이다. `Id<"prj">`·`prj_`가 domain을 뜻하는 곳이 없다: `grep -rn "prj_" packages/core packages/protocol/lophn-agent packages/protocol/apps`가 0줄이다.
  - `grep -rnE 'kind: "project"' packages/core packages/protocol packages/coding-agent packages/sdk`가 0줄이다(Place는 `domain`).
  - 옛 data 경로: `grep -rnE '"projects"|/projects/|projectsDataArea' packages tools tests --include=*.ts --include=*.tsx`는 새 project 등록(`resource: "projects"`)과 project 창 쪽만 남는다. 줄마다 뜻을 보고한다.
  - `app_api` 계열: `grep -rnE "app_api|appApi|app-api|app_apis|AppApi|APP_API|app__|context_binding" packages tools tests`
  - 연결 표 흔적: `grep -rnE "domain_projects|link_project|linkProject" packages tools tests`
  - 중복 정의: `grep -rnE "domainList|domainGet" packages`는 `domainApi` 정의 안뿐이다.
  - `grep -rn "TODO\|FIXME" packages tools`는 이 계획 이전 것 말고 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 못 지운 것과 이유
- 정한 것: 뜻이 애매해 남긴 줄과 이유
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 이 계획 전체에 남은 알려진 미완(`DOMAIN.md`를 사람이 고치는 화면 없음, eval material 재작성 전까지 eval 불가 등)을 모아 적는다.
