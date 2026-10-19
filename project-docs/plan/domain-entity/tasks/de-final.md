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

## lead가 더함

앞 task 보고에서 모은 것이다. 위 "할 일"과 같이 한다.

- **bug 고치기(planner 권고):** `project-docs/issues/agent-definition.md`의 "같은 이름 skill은 agent의 domain을 거르기 전에 하나로 합쳐져 사라진다". 추천안대로 고친다. domain 층 후보는 domain마다 따로 두고, agent의 domain으로 거른 뒤에 이름을 합친다(`packages/core/lophn-agent/extensions/skills.ts`의 `discoverSkills`·`mergeSkillLayers`와 그 결과를 쓰는 `register.ts`, `skill-read.ts`, `/` 메뉴). 위험 test 하나: "전역 skill `x`와 domain A의 skill `x`가 있을 때 A를 고르지 않은 Operator는 전역 `x`를 받고, A와 B에 `x`가 있을 때 B만 고른 Operator는 B의 `x`를 받는다". 고친 뒤 lead가 이슈를 닫는다(이 task는 project-docs를 고치지 않는다).
- **test 앱 blueprint:** `tests/support/app/patch-*.ts`와 `tests/e2e/{app-call,app-restart,app-data-rewind}_test.ts`의 inline blueprint에서 tool마다 `domain`(그 test 앱의 slug)이 있는지 보고 없으면 더한다. e2e는 돌리지 않는다.
- **안 쓰게 된 것 지우기**
  - `ReactionAction`의 `{kind: "project-manager"}`. 세 toast handler(`packages/shell/renderer/app-frame/toast-handler.ts`, `packages/shell/renderer/workspace/reactions/toast-handler.ts`, `packages/shell/renderer/desktop/main.tsx`)가 아직 switch한다.
  - `packages/core/agent-roles/credentials.ts`의 `PLACE_READS`에 남은 `packagesUsage`(lophn 지도가 더 읽지 않는다. 다른 role이 쓰지 않으면 뺀다).
- **옛 말 고치기**
  - `public` 설명의 "다른 project에 보이는지": `packages/sdk/blueprint/guide.md`, `packages/protocol/apps/blueprint/{types,read}.ts` 주석 → "다른 domain에".
  - `new-app` command 설명 "Start a new app in this project": `packages/core/agent-roles/commands.ts`와 `packages/shell/renderer/conversation/agent-tab-fake-commands.ts`.
  - `packages/core/agent-roles/roles/lophn/prompt.md`(20째 줄 근처) "which other projects use its public tools" → domains.
  - `packages/shell/renderer/palette/search.ts`(22째 줄 근처)가 project place만 안다. 앱 place session도 찾게 한다.
  - `tools/wireframes/mock/app-space/coding-terminal.ts`의 `…/projects/prj_…/app/source` 문자열 → `~/.lophn/apps/<app>/source`.
  - place 정보의 "a Operator" → "an Operator".
  - Drafts mock(`tools/wireframes/mock/domain/`)의 "Project Manager" 같은 옛 이름은 Drafts를 지울 때 같이 사라진다.
- **넘기는 것(이 task가 하지 않는다):** `tests/e2e/annotation_test.ts`가 PM을 기대하는 것, eval 자료의 옛 이름은 다음 계획(e2e 다시 쓰기, eval 자료 다시 만들기)의 몫이다. type만 맞춘다.
