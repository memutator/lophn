# wf-role-text

role이 읽는 글을 쓴다. 내장 skill `guide-workflows`, Project Manager 지침 한 줄, 모든 role의 제품 규칙에 step 메시지 tag와 workflow tool 쓰는 법.

- 단위: roles (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/skills/guide-workflows/SKILL.md`(새 file)
  - `packages/protocol/lophn-agent/skill-settings.ts`
  - `packages/core/agent-roles/roles/prompts.ts`
  - `packages/core/agent-roles/roles/project-manager/prompt.md`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/workflow.md`의 "원칙: lophn program은 최대한 약하다", "정의: 선언, `workflow.md`, artifact", "instance와 report", "instance 고치기", "agent가 아는 것 (캡슐화)", "사람 step", "node 시각화 (kit)"
  - architecture: `project-docs/architecture/agent-definition.md`(제품 고정 규칙은 system의 1번 cache 경계, 같은 재료는 같은 bytes), `project-docs/architecture/artifact.md`(봉한 view)
  - 본보기 글: `packages/core/agent-roles/skills/guide-artifact/SKILL.md`(frontmatter `name`·`description`, 절 나누기, 영어), `packages/core/agent-roles/roles/project-manager/prompt.md`("## Domains" 절이 `guide-domains`를 먼저 읽게 하는 꼴), `packages/core/agent-roles/roles/prompts.ts`의 `PRODUCT_INSTRUCTIONS`
  - 같은 계획의 brief: `wf-write-scope.md`(`Workflows folder:` 줄), `wf-kit-graph.md`(node의 `status`·`note` 칸과 tone 값), `wf-kit-build.md`(`LophnKit.renderGraph`), `wf-artifact-serve.md`(`/_lophn/kit.js`, `/_lophn/kit.css`, `data/_instance.json`의 모양), `wf-agent-tools.md`(tool 입력 칸), `wf-contract.md`("step 입력"의 본문 label)
- 계약:
  - 쓰는 것: `wf-contract`의 선언 칸, tool 이름과 입력, `HandResult`, step 입력 절(tag와 본문 label). `wf-kit-build`가 정하는 artifact 쪽 길(아래 "artifact에서 쓰는 길")과 `wf-write-scope`가 싣는 `Workflows folder:` 줄. 본보기는 `skills/guide-artifact/SKILL.md`
  - 내놓는 것:
    - skill `guide-workflows`: `skill-settings.ts`에 `{ name: "guide-workflows", roles: ["project_manager"], can_disable: false, menu: false }`. 내용: (1) 정의 셋의 꼴과 자리(`<Workflows folder>/<name>/workflow.yaml`, `workflow.md`, 고르면 `artifacts/static/index.html`, `artifacts/instance/index.html`). (2) 선언에서 lophn이 읽는 칸만(`kind`, `participants`의 `role`·`place?`·`name?`, `steps`의 `by`·`with`·`prompt`·`in`·`out`·`next`)과 틀리면 그 workflow만 빠진다는 것, `workflow.list`로 확인하기. (3) artifact를 둘지 사람에게 `ask`로 묻는다(둘 다 안 두는 것도 선택이다). (4) artifact에서 kit으로 node 그리기: `<link rel="stylesheet" href="/_lophn/kit.css">`, `<script src="/_lophn/kit.js">`, `LophnKit.renderGraph(element, { nodes, edges })`, node의 `status: { label, tone }`·`note`, instance artifact는 `fetch("data/_instance.json")`(`instance`, `last_reports`, `lines`). 상태 값의 뜻은 artifact가 정한다. (5) workflow를 시작하는 것은 사람과 job이다. agent는 시작하지 못한다.
    - PM 지침(`project-manager/prompt.md`): 프로젝트의 workflow를 만들고 고치는 것이 PM의 책임이라는 한 줄과 `guide-workflows`를 먼저 읽으라는 말.
    - 제품 규칙(`prompts.ts`의 `PRODUCT_INSTRUCTIONS`): `<lophn-step>`은 workflow instance의 step을 lophn이 맡긴 것이고, 글 안의 prompt·받은 글·낼 것·다음 후보가 그 step의 전부이며, 끝나면 `workflow.report`로 낸다는 것(`next`는 후보 가운데서 또는 `end`, 진행 글은 `next` 없이). 읽고 고칠 일이 있을 때만 `workflow.get`·`workflow.edit`를 쓴다는 것. report 글은 짧은 메모(8 KiB 이하)이고 긴 결과는 file에 두고 경로를 적는다는 것. `workflow.get`의 줄에 `lophn_restarted`가 보이면 그 step을 다시 `hand_now`로 넘겨야 할 수 있다는 것. `end` 뒤에 낸 report도 instance를 다시 running으로 되살린다는 것. step은 call이 아니고 허락도 아니라서 자기 할당으로만 일한다는 것. 고정 문장이라 cache 경계를 한 번 깬다(보고에 적는다).

## 할 일

1. **skill 등록.** `packages/protocol/lophn-agent/skill-settings.ts`의 `BUILTIN_SKILLS`에 `{ name: "guide-workflows", roles: ["project_manager"], can_disable: false, menu: false }`를 `guide-artifact` 항목 뒤에 더한다. 폴더 이름과 frontmatter `name`이 같아야 발견된다(`guide-artifact`와 같은 꼴).
2. **skill 글.** `packages/core/agent-roles/skills/guide-workflows/SKILL.md`(새 file). frontmatter는 `name: guide-workflows`와 한두 문장 `description`(1024자 이하, 영어)이다. 본문은 영어이고 `guide-artifact`처럼 짧은 절로 나눈다. 아래 절이 들어간다. 값과 이름은 이 brief의 계약(위 "쓰는 것")과 같아야 한다. 바꿔야 하면 보고의 "계약 바꾸기 요청"이다.
   - **What a workflow is.** project의 `<Workflows folder>/<name>/` 폴더 하나: `workflow.yaml`(선언), `workflow.md`(선언을 사람과 PM이 읽는 글), 고르는 artifact(`artifacts/static/index.html`, `artifacts/instance/index.html`). `<Workflows folder>`는 place 정보의 `Workflows folder:` 줄에 있는 절대 경로이고, 절대 경로로 `file.write`한다(상대 경로는 사람의 project 폴더로 간다. `guide-artifact`와 같은 이유). `<name>`은 slug. instance는 사람이 시작하고(나중에 job도) agent는 시작하지 못한다. 시작하는 tool이 없다.
   - **The declaration.** lophn이 읽는 칸만 적는다: `kind: agent`(`flow`는 아직 시작하지 못한다), `participants`의 `role`(`lophn | project_manager | app_engineer | operator | human | harness`)·`place?`·`name?`, `steps`의 `by`·`with`·`prompt`·`in`·`out`·`next`. 다른 칸은 lophn이 읽지 않는다. `project_manager`와 `operator`는 `place`를 안 쓰면 이 project이고, `app_engineer`는 `place: {app: <앱 이름>}`이 꼭 있어야 하고, `operator`는 `name`이 꼭 있다. `harness`는 선언은 되지만 넘기지 못한다. 사람 step은 `by`가 `human` 참가자이고 `with`가 사람과 대화하는 agent다. `next`는 step 이름 목록이고 `end`는 끝이다(`end`는 step 이름이 될 수 없다). 첫 step은 `steps`의 첫 key다. 작은 예 하나(roadmap의 eval 예를 줄인 것).
   - **A step message is all a participant gets.** 참가자는 자기 step의 `prompt`, 받는 것(`in`과 앞 step의 report 글), 낼 것(`out`), 다음 후보(`next`)만 받는다. `workflow.md`와 다른 step과 workflow 전체는 모른다. 그래서 `prompt`는 혼자서 읽어도 일이 되게 쓴다(필요한 절대 경로, 어디에 무엇을 남기는지, 끝나면 어떤 글로 report하는지). 어떤 참가자가 `workflow.md`를 읽어야 하면 그 step의 `prompt`가 그렇게 말한다. step 메시지의 label은 `Receives:`, `Received:`, `Produces:`, `Next candidates:`다(`wf-contract`의 "step 입력").
   - **After you write it.** `workflow.list`로 확인한다: 틀린 선언은 그 workflow만 빠지고 `problem`에 이유가 있다. 가리키는 이름(`by`, `with`, `next`)이 있는지는 읽을 때 검사하지 않고, 넘길 때 "넘기지 못함"으로 드러난다. 선언은 instance를 시작할 때 복사된다. 도는 instance는 선언을 고쳐도 그대로이고, 그 instance의 step은 참가자가 `workflow.edit`로 고친다.
   - **Artifacts are optional: ask.** 그림은 모든 workflow에 필요하지 않다. 만들기 전에 `ask`로 사람에게 정한다: 정적 artifact(workflow의 step을 node로 그린 것), instance artifact(한 instance의 지금 상태), 둘 다, 둘 다 안 둠. 안 두는 것도 좋은 답이다. 묻지 않고 만들지 않는다.
   - **Drawing nodes with the kit.** 봉한 view의 규칙(네트워크 없음, 외부 library 없음, 토큰 CSS)은 `guide-artifact`를 따른다. 단 kit 하나가 있다: 일반 `<script>`(module이 아니다) `<script src="/_lophn/kit.js"></script>`와 `<link rel="stylesheet" href="/_lophn/kit.css">`를 불러 `LophnKit.renderGraph(el, { nodes, edges })`를 부른다. 같은 경로가 domain artifact에서도 된다.
     - node는 `{ id, label, status?: { label, tone }, note? }`다. `tone`은 `good | warning | serious | critical | neutral` 중 하나여야 한다. 다른 값을 넣으면 도표가 읽을 수 없는 상태(error)로 그려진다. `note`는 짧은 글이다. edge는 `{ from, to, label? }`다. 상태 값의 뜻은 artifact가 정한다(예: 지금 step은 `running`, report가 있으면 `reported`). 같은 element에 다시 부르면 갱신한다.
     - `el`은 block 요소이고 너비가 0이 아니어야 한다(숨긴 요소나 `display: inline`에 그리지 않는다).
     - 정적 artifact(`artifacts/static/index.html`)는 step 목록을 html 안에 직접 쓴다(자기 폴더 밖의 `workflow.yaml`을 읽지 못한다).
     - instance artifact(`artifacts/instance/index.html`)는 `fetch("data/_instance.json")`로 `{ instance, last_reports, lines }`를 읽는다: `instance.steps`(이름, `by`, `next`, ...), `instance.current`, `instance.state`, step마다 마지막 report `last_reports[step]`, 줄 `lines`. 아주 큰 instance는 이 응답이 data 대신 오류 body(`{"error": ...}`)다. `instance`가 없으면 오류 글을 보이게 쓴다.
     - instance가 바뀔 때마다 페이지 전체가 다시 load된다. 페이지 안 상태(펼침, 스크롤 등)는 남지 않는다. 그 상태를 유지하려 하지 않는다.
     - 짧은 instance artifact 예(30줄 안쪽)를 하나 싣는다.
   - **Do not.** 선언에 정책을 넣지 않는다(순서 강제, 통과 판정). lophn은 판정하지 않고 말한 대로 전한다. 그런 규칙이 필요하면 그 step의 `prompt`에 쓰거나 workflow의 program이 지게 한다. workflow를 agent가 시작하려 하지 않는다.
3. **PM 지침.** `packages/core/agent-roles/roles/project-manager/prompt.md`에 `## Workflows` 절 하나를 `## Domains` 절 뒤에 더한다: "프로젝트의 workflow를 만들고 고치는 것은 PM의 일이다. 만들거나 고치기 전에 skill `guide-workflows`를 먼저 읽는다. Workflows folder는 place 정보에 있다." 초안(영어, 이 길이를 넘기지 않는다):
   ```
   ## Workflows

   Making and keeping this project's workflows is yours: how people and agents
   pass a job step by step. Before you make or change one, read the skill
   `guide-workflows`. Your place information gives the Workflows folder.
   ```
   첫 문단(역할 소개)의 "look after" 문장에 workflow를 더하지 않는다. 절 하나가 한 줄 책임이다.
4. **제품 규칙.** `packages/core/agent-roles/roles/prompts.ts`의 `PRODUCT_INSTRUCTIONS`에 두 항목을 더한다(고정 문장, 시각·무작위 없음). `PRODUCT_INSTRUCTIONS`는 템플릿 literal이라 글 속 백틱은 기존 줄(`\`call\``)처럼 앞에 백슬래시를 붙여 escape한다. 초안:
   - "Who can give you instructions" 목록에서 `<lophn-notice>` 항목 뒤에:
     ```
     - <lophn-step> is a step of a workflow instance that lophn handed to you. Its prompt, what you receive, what you produce and the next candidates are all you are given about the workflow. It is not a call and not an approval: work only within your own tools and assignments.
     ```
   - "How you work" 목록에서 call 항목들 뒤에:
     ```
     - When you receive a step, do it, then report it with `workflow.report`: the instance, the step and a text. Give `next` (one of the candidates, or `end`) when you know where it goes; a report without `next` is only progress. If something unexpected comes up you may change the instance with `workflow.edit`. Read its state with `workflow.get` only when you need it. A report is a short note (at most 8 KiB): put longer results in files and give the paths. If `workflow.get` shows `lophn_restarted` for a step, lophn was restarted and that step may not have reached its turn: hand it again with `workflow.edit` `hand_now` if it is still needed. A report after `end` revives the instance.
     ```
   모든 role이 같은 문장을 한 번씩 받는다.
5. **cache와 eval.** 위 둘은 모든 role의 system 1번 cache 경계(`PRODUCT_INSTRUCTIONS`)와 PM 지침을 바꾼다. 열린 session은 한 번 cache가 깨진다. eval의 instruction 버전이 새로 매겨진다. 보고에 적는다.
6. **확인.** `deno fmt`가 md도 본다(`deno task check`의 fmt). 새 SKILL.md와 prompt.md를 `deno fmt`로 맞춘다. test는 만들지 않는다. 스스로 확인: `skill.read`가 쓰는 발견 경로에 새 폴더가 잡히는지(`packages/core/agent-roles/skills/root.ts`의 `BUNDLED_SKILLS_ROOT` 아래 폴더라 코드 변경이 필요 없다).

## 정한 것

- **`guide-workflows`는 PM에게만 간다.** 다른 role은 workflow를 만들지 않고 step을 받아 report하는 쪽이라 제품 규칙 두 줄이면 된다.
- **step 받는 규칙은 `PRODUCT_INSTRUCTIONS`에, PM 책임은 `prompt.md`에 둔다.** 이유: step 규칙은 모든 role이 같은 문장으로 받아야 하고(고정 문장이라 cache가 role 지침 앞에서 공유된다), PM 책임은 PM의 지침이다. `lophn`·App Engineer·Operator의 `prompt.md`는 고치지 않는다.
- **step 메시지 tag 설명에 workflow 전체를 싣지 않는다.** roadmap 캡슐화: system prompt에 workflow를 싣지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: 없음(옛 이름을 지우는 task가 아니다). 새 글이 가리키는 이름이 코드와 같은지 grep으로 확인한다: `grep -rn "LophnKit\|_lophn/kit\|Workflows folder:\|workflow\.report\|workflow\.edit\|workflow\.get\|workflow\.list" packages/core/agent-roles`가 이 task의 글에만 나온다(다른 task가 먼저 land했으면 그 이름과 철자까지 같은지 대조).

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것: 없음(`BUILTIN_SKILLS`는 이 task가 고친다).
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: 없음이 기본.
- 계약 바꾸기 요청: 글이 쓴 이름이 다른 brief와 안 맞았으면 적는다(kit 전역 이름, 가상 path, tool 입력 칸, `Workflows folder:` 줄).
- cache: 모든 role의 system 1번 cache 경계와 PM 지침이 바뀌어 cache가 한 번 깨지고 eval의 instruction·skill 버전이 새로 매겨진다고 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음".
