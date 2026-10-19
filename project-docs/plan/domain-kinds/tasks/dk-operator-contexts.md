# dk-operator-contexts

Operator 정의의 `contexts` 칸과 그 주변을 모두 지운다: 정의 schema, 저장 검사(`missing_reference`/`archived_reference`), resolve된 agent의 `contexts`, 목록의 `counts.contexts`, role 표의 `contextsOf`, place의 active context 조회 port, shell의 agent 편집 form과 카드 글. 이제 Operator는 그 project의 kind를 다 받으므로(README "정한 것") 고를 것이 없다. 같은 file에 있는, 쓰이지 않는 `app_reads` 칸(agent 정의 schema)도 roadmap "정한 것 (agent, 초안)"대로 같이 지운다. (prompt는 `dk-prompt-place`가 이미 `agent.contexts`를 읽지 않는다.)

이 task는 `domain-place`(Operator skill 고르기, `agent-values.ts`·`operators.ts`·`agents/*`)와 같은 file을 고친다. `contexts` 줄과 그 주변만 고치고 다른 줄은 건드리지 않는다.

- 단위: operator-contexts (wave 3)
- 선행: dk-delete-eval
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/agent-values.ts`
  - `packages/protocol/lophn-agent/operators.ts`
  - `packages/core/lophn-agent/agents/`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/lophn-agent/session/compactor.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/agent-roles/agents/role-table.ts`
  - `packages/core/agent-roles/agents/role-table_test.ts`
  - `packages/core/agent-roles/tools/operator.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-team.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/shell/renderer/workspace/agents/`
  - `packages/shell/renderer/workspace/kinds/agents.tsx`
  - `tools/wireframes/pages/screens/agents-tab.tsx`
  - `tools/wireframes/pages/screens/agent-settings.tsx`
  - `tools/wireframes/pages/screens/agent-pages.tsx`
  - `tools/wireframes/mock/agents-data.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`("정한 것"의 Operator), roadmap `project-docs/products/roadmap/domain.md`의 "context에서 무엇이 어디로 가나"
  - architecture: `project-docs/architecture/agent-definition.md`(Operator 정의, resolve, `missing_reference`), `project-docs/architecture/layers.md`
  - 이 task가 고치는 곳(확인된 위치. 줄 번호는 지금 기준이다):
    - protocol: `agent-values.ts`의 `app_reads`: `appReadFields`·`appReadSchema`·`appReadOutputSchema`·`AppRead`(≈:98~100), `appReadKey`·`appReadsSchema`·`appReadsOutputSchema`(≈:141~153), `frontmatterFields.app_reads`·`frontmatterOutputFields.app_reads`(≈:185,196)와 주석(≈:178). 쓰는 곳은 이 file뿐이다(`rg -n "app_reads|appReads" packages tests tools`로 확인). `agent-values.ts`의 `contextsSchema`(≈:137), `frontmatterFields.contexts`(≈:184)·`frontmatterOutputFields.contexts`(≈:195), `agentCountsSchema.contexts`(≈:232)와 그 주석, 필드 경로 주석의 `contexts.1`; `operators.ts`의 `definitionKeys.contexts`(≈:22)와 위 주석
    - core agents: `definition-file.ts`(`blocked`의 `raw.contexts`·`_blocked` 분리 ≈:158~165, `EMPTY_DEFAULT_LISTS`의 `"contexts"` ≈:192), `validate.ts`(≈:85~100의 context 참조 검사 블록), `reads.ts`(`rowOf`: `contexts`·`active`·`counts.contexts`), `resolve.ts`(`RESOLVED_FIELDS`의 `"contexts"`, `ResolvedAgent.contexts`, `environment.active_contexts`, `roles.contextsOf` 호출, `sources.contexts`), `role-table.ts`(AgentRoleTable port의 `contextsOf`), `layers.ts`(`input.activeContexts`, `active_contexts`), `ports.ts`(`AgentLookups.contextStatus/contextProject/activeContexts`, `PlaceLookups.contextStatus/contextProjectOf/activeContextIds`), 같은 폴더의 `*_test.ts`(`commands_test.ts:19`, `reads_test.ts:26`, `resolve_test.ts:59` 등 `contextStatus`·`active_contexts` fixture)
    - core 밖: `lophn-agent/register.ts:431~445`(lookups 조립), `agent-roles/agents/role-table.ts`(`contextsOf` 구현과 test), `agent-roles/tools/operator.ts:101`(description의 "contexts"), `main/daemon/wiring/lophn-agent-team.ts`(`contextStatus`·`contextProjectOf`·`activeContextIds` 꽂기와 `contextStatusOf` import), `main/agent-runtime/product-driver.ts`(≈:37,153,189의 `activeContexts: (place) => activeContextsOf(…)`와 import), `lophn-agent/session/compactor.ts`(≈:99,167)와 `lophn-agent/run-loop/prepare.ts`(≈:158,633)의 `activeContexts` deps
    - shell: `renderer/workspace/kinds/agents.tsx`(≈:76의 `contexts={(host.contexts?.list ?? []).map(…)}` prop 전달만 지운다. ≈:8의 `TAB_KEY` import는 건드리지 않는다 — `dk-shell-workspace`가 고친다), `renderer/workspace/agents/`의 `ContextOption`(`editor/definition-form.tsx:31`), form의 contexts 항목(≈:85~140, :365~375), `editor/agent-editor.tsx`(`contexts` prop ≈:58,355), `agents-page.tsx`(≈:24,84), `agents-tab.tsx`(`countsText`: `contexts`), `fake-source.ts:325`, `fake-data.ts`(`contexts: [EVAL]`, `import … from "../contexts/fake-source.ts"`, 가짜 skill 두 줄 `context-init`·`context-update`(≈:281~290)과 "contexts and searches" 문구)
    - wireframes: `agents-tab.tsx`의 `PROJECT_CONTEXTS`, `agent-settings.tsx:30`의 설명 문구, `mock/agents-data.ts`
  - **지우지 않는 것**: PM의 profile icon 이름 `"contexts"`(`core/agent-roles/agents/role-table.ts:15`, `workspace/agents/fake-source.ts:114`, `editor/parts.tsx:188`)는 icon id일 뿐이다. 그대로 둔다(화면 icon 이름을 바꾸면 사람이 저장한 profile이 깨진다).
  - 테스트 규칙: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: Operator 정의·resolve된 agent·목록 행에 `contexts`가 없다. `AgentLookups`·`PlaceLookups`에서 context 조회가 사라진다.

