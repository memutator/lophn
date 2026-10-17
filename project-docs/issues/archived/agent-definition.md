# agent-definition (닫음)

## `web.fetch` redirect를 hop마다 검사하며 직접 따라간다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `tools/web/fetch.ts`가 `redirect: "manual"`로 최대 5번(`MAX_REDIRECTS`) 따라가며 hop마다 `tools/web/target.ts`의 `checkFetchTarget`을 부른다. 이 검사는 scheme과 host literal(localhost, 사설 IPv4, IPv6 loopback·ULA·link-local, `::ffff:` 매핑)만 본다. 파일은 68줄이다(예전 글처럼 표가 길지는 않다). host 이름이 사설 주소로 풀리는 경우(DNS)는 보지 않는다.

영향: 이 검사가 사람 PC의 내부 주소로 agent가 요청을 보내지 못하게 하는 경계다. 지우면 redirect로 내부 주소를 칠 수 있다.

고치려면: 권한 경계라 줄일 이유가 약하다. 추천: 남기고 archived로 닫는다(kept). DNS 재바인딩은 별도 이슈로 다룰지 사람이 정한다.

닫음: 남긴다. 인터넷 내용이 사람 PC 내부 주소를 치지 못하게 막는다. DNS 해석 검사는 더하지 않는다.

## 경로 판정이 symlink·끊어진 symlink·새 파일의 상위 realpath까지 본다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: scope_test.ts
```

지금: `tools/file/scope.ts`의 `resolveInPlace`가 후보 경로를 정규화한 뒤 있는 가장 가까운 상위 폴더까지 올라가 `realpath`를 구하고, 끊어진 symlink(`lstat`이 symlink)는 거절하고, 허용 폴더의 realpath 안인지 본다. 92줄이다.

영향: 판정이 복잡하지만 place 밖 쓰기를 막는 유일한 경계(shell은 묻지도 않는다)다. 단순화하면 symlink로 폴더를 탈출할 수 있다.

고치려면: 권한 경계라 남기는 쪽을 추천한다. archived로 닫는다(kept)(`scope_test.ts`가 있다).

닫음: 남긴다. agent가 place 폴더 밖에 쓰는 실수를 막는 유일한 경계다.

## App Engineer의 active context 읽기가 쓰이지 않는다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: `agents/layers.ts`의 `activeContexts`가 App Engineer에도 그 앱을 source로 읽는 context를 `context.list`로 페이지마다 읽어(최대 50쪽) `resolveAgent`의 `active_contexts`로 넘기고, `resolve.ts`가 `agent.contexts`에 담는다. 그러나 `run-loop/place-data.ts`는 `agent.contexts`를 project_manager와 operator에게만 읽고, `prompt-assembly/place-info.ts`의 `visibleContexts`는 `app_engineer`에게 `false`를 준다. 읽은 결과가 어디에도 보이지 않는다.

영향: turn마다 쓰이지 않을 core 읽기가 App Engineer에게 돈다. 읽기 코드와 `agent.contexts` 필드의 의미가 혼동된다(`hash`에는 들어간다).

고치려면: (a) `layers.ts`에서 App Engineer 분기를 지운다(`resolve.ts`가 `role !== "lophn"`이면 담는 줄도 맞춘다). (b) App Engineer에게 context를 보이게 한다. 이쪽은 제품 결정이다. 추천: (a).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

닫음: `activeContexts`에서 App Engineer 분기(`context_app_data` join 포함)와 `role` 인자를 지웠다. project place만 그 project의 active context를 읽고, 나머지 role은 빈 목록이다.

## deferred tool을 아무 tool에도 켜지 않는다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: `prompt-assembly/turn-prompt.ts`가 `TurnTool.deferred`를 보고(`deferredBlock`, `tools[]` 거르기) `tools/bundles/skill.ts`의 `tool.search`가 정의를 돌려주지만, `run-loop/prepare.ts`는 `deferred`를 한 번도 켜지 않는다. 모든 tool 정의가 prompt에 실린다.

영향: 쓰이지 않는 분기와 tool 하나(`tool.search`가 model에 노출된다)가 prompt와 코드에 남는다.

고치려면: (a) `deferred`, `deferredBlock`, `tool.search`를 지운다(`tool.search`는 tool 카탈로그·role 목록에서도). (b) 정의가 큰 tool(MCP 많이 붙은 경우)에 켠다. 추천: MCP tool이 많아져 prompt가 커지는 것이 아직 문제가 아니므로 (a).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

닫음: `tool.search` tool과 입력 schema, `TurnTool.deferred`, `deferredBlock`, system 층 `tools`를 지웠다.

## `SeenBasis`와 turn 사이 diff notice

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `prompt-assembly/basis.ts`가 지침 층별 hash, 정본 tool 이름 목록, context `{name, version, glossary hash}`, agent 목록을 `SeenBasis`로 만들고(`basisOf`), `diffBasis`가 지난 turn과 비교한다. `turn-prompt.ts`의 `noticesOf`가 바뀐 층마다 Added/Removed 문구와 새 전문을 대화 끝에 붙인다(둘 합쳐 약 390줄). 이유: 며칠 열린 session에서 prefix를 안 깨고 지침 수정을 닿게 한다(architecture 문서의 "지침 반영: 대화 끝에 덧붙이기").

영향: 가장 단순한 구현보다 무겁다. 목록 하나가 늘 때마다 basis, diff, notice 문구, 테스트가 함께 는다.

고치려면: 바뀐 층의 전문을 통째로 notice에 싣고 Added/Removed diff는 없앤다. 비용은 basis와 `listChange`를 줄이는 정도이고 notice가 길어진다. 대화 끝에 붙이는 구조 자체는 cache를 지키려 남겨야 한다. 추천: 지금 두고, 목록 종류를 더 늘릴 때 다시 본다.

닫음: basis와 diff가 prefix를 안 깨고 지침 수정을 닿게 하는 장치이고 바꿔 줄이면 notice가 길어진다. 목록 종류를 더 늘릴 때 다시 본다.

## file tool 상한이 많다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `file.read`는 300줄·24 KiB(`tools/result.ts`의 `TEXT_MAX_*`)와 파일 10 MiB(`read.ts`), `pdf.read`는 20쪽·쪽당 6000자와 파일 50 MiB(`pdf.ts`), 이미지 5 MiB(`image.ts`), `file.glob` 200개, `file.grep`은 100줄·줄당 300자·파일당 2 MiB(`search.ts`). 상한마다 이어 읽기 안내 문구가 따로 있다. 이유: model 문맥을 지키고 spec이 상한을 요구한다.

영향: 상한과 안내 문구가 여러 곳이라 한 곳을 바꾸면 나머지와 어긋난다.

고치려면: 바이트 상한 하나와 안내 문구 하나로 줄인다(`limitText`가 이미 모양을 잡는다). 비용은 중간이고 pdf 쪽·grep 줄 상한이 사라지는 동작 변경이 따른다. 추천: 지금은 두고 상한을 더 늘릴 때 합친다.

닫음: 상한마다 이어 읽기 안내가 달라 합치면 pdf 쪽·grep 줄 상한이 사라지는 동작 변경이 따른다. 상한을 더 늘릴 때 합친다.

## Operator 정의 파일을 place 폴더를 훑어 찾는다

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/protocol]
closed: kept
guard: 없음
```

