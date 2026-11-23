# workflow: 통합 실행 모델, 관측, layout

상태: 로드맵. 2026-10-20·22에 세운 1단계(`kind: agent`, `kind: flow`, workflow desk, `job`의 `workflow_start`, 서드 파티 harness 참가자)는 모두 land했다. 2026-11-23 첫 실사용(`ses_01m83met7bmkbkx618qqmq35rj`, `feature-cleanroom`) 피드백과 제품 방향을 바탕으로 2단계 로드맵과 architecture 초안(`project-docs/products/roadmap/workflow-architecture.md`)을 확정했다.
배경 문서: `project-docs/architecture/{workflow,job,workspace-layout,harness-gui,terminal-agent,attention,agent-call}.md`, `project-docs/products/roadmap/{workflow-architecture,agent-profile,tab-owner}.md`.

## 원칙: lophn program은 최대한 약하다

1단계에서 세운 이 원칙은 2단계에서도 유지한다.
- lophn core는 도메인별 통과 판정, 결과 검증, 순서 강제를 하지 않는다. 결정적 제약과 분기는 각 workflow의 flow code가 진다.
- 2단계에서 더하는 **stall/실패 감지, `workflow_origin` 전파, 병렬 탭 자동 묶음, SDK의 `withFallback` helper**는 정책 판정이 아니라 사실 기록·관측·호출자 편의다.

## 사람의 말 (원문)

2026-11-23:

> 프로그램틱하지만 100퍼센트 프로그램적으로만 돌지는 않는 것, 모순된 말처럼 보이겠지만 그 선을 잘 타야 하는 거야. 프로그램틱하게 workflow를 구축할 수 있어야 해. 마치 agent를 비결정적으로 도는 함수처럼 쓴다는 마인드로 짜는 거야. 근데 그렇기 때문에 workflow가 100퍼 프로그램틱하게 돌 수가 없단 말이야. 왜냐하면 다른 하네스들 간의 의존성에서 다양한 상황이 발생할 수도 있고 agent 작업 자체도 그러하고. workflow 간 연결에서 in/output도 완전 프로그램적으로 정량화할 수가 없잖아. 조사 workflow가 report를 뱉는다 이걸 어떻게 정량적으로 측정하겠어. 근데 또 프로그램틱하게 구축하면 좋은 점이 뭐냐면 lophn에서의 job, app이 발생하는 event를 받아서 실행한다거나 분기한다거나 제어한다거나 그런 것들은 가능했음 좋겠다는 거지. 예를 들어서 구독한도를 조회하는 앱에서 발생하는 event를 통해서 worker를 정한다거나 교체한다거나, github issue를 감지하는 job을 통해 workflow를 트리거한다거나.

> - research 단계가 다 끝났는데 넘어가지를 않음 (치명적)
> - 진행 과정에 대한 feedback이 너무 부족함. 세션 리스트들도 알고 있는데 얼마나 스폰되었는지, 무엇을 하고 있는지 전혀 안 드러남
> - workflow 간 연결(함수처럼 in/output 설정)
> - workflow 시작 전에 조건부적인 설정들을 선언적 UI로 만들 수 있어야 함
> - omp 세션이 로그인 만료 문제 때문에 turn이 바로 종료되는 등 agent loop에는 다양한 상황이 벌어지는데 대응 능력이 너무 부족함
> - 다른 프로젝트 cwd로 스폰되더라도 탭은 같은 workflow의 desk에 있어야 하고, 병렬 탭들은 분할하지 않고 같은 group으로 묶여 있으면 좋겠음
> - 조사 탭 이름이 `<lophn-call ...>`로 뜨고, 확인해도 완료 indicator가 안 지워짐
> - instance artifact도 너무 빈약함. assistant message나 보고서·`.md`·계획 파일 같은 산출물을 보여줄 수 있어야 하고, SDK session에도 workflow 정보를 실어주면 좋겠음 (Agent Monitor처럼 몰라도 되는 앱은 무시하면 됨)
> - 데스크탑 title bar(desk switcher)에서도 진행 중이라는 피드백이 없음

## 왜

