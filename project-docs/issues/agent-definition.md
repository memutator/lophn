# agent-definition

agent 정의와 turn 조립(지침, tool, skill, place 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 외부 MCP tool 이름을 읽는 route가 없어 Grants의 MCP 목록이 빈다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent, packages/protocol]
```

지금: `packages/shell/renderer/workspace/agents/core-grants.ts`의 `readGrants`가 catalog를 `mcpServers: []`로 하드코딩한다. 서버별 tool 이름을 돌려주는 route가 `protocol/lophn-agent`에 없다(`mcp-settings.ts`에는 auth와 project 설정 route뿐). tool 목록은 core 안(`extensions/mcp-toolkit.ts`, `mcp-connections.ts`의 tools/list)에서만 읽힌다. 그래서 `grants-panel.tsx`의 "Tools from MCP servers"는 늘 "No MCP tools."이고 서버를 추가할 수도 없다.

영향: 사람이 MCP tool별로 권한(ask/allow)을 볼 수도 정할 수도 없다. 서버 단위 on/off(`mcp_off`)만 된다.

고치려면: `agent_grants` 쪽에 서버별 tool 목록(이름, effect, 설명)을 읽는 route를 하나 더하고 `readGrants`가 채운다. 연결이 필요하므로 못 읽은 서버는 빈 목록과 이유로 돌려준다. 비용은 route 하나와 shell 매핑이다. 추천: 이 안.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `tools/file/pdf.ts`(`unpdf`), 이미지는 `tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 place 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정할 것: 어떤 형식까지 지원할지.

## shell 출력이 stream마다 1 MiB라 model에 2 MiB까지 간다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `tools/shell/run.ts`의 `collect`가 stdout과 stderr를 각각 `OUTPUT_MAX_BYTES`(1 MiB)까지 모아 `content`에 그대로 싣는다. `bundles/shell.ts` 핸들러는 `limitText`/`fitJson` 같은 다른 tool의 24 KiB 상한(`tools/result.ts`)을 거치지 않는다. process group은 `setsid`로 띄워 시간 초과 때 `kill -KILL -- -pid`로 group째 죽이는데 `setsid`가 없으면 sh 하나만 죽는다. 시간은 기본 120초, 최대 600초.

영향: 출력 많은 명령 한 번에 context가 2 MiB 가까이 차서 turn이 `context_limit`으로 실패하거나 비용이 커진다. 다른 tool과 상한이 달라 model이 이어 읽기 안내를 받지 못한다.

고치려면: (a) 출력 상한을 24 KiB 근처로 낮추고 앞/뒤를 남긴다(`limitText` 재사용). 비용 작다. (b) 지금 값을 두고 context가 알아서 터지게 둔다. 추천: (a). process group 방식은 시간 초과 때 자식까지 죽이는 데 필요해서 남긴다.

## `wrapUntrusted`가 둘이다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `prompt-assembly/input-tags.ts`(`renderTag`로 감싼다)와 `run-loop/untrusted.ts`(`escapeBody`로 직접 감싼다)에 같은 이름·같은 모양의 함수가 있다. web tool(`tools/web/fetch.ts`, `search.ts`)은 앞의 것을, `run-loop/history.ts`는 뒤의 것을 쓴다. `run-loop/mod.ts`도 뒤의 것을 export한다. 테스트는 앞의 것(`input-tags_test.ts`)만 본다.

영향: 한쪽만 고치면 web 결과를 감싸는 모양이 둘로 갈라지고, 바깥 글이 닫는 tag를 흉내 내지 못하게 하는 방어가 한쪽에서 빠질 수 있다(prompt injection 경계).

고치려면: 하나만 남기고(`input-tags.ts`) 다른 쪽 import를 옮긴다. `untrustedSource`는 `run-loop/untrusted.ts`에 남긴다. 비용 작다. 추천: 합친다.

## App Engineer의 active context 읽기가 쓰이지 않는다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `agents/layers.ts`의 `activeContexts`가 App Engineer에도 그 앱을 source로 읽는 context를 `context.list`로 페이지마다 읽어(최대 50쪽) `resolveAgent`의 `active_contexts`로 넘기고, `resolve.ts`가 `agent.contexts`에 담는다. 그러나 `run-loop/place-data.ts`는 `agent.contexts`를 project_manager와 operator에게만 읽고, `prompt-assembly/place-info.ts`의 `visibleContexts`는 `app_engineer`에게 `false`를 준다. 읽은 결과가 어디에도 보이지 않는다.

영향: turn마다 쓰이지 않을 core 읽기가 App Engineer에게 돈다. 읽기 코드와 `agent.contexts` 필드의 의미가 혼동된다(`hash`에는 들어간다).

