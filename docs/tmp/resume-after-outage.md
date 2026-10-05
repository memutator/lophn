---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# glm outage (thehive org paused) — 이어 할 일

사람 결정: 새 작업은 멈춤. 아래는 끊긴 worker의 상태다. 다시 시작할 때 이 worktree에서 이어 간다.
WIP commit은 local에만 있다(push하지 않음, 리뷰 전).

| 작업 | worktree | branch | 상태 |
|---|---|---|---|
| documents T11 (관측→Version, route 서빙) | agent-add096660c64945c8 | documents-t11-observation | WIP commit 09cc056. PR 없음. T14·T20 넘어온 서빙, child blob.prepare 대기 |
| apps T9 (실행 상태·관측) | agent-a2b9557d614887bdd | apps-t9-runtime-observations | WIP commit b65595a. log-buffer test 작성 중이었다 |
| platform T35 + core settings 서빙 | agent-a1b2d8faa54c8b0e1 | platform-settings/coding-harness-validation | PR #236 열림. WIP 3572902는 제품 registry 등록·core settings 서빙 작업(미완, 미push) |
| documents T18 (Series 읽기) | agent-a690411f50dfc80fb | documents-series/series-reads | PR #241 열림. 남은 것: versions save → series 가입 seam(T17에서 넘어온 것) |
| coding-agent T30 (adapter) | agent-a6e09f2af27751f8f | coding-agent-harnesses/adapters-main | local commit 있음, PR 없음. #224의 제품별 파일 분할 반영 필요 |
| lophn-agent T15 (provider 실패) | agent-a3c8376eaa580d968 | worktree-agent-a3c8376eaa580d968 | local commit 있음(대부분 main merge일 수 있음), PR 없음 |
| lophn-agent T10 (run ledger) | agent-a6ff1fb8669a9c23e | — | 변경 없음. 처음부터 |
| problems T9 (app test 보고) | agent-ab9f31bb7762936c5 | — | 변경 없음. 처음부터 |
| 사람 user token scope (lead 결정) | 없음 | — | 처음부터. apps/core/parent.ts의 status·health만 있는 scope를 user actor route 전체로 |
| child→core blob.prepare 감독 pipe (lead 배정) | 없음 | — | 처음부터. problems T4 collector·documents T11이 기다림 |

다음 준비된 작업(아직 안 보냄): documents T23, T29, problems T9(위), lophn-agent T10·T15(위).
