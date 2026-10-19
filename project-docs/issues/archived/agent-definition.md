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

## shell 출력이 stream마다 1 MiB라 model에 2 MiB까지 간다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
closed: fixed
guard: packages/core/lophn-agent/tools/shell/run_test.ts "shell 출력은 stream마다 상한을 넘지 않고 앞뒤가 남으며 가운데 생략이 표시된다"
```

지금: `tools/shell/run.ts`의 `collect`가 stdout과 stderr를 각각 `OUTPUT_MAX_BYTES`(1 MiB)까지 모아 `content`에 그대로 싣는다. `bundles/shell.ts` 핸들러는 `limitText`/`fitJson` 같은 다른 tool의 24 KiB 상한(`tools/result.ts`)을 거치지 않는다. 시간은 기본 120초, 최대 600초.

영향: 출력 많은 명령 한 번에 context가 2 MiB 가까이 차서 turn이 `context_limit`으로 실패하거나 비용이 커진다. 다른 tool과 상한이 달라 model이 이어 읽기 안내를 받지 못한다.

고치려면: 출력 상한을 24 KiB 근처로 낮추고 앞/뒤를 남긴다(`limitText` 재사용, `shell.run` description의 "1 MiB per stream"도 맞춘다). 비용 작다. 추천: 이 안. process group(`setsid`) 방식은 시간 초과 때 자식까지 죽이는 데 필요해서 남긴다.

닫음: `tools/shell/run.ts`의 `collect`가 stream마다 앞 12 KiB와 굴러가는 뒤 12 KiB, 전체 byte 수만 쥐고, 넘으면 가운데를 `[… N bytes omitted; redirect output to a file and read it with file.read …]`로 표시한다. 앞뒤 조각은 `limitText`(head·tail)를 거쳐 300줄 상한도 지키고, 자른 자리의 멀티바이트 조각은 byte 단계에서 버린다. `shell.run` description도 맞췄다. process group(`setsid`)은 그대로다.

## `wrapUntrusted`가 둘이다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: packages/core/lophn-agent/run-loop/untrusted_test.ts "web 결과의 닫는 tag는 무력화되고 파일·shell 결과는 감싸지지 않는다", packages/core/lophn-agent/prompt-assembly/input-tags_test.ts
```

지금: `prompt-assembly/input-tags.ts`(`renderTag`로 감싼다)와 `run-loop/untrusted.ts`(`escapeBody`로 직접 감싼다)에 같은 이름·같은 모양의 함수가 있다. web tool(`tools/web/fetch.ts`, `search.ts`)은 앞의 것을, `run-loop/history.ts`는 뒤의 것을 쓴다. `run-loop/mod.ts`도 뒤의 것을 export한다. 테스트는 앞의 것(`input-tags_test.ts`)만 본다.

영향: 한쪽만 고치면 web 결과를 감싸는 모양이 둘로 갈라지고, 바깥 글이 닫는 tag를 흉내 내지 못하게 하는 방어가 한쪽에서 빠질 수 있다(prompt injection 경계).

고치려면: 하나만 남기고(`input-tags.ts`) 다른 쪽 import를 옮긴다. `untrustedSource`는 `run-loop/untrusted.ts`에 남긴다. 비용 작다. 추천: 합친다.

정한 것: 줄인다. `prompt-assembly/input-tags.ts` 것만 남기고 `run-loop/history.ts`·`run-loop/mod.ts`의 import를 옮긴다. `untrustedSource`는 `run-loop/untrusted.ts`에 남긴다.

닫음: `run-loop/untrusted.ts`에는 `untrustedSource`만 남고 `wrapUntrusted`는 `prompt-assembly/input-tags.ts`의 것(`renderTag`) 하나다. `run-loop/history.ts`는 `prompt-assembly/mod.ts`에서 가져다 쓰고 `run-loop/mod.ts`는 `untrustedSource`만 내보낸다.