고치려면: (a) `layers.ts`에서 App Engineer 분기를 지운다(`resolve.ts`가 `role !== "lophn"`이면 담는 줄도 맞춘다). (b) App Engineer에게 context를 보이게 한다. 이쪽은 제품 결정이다. 추천: (a).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

## deferred tool을 아무 tool에도 켜지 않는다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `prompt-assembly/turn-prompt.ts`가 `TurnTool.deferred`를 보고(`deferredBlock`, `tools[]` 거르기) `tools/bundles/skill.ts`의 `tool.search`가 정의를 돌려주지만, `run-loop/prepare.ts`는 `deferred`를 한 번도 켜지 않는다. 모든 tool 정의가 prompt에 실린다.

영향: 쓰이지 않는 분기와 tool 하나(`tool.search`가 model에 노출된다)가 prompt와 코드에 남는다.

고치려면: (a) `deferred`, `deferredBlock`, `tool.search`를 지운다(`tool.search`는 tool 카탈로그·role 목록에서도). (b) 정의가 큰 tool(MCP 많이 붙은 경우)에 켠다. 추천: MCP tool이 많아져 prompt가 커지는 것이 아직 문제가 아니므로 (a).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

## `SeenBasis`와 turn 사이 diff notice

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `prompt-assembly/basis.ts`가 지침 층별 hash, 정본 tool 이름 목록, context `{name, version, glossary hash}`, agent 목록을 `SeenBasis`로 만들고(`basisOf`), `diffBasis`가 지난 turn과 비교한다. `turn-prompt.ts`의 `noticesOf`가 바뀐 층마다 Added/Removed 문구와 새 전문을 대화 끝에 붙인다(둘 합쳐 약 390줄). 이유: 며칠 열린 session에서 prefix를 안 깨고 지침 수정을 닿게 한다(architecture 문서의 "지침 반영: 대화 끝에 덧붙이기").

영향: 가장 단순한 구현보다 무겁다. 목록 하나가 늘 때마다 basis, diff, notice 문구, 테스트가 함께 는다.

고치려면: 바뀐 층의 전문을 통째로 notice에 싣고 Added/Removed diff는 없앤다. 비용은 basis와 `listChange`를 줄이는 정도이고 notice가 길어진다. 대화 끝에 붙이는 구조 자체는 cache를 지키려 남겨야 한다. 추천: 지금 두고, 목록 종류를 더 늘릴 때 다시 본다.

정한 것: 다이어트 계획에서 줄일지 정한다.

## file tool 상한이 많다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `file.read`는 300줄·24 KiB(`tools/result.ts`의 `TEXT_MAX_*`)와 파일 10 MiB(`read.ts`), `pdf.read`는 20쪽·쪽당 6000자와 파일 50 MiB(`pdf.ts`), 이미지 5 MiB(`image.ts`), `file.glob` 200개, `file.grep`은 100줄·줄당 300자·파일당 2 MiB(`search.ts`). 상한마다 이어 읽기 안내 문구가 따로 있다. 이유: model 문맥을 지키고 spec이 상한을 요구한다.

영향: 상한과 안내 문구가 여러 곳이라 한 곳을 바꾸면 나머지와 어긋난다.

고치려면: 바이트 상한 하나와 안내 문구 하나로 줄인다(`limitText`가 이미 모양을 잡는다). 비용은 중간이고 pdf 쪽·grep 줄 상한이 사라지는 동작 변경이 따른다. 추천: 지금은 두고 상한을 더 늘릴 때 합친다.

