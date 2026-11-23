# platform update: 앱 SDK를 넘어 작업 공간 전체에 새 가능성을 전한다

상태: 로드맵. 2026-11-23 사람이 방향과 결정을 모두 확정했다. `(사람, 2026-11-23)`은 사람이 정한 것이고 `(agent)`는 기존 원칙과 불변식으로 정한 것이다.
배경 문서: `project-docs/{PRODUCT.md,products/AGENT.md}`, `project-docs/architecture/{app-notice,ui-kit,agent-definition,workflow,phone-screen}.md`, `project-docs/products/roadmap/{inbox-history-sdk-migration,sdk-update-checkpoint,phone-capability,workflow,cascade}.md`.
조사: main `86db4d72d` 코드 조사(2026-11-23, Workflow Phase 4 및 `@lophn/flow` 2.0.0 반영).

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

> 전부 추천대로 복수 계정 등록은 그냥 예시였음 그런 게 가능해야한다는거지

## 왜

- lophn은 앱 SDK 바깥에서도 크게 바뀐다: 폰 화면의 native 기능과 앱 file(`phone-capability.md`, `app-file.md`), durable workflow와 `@lophn/flow` 2.0.0(`step(key, fn)`, `human()`, `workflow()`, `onEvent()`, 선언적 `inputs`, `workflow.md`), coding agent `harness_config` 프로필(`agent-profile.md`), 컴퓨터 간 테이블 `sync`와 `across_machines` event, 앞으로 열릴 수 있는 provider별 복수 credential 등록과 선택 activate 같은 lophn 자체 기능들이다.
- 사람은 판마다 무엇이 바뀌어 내 작업 공간 어디에 쓸 수 있는지 대조하지 않는다(`PRODUCT.md` §4 축 1, `AGENT.md` F1). 그 판단은 숲을 보는 Home lophn의 몫이다.
- 지금 업데이트 흐름(`sdk_update_needed` → `/update-apps` → `migrate-sdk`)은 **활성 앱이 선언에 pin한 `@lophn/*` 판**만 본다. 실제로 0.23.155(`86db4d72d`)에서 `@lophn/flow`가 `2.0.0`(`supported_from: "2.0.0"`, breaking)으로 오르고 `migrate-sdk/flow-2.0.0.md`까지 작성됐지만, 어떤 앱도 `@lophn/flow`를 pin하지 않고 project의 `flow.ts`도 판을 기록하지 않아 **기존 workflow는 단 하나도 감지·인계 대상에 잡히지 않는다.**

## 지금 코드

### 기동 시 판 감지와 알림

- `packages/core/main/daemon/wiring/notices.ts`(`afterReady`)가 root `package.json`의 `version`과 `<data>/sdk/<part>/<version>`의 설치 최고 판(`readInstalledVersions`)을 읽어 `notices.observe_version`을 부른다.
- ledger `core_meta` 표의 `product_version`·`sdk_versions`와 다르면 `lophn_updated {from, to}` 영구 줄을 남긴다(`architecture/app-notice.md`). 이 줄은 toast도 `action` 단추도 없는 History 기록이다.

### 앱 SDK 감지와 checkpoint (`sdk-status`, `update-apps`)

- 설치되는 SDK는 13개(`packages/sdk/*`)이고 `packages/core/agent-workspaces/skills/migrate-sdk/`에 판별 메모 126개(`flow-2.0.0.md` 포함)가 있다(`tools/check-sdk-notes.ts`가 사슬과 지원 하한을 검사).
- `packages/core/apps/sdk-status/status.ts`(`readSdkStatus`)는 활성 앱의 켜진 release 선언 `sdk_dependencies`만 읽는다. `detect.ts`(`recordSdkUpdates`)가 `required`·`unreviewed` 앱 수를 세어 `sdk_update_needed` 줄 하나(`open_home_skill` `update-apps`)를 남긴다.
- `schema.ts`와 `review-store.ts`는 `sdk_reviews`(앱별 `through`, `decision`)와 `sdk_features`(`id`, `app`, `title`, `proposal`, `note_file`, `state: open | done | changed | skipped`, `outcome`) 두 표를 두고 `decide.ts`가 기록과 앱 handoff를 한 동작으로 묶는다.