### 1. 제품 방향: "비결정적 함수를 엮는 programmatic workflow + event 제어"
- `feature-cleanroom`이 첫 step에서 멈춘 직접 원인은 런타임 버그(별도 이슈로 분리)이지 `kind` 구분 때문이 아니다.
- 통합 실행 모델이 필요한 이유는 제품 방향 때문이다. 현재 `kind: agent`(YAML relay)와 `kind: flow`(flow code)가 두 engine으로 갈라져 있어, **사람과 논의하는 step(`human`), 앱 `tool`/event 기반의 동적 worker 선택·교체(구독 한도 앱 연동), sub-workflow 호출, 재시작 생존**을 한 workflow 안에서 조합할 수 없다.

### 2. 관측·UI/UX·Layout 공백
- **Run 화면과 Instance Artifact**: `workflow_lines`의 짧은 수동 `report` 텍스트만 보여준다. step 세션이 `team spawn`으로 띄운 자식 세션 수·상태·실패 사유, 최근 assistant message, report로 남긴 산출물 파일(`.md` 보고서, 계획 파일 등)을 볼 수 없다. 다른 workspace 참가자 세션은 `[Open session]` 버튼조차 없다.
- **Title bar / Desk Switcher**: `DeskOption.status` 슬롯은 있으나 실제 workflow 진행 상태가 연결되지 않았고, 상단 버튼에도 running/needs-you/blocked 피드백이 없다.
- **Cross-workspace 탭 배치**: `openMemberTab`이 workflow 맥락 없이 실행 project의 기본(`_default`) desk에 탭을 열어, `harness-lab`에서 돈 조사 탭들이 `feature-cleanroom` desk가 아닌 `harness-lab`의 `Main` desk에 흩어진다.
- **병렬 탭 묶음**: `desk-model`의 `Group`은 2~4 분할(`GROUP_MIN = 2`)을 전제로 해, 분할 없이 병렬 worker 탭을 한 묶음으로 관리할 수 없다.

### 3. 실사용에서 확인된 이슈 4건 (버그 3건 + 상한 결함 1건, 별도 이슈로 분리)
이번 실사용에서 잡힌 문제 4건은 로드맵 단계가 아니라 `project-docs/issues/` 이슈로 올려 먼저 고친다.
- `gui-member-resume-loses-replies` (bug): 닫힌 GUI 팀원 탭에 reply가 도착해 `--resume`으로 재기동할 때 ~100ms 만에 `failed/model_error`로 끝나 reply가 유실되고 실패 사유 텍스트도 남지 않는 버그.
- `gui-member-opened-per-project-cap` (defect): `OPENED_PER_PROJECT = 8` 상한 초과 시 즉시 실패하며 상한의 보호 대상과 대기 정책이 정리되지 않은 결함.
- `claude-gui-title-leaks-lophn-envelope` (bug): Claude Code GUI 탭의 `refreshTitle()`이 `<lophn-call ...>` / `<lophn-step ...>` 봉투를 벗기지 않고 탭 이름으로 저장하는 버그.
- `gui-tab-adopt-generation-zero-unseen-stuck` (bug): `openTerminal(adopt)`의 `generation: 0` 및 재시작 복원 GUI 탭의 `entry` 부재로 `GuiSwitch`가 `bridge.focus`를 못 보내 `unseen` 완료 dot이 안 꺼지는 버그.

---

## 상세 설계

2단계 실행 모델, `workflow_origin`, 상태·줄·checkpoint, `agent()`/`human()`/`workflow()`/`onEvent()`/`[Retry]`/`[Resume]`, 관측·SDK·Layout 계약의 정본 초안은 [workflow-architecture.md](workflow-architecture.md) 한 곳에서 관리한다.

---

## 정한 것

