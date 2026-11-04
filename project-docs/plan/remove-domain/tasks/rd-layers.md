# rd-layers

agent가 domain을 보는 층을 지운다: `DOMAIN.md` 지침 층, domain skill 층(그릇 자리 `place-data` 층으로), 정의의 `domains` 칸, place 정보의 Domains 절과 home 지도의 domain 줄. 파일 옮기기와 정의 칸 지우기를 migration한다.

- 단위: layers (wave 4)
- 선행: rd-artifacts.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{agent-values,agent-definitions,instructions,skill-settings,tool-catalog,mod}.ts`
  - `packages/core/lophn-agent/{agents,instructions,extensions,prompt-assembly,run-loop}/**`
  - `packages/core/agent-places/**`
  - `packages/core/main/agent-runtime/product-driver.ts`, `packages/core/main/daemon/{place-folders-glue,place-folders-glue_test}.ts`, `packages/core/main/daemon/wiring/{lophn-agent-team,instructions-registration,skills-off}.ts`
  - `packages/cli/commands/agent.ts`
  - `packages/shell/main/editor/instructions.ts`, `packages/shell/ipc/instructions.ts`
  - `packages/shell/renderer/workspace/agents/**`, `packages/shell/renderer/desktop/settings/agents/**`, `packages/design/i18n/catalog/agents.ts`
  - `tests/support/loop/harness.ts`, `tests/eval/registry/` 중 instruction·skill 항목, `tests/eval/experiment/assembly/prefix_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(prompt 층, skill 층), `project-docs/architecture/place-session.md`
  - 선례: `packages/core/main/daemon/wiring/skills-off.ts`(`agents/*.md` frontmatter 다시 쓰기)
  - 제품 결정: 계획 README 정한 것 4~7
- 계약:
  - 쓰는 것: `placeDataFolder`, `domains` 표(mapping)
  - 내놓는 것: skill 층 `place-data`(`SKILL_SOURCES`에서 `domain` 자리), 지침 층은 global, project, agent

## 할 일

1. 지침: domain 층(`instructions/{turn,files,model}.ts`, `DOMAIN_TEXT_BUDGET`, `mayReadDomain`, `INSTRUCTION_LAYERS`, `turn-prompt.ts` label)을 지운다. 지침 편집기(shell `editor/instructions.ts`, IPC, renderer `instructions-editor`)에서 domain 층을 뺀다.
2. skill: 층 `domain`을 `place-data`로 바꾼다. 자리는 `<그릇 자리>/skills/`(`extensions/{skills,skill-folders,registry,project-settings}.ts`, `agent-places/place/project-layer.ts`). 폴더 없는 project도 이 층을 받는다. 그릇 session의 file 범위에 `skills/`를 연다.
3. 정의: `domains` 칸(`agent-values.ts`, `agent-definitions.ts`, `agents/*`, `definition-file.ts` `EMPTY_DEFAULT_LISTS`, CLI `agent.ts`, renderer definition-form)을 지운다.
4. place 정보: `place-info.ts`의 Domains 절(`domainLines`), home 지도(`mapLines`)는 앱과 그 public command, "Used by"는 앱·project로. `place-data.ts`, `run-loop/{prepare,runtime-access}.ts`의 domain 목록을 지운다.
5. 글: `agent-places/prompts/{app,home,project}.md`와 skill md를 고친다. 내장 skill `make-domain`, `check-domains`는 지운다(`skill-settings.ts` 목록과 eval registry도).
6. data step(`skills-off` wiring에 더한다): `domains/<dom>/skills/*`를 `<그릇 자리>/skills/`로(이름이 겹치면 rd-artifacts와 같은 규칙), `DOMAIN.md`·`kinds.yaml`을 `<그릇 자리>/old-domains/<domain 이름>/`로 옮긴다. `agents/*.md`의 `domains` 칸을 지운다(strict schema라 남으면 정의를 못 읽는다).
7. `skills-off-step.ts`는 이미 적용된 step이다. `protocol/domains/paths` import는 `rd-domains`가 정리한다(여기서 고치면 `rd-domains`에 적는다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "`domains` 칸이 차 있던 정의 file이 step 뒤에 읽힌다"
  - "skill과 `DOMAIN.md` 옮기기가 file을 잃지 않는다"
- 남지 않음: `grep -rn "DOMAIN.md\|domainSkillsFolder\|\"domain\"" packages/core/lophn-agent packages/core/agent-places packages/protocol/lophn-agent`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.

## lead가 더함

- `rd-kinds`가 내장 skill `check-domains`를 이미 지웠다(`skill-settings.ts` 목록 포함). 남은 것은 `make-domain`이다. eval registry의 옛 version 기록은 남긴다.
- `rd-kinds`가 place 지침과 `make-domain`·`write-artifact` SKILL.md에서 kind 글을 이미 뺐다.
