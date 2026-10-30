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

## 한 place에서 skill 하나를 끄면 다른 place에서 받던 skill도 빠진다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent]
```

지금: agent 정의의 `skills`는 받을 skill 이름 목록이고, 비면 보이는 skill을 모두 받는다. 정의는 전역인데 편집 화면은 지금 place에서 보이는 skill만 안다. `packages/shell/renderer/workspace/agents/editor/definition-form.tsx`의 `toggleSkill`은 `skills`가 비었을 때 이 place에서 받는 이름(`received`)에서 하나를 뺀 목록을 저장하고, `toggleDomain`은 이 place에서 안 보이는 이름을 `skills`에서 지운다.

영향: 사람이 project A에서 agent의 skill 하나를 끄면, 그 agent가 project B의 domain에서 받던 skill이 목록에 없어 B에서도 받지 않는다. 사람은 B의 편집 화면을 열기 전에는 모른다.

고치려면:
- 정의 꼴을 `skills_off`(끈 이름)로 바꾼다. 비면 다 받고, 이름이 있으면 그것만 뺀다. place와 상관없이 뜻이 같다(중간, 정의 꼴과 core 거르기와 화면).
- 화면이 모든 place의 skill을 읽어 목록을 만든다(중간, 읽기가 place 수만큼 는다).
- 추천: 앞의 것. 정의가 전역이 된 뒤 받는 목록은 place마다 달라 "받을 이름"이 맞지 않는다.

## agent 정의 층의 OAuth MCP server는 sign-in할 길이 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/shell/renderer]
```

지금: MCP OAuth의 begin·state·`prepareToken`은 `registeredMcpServers`(`packages/core/lophn-agent/extensions/mcp-snapshot.ts`)가 낸 전역·project 층 server만 찾는다. agent 정의 층 server는 일부러 그 목록에 넣지 않는다(place로 server를 고르는데 agent 층은 place가 아니다). 그래서 agent 편집 화면의 server form은 OAuth 2.1을 고르지 못하고(`ServerForm`의 `oauth`가 꺼짐), 설정 file에 손으로 `oauth2`를 써도 그 줄은 늘 Needs sign-in이다.

영향: 사람이 OAuth MCP server를 한 agent에만 붙일 수 없다. 전역이나 project 층에 두면 다른 agent도 그 server를 받는다.

고치려면:
- 중간(추천): `mcpAuthBegin`·`mcpAuthState`·`mcpAuthCancel` 입력의 `place`에 agent 정의 층(`{kind: "agent", id}` 같은 꼴)을 더하고, `registeredMcpServers`가 agent 층도 그 자리로 낸다. token 이름은 이미 `mcp-oauth.<scope>.<server>`라 scope에 agent id를 쓴다. 그 뒤 agent 편집 화면의 `ServerForm`에 `oauth`를 켠다.
- 작음: 지금처럼 agent 층에서는 OAuth를 막아 둔다. 전역·project 층으로 충분하면 kept로 닫는다.