## 이미지 tool 결과의 base64가 ledger와 blob에 그대로 쌓인다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/storage]
closed: fixed
guard: packages/core/lophn-agent/run-loop/history_test.ts "이미지가 2개를 넘으면 오래된 것부터 빠지고 짝 글에 표시가 붙는다", packages/core/lophn-agent/prompt-assembly/budget_test.ts "이미지 하나가 있어도 예산은 base64 길이가 아니라 고정 값으로 는다"
```

지금: `image.read`의 결과 `content.image.data_base64`가 세 곳에 저장된다. (1) `tool_calls.result` 칸(`run-loop/core-ports.ts`의 `finishToolCall`, `tools/commands.ts`), (2) `tool_call_output` blob(`core-ports.ts`), (3) `model_call_input` blob(`core-ports.ts`). 요청 body 전체라 이미지가 history에 남아 있는 동안 model call마다 다시 저장된다. 이미지 하나의 상한은 `tools/file/image.ts`의 `MAX_IMAGE_BYTES`(5 MiB, base64로 약 6.7 MiB)이고, annotation screenshot은 `ANNOTATION_SCREENSHOT_MAX_BYTES`(2 MiB)다. 기록 쪽에는 이미지 상한이 없고 blob purpose 상한 16 MiB(`storage/blobs/child-prepare.ts`)만 있다. `toolResultSchema.content`는 `z.json()`이라 크기 제한이 없다. 이미지 결과가 `tool_result_image`로 model에 가게 되면서 실제로 쓰이는 길이 됐다.

영향: 이미지를 연 session마다 ledger가 수 MiB씩 커진다. 5 MiB 이미지 셋(base64로 약 6.7 MiB씩)이 history에 있으면 `model_call_input` blob이 16 MiB를 넘어 저장에 실패하고, `core-ports.ts`가 그 model call을 보내지 않는다. 그 session은 이미지가 history에서 빠질 때까지 진행하지 못한다.

고치려면:
- `tool_calls.result`와 `tool_call_output`에는 `content.image` 대신 media type, 크기, hash만 남기고, history에는 이미지를 blob ref로 둔다(중간).
- history에서 오래된 이미지 조각을 빼고 "[image omitted]"로 바꾼다(작음. compact와 같은 자리).
- 추천: 둘째를 먼저. 실제로 막히면 첫째.

닫음: 둘째 길로 고쳤다. `run-loop/turn.ts`의 `historyOf`가 model call마다 `omitOldImages(state.history, KEEP_IMAGES)`(`run-loop/history.ts`, 2개)로 최신 이미지 둘만 싣고, 오래된 이미지 조각은 빼고 짝 `tool_result` 글 끝에 `[image omitted]`를 붙인다. 최대 크기 이미지 둘(base64 약 14 MB)이 `model_call_input` blob 상한(16 MiB) 안에 든다. 또 `prompt-assembly/budget.ts`의 `measureWire`가 body에 실린 이미지를 base64 byte가 아니라 이미지당 `IMAGE_TOKENS`(4096)로 세서 screenshot 하나로 `context_limit`이 나지 않는다. `tool_calls.result`와 `tool_call_output` blob에는 base64가 그대로 쌓인다(첫째 길). 실제로 막히면 그때 한다.

## model catalog가 models.dev에서 갱신되지 않고 자동 갱신 설정은 아무것도 바꾸지 않는다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main]
closed: fixed
guard: packages/core/lophn-agent/models/adapters/models-dev_test.ts "models.dev 응답이 lophn 항목으로 바뀐다", packages/core/lophn-agent/models/catalog-refresh_test.ts "새 data root에서 autoUpdate=false이면 catalog 요청이 안 나간다"
```

지금: `models/work.ts`의 `createCatalogRefresher`가 `runRefresh`에서 `fetch`가 없으면 network 없이 정상본을 그대로 돌려준다(`if (!input.fetch)`). agent runtime(`main/agent-runtime/main.ts`)은 `import.meta.main`에서 `productDriver()`로 시작하며 `fetch`를 넘기지 않아, 제품에서는 갱신이 한 번도 일어나지 않는다. `refreshNow()`를 부르는 route도 없다. 설정 `lophn-agent.model.catalog_auto_update`(`lophn-agent/register.ts`)는 선언만 있고 읽는 곳이 없다. 실제 on/off는 `<dataRoot>/derived/lophn-agent/catalog-state.json`의 `auto_update`이고 file이 없으면 늘 true다.

