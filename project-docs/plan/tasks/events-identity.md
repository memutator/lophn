# events-identity

core API 인증 쪽을 S6의 coding token에 맞춘다. 영구 connection 모델(사람이 만들고 digest를 저장하는 연결)을 session마다 새로 발급하고 메모리에만 두는 coding token으로 바꾼다. 앱 하나 범위이고, 회수하면 새 호출이 거절된다. 질문 근거로 machine이 사람 결정을 대신하던 장치(`identity/question-evidence.ts`)도 지운다.

- 단위: events (wave 3)
- 선행: events-bus-gateway (둘 다 `wiring/server.ts`를 고친다. bus-gateway가 `startApiServer`의 `bus` 줄을 먼저 넣고, 이 task가 같은 file의 coding credential 줄을 바꾼다)
- 소유(이 task만 고친다):
  - `packages/core/server/identity/`
  - `packages/core/server/credentials.ts`
  - wiring file `packages/core/main/daemon/wiring/server.ts`의 coding credential 줄(`createCodingCredentials`, `withRevocationSweep`, connect·registerChild handler). core-wiring이 만든다. 없으면 보고하고 멈춘다
- 읽을 것:
  - spec: S6 5장 3·8·9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`. token은 맡기기마다 그 앱 하나 범위로 새로 만들고 session이 끝나면 회수한다.
  - inventory: `I1.6#7`, `I1.11#7`(identity 몫만), `I2.6#24`, `I3.6#3` (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 결정: `../README.md` 3장 #66·67(환경 변수 `LOPHN_CODING_TOKEN`, principal `coding_agent:<session>`), #69(CLI 명령은 token이 앱 하나라서 `app list`·`app path`를 뺀다), 2.5의 B6 줄(coding token 위험 test는 coding-agent의 것이지만 이 task의 token 판정이 그 근거다)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `/home/pyosechang/projects/lophn/project-docs/dev/testing.md`
  - 지금 코드(읽기만): `packages/core/server/identity/{registry,model,coding-connection,coding-credential,coding-credential-assembly}.ts`, `packages/core/server/identity/connection/`, `packages/protocol/server/identity.ts`
- 계약:
  - 쓰는 것: contract-coding이 `packages/protocol/coding-agent/token.ts`에 고정한 `CodingTokens` port(`issue(scope): Result<{ token }>`, `revoke(session): Result<void>`), `CODING_TOKEN_ENV`, `codingPrincipal(session)`, `codingTokenScopeSchema`와 `cli-commands.ts`의 CLI 명령 목록(token operation의 근거). `packages/protocol/server/identity.ts`의 `AuthenticatedContext`.
  - 내놓는 것: `createCodingTokens({ registry, clock, random }): CodingTokens` — 위 port 구현.
    - `issue({ session, app })` — 이 session과 앱 하나에 묶인 token을 만든다. 저장하지 않는다. port가 동기 `Result`를 돌려주므로 registry의 발급(지금 `async issue`)을 동기로 쓸 수 있게 하거나, 안 되면 보고하고 멈춘다.
    - `revoke(session)` — 그 session의 token을 거둔다. 거둔 token의 새 호출은 `unauthorized`다.
    - coding-agent의 session 열기(shell main의 PTY에 환경 변수로 넘기는 쪽)와 `core/apps/tickets`가 이것을 쓴다.

## 할 일

1. 새 coding token — `core/server/identity/coding-token.ts`(새), `I3.6#3`, `I2.6#24`, S6 5장 3
   - `CredentialRegistry.issue`에 coding agent를 더한다. `CredentialIssue.actor`에 `coding_agent:${string}`을 허용하고(`registry.ts`의 `actorKind` 검사 포함), 지금은 `external` resolver(digest 조회)로만 만들던 coding context를 registry가 직접 만든 token으로도 만들게 한다.
   - `createCodingTokens`는 `registry.issue`를 부른다: actor와 principal `codingPrincipal(session)`(`coding_agent:ses_…`. `protocol/base/actor.ts`가 `ses` 형 coding principal을 받도록 lead가 고친 뒤다. 아직이면 멈추고 보고한다), scope의 `operations`는 contract-coding의 CLI 명령 목록 가운데 인증이 `coding_token`인 것의 route, `targets`는 그 앱 하나, `conditions`는 `{ app }`. 만료 시각은 두지 않는다. session이 끝나거나 ticket이 취소되거나 call이 cancel되면 `revoke(session)`이 거둔다. 자동 재발급은 없다. 사람 자격으로 대신하지 않는다.
   - `revoke`는 `registry.endBy`나 `revoke(credentialRef)`로 그 session의 token을 막는다(session → credentialRef 짝은 `createCodingTokens` 안 Map에 메모리로만 둔다).
   - 환경 변수 이름은 contract-coding의 `CODING_TOKEN_ENV`를 쓴다. 이 task가 다시 정의하지 않는다.
