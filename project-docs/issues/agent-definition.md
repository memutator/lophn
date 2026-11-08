# agent-definition

agent 정의와 turn 조립(지침, tool, skill, workspace 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `packages/core/lophn-agent/tools/file/pdf.ts`(`unpdf`), 이미지는 `packages/core/lophn-agent/tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 workspace 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정한 것: 필요해지는 형식 하나씩만 더한다.

## provider 실패의 응답 본문을 남기지 않아 내용 갈래를 모른다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/protocol]
```

지금:
- 실패한 model 호출의 `model_calls.outcome`에는 secret이 아닌 증거 `evidence`(`verdict_path`, content-type, provider request id, 처음 본 모르는 SSE event type 셋까지)가 남고, 화면의 실패 줄이 판정 경로와 request id를 보인다(`packages/protocol/lophn-agent/model-call-values.ts`의 `outcomeFields`, `packages/core/lophn-agent/providers/failures.ts`의 `responseFacts`, `packages/core/main/daemon/wiring/acp-build.ts`의 `noticeOf`).
- 오류 본문과 읽지 못한 성공 본문은 한 글자도 남지 않는다(`failures.ts`, `usage/commands.ts`, `observability/model.ts`의 머리 주석). 요청 body와 model 출력은 이미 `model_call` blob(`modelCallBodyFields`)으로 저장되는데 이 규칙만 따로 있다. 규칙은 코드 주석에만 있고 architecture 문서나 change-log 결정에는 없다.
- provider 실패는 diagnostic log(`logs/platform-*.jsonl`)에 쓰지 않고, `cf-ray` header는 남기지 않는다. cloud-code adapter는 모르는 event를 세지 않는다.

영향: 판정 경로로 갈래(본문을 못 읽음, code 없는 stream 실패, 분류 밖)는 알지만, 본문이 HTML 오류 page인지, 다른 꼴의 SSE인지 같은 내용은 모른다. 그 경우는 여전히 사람의 token으로 실제 호출을 다시 해야 원인을 찾는다.

고치려면:
- C. 중간: `unknown`일 때만 응답 본문 앞부분(2 KiB 안팎)을 redaction을 거쳐 `model_call` blob으로 남긴다. "오류 본문은 남기지 않는다"는 지금 규칙을 바꾼다.

정할 것:
- C를 할지. 오류 본문에는 provider가 되돌려 보낸 credential 조각(예: "Incorrect API key provided: sk-…")이 섞일 수 있어 규칙이 생긴 것으로 보인다. redaction을 거치면 그 위험은 출력 blob과 같다. secret 경계의 규칙을 바꾸는 것이라 사람이 정한다.

## 전역 lophn의 MCP OAuth refresh token이 lophn마다 복사되어 서로 무효로 만들 수 있다

```yaml
kind: bug
modules: [packages/core/main, packages/core/lophn-agent]
```

지금: 전역 lophn을 workspace마다로 나누는 data step(`packages/core/main/daemon/wiring/lophn-split.ts`)이 `secrets.json`의 `mcp-oauth.lophn.<서버>.<access|refresh|meta>`를 모든 lophn id(`lophn_home`, `lophn_<prj|app id>`)의 이름으로 복사하고 옛 이름을 지운다. 그래서 같은 refresh token을 lophn 여럿이 따로 갖는다.

영향: refresh token을 쓸 때마다 바꾸는(rotation) 발급자라면, lophn 하나가 먼저 refresh하는 순간 다른 lophn의 사본이 무효가 된다. 사람은 그 server를 쓰는 다른 workspace마다 OAuth를 다시 해야 한다. MCP를 전역 lophn 정의에 OAuth로 붙여 두었던 사람만 겪는다.

고치려면:
- 그대로 둔다(작음). refresh가 거절되면 지금도 `refresh_rejected`로 다시 인증을 묻는다. 잃는 것: workspace마다 한 번씩 다시 인증.
- token을 복사하지 않고 Home lophn에만 옮긴다(작음). 잃는 것: project·앱 lophn은 처음부터 다시 인증. "동작을 그대로 잇는다"는 계획 결정과 어긋난다.
- 추천: 그대로 둔다. 다시 인증 길이 이미 있고, 전역 lophn에 OAuth MCP를 붙인 사람은 적다.
