# tr-eval-human

eval의 사람 역할이 activation 동의를 `activations.consents`와 `activation.consent`(compare `{requested_at}`)로, turn request를 `turnRequestDecide`로 답하게 다시 쓴다. idle 판정은 `turn_requests` 수와 동의 대기 수를 읽는다.

- 단위: eval (wave 2)
- 선행: tr-eval-prune-coding.
- 소유(이 task만 고친다):
  - `tests/eval/human/{role,approve,human_test,mod}.ts`
  - `tests/eval/types.ts`
  - `tests/eval/runner/{idle,idle_test}.ts`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md` "정한 것"(앱을 운영으로 올리는 helper의 동의 길), `project-docs/plan/test-restore/survey-eval.md` §3 "How the eval human role consents to activation now"(1~5와 `human_test.ts` 줄)
  - architecture: `project-docs/architecture/eval.md` "지키는 것"의 "사람 역할은 카드와 허락 규칙만 따른다"(93줄. 규칙에 없는 종류는 거절, 사람 역할이 있으면 보류 허락은 쉼이 아니다), `project-docs/architecture/activation.md` "지키는 것"의 "동의는 activation의 상태다" 줄과 그 아래 다섯 줄(같은 release는 한 줄, `requested_at`이 바뀌면 옛 동의는 `conflict`, 거절은 줄을 지운다), `project-docs/architecture/approval.md` "지키는 것"의 "묻는 길"(선택지 `once | always | reject`, `always`는 `always_patterns`가 비면 `invalid_input`)과 첫 절 "흐름"(앱 tool·MCP tool·agent call은 묻지 않는다. 묻는 것은 shell 규칙이 `ask`인 명령뿐이다)
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`(boundary 없음. 제품 코드는 여기를 import하지 않는다)
  - 코드(줄은 HEAD `85f19080e` 기준. wave 1 merge 뒤 `types.ts` 줄은 움직인다)
    - `packages/protocol/apps/activation/consent.ts`(15-21 `activationConsentSchema`·`ActivationConsent`, 36-45 `activationConsent` 입력 `{release, choice}`·compare `{requested_at}`·출력 `{release, outcome}`, 61-77 `activationConsents` 입력 `{app?}`·출력 `consents`). `packages/protocol/apps/activation/activation.ts` 131-146 `activationComparisonSchema`(`ActivationComparison`). 둘 다 `packages/protocol/apps/mod.ts`가 다시 내보낸다
    - `packages/protocol/approvals/turn-request.ts`(15 `TURN_REQUEST_CHOICES`, 24-32 `turnRequestChoiceSchema`, 36-58 `turnRequestSchema`의 `subject`·`always_patterns`, 77-96 `turnRequestDecide` 입력 `{session, request, choice}`), `packages/protocol/approvals/gate-call.ts` 10-27(subject kind `app_tool | mcp_tool | shell`, 여기에 `harness`)
    - `packages/protocol/events/snapshot.ts` 18-33(snapshot의 `turn_requests`, `questions`)
    - `packages/core/approvals/turn-requests.ts` 97-150 `decide`(없는 request는 `not_found`, 닫힌 request는 `conflict`, 빈 `always_patterns`의 `always`는 `invalid_input`)
    - 본보기: `packages/shell/renderer/desktop/connection/waiting/decide.ts` 70-113(데스크톱 대기 목록이 같은 두 route로 답한다)
    - 고칠 곳: `tests/eval/human/role.ts`(2-6 옛 approvals import, 15 `choosePending`·`chooseTurn`, 44-45 `CLOSED`, 165-190 `permission_requests` 결정, 192-218 `approvalsPending` 결정), `tests/eval/human/approve.ts`(전체), `tests/eval/human/mod.ts` 1, `tests/eval/human/human_test.ts`(44-89 `fakePort`, 99-144 첫 test), `tests/eval/runner/idle.ts`(2 `approvalsPending` import, 13-18 `Snapshot`, 113-149 `readSnapshot`), `tests/eval/types.ts`(13-16 `IntentKind`·`RequestChoice` import, 147-153 `ApproveRule`·`HumanSpec`, 316-339 `HumanRecord`)
    - 읽는 쪽(고치지 않는다): `tests/eval/runner/steps.ts` 46-62(`readSnapshot(core, { approvals: human !== undefined })`와 `human.tick()`), `tests/eval/runner/trial.ts` 80-86(`humanSummary`가 `decisions.length`만 센다), `tests/eval/runner/cli.ts` 72, 시나리오의 `approve: { activation: "allow" }`(calendar 넷), `tests/eval/experiment/overfit/overfit_test.ts` 16(`approve: {}`)
