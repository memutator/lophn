# dk-skill

PM이 kind 파일을 바르게 쓰게 하는 내장 skill `kinds-yaml`을 만든다(칸과 짧은 예시). 옛 내장 skill `context-init`·`context-update`를 지우고, context를 말하던 role 지침과 agent용 guide를 kind 말로 고친다. PM이 `bundle.json`의 key 이름을 짐작하던 구멍을 막는 것이 이 task의 일이다(roadmap "정한 것 (agent, 초안)").

코드 이름은 아직 `project_manager`다.

- 단위: skill (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/skills/context-init/`
  - `packages/core/agent-roles/skills/context-update/`
  - `packages/core/agent-roles/skills/kinds-yaml/`
  - `packages/core/agent-roles/roles/project-manager/prompt.md`
  - `packages/core/agent-roles/roles/operator/prompt.md`
  - `packages/core/agent-roles/roles/lophn/prompt.md`
  - `packages/core/agent-roles/roles/lophn/guides/roles-and-grants.md`
  - `packages/core/agent-roles/roles/lophn/guides/features-and-screens.md`
  - `packages/protocol/lophn-agent/skill-settings.ts`
  - `packages/protocol/lophn-agent/commands.ts`
  - `packages/core/lophn-agent/extensions/skills_test.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`("정한 것"), roadmap `project-docs/products/roadmap/domain.md`의 "재료 schema: kind와 item"(예시 yaml과 "누가 무엇을 하나" 표), "정한 것 (agent, 초안)"(Domain Engineer에게 kind 파일 모양을 준다)
  - 지금 skill: `packages/core/agent-roles/skills/context-init/SKILL.md`·`context-update/SKILL.md`(frontmatter `name`·`description`, 영어, 번호 단계 꼴을 본보기로. 내용은 옮기지 않는다), 내장 skill 선언 `packages/protocol/lophn-agent/skill-settings.ts`의 `BUILTIN_SKILLS`(`name`, `role`, `can_disable`, `description`), 그 쓰임 `packages/core/lophn-agent/extensions/skills.ts`(≈:179,:202)
  - 계약(skill이 가르칠 형식의 정본): `packages/protocol/projects/kinds-file.ts`(`kindsFileSchema`, `KIND_FIELD_TYPES`, 규칙 이름 목록), `packages/protocol/projects/kinds-api.ts`(`kindList` 입력, `Violation`)
  - tool: `kind.list`, `kind.check`, `file.outline`(`dk-agent-tools`), `problem.list`의 `project` 입력(`dk-problem-core`), place 정보의 `Kinds file:` 줄(`dk-prompt-place`)
  - 말 규칙: `AGENTS.md` "말"(개발자 영어 단어를 그대로)
- 계약:
  - 쓰는 것: 위 protocol 형식과 tool 이름
  - 내놓는 것: 내장 skill `kinds-yaml`(role `project_manager`, `can_disable: false`)

## 할 일

1. `skills/kinds-yaml/SKILL.md`(영어, frontmatter `name: kinds-yaml`, `description` 한 줄: "Write or change the project's kinds file (kinds.yaml): which documents are items of which kind, and which fields each kind has."):
   - **언제 쓰나**: project에 kind가 아직 없거나 사람이 새 종류를 말했을 때, 위반이 schema 쪽 문제로 보일 때.
   - **단계**: ① 사람의 요청과 project 문서를 file tool로 읽는다(`file.glob`·`file.grep`·`file.read`·`file.outline`). 이미 kind가 있으면 `kind.check`로 지금 상태를 본다. ② 뜻은 사람의 것이다 — 어떤 문서가 한 종류인지, 칸의 이름과 필수 여부, 허용 값은 `ask`로 묻는다(선택지와 이유를 붙인다. 답이 없으면 쓰지 않고 미정으로 보고). ③ **place 정보의 `Kinds file:` 경로**에 `file.write`로 쓴다(그 파일 하나만 쓸 수 있다). release도 draft도 없다 — 저장하면 검사해 바로 쓰인다. ④ 바로 `kind.check`를 불러 결과를 본다: kinds 파일 자체의 오류(`status.errors`)면 고쳐 다시 쓴다(틀린 파일은 앞의 맞던 것이 계속 쓰이고 problem이 열린다). 문서 위반이면 schema가 틀렸는지 문서가 틀렸는지 판단해 설명한다. 사람의 문서는 고치지 않는다. ⑤ `kind.list`로 한 번 조회해 의도한 item이 나오는지 확인한다.
   - **형식 참조**: `kinds` 목록의 kind마다 `name`(`^[a-z][a-z0-9_]*$`), `summary`(한 줄), `files`(project 폴더 기준 glob 목록. 한 파일이 두 kind에 걸리면 안 된다), `key`(칸 하나 또는 `path`·`file`. kind 안에서 유일), `fields`(칸 이름 → 속성). 칸 `type`은 `string number boolean date enum ref`, 속성은 `required unique list values(enum) pattern(string) to(ref가 가리키는 같은 파일의 kind) from: path + capture`. 모든 item에 늘 있는 칸 `path`(project 기준 경로)와 `file`(확장자를 뺀 이름). 값은 md의 frontmatter 또는 `.yaml`·`.json`의 최상위 map에서 읽고, `from: path`는 경로에서 뽑는다(`capture: "receipts/{year}/*.md"`의 `{year}`가 칸 이름과 같다). md 본문은 칸이 아니다. pdf·이미지 같은 파일은 문서 값이 없고 경로에서 뽑은 값만 있다 — 안의 값이 필요하면 사람이 청할 때 옆에 md를 쓴다. series는 따로 없다(번호는 `from: path` 칸, 순서는 `kind.list`의 정렬, 중복은 `unique`, 다음 번호는 `max` + 1).
   - **예시 하나**: roadmap의 세금 예(`receipt`, `vendor`)를 줄여 넣는다. 예시는 **실제로 `kindsFileSchema.parse` + `checkKindsStructure`가 통과하는 것**이어야 한다. 한 번 임시 script(`.dev-data/dk-skill/`, commit하지 않는다)로 확인하고 보고에 적는다.
   - **하지 않는 것**: 문서를 고치지 않는다, 뜻을 정하지 않는다, 코드를 짜지 않는다. relation 따라가기·saved view·rule 목록은 없다(context의 개념을 되살리지 않는다).
2. 옛 skill 디렉터리 `context-init/`·`context-update/`를 지운다. `skill-settings.ts`의 `BUILTIN_SKILLS`를 `kinds-yaml` 하나로 바꾼다(description은 SKILL.md와 같은 한 줄 영어). `commands.ts:25`의 주석("…내장 skill context-init과 겹쳐 뺐다")을 새 이름으로 고치거나 지운다.
3. `skills_test.ts`(≈:53,132~181)의 `context-init`·`context-update` fixture 이름을 `kinds-yaml`로 바꾼다(둘째 내장 fixture가 필요하면 선언 안 된 임시 이름으로). test의 판정은 바꾸지 않는다.
4. `roles/project-manager/prompt.md`를 kind 말로 다시 쓴다(영어): 너는 project의 kind를 맡는다. kind 파일은 lophn의 자리(`Kinds file:` 경로)에 있고 release 없이 저장하면 검사해 바로 쓰인다. 틀리면 앞의 맞던 것이 계속 쓰이고 problem이 열린다. kind 파일을 쓸 때는 skill `kinds-yaml`. 위반(`KindViolationFound`로 session이 열린다)이 오면 `kind.check`와 `problem.list`(project 입력)로 읽고, 고칠 쪽이 schema인지 문서인지 판단해 설명한다 — 문서를 고치지 않는다. 용어의 뜻은 사람이 정한다(`ask`). Operator 만들기(`operator.create`·`operator.update`), 새 project·앱이 필요하면 lophn에게 call, call 규칙, 앱 data 규칙의 기존 문장은 살린다. context·draft·test·submit·glossary 문장은 모두 뺀다.
5. `roles/operator/prompt.md`: "using the contexts and app-apis"를 "using the project's kinds (`kind.list`, `kind.check`) and the app-apis"로, "contexts attached to you"를 "kinds of this project"로, "If a context contract has to change… Project Manager"를 "If a kind (the kinds file) has to change… that project's Project Manager"로. `roles/lophn/prompt.md`: "widen an existing context"를 "add kinds to an existing project", "Do not change a context. That belongs to Project Manager."를 "Do not change a project's kinds. That belongs to Project Manager."로. `guides/roles-and-grants.md`와 `guides/features-and-screens.md`: Project Manager가 맡는 것을 kind 파일로, project window의 설명에서 "Contexts"·"A context tab…"을 빼고 "the project's kinds are listed to the agents; ask Project Manager to create or change them"으로 고친다(화면 설명이 현재 shell과 맞아야 한다 — contexts 탭은 `dk-shell-workspace`가 지운다).

## 정한 것

- skill 이름은 `kinds-yaml`(file 이름과 같아 PM이 무엇을 쓰는 skill인지 안다). 둘이던 skill(init, update)을 하나로 합친다: 판이 없어 처음과 고침이 같은 일이다.
- skill은 program이 파싱하지 않는 지침이다(roadmap "skill"). 형식의 정본은 protocol의 zod schema이고 skill의 예시는 그것과 같아야 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(문서와 선언).
- 남지 않음: `rg -n "context-init|context-update" packages tools tests --glob '!tests/eval/runs/**' --glob '!tests/eval/scorecards/**'`가 0줄이다(`dk-delete-eval`이 지운 eval registry 항목은 그쪽 task가 맡는다). `rg -n -i "context" packages/core/agent-roles/roles packages/core/agent-roles/skills`에서 "context window" 같은 무관한 말과 `opening_context`를 뺀 줄이 0이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: skill의 예시를 어떻게 확인했는지
- 넘길 줄: `shell/renderer/workspace/agents/fake-data.ts`의 가짜 skill 두 줄(`context-init`·`context-update`)은 `dk-operator-contexts`가 맡는다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
