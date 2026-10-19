# dp-usage-read

"어느 project가 어느 앱의 어느 공개 tool을 쓰나"(사용 관계)를 program이 결정적으로 뽑는 읽기 `app.usage`와 core 안에서 부르는 함수 `appToolUsers`를 둔다. 재료는 agent grant(grant가 열려 있는 쪽)와 invocation 기록(실제 부른 쪽, 부른 session이 놓인 project)이다. lophn 지도(`dp-lophn-map`)와 release 막기(`dp-release-guard`)가 쓴다.

- 단위: map (wave 3)
- 선행: 없음. wave 3은 계획 `domain-tools`의 계약 task(blueprint `public` 칸)가 main에 land한 뒤에 연다. planner(`lophn-7e`)가 land를 알려 준 뒤 띄운다. invocation의 호출 tool 이름 칸과 `project` 칸 삭제는 `domain-tools`가 바꾸므로 그 모양을 먼저 읽는다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/usage.ts` (새 file)
  - `packages/core/apps/usage/` (새 폴더)
  - `packages/core/approvals/grants/usage.ts` (새 file)
  - `packages/core/main/daemon/wiring/apps-usage.ts` (새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(invocation 기록), `project-docs/architecture/approval.md`(agent grant), `project-docs/architecture/layers.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `approvals`, `agent-sessions`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > lophn 지도", `project-docs/products/roadmap/domain.md`의 "role"(사용 관계)
- 계약:
  - 쓰는 것: `invocations` 표(`packages/core/apps/invocations/schema.ts`. 칸 `app`, `operation`, `caller_kind`, `session`)를 읽기만 한다(`domain-tools` 소유). `agent_grants` 표(`packages/core/approvals/grants/schema.ts`)와 `sessions` 표의 `place_id`. 쓰는 tool 선언의 `public` 칸(`domain-tools` 계약).
  - 내놓는 것:
    - 읽기 route `appUsage`(`packages/protocol/apps/usage.ts`의 export, 이름 `app.usage`, resource `apps`, method `usage`): 입력 `{ app?: Id<"app"> }`, 출력 `withReadCommon({ uses: { app: Id<"app">, tool: string, project: Id<"prj">, source: "grant" | "invocation" }[] })`. `project`는 쓰는 쪽 project이고 그 앱 자신의 project는 싣지 않는다. 정렬은 (app, tool, project, source). 이 read의 actors는 `user`, `machine`, `agent`다. agent는 lophn session일 때만 읽는다.
    - `packages/core/apps/usage/`의 함수 `appToolUsers(sql, ports, app): { tool, project, source }[]`(release 막기가 같은 tx에서 부른다).
    - tx·snapshot port `usagePorts`(`packages/core/apps/usage/ports.ts`): `sessionPlace(session): { role, project | null } | null`, `agentProject(agent): Id<"prj"> | null`(PM은 자기 project, Operator는 정의의 place, lophn은 null).

## 할 일

1. `packages/protocol/apps/usage.ts`에 route를 정의한다(`defineRead`, `withReadCommon`, 오류는 `readErrors`와 같은 목록). 등록은 lead가 `packages/protocol/apps/registry.ts`의 `ROUTES`에 더한다.
2. `packages/core/approvals/grants/usage.ts`: `agent_grants` 표에서 앱 항목 `{ kind: "app", app, apis }`을 가진 agent를 모은다. 앱 항목에서 해당 tool이 `excluded`가 아니면 쓰는 것으로 센다. agent는 `agentKey`(canonical JSON)로 저장되므로 `AgentRef`로 풀어 돌려준다.
3. `packages/core/apps/usage/`: `appToolUsers`를 쓴다. grant 쪽은 `agentProject`로 project를 얻고, invocation 쪽은 `invocations`에서 `caller_kind = 'agent'`인 행의 호출 tool 이름과 `session`을 모아 `sessionPlace`로 project를 얻는다. 앱 자신의 project(`appProjectOf`)는 뺀다. `reads.ts`가 route handler다. 값은 이름순으로 정렬해 같은 재료가 같은 bytes가 되게 한다.
4. `packages/core/main/daemon/wiring/apps-usage.ts`(새 wiring): `usagePorts`를 `sessions` 표(`place_id`, `role`), PM의 project, `placeDepsOf(sql).operators`(Operator 정의의 place)로 꽂는다. wiring 목록(`assembly.ts`) 등록은 lead다.
5. 위험 test는 두지 않는다(읽기 조회다. 판정은 `dp-release-guard`가 시험한다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/protocol/apps/registry.ts`의 `ROUTES`, `packages/protocol/apps/mod.ts` export, `packages/core/main/daemon/assembly.ts`의 wiring 목록, reader 등록(`apps-usage.ts`가 reader Worker에 들어가야 하면 team 등록 file)
- 안 쓰게 된 export
- 정한 것: `app.usage`를 읽는 agent는 lophn session만 / grant와 invocation을 합쳐 센다 / 앱 자신의 project는 뺀다
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