- 계약:
  - 쓰는 것: `packages/protocol/apps/activation/consent.ts`(`activationConsents`, `activationConsent`, `ActivationConsent`의 `comparison`), `packages/protocol/approvals/turn-request.ts`(`turnRequestDecide`, subject kind `app_tool | mcp_tool | shell | harness`), `packages/protocol/events/mod.ts`의 `sessionSnapshotsList`(`turn_requests`)
  - 내놓는 것(시나리오 task가 기댄다):
    - `types.ts`: `ApproveRule = { activation?: "allow" | "reject"; shell?: "once" | "always" | "reject" }`. 적지 않은 것은 `reject`다. 시나리오의 `approve: { activation: "allow" }`는 그대로 쓴다. `IntentKind`, `RequestChoice` import가 없다. `HumanRecord.decisions`의 줄은 답한 동의의 `comparison`을 싣는다.
    - `runner/idle.ts`의 `readSnapshot`: `permissions`는 `turn_requests` 수, `pendingApprovals`는 `activations.consents`의 줄 수다.

## 할 일

근거는 README "정한 것"의 helper 줄(동의는 `activations.consents`를 읽어 `activation.consent`로, `requested_at` 비교)과 survey §3이다. 사람 역할은 데스크톱 대기 목록과 같은 두 route만 쓴다. 제품 route를 더하지 않는다.

1. `tests/eval/types.ts`
   1. `IntentKind`, `RequestChoice` import(13-16)를 지운다. `ActivationComparison`은 `packages/protocol/apps/mod.ts`에서, `TurnRequest`는 `packages/protocol/approvals/mod.ts`에서 type으로 import한다.
   2. `ApproveRule`(149)을 계약의 모양으로 바꾼다. 주석(왜): 적지 않은 것은 거절이다(규칙에 없는 허락을 소리 없이 주지 않는다). `activation`은 첫 activation·넓힌 선언·손실 migration의 동의, `shell`은 shell 규칙이 `ask`인 명령의 turn request다. 앱 tool, MCP tool, agent call은 묻지 않아 규칙이 없다(`architecture/approval.md`).
   3. `HumanRecord.decisions`(328-338)를 두 갈래로 바꾼다.
      - 정한 것: 아래 꼴이다. 이유: 계약은 "답한 동의의 `comparison`을 싣는다"만 정했다. 동의는 session이 없고 turn request는 비교가 없어 한 꼴에 null 칸을 두는 것보다 갈래가 읽기 쉽다. 이 줄을 읽는 곳은 수(`trial.ts`의 `decisions.length`)뿐이다.

        ```ts
        export type HumanDecision =
          | {
            at: string;
            path: "consent";
            app: string;
            release: string;
            comparison: ActivationComparison; // 사람이 본 비교 그대로(first, added_resources, added_tools, loss_steps)
            choice: "allow" | "reject";
            rule: "allow" | "reject" | null; // 시나리오 규칙. null이면 규칙 없음
            error: string | null;
          }
          | {
            at: string;
            path: "turn";
            session: string;
            request: string; // apr_...
            subject: TurnRequest["subject"];
            choice: "once" | "always" | "reject";
            rule: "once" | "always" | "reject" | null;
            error: string | null;
          };
        ```

      - `HumanRecord`의 `decisions`는 `HumanDecision[]`이다. `HumanSummary.decisions`(수)는 그대로다.
   4. 이 task가 아닌 칸(coding 갈래, `Scenario.limits` 등)은 tr-eval-prune-coding이 고친 그대로 둔다.