## 할 일

1. 위 위치를 지우고 type을 따라 고친다. `deno task check`가 오류로 남은 곳을 알려 준다. 지운 이름을 `rg -n "contexts|app_reads|appReads|contextStatus|contextProject|activeContexts|active_contexts|contextsOf|missing_reference|archived_reference" packages/protocol/lophn-agent packages/core/lophn-agent packages/core/agent-roles packages/core/main/daemon/wiring packages/shell/renderer/workspace/agents tools/wireframes`로 모두 확인한다. `missing_reference`·`archived_reference`는 다른 칸이 쓰면 남긴다(지금 `contexts`만 쓰는지 확인).
2. 저장된 Operator 정의 file에 `contexts:`가 남아 있으면 strict schema에서 `unknown_field`가 된다. 호환 장치를 만들지 않는다(AGENTS.md "호환성"): 개발 data는 지운다. 보고에 적는다.
3. shell: form에서 contexts 항목을 지우고, 카드 글에서 contexts 수를 뺀다. 글(wording key `project-workspace.*agent-editor-*context*`, `agent-counts-operator`)은 이 task가 지우지 않는다 — `dk-delete-wording`이 정리한다. 이 task는 그 key를 쓰는 코드만 없앤다. 단 `agent-counts-operator`는 `contexts` 매개변수가 사라지므로 **글을 이 task가 고친다**(`{skills…} · {mcp} MCP` 꼴. `agent-counts-built-in`과 같아지면 둘을 하나로 합치고 호출 쪽을 맞춘다. wording catalog 편집 규칙: 손으로 고치고 `deno task wording`으로 placeholders를 만든다).
4. wireframes의 세 file과 `mock/agents-data.ts`에서 contexts를 쓰는 곳을 같이 고친다. `tools/wireframes/mock/contexts/`는 건드리지 않는다(`dk-wireframes`가 지운다. 이 task가 그 import를 모두 끊어 두어야 한다 — 그래서 `dk-wireframes`가 이 task 뒤다).

## 정한 것

- Operator의 `contexts`는 지우고 대체물을 두지 않는다. 이유: 같은 project의 모든 kind를 받는다(README). 일을 좁히는 것은 `domain-place`의 skill 고르기다.
- `AgentCounts`는 `{ skills, mcp }`가 된다.

## 끝남

- `deno task check`가 통과한다(wireframes 포함).
- 위험 test: 없음. 단 `core/agent-roles/agents/role-table_test.ts`와 `core/lophn-agent/agents/*_test.ts`에서 `contexts` 줄만 지우고 나머지 판정(PM만 role 도구를 받는 규칙 등)은 그대로 둔다.
- 남지 않음: 위 `rg` 명령이 0줄이다(PM profile icon 이름 `"contexts"` 세 곳 제외).
- core 기동: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `activeContextsOf`(`packages/core/agent-roles/place/active-contexts.ts`)가 쓰이지 않게 되면 적는다(`dk-delete-context-tools`가 지운다)
- 정한 것
- 넘길 줄: `domain-place`가 같이 고치는 file의 줄 위치
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 저장된 옛 Operator 정의(`contexts:` 있음)는 읽히지 않는다.