### 2026-11-23
1. **실행 모델의 선**: programmatic하게 구축하되 100% programmatic하게만 돌지 않는다. agent를 비결정적 함수처럼 조합하고, I/O는 자연어 요약 + 명시적 산출물 `refs` 기반 Soft I/O(구조화 `data`는 선택)로 두며, 앱 event와 job으로 제어·분기한다. (사람, 2026-11-23)
2. **통합 실행 모델 지금 확정**: 버그 수정 뒤 미루지 않고 2단계 모델 방향을 이번 로드맵과 architecture 초안에서 바로 확정한다. (사람, 2026-11-23)
3. **단일 통합 engine + YAML 내장 interpreter**: `kind: agent`/`kind: flow`를 하나의 engine으로 통합하고, 코드 없는 단순 relay는 그 위 내장 interpreter(YAML 축약형)로 둔다. (agent 제안 · 사람 승인, 2026-11-23)
4. **재시작 시 돌던 `agent()`·`tool()` 자동 재실행 금지**: 기록된 session에 다시 붙어 끊김을 드러내고, flow code에는 둘 다 `interrupted` 실패 값으로 돌려준다(code가 처리하지 않으면 `blocked`). (사람, 2026-11-23)
5. **`[Retry]`의 뜻 통일 & 허용**: 로컬 step이 `blocked`일 때 Run 화면에 `[Retry]`를 허용하며, 뜻은 "같은 session에 이어서 하라는 입력을 넣는다" 하나로 통일한다(세션 전 `not_handed`만 넘기기 재시도). (사람, 2026-11-23 — 2026-10-22 "사람 화면은 진행을 건드리지 않는다" 변경)
6. **멈춘 flow의 "고친 code로 이어 가기" 허용**: 기본은 시작 시점 code snapshot으로 replay하되, 코드 버그로 멈춘 run에서 사람이 최신 flow code로 이어 가기를 명시적으로 고를 수 있게 한다. (사람, 2026-11-23)
7. **`human()` 대기 중 flow process 유지**: core가 켜져 있는 동안 `human()` 대기 중인 process를 내려놓지 않고, durable replay는 재시작과 `ResumeWorkflow`에만 쓴다. (사람, 2026-11-23)
8. **관측 중심 이동**: 기본 Run 화면이 `workflow_origin` 기반 세션 트리·마지막 assistant 앞 N자·명시적 `refs` 산출물을 1급으로 보여주고, custom instance artifact는 특화 뷰가 필요할 때만 보조로 쓴다(`_instance.json` 확장). (agent 제안 · 사람 승인, 2026-11-23)
9. **Title bar & SDK**: `DeskSwitcher`(드롭다운 + 버튼)에 workflow 진행 상태를 표시하고, `@lophn/agent` `SessionInfo`에 선택적 `workflow` 메타를 싣는다. (사람, 2026-11-23)
10. **Cross-workspace Workflow Desk**: 실행 cwd가 다른 project여도 탭은 원 workflow가 속한 workspace의 해당 workflow desk에 모은다. (사람, 2026-11-23)
11. **탭 묶음 개념 통합**: 기존 `GroupLeaf.stack`과 비분할 병렬 `tab group`을 "한 번에 하나만 보이는 탭 묶음" 하나로 통합한다(별도 단계, layout migration 포함). (사람, 2026-11-23)
12. **선언적 `inputs` & `workflow()` 조합**: `workflow.yaml`의 `inputs`(조건부 폼, `agent` 타입 포함)·`outputs` 한 계약으로 `StartBox`, sub-workflow 호출, `job`을 통일한다. (사람, 2026-11-23)
13. **예외 대응 & 저장 상태**: 상시 coordinator agent를 강제하지 않고 SDK `withFallback` helper + 사람 에스컬레이션으로 풀며, 저장 상태는 `running | ended | stopped` 3개를 유지하고 `needs_you`/`blocked`는 읽을 때 계산한다. (agent 제안 · 사람 승인, 2026-11-23)

### 2026-10-20·22 (유지되는 원칙)
- lophn program은 최대한 약하다(도메인 통과 판정·결과 검증을 core에 넣지 않는다).
- 참가자는 있는 agent 또는 사람이다(workflow file 안의 일회용 agent 없음). 사람은 승인 단추가 아니라 실제로 논의하는 참가자다.
- 연락처와 전체 workflow를 agent prompt에 늘 싣지 않는다(캡슐화·prompt cache 유지).
- unattended turn의 approval 규칙은 바꾸지 않는다(묻지 않고 할당·deny 규칙만 적용한다).
- workflow 정의 작성은 project workspace의 agent(`write-workflow` skill)의 책임이다.
- 일반 agent 대화에서는 임의로 workflow를 시작하지 못한다(사람, 승인된 job, 실행 중인 같은 project workflow의 sub-workflow 호출만 허용).