## Operator 정의 파일을 place 폴더를 훑어 찾는다

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/protocol]
```

지금: Operator의 `AgentRef`에 place가 없어 `agents/inspect.ts`의 `findOperator`가 `context.lookups.places()` 전부를 돌며 슬롯 파일을 읽는다. `loadAgent`, 그리고 `agents/commands.ts`의 생성·고치기·지우기가 이를 쓴다.

영향: Operator 하나를 읽을 때마다 place 수만큼 파일을 연다. place가 많아지면 느려진다. 같은 id가 두 place에 있으면 먼저 찾은 것이 쓰인다.

고치려면: ref에 place를 싣는다(계약 변경이라 쓰는 쪽도 같이 고친다). 비용은 protocol, shell, runtime 호출부까지다. 추천: place가 수십 개를 넘으면 한다. 그전에는 두어도 된다.

## context 글 예산을 세 단계로 줄인다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `prompt-assembly/place-info.ts`의 `contextLines`가 예산(`CONTEXT_TEXT_BUDGET`) 안이면 full(글 전체), 넘으면 names(이름과 한 줄), 그래도 넘으면 count를 싣는다. lophn은 글이 없어 names부터 시작한다.

영향: 단계마다 모양과 테스트가 있다. 예산을 넘는 순간 context 글이 통째로 이름만 남아 model이 갑자기 글을 못 본다.

고치려면: 예산을 넘으면 이름만 싣고 count 단계는 없앤다. 비용 작다. 추천: 이 안.

## cache marker를 role·instructions·place 셋에 단다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `prompt-assembly/turn-prompt.ts`의 `CACHED = ["role", "instructions", "place"]`가 system block 셋에 `cache`를 달고 `prompt-assembly/layers.ts`의 `anthropicSystem`이 각각 `cache_control`로 옮긴다. tools는 role marker가 함께 덮는다(Anthropic 요청 순서가 tools → system).

영향: marker가 셋이라 층 하나가 바뀌면 그 뒤 prefix만 miss다. 하나로 줄이면 지침 수정이 role 뒤 전체 miss가 된다.

고치려면: 남길지 정한다. 층마다 바뀌는 빈도가 달라(role 고정, 지침은 사람이 가끔, place는 자주) 나눈 것이다. 추천: 남기고 archived로 닫는다(kept).

정한 것: 다이어트 계획에서 줄일지 정한다.

## MCP tool 이름이 wire 규칙에 안 맞거나 64자를 넘으면 hash 8자를 붙여 줄인다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `extensions/mcp-tools.ts`의 `externalToolName`이 `mcp__<server>__<tool>`이 `[A-Za-z0-9_-]`이고 64자 이하면 그대로 쓰고, 아니면 안전하지 않은 글자를 `_`로 바꾸고 `[server, original]`의 sha256 앞 8자를 붙여 줄인다. 겹치면 `assignExternalToolNames`가 등록을 거절한다.

영향: 이름 변환 규칙이 하나 더 있다. 사람이 보는 이름(Grants, 승인 카드)과 model이 부르는 이름이 다를 수 있다.

고치려면: wire 규칙 때문에 길거나 이상한 MCP tool 이름은 어차피 바꿔야 한다. 추천: 남기고 archived로 닫는다(kept)(주석은 이미 규칙을 설명한다).

정한 것: 다이어트 계획에서 줄일지 정한다.

## 즐겨찾기 compare 기준용 표 `model_favorites_seq(one, seq)`

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `models/schema.ts`의 `model_favorites_seq` 한 줄(`one = 1`)이 즐겨찾기 목록의 `settings_seq`다. `models/commands.ts`의 즐겨찾기 변경이 compare 후 올리고, `models/store.ts`의 `loadFavorites`가 읽는다. `model_favorites`는 통째로 지우고 다시 넣는다(event 없음).

영향: 한 줄짜리 표가 하나 늘었다. 목록이 비어도 seq를 이어 가야 해서 따로 필요하다.

고치려면: 남길지 정한다. 즐겨찾기는 비었을 때도 compare 기준이 있어야 하고, 목록 표에서 max를 구하면 다 지울 때 기준이 사라진다. 추천: 남기고 archived로 닫는다(kept)(주석은 이미 있다).

정한 것: 다이어트 계획에서 줄일지 정한다.

## 끌 수 없는 내장 skill과 같은 이름의 사람 skill을 `skipped`에 남긴다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `extensions/skills.ts`의 `mergeSkillLayers`가 끌 수 없는 내장 skill이 이미 있는 이름의 후보를 건너뛰면서 `skipped`에 `{path, reason}`을 넣는다. `skill-read.ts`가 이를 읽기 결과에 싣는다.

영향: skipped 기록이 하나 더 있다. 이것이 없으면 사람이 만든 skill이 왜 안 보이는지 알 수 없다.

고치려면: 남길지 정한다. architecture 문서가 "끌 수 없는 내장 skill은 사람 skill이 같은 이름으로 덮지 못한다"를 지키는 규칙으로 두므로 이유를 알리는 것이 맞다. 추천: 남기고 archived로 닫는다(kept).

정한 것: 다이어트 계획에서 줄일지 정한다.

## compact 요약의 fence가 Unicode·동형 문자 정리까지 한다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: `safety/fence.ts`의 `defuseTransmittedText`가 compact 요약에 넣을 대화 글을 `~~~data` block으로 감싸고 제어 token과 동형 문자(homoglyph)를 정리한다(`prompt-assembly/summary.ts`). 대화에 web 결과가 섞여 있어 감싸는 것은 인터넷 방어다.

영향: Unicode·동형 문자 정리는 프로토타입에 무겁다.

고치려면: 감싸기만 남기고 정리 부분을 지운다(작음).

정한 것: 다이어트 계획에서 줄일지 정한다.

