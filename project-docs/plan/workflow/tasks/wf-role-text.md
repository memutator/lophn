# wf-role-text

role 글에 workflow를 더한다: PM과 App Engineer prompt에는 domain 폴더의 `workflows/<name>.md`(꼴, 쓰는 사람, `workflow.list`)를, Operator prompt에는 선언을 PM이나 App Engineer에게 맡긴다는 줄을, 제품 고정 규칙에는 `<lophn-call>`의 `workflow`·`participant` 속성 뜻을, lophn guide `domains.md`에는 `workflows/`를 적는다.

- 단위: role (wave 2)
- 선행: wf-contract-shapes
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/prompts.ts`
  - `packages/core/agent-roles/roles/{project-manager,app-engineer,operator}/prompt.md`
  - `packages/core/agent-roles/roles/lophn/guides/domains.md`
- 읽을 것:
  - 계획: `project-docs/plan/workflow/README.md`의 "정한 것"(시작은 entry에게 일을 주는 것, `reply: conversation`은 쓰지 않는다, 쓰는 것은 그 domain의 PM이나 App Engineer)과 "뼈대 검토에서 정한 것"(연락처는 이름이 오른 참가자 모두가 받는다, 열쇠는 `<domain>/<이름>`, model은 call에 `workflow`만 준다, 풀리지 않는 참가자는 file 전체를 뺀다)
  - 계약 모양: `project-docs/plan/workflow/tasks/wf-contract-shapes.md`의 "선언 file", "receiver tag", "봉투"
  - roadmap: `project-docs/products/roadmap/workflow.md`의 "모양"(eval loop 예, lophn이 하지 않는 일)
  - architecture: `project-docs/architecture/agent-definition.md`("고정 규칙은 영어 고정 본문 하나", "Router가 넣는 입력은 모두 user role이고 `lophn-` tag로 출처를 밝힌다"), `project-docs/architecture/domain.md`("`DOMAIN.md`·`kinds.yaml`·`skills/`는 그 그릇의 PM이나 App Engineer만 쓴다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
- 계약:
  - 쓰는 것: 선언 file 꼴(`entry`, `participants`, `contacts`, body), receiver tag 속성, tool 이름 `workflow.list`, call 입력 `workflow` — 모두 `wf-contract-shapes`의 "내놓는 것"
  - 내놓는 것: 없음(글만 바꾼다)

## 할 일

글은 영어로 쓰고, 고친 문단은 지금처럼 80자 안팎에서 줄을 바꾼다. 자리는 줄 번호가 아니라 아래에 적은 글로 찾는다(`problem-remove`의 `pr-role-prompts`가 같은 file을 먼저 고친다). 아래에 없는 줄은 건드리지 않는다.

1. `packages/core/agent-roles/roles/prompts.ts`의 `PRODUCT_INSTRUCTIONS`
   - "Who can give you instructions"에서 `<lophn-call>` 줄 바로 뒤에 한 줄을 더한다: `- A <lophn-call> with workflow and participant attributes was sent inside that workflow (its key) by that participant. If you take part in the workflow, the Workflows section of your place information says who that is and whom you hand on to.`
   - "How you work"의 첫 줄(call에 reply로 답한다) 뒤에 한 줄을 더한다: `- When you hand work on inside a workflow you take part in, give the workflow's key as workflow in the call.`
   - tag 목록 주석(여덟 tag)은 그대로다. tag가 늘지 않는다.
2. Project Manager 지침(`packages/core/agent-roles/roles/project-manager/prompt.md`)
   - "Domains and kinds"의 domain 폴더 목록에서 `` - `skills/`: `` bullet 뒤, `` - `artifacts/`: `` 앞에 bullet 하나를 더한다:
     "`workflows/<name>.md`: a workflow, agents that hand work to each other. The frontmatter names the participants and each one's contacts; the body tells every participant what the workflow is for. lophn shows each participant its own part in its prompt and keeps no order or state. Write it with the file tools. `workflow.list` shows the workflows of your domains and why a file was left out."
   - 그 목록 바로 뒤에 꼴을 적은 문단을 더한다. 예 하나와 규칙 bullet이다(App Engineer 지침과 같은 글, place 기본값만 다르다):

     ````
     A workflow file looks like this:

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
       `place` is `{project: <name>}` or `{app: <name>}`; left out, it is this
       domain's project. A participant may be in another project or app. An
       Operator needs `name`. lophn has no place or name.
     - `entry` is the participant that is given the work first.
     - `reply` is `none` or `result`. `session` is `new` (a new session for each
       call, like a judge) or `open` (a colleague whose session goes on). `when`
       is one line.
     - Participants are agents that exist; a workflow does not create agents. If
       a participant does not resolve to exactly one agent, or two participants
       are the same agent, the whole file is left out.
     ````
   - "What you do"에서 Operator bullet(`When someone asks for an Operator in this project`) 앞에 bullet 하나를 더한다: "When a person or an agent asks for a workflow, write the domain's `workflows/<name>.md` and read `workflow.list` to check that it was not left out."
3. App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md`)
   - "Domains of the app"의 domain 폴더 목록에서 `` - `skills/`: `` 뒤, `` - `artifacts/`: `` 앞에 2의 bullet과 같은 글을 더한다.
   - 그 목록과 "Rules:" 사이에 2의 꼴 문단을 더한다. 둘째 규칙 bullet의 기본값만 "left out, it is this domain's app."으로 바꾼다.
   - "What you do"에서 Operator bullet(`When someone asks for an Operator for this app`) 앞에 2의 workflow bullet과 같은 글을 더한다.
   - "Rules:"의 "Do not write another container's domain folders." bullet은 그대로 둔다(workflow 선언도 그 안이다).
4. Operator 지침(`packages/core/agent-roles/roles/operator/prompt.md`)
   - "You do not write `DOMAIN.md`, the kinds file or the skills of a domain."을 "You do not write `DOMAIN.md`, the kinds file, the skills or the workflows (`workflows/`) of a domain."으로 바꾼다. 뒤 문장(PM이나 App Engineer에게 `call`)은 그대로다.
   - "When something is not yours to fix"의 "If a kind (the kinds file), `DOMAIN.md` or a skill has to change"를 "If a kind (the kinds file), `DOMAIN.md`, a skill or a workflow has to change"로 바꾼다.
5. lophn guide(`packages/core/agent-roles/roles/lophn/guides/domains.md`)
   - "What a domain has"에서 **Skills** bullet 뒤에 bullet 하나를 더한다:
     "**Workflows** (`workflows/<name>.md`): agents that hand work to each other, such as a runner that gives each item to a judge. The file names the participants (agents that exist, also in other projects and apps) and each one's contacts, and describes the workflow. Each participant sees its own part in its prompt; an agent the file does not name sees nothing. lophn keeps no order or state, and a call outside the contacts is not stopped. A wrong file is left out whole, and `workflow.list` says why."
   - "Who makes and writes it"의 "They write its kinds file, `DOMAIN.md` and skills with their file tools."를 "They write its kinds file, `DOMAIN.md`, skills and workflows with their file tools."로 바꾼다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(글만 바꾼다).
- 남지 않음: `grep -n "the kinds file or the skills of a domain" packages/core/agent-roles/roles/operator/prompt.md`가 0줄이다.

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