*(2026-10-22에서 명시적으로 바뀐 결정: ① "flow는 재시작 시 무조건 `ended`로 닫는다" → durable checkpoint로 재개 가능(돌던 `agent()`·`tool()` 자동 재실행 금지); ② "agent는 workflow를 시작할 수 없다" → 같은 project 안 실행 중인 workflow의 sub-workflow 호출 허용; ③ "사람 화면은 진행을 건드리지 않는다" → `blocked` 시 Run 화면의 `[Retry]`(같은 session 이어가기) 및 `[Resume]` 허용; ④ "화면은 수동 report 글만 본다" → `workflow_origin`으로 연결된 세션 트리·마지막 assistant 앞 N자·명시적 `refs`까지 관측.)*

---

## 정할 것

- **선언적 `inputs` 조건식(`when`) 최소 문법** (단계 3): `equals` / `in` / `truthy` 3종으로 충분한지.

---

## 단계

두 번 짓지 않고, layout migration 위험을 격리하도록 순서를 잡는다.

| 단계 | 이름 | 하는 일 |
|---|---|---|
| 선행 | 실사용 이슈 4건 수정 | `project-docs/issues/`의 4건(`gui-member-resume-loses-replies`, `gui-member-opened-per-project-cap`, `claude-gui-title-leaks-lophn-envelope`, `gui-tab-adopt-generation-zero-unseen-stuck`) 수정 |
| 1 | 2단계 architecture 초안 확정 (완료) | [workflow-architecture.md](workflow-architecture.md)에 통합 engine, 상태·줄·checkpoint, `workflow_origin`, `agent()`/`human()`/`workflow()`/`onEvent()`/`[Retry]`/`[Resume]` 계약 고정 |
| 2a | `workflow_origin` · 관측 · Cross-workspace Workflow Desk | 세션 `workflow_origin` 기록(넘길 때마다 갱신)·`spawned_by` 상속 → Run 화면 개편(세션 트리·마지막 assistant 앞 160자·명시적 `refs`·cross-workspace `[Open session]`·로컬 stall 감지 + `[Retry]`), `_instance.json` 확장, Title bar / `DeskSwitcher` 진행 표시, `@lophn/agent` `SessionInfo.workflow`, Cross-workspace Workflow Desk |
| 2b | 탭 묶음 개념 통합 (Layout migration) | `desk-model`의 기존 `GroupLeaf.stack`과 비분할 `tab group`을 단일 탭 묶음 개념으로 통합, 전 workspace layout schema migration, `(instance, step/부모)` 단위 병렬 spawn 탭 자동 묶음 |
| 3 | 선언적 `inputs` 폼 UI | `workflow.yaml` `inputs` 스키마(`text`, `select`, `multiselect`, `boolean`, `agent`, `path`/`project`, `when`), `StartBox` 조건부 폼 렌더링, YAML 축약형 `Inputs:` prompt 주입, `write-workflow` skill 갱신 |
| 4 | 통합 Durable Engine · `workflow()` · `onEvent` | 단일 engine + YAML 내장 interpreter, `step(key, fn)`·`human()`·`workflow()`·`onEvent()`·`cancel`·SDK `withFallback` helper, `workflow_checkpoints` durable replay + code snapshot + `ResumeWorkflow(use_latest_code)`, `architecture/workflow.md`로 초안 승격 |

---

## 하지 않는 것

- workflow output의 강제 정량 스키마화 (자연어 요약 + 명시적 `refs`가 기본, 구조화 `data`는 선택).
- 산출물 파일 자동 감시·`.md` 필터링 (agent가 report/output에 명시한 `refs`만 수집).
- 최근 assistant message의 LLM 요약 (앞 N자 절단만 사용).
- 모든 workflow instance에 상시 coordinator agent를 시스템 레벨로 강제 배정하기.
- 재시작 시 끊긴 `agent()`·`tool()`의 자동 재실행.
- 재시작을 넘어 영속 event를 기다리기 (`job`의 비영속 event 원칙 유지).
- lophn core에 도메인별 통과 판정·비즈니스 규칙 넣기.
- 칸마다 탭 줄이 있는 2단 nested pane tree 회귀 (탭 줄은 하나, 통합 탭 묶음 사용).
- workflow file 안의 일회용 agent 정의 및 비용 상한 강제 차단.
