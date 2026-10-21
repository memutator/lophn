# tr-eval-human

eval의 사람 역할이 activation 동의를 `activations.consents`와 `activation.consent`(compare `{requested_at}`)로, turn request를 `turnRequestDecide`로 답하게 다시 쓴다. idle 판정은 `turn_requests` 수와 동의 대기 수를 읽는다.

- 단위: eval (wave 2)
- 선행: tr-eval-prune-coding.
- 소유(이 task만 고친다):
  - `tests/eval/human/{role,approve,human_test,mod}.ts`
  - `tests/eval/types.ts`
  - `tests/eval/runner/{idle,idle_test}.ts`
- 계약:
  - 쓰는 것: `packages/protocol/apps/activation/consent.ts`(`activationConsents`, `activationConsent`, `ActivationConsent`의 `comparison`), `packages/protocol/approvals/turn-request.ts`(`turnRequestDecide`, subject kind `app_tool | mcp_tool | shell | harness`), `packages/protocol/events/mod.ts`의 `sessionSnapshotsList`(`turn_requests`)
  - 내놓는 것(시나리오 task가 기댄다):
    - `types.ts`: `ApproveRule = { activation?: "allow" | "reject"; shell?: "once" | "always" | "reject" }`. 적지 않은 것은 `reject`다. 시나리오의 `approve: { activation: "allow" }`는 그대로 쓴다. `IntentKind`, `RequestChoice` import가 없다. `HumanRecord.decisions`의 줄은 답한 동의의 `comparison`을 싣는다.
    - `runner/idle.ts`의 `readSnapshot`: `permissions`는 `turn_requests` 수, `pendingApprovals`는 `activations.consents`의 줄 수다.

## 할 일

`role.ts`·`approve.ts`의 옛 approvals route를 동의와 turn request route로 바꾸고, `idle.ts`의 snapshot 읽기를 맞추고, `human_test.ts`를 새 route로 줄여 쓴다.
