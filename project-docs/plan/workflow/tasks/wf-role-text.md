# wf-role-text

role 글에 workflow를 더한다: 제품 고정 규칙(`PRODUCT_INSTRUCTIONS`)에는 `<lophn-call>`의 `workflow`·`participant` 속성 뜻, workflow 안의 call에 열쇠를 다는 법, domain의 `workflows/`를 쓰는 사람을, 내장 skill `guide-domains`에는 `workflows/<name>.md`(꼴, 쓰는 사람, `workflow.list`)를, PM과 App Engineer 지침에는 workflow를 쓰기 전에 `guide-domains`를 읽으라는 말을 적는다.

- 단위: role (wave 2)
- 선행: wf-contract-shapes
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/prompts.ts`
  - `packages/core/agent-roles/roles/{project-manager,app-engineer}/prompt.md`
  - `packages/core/agent-roles/skills/guide-domains/SKILL.md`
- 읽을 것:
  - 계획: `project-docs/plan/workflow/README.md`의 "정한 것"(시작은 entry에게 일을 주는 것, `reply: conversation`은 쓰지 않는다, 쓰는 것은 그 domain의 PM이나 App Engineer)과 "뼈대 검토에서 정한 것"(연락처는 이름이 오른 참가자 모두가 받는다, 열쇠는 `<domain>/<이름>`, model은 call에 `workflow`만 준다, 풀리지 않는 참가자는 file 전체를 뺀다)
  - 계약 모양: `project-docs/plan/workflow/tasks/wf-contract-shapes.md`의 "선언 file", "receiver tag", "봉투"
  - roadmap: `project-docs/products/roadmap/workflow.md`의 "모양"(eval loop 예, lophn이 하지 않는 일)
  - architecture: `project-docs/architecture/agent-definition.md`("모든 role에 같은 말은 제품 고정 규칙(`PRODUCT_INSTRUCTIONS`) 한 곳에 둔다", "사용 안내는 내장 skill이다", "Router가 넣는 입력은 모두 user role이고 `lophn-` tag로 출처를 밝힌다", "고정 규칙은 영어 고정 본문 하나"), `project-docs/architecture/domain.md`("`DOMAIN.md`·`kinds.yaml`·`skills/`는 그 그릇의 PM이나 App Engineer만 쓴다")
  - 결정: `project-docs/products/change-log/0.6.0.md`의 "command는 skill이고, guide는 skill이 되고, 지침은 한 번만 말한다"(`PRODUCT_INSTRUCTIONS`로 옮기는 말의 기준, domain 폴더 설명은 `guide-domains`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
- 계약:
  - 쓰는 것: 선언 file 꼴(`entry`, `participants`, `contacts`, body), receiver tag 속성, tool 이름 `workflow.list`, call 입력 `workflow` — 모두 `wf-contract-shapes`의 "내놓는 것"
  - 내놓는 것: 없음(글만 바꾼다)

## 할 일

글은 영어로 쓴다. `.md`의 고친 문단은 지금처럼 80자 안팎에서 줄을 바꾸고, `prompts.ts`의 bullet은 지금처럼 한 줄이다(template literal 안이라 backtick은 지금처럼 `` \` ``로 쓴다). 자리는 줄 번호가 아니라 아래에 적은 글로 찾는다. 아래에 없는 줄은 건드리지 않는다. 같은 말은 한 곳에만 둔다: 모든 role에 같은 말은 `PRODUCT_INSTRUCTIONS`, domain 폴더의 설명과 꼴은 `guide-domains`, 한 role에만 맞는 말은 그 role 지침이다(`agent-definition.md`).

1. `packages/core/agent-roles/roles/prompts.ts`의 `PRODUCT_INSTRUCTIONS`
   - "Who can give you instructions"에서 `<lophn-call>` 줄(`- <lophn-call> is a task another agent sent you, …`) 바로 뒤에 한 줄을 더한다: `- A <lophn-call> with workflow and participant attributes was sent inside that workflow (its key) by that participant. If you take part in the workflow, the Workflows section of your place information says who that is and whom you hand on to.`
   - "How you work"의 `call` 줄(`` - `call` hands work to another agent. … ``) 바로 뒤에 한 줄을 더한다: `` - When you hand work on inside a workflow you take part in, give the workflow's key as `workflow` in the call. ``
   - 같은 절의 domain 파일 줄(`` - A domain's `DOMAIN.md`, kinds file and skills are written only by … ``)을 `` - A domain's `DOMAIN.md`, kinds file, skills and workflows (`workflows/`) are written only by the Project Manager of its project or the App Engineer of its app. If one that is not yours has to change, give it to that agent with `call`. ``로 바꾼다. 이 줄이 Operator에게도 가므로 Operator 지침은 고치지 않는다.
   - 머리 주석(tag 목록은 고정 문장, 이름은 `INPUT_TAGS`에 있어야 한다)은 그대로다. tag가 늘지 않는다.
2. 내장 skill `guide-domains`(`packages/core/agent-roles/skills/guide-domains/SKILL.md`)
   - "What a domain has"에서 **Skills** bullet 뒤, **Artifacts** bullet 앞에 bullet 하나를 더한다:
     "**Workflows** (`workflows/<name>.md`): agents that hand work to each other, such as a runner that gives each item to a judge. The file names the participants (agents that exist, also in other projects and apps) and each one's contacts, and describes the workflow. Each participant sees its own part in its prompt; an agent the file does not name sees nothing. lophn keeps no order or state, and a call outside the contacts is not stopped. A wrong file is left out whole, and `workflow.list` says why."
   - "Who makes and writes it"의 "They write its kinds file, `DOMAIN.md` and skills with their file tools."를 "They write its kinds file, `DOMAIN.md`, skills and workflows with their file tools."로 바꾼다.
   - "Who makes and writes it" 절 뒤, "One container only" 절 앞에 새 절을 더한다. 꼴의 예 하나와 규칙 bullet이다:

     ````
     ## Writing a workflow

     When a person or an agent asks for a workflow, the Project Manager or App
     Engineer writes the domain's `workflows/<name>.md` with the file tools and
     reads `workflow.list` to check that it was not left out. `workflow.list`
     shows the workflows of the domains of your project or app (all of them if
     you have no place) and why a file was left out.

     ```markdown
     ---
     entry: runner
     participants:
       runner: {role: operator, name: eval-runner}
       judge: {role: operator, name: judge}
       owner: {role: project_manager, place: {project: lophn}}
     contacts:
       runner:
         - {to: judge, reply: result, session: new, when: "each item waiting to be graded"}
         - {to: owner, reply: none, session: open, when: "the run is written up"}
     ---
     What the workflow is for and how the work moves. Every participant reads this.
     ```

     - The file name and the participant names are slugs. The workflow's key is
       `<domain name>/<file name>`.
     - `role` is `lophn`, `project_manager`, `app_engineer` or `operator`.
       `place` is `{project: <name>}` or `{app: <name>}`; left out, it is the
       domain's own project or app. A participant may be in another project or
       app. An Operator needs `name`. lophn has no place or name.
     - `entry` is the participant that is given the work first.
     - `reply` is `none` or `result`. `session` is `new` (a new session for each
       call, like a judge) or `open` (a colleague whose session goes on). `when`
       is one line.
     - Participants are agents that exist; a workflow does not create agents. If
       a participant does not resolve to exactly one agent, or two participants
       are the same agent, the whole file is left out.
     ````
   - frontmatter의 `description`은 바꾸지 않는다(이미 "what it holds, who makes and writes it"이다).
3. Project Manager 지침(`packages/core/agent-roles/roles/project-manager/prompt.md`)
   - "## Domains"의 "Before you make or change a domain, read the skill `guide-domains`: what a domain folder holds and how a domain is made."를 "Before you make or change a domain or write a workflow, read the skill `guide-domains`: what a domain folder holds, how a domain is made and how a workflow file is written."로 바꾼다.
   - "## What you do"의 "Write the domain's `DOMAIN.md` and skills with the file tools."를 "Write the domain's `DOMAIN.md`, skills and workflows with the file tools."로 바꾼다.
4. App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md`)
   - "## Domains of the app" 첫 문단의 같은 문장("Before you make or change a domain, read the skill `guide-domains`: what a domain folder holds and how a domain is made.")을 3의 첫 글과 같은 글로 바꾼다.
