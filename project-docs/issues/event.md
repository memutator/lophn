# event

domain event를 Ledger에 남기고 Reactor가 at-least-once로 반응하는 장치. `project-docs/architecture/event.md`.

## core에 `session_snapshots/list` read가 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/approvals, packages/core/main, packages/shell/renderer]
```

지금: `packages/protocol/events/snapshot.ts`가 `sessionSnapshotsList`(session의 지금 상태, 대기 중인 permission request, 질문)를 정의하고 `packages/protocol/registry.ts`에 올라 있지만, core에 그 read handler를 다는 곳이 없다. `packages/core/server/dispatch.ts`의 `read()`가 handler를 못 찾아 `unavailable: read unavailable`을 낸다. `packages/core/approvals/approvals.ts`가 service에 `turnRequests`를 내놓지만 부르는 곳이 없다. `tests/e2e/approval_test.ts`와 `tests/e2e/restart_test.ts`가 `waitPermission`(`tests/support/core/human.ts`)에서 재현한다.

영향: renderer의 `readSessions`(`packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`)는 session이 하나라도 있으면 이 read를 부르고, 실패하면 목록 전체를 실패로 돌려준다. 화면이 붙거나 다시 붙을 때 대기 중인 허락 요청과 질문을 snapshot으로 다시 맞추는 길(`architecture/event.md`)이 없다.

고치려면:
- read handler를 단다(중간): session 상태는 lophn-agent의 turn 기록에서, `permission_requests`는 approvals의 `turnRequests`에서, 질문은 그 저장소에서 모은다. 조립은 `main/daemon/wiring/`에서 한다(approvals와 lophn-agent를 잇는 곳).
- 추천: read handler를 단다. snapshot은 architecture가 정한 계약이다.