2. `tests/eval/human/approve.ts`를 다시 쓴다(`packages/protocol/approvals/mod.ts`의 `TurnRequest`, `TurnRequestChoice`만 import).
   1. `chooseTurn(approve, request): { choice: TurnRequestChoice; rule: ApproveRule["shell"] | null }`
      - `request.subject.kind`가 `shell`이 아니면 `{ kind: "reject", reason: "no approval rule in the scenario" }`, rule null. 앱 tool·MCP tool은 지금 묻지 않고, `harness`는 터미널에서 답하는 물음이라 규칙을 두지 않는다.
      - rule = `approve.shell ?? null`. null이면 위와 같은 거절, `"reject"`면 `reason: "rejected by the scenario approval rule"`.
      - `"always"`인데 `request.always_patterns`가 비면 `{ kind: "reject", reason: "rule choice not offered" }`(core가 `invalid_input`으로 받지 않는다. 규칙 밖의 선택을 만들지 않는다).
      - 그 밖에는 `{ kind: rule }`.
   2. `chooseConsent(approve): { choice: "allow" | "reject"; rule: ApproveRule["activation"] | null }`: rule이 `"allow"`일 때만 allow, 나머지(없음 포함)는 reject. 동의의 거절은 이유를 싣지 않는다(`activation.consent` 입력에 칸이 없다).
   3. 옛 `choosePending`, `rejectFor`의 `RequestChoice` 쓰임을 지운다. 거절 이유 글은 한 줄이다(agent에게 그대로 간다, `turnRequestChoiceSchema`의 `reason`).
3. `tests/eval/human/role.ts`
   1. import: `approvalsDecide`, `approvalsDecideTurn`, `approvalsPending`(2-6)을 `turnRequestDecide`(`packages/protocol/approvals/mod.ts`)와 `activationConsent`, `activationConsents`(`packages/protocol/apps/mod.ts`)로 바꾼다. `choosePending` 대신 `chooseConsent`.
   2. turn request(165-190): `snap.permission_requests`를 `snap.turn_requests`로 돌고, `chooseTurn` 결과로 `call(turnRequestDecide, { session: snap.session, request: request.id, choice })`. 기록 줄은 `path: "turn"`, `subject: request.subject`, `choice: choice.kind`. 성공이거나 `CLOSED`(`not_found`, `conflict`)면 다시 보지 않는다(지금 `seenRequests` 그대로).
   3. 동의(192-218): `call(activationConsents, {})`의 `consents`를 돈다. 줄의 열쇠는 `${release}@${requested_at}`이다(같은 release를 다시 물으면 `requested_at`이 바뀐다. 그때는 새 줄로 다시 답한다). `chooseConsent`로 고르고 `call(activationConsent, { release, choice }, { requested_at })`. 기록 줄은 `path: "consent"`, `app`, `release`, `comparison`(읽은 줄 그대로), `choice`, `rule`, `error`. 성공이거나 `CLOSED`면 그 열쇠를 다시 보지 않는다(`conflict`는 그 사이 다시 물었거나 더 새 release가 닫았다는 뜻이다).
   4. 주석(192)은 "activation 동의는 session에 안 드러난다: App Engineer turn은 `waiting_consent`를 받고 바로 끝난다"로 고친다. 질문 처리(98-163)와 `call`의 예외 감싸기(75-87)는 그대로다.
   5. 순서는 지금처럼 질문 → turn request → 동의다. snapshot을 못 읽으면 지금처럼 그 tick은 아무것도 하지 않는다.
4. `tests/eval/human/mod.ts` 1: `choosePending` 대신 `chooseConsent`를 내보낸다.
5. `tests/eval/runner/idle.ts`
   1. `approvalsPending` import(2)를 `activationConsents`(`packages/protocol/apps/mod.ts`)로 바꾼다.
   2. `readSnapshot`(116-149): `permissions: item.turn_requests.length`. `options.approvals`이면 `pendingApprovals = (await core.call(activationConsents, {})).consents.length`. 서명(`readSnapshot(core, { approvals?: boolean })`)은 그대로 둔다(`runner/steps.ts`가 고치지 않고 쓴다).
   3. coding session 갈래(123-126)와 그 머리 주석(113-115)을 지운다. 이유: coding session을 여는 길이 없다(README "정한 것" 지우는 eval). 입력을 첫 page만 읽는다는 한 줄은 남긴다.
   4. `Snapshot`의 주석(14, 17)과 `IdleHooks`의 "보류 approval"(25-26)을 동의 대기로 고친다. `running` 주석에서 coding을 뺀다.
