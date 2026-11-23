# platform update: 앱 SDK를 넘어 작업 공간 전체에 새 가능성을 전한다

상태: 로드맵 초안. 2026-11-23 사람이 방향을 냈고 planner가 썼다. 사람의 결정은 보류한 채("정할 것")로 두었다. `(agent)`로 적은 것은 planner가 기존 원칙과 코드 근거로 적어 둔 안이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/{PRODUCT.md,products/AGENT.md}`, `project-docs/architecture/{app-notice,ui-kit,agent-definition,workflow,phone-screen}.md`, `project-docs/products/roadmap/{inbox-history-sdk-migration,sdk-update-checkpoint,phone-capability,workflow,cascade}.md`.
조사: main `cc1d741db` 코드 조사(2026-11-23).

## 사람의 말 (원문)

2026-11-23:

> 새로운 로드맵을 열고자하거든?
> 최근에 큼직막한 변경들이 많아
> 모바일에서 native 기능을 사용자 앱에서 좀 더 잘 활용할 수 있게한다거나
> workflow라든가, 아니면 그냥 lophn 자체의 기능이라든가 (provider 별 중복 crendential 등록 가능 및 선택 activate)
> 근데 이런 것들이 개발되면
> lophn agent가 무엇이 이제 가능해졌는가를 알아야하거든?
> 관련한게 app sdk update 내용을 보고 migration 및 업데이트 하는 흐름이 있는데
> 이게 app에 국한해서만 진행되어서는 안 된다는거지

> 일단 작성해줘 결정은 보류한 채로

## 왜

- lophn은 빠르게 바뀐다. 폰 화면의 native 기능과 앱 file(`phone-capability.md`, `app-file.md`), 통합 programmatic workflow와 선언적 `inputs`·`onEvent`(`workflow.md`), coding agent `harness_config` 프로필(`agent-profile.md`), 컴퓨터 간 테이블 `sync`와 `across_machines` event, 앞으로 들어올 provider별 복수 credential 등록과 선택 activate처럼 **앱 SDK 바깥의 큰 역량**이 연달아 열린다.
- 사람은 판마다 무엇이 바뀌어 내 작업 공간의 어디에 쓸 수 있는지 스스로 대조하지 않는다(`PRODUCT.md` §4 축 1, `AGENT.md` F1). 그 판단은 숲을 보는 Home lophn의 몫이다.
- 지금 업데이트 검토 흐름(`sdk_update_needed` → `/update-apps` → `migrate-sdk`)은 **앱이 선언에 고정한 `@lophn/*` SDK 판** 하나만 본다. 그래서 앱 바깥 자산(project의 workflow와 skill, agent 프로필과 provider 구성, 옛 한계 시절 적어 둔 지침과 memory)은 새 판이 나와도 아무도 돌아보지 않는다.

## 지금 코드

### 기동 시 판 감지와 알림

- `packages/core/main/daemon/wiring/notices.ts`(`afterReady`)가 root `package.json`의 `version`과 `<data>/sdk/<part>/<version>`의 설치 최고 판(`readInstalledVersions`)을 읽어 `notices.observe_version`을 부른다.
- ledger `core_meta` 표의 `product_version`·`sdk_versions`와 다르면 `lophn_updated {from, to}` 영구 줄을 남긴다(`architecture/app-notice.md`). 이 줄은 toast도 뜨지 않고 `action` 단추도 없는 History 기록이라 agent에게 이어지지 않는다.

### 앱 SDK 감지와 checkpoint (`sdk-status`, `update-apps`)

- 설치되는 SDK는 13개(`packages/sdk/`: `agent`, `app-ui`, `app-ui-native`, `cap-fs`, `cap-net`, `cap-notify`, `cap-phone`, `cap-problem`, `cap-secret`, `cap-store`, `cap-tool`, `declaration`, `flow`)이고, `packages/core/agent-workspaces/skills/migrate-sdk/`에 판별 메모 125개가 있다(`tools/check-sdk-notes.ts`가 사슬과 지원 하한을 검사).
- `packages/core/apps/sdk-status/status.ts`(`readSdkStatus`)는 **활성 앱의 켜진 release에 봉인된 `sdk_dependencies`만** 읽는다. `detect.ts`(`recordSdkUpdates`)가 `required`·`unreviewed` 앱 수를 세어 `sdk_update_needed` 영구 줄 하나(`action: {kind: "open_home_skill", skill: "update-apps", args: ""}`)를 남긴다.
- `packages/core/apps/sdk-status/decide.ts`(`sdkDecideHandler`)와 `review-store.ts`가 앱마다 검토한 판(`through`), 결정(`leave | update`), 고른 기능(`features`, 상태 `open | done | changed | skipped`)을 ledger에 적고 같은 동작에서 그 앱 lophn에게 `reply: none` handoff를 보낸다(`sdk-update-checkpoint.md`).

### 앱 바깥의 공백

1. **앱이 아닌 자산은 감지 대상에 없다.**
   - `@lophn/flow`는 `<data>/sdk/flow/<판>`에 깔리지만 project의 `workflows/<name>/`은 SDK 판을 pin하지 않아 `readSdkStatus`에 잡히지 않는다.
   - 옛 `kind: agent`로 어렵게 짠 workflow나 수동 skill이 있어도 선언적 `inputs`, `onEvent`, 통합 engine(`workflow.md`)으로 옮기거나 개선하자는 제안이 나오지 않는다.
   - coding agent `harness_config` 프로필이나 provider 복수 credential 같은 lophn 자체 기능이 생겨도 기존 agent 정의나 workflow 참가자 배정을 손보자는 흐름이 없다.
2. **바뀐 지침과 습관이 닿지 않는 자리가 있다.**
   - 새로 여는 turn은 최신 내장 prompt(`packages/core/agent-workspaces/prompts/{home,project,app}.md`)와 내장 skill 목록을 받는다(`architecture/agent-definition.md` 57줄).
   - 그러나 `runtime: custom`인 agent는 내장 지침을 싣지 않고 정의 본문만 읽는다(`agent-definition.md` 불변식 29).
   - 앱 source의 `AGENTS.md`는 `migrate-sdk` 메모의 `## Instruction diff`(`sdk-note` skill)로 옛 습관을 고치지만, Home·project의 `LOPHN.md`·`memory.md`·사용자 작성 skill(`<data>/projects/<prj>/skills/`, `.lophn/skills/`)에 옛 한계 시절 적어 둔 우회 규칙("계정은 하나만 되니…", "사진은 안 되니 글로만…")을 고쳐 줄 통로는 없다.
3. **평소 대화에서 새 세부 역량이 가려진다.**
   - 내장 skill은 이름과 frontmatter `description` 한 줄만 system prompt에 실리고 본문은 `skill.read`를 불러야 읽힌다(`agent-definition.md` 불변식 45). 새 역량이 딸린 `.md`나 본문 안쪽에만 더해지면, 사람이 평소 대화에서 관련 요구를 말해도 agent가 그 skill을 열지 않아 옛 방식으로 답할 수 있다.

## 무엇을 만드나

### 1. 두 갈래 변경 메모: 앱 SDK 메모 + 플랫폼 역량 메모

- 앱이 판을 고정하는 `@lophn/*` 변화는 지금처럼 `migrate-sdk`의 `<part>-<x.y.z>.md`에 둔다.
- 앱 SDK pin으로 잡히지 않는 변화(workflow 선언·`@lophn/flow` 기능, project skill·artifact 기능, agent 정의·provider·권한·다중 기기 같은 lophn 자체 기능)는 **플랫폼 역량 메모(platform note)** 로 쌓는다.
  - 메모 하나는 `Previous:` 사슬, `Breaking: yes | no`, 대상 범위(`home | project | workflow | agent | app`), 무엇이 새로 가능해졌거나 바뀌었는지, 기존 자산을 어떻게 옮기거나 쓰는지, 바뀐 지침 습관(`Instruction diff`)을 담는다.
  - 본문은 지금 `migrate-sdk`처럼 고정 절차 skill 하나와 옆에 쌓이는 `.md` 파일들로 두어 평소 prompt 길이를 늘리지 않고 미검토 구간만 `skill.read`로 읽는다.
  - 사용자 대면 계약·지침이 바뀔 때 메모 사슬이 끊기지 않는지 `check`가 검사한다.

### 2. 작업 공간 전체의 업데이트 상태 read와 ledger checkpoint

- `sdk-update-checkpoint.md`의 원칙("어디까지 봤고 무엇을 맡겼고 끝났나는 memory가 아니라 ledger가 쥔다")을 앱 밖으로 넓힌다.
- Home이 검토한 **마지막 플랫폼 판(`through`)** 과, 검토에서 파생되어 각 대상(`home`, 특정 `project`, 특정 `app`)에 맡긴 개선 항목(`id`, `target`, `title`, `proposal`, `note`, `state: open | done | changed | skipped`, `outcome`)을 ledger에 기록한다.
- Home lophn이 부르는 상태 read가 한 번에 다음을 돌려준다:
  - 앱별 SDK 상태(`required`, `unreviewed`, 지난 미완료 `features` — 지금 `app.sdk_status` 그대로)
  - 마지막 검토 뒤 쌓인 미검토 platform note 목록과 지난 미완료 항목
  - 대조용 작업 공간 현황 요약(활성 project마다 workflow·skill·artifact 목록, 등록된 agent 정의와 runtime 요약, 연결된 provider 종류와 개수 — 각 그릇의 내부 파일을 열지 않고도 어디에 해당되는지 가를 수 있는 메타데이터)

### 3. 결정·인계 한 동작과 완료 보고

- Home lophn이 숲을 보고 판단한다:
  - 필수 migration(`Breaking: yes`로 기존 workflow·custom agent·앱이 막히는 것)은 사람에게 묻지 않고 바로 인계한다.
  - 새 역량 채택은 사람 말로 구체적 이득을 적어 `ask`로 묻는다.
- 결정을 내는 command 하나가 `through` checkpoint를 올리고, 고른 항목마다 대상에 맞게 넘긴다:
  - `app` 대상: 그 앱의 lophn에게 handoff(`reply: none`, 항목 ID와 읽을 note를 program이 채움).
  - `project` 대상(workflow 개편, project skill·`LOPHN.md`·`memory.md` 정리): 그 project의 lophn에게 같은 모양의 handoff.
  - `home` 대상(전역 설정, provider/agent 프로필 구성, Home `memory.md`의 낡은 우회 메모 정리): 항목을 `open`으로 적고 Home lophn이 이어서 처리한다.
- 맡은 쪽(Home, project lophn, 앱 lophn)이 항목 ID로 결과(`done | changed | skipped` + 한 줄 사유)를 기록한다. 기록하지 않은 항목은 `open`으로 남아 다음 검토 때 다시 드러난다.

### 4. 평소 기획 turn에서도 새 가능성을 놓치지 않는 장치

- 새 기능(폰 기능 묶음, workflow의 선언적 `inputs`·`onEvent`, provider 다중 credential 등)을 더할 때, 그 기능을 쓰는 절차가 든 내장 skill의 frontmatter `description`과 해당 workspace 내장 prompt(`home.md`, `project.md`, `app.md`)에 **"무엇이 가능한지(언제 그 skill을 읽어야 하는지)"** 를 같은 변경에서 갱신한다.
- system prompt 고정 층에는 동적 판 비교 글을 넣지 않는다(`agent-definition.md` 불변식 2: prompt cache 보존).

## 정한 것

1. 업데이트 검토의 진행 상태(어디까지 검토했나, 무엇을 맡겼나, 끝났나)는 어느 workspace의 `memory.md`에도 적지 않고 ledger가 쥔다. `(agent: sdk-update-checkpoint.md 원칙 1과 동일)`
2. checkpoint 기록과 그릇별 handoff 발송은 한 동작으로 묶고, 목표 판·읽을 note 파일·항목 ID는 program이 채운다. `(agent: sdk-update-checkpoint.md 원칙 2·4와 동일)`
3. 메모 본문은 system prompt에 싣지 않고 skill 옆 `.md` 파일로 두어 미검토 범위만 읽는다. 평소 대화용 인지는 내장 prompt와 skill frontmatter `description` 갱신으로 푼다. `(agent: prompt cache와 context 예산을 깨지 않기 위해)`
4. archived 앱과 archived project는 업데이트 감지와 제안 대상에서 뺀다. 되살렸을 때 그때의 `through`와 현재 판 차이로 다시 잡힌다. `(agent: inbox-history-sdk-migration.md 정한 것 10과 일관)`

## 정할 것

1. **새 기능 제안의 범위 (자산 매칭만 vs 새 역량 브리핑 겸용)**
   - **안 A (추천 — 기존 자산 매칭만)**: 미검토 platform note를 읽되, 사용자가 이미 가진 앱·project·workflow·agent/provider 구성에 당장 실익이 있는 것만 골라 묻고, 해당 자산이 없으면 조용히 checkpoint만 넘긴다.
     - *얻는 것*: 업데이트가 잦아도 알림·질문 피로가 없다.
     - *잃는 것*: 아직 한 번도 안 써 본 종류의 기능(예: workflow가 0개일 때 새로 열린 workflow 기능)은 사람이 먼저 말을 걸기 전까지 모를 수 있다.
   - **안 B (기존 자산 적용 제안 + 주요 새 역량 한 줄 브리핑)**: 기존 자산에 바로 붙일 곳이 없더라도 큰 역량이 열린 판이면 Home lophn이 사람 말로 짧게 알려 주고 써 볼지 묻는다.
     - *얻는 것*: 새로 가능해진 일을 사람이 바로 발견한다.
     - *잃는 것*: 판이 오를 때마다 읽고 답할 거리가 늘어난다.

2. **기존 `/update-apps` · `sdk_update_needed`와의 통합 모양**
   - **안 A (추천 — 단일 입구로 통합)**: Inbox 알림 줄 하나와 Home skill 하나(예: `/update-workspace` 또는 기존 명령 확장)로 합쳐, 한 번 부르면 앱 SDK와 project/workflow/시스템 업데이트를 한 숲에서 같이 보고 묻는다.
     - *얻는 것*: 앱 변화와 workflow·시스템 변화가 맞물릴 때(예: 앱이 새 event를 내고 workflow가 `onEvent`로 받기) 한 자리에서 기획할 수 있고 사람이 누를 단추가 하나다.
     - *잃는 것*: 앱 SDK만 빨리 올리고 싶을 때도 플랫폼 메모 검토가 같이 돈다(인자로 범위를 좁힐 수는 있다).
   - **안 B (앱 SDK 줄과 플랫폼 업데이트 줄 분리)**: `sdk_update_needed`(`update-apps`)는 그대로 두고 플랫폼용 알림 줄과 skill을 따로 둔다.
     - *얻는 것*: 기존 `sdk-status` 코드와 계약을 거의 건드리지 않는다.
     - *잃는 것*: 업데이트 한 번에 Inbox 줄과 대화가 둘로 갈라지고, 앱과 project를 아우르는 제안을 못 한다.

3. **`runtime: custom` agent와 사용자 작성 `LOPHN.md`·skill·`memory.md` 점검 범위**
   - **안 A (추천 — 깨지는 계약 + 옛 한계를 전제한 우회 문구까지 함께 점검)**: Home·project·앱에 인계할 때 해당 그릇의 `LOPHN.md`, `memory.md`, 사용자 skill에 새 역량과 충돌하는 옛 우회 규칙이 있으면 함께 정리하게 한다(`memory.md` 자유 글 수정은 사람 확인을 거치거나 변경 내용을 보고).
     - *얻는 것*: 옛 제약 때문에 박아 둔 지침이 새 기능을 계속 막는 일을 없앤다.
     - *잃는 것*: 인계받은 그릇 session이 읽을 파일이 조금 늘어난다.
   - **안 B (실행이 깨지는 `Breaking: yes` 변경만 점검)**: 돌아가는 지침과 메모는 건드리지 않는다.
     - *얻는 것*: 조용하고 사람의 글을 잘못 건드릴 일이 없다.
     - *잃는 것*: 옛 우회 습관이 그대로 남는다.

4. **연관 기능 로드맵 분리 여부**
   - 예시로 언급된 **provider별 복수 credential 등록 및 선택 activate**(현재 `architecture/agent-definition.md` 불변식 59는 같은 provider 정의 연결을 `conflict`로 거절)를 별도 기능 로드맵(예: `provider-accounts.md`)으로 함께 열지 정한다.

## 단계

결정이 확정되면 구체화한다. 초안 순서는 다음과 같다.

| 순서 | 하는 일 |
|---|---|
| 1 | 플랫폼 역량 메모 규약과 `check` 검사, 지금까지 열린 주요 역량(폰 기능, 통합 workflow, 다중 기기 등)의 기준선 메모 |
| 2 | 업데이트 review ledger 표·상태 read 확장(`app` + `project` + `home` 현황 요약 포함), 통합 Inbox 감지 |
| 3 | 결정·인계 command(`project`·`home` 대상 지원)와 완료 보고 명령 |
| 4 | Home 업데이트 skill과 project 수신 지침 갱신, 내장 prompt·skill 설명 정렬 |

## 하지 않는 것

- 기동 시 사람 개입 없이 program이 스스로 agent session을 열어 기존 앱이나 workflow를 고치는 것(`architecture/event.md` 불변식 3).
- 판만 맞추려고 아무 기능 변화 없는 workflow나 설정을 건드리는 것.
- 모든 commit/patch마다 플랫폼 메모를 강제하는 것(사용자 대면 역량이나 계약·지침이 바뀔 때만 쓴다).
