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

## Home memory의 workspace 지도를 채우는 길이 없다

```yaml
kind: bug
modules: [packages/core/agent-workspaces]
```

지금: Home prompt(`packages/core/agent-workspaces/prompts/home.md` "Memory")는 Home의 lophn에게 workspace 지도(어느 project·앱이 무엇을 맡고 무엇을 물으면 되나)를 workspace memory에 적으라고 한다. project·앱 prompt(`prompts/project.md`, `prompts/app.md`의 "Memory")는 다른 workspace에 대해 모르는 것을 Home의 lophn에게 물으라고만 한다. 자기 workspace에 다른 workspace가 물을 만한 것이 생겼을 때(새 report, 맡은 일이 바뀜) Home에 알리라는 말은 어느 prompt에도 없다. Home workspace 정보(`workspace/workspace-info.ts`)는 project를 이름과 목적 한 줄로만 싣는다. 그래서 Home이 지도를 얻는 길은 사람이 Home에서 직접 말해 주는 것과 Home이 스스로 넘긴 일뿐이다.

영향: 사람이 path를 주지 않아도 agent가 필요한 자료를 찾아가게 하려는 memory의 목적이 이뤄지지 않는다. 예: harness-lab project의 lophn이 memory 구조 비교 report를 써도 Home의 지도에는 없다. lophn project의 agent가 Home에게 "memory 조사 자료가 있나"를 물어도 Home은 모른다고 답하고, 사람이 매번 path를 알려 준다.

고치려면:
- project·앱 prompt에 알리기를 더한다(작음). 다른 workspace가 물을 만한 것이 생기면 Home의 lophn에게 `lophn call send --reply none`으로 한 줄(무엇이 어디에 있고 누구에게 물으면 되나)을 보내고, Home prompt는 받은 알림을 지도에 pointer로 적게 한다. 잃는 것: 알릴지는 model의 판단이라 빠질 수 있다.
- Home이 지도가 비었거나 낡았을 때 각 workspace의 lophn에게 물어 채운다(중간). 잃는 것: 물을 때마다 workspace 수만큼 call이 든다.
- 추천: 첫째. memory의 "자기 것만 든다, 경계를 넘는 것은 call"과 맞고 prompt 문구만 바꾼다. 앱 agent가 읽는 `prompts/app.md`를 바꾸므로 `sdk-note` 판단이 필요하다.

## 이미 있는 provider id로 연결하면 그 provider의 key·token이 새 값으로 덮인다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/shell/renderer]
```

지금: 연결은 "secret 값을 먼저 `secrets.json`에 쓰고, 그 이름을 가리키는 ConnectProvider를 보낸다"는 순서다. ConnectProvider는 같은 id가 있으면 `conflict`(`providers/commands.ts` `connect`)를 내지만 그때는 값이 이미 덮어쓴 뒤다.
- 구독 로그인: `login.complete`(`packages/core/lophn-agent/providers/login.ts`)가 `saveProviderTokens`로 `provider.<id>`(과 `.refresh`·`.meta`)를 쓴 다음 `connectProvider`를 부른다. `conflict`면 "그 이름은 그 provider의 token이라 지우지 않는다"고 주석을 두고 지우지 않는데, 그 token은 이미 새 로그인의 것이다.
- API key: `connectWithKey`(`packages/shell/renderer/desktop/settings/providers/core-source.ts`)가 보호 입력 창으로 `secrets/put`을 먼저 올린 뒤 connect를 보내고, `conflict`면 지우지 않는다. `secrets/put`은 같은 이름을 조용히 바꾼다.
- 같은 id가 나오는 경우: 정의 key마다 창이 id를 하나 쥐고(`idFor`) 이미 연결된 정의는 그 id를 다시 쓴다. 다른 창에서 먼저 연결했거나 목록이 낡은 창에서 한 번 더 연결하면 이 길로 간다.
- 같은 뿌리의 작은 것: 끊기(`disconnect`)에서 secret 값 정리는 renderer가 끝난 뒤 best-effort로 한다(같은 파일). 그 사이 창이나 core가 죽으면 끊은 provider의 key·refresh token이 `secrets.json`에 남는다. core는 값을 지우지 않는다.

영향: 연결이 실패(`conflict`)로 끝나는데 이미 쓰던 provider의 key나 구독 token이 다른 계정의 token이나 틀린 key로 바뀐다. 그 provider를 쓰던 agent의 turn이 인증 오류로 실패하고, 사람은 원래 key를 다시 넣어야 한다. 구독은 다른 계정의 token으로 쓰이는 채 provider 행은 옛 계정을 보인다.

고치려면:
- 값을 쓰기 전에 그 id의 provider가 있는지 읽어 보고(또는 core가 login begin·secret put 단계에서 거절하고) 있으면 쓰지 않는다. 작음. 추천.
- 새 연결은 임시 이름에 쓰고 ConnectProvider가 성공한 뒤에 `provider.<id>`로 옮긴다. 중간. 끊기의 정리 누락과 같이 core가 맡을 수 있다(Disconnect command가 값을 지운다).

## `publish-package` skill이 내장으로 선언되지 않아 앱 agent가 읽지 못한다

```yaml
kind: bug
modules: [packages/protocol, packages/core/lophn-agent, packages/core/agent-workspaces]
```

지금: `packages/core/agent-workspaces/skills/publish-package/SKILL.md`는 있지만 `BUILTIN_SKILLS`(`packages/protocol/lophn-agent/skill-settings.ts`)에 항목이 없다. skill 모으기(`packages/core/lophn-agent/extensions/skills.ts`)는 내장 폴더라도 선언되지 않은 이름을 "built-in skill is not declared"로 `skipped`에 넣고 후보에서 뺀다. 그런데 앱 workspace의 prompt(`packages/core/agent-workspaces/prompts/app.md`)는 "package를 옮기거나 다른 앱의 package를 더할 때 skill `publish-package`를 읽으라"고 말한다.

영향: 앱 agent가 그 안내대로 skill을 찾으면 없어서 package 만들기·더하기를 skill 없이 짐작으로 하게 된다.

고치려면: `BUILTIN_SKILLS`에 `{ name: "publish-package", workspaces: ["app"], can_disable: false, menu: false }`를 더한다. 작음. 앱 agent가 읽는 지침이 바뀌므로 `sdk-note` skill대로 `migrate-sdk` 메모 여부를 같이 본다.
