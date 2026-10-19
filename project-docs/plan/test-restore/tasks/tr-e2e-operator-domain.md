# tr-e2e-operator-domain

새 e2e flow 하나를 `operator_test.ts`에 더한다: Operator를 domain 하나로 좁히면 agent runtime child가 낸 model 요청의 prompt(`DOMAIN.md`)와 tool 목록에 그 domain 것(과 다른 domain의 public tool)만 있다.

- 단위: e2e (wave 1)
- 선행: tr-e2e-app-tools. 그 task가 다시 쓴 `operator_test.ts`의 준비 위에 얹는다.
- 소유(이 task만 고친다):
  - `tests/e2e/operator_test.ts`
  - `tests/support/app/patch-domain.ts` (새 file. 둘째 domain의 tool을 선언하는 patch)
  - 제품 bug일 때만: `packages/core/lophn-agent/agents/resolve.ts`, `packages/core/lophn-agent/instructions/`, `packages/core/lophn-agent/tools/app-public.ts`, `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - `AGENTS.md`, `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/domain.md`("흐름"의 `turn ── ResolvedAgent.domains` 묶음, "지키는 것"의 `DOMAIN.md`·비공개 tool 줄), `project-docs/architecture/agent-definition.md`("agent 정의의 `domains`와 `skills`는…" 줄, "`DOMAIN.md`는 그 agent가 맡은 domain의 것만…" 줄), `project-docs/architecture/testing.md`(앱 길, fake server, case 고르는 규칙)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `domains`·`agents`·`agent-tools`·`run-loop`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`(`lophn-agent`)·`packages/core/domains`(`domains`)
  - 코드: `packages/core/lophn-agent/instructions/turn.ts`(domain 층은 맡은 domain의 `DOMAIN.md`를 이름순으로 `## <name>` 아래 잇는다), `packages/core/main/daemon/place-folders-glue.ts`의 `runtimeFoldersOf`(모든 active domain 폴더가 agent runtime child의 권한에 든다), `packages/shell/main/editor/instructions.ts`(사람은 `DOMAIN.md`를 `<data root>/domains/<dom>/DOMAIN.md` 보통 파일로 저장한다)
  - `tr-e2e-app-tools`의 보고와 merge된 `operator_test.ts`(`operatorWith`)
- 계약:
  - 쓰는 것: `tests/support/app/activate.ts`의 export(고치지 않는다), `packages/protocol/domains/domains.ts`의 `domainCreate`, `packages/protocol/lophn-agent/agent-definitions.ts`의 `operatorCreate`, `packages/protocol/lophn-agent/operators.ts`의 `operatorDefinitionSchema`(definition `domains`)

## 할 일

1. **`tests/support/app/patch-domain.ts`를 만든다.** `export function domainPatch(domain: string): AppPatch`(`AppPatch`는 `tests/support/app/source.ts`). 받은 domain 이름으로 read tool 둘을 더한다. 하나는 `public: false`, 하나는 `public: true`다(예: `shelf_list`, `shelf_count`).
   - 둘 다 `effect: "read"`, `inputSchema: null`이다. 자리는 `patch-rewind.ts`와 같다. blueprint는 `      {\n        name: "add_item",` 앞에, handler는 `src/tools.ts`의 `  tool("add_item", addItemHandler(deps));` 뒤에 둔다.
   - handler는 `readResult([], { coverage: "complete", freshness: "fresh" })`를 돌려준다. template이 이미 `readResult`를 import한다. 선언과 등록 handler가 같아야 platform app test가 통과한다.
   - 머리 주석에 무엇을 왜 더하는지 쓴다.
2. **준비를 바꾼다(`operator_test.ts`).** `activateTestApp(core, fake, { name: "Notes", slug: "notes" })`를 아래 순서로 푼다. 근거: domain.md "release 준비·activation 직전 재검사 ── 앱의 active domain 이름 안에 있어야 한다".
   1. `startTestApp(core, fake, { name: "Notes", slug: "notes", patch: domainPatch(SECOND) })`. `SECOND`는 slug이고 모든 domain에서 하나인 이름이다(예: `notes-shelf`). `app.create`가 이미 `notes`를 만들었다.
   2. `const before = await runtimePids(core.run.home)`(`tests/support/core/process.ts`)
   3. `core.call(domainCreate, { name: SECOND, title, purpose, owner: { kind: "app", id: app.app } })`
   4. `await settle(core, before)`(`tests/support/core/human.ts`). 새 domain 폴더가 runtime 권한(`runtimeFoldersOf`)에 들어 core가 agent runtime child를 다시 띄운다. 그 사이 시작한 App Engineer turn은 끊긴다. settle이 30초 안에 안 끝나면 다시 띄우지 않은 것이니 `runtimeFoldersOf`를 본다.
   5. `deliverRelease(core, fake, app, { goal: "Make the first release of the app" })`
   6. `approveActivation(core, app)`
   7. `waitRunning(core, app, release)`
