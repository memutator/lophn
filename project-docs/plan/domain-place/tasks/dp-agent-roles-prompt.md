# dp-agent-roles-prompt

role 지침과 prompt의 place 정보에서 App Engineer를 지우고 그 일을 Project Manager(PM) 지침으로 합친다. `packages/core/agent-roles/roles/app-engineer/prompt.md`를 `packages/core/agent-roles/roles/project-manager/prompt.md`에 합치고, PM의 place 정보가 그 project 앱의 이름·목적·source·blueprint·활성 release의 app-api를 보인다. lophn 지침과 guide는 "앱을 만들 때 project를 고른다, 맞는 project가 없으면 사람에게 묻는다"로 고친다.

- 단위: role-merge (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/`
  - `packages/core/agent-roles/commands.ts`
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/agent-roles/place/place-info.ts`
  - `packages/core/agent-roles/place/place-info_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(prompt 조립, place 정보), `project-docs/architecture/place-session.md`, `project-docs/architecture/annotation.md`, `project-docs/architecture/coding-agent.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것"(앱과 project, PM이 App Engineer의 일을 맡는다, annotation), `project-docs/products/AGENT-ROLE.md`의 A1~A16(C 줄로 옮길 내용), L2~L4, L8, `project-docs/products/roadmap/domain.md`의 "role"
- 계약:
  - 쓰는 것: `dp-app-project`의 `App.project`(`appList`/`appGet` 읽기), PM 자격이 읽는 `appList`는 자기 project의 앱만 돌려준다(`dp-agent-roles-scope`의 `conditions.app`)
  - 내놓는 것: `rolePrompt("app_engineer")`가 없다. PM 지침이 App Engineer의 일을 모두 가진다. prompt의 place 정보에 PM이 보는 "App:" 줄이 있다.

## 할 일

1. `packages/core/agent-roles/roles/project-manager/prompt.md`에 `packages/core/agent-roles/roles/app-engineer/prompt.md`의 절을 합친다. 합치는 방법:
   - 소개를 "Project Manager of one project … and of that project's app (one app at most)"로 고친다.
   - "When you start work": 사람·다른 agent·coding agent의 메시지와 reaction(problem 열림·다시 열림, 반복 종료, activation 실패), coding agent의 완료 보고·claim 만료·보고 없는 종료, 앱 화면 annotation을 PM이 받는다고 쓴다.
   - "What you do"에 App Engineer 항목(질문, blueprint와 package, ticket과 examples, coding agent에 맡기기, 검증, problem, annotation, Operator 만들기)을 옮기고, "this app" 표현은 "this project's app"으로 한다. 앱이 아직 없는 project에서 사람이 앱을 원하면 PM은 앱을 만들지 못하고 lophn에게 `call`로 맡긴다(앱 등록은 lophn만).
   - coding agent는 `to:{role:"coding_agent", place:{app:<앱 이름>}}`로 부른다. 문장은 App Engineer 것을 그대로 쓴다.
   - "Operator를 청하면"은 두 prompt에 겹치니 한 번만 쓴다("한 project의 Operator만, 접근은 사람이 준다").
   - 이 task는 context 절(`What a context is made of` 등)을 고치지 않는다(`domain-kinds`가 다시 쓴다). 새 절은 context 절 앞뒤에 끼워 넣고 context 문장은 그대로 둔다.
   - "skill" 한 항목을 더한다: PM은 `<data>/projects/<prj>/skills/`의 project skill을 file tool로 쓰고 고친다.
2. `packages/core/agent-roles/roles/app-engineer/prompt.md`와 폴더를 지운다. `packages/core/agent-roles/roles/prompts.ts`의 import와 `ROLE_PROMPTS`의 `app_engineer` 줄을 지운다.
3. `packages/core/agent-roles/roles/operator/prompt.md`: "In an app place you can read the app's source folder"와 "that app's App Engineer" 줄을 지우고 "버그나 모자란 기능은 그 project의 Project Manager에게 `call`"로 바꾼다. 앱 place 문장을 지운다.
4. `packages/core/agent-roles/roles/lophn/prompt.md`, `packages/core/agent-roles/roles/lophn/guides/{features-and-screens,roles-and-grants}.md`, `packages/core/agent-roles/roles/guides.ts`: "hand it to that app's App Engineer"를 "그 앱의 project의 Project Manager"로, "register it first with `app.create`"를 "새 앱은 project를 골라 `app.create`(project를 준다) 뒤 PM에게 맡긴다. 맞는 project가 없으면 `ask`로 사람에게 project를 만들자고 묻는다. project는 사람만 등록하니 사람이 만든 뒤에 이어서 한다"로 고친다. Operator는 "그 project의 PM에게"만 남긴다. L3(새 project 비교)·L4 문장과 어긋나지 않게 `project-docs/products/AGENT-ROLE.md`의 L 줄을 따른다.
5. `commands.ts`: `ROLE_COMMANDS`의 `app_engineer: []`는 type이 요구하는 동안 남긴다(지우는 것은 `dp-place-protocol`). `NEW_APP_PROMPT`("I want to start a new app in this project")를 "새 앱을 시작한다. 어느 project에 둘지 같이 정한다"는 뜻으로 고친다.
6. `packages/core/agent-roles/place/place-data.ts`: `readPlaceData`의 `place?.kind === "app"` 갈래(153~176째 줄)를 project place의 앱 읽기로 바꾼다. project place이고 role이 PM이면 `appList`에서 `project`가 그 project인 앱 하나를 읽어 `app`(이름, 목적, source, blueprint 경로)과 활성 release의 app-api 이름들(`appAppApi`, `release`)을 채운다. `labelOf`(앱 label 갈래)와 sendable 후보의 `appsRead` 반복문(303~320째 줄, `add({ role: "app_engineer", … })`)을 지우고, `ROLE_LINE`(48째 줄)의 PM 줄을 "Looks after the project's folders, its app and its skills."로 고친다(`app_engineer` 줄은 type이 요구하는 동안 남긴다). 이 file은 `domain-kinds`(context 글)와 `artifact`(artifact 목록)도 고친다. 그 줄은 건드리지 않는다.
7. `packages/core/agent-roles/place/place-info.ts`: `ROLE_LABEL`의 `app_engineer`는 남기고, `placeLines`의 앱 place 문장(95~110째 줄, 99째 줄의 `data.self.role === "app_engineer"` 갈래 포함)과 release 줄(162째 줄)을 PM이 보는 project place의 "App:" 줄로 옮긴다. `place-info_test.ts`를 맞춘다.
8. 위험 test는 두지 않는다(문구다).
9. 합집합이 아직 남아 있다: protocol의 `Role`·`Place`는 `dp-place-protocol`이 마지막에 줄인다. 그때까지 `app_engineer`·앱 place가 type에 있어 exhaustive `switch`나 `Record<Role, …>`가 오류를 내면 그 갈래만 새 로직 없이 남긴다(null, 빈 값). 남긴 곳은 보고의 "넘길 줄"에 file:줄로 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 아래가 0줄이다.
  - `grep -rn "App Engineer\|app_engineer" packages/core/agent-roles/roles packages/core/agent-roles/place/place-data.ts packages/core/agent-roles/place/place-info.ts`(type이 요구하는 `Record<Role, …>`의 빈 `app_engineer` 줄은 예외, 보고에 적는다)
  - `ls packages/core/agent-roles/roles/app-engineer`가 없다는 오류다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno task wording`이 필요하면 적는다(이 task는 wording catalog를 안 고친다)
- 안 쓰게 된 export
- 정한 것: PM이 coding agent를 부를 때 `place:{app}`는 앱 이름이다 / 앱이 없는 project에서 PM의 안내
- 넘길 줄: `domain-kinds`가 고치는 context 절과 `place-data.ts`의 context 줄은 그대로 뒀다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
