# ab-prompt

App Engineer 지침을 직접 짓는 흐름으로 다시 쓰고, lophn과 Project Manager 지침과 lophn guide에서 ticket과 coding agent에게 맡기는 줄을 지운다(README "App Engineer 지침을 다시 쓴다", roadmap `agent-definition.md` "instruction은 한 번만 말한다"의 App Engineer 지침). 흐름은 설계(재사용 → 모델 → journey → 화면 → tool) → 코드 → 앱 test(shell) → `release.prepare` → preview에서 확인 → `release.activate`다. "짓기 전에 설계한다"를 두고 설계는 앱 source에 file로 둔다. 길이는 지금(236줄)의 반 정도다. 겹친 지침을 `PRODUCT_INSTRUCTIONS`로 모으는 일은 `agent-definition` 계획이다.

정한 것(flesh):
- 설계 file은 앱 source 폴더 root의 `DESIGN.md` 하나다. 절은 Purpose, Reuse, Model, Journeys, Screens, Tools, Failure branches 순이다(지금 ticket goal의 절 그대로). 이유: README가 "설계는 앱 source에 file로 둔다"고만 했다. file 하나면 App Engineer가 바뀐 부분만 고치고 다음 session이 한 곳에서 읽는다. `DOMAIN.md`, `LOPHN.md`와 같은 꼴의 이름이다.
- 앱 파일 배치와 명령은 지침에 다시 쓰지 않고 source 폴더의 `AGENTS.md`(template, ab-cli가 고친다)를 읽으라고 한다. 지침에는 `deno task check`, `deno task test`와 commit만 쓴다. 이유: planner가 지침끼리, 지침과 다른 문서 사이에 겹친 문단을 새로 만들지 말라고 했다.
- lophn guide `domains.md`의 "공개 tool을 지우는 release는 막힌다" 줄은 공개 tool 막기가 없어져(ab-release-activate) 틀리게 된다. 어느 task도 갖지 않아 소유에 더했다(flesh. planner 확인 필요).