### 앱 바깥의 공백

1. **앱이 아닌 자산은 검토 사슬에 없다.**
   - 모든 project의 `flow.ts`는 `<data>/projects/node_modules/@lophn/flow` 단일 symlink로 최신 설치 사본을 바라본다(`packages/core/main/flow-host/sdk-link.ts`). `@lophn/flow` 2.0.0처럼 breaking 변경이 올라와도 어느 workflow가 옛 판 기준인지 적힌 곳이 없어 `readSdkStatus`에 잡히지 않고 새 run을 시작할 때 런타임 예외로 죽는다.
   - 기존 workflow를 새 기능(선언적 `inputs`, `onEvent`, sub-workflow `workflow()`)으로 개선하거나, 새 시스템 기능(coding agent 프로필, 복수 credential 등)을 기존 agent·workflow 구성에 제안하는 흐름이 없다.
2. **바뀐 지침과 습관이 닿지 않는 자리가 있다.**
   - `runtime: custom`인 agent는 내장 지침을 싣지 않고 정의 본문만 읽는다(`architecture/agent-definition.md` 불변식 29).
   - 앱 source의 `AGENTS.md`는 `migrate-sdk` 메모의 `## Instruction diff`로 고치지만, Home·project의 `LOPHN.md`·`memory.md`·사용자 작성 skill(`<data>/projects/<prj>/skills/`, `.lophn/skills/`)에 옛 한계 시절 적어 둔 우회 규칙을 돌아볼 계기가 없다.
3. **평소 대화에서 새 세부 역량이 가려지고, 메모 누락을 막는 검사가 없다.**
   - 내장 skill은 이름과 frontmatter `description` 한 줄만 system prompt에 실린다(`agent-definition.md` 불변식 45). 새 역량이 본문 안쪽이나 딸린 `.md`에만 들어가면 평소 turn에서 agent가 그 skill을 열지 않아 옛 방식으로 답한다.
   - 역량이 바뀌었을 때 메모나 prompt 갱신을 빼먹어도 `check`가 잡지 못한다.

## 공통 토대 (`cascade.md`와 공유)

이 로드맵과 `cascade.md`, 기존 `sdk_features`는 같은 메커니즘을 두 번 만들지 않고 아래 두 조각을 공유한다.

1. **작업 공간 정본 reader**: 활성 앱 선언, `jobs` 표, 활성 project의 `workflows/*/workflow.yaml`·skill·artifact 목록, agent 정의, 연결된 provider 현황을 정본에서 직접 읽는 공용 reader 하나를 둔다(`cascade.md`의 정적 참조 조회기와 같은 바탕).
2. **공통 follow-up item**: 어떤 계기(앱 SDK 업데이트, 플랫폼 업데이트, 삭제·계약 변경 cascade)로 특정 그릇(`home | project | app`)의 lophn에게 맡긴 후속 작업 하나를 단일 표와 단일 완료 보고 명령(`open → done | changed | skipped` + 한 줄 `outcome`)으로 관리한다(기존 `sdk_features`를 이 표로 통합·확장).
   - `through` checkpoint와 `leave` 결정은 스트림을 읽는 업데이트 검토(`sdk_reviews`와 플랫폼 review)에만 두고, 사건 단위로 생기는 `cascade`에는 두지 않는다.

## 무엇을 만드나

### 1. 평소 turn 인지 정렬과 누락 방지 `check`