3. **이미 있는 행의 기대 목록을 맞춘다.** 정의에 `domains`가 없는 Operator는 앱의 두 domain을 다 맡아 patch tool 둘도 받는다. tool 행과 excluded 행의 기대 목록에 그것을 더하고 정렬해서 견준다. grant-added·no-grant 행은 그대로 서는지 본다.
4. **새 행 `domain-narrowed`를 더한다.** 단계 6, fake 대답 1, 단정 3 이하다(testing.md 규칙 4).
   - domain id: `core.call(domainList, { owner: { kind: "app", id }, status: "active" })`(`packages/protocol/domains/mod.ts`)에서 이름이 `app.slug`인 것(FIRST)과 `SECOND`를 찾는다.
   - `DOMAIN.md` 둘: 사람이 editor로 저장하는 것처럼 `domainDocFile(core.run.home, <id>)`(`packages/protocol/domains/paths.ts`)에 직접 쓴다. 먼저 `domainFolder`를 `mkdir -p`한다. 본문은 서로 다른 표지 글이다. domain 이름, title, purpose와 겹치지 않게 한다(그것들은 place 정보와 tool 이름에도 실린다).
   - Operator: `operatorWith`에 정의 `domains`를 넘길 선택 인자를 더한다. 앱 place, grant `[{ kind: "app", app: id, tools: [] }]`, `domains: [FIRST.id]`로 만든다. 정의의 `domains`는 이름이 아니라 id(`dom_`)다(`packages/protocol/lophn-agent/agent-values.ts`). 이름을 받는 것은 agent tool `operator.create`뿐이다.
   - `fake.reset()`, `fake.script([text])`, `say`, `waitTurnEnd`.
   - 단정은 `fake.journal()[0]`(agent runtime child가 낸 요청)에 건다.
     - (a) `systemText`에 FIRST의 표지가 있고 SECOND의 표지가 없다.
     - (b) 앱 tool 이름(`domain__` 접두, 끝 이름만 정렬)이 `["add_item", "list_items", <SECOND의 public tool>]`이다. SECOND의 비공개 tool은 없다.
5. **머리 주석에 이 행의 세 질문을 한 줄씩 더한다(testing.md 규칙 1).**
   - contract: `domains`·`agents`·`agent-tools`
   - 현실적 회귀: child의 `callerDomains`(`product-driver.ts`)가 `resolve.ts`의 `workingDomains`와 갈라져 좁힌 domain이 tool 목록에 닿지 않는 것. 맡지 않은 domain의 `DOMAIN.md`나 비공개 tool이 실리는 것.
   - 왜 지금 test로 못 잡나: `app-public_test.ts`, instructions의 `turn_test.ts`, resolve의 unit은 domain 집합을 입력으로 받는다. 정의 file → child가 machine 자격으로 읽는 정의 → model 요청은 process를 건너야 보인다.
6. **시간을 잰다.** 이 task 전후의 `operator_test.ts` 시간을 견준다. 더하는 몫(domain 하나, settle, turn 하나)은 10초 안이다.

## 끝남

- `deno task check:full`이 통과한다.
- `deno task e2e:deps`를 한 번 돌린 뒤 `deno test --allow-all --no-check tests/e2e/operator_test.ts`가 10번 연속 통과한다.
- 더한 몫이 10초 안이다(전후 시간을 보고에 적는다).
- 끝난 뒤 `/tmp/lophn-e2e-*`가 남지 않고, `pgrep -af daemon/main.ts`에 그 run의 core가 없다.
- 위험 test: "domain 하나로 좁힌 Operator의 model 요청에는 그 domain의 `DOMAIN.md`와 tool, 다른 domain의 public tool만 있다"(이 e2e 행). 제품 bug를 찾으면 test를 맞추지 않고 소유한 제품 file에서 고친다. 그리고 가장 싼 층(resolve·instructions·`app-public_test.ts`)에 그 bug 한 행을 더한다.
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check, 10번 연속 결과, 전후 시간
- 등록할 것: 없을 것이다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 둘째 domain 이름과 tool 이름, `DOMAIN.md`를 test가 직접 쓴 것(사람의 editor 길과 같다), 이미 있는 행의 기대 목록을 바꾼 방식
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `activate.ts`를 바꿔야 하면 고치지 말고 여기 적는다(그 file은 `tr-e2e-coding-mcp` 소유다)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
