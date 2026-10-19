# de-final

계획이 끝났는지 코드로 확인하고 남은 것을 지운다. 영역 task들이 "남이 쓰는 export라 지우지 않은 것"(옛 protocol 값, 옛 helper, 옛 Draft, 안 쓰는 wording key)을 지우고, 계획 전체의 "남지 않음" grep을 돌려 남은 줄을 고치고, `check:full`(e2e type 포함)을 통과시킨다. 새 동작은 만들지 않는다.

- 단위: final (wave 5)
- 선행: de-shell-domain-list, de-shell-operator-domains, de-shell-artifact-domain
- 소유(이 task만 고친다):
  - `packages/`
  - `tools/`
  - `tests/`
- 읽을 것:
  - 계획: `project-docs/plan/domain-entity/README.md`(전체), 각 task의 보고에 적힌 "안 쓰게 된 export"와 "넘길 줄"(lead가 이 task를 띄울 때 목록으로 prompt에 붙인다)
  - skill: `.claude/skills/write-test/SKILL.md`(test 지우기·합치기), `.claude/skills/wording/SKILL.md`
  - architecture: `project-docs/architecture/layers.md`(`tools/check-deps.ts`가 보는 규칙)
- 계약:
  - 쓰는 것: 앞 task들이 낸 이름
  - 내놓는 것: 아래 "남지 않음"을 모두 만족하는 저장소, `deno task check:full` 통과

## 할 일

1. 지운다(남이 쓰던 것이라 영역 task가 남긴 export):
   - `packages/protocol/projects/artifact.ts`와 `packages/protocol/projects/mod.ts`의 그 export 줄, `packages/protocol/projects/values.ts`의 `artifactNameSchema`(이름 규칙은 `packages/protocol/domains/values.ts`에 있다)
   - `packages/protocol/projects/kinds-file.ts`의 `kindsFilePath`와 `packages/core/projects/lookups.ts`의 `activeProjectRoots`
   - `packages/core/lophn-agent/extensions/project-settings.ts`의 `ProjectLayer.skillsFolder`와 `packages/core/agent-roles/place/project-layer.ts`의 구현
   - 앞 task의 보고에 "안 쓰게 된 export"로 적힌 나머지(`grep -rn "<이름>" packages`로 쓰는 곳이 없는 것만 지운다)
2. 안 쓰는 Draft와 wording을 지운다: `tools/wireframes/drafts/domain/`, `tools/wireframes/drafts/index.tsx`의 domain 항목, 쓰는 곳이 없는 `tools/wireframes/mock/domain/` 항목, 쓰이지 않는 wording key(`deno task wording`이 알려 준다. `domain`·`artifact`·`agents` 영역). gallery에서 사람이 고르지 않은 쪽 page가 남아 있으면 지운다.
3. 계획 전체 "남지 않음"을 돌려 남은 줄을 고친다(아래).
4. test 정리: 없어진 모양을 지키던 test(옛 project 기준 usage·publish·kind 사례), 같은 일을 보는 중복 test를 지운다. 새 위험 test가 있는지 확인한다: 아래 "위험 test" 목록의 test가 이름으로 있고 통과한다. 없는 것이 있으면 이 task가 쓴다(하나씩, `write-test` 기준으로).
5. `tools/check-deps.ts`: 이름이 바뀌어 낡은 `HARNESS_LEFTOVERS` 항목을 맞추고 check가 "빼라"고 알리는 항목을 뺀다.
6. 주석 쓸어내기: `grep -rn "Project Manager" packages --include=*.ts --include=*.tsx`에서 앱 일(ticket, release, problem, package)을 PM이 한다고 쓴 주석·오류 문구를 App Engineer로, "project 하나에 앱 하나", "project의 앱" 같은 말을 지운다.
7. `deno task check:full`을 돌려 통과시킨다. e2e는 돌리지 않는다(type만).

## 끝남

- `deno task check:full`이 통과한다.
- 위험 test(이름으로 있고 통과해야 하는 것):
  - domain: 앱의 마지막 domain 보관 거절(`packages/core/domains/commands_test.ts`)
  - Operator 좁히기: `DOMAIN.md`만 읽음(`instructions/read_test.ts`), skill(`agents/resolve_test.ts`), kind·artifact 글(`place/place-info_test.ts`), tool(`packages/core/lophn-agent/tools/app-public_test.ts`), grant 화면(`grants-model_test.ts`), file 범위(`place/place-folders_test.ts`)
  - file 범위: PM은 project 폴더만·App Engineer는 앱 source만(`place/place-folders_test.ts`)
  - 다른 domain의 비공개 tool이 안 보임: `packages/core/lophn-agent/tools/app-public_test.ts`, `packages/shell/renderer/workspace/agents/editor/grants-model_test.ts`
- 남지 않음(모두 0줄. `project-docs/`와 `tests/eval/{registry,runs,experiments,materials}`는 뺀다):
  - `grep -rn "app\.project\|appProjectOf\|appOfProject\|appProjectLookup" packages tests tools`
  - `grep -rn "/app/data\|/app/bundles\|/app/staging\|/app/preview\|/app/source" packages tests tools` (옛 `projects/<prj>/app/` 저장 자리)
  - `grep -rn "kindsFilePath\|protocol/projects/artifact\|artifactsFolder(" packages tests tools`, `grep -rn "project_problems\|sync_project\|list_project" packages tests tools` (project 기준 kinds·artifact·위반 자리)
  - `grep -rniE "app[-_ ]?api" packages tests/support tests/e2e tests/eval/checks tests/eval/scenarios tools .claude`
  - `grep -rn "app__" packages tests/support tests/e2e tests/eval/checks tests/eval/scenarios tools`
  - `grep -rn "context_binding" packages tests/eval/checks`
  - 걸러도 되는 이름: `project_manager`, `Project Manager`(project 일), `project`(project 자체), `projects/<prj>/`(LOPHN.md·agent 정의), `domain` 일반어

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