- 새로 열린 핵심 가능성(폰 native 기능·앱 file, durable flow 2.0·선언적 `inputs`·`onEvent`, 다중 기기 등)이 평소 기획 turn에서도 바로 보이도록 내장 prompt(`home.md`, `project.md`, `app.md`)와 내장 skill의 frontmatter `description`("언제 읽어야 하는지")을 정렬한다. system 고정 층에 동적 판 비교 글은 넣지 않는다(prompt cache 보존).
- `tools/records.ts check`를 확장해, `modules`에 사용자·agent 역량 표면(`packages/protocol`, `packages/cli`, `packages/sdk`, `packages/core/agent-workspaces`, `packages/core/workflows`, `packages/core/lophn-agent`)이 포함된 새 change-log 항목에는 `platform_note: <note id> | none` 칸을 필수로 요구한다(이미 올라간 옛 항목은 제외).

### 2. Workflow의 `flow_sdk` 도장과 플랫폼 역량 메모(platform note)

- **workflow 작성 기준 판 도장(`flow_sdk`)**: 폴더마다 `package.json`을 두지 않고 `flow.ts`가 있는 workflow의 `workflow.yaml`에 `flow_sdk: "2.0.0"` 한 줄을 기록한다(`workflow.check` 통과 시 기록·검사, 실행 symlink는 지금처럼 최신 사본 하나 유지).
  - `flow_sdk`(없으면 `1.0.0` 취급)가 설치된 `@lophn/flow`의 `supported_from`보다 낮으면 `required`(실행 전에 `migrate-sdk/flow-*.md`로 수리 필수, `StartWorkflow` 입구에서 이유와 함께 차단), `supported_from` 이상이고 최신 판보다 낮으면 `available`로 감지한다.
- **플랫폼 역량 메모**: 앱 SDK와 `flow_sdk` 도장 바깥의 변화(선언적 `inputs` 같은 선언 기능, project skill·artifact 기능, agent·provider·권한·다중 기기 같은 lophn 자체 기능)는 고정 절차 skill 하나에 딸린 **플랫폼 역량 메모(`<slug>.md`)** 와 **append-only 순서 파일(`platform-notes.json`)** 로 관리한다.
  - 메모 하나는 `id`(slug), `Breaking: yes | no`, 적용 영역(`home | project | workflow | agent | app`), 새로 가능해진 것과 옮기는 법, 바뀐 지침 습관(`Instruction diff`)을 담는다.

### 3. 단일 창구 업데이트 검토, 자산 매칭 제안, 소유별 수정

- Inbox 알림 줄과 Home 업데이트 skill은 **하나의 단일 창구**로 통합한다(알림 문구에 당장 막힌 `required` 앱·workflow 수를 따로 표시해 긴급도를 드러낸다).
- ledger에 Home의 플랫폼 검토 위치(`through`: 마지막으로 검토한 note id; 새 data root `fresh: true`는 현재 끝 note로 시작)와 project/workflow별 `flow_sdk` 검토 위치를 둔다.
- Home lophn이 상태 read 하나로 앱별 SDK 상태, workflow별 `flow_sdk` 상태, 미검토 platform note, 열린 follow-up item, 작업 공간 자산 요약을 함께 읽고 숲을 판단한다:
  - 필수 migration(`required` 앱·workflow, `Breaking: yes`)은 묻지 않고 바로 인계한다.
  - 선택 질문(`ask`)은 **이미 가진 자산(앱, workflow, agent·provider 구성)에 당장 실익이 있는 제안만** 올린다. 당장 붙일 자산이 없는 새 역량은 질문하지 않고 보고 맨 끝에 한 줄 참고 안내로만 덧붙인다.
  - 옛 한계를 전제한 우회 규칙 정리는 소유권으로 가른다: agent 소유(`memory.md`, 생성 skill)는 고친 뒤 무엇을 뺐는지 보고하고, 사람 소유(`LOPHN.md`)는 지워도 된다고 제안만 한다.
- 결정 command 하나가 checkpoint를 올리고 공통 follow-up item을 만들며 대상 그릇(`app`, `project`, `home`)으로 handoff를 보낸다.

## 정한 것