지금: Operator의 `AgentRef`에 place가 없어 `agents/inspect.ts`의 `findOperator`가 `context.lookups.places()` 전부를 돌며 슬롯 파일을 읽는다. `loadAgent`, 그리고 `agents/commands.ts`의 생성·고치기·지우기가 이를 쓴다.

영향: Operator 하나를 읽을 때마다 place 수만큼 파일을 연다. place가 많아지면 느려진다. 같은 id가 두 place에 있으면 먼저 찾은 것이 쓰인다.

고치려면: ref에 place를 싣는다(계약 변경이라 쓰는 쪽도 같이 고친다). 비용은 protocol, shell, runtime 호출부까지다. 추천: place가 수십 개를 넘으면 한다. 그전에는 두어도 된다.

닫음: Operator를 읽을 때 place 수만큼 파일을 열 뿐이고 place가 수십 개를 넘기 전에는 느려지지 않는다. 같은 id는 만들 때 `findOperator`가 막아 두 place에 생기지 않는다. ref에 place를 싣는 계약 변경은 protocol, shell, runtime 호출부까지 걸려 비용이 크다.

## context 글 예산을 세 단계로 줄인다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `prompt-assembly/place-info.ts`의 `contextLines`가 예산(`CONTEXT_TEXT_BUDGET`) 안이면 full(글 전체), 넘으면 names(이름과 한 줄), 그래도 넘으면 count를 싣는다. lophn은 글이 없어 names부터 시작한다.

영향: 단계마다 모양과 테스트가 있다. 예산을 넘는 순간 context 글이 통째로 이름만 남아 model이 갑자기 글을 못 본다.

고치려면: 예산을 넘으면 이름만 싣고 count 단계는 없앤다. 비용 작다. 추천: 이 안.

닫음: count 단계는 몇 줄이고, 이름 목록조차 예산을 넘는 context 수에서 prompt가 부푸는 것을 막는다.

## cache marker를 role·instructions·place 셋에 단다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `prompt-assembly/turn-prompt.ts`의 `CACHED = ["role", "instructions", "place"]`가 system block 셋에 `cache`를 달고 `prompt-assembly/layers.ts`의 `anthropicSystem`이 각각 `cache_control`로 옮긴다. tools는 role marker가 함께 덮는다(Anthropic 요청 순서가 tools → system).