영향: 사람이 고를 수 있는 model이 동봉 `models/snapshot.json`의 4개(openai `gpt-5`, anthropic `claude-sonnet-4-5`, openrouter `anthropic/claude-sonnet-4-5`, ollama `qwen3:8b`)에 묶인다. 새 model이 나와도 lophn을 새 판으로 올리기 전에는 쓸 수 없다. 설정 화면의 자동 갱신 켜기·끄기는 아무 일도 하지 않는다.

고치려면:
- 살린다(작음): agent runtime이 제품에서도 `fetch`를 넘기고, `catalog_auto_update` 설정 값을 `catalog-state.json`의 `auto_update`로 옮긴다. 기동 때마다 models.dev에 공개 GET이 나간다(24시간에 한 번).
- 지운다(작음): refresher, models.dev adapter, `catalog-state.json`, 설정을 지우고 catalog는 동봉 snapshot과 사람이 더한 model만 쓴다. 새 model은 lophn 판 올리기로만 들어온다.

fetch를 넘겨도 갱신은 실패한다: `adapters/models-dev.ts`의 `parseCatalogBody`가 응답을 lophn 항목 배열로 읽는데 실제 `api.json`은 `{<provider>: {models: {…}}}` object다(2026-10-17 판: provider 232개). 동봉 `snapshot.json`도 models.dev에서 뽑은 것이 아니라 손으로 쓴 4개다.

정한 것: OpenCode 꼴로 한다(사람). models.dev `api.json` → lophn 항목 변환 함수 하나를 두고, build 때 script가 lophn 내장 provider 정의 몫만 뽑아 `snapshot.json`을 만들고, 실행 때 갱신이 같은 함수로 그 위에 덮는다. catalog 밖 model은 지금처럼 거절한다(agent). 계획 `agent-io`의 `model-catalog-source`, `model-catalog`.

닫음: OpenCode 꼴로 고쳤다. `models/adapters/models-dev.ts`의 `modelsDevEntries`가 models.dev `api.json`(provider object)을 lophn 항목으로 바꾼다. 내장 정의 7개 몫만 뽑고(`google` → `google-gemini`), 한도나 text 입출력이 없는 model과 schema를 못 넘는 항목은 버리며, `limit.input`이 없으면 `input_limit`은 context 한도다(출력 예약은 `inputBudget`이 뺀다). reasoning effort는 effort 축 하나로, anthropic의 `budget_tokens`는 예산 축으로 옮기고 모르는 형(toggle 등)은 `options: null`이다. 실행 때 갱신(`parseCatalogBody`)과 `tools/models-snapshot.ts`(판을 낼 때 돌린다)가 같은 함수를 쓰고, 동봉 `snapshot.json`은 그 결과다(510개, models.dev에 없는 ollama 항목은 옮겼다). agent runtime은 `import.meta.main`에서만 `catalogFetch: fetch`를 받고, 기동 때 설정 `lophn-agent.model.catalog_auto_update`를 core에서 읽어 `catalog-state.json`의 `auto_update`로 쓴다(다음 기동부터 적용). 새 data root는 복구 직후 바로 갱신하고, 복구한 catalog·state를 `derived/lophn-agent`에 쓴다. `refreshNow()`를 부르는 route는 여전히 없다(즉시 새로 받기 화면도 없다).

## 목록에서 빠진 tool의 이유 구별(grant·release·거절)이 run-loop에서 닿지 않는다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: `packages/core/lophn-agent/run-loop/tool-batch.ts`의 `one`은 목록에 없는 tool(`control.tools.info`가 없음)을 `not_found` "tool is not available"로 먼저 닫는다. 그래서 `packages/core/lophn-agent/tools/work.ts`의 `executeToolCall`이 받는 `missingReason`(prepare.ts가 `appApiMissingReason`으로 채움)과 app-api의 `missing.ts`의 `removed_from_release`·`removed_from_grant`·`denied`·`unknown_tool`, `packages/core/lophn-agent/tools/wire.ts`의 `MISSING_TOOL_MESSAGES`는 부를 길이 없다. `tests/e2e/operator_test.ts`의 `excluded` 행이 model이 받는 tool_result가 `not_found`임을 보였다.

영향: session 도중 사람이 grant에서 앱 tool을 빼거나 release가 api를 없애도 agent는 "없는 tool"로만 듣고 이유를 모른다. 쓰이지 않는 이유 구별 코드와 문구가 남아 고칠 때 헷갈린다.