1. **`workflow.yaml`에 작성 기준 판 도장 `flow_sdk`를 기록한다**: 멀티 버전 실행기는 두지 않고 `workflow.check`가 검증된 `@lophn/flow` 판을 도장으로 남겨, 지원 하한 아래로 떨어진 workflow를 `required`로 감지하고 수리 전 실행을 입구에서 막는다. `(사람, 2026-11-23)`
2. **창구는 하나로 합치고, 질문은 보유 자산 매칭만 하며, 글 수정은 소유권으로 가른다**: 단일 Inbox 줄(`required` 수 명시)·단일 skill에서 앱·workflow·시스템을 함께 보되, `ask`는 보유 자산에 실익 있는 것만 묻고 나머지 새 역량은 보고 끝 한 줄 안내로만 전한다. `memory.md`·생성 skill은 고친 뒤 보고하고 `LOPHN.md`는 제안만 한다. `(사람, 2026-11-23)`
3. **provider 복수 credential은 이 체계가 다뤄야 할 플랫폼 기능의 예시이며 이번에 별도 기능 로드맵을 열지는 않는다**. `(사람, 2026-11-23)`
4. **공통 토대 공유**: 작업 공간 정본 reader와 follow-up item(표, handoff 조립, 완료 보고 명령, 수신 지침)은 `cascade.md` 및 기존 `sdk_features`와 하나로 합친다. `through` checkpoint는 업데이트 검토에만 둔다. `(agent)`
5. **메모 key는 append-only 순서 manifest + slug id로 둔다**: 제품 PATCH 판은 `land.sh`·`main-merge.sh`가 올릴 때 정하므로 branch에서 판 번호로 사슬을 이을 수 없다. 새 설치(`fresh: true`)는 `through`를 manifest 끝으로 초기화한다. `(agent)`
6. **메모·지침 누락 검사는 역량 표면 `modules`를 건드린 새 change-log 항목의 `platform_note: <id> | none`으로 잡는다**. `(agent)`
7. **평소 turn 인지가 1단계다**: 내장 prompt·skill `description` 정렬이 가장 싸고 평소 대화에 바로 닿는다. 메모 본문은 skill 옆 `.md`에 두어 prompt cache를 깨지 않는다. `(agent)`
8. **`runtime: custom` agent 수정 주체**: 전역 정의는 Home lophn이, `project`·`app` 범위 정의는 그 그릇의 lophn이 `agent.update`로 본문과 `tools`·`skills`를 고친다. `(agent: agent-definition.md 불변식 18·30)`
9. **보관된 앱·project는 감지와 제안에서 뺀다**: 되살렸을 때 그때의 상태와 현재 차이로 다시 본다. `(agent)`

## 정할 것

없다.

## 단계

| 순서 | 하는 일 | 비고 |
|---|---|---|
| 1 | 내장 prompt·skill `description`에 최근 역량 정렬 + `records.ts check`의 `platform_note` 검사 | 독립·선행 가능 |
| 2 | 공통 토대(`cascade.md` 단계 2와 공유): 작업 공간 정본 reader + 공통 follow-up item 표(`sdk_features` 통합)·보고 명령 | `cascade`와 한 번에 구현 |
| 3 | `workflow.yaml`의 `flow_sdk` 도장·차단·감지, `platform-notes.json`·메모 규약과 기준선 메모(`flow-2.0.0.md` 연결 포함), 플랫폼 `through` review와 상태 read 확장, 단일 업데이트 skill | 1·2 위 |

## 하지 않는 것

- 기동 시 사람 개입 없이 program이 스스로 agent session을 열어 기존 앱이나 workflow를 고치는 것(`architecture/event.md` 불변식 3).
- `@lophn/flow` 옛 판으로 기존 `flow.ts`를 계속 돌리는 멀티 버전 flow 실행기.
- 기능 변화 없이 판만 맞추려고 멀쩡히 도는 앱이나 workflow를 건드리는 것.
- 사람이 쓴 `LOPHN.md`를 agent가 묻지 않고 직접 고쳐 쓰는 것.
- 사용자·agent 역량과 무관한 내부 수정마다 플랫폼 메모 작성을 강제하는 것.