영향: marker가 셋이라 층 하나가 바뀌면 그 뒤 prefix만 miss다. 하나로 줄이면 지침 수정이 role 뒤 전체 miss가 된다.

고치려면: 남길지 정한다. 층마다 바뀌는 빈도가 달라(role 고정, 지침은 사람이 가끔, place는 자주) 나눈 것이다. 추천: 남긴다.

닫음: 층마다 바뀌는 빈도가 달라(role 고정, 지침은 가끔, place는 자주) 나눈 것이고, 하나로 줄이면 지침 수정이 role 뒤 전체 miss가 된다.

## MCP tool 이름이 wire 규칙에 안 맞거나 64자를 넘으면 hash 8자를 붙여 줄인다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `extensions/mcp-tools.ts`의 `externalToolName`이 `mcp__<server>__<tool>`이 `[A-Za-z0-9_-]`이고 64자 이하면 그대로 쓰고, 아니면 안전하지 않은 글자를 `_`로 바꾸고 `[server, original]`의 sha256 앞 8자를 붙여 줄인다. 겹치면 `assignExternalToolNames`가 등록을 거절한다.

영향: 이름 변환 규칙이 하나 더 있다. 사람이 보는 이름(Grants, 승인 카드)과 model이 부르는 이름이 다를 수 있다.

고치려면: wire 규칙 때문에 길거나 이상한 MCP tool 이름은 어차피 바꿔야 한다. 추천: 남긴다.

닫음: wire 규칙 때문에 길거나 이상한 MCP tool 이름은 어차피 바꿔야 하고, `externalToolName` 주석이 규칙을 설명한다.

## 즐겨찾기 compare 기준용 표 `model_favorites_seq(one, seq)`

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `models/schema.ts`의 `model_favorites_seq` 한 줄(`one = 1`)이 즐겨찾기 목록의 `settings_seq`다. `models/commands.ts`의 즐겨찾기 변경이 compare 후 올리고, `models/store.ts`의 `loadFavorites`가 읽는다. `model_favorites`는 통째로 지우고 다시 넣는다(event 없음).

영향: 한 줄짜리 표가 하나 늘었다. 목록이 비어도 seq를 이어 가야 해서 따로 필요하다.

고치려면: 남길지 정한다. 즐겨찾기는 비었을 때도 compare 기준이 있어야 하고, 목록 표에서 max를 구하면 다 지울 때 기준이 사라진다. 추천: 남긴다.

닫음: 즐겨찾기는 비었을 때도 compare 기준이 있어야 하고 목록 표에서 max를 구하면 다 지울 때 기준이 사라진다. 주석이 이유를 적었다.

## 끌 수 없는 내장 skill과 같은 이름의 사람 skill을 `skipped`에 남긴다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `extensions/skills.ts`의 `mergeSkillLayers`가 끌 수 없는 내장 skill이 이미 있는 이름의 후보를 건너뛰면서 `skipped`에 `{path, reason}`을 넣는다. `skill-read.ts`가 이를 읽기 결과에 싣는다.

영향: skipped 기록이 하나 더 있다. 이것이 없으면 사람이 만든 skill이 왜 안 보이는지 알 수 없다.

고치려면: 남길지 정한다. architecture 문서가 "끌 수 없는 내장 skill은 사람 skill이 같은 이름으로 덮지 못한다"를 지키는 규칙으로 두므로 이유를 알리는 것이 맞다. 추천: 남긴다.

닫음: architecture 문서가 끌 수 없는 내장 skill을 사람 skill이 같은 이름으로 덮지 못하게 지키는 규칙이라, 왜 안 보이는지 알리는 `skipped`가 필요하다.

## compact 요약의 fence가 Unicode·동형 문자 정리까지 한다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: kept
guard: 없음
```

지금: `safety/fence.ts`의 `defuseTransmittedText`가 compact 요약에 넣을 대화 글을 `~~~data` block으로 감싸고 제어 token과 동형 문자(homoglyph)를 정리한다(`prompt-assembly/summary.ts`). 대화에 web 결과가 섞여 있어 감싸는 것은 인터넷 방어다.

영향: Unicode·동형 문자 정리는 프로토타입에 무겁다.

고치려면: 감싸기만 남기고 정리 부분을 지운다(작음).

닫음: compact 대화에 web 결과가 섞여 있어 감싸기와 제어 token·동형 문자 정리는 인터넷 방어이고, 지워서 줄어드는 것은 정규식 몇 줄이다.

## agent credential의 operation이 tool 이름이라 이름이 다른 command tool이 거절된다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/server]
closed: fixed
guard: packages/core/main/agent-tools_test.ts "App Engineer의 credential 상한에 ticket.create tool이 부르는 route 이름이 든다"
```

