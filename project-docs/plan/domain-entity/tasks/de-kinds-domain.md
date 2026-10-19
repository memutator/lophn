# de-kinds-domain

kind 파일(`kinds.yaml`)을 project마다에서 domain마다로 옮긴다. 자리는 `<data>/domains/<dom>/kinds.yaml`, glob은 그 domain이 속한 그릇의 폴더 기준(project면 등록 폴더들, 앱이면 그 앱의 source 폴더)이다. `kind.get`·`kind.list`·`kind.check` route와 내장 tool이 domain을 받고, 위반 problem(`project_problems`)과 `KindViolationFound`도 domain 단위가 된다. 위반을 받는 agent는 domain 그릇의 PM(project) 또는 App Engineer(앱)다.

- 단위: domain-kinds (wave 2)
- 선행: de-routing-events, de-turn-domains. 앞의 것은 reactor의 `agentOfDomain`, 뒤의 것은 `buildKindText`·`ToolContext.domains`와 `place-data.ts`의 kind 호출을 먼저 맞춘다.
- 소유(이 task만 고친다):
  - `packages/protocol/projects/{kinds-api,kinds-file,kinds-file_test,kinds-work}.ts`
  - `packages/protocol/problems/{project-problems.ts,domain-problems.ts}`
  - `packages/protocol/problems/mod.ts`
  - `packages/core/projects/kinds/`
  - `packages/core/problems/project/`
  - `packages/core/problems/domain/`(새 폴더. `project/`를 옮긴다)
  - `packages/core/problems/register.ts`
  - `packages/core/problems/agent-tools.ts`
  - `packages/core/agent-roles/tools/{kind,kind_test}.ts`
  - `packages/core/agent-roles/skills/kinds-yaml/`
  - `packages/core/main/daemon/wiring/kinds.ts`
  - `tests/eval/restore/kinds.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/kinds.md`(전체. 이 task가 "project"를 "domain"으로 바꾸는 문서다), `project-docs/architecture/layers.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `kinds`, `problems`, `project-docs/module-catalog.yaml`의 `packages/core/projects`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > kind 파일", `project-docs/products/roadmap/domain.md`의 "domain이 가진 것"
  - 본보기(코드): `packages/core/projects/kinds/host/{dispatcher,handlers,watch/service}.ts`, `worker/run.ts`(96째 줄 `kinds_file` 검사), `packages/core/main/daemon/wiring/kinds.ts`, `packages/core/problems/project/{commands,reads,schema,model}.ts`
- 계약:
  - 쓰는 것: `domainKindsFile(dataRoot, domain)`·`DOMAIN_KINDS_FILE`(`packages/protocol/domains/paths.ts`), `packages/core/domains/lookups.ts`의 `domainOwnerOf`·`activeDomainIds`, `ToolContext.domains`(`de-turn-domains`가 채운다. 이 task의 tool은 이 목록을 믿는다), `packages/core/projects/lookups.ts`의 `projectRootsOf`, `packages/core/apps/lookups.ts`의 `appSourcePath`
  - 내놓는 것
    - route: `kind.get`·`kind.list`·`kind.check`의 입력이 `{domain: dom_…, query?}`다. 출력은 같다(위반의 `path`는 "그릇 폴더 기준 상대 경로"다).
    - problem: `problem.sync_domain`(`problemSyncDomain`, 입력 `{domain, violations, truncated}`, machine 전용), `problem.list_domain`(`problemListDomain`, 입력 `{domain, state?, cursor?, limit?}`, 출력의 각 problem에 `domain`), 표 `domain_problems`(`project` 열이 `domain`)다. `problem.sync_project`·`problem.list_project`와 `project_problems`는 없어진다.
    - event: `KindViolationFound {domain, count}`(subject는 domain id). `de-routing-events`가 만든 reactor가 그 domain의 owner(project면 PM, 앱이면 App Engineer)를 부른다.
    - tool: `kind.list`·`kind.check`와 `problem.list`가 입력 `domain`(그 agent의 `ctx.domains` 안)을 받는다. `ctx.domains`가 한 개뿐이면 `domain`을 생략할 수 있고, 둘 이상인데 생략하면 `invalid_input`("pass domain: <이름 목록>")이다.

## 할 일

1. protocol: `kinds-api.ts`의 세 route 입력과 출력의 `project`를 `domain`(`domainIdSchema`)으로, `kinds-work.ts`의 worker 요청의 `project`를 `domain`으로 바꾼다. `kinds-file.ts`의 `kindsFilePath`는 지우지 않는다(`de-place-info`가 `place-folders-glue`를 옮긴 뒤 cleanup이 지운다). 새 코드는 `domainKindsFile`을 쓴다. `project-problems.ts`를 `domain-problems.ts`로 옮기며 위 이름으로 바꾸고 `problems/mod.ts`의 export 한 줄을 맞춘다. `protocol/events/domain.ts`의 `kindViolationFound`만 `{domain, count}`로 바꾼다(그 file의 다른 event는 다른 task의 몫이다).
2. kinds worker·host: `core/projects/kinds/` 아래 모든 `project` 키를 `domain`으로 옮긴다(dispatcher의 `inflight`·`last`·`reported` 맵, `request`의 `reads`·`kinds_file`, index 표 `derived/kinds.sqlite`의 키, scan, watch). worker는 요청의 `kinds_file`이 `domainKindsFile(dataRoot, domain)`이 아니면 거절한다(지금 `kindsFilePath` 검사와 같다). 개발 data는 새로 만든다(index는 파생이라 migration이 없다).
3. 조립 `wiring/kinds.ts`: `roots(domain)`·`rootsOf(domain)`은 `domainOwnerOf`로 owner를 읽어 project면 `projectRootsOf`(활성 project의 등록 폴더들), 앱이면 `[appSourcePath]`(source가 연결돼 있고 앱이 active일 때), 그 밖은 null(→ `not_found`)이다. 감시 목록(`list: () => activeProjectRoots`)은 `activeDomainIds`마다 같은 규칙으로 만든 `{domain, roots}`다. kinds 파일 폴더 감시는 domain 폴더(`domainFolder`)를 본다. 폴더가 아직 없으면 `ensure`하지 않는다(처음 쓰는 agent가 만든다. 부모 폴더 생성은 `place-info`가 turn 시작에 한다).
4. handler(`host/handlers.ts`): agent 자격(`ctx.conditions.project` 또는 `ctx.conditions.app`)이 있으면 그 domain의 owner와 같을 때만 읽는다(다르면 `not_found`). 조건이 없는 agent는 `forbidden`이다. user·machine은 그대로다.
5. 조립 `wiring/kinds.ts`의 `operations`(machine 전용 policy)는 `problemSyncDomain.name`으로 바꾼다.
6. problem: `core/problems/project/`를 `core/problems/domain/`로 옮겨 이름을 맞춘다(`syncDomainProblemsCommand`, `diffDomainProblems`, 표 `domain_problems`, schema step, `register.ts`). `problems/register.ts`의 import를 맞춘다. 위반을 올리는 command가 새로 열렸거나 다시 열린 것이 있을 때 `KindViolationFound {domain, count}`를 낸다. dispatcher의 `report`는 `problemSyncDomain`을 부른다.
7. tool: `agent-roles/tools/kind.ts`의 `projectOf(ctx)`를 `domainOf(input, ctx)`로 바꾸어 위 규칙으로 domain을 고르고 `ctx.domains`에 없으면 `invalid_input`으로 거절한다(core를 부르지 않는다). 설명 글의 "this project"를 "this domain"으로 고친다. `problems/agent-tools.ts`의 `problem.list`는 `project` 입력을 `domain`으로 바꾸고 같은 규칙을 쓴다. `kind_test.ts`를 새 규칙으로 쓴다.
8. skill 본문: `agent-roles/skills/kinds-yaml/SKILL.md`와 그 폴더 안 글의 "project"를 "domain"으로 바꾼다("kinds.yaml은 domain 폴더에 있고 glob은 그 domain 그릇의 폴더 기준이다. 쓰는 것은 그 domain 그릇의 PM이나 App Engineer다").
9. `tests/eval/restore/kinds.ts`가 `kindsFilePath(home, project)`로 kinds 파일을 놓던 것을 `domainKindsFile(home, domain)`으로 바꾼다(입력의 `project` → `domain`). 쓰는 eval 자료의 모양은 이 계획 뒤에 다시 만든다.
10. 쓰는 쪽 한 곳을 맞춘다: `packages/core/agent-roles/place/place-data.ts`의 `readOf(call, kindGet, { project: place.id })` 블록은 입력이 바뀌어 type 오류가 난다. 그 블록만 걷어 내(`kinds`는 null, `kindsFile`은 그대로) compile을 맞춘다. domain별로 읽어 글을 만드는 일은 `de-place-info`가 다시 쓴다. 이 줄은 "넘길 줄"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "project에 속한 domain 둘 가운데 하나만 `ctx.domains`에 든 agent는 다른 domain의 `kind.list`를 부를 수 없고 core를 부르지도 않는다. domain이 둘인데 생략해도 거절된다" — `packages/core/agent-roles/tools/kind_test.ts`
  - "자격 그릇이 owner가 아닌 domain의 kind 읽기는 `not_found`다" — `packages/core/projects/kinds/host/handlers_test.ts`(새 file)
  - "위반 problem은 domain마다 따로 열리고 닫힌다. 한 domain의 위반이 다른 domain의 problem을 닫지 않는다" — `packages/core/problems/domain/commands_test.ts`
- 남지 않음: `grep -rn "project_problems\|sync_project\|list_project\|problemSyncProject\|problemListProject" packages tests tools`가 0줄이다. `grep -rn "kindsFilePath" packages`는 `place-folders-glue.ts`와 protocol 정의만 남는다(보고에 적는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`core/problems/register.ts`의 import는 이 task가 고쳤다)
- 안 쓰게 된 export: `kindsFilePath`, `activeProjectRoots`
- 정한 것: 앱 그릇의 roots가 source 없는 앱에서 비는 처리, 위반 problem 표의 정체성 key
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: `place-info`가 `kindGet`을 domain 입력으로 부르기 전까지 prompt의 kind 글이 비어 있다