2. 인증 경계를 token 조회로 바꾼다 — `registry.ts`, `credentials.ts`, `I2.6#24`
   - 새 token은 registry의 일반 길로 인증된다. `external` resolver(`ExternalCredentialResolver`, `externalContext`)는 옛 connection 전용이다. 아래 3의 조건이 맞아 옛 connection을 지울 때 같이 지운다.
3. 옛 connection 모델을 지운다 — `I1.6#7`
   - 지울 것: `core/server/identity/connection/` 전체, `coding-connection.ts`(`harnessSettings`, `codingAgentConnectionDefinitions`, `createReaderRegistration`), `coding-credential.ts`, `coding-credential-assembly.ts`, `mod.ts`의 해당 export, `registry.ts`의 `external` 칸.
   - 조건: 쓰는 곳이 없을 때만 지운다. 지금 쓰는 곳은 `core/apps/tickets/claims.ts`(`connectionAuthSyncPort`), `core/config/settings.ts`(`codingAgentConnectionDefinitions`), `core/main/daemon/{main,core}.ts`(`CONNECTION_SECRET_OWNER`, 같은 definitions), `protocol/coding-agent/connections.ts`, `core/secrets`, shell main `desktop/coding-connection.ts`다. `grep -rn "identity/connection\|coding-connection\|coding-credential\|createCodingCredentials\|connectionAuthSyncPort\|CONNECTION_SECRET_OWNER\|codingAgentConnectionDefinitions" packages`의 결과가 이 task 소유 밖에서 0줄일 때 지운다. 아니면 지우지 않고, 남은 file과 그 file의 소유 단위를 보고한다(coding-agent, platform, cleanup이 쓰기를 그만두면 cleanup이 지운다).
   - 기본 실행 옵션 setting(`I2.6#23`)은 이 task의 일이 아니다. `harnessSettings`는 옛 connection의 설정이라 위 조건대로 같이 지워진다.
4. 질문 근거 장치를 지운다 — `I1.11#7`(identity 몫), S4 11장 1
   - `core/server/identity/question-evidence.ts`(`verifyQuestionEvidence`, `questionEvidenceUse`, `QuestionOptionSource`, `QuestionEvidenceUse`, `ChosenQuestionOption`)와 `mod.ts`의 export를 지운다. 지금 `mod.ts` 밖에서 쓰는 곳이 없다(`grep -rn "verifyQuestionEvidence\|questionEvidenceUse" packages`로 다시 확인한다). `core/config/{question-evidence,evidence-use}.ts`는 platform의 것이고 `question_evidence` 표는 events-ledger의 것이다. 이 task는 건드리지 않는다.
5. 위험 test
   - `packages/core/server/identity/coding-token_test.ts` 하나, 이름은 "coding token은 그 앱 하나만 열고 회수하면 새 호출이 거절된다". 실제 `CredentialRegistry`에 수동 clock과 고정 random을 주입한다: ① 앱 A로 발급한 token으로 A의 target에 `authorize`하면 통과, 앱 B의 target이면 `forbidden`. ② contract-coding의 operation 목록 밖 operation은 `forbidden`. ③ `revoke(session)` 뒤에는 같은 token이 `unauthorized`이고 다른 session의 token은 살아 있다. token 원문이 오류 message와 log에 없는지도 본다. 서버, subprocess를 띄우지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "coding token은 그 앱 하나만 열고 회수하면 새 호출이 거절된다"
- 남지 않음: `grep -rn "question-evidence" packages/core/server`가 0줄이다. 3의 조건이 맞아 지웠다면 `grep -rn "identity/connection" packages/core`도 0줄이다. 조건이 안 맞으면 보고에 file 목록을 적는다.

## 보고

- 바꾼 file
- 등록할 것: 없음 (core 조립 목록이 `CodingTokens`를 coding-agent에게 주는 줄은 lead가 정한다)
- 안 쓰게 된 export: `protocol/coding-agent/connections.ts`의 `connection*` route와 `CodingAgentConnection*` event(contract-coding 소유), `ExternalCredentialResolver`
- 정한 것: token을 registry의 일반 발급으로 만든다(옛 external digest 조회는 쓰지 않는다). token은 메모리에만 있어 lophn이 꺼지면 모두 사라진다. 이는 S1 10장과 맞는다(coding agent는 lophn과 함께 끝난다).
- 계약 바꾸기 요청(wave 3): coding token operation 목록이 CLI 명령(S6)과 어긋나면 여기 적는다