6. `tests/eval/runner/idle_test.ts`: `pendingApprovals` 이름이 그대로라 판정은 고치지 않는다. 주석과 test 이름의 "보류 허락·pending approvals"만 "동의 대기·pending consents"로 고친다.
7. `tests/eval/human/human_test.ts`를 새 route로 줄여 쓴다(survey §3 끝 줄. 순수 test: 가짜 `tryCall`과 임시 폴더만).
   1. `fakePort`: route key `session_snapshots/list`(snapshot 하나: shell turn request `apr_shell`(`always_patterns: ["rm -r *"]`)과 app_tool turn request `apr_tool`, `questions`는 option), `activations/consents`(줄 하나 `{ app: "app_a", release: "rel_a", comparison, requested_at: "2026-01-01T00:00:00.000Z" }`), `turn_requests/decide`, `activations/consent`, `ask/read`, `ask/answer`. 부른 것마다 `{ key, input, compare }`를 남긴다. `turn_request`와 동의 줄은 protocol type에 맞는 값으로 만든다(id는 `apr_`, `ses_`, `trn_`, `tcl_` 접두사).
   2. 첫 test를 바꾼다. 이름: "human role allows only what the scenario rule says and answers each request once". 표로 돈다(tick 두 번씩).
      - `{ activation: "allow", shell: "once" }`: `activations/consent` 한 번, input `{ release: "rel_a", choice: "allow" }`, compare `{ requested_at: <줄의 값> }`. `apr_shell`은 `{ kind: "once" }`, `apr_tool`은 reject. decide는 request마다 한 번.
      - `{}`: 동의 reject, `apr_shell` reject, `apr_tool` reject.
      - `{ shell: "always" }`이고 `always_patterns: []`인 shell request: reject.
   3. 질문 test 둘("buildAnswers…", "human question becomes a pending entry…")은 판정을 그대로 두고 `fakePort`의 바뀐 snapshot 칸만 맞춘다.
   4. 머리 주석(1-5)의 "permission", "grant"를 지금 말로 고친다: 규칙 없는 동의나 turn request가 허락되어 시나리오가 모르는 허락이 생기는 것.
8. `grep`으로 옛 이름이 이 task의 file에 남지 않았는지 본다(끝남).

## 끝남

- `deno task check`가 통과한다(이 task의 file은 아직 `NOT_CHECKED`라 아래로 따로 본다).
- `deno check tests/eval/types.ts tests/eval/human/mod.ts tests/eval/human/human_test.ts tests/eval/runner/idle.ts tests/eval/runner/idle_test.ts`가 통과한다. (`runner/trial.ts`, `run.ts`는 tr-eval-restore가 merge되기 전에는 `restore/active-app.ts`를 거쳐 깨져 있을 수 있다. 그 오류는 이 task의 일이 아니다.)
- `deno test --no-check tests/eval/human tests/eval/runner/idle_test.ts`가 통과한다.
- `deno fmt --check`와 `deno lint`가 바꾼 file에서 통과한다(`NOT_CHECKED`라 `deno task check`가 보지 않는다).
- 위험 test: "사람 역할은 시나리오 규칙에 없는 activation 동의와 turn request를 허락하지 않고, 같은 줄에 두 번 답하지 않는다"(`tests/eval/human/human_test.ts`). 동의는 읽은 줄의 `requested_at`을 compare로 보낸다.
- 남지 않음: `grep -rn "approvalsPending\|approvalsDecide\|permission_requests\|PendingApproval\|TurnPermissionRequest\|TurnChoice\|IntentKind\|RequestChoice\|choosePending" tests/eval/human tests/eval/runner/idle.ts tests/eval/runner/idle_test.ts tests/eval/types.ts`가 0줄이고, `grep -n "coding" tests/eval/runner/idle.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(위 `deno check`, `deno test`, fmt, lint 명령과 결과)
- 등록할 것: 없음이면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). `choosePending`은 지운다(이 task의 file만 썼다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(`HumanDecision` 꼴, 동의 열쇠 `release@requested_at`, harness subject를 규칙 없이 거절한 것 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 문서: lead가 끝에 고칠 줄. `project-docs/architecture/eval.md` 93줄(허락 → 동의와 shell turn request), `.claude/skills/eval-run/SKILL.md`의 동의 답하기에 필요한 말
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
