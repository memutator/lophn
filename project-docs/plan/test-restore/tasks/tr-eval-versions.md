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
- 계약:
  - 쓰는 것: `packages/core/apps/agent-tools/{app,package,release,preview,runtime,visual}.ts`, `packages/core/agent-roles/tools/settings.ts`, `packages/core/agent-roles/skills`(guide는 `guide-<topic>` skill), tr-eval-prune-coding이 `tests/eval/types.ts`의 `VersionKind`에서 `"guide"`를 뺀다
  - 내놓는 것:
    - `currentVersions`가 지금 core의 모든 agent tool(`app.status`, `app.logs`, `app.invocations`, `preview.*`, `settings.get` 포함)을 재고 startup에서 던지지 않는다.
    - guide 글은 `skill:guide-<topic>`으로 잰다. `VariantTexts`는 `{ role_prompts }`뿐이다(`guides` 없음).

## 할 일

`TOOL_FILES`, guide 종류(`measureGuide`, `TEXT_KINDS`, spec·gate의 목록), 없는 `SKILL_ROOTS` root, variant texts를 고치고 지운 tool·guide의 registry json을 정리한다.