5. role 지침과 skill 글이 바뀌어 eval의 instruction·skill 판(`tests/eval/registry/`)이 새 판이 된다. eval이 돌 때 저절로 매기고 `deno task check`는 보지 않는다. `tests/`의 코드에서 이 글을 맞춰 보는 곳은 없다(2026-10-22 main에서 `grep -rn --include=*.ts "How you work\|guide-domains\|kinds file and skills" tests` 0줄. `tests/eval/registry/`와 `tests/eval/runs/`의 JSON은 기록이라 고치지 않는다).

정한 것:
- 꼴과 규칙은 `guide-domains` 한 곳에 두고 PM·App Engineer 지침에 두 번 쓰지 않는다. 이유: `agent-definition.md`가 같은 말을 한 곳에 두게 하고, domain 폴더 설명을 `guide-domains`로 옮겼다. 이 skill은 lophn·PM·App Engineer에게 간다.
- Operator 지침은 고치지 않는다. 이유: "domain 파일은 PM이나 App Engineer만 쓰고, 아니면 call한다"는 말은 `PRODUCT_INSTRUCTIONS`의 한 줄이고 그 줄에 workflows를 더한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(글만 바꾼다).
- 남지 않음: `grep -n "kinds file and skills are written only" packages/core/agent-roles/roles/prompts.ts`가 0줄이다.
- 한 곳만: `grep -rln "entry: runner" packages/core/agent-roles`가 `packages/core/agent-roles/skills/guide-domains/SKILL.md` 하나다.
- 안 고침: `git diff --stat main -- packages/core/agent-roles/roles/operator/prompt.md packages/core/agent-roles/roles/lophn/prompt.md`가 비어 있다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
