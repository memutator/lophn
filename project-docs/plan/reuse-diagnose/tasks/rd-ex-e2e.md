# rd-ex-e2e

App Engineer가 쓴 app-api 예시로 ticket을 검증하는 길이 process를 건너 끝까지 도는지, 기존 앱 E2E에 행 하나로 확인한다.

- 단위: rd-ex (wave 4)
- 선행: rd-ex-trigger, rd-body-tool. `rd-body-tool`이 `tests/support/app/`에 patch를 더하므로 그 뒤에 한다(lead가 바꿈: `rd-cap-net-live`는 사람 답을 기다려 이 task가 먼저 간다).
- 소유(이 task만 고친다):
  - `tests/e2e/app-release_test.ts`
  - `tests/support/app/**`
- 읽을 것:
  - 계획 README의 "정한 것"(ticket 검증, 예시 비교 규칙)
  - 앞 task brief: `rd-ex-shape`, `rd-ex-driver`, `rd-ex-request`, `rd-ex-trigger`(이 길을 만든 순서)
  - architecture: `project-docs/architecture/testing.md`("앱 길", "case 고르는 규칙"), `project-docs/architecture/coding-agent.md`
  - 코드: `tests/support/app/activate.ts`(`deliverRelease`, `verifyTicket`, `scriptAe`), `tests/e2e/app-release_test.ts`
- 계약:
  - 쓰는 것: ticket check `{ kind: "examples", steps }`(`rd-ex-shape`), 예시 실행과 기록(`rd-ex-request`·`rd-ex-trigger`), `ticket.verify` 관문
  - 내놓는 것: 없음

## 할 일

1. `tests/e2e/app-release_test.ts`의 table에 두 행을 더한다. template 앱 하나로 둘 다 본다.
   - 맞는 행: App Engineer(fake 대답)가 template의 app-api로 맞는 예시를 건 ticket을 만든다. 완료 보고 뒤 예시가 돌아 pass가 되고, `ticket.verify`가 `verified`가 된다.
   - 틀린 행: 일부러 틀린 `expect`를 건다. 예시가 fail이 되고, `ticket.verify`의 `verified`가 `conflict`로 막힌다.
2. 새 helper가 필요하면 `tests/support/app/`에 두되, flow의 단계는 test file에 그대로 쓴다(`testing.md` "support에는 띄우기와 연결만").

## 끝남

- `deno task check`가 통과한다.
- `deno task e2e:deps` 뒤 `deno test --allow-all --no-check tests/e2e/app-release_test.ts`를 10번 연속 돌려 모두 통과한다.
- 위험 test: 위 두 행. "App Engineer가 쓴 예시가 맞지 않으면 release가 확인됨이 되지 못한다."
- 단정은 서로 다른 곳에서 한다: ledger의 check 결과, `tickets/show`의 상태, fake가 받은 요청.

## 보고

- 바꾼 file, 통과한 check, 10번 결과
- 정한 것
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