고치려면:
- (추천) 이유 구별을 지운다(`missing.ts`의 `appApiMissingReason`·`AppApiMissingState`, `missingReason` 인자, `MISSING_TOOL_MESSAGES`, `missingState`). 목록에 없는 tool은 `not_found` 하나다. `grantAllows`는 `app-tools.ts`가 쓰니 남긴다.
- 또는 `tool-batch.ts`가 `not_found` 대신 `control.tools`에 이유를 물어 그 code로 닫는다. agent가 이유를 들어야 할 근거가 문서에 생기면 이쪽이다.

닫음: 이유 구별을 지웠다(app-api의 `missing.ts`, `missingReason` 인자, `MISSING_TOOL_MESSAGES`, `missingState`, prepare의 `offered`). 목록에 없는 tool은 `not_found` "tool is not available" 하나다. `grantAllows`는 쓰는 `tools/app-tools.ts` 안으로 옮겼다.

## Project Manager 지침이 경계와 계약 위반 판단을 정하라고도 하고 물으라고도 한다

```yaml
kind: bug
modules: [packages/core/agent-roles]
closed: fixed
guard: 없음
```

지금:
- `packages/core/agent-roles/roles/project-manager/prompt.md`의 "What you do"는 두 가지를 PM의 일로 쓴다.
  - "When a person or an agent asks for a context, draw the boundary first."
  - 계약 위반 때 "decide whether the contract should change or the document is wrong."
- 같은 file의 "What you do not do"는 반대로 말한다: "Do not decide what only the person can decide: a boundary, what a term means, whether the contract or the document should change. Ask with `ask`…"
- `project-docs/products/AGENT-ROLE.md`의 C2는 PM이 경계를 긋는다고 하고, C6은 PM이 정한다고 한다(정하는 내용은 제안).

영향:
- context 요청이나 계약 위반 reaction(AGENT-ROLE E5)을 받은 PM은 같은 지침에서 "정하라"와 "정하지 말고 물어라"를 같이 받는다.
- 어느 쪽을 따르느냐에 따라, 사람에게 묻지 않고 계약을 바꾸거나, 위반마다 사람의 답을 기다리며 아무것도 submit하지 않는다.
- 사람은 PM이 어떻게 굴지 알 수 없다.

고치려면:
- PM이 정한다(작음): "What you do not do"에서 경계와 계약·문서 판단을 빼고, 용어의 뜻만 남긴다. 무엇을 왜 정했는지는 대답에 남긴다. AGENT-ROLE C2·C6과 맞는다.
- 사람에게 묻는다(작음): "What you do"를 "안을 만들고 `ask`로 묻는다"로 바꾸고, AGENT-ROLE C2·C6을 고친다. 위반과 경계마다 사람의 답을 기다린다.
- 추천: PM이 정한다. 통과한 초안은 사람 승인 없이 적용한다는 C3과 같은 쪽이다.

정한 것: PM이 정한다(사람). "What you do not do"에는 용어의 뜻만 남기고, 경계와 계약·문서 판단은 PM이 정해 이유를 대답에 남긴다.

닫음: PM 지침의 "What you do not do"는 용어의 뜻만 사람에게 묻게 하고, 경계와 계약 위반 판단은 PM이 정해 이유를 대답에 남기게 한다. AGENT-ROLE C6의 "(정하는 내용은 제안)"을 뗐다.

## role 지침 세 곳이 코드에 없는 것을 말한다

```yaml
kind: bug
modules: [packages/core/agent-roles]
closed: fixed
guard: 없음
```

지금:
- lophn을 다른 agent에게 소개하는 줄이 project도 등록한다고 한다.
  - `packages/core/agent-roles/place/place-data.ts`의 `ROLE_LINE.lophn`: "Plans work, registers projects and apps, and hands work to others."
  - lophn의 쓰기 tool은 `app.create`뿐이고, project를 등록하는 tool은 없다(`packages/core/agent-roles/tool-lists.ts`).
