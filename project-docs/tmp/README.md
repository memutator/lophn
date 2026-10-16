# tmp

문서화 session과 src 리팩터링 session이 쓰는 작업 공간이다. 정본(`../PRODUCT.md`, `../values.yaml`, `../boundary-catalog.yaml`, `../requirements/`)이 아닌 기록, 구조 초안, 조사가 여기 있다.

## 무엇이 어디 있나

| 위치 | 무엇 | 읽을 때 |
|---|---|---|
| `changes.md` | 코드가 따라가야 할 변경의 index: 요구 현황, 구조 변경, 지울 코드, 바뀐 동작, 열린 것 | 리팩터링과 구현을 계획할 때 먼저 읽는다 |
| `changes-by-topic.md` | 옛 요구 주제 86개마다 새로 생김, 아예 덜어냄, 보류, 바뀜, 일부 덜어냄, 그대로 | 무엇을 새로 짜고 무엇을 지울지 대략 잡을 때 |
| `implementation-inventory.md` | 코드 쪽 할 일 전수(UI 밖): 덜어낼 것, 고칠 것, 새로 만들 것, 만들지 않는 것, 순서 제약 | 리팩터링과 구현의 할 일을 잡을 때 |
| `ui-inventory.md` | UI 할 일 전수: 화면별 덜어낼 것, 고칠 것, 새로 만들 것, 만들지 않는 UI, 순서 제약. 확정한 결정 반영 | 화면을 검토하거나 renderer를 고칠 때 |
| `inventory/` | 전수 조사의 영역 원본(01~12), 열린 것(`00-open.md`), 열린 물음의 결정(`00-decisions.md`, 확정) | 목록 줄의 출처나 결정을 확인할 때 |
| `test-lessons.md` | 지금 test에서 배운 것: 숫자, 느린 이유, 쓸모없는 종류, 값진 모양, 새로 쓸 때 규칙, check 파이프라인. 원본은 `test-survey/` | test를 새로 쓰거나 check를 바꿀 때 |
| `research-items.md` | 다른 harness를 조사하면 싸게 정해지는 것의 목록과 상태 | spec을 쓰다가 조사거리가 생기거나 조사를 돌릴 때 |
| `specs/index.md` | 쓸 spec의 목록(S1~S8), 쓰는 기준, 담을 것, 진행 방식, 상태 | spec을 쓰거나 이어 쓸 때 먼저 읽는다 |
| `docs-review.md` | 문서화 session의 결정 기록. 사람 원문, lead 해석, 반영 내역 | 어떤 요구나 구조가 왜 그렇게 정해졌는지 알고 싶을 때. 새 기록은 여기 이어 쓴다 |
| `tmp-review.md` | 처음 session의 기록. docs를 새로 쓰기로 한 결정, src 구조, values | 7장(src 구조)은 리팩터링 session이 고친다. 문서화 session은 고치지 않는다 |
| `architecture/event.md` | event 구조 (옮겨 감. 다르면 S1 `specs/event.md`를 따른다) | 일어난 일을 다루는 길, Bus, Ledger, Reactor, Router |
| `architecture/approval.md` | approval 구조 (옮겨 감. 다르면 S2 `specs/approval.md`를 따른다) | grant, Gate, request, rewind |
| `architecture/agent-call.md` | agent call 구조 (옮겨 감. 다르면 S3 `specs/agent-call.md`를 따른다) | agent 사이의 부름: 봉투, 받는 곳, 답 방식, 상태, transport |
| `notes/removed.md` | 지운 것, 보류, 바뀐 모델 | 옛 기능이 왜 없는지. 나중에 `../products/change-log`로 옮긴다 |
| `notes/terms.md` | 말 표 | 어떤 말을 쓰고 어떤 말을 쓰지 않는지 |
| `research/` | 다른 harness 조사 25개(event 다섯, orca, paseo, Hermes approval, agent call 셋, agent definition 셋, sandbox 셋, S4 좁은 조사 여섯, S6 turn 끝 신호, session 허락 수명) | 구조의 근거를 확인할 때. 결론은 architecture와 specs에 있다 |
| `archive/` | 끝난 requirements migration의 작업물: 범위(`migration-plan.md`), 그때 정할 것(`migration-questions.md`), 옛 요구 줄마다의 분류표(`triage/`), worker 보고와 새 ID ↔ 옛 줄 대응(`written/`) | 거의 읽지 않는다. 요구가 옛 문서의 어디서 왔는지 추적할 때만. 안의 경로는 옮기기 전 것이다 |

## 옛 경로 (2026-10-14 정리)

`docs-review.md`의 사람 원문과 지난 기록에는 옛 경로가 남아 있다.

| 옛 경로 | 지금 |
|---|---|
| `migration/event-architecture.md` | `architecture/event.md` |
| `migration/approval-architecture.md` | `architecture/approval.md` |
| `migration/removed.md`, `migration/terms.md` | `notes/` |
| `migration/research-*.md` | `research/*.md` (`research-` 뗌) |
| `migration/plan.md`, `migration-questions.md`, `migration/triage/`, `migration/written/` | `archive/` |
| `migration/event-model-draft.md`, `approval-model-draft.md`, `record-model-note.md` | 지움. 내용은 architecture 두 문서와 `docs-review.md` 11~12장 |
| `migration/app-engineer-flow.md` | 지움. tickets, coding-agent 결정(`docs-review.md` 10장)과 요구 req-1453~1455, req-1491 |
| `migration/semantic-sweep-{a,b,c}.md` | 지움. 닫힘(`docs-review.md` 12장 끝) |
