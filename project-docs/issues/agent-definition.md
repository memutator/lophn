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

## skill.read에 path를 주면 본문도 딸린 파일도 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `skill.read`는 `path`가 없을 때만 본문을 준다. `packages/core/lophn-agent/extensions/skill-read.ts`의 reader에서 `path === undefined`면 `ok(one.body)`이고, 그 밖에는 `one.files.get(path)`만 본다. `one.files`를 채우는 `readFixed`(같은 file)는 `name === SKILL_MANIFEST`(`SKILL.md`)를 건너뛰고 형제 `.md`만 담는다. 그러니 `path: "SKILL.md"`는 어떤 skill에서도 성공할 수 없다. 내장 skill 여덟(`packages/core/agent-places/skills/*/SKILL.md`)은 전부 `SKILL.md` 한 file뿐이라 딸린 file이 없다.

tool 정의(`packages/core/lophn-agent/tools/bundles/skill.ts`)의 설명은 "Read an enabled skill's body, or its bundled file at path"이고 prompt의 skill 목록(`packages/core/lophn-agent/prompt-assembly/skill-list.ts`)도 "Read a skill's full text with skill_read"뿐이다. 본문은 `path`를 빼야 온다는 말이 어디에도 없어서 model은 `path: "SKILL.md"`를 고른다. 실제 session에서 9번 모두 그렇게 불렀고 9번 모두 `not_found`였다(`path` 값: `SKILL.md`, `/`, `.`, `design-app.md`).

영향: agent가 skill 본문을 한 번도 못 읽는다. skill 목록에 붙는 frontmatter description만 보고 일한다. 한 session은 `DESIGN.md`의 절 이름을 description에서 외워 문서는 채웠지만 본문이 정한 규칙(앱 이름을 다시 쓰지 않는다, 화면을 설명하는 글을 두지 않는다, `@lophn/ui` guide를 먼저 읽는다)은 하나도 지키지 않았고, 그 session의 `DESIGN.md` `Reuse` 절에는 skill을 못 읽었다는 사실이 적혀 있다. 본문을 읽으려는 시도가 실패하면 agent는 재시도에 turn을 쓰고, 다음 turn에서 같은 값을 다시 보내 같은 실패를 되풀이한다.

고치려면:
- 작음(추천): `readFixed`가 `SKILL.md`도 `files`에 담고, reader가 `path`가 `SKILL.md`(과 `./SKILL.md`)면 본문을 준다. `has no file` 결과에는 그 skill의 딸린 file 이름 목록(없으면 빈 배열)을 함께 싣는다. tool 설명에 "path를 빼면 본문, path는 skill에 딸린 .md file"을 쓴다.
- 작음: `path`를 없애고 `file?: string`으로 바꿔 이름만으로 본문/file을 가른다. contract가 바뀌므로 `skill.read`를 부르는 곳과 guide를 같이 고친다.
- 추천: 앞의 것. 기존 입력이 그대로 살고, `SKILL.md`가 실제로 있는 file이라 실패할 이유가 없다.

## tool 실패 문장이 원인을 지워서 agent가 같은 실수를 되풀이한다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/tools/work.ts`의 `FAILURE_SUMMARIES`가 `forbidden`과 `not_found`를 같은 문장 "tool target is not available"로 낸다. handler가 만든 문장은 `invalid_input`일 때만 살아남는다(`executeToolCall`의 summary 계산). 그래서 `skill.read`의 "skill X has no file Y"(없는 file), "skill X is turned off"(꺼진 skill), "skill X does not exist"(없는 이름)가 model에게 모두 같은 문장으로 간다.

주석에 이유가 있다: 대상 이름·존재가 새지 않게. 그런데 실패한 대상은 model이 자기가 보낸 입력이고, `skill.read`의 이름은 prompt의 skill 목록에 이미 실려 있다. 가리려는 것과 잃는 것이 뒤바뀐 경우다.

영향: model이 원인을 가를 수 없어 추측으로 재시도한다. 실제 session에서 `skill.read`가 4가지 다른 `path` 값(`SKILL.md`, `/`, `.`, `design-app.md`)으로 불렸고, 그것이 원인이 아니라 문장이 지워져서 생긴 재시도다. 같은 실패가 turn을 넘어 반복되면 turn 하나에 model 호출 몇 번과 몇 달러가 더 든다.

고치려면:
- 작음(추천): 실패 code가 가리키는 대상이 model의 입력뿐인 tool은 handler 문장을 그대로 싣는다. `work.ts`에 tool별 허용 집합(`input_scoped_failure`)을 두거나, handler가 `detail`을 실어 보내고 `executeToolCall`이 그것만 덧붙인다. 자격·grant처럼 model이 몰라야 하는 대상은 지금처럼 공통 문장을 쓴다.
- 작음: `forbidden`과 `not_found` 문장만 가른다("tool target is not available" / "tool target does not exist"). 이름은 여전히 숨기지만 원인은 갈린다.
- 추천: 앞의 것. code 두 개를 가르는 것만으로는 "이 skill에 그 file이 없다"를 알 수 없다.

## skill 설명이 본문의 체크리스트를 대신해서 skill을 안 읽고도 통과한다

```yaml
kind: defect
modules: [packages/core/agent-places, packages/core/lophn-agent]
```

지금: prompt의 skill 목록(`packages/core/lophn-agent/prompt-assembly/skill-list.ts`)은 SKILL.md frontmatter의 `description` 한 줄만 싣는다. `packages/core/agent-places/skills/design-app/SKILL.md`의 description은 본문이 정한 `DESIGN.md` 절 이름 일곱(`Purpose, Reuse, Model, Journeys, Screens, Tools, Failure branches`)을 그대로 들어 있다. 본문이 실제로 정하는 것(절마다 무엇을 쓰나, kit guide를 먼저 읽어라, 화면 원칙)은 description에 없다.

영향: model이 description만으로 `DESIGN.md`의 뼈대를 채울 수 있어 "skill을 읽었다"와 "절 이름만 안다"가 산출물에서 구별되지 않는다. 실제 session은 skill 본문을 한 번도 못 읽은 상태에서 그 일곱 절을 모두 채웠고, 본문이 금지한 것(앱 이름을 화면 머리에 다시 쓰기, 화면을 설명하는 상시 문단, 자산 안내 문단)을 그대로 넣었다. skill 본문이 유일한 전달 경로인 규칙이 조용히 빠진다.

고치려면:
- 작음(추천): `design-app`의 description에서 절 목록을 빼고, 무엇을 하는 skill인지만 한 줄로 남긴다("Design an app or a change before you build it; write DESIGN.md as this skill says."). 절과 규칙은 본문에만 둔다. 다른 내장 skill도 description이 본문을 요약하지 않는지 같은 눈으로 본다.
- 작음: skill 목록 글에 "본문을 읽지 않았으면 그 skill의 절차를 지킨 것으로 보지 않는다" 한 줄을 더한다. 문장으로 막는 것이라 다시 생길 수 있다.
- 추천: 앞의 것. description은 "읽을지 말지"를 고르는 재료여야 하고, 절차의 요약이면 안 된다.