- App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md`)은 ticket의 "acceptance checks"(복수)라고 쓴다. 그런데 `ticket.create`의 `check`는 하나다(`packages/protocol/coding-agent/ticket/values.ts`).
- 같은 지침은 reaction으로 "a repeating problem closed"를 든다. 실제 reaction은 앱이 거듭 죽어 자동 재시작을 멈춘 것이다(`AppRestartHalted`, `packages/core/events/reactor/session-opening.ts`).

영향:
- 다른 agent가 이 줄을 보고 lophn에게 project 등록을 맡기면, lophn은 할 수 없어 일이 돌아온다.
- App Engineer가 check를 여럿 넣으려 하면 `invalid_input`으로 막혀 turn을 쓴다.
- 재시작이 멈춘 reaction을 받은 App Engineer는 지침에서 그 경우를 찾지 못한다.

고치려면: 세 문장을 코드에 맞게 고친다(작음).
- lophn 줄: "Plans work, registers apps, and hands work to others."
- App Engineer 지침: "the acceptance check", "the app stopped restarting after repeated crashes".

닫음: `ROLE_LINE.lophn`은 "registers apps"만 말하고, App Engineer 지침은 "the acceptance check"와 "the app stopped restarting after repeated crashes"를 쓴다.

## agent 정의의 MCP server 층이 type과 정의 file에만 있다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/protocol, packages/shell/renderer]
closed: fixed
guard: packages/core/lophn-agent/extensions/mcp-toolkit_test.ts "Operator 정의 층의 server는 그 Operator의 turn 준비에만 연결된다", packages/core/lophn-agent/extensions/mcp-server_test.ts "mcp secret 이름은 그 이름을 쓰는 server의 origin으로만 간다"
```

지금: Operator 정의의 `mcp_servers`가 protocol(`packages/protocol/lophn-agent/operators.ts`의 `operatorDefinitionSchema`), 정의 file 키, renderer type(`packages/shell/renderer/workspace/agents/source.ts`)에 있다. `packages/core/lophn-agent/extensions/mcp-toolkit.ts`의 `serversOf(place, agent)`도 agent 층을 겹친다. 그러나 붙이는 길이 없다. 화면의 draft(`packages/shell/renderer/workspace/agents/core-source.ts`)는 `mcp_off`만 보내고, 화면 목록(같은 폴더 `core-extensions.ts`)은 전역과 project 층만 그리고, `packages/core/agent-roles/tools/operator.ts`는 실행 파일을 정하는 입력이라 `mcp_servers`를 일부러 받지 않는다. 쓰는 쪽도 없다. turn 준비(`run-loop/prepare.ts`의 `loadMcp`)는 `agent`를 넘기지 않고 runtime의 Deno 권한(`extensions/mcp-snapshot.ts`)과 Grants 목록(`agent-mcp-tools/list`)도 이 층을 모른다.

영향: Operator 편집 화면(`packages/shell/renderer/workspace/agents/editor/definition-form.tsx`)에는 server를 더하는 단추와 form이 있다. `packages/shell/renderer/workspace/agents/core-source.ts`의 `saveAgent`가 정의를 통째로 보내므로, 거기서 넣은 server는 정의 file에 저장된다. 그런데 runtime은 그 server를 조용히 쓰지 않는다. 사람이 정의 file을 손으로 고쳐 넣어도 같다. agent의 `operator.create`·`operator.update` tool로는 넣을 수 없다. Operator마다 MCP server를 다르게 주는 기능은 지금 없는데, 화면은 있는 것처럼 보인다.

고치려면:
- 살린다(중간): resolved agent에 `mcp_servers`를 싣고 `loadMcp`가 넘긴다. Deno `--allow-net`·`--allow-run`에 정의 층을 더하고 정의가 바뀌면 child를 다시 띄운다. 화면 입력을 열고, 실행 파일을 정하는 입력이라 승인 경계를 다시 정한다.
- 지운다(작음): protocol 칸, 정의 file 키, `serversOf`의 agent 층, renderer type, Operator 편집 화면의 server 단추와 form, 그 wireframe을 지운다. 잃는 것은 지금도 못 쓰는 Operator별 MCP다. 이미 `mcp_servers`가 든 정의 file은 `unknown_field`로 거절된다(호환 장치를 두지 않는다).
- 추천: 지운다. 필요해지면 그때 화면·승인과 같이 짠다.

