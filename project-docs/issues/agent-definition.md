# agent-definition

agent 정의와 turn 조립(지침, tool, skill, place 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `packages/core/lophn-agent/tools/file/pdf.ts`(`unpdf`), 이미지는 `packages/core/lophn-agent/tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 place 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정한 것: 필요해지는 형식 하나씩만 더한다.

## MCP OAuth server는 사람이 만들 수도 sign-in할 수도 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/shell/renderer, packages/protocol]
```

지금:
- 설정 schema(`packages/protocol/lophn-agent/mcp-settings.ts`의 `layerAuthSchema`)는 `oauth2`(`issuer`, `client_id`, `client_credential`, `scopes`)를 받지만 server form(`packages/shell/renderer/workspace/agents/editor/server-form.tsx`)의 인증 선택은 `none`·`bearer`·`api_key`뿐이다.
- core에 `agent-mcp-auth/begin|complete|state|cancel` route가 있고 shell allowlist에도 있지만 화면은 `state`만 부른다(`packages/shell/renderer/desktop/settings/extension-settings.ts`의 `authStates`). sign-in을 여는 단추가 없어 oauth2 server는 늘 `needs-sign-in`이다.
- 끝점은 discovery 없이 `${issuer}/authorize`·`${issuer}/token`으로 만든다(`packages/core/lophn-agent/extensions/mcp-oauth.ts`의 `begin`). dynamic client registration도 없어 사람이 미리 만든 client id만 쓴다.
- `client_credential`은 schema에만 있고 읽는 곳이 없다. `mcp-auth-control.ts`의 `oauthServerOf`가 넘기지 않아 token 교환과 refresh는 client secret 없이 간다.

영향: 사람은 OAuth가 필요한 MCP server(대부분의 hosted MCP)를 쓸 수 없다. 설정 file을 손으로 써도 sign-in할 길이 없고, 끝점이 `/authorize`·`/token`이 아니거나 client secret이 필요한 발급자는 sign-in해도 교환이 실패한다.

고치려면:
- 작음~중간(추천): 앱 OAuth가 연 인자(`endpoints`, `clientSecret`)를 MCP도 쓴다. `oauthServerOf`가 `client_credential`을 읽어 `clientSecret`으로 넘기고, server form에 `oauth2`와 [Sign in](앱 Access 탭과 같은 begin → OS browser → 상태 폴링 꼴)을 둔다. discovery(`/.well-known/oauth-authorization-server`)는 `endpoints`를 채우는 한 단계로 더한다.
- 중간: dynamic client registration까지 한다. 등록 결과(client id, secret)를 둘 secret 이름 공간과 등록 끝점 호출(발급자 호출 대기열)이 더 필요하다.

## provider 호출이 실패하면 왜 실패했는지 근거가 어디에도 남지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/protocol, packages/shell/renderer]
```

지금:
- 실패한 model 호출에 남는 것은 `model_calls.outcome`의 `kind`, `code`, `retry_at`, `finish_reason`, `http_status`, `provider_code`뿐이다(`packages/protocol/lophn-agent/model-call-values.ts`의 `outcomeFields`).
- `code: unknown`이 되는 길이 셋이고 기록으로는 구별되지 않는다. 성공 status인데 본문을 못 읽음(`providers/invoke.ts`에서 `framesFromBatch`가 null), `response.failed`에 code가 없음(`adapters/responses.ts`의 `applyFrame`이 `"?"`를 넣고 `failures.ts`의 `SAFE_PROVIDER_CODE`가 버린다), 분류 규칙에 안 걸린 status와 code(`failures.ts`의 `coreVerdict` 마지막 단계).
- 응답 header는 분류에만 쓰고 버린다. content-type, provider request id(OpenAI `x-oai-request-id`, Anthropic `request-id`), `cf-ray`가 남지 않는다.
- 오류 본문과 읽지 못한 성공 본문은 한 글자도 남지 않는다(`failures.ts`, `usage/commands.ts`, `observability/model.ts`의 머리 주석). 요청 body와 model 출력은 이미 `model_call` blob(`modelCallBodyFields`)으로 저장되는데 이 규칙만 따로 있다. 규칙은 코드 주석에만 있고 architecture 문서나 change-log 결정에는 없다.
- 세 adapter(`responses.ts`, `messages.ts`, `chat-completions.ts`)가 모르는 SSE event에 `sawUnknownEvent`를 켜지만 읽는 곳이 없다. Responses의 최상위 `error` event도 모르는 event로 버려지고, 그 뒤 `response.completed`가 없으면 stream은 `partial`로 끝난다.
- provider 실패는 diagnostic log(`logs/platform-*.jsonl`)에도 쓰지 않는다. 화면은 turn 실패 이유 enum을 `_`만 띄어 보인다(`packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`의 `tailOf`, 예: "model error").
- 예: ChatGPT 구독 token으로 부른 `/v1/responses`가 SSE를 content-type 없이 보내 모든 turn이 "model error"였다. 기록은 `200 / unknown / null`뿐이라, 사람이 자기 token으로 같은 요청을 다시 보내 header를 찍고서야 원인을 찾았다(`adapters/transport.ts`의 `isEventStream`에서 고침).

영향: provider가 응답 모양을 바꾸거나 새 provider·계정 종류(구독 OAuth, custom provider)가 다르게 답하면, 사람은 "model error"만 보고 다시 보내는 것 말고 할 일이 없다. 개발자도 기록으로 원인을 못 찾아 실제 호출로 재현해야 하고, 재현에는 사람의 token과 실제 provider 호출(사람에게 묻는 일)이 든다. provider에 문의할 request id도 없다.

고치려면:
- A. 작음(추천): secret이 아닌 증거를 outcome에 더한다. 판정 경로(`unparseable_success_body`, `stream_failed_without_code`, `unclassified` 같은 값), content-type, provider request id header, 처음 본 모르는 event type 몇 개. `ModelOutcome` schema, `failures.ts`의 verdict, `invoke.ts`, 세 adapter의 collector를 고친다. 잃는 것 없음.
- B. 작음(추천, A와 같이): 화면의 실패 줄에 판정 경로와 request id를 보인다. `tailOf`와 `ProviderError`. DB를 열지 않고 원인 갈래를 안다.
- C. 중간: `unknown`일 때만 응답 본문 앞부분(2 KiB 안팎)을 redaction을 거쳐 `model_call` blob으로 남긴다. A로 갈래는 알아도 내용(예: 본문이 HTML인지 SSE인지)은 모르는 경우를 덮는다. "오류 본문은 남기지 않는다"는 지금 규칙을 바꾼다.

정할 것:
- C를 할지. 오류 본문에는 provider가 되돌려 보낸 credential 조각(예: "Incorrect API key provided: sk-…")이 섞일 수 있어 규칙이 생긴 것으로 보인다. redaction을 거치면 그 위험은 출력 blob과 같다. 추천: A·B를 먼저 하고, C는 같이 해도 되지만 secret 경계의 규칙을 바꾸는 것이라 사람이 정한다.