- 단위: prompt (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/app-engineer/prompt.md`
  - `packages/core/agent-roles/roles/lophn/prompt.md`
  - `packages/core/agent-roles/roles/project-manager/prompt.md`
  - `packages/core/agent-roles/roles/lophn/guides/{artifact.md,roles-and-grants.md,features-and-screens.md}`
  - `packages/core/agent-roles/roles/lophn/guides/domains.md`(공개 tool 막기 줄만. flesh가 더함)
  - `packages/core/agent-roles/roles/prompts.ts`(`<lophn-reaction>` 설명 줄과 35줄 주석만)
  - `packages/core/agent-roles/place/place-data.ts`(App Engineer 설명 글만)
  - `packages/core/agent-roles/credentials.ts`(주석만)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "App Engineer 지침을 다시 쓴다", "`release.activate`의 결과", "공개 tool 막기는 준비 결과의 알림이다", "뼈대 검토에서 정한 것"(`release.prepare`의 `failed` 결과, `release.activate`의 기다림 상한과 `running`, 준비가 그 앱의 preview를 바꾼다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "agent가 맡는 것", "App Engineer 혼자 코딩한 실험"(설계를 건너뛰어 화면이 목록이 됐다), "정한 것(agent)"의 공개 tool 알림; `project-docs/products/roadmap/agent-definition.md` 47줄과 "instruction은 한 번만 말한다"
  - architecture: `project-docs/architecture/agent-definition.md`(role 지침은 cache되는 system 1층이다), `project-docs/architecture/app-call.md` 73-83줄(preview 호출은 invocation과 rewind가 없고, preview의 출력과 오류는 앱 log에 쓰지 않는다. 앱 log 줄의 꼴), `project-docs/architecture/activation.md`(동의가 필요한 경우)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`; `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 다른 ab- task의 계약(지침이 말할 tool과 출력. 이 task는 wave 4라 모두 land한 뒤다. 실제 코드의 tool 설명과 다르면 코드를 따르고 보고한다)
    - `ab-preview.md`: `preview.start`, `preview.call`, `preview.stop`의 입력과 출력
    - `ab-release-prepare.md`: `release.prepare`의 입력 `{app}`과 `prepared | failed` 출력, `removed_public_tools`, HEAD commit으로 짓는다
    - `ab-release-activate.md`: `release.activate`의 `active | failed | waiting_consent | running` 출력(`running`은 기다림 상한을 넘었을 때. README가 정본이다)
    - `ab-source.md`: `app.create`이 source 폴더를 만든다, `app.link_source`는 commit 있는 git 저장소만 받는다
    - `ab-router.md`: call의 받는 곳 `coding_agent`는 거절된다
    - `ab-publish.md`: `package.publish`는 test를 요구하지 않는다
    - `ab-cli.md`: 앱 template `AGENTS.md.tmpl`에서 ticket과 `lophn app test` 줄이 빠진다
  - 코드(줄은 main `dd956b49f`)
    - `packages/core/agent-roles/roles/app-engineer/prompt.md` 전체(아래 할 일 1의 줄 번호)
    - `packages/core/agent-roles/tool-lists.ts`(role별 목록. ab-preview, ab-release-prepare, ab-release-activate가 더하고 ab-ticket-delete가 `ticket.*`를 뺀다)
    - `packages/core/agent-roles/place/place-info.ts` 100-101(place 정보의 `Source folder:`와 `Blueprint:` 줄)
    - 앱 template `packages/core/apps/packages/template/app/AGENTS.md.tmpl`과 `deno.json.tmpl`의 tasks(`check`, `test`, `build`, `wording`)
    - `packages/sdk/cap-problem/guide.md`(`reportProblem`)
- 계약:
  - 쓰는 것: App Engineer의 tool 이름(이 계획이 끝난 `tool-lists.ts`). 지침에 쓸 수 있는 이름은 이것뿐이다.
    - 공통: `file.read`, `file.write`, `file.edit`, `file.glob`, `file.grep`, `file.outline`, `pdf.read`, `image.read`, `shell.run`, `web.search`, `web.fetch`, `call`, `reply`, `cancel`, `session.list`, `ask`, `skill.read`
    - 읽기: `app.list`, `app.get`, `app.tools`, `app.status`, `app.logs`, `app.invocations`, `blueprint.check`, `package.list`, `package.get`, `release.list`, `release.get`, `kind.list`, `kind.check`, `domain.list`, `domain.get`, `guide.read`, `settings.get`, `visual.show`
    - 쓰기: `app.link_source`, `package.publish`, `domain.create`, `operator.create`, `operator.update`, `preview.start`, `preview.call`, `preview.stop`(ab-preview), `release.prepare`(ab-release-prepare), `release.activate`(ab-release-activate)
    - App Engineer에게 없는 것: `ticket.*`, `app.create`, `instructions.read`. lophn 지침은 `ticket.list`를 빼면 지금 이름 그대로다. PM 지침은 tool 이름을 새로 쓰지 않는다.
    - 출력 모양은 ab-preview, ab-release-activate, ab-release-prepare의 계약이다.
  - 내놓는 것:
    - App Engineer 지침에 ticket, claim, examples, 검증 기록, coding agent에게 맡기기, reaction, program gate 설명이 없다. 위 흐름과 단계마다 쓰는 tool, 설계 file의 자리와 이름, 실패를 읽는 법(`release.prepare`의 `failed` 출력, `release.activate`의 `failed`와 `waiting_consent`, 앱 log와 invocation)이 있다.
    - lophn 지침(`ticket.list`로 ticket 보기, "그 앱의 coding agent"), PM 지침("ticket", "coding agent hand-over"), lophn guide(`artifact.md`, `roles-and-grants.md`, `features-and-screens.md`의 ticket과 coding agent 줄, `roles-and-grants.md`와 `domains.md`의 공개 tool 막기)에 ticket과 맡기기가 없다. App Engineer가 직접 짓는다고 말한다.
    - `PRODUCT_INSTRUCTIONS`에 `<lophn-reaction>` 설명 줄이 없다(planner 결정 2026-10-21: Router가 `coding_agent`를 받지 않아 reaction을 받을 lophn agent가 없다. 길은 남고 쓰이지 않는다. 맡기기가 되살아나면 이 줄도 같이 돌아온다). 다른 tag 줄은 고치지 않는다. `INPUT_TAGS`의 `reaction`과 `run-loop/input-text.ts`의 reaction 갈래는 그대로다.
    - Place 설명(`place-data.ts`)의 App Engineer 글에 tickets가 없다.

## 할 일

1. App Engineer 지침(`app-engineer/prompt.md`)을 다시 쓴다. 영어, 80자 줄바꿈, 지금 말투(짧은 평서문, "You ...")를 따른다. 목표는 약 120줄이고 140줄을 넘기지 않는다. 아래 절 순서로 쓴다. 줄 번호는 지금 file이다.
   - 머리(1-7): 하는 일을 다시 쓴다. 한 앱을 맡아 설계하고, 코드를 쓰고, test하고, release를 준비해 preview에서 확인하고 activate한다. 앱이 이상하면 원인을 읽고 고친다. 앱의 domain을 돌본다. 이 앱만 맡는다. "turn into tickets", "give the tickets to a coding agent", "You do not write the app's code"를 지운다.
   - When you start work(9-18): 사람이 시킬 때, 다른 agent의 call(lophn, Operator), 앱 화면의 annotation. reaction(12-13)과 coding agent 보고·만료·끝(14-16)을 지운다. "lophn은 crash나 kind 위반으로 session을 열지 않는다"는 둔다.
   - Domains of the app(20-51): role 공통 절이라 그대로 둔다(`agent-definition`이 모은다).
   - Designing the app(53-99): 
     - 55-59(사람은 tool과 입력을 모른다, 기술 spec은 정해진 것으로 받는다)와 91-93(묻는 법)은 짧게 줄여 둔다.
     - "짓기 전에 설계한다": 새 앱이나 새 기능은 코드 전에 `DESIGN.md`(source 폴더 root)를 쓴다. 바꾸는 일은 바뀌는 절을 먼저 고친다. 절과 순서는 위 "정한 것"이다.
     - 61-84의 다섯 단계(재사용, 모델, journey, 화면, tool)를 한두 줄씩으로 줄여 옮긴다. 살릴 핵심: 재사용은 `package.list`·`package.get`·`app.tools`로 먼저 찾는다; 모델은 저장하는 것과 보일 때 계산하는 것을 가른다; journey는 첫 방문(data 없음)을 넣는다; 화면은 같은 종류의 잘 알려진 앱의 관례에서 출발하고, 화면마다 header, 본문 영역, control, 추가·변경·삭제, empty·loading·error, panel·card 크기를 적고, `@lophn/ui` 부품 이름을 쓴다; tool은 모델과 화면에서 끌어내고 이름, effect, 입력, 출력, 규칙, 실패 분기를 적는다. 실패 분기(거절로 끝나는 업무 분기, 실패한 바깥 호출, 조용한 fallback)는 원인마다 다른 이름으로 코드에서 `reportProblem`을 부른다(지금 114-118의 내용).
     - 85-90(source 폴더는 첫 넘기기 때 생긴다)과 95-99(설계를 ticket goal에)를 지운다. source 폴더는 앱을 만들 때 생기고 place 정보의 `Source folder:`에 있다. `app.link_source`는 사람이 이미 있는 폴더(commit 있는 git 저장소)를 가리킬 때만 쓴다.
   - Building and releasing(새 절. 지금 101-170을 대신한다). 단계마다 tool을 쓴다.
     1. blueprint: `blueprint.ts`를 먼저 고치고 `blueprint.check`로 읽는다. package는 `package.list`·`package.get`으로 골라 dependencies에 정확한 version을 둔다. 다른 앱의 tool은 `app.tools`로 읽고 `app_connections`에 선언한다(지금 104-109).
     2. 코드: file tool로 source 폴더에 쓴다. 쓰기 전에 source 폴더의 `AGENTS.md`(file 배치, 명령, SDK `guide.md` 자리)를 읽는다.
     3. 앱 test: `shell.run`으로 source 폴더에서 `deno task check`와 `deno task test`를 돌린다. 업무 규칙에는 test를 쓴다. 처음 돌릴 때는 의존성을 받느라 오래 걸리니 `timeout_ms`를 늘린다.
     4. commit: `release.prepare`는 source의 지금 commit으로 짓는다. commit하지 않은 변경은 release에 들지 않는다. `shell.run`으로 `git add`와 `git commit`을 한다.
     5. `release.prepare`(`{app}`): `prepared`면 release id를 쓴다. 같은 commit이면 같은 release가 온다. `failed`면 `stage`와 `reason`이 고칠 곳이다. 고치고 commit하고 다시 준비한다. 입력이 틀렸다는 답이면 source 폴더나 commit이 없다. `removed_public_tools`가 있으면 공개 tool 절(아래)을 따른다. 준비는 그 앱의 지금 preview를 닫는다.
     6. preview: `preview.start`(`{release, fixture?}`)로 준비한 release를 띄운다. `fixture`는 release 안의 SQLite file 경로이고 없으면 빈 data로 뜬다. `ready`가 false면 `reason`을 읽는다. `preview.call`(`{app, tool, input}`)로 journey를 tool 순서대로 불러 본다(만들고, 바꾸고, 읽어 확인한다). 결과는 `succeeded`, `failed`(앱의 `error`), `denied`, `unknown`이다. preview는 따로 띄운 일회용 data라 운영 data를 건드리지 않고, 그 출력과 오류는 `app.logs`에 남지 않는다. 끝나면 `preview.stop`(`{app}`).
     7. `release.activate`(`{release}`): 앱의 첫 activation은 늘 사람의 동의를 물어 `waiting_consent`가 돌아온다. 그때는 사람에게 동의를 부탁하고 결과는 `app.status`로 본다고 지침에 쓴다.
        `active`면 사람에게 알린다. `failed`면 `failure`의 `code`, `summary`, `restored`(앞 release로 돌아갔는지)를 읽고 `app.logs`로 원인을 본 뒤 고친다. `waiting_consent`면 release가 앱이 할 수 있는 것을 넓히거나 data를 잃는 migration이라 사람의 동의를 기다린다. 사람은 대기 목록에서 답하고 그 뒤 결과는 화면에서 본다. 너는 다시 불리지 않으니 무엇을 묻는지 사람에게 말한다. `running`이면 activation이 아직 도는 중이니 나중에 `app.status`로 본다. 충돌 답은 그 release가 준비된 것이 아니거나 그 앱의 activation이 도는 중이다.
   - When the app misbehaves(지금 171-185): 171-180(`app.status`, `app.logs`의 `invocation`·`since`·`until`, `app.invocations`의 `status: "failed"`, log 줄의 꼴 넷)을 그대로 둔다. "make a ticket that fixes the cause"(181-182)는 "고치고 위 단계로 다시 낸다"가 된다. annotation(183-185)은 그 화면에 대한 사람의 요청으로 읽고 고친다. artifact의 note와 `image.read` 줄은 둔다.
   - 그 밖의 일(지금 186-211): Operator(186-189), 공개 tool이 보이는 범위와 grant 제안(190-194), package 주인(202-206), artifact(207-211)는 줄여 둔다. 공개 tool 약속(195-201)은 고친다: 공개 tool은 약속이라 만들거나 바꿀 때 `DESIGN.md`에 적는다. `release.prepare`의 `removed_public_tools`에 쓰는 쪽(`app`, `domain`)이 오면 activate하기 전에 쓰는 domain의 주인(project의 Project Manager나 앱의 App Engineer)에게 답을 기다리지 않는 `call`로 알리고 사람에게 묻거나, tool을 되살린다. program은 막지 않는다.
   - What you do not do(213-222): 215-216(코드, test, build, preview를 하지 않는다)을 지운다. 217-221은 둔다. 222의 "State uncertainty on tickets"는 "확인하지 못한 것은 그렇다고 말한다"로 바꾼다.
   - Calls(224-231), Rules for apps and data(233-236): role 공통 절이라 그대로 둔다.
   - 쓰지 않는 것: 위 "내놓는 것"의 낱말(ticket, claim, examples, verify, coding agent, reaction, gate)과 `PRODUCT_INSTRUCTIONS`나 다른 role 지침에 이미 있는 문단을 새로 옮겨 오는 것. template `AGENTS.md`의 내용을 옮겨 쓰는 것.
2. lophn 지침(`lophn/prompt.md`)
   - 34-38: App Engineer에게 넘기는 줄에 "App Engineer가 설계하고 직접 짓는다"를 붙인다.
   - 47-51: "and tickets with `ticket.list`"를 지운다.
   - 57-58: "Those belong to the app's App Engineer and its coding agent."를 "Those belong to the app's App Engineer."로 고친다.
3. PM 지침(`project-manager/prompt.md`)
   - 67-70: 괄호의 "a ticket, "를 지운다.
   - 93-94: "no tickets, blueprint, release, coding agent hand-over"를 "no blueprint, release or app code"로 고친다. 앱 일은 그 앱의 App Engineer가 직접 짓는다는 뜻이 남게 한다.
4. lophn guide(사람에게 하는 설명이다. 2인칭 "you"는 사람이다)
   - `artifact.md` 133-136: "which is coding agent work. The App Engineer writes a ticket for it."를 "which the App Engineer of an app builds"로 고친다.
   - `roles-and-grants.md` 22-25: App Engineer는 앱을 설계하고, 코드와 blueprint를 쓰고, preview에서 확인하고 release를 올린다. 50-51: 다른 domain이 쓰는 공개 tool을 지우는 release는 막히지 않는다. App Engineer가 release를 준비할 때 쓰는 쪽을 보고 정한다.
   - `features-and-screens.md` 27-29: "You do not instruct the coding agent directly."를 지우고 App Engineer가 직접 짓는다고 쓴다.
   - `domains.md` 41-43: "A release that removes a public tool another domain uses is blocked, and the users of a tool that changed are told."를 위 `roles-and-grants.md` 50-51과 같은 뜻으로 고친다(바뀐 tool의 쓰는 쪽에게 알리는 reaction은 `problem-remove`가 지웠다).
   - `questions-and-decisions.md` 33-34와 `instructions.md` 4는 사람이 터미널 탭에서 쓰는 자기 coding agent 이야기라 그대로 둔다(PRODUCT 6절).
5. `prompts.ts`(위 "내놓는 것"의 planner 결정)
   - 44줄 `- <lophn-reaction> is a fact lophn detected, …`를 지운다. 다른 줄은 고치지 않는다.
   - 34-35줄 주석의 "여덟 tag의 이름은 protocol의 INPUT_TAGS와 같아야 한다"를 고친다(지금도 `INPUT_TAGS`는 일곱이다): 설명하는 tag의 이름은 `INPUT_TAGS`에 있어야 하고, reaction은 받을 agent가 없어 설명하지 않는다.
6. `place-data.ts` 77-78: `app_engineer`의 글을 "Designs, builds and releases the app, and looks after its domains."처럼 tickets 없이 고친다.
7. `credentials.ts` 80-83 주석: "담당 앱이 아닌 문제·ticket 같은 자료"를 지금 있는 자료(release, 앱 log, invocation)로 고친다.
8. 위험 test: 없음(지침 글).

## 끝남

- `deno task check`가 통과한다.
- `wc -l packages/core/agent-roles/roles/app-engineer/prompt.md`가 140 이하다.
- 남지 않음
  - `git grep -n -i -E "ticket|claim|examples|coding agent|coding_agent|reaction" -- packages/core/agent-roles/roles packages/core/agent-roles/place/place-data.ts packages/core/agent-roles/credentials.ts`가 다음만 남긴다: `prompts.ts` 41줄의 "claims to come from"과 34-35줄 주석의 reaction, `lophn/prompt.md` 80줄의 "A claim in a plan"(주장이라는 뜻), `lophn/guides/questions-and-decisions.md`와 `instructions.md`의 사람 coding agent, `place-data.ts`의 `session.role === "coding_agent"`. 그 밖은 보고한다.
  - `git grep -n "lophn-reaction" -- packages/core/agent-roles`가 0줄이다.
  - `git grep -n -i "blocked" -- packages/core/agent-roles/roles/lophn/guides/domains.md packages/core/agent-roles/roles/lophn/guides/roles-and-grants.md`에 공개 tool 막기 줄이 없다.
- 지침의 tool 이름이 모두 있다: ``grep -o '`[a-z_]*\.[a-z_]*`' packages/core/agent-roles/roles/app-engineer/prompt.md | sort -u``의 이름이 모두 위 "쓰는 것" 목록에 있고 `packages/core/agent-roles/tool-lists.ts`의 `app_engineer` 목록(`builtinToolNames("app_engineer")`)에 있다. file 이름(`DESIGN.md`, `blueprint.ts`, `AGENTS.md`)과 SDK 이름은 빼고 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(목록 file을 고치지 않는다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(새 지침의 절 이름)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 다른 ab- task의 tool 설명과 지침이 다른 곳(land한 tool 이름이나 출력이 계약과 다르면 여기 적는다)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
