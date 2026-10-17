# agent-definition

agent 정의와 turn 조립(지침, tool, skill, place 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `tools/file/pdf.ts`(`unpdf`), 이미지는 `tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 place 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정한 것: 필요해지는 형식 하나씩만 더한다.

## shell 출력이 stream마다 1 MiB라 model에 2 MiB까지 간다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `tools/shell/run.ts`의 `collect`가 stdout과 stderr를 각각 `OUTPUT_MAX_BYTES`(1 MiB)까지 모아 `content`에 그대로 싣는다. `bundles/shell.ts` 핸들러는 `limitText`/`fitJson` 같은 다른 tool의 24 KiB 상한(`tools/result.ts`)을 거치지 않는다. 시간은 기본 120초, 최대 600초.

영향: 출력 많은 명령 한 번에 context가 2 MiB 가까이 차서 turn이 `context_limit`으로 실패하거나 비용이 커진다. 다른 tool과 상한이 달라 model이 이어 읽기 안내를 받지 못한다.

고치려면: 출력 상한을 24 KiB 근처로 낮추고 앞/뒤를 남긴다(`limitText` 재사용, `shell.run` description의 "1 MiB per stream"도 맞춘다). 비용 작다. 추천: 이 안. process group(`setsid`) 방식은 시간 초과 때 자식까지 죽이는 데 필요해서 남긴다.

## `wrapUntrusted`가 둘이다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `prompt-assembly/input-tags.ts`(`renderTag`로 감싼다)와 `run-loop/untrusted.ts`(`escapeBody`로 직접 감싼다)에 같은 이름·같은 모양의 함수가 있다. web tool(`tools/web/fetch.ts`, `search.ts`)은 앞의 것을, `run-loop/history.ts`는 뒤의 것을 쓴다. `run-loop/mod.ts`도 뒤의 것을 export한다. 테스트는 앞의 것(`input-tags_test.ts`)만 본다.

영향: 한쪽만 고치면 web 결과를 감싸는 모양이 둘로 갈라지고, 바깥 글이 닫는 tag를 흉내 내지 못하게 하는 방어가 한쪽에서 빠질 수 있다(prompt injection 경계).

고치려면: 하나만 남기고(`input-tags.ts`) 다른 쪽 import를 옮긴다. `untrustedSource`는 `run-loop/untrusted.ts`에 남긴다. 비용 작다. 추천: 합친다.

정한 것: 줄인다. `prompt-assembly/input-tags.ts` 것만 남기고 `run-loop/history.ts`·`run-loop/mod.ts`의 import를 옮긴다. `untrustedSource`는 `run-loop/untrusted.ts`에 남긴다.

## 이미지 tool 결과의 base64가 ledger와 blob에 그대로 쌓인다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/storage]
```

지금: `image.read`의 결과 `content.image.data_base64`가 세 곳에 저장된다. (1) `tool_calls.result` 칸(`run-loop/core-ports.ts`의 `finishToolCall`, `tools/commands.ts`), (2) `tool_call_output` blob(`core-ports.ts`), (3) `model_call_input` blob(`core-ports.ts`). 요청 body 전체라 이미지가 history에 남아 있는 동안 model call마다 다시 저장된다. 이미지 하나의 상한은 `tools/file/image.ts`의 `MAX_IMAGE_BYTES`(5 MiB, base64로 약 6.7 MiB)이고, annotation screenshot은 `ANNOTATION_SCREENSHOT_MAX_BYTES`(2 MiB)다. 기록 쪽에는 이미지 상한이 없고 blob purpose 상한 16 MiB(`storage/blobs/child-prepare.ts`)만 있다. `toolResultSchema.content`는 `z.json()`이라 크기 제한이 없다. 이미지 결과가 `tool_result_image`로 model에 가게 되면서 실제로 쓰이는 길이 됐다.

영향: 이미지를 연 session마다 ledger가 수 MiB씩 커진다. 5 MiB 이미지 셋(base64로 약 6.7 MiB씩)이 history에 있으면 `model_call_input` blob이 16 MiB를 넘어 저장에 실패하고, `core-ports.ts`가 그 model call을 보내지 않는다. 그 session은 이미지가 history에서 빠질 때까지 진행하지 못한다.

고치려면:
- `tool_calls.result`와 `tool_call_output`에는 `content.image` 대신 media type, 크기, hash만 남기고, history에는 이미지를 blob ref로 둔다(중간).
- history에서 오래된 이미지 조각을 빼고 "[image omitted]"로 바꾼다(작음. compact와 같은 자리).
- 추천: 둘째를 먼저. 실제로 막히면 첫째.

## model catalog가 models.dev에서 갱신되지 않고 자동 갱신 설정은 아무것도 바꾸지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main]
```

지금: `models/work.ts`의 `createCatalogRefresher`가 `runRefresh`에서 `fetch`가 없으면 network 없이 정상본을 그대로 돌려준다(`if (!input.fetch)`). agent runtime(`main/agent-runtime/main.ts`)은 `import.meta.main`에서 `productDriver()`로 시작하며 `fetch`를 넘기지 않아, 제품에서는 갱신이 한 번도 일어나지 않는다. `refreshNow()`를 부르는 route도 없다. 설정 `lophn-agent.model.catalog_auto_update`(`lophn-agent/register.ts`)는 선언만 있고 읽는 곳이 없다. 실제 on/off는 `<dataRoot>/derived/lophn-agent/catalog-state.json`의 `auto_update`이고 file이 없으면 늘 true다.

영향: 사람이 고를 수 있는 model이 동봉 `models/snapshot.json`의 4개(openai `gpt-5`, anthropic `claude-sonnet-4-5`, openrouter `anthropic/claude-sonnet-4-5`, ollama `qwen3:8b`)에 묶인다. 새 model이 나와도 lophn을 새 판으로 올리기 전에는 쓸 수 없다. 설정 화면의 자동 갱신 켜기·끄기는 아무 일도 하지 않는다.

고치려면:
- 살린다(작음): agent runtime이 제품에서도 `fetch`를 넘기고, `catalog_auto_update` 설정 값을 `catalog-state.json`의 `auto_update`로 옮긴다. 기동 때마다 models.dev에 공개 GET이 나간다(24시간에 한 번).
- 지운다(작음): refresher, models.dev adapter, `catalog-state.json`, 설정을 지우고 catalog는 동봉 snapshot과 사람이 더한 model만 쓴다. 새 model은 lophn 판 올리기로만 들어온다.

fetch를 넘겨도 갱신은 실패한다: `adapters/models-dev.ts`의 `parseCatalogBody`가 응답을 lophn 항목 배열로 읽는데 실제 `api.json`은 `{<provider>: {models: {…}}}` object다(2026-10-17 판: provider 232개). 동봉 `snapshot.json`도 models.dev에서 뽑은 것이 아니라 손으로 쓴 4개다.

정한 것: OpenCode 꼴로 한다(사람). models.dev `api.json` → lophn 항목 변환 함수 하나를 두고, build 때 script가 lophn 내장 provider 정의 몫만 뽑아 `snapshot.json`을 만들고, 실행 때 갱신이 같은 함수로 그 위에 덮는다. catalog 밖 model은 지금처럼 거절한다(agent). 계획 `agent-io`의 `model-catalog-source`, `model-catalog`.

## agent 정의의 MCP server가 turn에 연결되지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: Operator 정의는 자기 MCP server(`mcp_servers`)를 가질 수 있다(`packages/protocol/lophn-agent/operators.ts`의 `operatorDefinitionSchema`, 정의 file에 저장, renderer `packages/shell/renderer/workspace/agents/source.ts`가 "agent 층"으로 보인다). `packages/core/lophn-agent/extensions/mcp-toolkit.ts`의 `serversOf(place, agent)`는 전역 → project → agent 층을 겹치지만 turn 준비(`packages/core/lophn-agent/run-loop/prepare.ts`의 `loadMcp`)는 `{ place, skip }`만 넘기고 `agent`를 넘기지 않는다. resolved agent(`packages/core/lophn-agent/agents/resolve.ts`)에도 정의의 `mcp_servers`가 없다. agent runtime의 Deno 권한 snapshot(`packages/core/lophn-agent/extensions/mcp-snapshot.ts`)도 이 층을 모른다. 그래서 정의에 넣은 서버는 연결되지 않고 tool도 안 생긴다. Grants의 MCP 목록(`agent-mcp-tools/list`)에도 없다.

영향: 사람이 Operator에 MCP server를 붙여도 그 agent가 그 tool을 쓰지 못한다. 화면에는 붙은 것처럼 보인다.

고치려면: resolved agent에 정의의 `mcp_servers`를 싣고 `loadMcp`가 `agent: { servers, off }`로 넘긴다. runtime의 Deno 권한(`--allow-net`·`--allow-run`)에 정의 층 서버를 더하고, 정의가 바뀌면 hosts·MCP처럼 child를 다시 띄운다(중간). Grants 목록은 같은 층을 받으면 따라온다. 추천: 이 안.
