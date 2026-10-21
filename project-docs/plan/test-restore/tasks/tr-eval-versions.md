# tr-eval-versions

eval의 version 측정을 지금 tool과 skill에 맞춘다. `TOOL_FILES`에서 ticket·problems·guide를 빼고 preview·runtime·settings를 더하고, `guide` version 종류를 지우고(guide는 내장 skill `guide-*`다), variant texts의 지운 `guides.ts` import를 걷고, 지운 tool과 guide의 registry json을 지금 정의에 맞춘다.

- 단위: eval (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/versions/{files,components,registry,versions_test}.ts`
  - `tests/eval/experiment/spec/types.ts`
  - `tests/eval/experiment/gate/e2e.ts`
  - `tests/eval/experiment/variant/{texts,variant_test}.ts`
  - `tests/eval/registry/tool`
  - `tests/eval/registry/guide` (지운다)
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것"(eval의 version 목록을 지금 tool과 skill에 맞춘다), `project-docs/plan/test-restore/survey-eval.md`의 0의 5, 1의 `versions/files.ts, components.ts, versions_test.ts`·`registry/*`·`experiment/*` 줄, 7의 6
  - architecture: `project-docs/architecture/eval.md`의 "버전은 hash로 고정한다"(`tool:X`는 X를 정의하는 file 전체로 잰다), "run은 진짜 model이 본 것만 남긴다"(`skill.read`로 연 것), "variant의 core는 그 checkout에서", `project-docs/architecture/agent-definition.md`(guide는 내장 skill `guide-*`)
  - module: `project-docs/module-catalog.yaml`의 `tests`(boundary 없음)
  - 코드(main `85f19080e`의 줄):
    - `packages/core/agent-roles/tool-lists.ts` 89-136(`TOOL_ORDER`, 46개), `packages/core/agent-roles/skills/`(`guide-*` 열, `check-kinds`, `kinds-yaml`, `new-app`, `repair-app`), `packages/core/lophn-agent/tools/bundles/skill.ts` 11-13(`skill.read` 입력 `{ name, path? }`), `packages/protocol/lophn-agent/tool-catalog.ts` 13(wire 이름은 `.`→`_`)
    - `tests/eval/versions/files.ts` 13-31(`TOOL_FILES`), 33-45(`FileGroup`), 52-62(`GUIDE`, `SKILL`, `RUNTIME`), 66-95(`classifyPath`), 149-167(`toolFileTable`. `defineTool({ name: "…" })`을 읽고 없는 file은 건너뛴다)
    - `tests/eval/versions/components.ts` 3-6(`guides.ts` import. file이 없어 이 module과 그것을 import하는 test가 지금 뜨지 않는다), 43-46(`SKILL_ROOTS`), 151-153(`measureGuide`), 166-171(`measureCli`. 고치지 않는다), 181-230(`currentVersions`), 232-249(`openedOf`), 326-334
    - `tests/eval/versions/registry.ts` 4-18(`VariantTexts`, `Deps`), 25-34(`TEXT_KINDS`)
    - `tests/eval/versions/versions_test.ts` 56-57, 82, 92-138, 140-182, 184-188, 190-217
    - `tests/eval/experiment/spec/types.ts` 5-14(`EXPERIMENT_KINDS`), `tests/eval/experiment/gate/e2e.ts` 78·115(`TEXT_GROUPS`), `tests/eval/experiment/variant/texts.ts` 8-20(`SCRIPT`), `tests/eval/experiment/variant/variant_test.ts` 17
    - 쓰는 쪽(고치지 않는다): `tests/eval/versions/mod.ts`(`measureCli`, `openedOf`, `TOOL_FILES`, `VariantTexts` 등을 다시 내보낸다), `tests/eval/runner/trial.ts` 29(`measureCli`, `resolveVersion`), `tests/eval/experiment/variant/mod.ts` 75-84(`texts`), `tests/eval/experiment/overfit/load.ts`·`tests/eval/scorecard/diff.ts`(`TEXT_KINDS`), `tests/eval/experiment/spec/parse.ts` 67(`EXPERIMENT_KINDS`)
- 계약:
  - 쓰는 것: `packages/core/apps/agent-tools/{app,package,release,preview,runtime,visual}.ts`, `packages/core/agent-roles/tools/settings.ts`, `packages/core/agent-roles/skills`(guide는 `guide-<topic>` skill), tr-eval-prune-coding이 `tests/eval/types.ts`의 `VersionKind`에서 `"guide"`를 뺀다
    - 선행이 없으므로 그 task의 결과에 기대지 않는다. 이 task가 `"guide"`를 쓰지 않게만 하면 `VersionKind`에 `"guide"`가 있든 없든 compile된다.
  - 내놓는 것:
    - `currentVersions`가 지금 core의 모든 agent tool(`app.status`, `app.logs`, `app.invocations`, `preview.*`, `settings.get` 포함)을 재고 startup에서 던지지 않는다.
    - guide 글은 `skill:guide-<topic>`으로 잰다. `VariantTexts`는 `{ role_prompts }`뿐이다(`guides` 없음).
    - `versions/mod.ts`가 내보내는 이름(`measureCli`, `openedOf`, `resolveVersion` 등)은 그대로다. `openedOf`는 `{ skills: string[] }`를 돌려준다.

## 할 일

brief는 main `85f19080e` 기준이다. 같은 wave의 tr-eval-prune-coding(`tests/eval/types.ts`, `runner/**`, `restore/**`, `experiment/{parallel,overfit,assembly}`, `experiment/variant/prepare.ts`)과 tr-eval-prune-checks(`tests/eval/checks/**`, 시나리오)의 file은 고치지 않는다. `tests/eval/versions/mod.ts`도 고치지 않는다(그 task의 `runner/trial.ts`가 merge 전까지 `measureCli`를 import한다).

1. `tests/eval/versions/files.ts`
   - `TOOL_FILES`(13-31)를 지금 `defineTool`을 가진 file 열일곱으로 둔다: `packages/core/apps/agent-tools/{app,package,release,preview,runtime,visual}.ts`, `packages/core/domains/agent-tools.ts`, `packages/core/lophn-agent/tools/bundles/{skill,file,call,web,ask,shell}.ts`, `packages/core/agent-roles/tools/{operator,kind,instructions,settings}.ts`. 빠지는 것: `apps/agent-tools/ticket.ts`, `problems/agent-tools.ts`, `agent-roles/tools/guide.ts`(셋 다 없는 file). `grep -rl "defineTool({" packages --include=*.ts | grep -v _test`와 같은 목록인지 본다.
   - `FileGroup`(41)에서 `"guide"`를, `GUIDE`(52)와 `classifyPath`의 guide 갈래(80-82)를 지운다.
   - `SKILL`(53-54)을 `/^packages\/core\/agent-roles\/skills\/([^/]+)\//`로 둔다(`packages/coding-agent/guides`는 없다).
   - `RUNTIME`(55-62)에서 `packages/core/problems/agent-tools.ts`를 지운다.
2. `tests/eval/versions/components.ts`
   - `guides.ts` import(3-6), `measureGuide`(151-153), `currentVersions`의 guide 고리(199-204), `seenComponents`의 `opened.guides` 고리(331-334)를 지운다.
   - `SKILL_ROOTS`(43-46)는 `packages/core/agent-roles/skills` 하나다.
   - `openedOf`(232-249)는 `skill.read`만 보고 `{ skills }`를 돌려준다. `guide-*` skill을 `skill.read`로 열면 `measureSkill`이 `skill:guide-<topic>`으로 잰다(지금 길 그대로).
   - `measureCli`(166-171)는 그대로 둔다(정한 것).
3. `tests/eval/versions/registry.ts`: `VariantTexts`(5-8)를 `{ role_prompts: Record<string, string> }`로, 4·12 주석에서 guide를 빼고, `TEXT_KINDS`(29)에서 `"guide"`를 지운다. `"cli"`는 남긴다.
4. `tests/eval/experiment/spec/types.ts`의 `EXPERIMENT_KINDS`(9)와 `tests/eval/experiment/gate/e2e.ts`의 `TEXT_GROUPS`(78)에서 `"guide"`를 지운다.
5. `tests/eval/experiment/variant/texts.ts`: `SCRIPT`에서 `guides.ts` import(10)와 guide 고리(17-18)를 지우고 `console.log(JSON.stringify({ role_prompts }))`로 둔다. `tests/eval/experiment/variant/variant_test.ts` 17의 stdout은 `'{"role_prompts":{}}'`.
6. `tests/eval/versions/versions_test.ts`(지금 `components.ts`의 import 때문에 뜨지 않는다)
   - fixture의 둘째 tool을 지금 있는 tool로 바꾼다: `TOOL_GUIDE`(57)를 `TOOL_SETTINGS = "packages/core/agent-roles/tools/settings.ts"`와 `defineTool({ name: "settings.get" })`로, 요청 tools(82)의 `guide_read`를 `settings_get`으로, 기대(112, 129)의 `tool:guide.read@1`을 `tool:settings.get@1`로(정렬 순서를 맞춘다). 98, 195도 같다. 204의 `guides: {}`를 지운다.
   - `classifyPath` 표(140-182): guide 두 줄(145-146), coding-agent skill 줄(149-152), `problems/agent-tools.ts` 줄(160), `tools/guide.ts` 줄(161)을 지우고 `${R}/skills/guide-rewind/SKILL.md` → `skill:guide-rewind`, `${R}/tools/settings.ts` → `tool`, `packages/core/apps/agent-tools/preview.ts` → `tool`을 더한다.
   - "role이 받는 agent tool은 모두 TOOL_FILES의 source file에 정의돼 있다"(184-188)는 그대로다. 이 task의 결과(startup에서 던지지 않는다)를 보는 test다.
7. registry
   - `git rm -r tests/eval/registry/guide`.
   - `tests/eval/registry/tool`에서 지금 `TOOL_ORDER`에 없는 이름의 file을 지운다: `ticket.{cancel,create,get,list,update,verify}.json`, `guide.read.json`, `problem.{body,get,list,set_state}.json`, `app.app_api.json`(정한 것).
   - 새 tool(`preview.*`, `app.status`, `app.logs`, `app.invocations`, `release.prepare`, `release.activate`)의 entry는 손으로 만들지 않는다. 첫 진짜 run에서 `resolveVersion`이 붙인다.
   - `tests/eval/registry/skill/{lophn-build-app,lophn-repair}.json`, `skill-description/`의 같은 이름(없어진 coding skill)은 소유 밖이라 둔다.

정한 것:
- **`registry/tool`은 `TOOL_ORDER`에 없는 이름을 모두 지운다.** README가 든 `ticket.*`, `guide.read`와 같은 이유(지금 정의에 없는 tool)로 `problem.*`(problem-remove), `app.app_api`도 지운다. registry는 n → hash 표라 지워도 지금 tool의 n은 바뀌지 않는다. 옛 run 요약의 `tool:ticket.create@n`은 scorecard에서 지금 판이 없어 낡음 사유가 되지 않는다(`tests/eval/scorecard/pick.ts` 84-87).
- **`measureCli`와 `"cli"` 종류는 남긴다.** tr-eval-prune-coding의 `runner/trial.ts`가 merge 전까지 `measureCli`를 import한다. 이 task가 지우면 merge 순서에 따라 compile이 깨진다. 그 task가 쓰지 않게 된 뒤의 정리는 보고로 넘긴다.
- **`openedOf`의 이름과 `versions/mod.ts`는 그대로 둔다.** 돌려주는 꼴만 `{ skills }`로 줄인다(`mod.ts`는 소유 밖).

## 끝남

- `deno task check`가 통과한다. `tests/eval`은 아직 `NOT_CHECKED`라 fmt·lint만 이 file들을 본다.
- test: `deno test --no-check --allow-all tests/eval/versions tests/eval/experiment/variant tests/eval/experiment/gate tests/eval/experiment/spec tests/eval/experiment/overfit tests/eval/scorecard`가 통과한다.
- startup에서 던지지 않는다: 아래가 숫자 둘(전체 개수, `skill:guide-` 개수 10)을 찍고 `guide:` key가 없다. 진짜 registry에 쓰지 않게 임시 폴더를 준다.
  ```sh
  deno eval "import { currentVersions } from './tests/eval/versions/mod.ts';
  const dir = await Deno.makeTempDir();
  const v = await currentVersions({ registryDir: dir });
  const keys = [...v.keys()];
  console.log(keys.length, keys.filter((k) => k.startsWith('skill:guide-')).length, keys.filter((k) => k.startsWith('guide:')));
  await Deno.remove(dir, { recursive: true });"
  ```
- type check: 아래 명령이 찍는 오류 자리는 `tests/eval/types.ts` 14-15(`IntentKind`·`RequestChoice`, tr-eval-human)뿐이다.
  ```sh
  deno check $(git ls-files 'tests/eval/versions/*.ts' 'tests/eval/experiment/spec/*.ts' 'tests/eval/experiment/gate/*.ts' 'tests/eval/experiment/variant/*.ts') 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g' | grep -oE "at (file://)?[^ ]+:[0-9]+:[0-9]+" \
    | sed "s#at ##; s#file://$PWD/##" | sed -E 's/:[0-9]+$//' | sort -u
  ```
- 위험 test: 새로 쓰지 않는다. 있는 "role이 받는 agent tool은 모두 TOOL_FILES의 source file에 정의돼 있다"(`tests/eval/versions/versions_test.ts`)가 이 task의 결과를 본다. 지금은 `components.ts`가 뜨지 않아 돌지 못한다.
- 남지 않음:
  - `grep -rnE "guides?\.ts|guideText|guideTopics|measureGuide|\"guide\"|guide_read|guide\.read|coding-agent/guides|problems/agent-tools|agent-tools/ticket" tests/eval/versions tests/eval/experiment/spec tests/eval/experiment/gate tests/eval/experiment/variant/texts.ts tests/eval/experiment/variant/variant_test.ts`가 0줄이다.
  - `ls tests/eval/registry/guide`가 없다고 답하고, `ls tests/eval/registry/tool | grep -E "^(ticket|problem|guide)\.|app_api"`가 0줄이다.
  - `git status --short tests/eval/registry`에 지운 file만 있다(`currentVersions`나 test가 진짜 registry에 쓰지 않았다).
- 진짜 model과 eval은 돌리지 않는다(`deno task eval`, `eval:gate`, `eval:experiment`. 진짜 provider를 부르거나 registry에 쓴다).

## 보고

- 바꾼 file
- 통과한 check(`deno task check`, test 결과, `currentVersions` 명령의 출력, type check 명령의 출력 전부)
- 등록할 것: 없을 것이다. 있으면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `measureCli`는 tr-eval-prune-coding이 merge되면 쓰는 곳이 없어진다. 지우지 않고 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 문서(lead가 끝에 고친다): `project-docs/architecture/eval.md`에서 guide 종류와 `packages/coding-agent/guides/skills`를 말하는 곳. 고칠 줄을 file:줄로 적는다.
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