지금: `tools/bundles/common.ts`의 `defineBuiltin`이 `contract = spec.name`(tool 이름, 예 `ticket.create`)으로 두고, `run-loop/runtime-access.ts`의 `runOperations`·`roleOperations`가 이 값으로 agent credential의 operation 목록을 만든다. core는 `server/identity/model.ts`의 `authorize`에서 `ctx.scope.operations.includes(<route 이름>)`으로 대조한다(command는 `storage/ledger/dispatch.ts`·`command-results.ts`의 `authorizeConditions`). tool 이름과 route 이름이 같은 것(`problem.*`, `app.list|get|create`, `context.list|get|search|draft|violations` 등)만 맞는다. 다른 것: `ticket.*`(`CreateTicket` 등), `app.link_source`(`app.connect_source`), `context.submit`(`bundle.submit`), `operator.*`, `package.list|get`, `release.*`, `settings.get`, `instructions.read`, `visual.show`(`RecordMessage`). `roleOperations("app_engineer")`에 `ticket.create`는 있고 `CreateTicket`은 없다.

영향: App Engineer의 ticket 만들기·고치기·확인·취소, 앱 source 잇기, PM의 context 제출, operator 만들기 같은 command tool이 core에서 `forbidden`으로 거절된다. agent의 주요 일이 막힌다. core를 띄워 실제 호출로는 아직 확인하지 않았다.

고치려면: tool 정의가 부르는 route 이름 목록(`operations`)을 갖게 하고 credential을 그것으로 만든다. harness-domain 계획의 `harness-spi-registry`가 이 일을 하고 위험 test(app_engineer 상한에 `CreateTicket`이 있고 `ticket.create`는 없음)를 쓴다. 그 전에 급하면 `defineBuiltin`에서 이름이 다른 tool만 route 이름을 더하는 작은 fix가 된다.

정한 것: `harness-spi-registry`가 고친다. 그 task가 core를 띄워 실제 거절을 먼저 확인한다.

닫음: core를 띄워 고치기 전 거절을 확인했다(App Engineer credential로 `CreateTicket`이 403 `forbidden`, 같은 credential의 `problem.list`는 200). 이제 `ToolDefinition.operations`가 tool이 core에 부르는 route 이름(helper가 부르는 것 포함)이고 `defineTool`이 `routes`에서 채운다. `runOperations`·`roleOperations`가 그 합집합이라 credential 상한에 `CreateTicket`, `SendCall`, `CreateOperator`, `bundle.submit`, `app.connect_source` 같은 route 이름이 든다. `call`·`reply`·`cancel`도 같은 이유로 막혀 있었고 같이 풀렸다.

## 외부 MCP tool 이름을 읽는 route가 없어 Grants의 MCP 목록이 빈다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent, packages/protocol]
closed: fixed
guard: 없음
```

지금: `packages/shell/renderer/workspace/agents/core-grants.ts`의 `readGrants`가 catalog를 `mcpServers: []`로 하드코딩한다. 서버별 tool 이름을 돌려주는 route가 `protocol/lophn-agent`에 없다(`mcp-settings.ts`에는 auth와 project 설정 route뿐). tool 목록은 core 안(`extensions/mcp-toolkit.ts`, `mcp-connections.ts`의 tools/list)에서만 읽힌다. 그래서 `grants-panel.tsx`의 "Tools from MCP servers"는 늘 "No MCP tools."이다.

영향: 사람이 MCP tool별로 권한(ask/allow)을 볼 수도 정할 수도 없다. 서버 단위 on/off(`mcp_off`)만 된다.

고치려면: `agent_grants` 쪽에 서버별 tool 목록(이름, effect, 설명)을 읽는 route를 하나 더하고 `readGrants`가 채운다. 연결이 필요하므로 못 읽은 서버는 빈 목록과 이유로 돌려준다. 비용은 route 하나와 shell 매핑이다. 추천: 이 안.

닫음: memory route `agent-mcp-tools/list`(사람)와 `request-take`·`request-done`(runtime의 machine 입구)을 더했다. core는 요청을 작업 메모리 대기열에 놓고(`packages/core/lophn-agent/extensions/mcp-tool-requests.ts`, 기한 15초), agent runtime의 pump(`packages/core/main/agent-runtime/mcp-tools-pump.ts`)가 가져가 `McpKit.listTools`로 서버마다 따로 연결해(나란히, 서버마다 10초) 이름·설명·effect를 돌려준다. effect 규칙은 tool 정의와 같은 `mcpToolEffect` 하나다. `readGrants`가 읽은 서버만 `catalog.mcpServers`로 채운다. 꺼진 서버, 로그인이 필요한 서버, 못 읽은 서버는 Grants에 나오지 않는다(이유 안내 없음). 실제 서버 연결은 확인하지 않았다(process를 건너는 확인은 E2E 몫).