정한 것: 살린다(사람: Operator에게도 자기 MCP server가 필요하다). runtime이 Operator 정의 층의 server를 읽어 쓰게 하고, Deno 권한과 Grants 목록도 그 층을 알게 한다. 정의가 바뀌면 runtime을 다시 띄운다. server를 넣는 길은 지금처럼 사람의 화면(Operator 편집)뿐이다. agent의 `operator.create`·`operator.update`는 실행 명령을 정하는 입력이라 계속 받지 않는다. 앞서 "지운다"로 적은 것은 사람의 답을 잘못 읽은 것이다.

닫음: 살렸다. turn 준비(`run-loop/prepare.ts`의 `loadMcp`)가 Operator 정의의 `mcp_servers`를 agent 층으로 넘기고(`agents/layers.ts`), `serversOf`의 겹치기가 그 층을 마지막에 얹는다. runtime child의 Deno 권한(`extensions/mcp-snapshot.ts`의 `operators`)과 `mcp.` secret 목적지가 모든 Operator의 정의 층 server를 읽고(`main/daemon/wiring/operator-mcp.ts`), 정의가 바뀌면 기존 poll이 child를 다시 띄운다. Grants 목록(`agent-mcp-tools/list`)은 Operator id를 함께 받아 그 Operator의 정의 층을 더한다. 정의 층 server의 credential 이름은 `mcp.<agt id>.<server>`이고 편집 화면이 저장 뒤 보호 입력으로 값을 받는다. 내장 role 편집 화면에는 Add server가 없다. agent의 `operator.create`·`operator.update`는 계속 `mcp_servers`를 받지 않는다. 정의 층 server의 OAuth 로그인 길은 없다(편집 화면은 none·bearer·api_key만 받는다).

## 같은 이름 skill은 agent의 domain을 거르기 전에 하나로 합쳐져 사라진다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/shell/renderer]
closed: fixed
guard: packages/core/lophn-agent/extensions/skills_test.ts "same-name skills in a global layer and domains go to the agent by the domains it works in"
```

지금: `discoverSkills`(`packages/core/lophn-agent/extensions/skills.ts`)는 place 하나의 후보를 내장 → 전역 → domain 층 순서로 모아 `mergeSkillLayers`로 이름마다 하나만 남긴다. domain 층은 이름이 앞서는 domain을 나중에 넣어 덮게 한다. 그 뒤에 `skillReceived`가 agent가 일하는 domain의 skill만 받는다. 그래서 합치기에서 진 skill은 agent가 그 domain을 고르지 않아도 돌아오지 않는다.
- 전역 skill `review`와 domain `eval`의 skill `review`가 있으면 전역 것이 사라진다. `eval`을 고르지 않은 Operator는 `review`를 하나도 받지 못한다.
- domain `a`와 `b`에 같은 이름 `x`가 있으면 `a`의 것만 남는다. `b`만 고른 Operator는 `x`를 받지 못한다.
- `skill-read.ts`의 turn skill 읽기도 같은 합친 목록을 쓴다.

영향: domain을 좁힌 Operator가 받아야 할 skill을 조용히 잃는다. prompt의 skill 목록과 `skill.read`에서 둘 다 빠진다.

고치려면:
- domain 층 후보를 domain마다 따로 두고, agent의 domain으로 거른 뒤에 이름을 합친다(중간. 합친 목록을 쓰는 곳은 `register.ts`의 `skills`, `skill-read.ts`, `/` 메뉴다). 추천.
- 같은 그릇 안에서 domain 사이, 그리고 domain과 전역 사이에 같은 이름을 두지 못하게 막고 skipped에 이유를 둔다(작음. 사람이 이름을 바꿔야 한다).

닫음: 고쳤다. domain 층 skill은 domain마다 따로 남고, agent가 맡은 domain으로 거른 뒤에 이름마다 하나를 고른다(`pickSkills`, `packages/core/lophn-agent/extensions/skills.ts`). domain skill이 같은 이름의 전역 skill을 이기고, domain끼리는 이름이 앞서는 domain이 이긴다. `skill-read.ts`, `/` 메뉴(`registry.ts`), prompt 목록(`run-loop/prepare.ts`의 `promptSkills`)이 같은 함수를 쓴다. Operator 정의의 `skills`는 이름으로만 고르므로 같은 이름이 여러 domain에 있으면 어느 것인지는 domain 순서가 정한다.
