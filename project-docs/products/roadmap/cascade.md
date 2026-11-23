# cascade: 삭제와 계약 변경의 결정적 정리와 lophn 인계

상태: 로드맵. 2026-11-23 사람이 방향을 냈고, 코드 재조사(`86db4d72d`)와 리뷰를 반영해 공통 토대와 기술 결정을 정리했다. 사람이 정할 제품 결정 2가지만 `## 정할 것`에 남겨 두었다. `(agent)`로 적은 것은 기존 원칙과 불변식으로 정한 것이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/{PRODUCT.md,products/AGENT.md}`, `project-docs/architecture/{app-call,event,agent-definition,artifact,workflow,job,app-notice}.md`, `project-docs/products/roadmap/{sdk-update-checkpoint,platform-update}.md`.
조사: main `86db4d72d` 코드 조사(2026-11-23, Workflow Phase 4 반영).

## 사람의 말 (원문)

2026-11-23:

> 그리고 또 지금 cascade 관련해서 너무 빈약해
> 예를 들면 artifact가 삭제되면 그에 관한 memory를 지운다거나
> agent를 지우면 그 agent가 참여된 workflow를 수정해야한다거나
> 또 특정 event를 발생하는 앱이 있는데 그럼 그걸 구독하는 쪽에서 또 수정해야한다거나
> 사실 이것도 그냥 프로그램적으로 (결정적으로) 가능한 부분들이 있겠지만 lophn한테 인계해주는 흐름도 필요하다는거지

> 내가 정해야하는 것만 정리해서 보고하고 로드맵 닫으면 될 것 같아

## 왜

- 사용자의 작업 공간에 앱, agent, workflow, artifact, job, memory가 쌓이면서 자원들이 서로를 가리킨다. 하나를 지우거나 공개 계약(command, skill, event)을 바꾸면 가리키던 쪽이 깨진다.
- `PRODUCT.md` §3의 책임 분배대로 cascade는 두 층이어야 한다:
  1. **1단 결정적 정리(program)**: 판단 여지가 없는 고아 데이터·secret·권한·죽은 `job`은 삭제·변경과 같은 동작에서 program이 즉시 치운다.
  2. **2단 의미적 인계(lophn agent)**: 대체할 agent를 고르거나, 바뀐 event·command 계약에 맞춰 구독 앱과 workflow를 고치거나, `memory.md`에서 지워진 대상의 문맥을 덜어내는 일은 program이 영향을 뽑아 lophn에게 인계(handoff)한다.
- 지금은 `app.delete` 한 곳만 손으로 엮어 두었고, 나머지는 secret·`job` 같은 결정적 정리조차 빠져 있거나 사용처 조회가 과거 호출 로그만 보고 있다.

## 지금 코드

### 1. 앱 영구 삭제와 보관, Project 보관 (`apps-delete.ts`, `project-api.ts`)

- `packages/core/main/daemon/wiring/apps-delete.ts`가 한 Tx에서 앱 workspace의 session, 보낸 call, 앱 범위 agent 정의(앱 lophn 포함), 다른 agent의 할당(`apps`, `permissions.deny`), 관련 `job`(`eraseJobsOfApp`), 공유 요청, 폰 sync log를 지우고, commit 뒤 폴더·bundle·`shell.*` 설정 5종을 지우며 `AppRemoved`를 낸다.
- project에는 영구 삭제가 없고 `projectApi.archive`·`unarchive`만 있다(`packages/protocol/projects/project-api.ts`).
- **빈 곳**:
  - 지우거나 보관한 앱을 `app_connections`·`subscriptions`로 선언한 **다른 앱**과 `flow.ts`에서 부르는 **project workflow**는 깨진 채 남는다.
  - 앱이나 project를 `archive`해도 관련 주기 `job`(`tool_run`, `agent_run`, `workflow_start`)은 멈추지 않아 매 차례 실패하고, event `job`만 `job.list`를 읽을 때 `source_gone`이 붙는다(`packages/core/jobs/reads.ts`).

### 2. Agent 삭제와 불변 handle (`packages/core/lophn-agent/agents/commands.ts`)

- `agentChange`는 `handle` 변경을 `notAllowed("handle")`로 거절하므로(212줄) handle rename으로 참조가 깨지는 경로는 없다.
- 반면 `agentDelete`(246~288줄)는 `<data>/agents/<id>.md`, avatar 이미지, `<data>/agent-memory/<id>.md` 셋만 지운다.
- **빈 곳**:
  - **결정적 누락**: 정의 층 MCP secret(`secrets.json`의 `mcp.<agt_id>.*`, `mcp-oauth.<agt_id>.*`), `callPolicySetting`(`packages/core/config/setting-declarations.ts`)의 agent 쌍 규칙, 열린 session, 이 agent가 만들었거나 이 agent를 부르는 `job`이 그대로 남는다(특히 `job.md` 불변식 6·7 때문에 지운 agent가 만든 `job`은 다른 agent가 조회도 삭제도 못 하고 `action`도 바꿀 수 없다).
  - **의미적 누락**: project `workflows/<name>/workflow.yaml`의 `participants`·creator `agent`나 `flow.ts`의 `agent("<handle>")`가 지운 handle을 가리켜도 실행할 때 `not_handed`(`unresolved`)로 멈출 때까지 아무도 고치지 않는다.

### 3. Artifact 삭제와 Memory 감시 (`artifact.ts`, `memory-names.ts`)

- `packages/shell/main/desktop/wiring/artifact.ts`(192줄)는 `shell:artifact-delete` IPC로 `core`를 거치지 않고 `<data>/projects/<prj>/artifacts/<name>` 폴더만 바로 지운다(앱 artifact는 삭제 입구도 없다).
- `packages/core/agent-workspaces/memory-names.ts`는 정규식 `/\b(?:app|prj|agt)_[0-9a-z]{26}\b/g`만 풀어 turn마다 `- <id>: deleted …` 줄을 덧붙일 뿐이라, ID가 없는 `artifact`·`workflow`·`skill`·`event`가 지워져도 알지 못하고 그 artifact를 갱신하던 `job`이나 `memory.md` 메모가 고아로 남는다.

### 4. 앱 공개 계약·Event 변경과 사용처 조회 (`public-tools.ts`, `apps/usage/users.ts`)

- `packages/core/apps/releases/commands.ts`(667줄)와 `public-tools.ts`는 `release.prepare` 때 `removed_public_tools`와 `removed_public_skills`만 낸다.
- **빈 곳**:
  1. **앱 event와 스키마 변경 미감지**: 이전 활성 release에 있던 `events`를 지우거나 `payloadSchema`를 바꿔도, 또는 공개 `command`의 `inputSchema`·`outputSchema`를 바꿔도 아무 신호가 없다. 그 event를 `subscriptions`로 듣는 다른 앱, `trigger`로 건 `job`, `onEvent`로 듣는 `workflow`(`packages/core/workflows/event-subscriptions.ts`)가 조용히 끊기거나 깨진다.
  2. **사용처(`appToolUsers`)가 과거 agent 호출만 본다**: `invocations` 표에서 `caller_kind = 'agent'`만 센다(`users.ts` 97줄). 다른 앱 선언의 `app_connections`·`subscriptions`, `jobs` 표의 `tool_run`·`trigger`, project `workflows`의 참조는 agent가 직접 부른 적이 없으면 빠진다.

### 5. Workflow 삭제·이름 변경과 Phase 4 `code_snapshot`

- Phase 4(`86db4d72d`)부터 `kind` 칸이 폐지되고(`flow.ts` 유무로 판정), 같은 project 안 sub-workflow 호출(`workflow("<name>")`)이 생겼으며, 실행 중인 instance는 시작 시점 `code_snapshot`으로 돌고 막혔을 때 사람이 `[Resume with updated code]`(`use_latest_code: true`)를 고른다.
- workflow 폴더를 지우거나 이름을 바꾸면 `workflow_start` `job`과 부모 workflow의 `workflow("<name>")` 참조가 깨지고 desk layout도 어긋난다(이슈 `workflow-rename-merges-desk-into-main`).

## 공통 토대 (`platform-update.md`와 공유)

1. **작업 공간 정본 reader**: 별도 동기화 캐시 표를 두지 않고 현재 정본(활성 release 선언, `jobs` 표, `workflows/*/workflow.yaml` 및 `flow.ts`, agent 정의)을 직접 읽는다.
2. **공통 follow-up item**: 의미적 후속 작업을 단일 표(`id`, 대상 그릇 `home | project | app`, 제목, program이 채운 본문, `state: open | done | changed | skipped`, `outcome`)와 단일 완료 보고 명령으로 추적한다(`sdk_features`와 통합).

## 무엇을 만드나

### 1. 1단 결정적 Cascade 완성 (선행·독립)

2단 인계 설계를 기다리지 않고 program이 결정적으로 처리할 수 있는 누락부터 바로 고친다.

- **`agent.delete` 정리**: 같은 동작에서 정의 층 `mcp.<agt_id>.*`·`mcp-oauth.<agt_id>.*` secret 삭제, `callPolicy`의 해당 agent 규칙 제거, 열린 session 닫기, 그 agent가 만들었거나 단독 대상인 `job` 행 삭제(명세는 인계용 결과에 보존).
- **기점 명령의 `core` 이전**: `artifact` 삭제(project·앱 공통)와 `workflow` 이름 변경·삭제를 `core` command로 내린다. `workflow` 이름 변경은 같은 project의 `workflow_start` `job`과 workflow desk layout key를 함께 바꾼다. `workflow` 삭제는 그 workflow를 시작하는 `job`을 지우고 desk를 정리한다.
- **보관(`app.archive`, `project.archive`) 시 `job` 동적 건너뛰기**: `jobs` 표의 `enabled`는 건드리지 않는다. 읽을 때 `target_unavailable`을 계산해 보이고, `job.claim_due`는 보관된 대상을 만나면 실행 줄을 만들지 않고 `next_due_at`만 다음 주기로 밀며, `job.activity`(idle-exit)에서도 뺀다. 보관 해제(`unarchive`)하면 역방향 수정 없이 다음 주기부터 저절로 다시 돈다.

### 2. 정밀도를 가른 정적 참조(Impact) 조회기

참조마다 정밀도를 **`declared`(정확)** 와 **`mentioned`(추정)** 두 수준으로 구분해 돌려준다.

- **`declared`**: 앱 활성 선언의 `app_connections`·`subscriptions`, `jobs` 표의 `action`·`trigger`, `workflow.yaml`의 `participants`·creator `agent`·`inputs`(타입 `agent`), agent 정의의 `apps`. 삭제 확인 창의 숫자 표시에는 `declared`만 쓴다.
- **`mentioned`**: `flow.ts` 안의 `agent("...")`·`tool("...")`·`workflow("...")`·`onEvent(...)` 리터럴과 skill 본문 매칭. 인계 본문에 "확인할 후보"로만 싣는다.
- **`memory.md`는 매칭하지 않는다**: 보통 낱말과 겹치는 이름 매칭으로 거짓 개수를 보이지 않고, 인계 본문에 *"이 그릇(및 Home) memory에 X에 관한 메모가 있으면 함께 정리하라"* 한 줄을 고정으로 넣는다(받는 lophn의 system prompt에 이미 memory가 실려 있다).
- **`P12` 경계 유지**: `app.usage`처럼 어느 그릇이 쓰는지를 담은 상세 impact read는 **사람 화면과 Home session만** 부른다. 앱 workspace의 `release.prepare` 응답에는 외부 사용처가 걸린 **자기 command·skill·event 이름과 개수만** 싣는다(다른 앱·private project 이름을 노출하지 않는다).
- **계약 변경 판정 단순화**: JSON Schema 호환 검사기는 만들지 않는다. 이전 활성 release와 새 release 사이에서 공개 `command`·`skill`·`event`가 지워졌거나 정규화 선언 JSON이 달라졌으면 "바뀌었다"와 전후 정의만 내고, 실제로 하위 코드를 고쳐야 하는지는 인계받은 agent가 판단한다.

### 3. 2단 의미적 Cascade — 주체별 인계 발송과 완료 보고

`event.md` 불변식 3("program이 스스로 정해 session을 열지 않는다")을 지키며 행동 주체(actor)에 따라 인계를 연다.

- **사람이 화면·CLI에서 삭제할 때**: 사람의 지시이므로 공통 follow-up item을 기록하고 인계를 연다(즉시 열지 Inbox로 모을지는 아래 "정할 것" 1).
- **agent session이 명령으로 삭제·변경할 때**: command 결과에 영향 요약과 생성된 follow-up item이 돌아가고, 같은 그릇 일이면 그 session이 바로 고치고 다른 그릇 일이면 Home(또는 해당 그릇)에 넘긴다.
- **`release.activate`가 완료될 때**(바로 켜짐, 또는 사람이 `activation.consent`에서 `[Allow]`를 눌러 켜짐): 사람이 동의를 누른 것 또는 앱 session이 activate한 것이 기점이 되어 영향받는 하위 그릇에 대한 follow-up을 기록·전달한다.
- **수신처 규칙(`AGENT.md` P12·G3·L10)**: 영향이 한 그릇 안뿐(예: project 하나의 artifact 삭제)이면 그 그릇 lophn에게 바로 보내고, 여러 그릇에 걸치면(전역 agent 삭제, 여러 곳이 구독하는 앱 event 변경) Home lophn이 받아 대체 방침을 정리한 뒤 각 그릇에 분배한다.
- **실행 중 workflow 안내**: lophn이 `workflow.yaml`이나 `flow.ts`를 고쳐도 이미 돌고 있는 Phase 4 instance는 시작 시점 `code_snapshot`을 유지한다. 막혀 있는(`blocked`) instance가 있으면 사람에게 `[Resume with updated code]`로 이어 갈 수 있다고 보고한다.

## 정한 것

1. **1단 결정적 정리를 먼저 떼어 낸다**: `agent.delete`의 `mcp.<agt>.*` secret 누수 등은 2단 설계와 무관한 결함이므로 단계 1에서 바로 고친다. `(agent)`
2. **참조는 정본에서 직접 읽되 `declared`와 `mentioned`를 구분하고, `memory.md`는 줄 매칭 대신 인계 고정 문구로 정리한다**: 자유 글의 이름 매칭 오탐을 확인 창에 사실처럼 보이지 않는다. `(agent)`
3. **스키마 호환 검사기를 만들지 않는다**: 선언 정규화 JSON 변경 여부와 전후 diff만 program이 내고 깨짐 여부는 agent가 본다. `(agent: AGENTS.md "속도")`
4. **`P12` 경계와 `event.md` 불변식 3 준수**: 앱 session에는 자기 항목별 외부 사용 유무·개수만 보이고 사용처 명단은 Home과 사람만 읽는다. 인계는 삭제·동의를 실행한 사람 또는 부른 agent session의 행위 안에서만 열린다. `(agent)`
5. **`job` 처리는 가역성으로 가른다**: 되살릴 수 있는 보관(`app.archive`, `project.archive`)은 표를 고치지 않고 읽기와 `claim_due`·`job.activity`에서 동적으로 건너뛴다. 되살릴 수 없는 영구 삭제(`app.delete`, `agent.delete`, `workflow` 삭제)는 `job.md` 불변식 6(생성자 외 비가시)·7(`action` 불변) 때문에 같은 Tx에서 `job` 행을 지우되, 지워진 job의 명세를 인계 본문에 실어 대체 job 생성 여부를 판단하게 한다. `(agent)`
6. **인계 수신처**: 단일 그릇 영향은 그 그릇 lophn 직행, 복수 그릇 영향은 Home lophn 경유로 분배한다. `(agent: AGENT.md P12·G3·L10)`

## 정할 것

1. **사람이 화면에서 삭제할 때(agent, artifact, 앱, workflow) 인계를 시작하는 UX**
   - **안 A (추천 — 삭제 확인 창에서 `declared` 영향을 보여주고 `[Delete and ask lophn to clean up]`으로 바로 시작)**: 확인 창에서 즉시 지워질 것과 lophn이 손볼 곳(예: 참여 workflow 2개)을 보여주고 삭제와 함께 인계 session을 연다(단순 삭제 보조 단추 병행, 미완료 항목만 Inbox에 남김).
     - *얻는 것*: 지운 직후 맥락에서 바로 정리되고 Inbox를 따로 열 필요가 없다.
     - *잃는 것*: 삭제 확인 창이 넓어지고 삭제 직후 정리 대화가 열린다.
   - **안 B (삭제는 즉시 끝내고, 후속 인계는 늘 Inbox 영구 줄 `[Ask lophn]`으로 모음)**:
     - *얻는 것*: 여러 자원을 연속으로 지울 때 조용하고 나중에 한 번에 묶어 시킬 수 있다.
     - *잃는 것*: 사람이 Inbox 단추를 누르기 전까지 workflow나 구독 앱, memory가 깨진 채로 남는다.

2. **앱이 공개 Command·Skill·Event를 바꾸거나 지울 때의 정책 (`A21` 사전 합의 유지 vs 사후 인계 전환)**
   - **안 A (추천 — `release.activate` 확정 뒤 사후 인계로 통일)**: `release.prepare`에서 외부 사용 개수를 보여 주어 실수면 앱 agent가 고치게 하되, 의도한 변경으로 `activate`가 끝나면 하위 구독·호출 그릇에 follow-up 인계를 보낸다.
     - *얻는 것*: 프롬프트 망각으로 전파가 빠지지 않고, 앱 하나를 고칠 때마다 `activate` 전에 여러 그릇 session이 왕복 합의로 멈춰 서지 않는다.
     - *잃는 것*: 기존 `AGENT.md` A21("쓰는 쪽이 못 옮긴다 하면 지우려던 command를 되살린다")이 사라지고, 하위 그릇이 따라 고쳐지기 전 짧은 틈 동안 호출·구독이 실패할 수 있다(필요시 사람이 이전 release로 롤백).
   - **안 B (공개 항목 삭제는 지금 `A21`처럼 `activate` 전 Home 왕복 합의를 유지하고, 스키마·event 변경만 사후 인계)**:
     - *얻는 것*: 대체재 없이 쓰이는 command를 지우는 일을 배포 전에 막는다.
     - *잃는 것*: 삭제와 변경의 경로가 둘로 갈라지고 사전 합의는 여전히 지침에 기댄다.

## 단계

| 순서 | 하는 일 | 비고 |
|---|---|---|
| 1 | 1단 결정적 정리 완성: `agent.delete`(MCP secret, `callPolicy`, session, `job`), `artifact` 삭제·`workflow` 이름 변경·삭제의 `core` command 이전, 보관된 앱·project의 `job` 동적 건너뛰기 | 결정 대기 없이 바로 착수 가능 |
| 2 | 공통 토대(`platform-update.md` 단계 2와 공유): 작업 공간 정본 reader(`declared`/`mentioned`, `app.usage` 통합, `release.prepare`의 event·스키마 변경 개수 산출) + 공통 follow-up item 표·보고 명령 | `platform-update`와 한 번에 구현 |
| 3 | 삭제 확인 창(또는 Inbox) 인계 UI와 `release.activate` 사후 인계 연결, 수신 지침(`AGENT.md` 갱신 포함) | 정할 것 1·2 확정 뒤 |

## 하지 않는 것

- program이 정규식이나 줄 자르기로 `memory.md`, `LOPHN.md`, `workflow.yaml`, `flow.ts`, 앱 코드를 직접 수정하는 것.
- 다른 컴퓨터에 있는 구독자·호출자(`subscriptions[].machine`, `remote_apps`)를 이 기계의 impact 조회기가 추적하는 것(이 기계 정본 밖이므로 알 수 없다).
- 모든 파일 편집을 실시간 file watch로 감시해 agent를 깨우는 것(`PRODUCT.md` §3 pdf 목차 예와 같은 이유).
- 별도의 영속 참조 그래프 표를 두고 모든 쓰기마다 동기화하는 것.
