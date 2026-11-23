# cascade: 삭제와 계약 변경의 결정적 정리와 lophn 인계

상태: 로드맵 초안. 2026-11-23 사람이 방향을 냈고 planner가 썼다. 사람의 결정은 보류한 채("정할 것")로 두었다. `(agent)`로 적은 것은 planner가 기존 원칙과 코드 근거로 적어 둔 안이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/{PRODUCT.md,products/AGENT.md}`, `project-docs/architecture/{app-call,event,agent-definition,artifact,workflow,job,app-notice}.md`, `project-docs/products/roadmap/{sdk-update-checkpoint,platform-update}.md`.
조사: main `cc1d741db` 코드 조사(2026-11-23).

## 사람의 말 (원문)

2026-11-23:

> 그리고 또 지금 cascade 관련해서 너무 빈약해
> 예를 들면 artifact가 삭제되면 그에 관한 memory를 지운다거나
> agent를 지우면 그 agent가 참여된 workflow를 수정해야한다거나
> 또 특정 event를 발생하는 앱이 있는데 그럼 그걸 구독하는 쪽에서 또 수정해야한다거나
> 사실 이것도 그냥 프로그램적으로 (결정적으로) 가능한 부분들이 있겠지만 lophn한테 인계해주는 흐름도 필요하다는거지

> 일단 작성해줘 결정은 보류한 채로

## 왜

- 사용자의 작업 공간에 앱, agent, workflow, artifact, job, memory가 쌓이면서 자원들이 서로를 가리킨다. 하나를 지우거나 공개 계약(command, skill, event)을 바꾸면 가리키던 쪽이 깨진다.
- `PRODUCT.md` §3의 책임 분배대로 cascade도 두 층이어야 한다:
  1. **결정적 정리(program)**: 판단할 여지가 없는 고아 데이터·권한·죽은 스케줄은 삭제·변경과 같은 동작에서 program이 즉시 치운다.
  2. **의미적 인계(lophn agent)**: 대체할 agent를 고르거나, 바뀐 event payload에 맞춰 구독 코드를 고치거나, 자유 글인 `memory.md`에서 지워진 artifact 문맥을 덜어내는 일은 program이 할 수 없으므로 **영향받는 대상을 program이 결정적으로 뽑아 lophn에게 인계(handoff)** 해야 한다.
- 지금은 `app.delete` 한 곳만 손으로 엮어 두었고, 나머지 삭제·변경에는 정적 참조 조회도 인계 흐름도 없어 죽은 참조와 유령 기억이 조용히 쌓인다.

## 지금 코드

### 1. 앱 영구 삭제와 보관 (`apps-delete.ts`, `app-call.md`)

- `packages/core/main/daemon/wiring/apps-delete.ts`(`eraseRemnants`, `cleanFiles`)가 유일한 cascade 조립이다. 한 Tx에서 앱 workspace의 session, 앱이 보낸 call, 앱 범위 agent 정의(앱 lophn 포함), 다른 agent의 할당(`apps`와 `permissions.deny`), 관련 job(`eraseJobsOfApp`), 공유 요청, 폰 sync log를 지우고, commit 뒤 폴더·bundle·`shell.*` 설정 5종을 지우며 `AppRemoved`를 낸다.
- **빈 곳**:
  - 이 앱의 command를 `app_connections`에 선언했거나 이 앱의 event를 `subscriptions`에 선언한 **다른 앱**, 이 앱의 tool을 부르는 **project workflow(`flow.ts`)**, 다른 그릇 `memory.md`는 그대로 남는다.
  - 보관(`app.archive`) 때는 `apps-delete`가 돌지 않는다. 주기 `job`(`tool_run`)은 차례마다 실패하고, event `job`만 `job.list`를 읽을 때 `source_gone` 표시가 붙는다(`packages/core/jobs/reads.ts`).

### 2. Agent 삭제 (`packages/core/lophn-agent/agents/commands.ts`)

- `agentDelete`는 `<data>/agents/<id>.md`, avatar 이미지, `<data>/agent-memory/<id>.md` 파일 셋만 지운다(246~288줄).
- **빈 곳**:
  - **결정적 누락**: 정의 층 MCP secret(`secrets.json`의 `mcp.<agt_id>.*`, `mcp-oauth.<agt_id>.*`), `callPolicySetting`(`packages/core/config/setting-declarations.ts`)의 agent 쌍 규칙, 이 agent가 단독 실행 대상(`agent_run`)이거나 만든 `job`(`jobs` 표), 열린 session이 정리되지 않는다(`job`은 다음 차례마다 `not_found`로 실패).
  - **의미적 누락**: project `workflows/<name>/workflow.yaml`의 `participants`·creator `agent`나 `flow.ts`의 `agent("<handle>")`가 지운 handle을 가리켜도 아무 일도 일어나지 않고, 다음 실행 때 `not_handed`(`unresolved`) 줄로 멈춘다(`architecture/workflow.md` 불변식 21). skill과 `LOPHN.md`의 참조도 그대로 남는다.

### 3. Artifact 삭제 (`packages/shell/main/desktop/wiring/artifact.ts`)

- renderer가 `shell:artifact-delete` IPC로 Electron `shell` main의 `deleteArtifactFolder`를 바로 불러 `<data>/projects/<prj>/artifacts/<name>` 폴더만 지우고 열린 `<webview>`를 닫는다(192~215줄). **`core`를 아예 지나지 않는다.** 앱 artifact는 화면에서 지우는 입구도 없다(`architecture/artifact.md` 열린 것).
- **빈 곳**: `core`가 삭제를 모르므로 그 artifact를 주기적으로 새로 쓰던 `job`이나 수집 skill, 그리고 project `memory.md`·Home `memory.md`(workspace 지도)에 적힌 그 artifact 관련 메모가 영영 남는다.

### 4. Memory의 삭제 감시 (`packages/core/agent-workspaces/memory-names.ts`)

- 정규식 `/\b(?:app|prj|agt)_[0-9a-z]{26}\b/g`로 본문 앞 40개 ID만 찾아 turn마다 `- <id>: deleted app|project|agent` 줄을 memory block 끝에 덧붙인다.
- **빈 곳**:
  - ID가 없는 대상(`artifact` slug, `workflow` 이름, `skill`, `event`, 공개 `command`, ID 없이 이름으로만 적은 앱·agent)은 삭제되어도 전혀 알리지 못한다.
  - 감지된 `app_`·`prj_`·`agt_`도 누군가 그 workspace에서 다음번에 `agent.memory`를 고쳐 쓰기 전까지는 8 KiB 한도의 `memory.md` 파일 안에 그대로 남는다.

### 5. 앱 공개 계약·Event 변경과 사용처 조회 (`public-tools.ts`, `apps/usage/users.ts`)

- `packages/core/apps/releases/commands.ts`(667줄)와 `public-tools.ts`는 `release.prepare` 때 `removed_public_tools`와 `removed_public_skills`만 계산한다.
- **빈 곳**:
  1. **앱 event 추적이 없다**: 이전 활성 release에 있던 `events` 항목을 지우거나 `payloadSchema`를 바꿔도 아무 검사가 없다. 그 event를 `subscriptions`로 듣는 다른 앱, `trigger`로 건 `job`, `onEvent`로 듣는 `workflow`(`packages/core/workflows/event-subscriptions.ts`)가 조용히 끊기거나 스키마 불일치로 실패한다.
  2. **입출력 schema 변경 미감지**: 공개 command 이름을 둔 채 `inputSchema`나 `outputSchema`의 호환을 깨도 `removed_public_tools`는 빈 배열이다.
  3. **사용처(`appToolUsers`)가 과거 agent 호출 기록만 본다**: `invocations` 표에서 `caller_kind = 'agent'`만 조회한다(`users.ts` 97줄). 다른 앱 선언의 `app_connections`·`subscriptions`, `jobs` 표의 `tool_run`·`trigger`, project `workflows`의 참조는 agent가 직접 부른 적이 없으면 사용처에서 빠진다.
  4. **프롬프트에만 기댄 전파**: `prompts/app.md`(148줄)가 "activate 전에 Home에 물어보라"고 적고 있을 뿐, program이 인계를 기록하거나 완료 여부를 추적하지 않는다.

### 6. Workflow 삭제·이름 변경

- workflow는 파일 폴더(`<data>/projects/<prj>/workflows/<name>/`)라 이름 변경·삭제 시 `workflow_start` `job`은 다음 차례에 `not_found`로 실패하고, workflow desk layout도 어긋난다(이슈 `workflow-rename-merges-desk-into-main`).

## 무엇을 만드나

### 1. 정적 참조(Impact) 조회기 (`core`)

별도 동기화 캐시 표를 두지 않고, 삭제·변경·점검 시점에 현재 정본을 읽어 **"이 대상을 누가 쓰고 있는가"** 를 결정적으로 돌려주는 `core` 조회기와 read route를 둔다.

- 읽는 정본:
  - 모든 활성(필요시 보관 포함) 앱의 켜진 release 선언: `commands`, `skills`, `events`, `app_connections`, `subscriptions`
  - `jobs` 표: `creator_agent`, `creator_workspace`, `action`(`agent_run`, `tool_run`, `workflow_start`), `trigger`(event source·이름)
  - 활성 project의 `workflows/*/workflow.yaml`(참가자 `agent`, creator `agent`)과 `flow.ts`(정적 참조 패턴 또는 선언 연결)
  - agent 정의 파일(`apps`, `remote_apps`, `permissions`, `mcp_servers`)과 `callPolicy` 설정
  - Home·project·앱 `memory.md`와 agent memory(ID 매칭 + 대상 이름/경로 조각 매칭)
- `app.usage`도 과거 `invocations` 로그만이 아니라 이 정적 참조를 함께 돌려주도록 바꾼다.

### 2. 기점 명령의 `core` 일원화와 1단(결정적) Cascade

판단 여지가 없는 정리는 같은 Tx(파일·설정은 직후)에서 program이 끝낸다.

| 사건 | 결정적 정리 (Program) | 의미적 인계 대상 (lophn) |
|---|---|---|
| **Artifact 삭제** (`core` route로 이전, project·앱 공통) | 폴더 삭제(symlink 검증 유지), 열린 `<webview>` 닫기 신호 | 해당 그릇·Home `memory.md`의 언급 정리, 그 artifact를 갱신하던 `job`·skill 정리 |
| **Agent 삭제** (`agent.delete`) | 정의·avatar·agent memory 삭제 + 정의 층 `mcp.<agt>.*`·`mcp-oauth.<agt>.*` secret 삭제 + `callPolicy`의 해당 agent 규칙 제거 + 열린 session 닫기 + 관련 `job` 정리("정할 것" 3) | 참가자·creator로 참조하는 `workflow`(`workflow.yaml`, `flow.ts`) 수정, `memory.md`·skill 정리 |
| **앱 공개 계약·Event 변경/삭제** (`release.prepare` / `activate`) | 지워진 `command`·`skill`·**`event`** 및 호환 깨진 `inputSchema`·`outputSchema`·**`payloadSchema`** 판정, 영향 목록 산출 | 구독 앱(`subscriptions`), 호출 앱(`app_connections`), 관련 `workflow`·skill·`job` 수정 |
| **앱 보관 / 삭제** (`app.archive` / `app.delete`) | 삭제 시 지금 정리 유지, 보관 시 그 앱을 부르거나 듣는 `job` 멈춤/사유 표시 일원화 | 이 앱을 `app_connections`·`subscriptions`·`flow.ts`·`memory.md`로 참조하던 다른 앱·project 정리 |
| **Workflow 이름 변경 / 삭제** (`core` route 도입) | 이름 변경 시 `workflow_start` `job` 대상과 layout desk key 갱신; 삭제 시 관련 `job` 정리 및 desk 정리 | 다른 workflow나 `memory.md`·skill의 참조 정리 |

### 3. 2단(의미적) Cascade — Follow-up 기록과 lophn 인계

- program은 자유 글(`memory.md`, `LOPHN.md`, skill)이나 코드(`workflow.yaml`, `flow.ts`, 앱 source)를 문자열 치환으로 직접 자르지 않는다.
- 대신 영향 조회에서 의미 판단이 필요한 항목이 나오면 **cascade follow-up 행**(원인 사건, 영향받는 그릇과 자원, 전후 계약 요약, 상태 `open | done | skipped`)을 ledger에 남기고 lophn에게 인계한다(인계를 여는 시점과 수신처는 아래 "정할 것" 1·4).
- 인계 메시지는 program이 조립한다: 무엇이 삭제·변경되었는지(스키마 변경이면 이전/새 스키마 diff), 고쳐야 할 정확한 대상(예: `workflows/code-review/workflow.yaml`의 참가자 `reviewer`, `memory.md`의 `artifacts/weekly-sales` 언급 줄), 완료 보고 명령과 항목 ID.
- 받은 lophn이 고친 뒤 항목 ID로 `done | skipped`를 기록한다. 처리되지 않은 `open` 항목은 사라지지 않고 Inbox나 상태 조회에 남는다.

## 정한 것

1. 참조 그래프는 별도 캐시 표에 복제해 두지 않고 현재 정본(선언, `jobs` 표, `workflow.yaml`, 정의 파일, `memory.md`)에서 결정적으로 읽는다. `(agent: 파일 기반 정의와 별도 표를 함께 두면 편집 때마다 어긋나고, 개인 작업 공간 규모에서는 정본 직접 읽기로 충분하다)`
2. `artifact` 삭제와 `workflow` 삭제·이름 변경은 파일 직접 조작(`shell` IPC 등)이 아니라 `core` command를 지나게 한다. `(agent: core를 지나야 영향 조회, 결정적 정리, follow-up 기록이 빠지지 않는다)`
3. `memory.md`, skill, `workflow.yaml`, `flow.ts`, 앱 코드는 program이 임의로 자르거나 고치지 않고 위치와 이유만 짚어 lophn에게 넘긴다. `(agent: sdk-update-checkpoint.md의 "자유 글을 program이 고치면 틀리게 자를 수 있다"와 같은 원칙)`
4. 앱 계약 변경 감지에 `events`(삭제 및 `payloadSchema` 변경)와 공개 `commands`의 입출력 schema 변경을 포함한다. `(agent: 이름만 같고 payload/입력이 바뀌어 구독 앱과 workflow가 깨지는 것이 같은 문제다)`

## 정할 것

1. **사람이 화면에서 삭제할 때(agent, artifact, 앱, workflow) 인계를 시작하는 시점**
   - **안 A (추천 — 삭제 확인 창에서 영향을 보여주고 바로 위임)**: 삭제 확인 대화상자가 사전 impact read를 불러 *"즉시 정리되는 것"* 과 *"lophn이 손봐야 하는 곳(workflow 2개, memory 1곳)"* 을 보여주고, 기본 단추를 **[Delete and ask lophn to clean up]** (단순 삭제 보조 단추 병행)으로 둔다. 사람이 누른 것이 곧 지시이므로(`event.md` 원칙 준수) 즉시 인계 session이 열리고, 미완료 건이나 파일 직접 삭제로 생긴 건만 Inbox에 남는다.
     - *얻는 것*: 지운 직후 맥락이 살아 있을 때 바로 정리되고 Inbox를 한 번 더 열 필요가 없다.
     - *잃는 것*: 삭제 확인 창을 열 때 impact read가 한 번 돌고 확인 대화상자 UI가 조금 넓어진다.
   - **안 B (삭제는 즉시 끝내고, 후속 인계는 늘 Inbox 영구 줄 `[Ask lophn]`으로 모음)**: `phone_changed`·`sdk_update_needed`처럼 삭제는 바로 끝내고, 손볼 곳이 있을 때만 Inbox 줄로 합쳐 두었다가 사람이 원할 때 눌러 한꺼번에 정리한다.
     - *얻는 것*: 여러 자원을 연달아 지울 때 조용하고 한 번의 session으로 묶어 처리한다.
     - *잃는 것*: 사람이 Inbox 단추를 누르기 전까지 workflow나 구독 앱, memory가 깨진 채로 남는다.

2. **앱이 공개 Command·Event 계약을 바꿀 때의 전파 시점 (사후 인계 vs 사전 합의)**
   - **안 A (추천 — `release.activate` 확정 시 사후 인계로 통일)**: `release.prepare` 결과에 깨지는 하위 참조 목록(`impacted_subscribers`, `impacted_callers`, `impacted_jobs`, `impacted_workflows`)을 돌려주어 실수면 앱 agent가 고치게 하되, 의도한 변경으로 `activate`가 끝나면 program이 자동으로 follow-up 항목을 만들고 인계해 구독 앱·workflow가 따라 고치게 한다.
     - *얻는 것*: 프롬프트 망각으로 전파가 빠지지 않고, 앱 하나를 고칠 때마다 activate 전에 여러 그릇 session이 왕복 합의로 멈춰 서지 않는다.
     - *잃는 것*: 구독 앱이 따라 고쳐지기 전 짧은 틈 동안 옛 구독 handler 호출이 실패할 수 있다.
   - **안 B (지금 `removed_public_tools`처럼 `activate` 전 Home 왕복 합의를 event·스키마 변경까지 확대)**: 쓰는 쪽이 옮길 수 있는지 먼저 묻고 난 뒤에야 activate한다.
     - *얻는 것*: 구독자가 고쳐지기 전의 짧은 불일치를 줄인다.
     - *잃는 것*: program이 막으면 배포가 답답해지고, 지침에만 두면 지금처럼 agent가 빼먹을 수 있다.

3. **참조 대상(agent, workflow, 보관된 앱)이 사라질 때 걸려 있던 `job` 처리**
   - **안 A (추천 — 영구 삭제인 `app.delete`만 같이 지우고, 나머지는 비활성화 + `target_gone` 표시 후 인계에 포함)**: `agent.delete`나 `workflow` 삭제에 걸린 `job`은 지우지 않고 `enabled: false`(이유 `target_gone`)로 멈춘 뒤 인계 항목에 넣어, 사람/agent가 대체 agent·workflow로 새 job을 만들지 지울지 정하게 한다(`job_runs` 이력도 남는다).
     - *얻는 것*: 어떤 주기와 프롬프트로 돌던 자동화였는지 잃지 않고 다른 agent로 갈아끼우기 쉽다.
     - *잃는 것*: 멈춘 job을 결국 정리하는 한 걸음이 남는다.
   - **안 B (`app.delete`처럼 대상이 사라진 `job`은 모두 같은 Tx에서 즉시 삭제)**:
     - *얻는 것*: 죽은 job이 목록에 남지 않고 단순하다.
     - *잃는 것*: 그 agent로 돌리던 주기 작업의 프롬프트와 설정이 함께 날아가 대체 agent로 잇기 어렵다.

4. **여러 그릇에 걸친 인계의 수신처**
   - **안 A (추천 — 단일 그릇이면 그 그릇 lophn 직행, 여러 그릇이면 Home lophn 경유)**: project 하나의 artifact 삭제처럼 영향이 그 그릇 안뿐이면 그 project lophn에게 바로 넘기고, 전역 agent 삭제나 여러 앱·project가 구독하는 event 변경처럼 경계를 넘으면 Home lophn이 받아 숲을 보고 각 그릇에 분배한다(`AGENT.md` P12 경계와 `update-apps` 모양 유지).
     - *얻는 것*: 작은 정리에 Home을 거치지 않아 빠르고, 여러 그릇이 얽힌 변경에서는 대체 방침(예: 지운 agent 대신 누구를 쓸지)을 Home에서 한 번만 정할 수 있다.
     - *잃는 것*: 분기 규칙이 둘(단일 그릇 vs 복수 그릇)이 된다.
   - **안 B (경계와 상관없이 늘 각 대상 그릇의 lophn에게 직접 인계)**:
     - *얻는 것*: 라우팅이 한 줄로 단순하다.
     - *잃는 것*: 같은 agent 삭제로 workflow 3개가 깨졌을 때 세 project session이 사람에게 같은 질문("누구로 바꿀까요?")을 각각 묻게 된다.

## 단계

결정이 확정되면 구체화한다. 초안 순서는 다음과 같다.

| 순서 | 하는 일 |
|---|---|
| 1 | 정적 참조(impact) 조회기와 read route, `app.usage`를 정적 참조 포함으로 확장, `release.prepare`에 `events`·스키마 변경 영향 추가 |
| 2 | 1단 결정적 cascade 보강: `agent.delete`(MCP secret, `callPolicy`, session, `job`), `artifact` 삭제와 `workflow` 이름 변경·삭제의 `core` command 이전, `app.archive` 시 `job` 멈춤 정리 |
| 3 | cascade follow-up ledger 표, 인계 생성·완료 보고 command, 삭제 확인 창(또는 Inbox) 연결과 수신 지침 |

## 하지 않는 것

- program이 정규식이나 줄 자르기로 `memory.md`, `LOPHN.md`, `workflow.yaml`, `flow.ts`, 앱 코드를 직접 수정하는 것.
- 모든 파일 편집을 실시간 file watch로 감시해 agent를 깨우는 것(`PRODUCT.md` §3 pdf 목차 예와 같은 이유: 비용 대비 잡음이 크다).
- 별도의 영속 참조 그래프 표를 두고 모든 쓰기마다 동기화하는 것.
