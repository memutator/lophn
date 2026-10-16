# 앱 호출 경로, invocation, rewind, SDK 구현 목록 (2026-10-15)

기준 코드: main `acfe4cc3`. 본 설계: `tmp/specs/app-call.md`(S5)와 docs-review 2026-10-15의 S5 결정, project 범위 app-api 결정. 요구는 `core-app-runtime`(0887, 0893, 0894, 0915, 0922, 0924, 1496, 1513, 1514), `core-app-data`(0950, 1497), `core-apps`(0700~0706, 0725, 1512), `sdk`(0500~0514, 1511), `shell` req-1515.

먼저 알아 둘 것. S5 3장 표는 "호출 경로(core)"의 지금 코드를 `packages/core/apps/connections`, `invocations`라고 적었지만, 실제 지금 호출 경로는 다르다. 지금은 호출하는 쪽이 core에서 서명한 `AppConnection`을 받아 앱 process의 direct socket으로 직접 호출하고(`runtime/connect.ts`, `runtime/client`, `runtime/entrypoint/{direct-server,verify,invoke}.ts`, shell `main/app-frame/app-call.ts`), 앱 process가 invocation을 후행으로 core에 알린다(`invocations/delivery`, broker `invocations/submit`). 그래서 새 호출 경로(부른 쪽 확인, project, Gate, invocation 시작과 끝 기록, write queue, 전달)는 고칠 것이 아니라 새로 짓는 것이다. `connections/`는 앱 쌍 직접 통로라서 통째로 지운다.

## 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 앱 쌍 연결 준비, origin 서명, path 장부 | S5 2·4장, req-0887, changes.md 3장 앱 직접 통로(req-0883~0892, 0919, 0920 폐기) | `core/apps/connections/{prepare,origin,resolve,client,mod}.ts`와 test(`pair_test`, `path_test`, `scope_test`, `resolve_test`, `world_test`, `core_http_test`, `client_test`) | `resolve.ts`의 "선언 ∩ grant" 판정은 Gate(02)가 맡는다. path 장부 대신 부모 invocation 사슬을 쓴다(새로 만들 것 호출 루프) |
| 앱이 다른 앱을 부르는 직접 통로 | 같음 | `core/apps/permissions/broker/apps-connect.ts`, `protocol/apps/pair-routes.ts`, `protocol/apps/broker.ts`의 `brokerAppsConnect*`, `channel-values.ts`의 `BROKER_SOCKET_PATHS.appsConnect`, app process의 `PairPort`(`runtime/entrypoint/broker-client.ts`, `pair-port_test.ts`) | SDK 쪽 `connectAppCommands`는 고칠 것에 있다 |
| 서명 AppConnection 발급과 검증 | S5 2장(core가 부른 쪽을 확인), changes.md 3장 서명 연결권 | `core/apps/runtime/{connect,signing}.ts`와 test, `runtime/entrypoint/{signature,verify}.ts`, `protocol/apps/{channel,channel-client}.ts`의 AppConnection·callOrigin 부분, `appConnect` route(`protocol/apps/apps.ts`), `app-start.ts`의 `verify_key`, `core/apps/control.ts`의 connect 조립 | `sweep`(grant가 줄면 연결을 닫기)도 같이 없어진다. Gate가 호출마다 grant를 본다 |
| view가 닫힐 때 연결 비우기 | 위와 같음 | `appViewClosed` route(`protocol/apps/apps.ts`), `runtime/entrypoint/control.ts`의 view-closed, shell `main/app-frame/view-closed.ts` | 연결이 없어지므로 비울 것이 없다 |
| Deno runtime client(직접 호출 client) | S5 2장, changes.md 3장 | `core/apps/runtime/client/*`(`client.ts`, `unix-http.ts`, test) | 쓰던 곳: `lophn-agent/tools/app-toolkit.ts`, `apps/revert/worker/run.ts`, coding agent MCP |
| confirm 경로 전부 | S5 9장, req-0909~0914·0708 폐기, changes.md 3장 | `connections/{confirm,confirm-request,confirm-adapters}.ts`와 `confirm_test.ts`, `invocations/confirm.ts`(`accept_confirm`)와 `confirm_test.ts`, `permissions/broker/apps-confirm.ts`, `runtime/entrypoint/confirm-marker.ts`, `core/apps/control.ts`의 `ledgerConfirmTargets`, protocol의 `invocationAcceptConfirm`, `appAgentConfirmProof`, `appPairConfirmRequest/Poll`, `confirmExecutionProof`, `signedConfirmProof`, `CONFIRM_MARKER_LIMIT`, `brokerAppsConfirm*` | invocation의 `approval` 칸과 `accepted` 상태는 고칠 것에 있다 |
| 앱 process 쪽 confirm 검사와 proof 검사 | 같음 | `runtime/entrypoint/invoke.ts`의 proof·marker 분기, `command-body.ts`의 proof 파싱, `wire.ts`/`wire-check.ts`의 proof envelope | |
| revert 전부(core worker) | S5 3·9장, req-0714 rejected, changes.md 2장 rewind와 3장 | `core/apps/revert/{caller,app-steps}.ts`, `revert/worker/run.ts`와 test, `REVERT_WORKER_KIND`·`revertWorkerSpec`을 부르는 `core/main/worker/main.ts`, `core/main/daemon/core.ts`, `core/server/credentials.ts` | 앱 단계를 돌리던 session rewind 쪽 호출(`lophn-agent/session/rewind/app-revert.ts` 등)은 08로 넘긴다 |
| SDK `withRevert`와 revert 결과 | S5 9장 | `sdk/cap-schedule/revert.ts`(+test), `cap-schedule/mod.ts` export, `runtime/entrypoint/invoke.ts`의 `COMMAND_REVERT`·`commandResult`, `protocol/apps/direct-socket.ts`의 `commandRevertResultSchema`·`CommandResult.revert` | |
| blueprint `revert` 칸, `confirm` 칸 | S5 9장, changes.md 3장, req-0706 | `protocol/apps/blueprint-commands.ts`(revert 검사 80~170줄), `blueprint-types.ts`(`CommandRevertDeclaration`, `confirm`), `blueprint-read.ts`, `blueprint-value.ts`, `core/apps/blueprint/{extract,describe,reads}.ts` | 칸 이름은 계속 `commands`다. 이름 바꾸기는 확인 못함 |
| agent tool의 revert·confirm 분기 | 같음 | `core/lophn-agent/tools/app-tools.ts`(`revertCounterpart`, `reversible`, `revertCommand`, `confirm`, `AppInvokeOutcome.revert`), `app-toolkit.ts` | `tool-judgment/app-judgment.ts`는 02 |
| 앱 automation 전부 | removed.md 2장 보류, docs-review "앱 automation도 보류", changes.md 3장 | `core/apps/automations/*`(clock, permits, reads, testing, test), `runtime/entrypoint/{automation,clock-gate}.ts`와 test, `permissions/broker/automations.ts`, `protocol/apps/broker.ts`의 `brokerAutomation*`, `channel-values.ts`의 `AUTOMATION_*`·`automationsTryAcquire/Release`, blueprint `automatic_tasks`·`AutomationDeclaration`, `RecordedTrigger`의 automation, 읽기 `core/apps/automations/reads.ts`를 부르는 `register.ts` | grant kind `automation.run`은 02, shell 화면은 UI 칸 |
| agent-context(화면 상태, 화면 메모) | removed.md(앱 화면 메모 삭제, 앱 화면 상태 보류), docs-review 같은 절 | `core/apps/agent-context/*`, `protocol/apps/agent-context.ts`, blueprint `agent_context`·`AgentContextDeclaration`·`AnnotationTargetDeclaration`, `sdk/cap-schedule/screen-context.ts`(`registerScreenContext`, `registerAnnotationTarget`), `core/lophn-agent/tools/bundles/app-context.ts`, `tool-judgment/app-context-judgment.ts`(+test), `app-toolkit.ts`의 화면 context 부분 | 사람이 다는 annotation(req-1486~1488)은 반대 방향이라 남는다. 지금 shell에 annotation 코드는 없다 |
| 문서 저장(cap-save) | removed.md 1장 앱 문서, changes.md 3장 | `sdk/cap-save/*`, `core/apps/permissions/broker/documents.ts`(+test), `permissions/adapters/documents-save.ts`, `preview/adapters/documents.ts`, `protocol/apps/broker.ts`의 `brokerDocumentSave*`, `releases/sdk-permissions.ts`의 `@lophn/cap-save` 줄, blueprint `documents`·`DocumentDeclaration`·`FormatRef`, permission kind `document.save`(`protocol/apps/permissions.ts`, `blueprint-types.ts`) | grant kind `document.save`는 02 |
| format module | removed.md 1장, changes.md 3장 | `sdk/format-document/*` | |
| 후행 전달 목록과 후행 사실 | S5 4장 4·7, 5장(core가 기록) | `core/apps/invocations/delivery/{queue,sender,backoff}.ts`와 `delivery_test.ts`, `invocations/recording.ts`의 `StartFact`·`FinishFact`·`DenyFact`·`SubmittedFact`·`deliveryKey`, `permissions/broker/invocations.ts`, `protocol/apps/broker.ts`의 `brokerInvocationSubmit*`, `INVOCATION_DELIVERY_*`, `runtime/entrypoint/broker-client.ts`의 `submitInvocation`, `core/main/app-supervisor/{broker,pairs,preview-broker}.ts`의 invocations 서비스 감싸기 | `recordingMode`(성공 읽기는 안 남김)는 규칙만 남는다(고칠 것) |
| invocation 시작·끝·거절 event | S1(domain event 10개), event.md 7장 | `protocol/apps/invocations.ts`의 `invocationStarted/Finished/Denied/Accepted`, `invocations/commands.ts`의 `tx.emit` | invocation은 기록이지 domain event가 아니다(event.md 표에 없음) |
| invocation의 `approval` 칸, `accepted` 상태, `approval` unique index | confirm 경로 제거 | `invocations/schema.ts`, `rows.ts`, `store.ts`, `model.ts`의 `accepted` 분기, `protocol/apps/invocations.ts` | 칸 추가는 고칠 것 |
| 호출자 종류 `automation`, `system`의 직접 호출 | automation 보류 | `protocol/apps/channel.ts`의 `invocationCallerSchema`, `RecordedCaller`, `invocationTriggerSchema`의 automation | `system`은 앱 시작·재시작에 쓰이는지 확인 못함 |
| 앱 process Deno 허락에 다른 앱 socket을 더하는 일 | S5 4장(다른 앱 호출도 core 경유) | `core/main/app-supervisor/access.ts`의 "부를 수 있는 다른 앱" 계산, `assembly.ts`의 그 연결 | |
| 앱 등록의 기획 문서 판 참조와 이름 예약 | S5 변경(registration), removed.md 1장(주소 체계, 판) | `core/apps/registration/{commands,schema,rows,store,lookup}.ts`의 `planning_version`, `reserveSlug`(`placeNameReservation` port), `protocol/apps/registry.ts` | 앱 slug 중복 검사(`SELECT id FROM apps WHERE slug`)는 남긴다 |
| blueprint `problem_codes` | changes-by-topic 2장 problem-codes 아예 덜어냄 | `protocol/apps/blueprint-types.ts`의 `ProblemCodeDeclaration`, `blueprint-schema.ts`, `sdk/blueprint/mod.ts` export, `fixture`·test | problems 영역과 겹친다. blueprint 쪽만 여기서 센다 |
| app test의 `automation_scope` 검사 | automation 보류 | `core/problems/tests/harness/{checks,definitions,driver,rpc}.ts`, `work/app-driver.ts`·`testing/app-driver.ts`의 `runAutomation` | |
| 앱 process의 `request_key` 재조회·cancel·status (직접 client용) | 확인 못함 | `runtime/entrypoint/invoke.ts`(`reference`, `known`, `byRequest`), `protocol/apps/direct-socket.ts`의 cancel·status | core가 결과 모름을 직접 다루면 필요 없다. 정해야 한다(확인 못함 참조) |

## 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| invocation 표와 protocol 모양 | 칸 `approval`, 상태 `accepted`, trigger `automation`을 빼고 `project`, 효과(read·write·external), changeset(BLOB 또는 blob 참조), 되돌림 표시(되돌린 rewind)를 더한다. 호출자는 `direct·automation·app·agent{run,tool_call}·system`에서 `사람(화면, view session)·agent{session,turn,tool_call}·app{app,release,parent_invocation}`로. 운영·preview 구분은 유지 | S5 5장, req-0893, 0894, 1514 | `invocations/{schema,rows,store,model}.ts`, `protocol/apps/{invocations,channel}.ts` |
| invocation schema trigger | terminal 상태 행은 못 바꾸는 trigger(`invocations_terminal_no_update`)가 되돌림 표시와 changeset 지우기(activation)를 막는다. 이 두 칸만 바꿀 수 있게 한다. `invocations_no_delete`는 유지(기록은 안 지움) | S5 5·6장, 11장 2 | `invocations/schema.ts` |
| invocation 기록 주체 | 앱 process의 machine 통보(`record_started/finished/denied`, `requireMachine`)에서 core 호출 경로가 command 층으로 직접 남기는 것으로 바꾼다. 시작은 호출 때, 끝은 앱 응답 때 | S5 4장 4·7, req-0887, 0893 | `invocations/commands.ts`, `invocations/model.ts`, `register.ts`(command 등록) |
| 기록 규칙 `recordingMode` | automation·confirm 분기를 빼고 "write·external·앱 시작은 항상, 읽기는 실패만, preview는 구분해서"로 줄인다. 시작을 미리 남기지 않는 읽기는 끝에서 실패일 때만 한 번에 남긴다 | S5 5장, req-0893 | `invocations/recording.ts` |
| invocation 읽기 | `invocationsList/Get`에 project·호출자 session·turn·효과·되돌림 여부 필터를 더하고, 응답에 위 새 칸을 싣는다. 열람 범위(`authorizeAppId`)는 유지 | S5 5·8장 | `invocations/reads.ts`, `protocol/apps/invocations.ts` |
| core 재시작 점검 | `accepted` 분기를 빼고, 돌던 write의 changeset이 없을 때 그 호출 뒤 rewind가 어떻게 되는지 정한다(확인 못함 참조) | S5 5·7장 | `invocations/restart.ts` |
| 앱 process의 호출 처리 | 서명·proof 검증 없이 core(supervisor)가 보낸 호출만 받는다. 호출 하나마다 invocation id, project, 부른 쪽 맥락을 받고, 결과와 함께 changeset(write·external·앱 시작)을 돌려준다. 자기 쪽 기록 전달을 없앤다 | S5 4장 6, 6장 | `runtime/entrypoint/{invoke,verify,state,wire,wire-check,command-body,limits}.ts` |
| 앱 process의 socket 서버 | 호출자별 직접 연결을 받던 서버를 core·supervisor 전용 통로로 줄인다. probe·open·close·shutdown은 supervisor 몫으로 남는다. 어떤 transport로 core가 호출을 보낼지(기존 supervisor 제어 pipe의 op 추가 또는 socket)는 구현에서 정한다 | S5 3장, req-0950, 0930 | `runtime/entrypoint/direct-server.ts`, `control.ts`, `protocol/apps/channel-values.ts`의 `DIRECT_SOCKET_PATHS`, `runtime/control-protocol.ts`, `runtime/supervisor-link.ts`, `supervisor/control-link.ts` |
| 앱 시작 입력과 ready | `verify_key`, automation 한도, `agent_context`·`automations` ready 항목을 뺀다. 앱 시작이 DB를 바꾸면 그 changeset을 앱 시작 invocation에 붙인다 | S5 6장, req-0893 | `protocol/apps/app-start.ts`, `runtime/entrypoint/{startup,main,start-input}.ts`, `protocol/apps/runtime.ts`의 `readyAttestation` |
| broker 서비스 묶음 | invocations, automations, documents, apps connect·confirm 서비스를 빼고 net·secret·problems·ready·control watch만 남긴다. 앱 사이 호출은 새 서비스(core 호출 경로로 가는 것)로 대신한다 | S5 4장 | `core/main/app-supervisor/{broker,assembly,access,preview-broker}.ts`, `permissions/broker/server.ts`, `protocol/apps/broker.ts`, `channel-values.ts`의 `BROKER_SOCKET_PATHS` |
| apps 제어 조립 | `POST /v1/apps/connect` memory route, connect 관련 operation 정책, confirm targets를 빼고 호출 route를 더한다 | S5 2장 | `core/apps/control.ts`, `core/apps/register.ts`, `protocol/apps/apps.ts` |
| SDK app-api 등록과 dispatch | `command()` 등록, `currentContext()`, `runWith()`는 유지하되 `withRevert`, automation 관련, `registerScreenContext`를 빼고, 호출 문맥에 `project`를 더한다. 패키지 이름 `cap-schedule`이 뜻을 잃으므로 이름을 바꾼다(architecture.md 이름 규칙 확인) | req-0700, 1512, S5 6장 | `sdk/cap-schedule/{mod,handlers,context}.ts`, `core/apps/invocations/context.ts`(같은 모양을 맞추는 쪽), `packages/template/pin.ts`, 안내 `sdk/cap-schedule/guide.md` |
| SDK의 다른 앱 호출 | 직접 socket(`PairPort`)으로 가던 `connectAppCommands`를 core 호출 경로로 가게 바꾼다. 부모 invocation은 현재 호출 문맥에서 자동으로 붙는다. 결과 모름(`ResultLost`)의 의미를 core 경유 모양으로 다시 정한다 | S5 4장 표(다른 앱), req-0915, 0922 | `sdk/cap-schedule/connect.ts`(+test) |
| SDK DB 연결 | `openStore`가 호출마다 새 `DatabaseSync`를 연다. 앱은 SDK가 주는 연결 하나만 쓰게 하고, write·external·앱 시작 invocation 동안 그 연결에 SQLite session을 걸고 끝나면 changeset을 runtime에 넘긴다. `lophn_data_schema` 표는 session에서 뺀다 | S5 6장, req-1497, 0503 | `sdk/cap-store/{store,host,mod}.ts`, `cap-store/guide.md`, `runtime/entrypoint/cap-host.ts` |
| SDK secret client | `use({name, destination})`가 알림만 보내고 요청 내용(method, path, body)은 싣지 않는다. 요구는 "secret을 붙인 network 요청을 lophn에게 맡기고 원값을 받지 않는다"이다. 요청을 싣는 모양으로 바꿀지 확인이 필요하다 | req-0504, changes.md 4장 sdk 줄 | `sdk/cap-secret/secret.ts`, `core/apps/permissions/broker/secrets.ts`, `protocol/apps/broker.ts`의 `brokerSecretUse*` |
| SDK blueprint 작성 도우미 | `defineAgentContext`와 칸 타입(`AutomationDeclaration`, `DocumentDeclaration`, `CommandRevertDeclaration`, `AgentContextDeclaration`, `ProblemCodeDeclaration`...)을 내보내기에서 뺀다. 같은 기준으로 검사하는 것은 유지(req-0500) | req-0500, 0700 | `sdk/blueprint/{define,mod}.ts`, `automation_test`, `context_test`, `fixture.ts`, `guide.md` |
| blueprint 검사 | 칸에서 `automatic_tasks`, `documents`, `agent_context`, `problem_codes`, command의 `confirm`·`revert`를 빼고, app-api마다 project 범위인지 선언하는 칸을 더한다. 읽기용 view도 같이 | req-0700, 0706, 1512 | `protocol/apps/blueprint-{types,schema,commands,value,scope,uses,read,json}.ts`, `core/apps/blueprint/{extract,describe,reads}.ts` |
| app-api 이름(command에서 app-api로) | 요구와 문서는 바뀌었고 코드는 `command` 그대로다(`commands`, `app_commands`, `CommandDeclaration`, `app_`로 시작하는 tool 이름 등). 코드 전체를 바꿀지 정해야 한다 | docs-review "app-api로 바꾸자", terms.md | 규모는 확인 못함(blueprint JSON 칸 이름까지 닿는다) |
| agent의 app-api tool 실행 | `apps/connect`로 연결을 받고 direct socket으로 부르던 `AppCommandPorts.invoke/status`를 core 호출 경로를 부르는 것으로 바꾼다. 결과 모양에서 `revert`를 뺀다. 결과를 잃었을 때 invocation 목록으로 찾는 `findInvocation` 재시도는 core가 결과 모름을 직접 다루는 쪽으로 정해야 한다. project 칸: project에 놓인 agent의 tool 입력에는 project가 없고 core가 넣는다. 놓이지 않은 쪽(lophn, 앱 place agent)은 project를 입력으로 준다 | S5 4장, req-1513, S4 4장 | `core/lophn-agent/tools/{app-tools,app-toolkit}.ts`, `tools/bundles/app.ts`(`app.commands` 설명의 revert·confirm 문구) |
| 호출 루프 거절 | path 장부(`origin.ts`)로 하던 "이미 호출 경로에 있는 앱으로 돌아가는 호출 거절"을 invocation의 부모 사슬로 한다. 깊이 상한 `APP_CALL_DEPTH_LIMIT` 8은 재사용 | req-0924 | `connections/origin.ts`(지울 것), `protocol/apps/channel-values.ts` |
| preview 호출 | preview process도 core 호출 경로로 부르고, mode를 preview로 구분해 남긴다. preview invocation은 rewind 대상이 아니다. documents·automation·confirm 대역을 뺀다 | S5 4장 끝, req-0945, 0946, 0948 | `core/apps/preview/{launcher,service,model}.ts`, `preview/adapters/{apps,documents,mod}.ts`, shell `app-connection.ts`의 preview 연결 |
| 앱 등록 actor | `app.create`는 user와 coding agent만 받는다(`requireWriter`). 새 앱은 lophn이 등록한다 | req-0719, 1063, S8 | `core/apps/registration/commands.ts` |
| app test의 되돌림 검사 | 앱이 선언한 revert command를 부르는 3 검사(`revert_restore`, `revert_conflict`, `revert_duplicate`)를 "write app-api를 부르고 core가 뒤집은 changeset을 적용해 DB 상태가 부르기 전과 같다"는 검사 하나로 바꾼다. test driver는 changeset을 받아 뒤집어 적용해야 한다 | req-0821, 0818 | `core/problems/tests/harness/{checks,definitions,driver,rpc}.ts`, `work/app-driver.ts`(1108~1136줄 revert), `testing/app-driver.ts`, `testing/view-checks.ts` |
| app test의 read 검사 | `read_contract`가 "read가 업무 데이터를 바꾸지 않는다"(`business_unchanged`)와 외부 상태 무변경을 검사한다. S5 11장 4는 lophn이 검사하지 않는다고 정했다. 입력 계약 검사만 남긴다 | S5 11장 4, docs-review 2026-10-15 마지막 항목 | `core/problems/tests/harness/checks.ts`(`readContract`), `definitions.ts` |
| app 호출 이름이 박힌 release 준비 흐름 | 선언에서 빠진 칸(revert, confirm, automation, documents, agent_context)을 보는 곳 | S5 9장 | `core/apps/releases/{compare,facts,commands}.ts`, `releases/prepare/flow_test.ts`, `activation/{assembly,steps}.ts` (activation 흐름은 07) |
| app 템플릿과 안내 | 템플릿 blueprint의 `confirm`·`revert`·`automatic_tasks`, command 코드, test, 화면 bridge | req-0726 | `core/apps/packages/template/app/{blueprint.ts,src/commands.ts,tests/*}.tmpl`, `src/screens/items/bridge.ts.tmpl`, `coding-agent/guides/skills/lophn-build-app/SKILL.md`, `sdk/*/guide.md` |
| 앱 화면(사람)의 호출 | shell main이 view 연결(endpoint, authorization)로 앱 socket에 직접 POST하던 것을 core 호출 route로 바꾼다. 사람 호출은 Gate를 거치지 않는다. 앱·release·mode·project는 IPC를 보낸 view에서 정한다(페이지 주장 아님) | S5 4장 표(앱 화면), req-1515 | `shell/main/app-frame/{app-call,app-invoke,app-ipc}.ts`, `ipc/app.ts` |
| shell main의 view 연결 | `AppBinding`이 endpoint·authorization을 쥐고 화면 byte(`app-protocol.ts`)도 그것으로 가져온다. 직접 통로가 없어지면 binding에서 서명 연결을 빼고 화면을 가져오는 길을 새로 정해야 한다(확인 못함 참조) | S5 2장, changes.md 3장 | `shell/main/app-frame/{app-connection,binding,view-model,registry,app-protocol,session-policy}.ts` |
| shell main의 confirm 결정 종류 | 네 종류(release activation, grant, confirm command, automation) 가운데 confirm command와 automation을 뺀다 | S5 9장 | `shell/main/confirmation/kinds/{apps,app-decisions}.ts`, `shell/ipc/confirmation.ts`, `protocol/shell/confirmation.ts`, `main/confirmation/types.ts` |

## 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| core 호출 경로 서비스 | 부른 쪽 확인, project 정하기, Gate 부르기, invocation 시작, write queue, 앱 process 전달, invocation 끝과 changeset 보관, 부른 쪽에 결과. 앱 화면·agent·다른 앱 세 길이 모두 이 하나를 지난다. 근거: 지금 코드에 이 서비스가 없다(호출이 core를 안 지난다). 고치기보다 새로 짓는 쪽이 맞다 | S5 2·4장, req-0887 | `packages/core/apps/` 안. code-map.md에서 위치와 이름을 정한다(`connections/`는 지우므로 이름을 재사용하지 않는다) |
| 부른 쪽 확인 세 길 | 사람(IPC를 보낸 view와 그 project), agent(인증된 session·turn·tool call과 그 agent의 place), 다른 앱(부른 앱·release·부모 invocation). 본문 주장은 안 믿는다 | S5 4장 1, req-0894 | 호출 경로 서비스. agent place는 S4·S8과 접점 |
| project 정하기 | project 범위 app-api이면 사람은 화면을 연 project, project에 놓인 agent는 그 project, lophn과 앱 place agent는 입력, 다른 앱은 부른 invocation의 project. project 범위 아닌 app-api는 project를 안 넣는다. project 입력 오류(없는 project, 놓인 agent가 다른 project를 주는 경우)는 거절 | S5 4장 2, req-1512, 1513, 1514 | 호출 경로 서비스, blueprint 선언 읽기 |
| 호출 루프와 깊이 거절 | 부모 invocation 사슬에 이미 있는 앱이나 깊이 8 초과를 handler 전에 거절 | req-0924 | 호출 경로 서비스 |
| 앱마다 write queue | write·external invocation을 앱마다 한 번에 하나씩 돌린다. read는 동시에. queue에 기다리는 호출은 보이게 한다. 취소(기다리는 중)와 앱 정지·끊김 때 정리 | S5 6장, 11장 3 | 호출 경로 서비스(앱별 상태). 교착 위험은 확인 못함 참조 |
| core에서 앱 process로 가는 호출 op | invocation id, 입력, project, 부른 쪽 맥락을 보내고 결과와 changeset을 받는다. 연결이 끊기면 unavailable 또는 결과 모름 | S5 4장 6, req-0922 | `runtime/control-protocol.ts`와 `supervisor-link.ts`, 앱 process 쪽 받는 곳 |
| SDK session과 changeset 반환 | write·external·앱 시작 동안 SQLite `createSession()`, 끝나면 `changeset()`을 결과와 함께 runtime에 넘김. 재진입(앱 사이 호출)·예외 때도 session을 닫는다. 근거: 지금 SDK에 session 개념이 없다 | S5 6장, req-0950 | `sdk/cap-store`, `runtime/entrypoint/invoke.ts` |
| changeset 보관과 삭제 | invocation에 붙여 저장한다(ledger BLOB 또는 blob store. 정해야 한다). activation이 끝나면 이전 release의 changeset을 지우는 호출을 S7에 준다. invocation 기록은 남긴다 | S5 6장, req-1496 | `core/apps/invocations/store.ts`, S7 activation 흐름 |
| changeset 뒤집기 | SQLite changeset format을 읽어 INSERT와 DELETE를 맞바꾸고 UPDATE의 old·new를 맞바꾼 changeset을 만든다. 순수 함수이고 `node:sqlite`의 session으로 만든 changeset과 맞는지 test로 본다(Deno 2.9.7에는 invert가 없다) | S5 6장 | `core/apps/` 안의 순수 모듈(rewind 쪽) |
| rewind 목록 계산 | 고른 invocation k부터 그 앱의 지금 release live 최신까지 모든 invocation(사람 화면, 다른 session, 다른 앱 호출 포함)을 모으고 external을 되돌아가지 않는 것으로 표시한다. preview·test, 이전 release, `data_change`는 고를 수 없다 | S5 7장 2, 10장, req-1496 | rewind 서비스, 새 read |
| rewind 실행 | 사람만 부를 수 있는 command(agent·app token 거절). 새 호출 접수 닫기, 도는 호출 끝나기를 기다리기, 그 사이 온 호출 붙잡기, 최신부터 뒤집은 changeset을 앱 process에 보내기, 성공하면 되돌린 invocation에 되돌림 표시, 접수 열기, 붙잡은 호출 넘기기. 충돌이면 통째로 취소하고 이유를 남긴다. 진행 중 상태가 core 재시작에 살아남아야 한다 | S5 7장, 11장 1·2, req-1496 | rewind 서비스, command 하나와 read 하나 |
| drain 공용 부품 | "새 호출 접수 닫기, 도는 호출 대기, 붙잡기, 다시 열기와 넘기기"를 activation(S7)과 rewind가 같이 쓴다. 지금 정지 흐름(`supervisor.ts`의 `accepting`, 정지 10초 뒤 강제 종료)은 호출을 붙잡아 넘기지 못한다 | S5 7장 4, req-1508 | `runtime/supervisor`와 호출 경로 서비스 |
| 앱 process에서 뒤집은 changeset 적용 | `applyChangeset`을 한 transaction으로. 충돌이면 abort하고 이유를 돌려준다 | S5 7장 6 | SDK/runtime의 새 op |
| rewind 기록 | 누가, 언제, 어느 invocation부터, 결과(성공·취소와 이유)를 남기고 각 invocation에서 찾을 수 있게 한다 | S5 5장 되돌림, 11장 2 | invocations 쪽 새 표 또는 칸 |
| session·turn별 write 목록 read | S8에 주는 것: session·turn으로 write invocation 목록. 고른 invocation 직전으로의 rewind 시작 | S5 8장, req-1519 | invocations reads |
| SDK project 읽기 | 앱이 lophn project 목록(ID, 이름, 목적)을 읽고, 앱이 가진 ID로 lophn이 찾는다. 보관된 project의 ID도 읽는다(앱 data는 남는다) | req-1511, docs-review project 결정 | SDK 새 capability(이름 정하기), broker에 읽기 서비스 하나 |
| handler가 받는 project | project 범위 app-api의 handler가 호출이 도는 project를 받는다(호출 문맥) | req-1512 | SDK 호출 문맥(`currentContext`), 앱 process 호출 처리 |
| 앱 화면이 project에 묶임(main) | view가 project를 하나 갖고 `app:call`이 그 project를 실어 보낸다. 앱 place에서 열면 앱 화면이 project를 고르고 main에 알린다(채널 필요). 페이지 주장은 아니고 main이 검사한다 | req-1515, docs-review project 결정 | `shell/main/app-frame/{view-model,registry,app-ipc}.ts`, `shell/ipc/{app,app-frame}.ts`의 `AppViewOpen`, `shell/preload/app-api.ts` |
| 필수 검사의 core rewind 확인 | 위 "고칠 것" app test 항목에서 쓰는 test driver의 changeset 받기·뒤집기·적용 | req-0821 | `core/problems/tests` |

## UI 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| confirm command 확인 화면 | S5 9장(confirm 제거), req-0708 | `shell/renderer/confirmation/kinds/confirm-command/confirm-command.tsx`, `screen.tsx`의 `confirm_command` 분기, `kinds_test.tsx`·`apps_test.tsx`의 해당 부분 | main 쪽(`main/confirmation/kinds/apps.ts`의 `confirmCommand`)은 고칠 것 |
| automation 켜기 확인 화면 | 앱 automation 보류 | `shell/renderer/confirmation/kinds/automation/automation.tsx`, `screen.tsx`의 `automation` 분기 | |
| Automations 탭 | 같음 | `renderer/app-frame/app-detail/automations/automations-tab.tsx`, `app-detail.tsx`의 탭, `source.ts`·`core-source.ts`의 `automations`·`turnOffAutomation`, `testdata/fake-source.ts`, wording `app-detail.*automation*` | |
| Activity 탭의 automation·activation 문구 | 위와 같음 | `activity-tab.tsx`의 `whoText`(`by-automation`, `by-applying`), `model.ts` | 호출자 문구 자체는 고칠 것 |

## UI 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| Activity 탭 행 | 호출자를 `direct/agent/app/automation`에서 "사람 화면 / agent session(S8 링크) / 다른 앱"으로, project·효과(read·write·external)·되돌림됨을 보이고, 기다리는 write는 대기로 보인다. 행을 골라 rewind를 시작하는 단추(지금 release의 live write·external·앱 시작 행에만)를 더한다 | S5 5·7·11장 3 | `renderer/app-frame/app-detail/activity/activity-tab.tsx`, `source.ts`(`ActivityRow`), `core-source.ts`(`activityOf`), `model.ts` |
| 앱 패널 탭(project 안에서 앱 열기) | 앱 view를 열 때 project를 함께 넘긴다. 앱 패널은 지금 앱·판·mode만 안다 | req-1515, 확인 줄 "project 안에서 앱을 열면 그 project로 열린다" | `renderer/workspace/app-panel-tab.tsx`, `workspace.tsx`, `app-frame/embedded-view.tsx`, `app-frame/app-views.tsx`, `shell/ipc/app-frame.ts`의 `AppViewOpen` |
| 앱 공간(앱 place에서 열기) | project 없이 열린다. project 범위 app-api는 앱 화면 안에서 고른 project로 돈다. 바(`app-bar.tsx`)에 현재 project를 보일지는 확인 못함 | req-1515 | `renderer/app-frame/app-space.tsx`, `app-bar.tsx` |
| 앱 상세 탭 목록 | Automations 탭을 뺀다. Data 탭의 export 단추는 07이 정한다 | 위 | `renderer/app-frame/app-detail/app-detail.tsx` |
| 앱 상세 wording | 앱 호출 문구(`did-action`, `by-*`, `mode-*`)를 새 호출자 종류로 | wording 규칙 | `design/wording/en.ts`, `placeholders.ts` |
| 결정 종류 안내(activity-scope 등) | confirm·automation 언급 제거 | S5 9장 | `renderer/app-frame/app-detail/*`의 wording 키 |

## UI 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| 앱 rewind 확인 화면 | 고른 invocation부터 최신까지 함께 되돌아갈 목록(시각, 효과, 누가 한 호출인지: 사람 화면, 어느 agent session, 다른 앱)을 보이고, external은 "되돌아가지 않음"으로 표시한다. 그 앱을 쓴 모두의 변경이 함께 사라진다는 안내. 사람이 확인해야 시작 | S5 7장 2·3, 10장, 11장 1 | 기존 확인 창 pattern(`renderer/confirmation/kinds/` 새 kind와 `main/confirmation/kinds/` 새 kind) 또는 Activity 탭 안 패널. 어느 쪽인지는 정해야 한다 |
| rewind 진행·결과 표시 | 접수를 닫고 도는 호출을 기다리는 동안 상태, 붙잡힌 호출 안내, 충돌로 통째로 취소된 이유, 성공 뒤 갱신 | S5 7장 4~7, 11장 2 | 위 화면 |
| 앱 place에서 project 고르기 | 앱 화면 안에서 project를 고른다. 앱 화면 쪽 UI이므로 SDK UI kit의 component로 줄지, 앱이 직접 만들지 정해야 한다 | req-1515 확인 줄 2 | `sdk/ui-*` 또는 앱 template. 정해야 한다 |
| invocation 보기의 project·세부 | project로 거르기, 한 invocation의 세부(부른 쪽 session·turn·tool call, 입력 지문, 결과 요약, 되돌림 기록) | S5 5장, req-0894 | Activity 탭 확장 |

## 문서끼리 어긋난 것

- S5 3장 표의 "호출 경로(core) 지금 코드: connections, invocations"는 실제와 다르다. 지금은 직접 호출 + 후행 기록이라 호출 경로 서비스 자체가 없다(맨 앞 설명 참조). `connections/`는 앱 쌍 직접 통로이고 한 줄도 새 경로로 이어지지 않는다.
- docs-review(1059줄)에 "req-0852가 아직 직접 연결 준비(지운 직접 통로)와 30초(세부 수치)를 말한다. S5를 쓸 때 고침 표를 낸다"고 적었는데 S5에 고침 표가 없다. req-0852는 rejected라서 문제는 없지만 약속이 남아 있다.
- req-0893은 "write invocation에 앱 DB 변경을 붙인다"고만 쓴다. S5 6장은 write, external, 앱 시작 invocation에 changeset을 붙인다고 한다. 요구 문장이 spec보다 좁다.
- changes.md 5장 "아직 열린 것: req-0044 session rewind와 앱 rewind를 어떻게 이을지 정하지 않았다"는 낡았다. S5 8장, S8, req-1519로 정해졌다.
- changes.md 2장 rewind 줄과 `architecture/approval.md` 5장은 "core가 session을 건다"고 썼다(S5 9장이 이미 짚음). 앱 DB는 앱 process만 열므로(req-0950) SDK가 건다.
- changes.md 3장 "앱 직접 통로" 줄은 직접 socket과 서명 연결권만 말한다. 같은 통로가 앱 화면 byte(`/screens`)도 내주는데 문서에 없다(확인 못함 참조).
- changes.md 4장 app-releases 줄의 "migration을 DB 사본에서 잰다"는 낡았다(S7이 migration 선언으로 바꿨다). 이 영역 밖이지만 같은 줄에 걸린다.
- changes-by-topic 5장 "apps/preview 그대로: automation 시계와 confirm 줄만 빠진다"는 코드와 다르다. preview에는 documents 대역과 apps 대역, 직접 연결을 받는 shell main 쪽도 있다.
- S5 5장 invocation 칸은 agent의 "session·turn·tool call"인데 지금 코드는 `run`·`tool_call`이다(S3의 session·turn 용어와 다름).

## 다른 영역에 넘긴 것

- 02(Gate와 grant): `core/apps/permissions/*`의 grant kind `app.call`·`agent.commands`·`automation.run`·`document.save`, `effective.ts`, `broker/apply-grant.ts`, `lophn-agent/tool-judgment/app-judgment.ts`, shell의 Access·Connections 탭과 `app-decisions`·`connection-revoke` 확인 kind. 호출 경로가 Gate를 부르는 접점만 여기서 센다.
- 07(activation, migration): drain 공용 부품을 쓰는 쪽, activation 끝에서 이전 release changeset 지우기를 부르는 시점, `core/apps/data/*`(backup, restore, export, 복구본), `appExport`, Data 탭의 export, Versions 탭, `releases/*` 흐름. 필수 검사에서 선언 칸이 빠지는 영향은 이 목록의 고칠 것에 한 줄 있다.
- 08(session rewind): `lophn-agent/session/rewind/{app-revert,checkpoints,judge,recover,sweep-core}.ts`와 `protocol/lophn-agent`의 `runAppRevert`·`checkpointRevert`·`finishRevert`·`AppRevertBinding`, shell `main/confirmation/kinds/rewind.ts`(`RunAppRevert` 이어 실행)와 `renderer/confirmation/kinds/rewind/`의 앱 단계. session rewind 화면에서 앱별 write 목록을 보이고 같은 시점으로 되돌리는 연결(S5가 목록과 rewind 시작을 주고 S8이 화면을 정한다).
- 06(coding agent): `coding-agent/connection/{app-direct,app-direct-unix,app-ops}.ts`, `mcp-server/*`, `protocol/coding-agent/{cli-app,mcp-app}.ts`, `core/apps/connections/operations.ts`(coding_agent operation 상한)와 `operations_test`, `app-tools_test`, `operations-documents_test`, `core_http_test`(coding agent 통로 시험), `tickets` 쪽 앱 호출.
- 04(agent 정의, tool): app-api tool의 이름·deferred·project 칸 표기(S4 4장), `tools/visuals`의 app 카드가 `agent_context` read 결과(`app.screen_context`)를 쓰는 부분(`visuals/work.ts` 245·287줄. agent-context를 지우면 걸린다).
- 01(event): `protocol/events`와 ledger event catalog에서 invocation event 넷 제거.
- problems: `core/problems/reporting/view-binding.ts`가 `AppConnection`을 쓴다. feedback, `problem_codes`는 problems 영역이 지운다.
- S8/annotation(req-1486~1488): 사람 annotation은 지금 shell에 코드가 없다. 새로 만들 것이고 이 목록에 넣지 않았다.

## 확인 못함

- 화면 byte를 내주는 길. 지금은 앱 process의 direct socket `/screens`를 서명 connection으로 읽는다(`runtime/entrypoint/{screens,screen-files}.ts`, shell `app-protocol.ts`). 직접 통로를 지우면 이 길이 어디로 가는지 S5·S2·S6 어디에도 없다. core가 bundle 사본을 내주는지, supervisor가 앱 process를 거쳐 내주는지 정해야 한다.
- core에서 앱 process로 호출을 보내는 transport(기존 supervisor 제어 pipe의 op, 아니면 앱 socket을 core·supervisor 전용으로 남김). 구현 선택으로 보고 위에는 둘 다 열어 두었다.
- 앱 사이 호출에서 write queue 교착. A의 write가 B의 write를 부르는 동안 B의 write가 A의 write를 부르면 두 앱 queue가 서로를 기다린다. 호출 루프 거절(req-0924)은 같은 호출 사슬 안에서만 막는다. S5에 이 경우가 없다.
- rewind drain에 시간 상한이 없다. activation의 drain은 끝나지 않는 호출을 종료 요청 후 강제 종료한다(req-1508). S5 7장 4는 기다린다고만 하고, 11장 3은 write 시간 상한을 두지 않는다고 했다. 오래 도는 write가 rewind를 영원히 막는지 정해야 한다.
- changeset 저장 위치(ledger BLOB 또는 blob store)와 크기·개수 한도. 한 release 안에서는 지우지 않으므로 자란다. changes-by-topic 7장의 "blob-store 남는 쓰임" 질문에 이것이 답이 될 수 있다.
- SQLite session은 PRIMARY KEY가 없는 표를 기록하지 않는다. 그런 표의 변경은 changeset에 안 들어가 rewind에서 조용히 빠진다. S5에 언급이 없고, 잡아 주는 것은 req-0821 app test(core rewind 뒤 DB가 같은지)뿐이다.
- 앱 시작 invocation의 changeset(S5 6장)은 req-0893에 없고, 시작 중 DB를 바꾸는 앱이 지금 있는지도 확인 못함. `operation.kind=data_change`(migration)는 DDL이라 rewind 대상이 아니라고 보았는데 S5에는 명시가 없다.
- `system` 호출자와 `trigger` 종류(activation, restart)가 새 모양에서 어떻게 남는지. S5 5장 표는 trigger 칸을 두지 않았다.
- core가 호출 중 죽었을 때 changeset을 받지 못한 write의 처리. 지금 `restart.ts`는 unknown으로 닫는다. 이 호출 뒤 rewind에서 그 변경이 안 되돌아가는 것을 어떻게 알리는지 정해야 한다.
- rewind 요구가 domain event(Reactor가 반응할 것)를 필요로 하는지. S1 목록 10개에 없다.
- `command` → `app-api` 이름 바꾸기를 코드에서 어디까지 할지, 규모.
- SDK 패키지 이름(`cap-schedule`, `cap-store`)과 project 읽기 capability 이름. architecture.md 이름 규칙을 안 읽었다.
- `sdk/cap-secret`의 `use()`가 요구 문장(secret을 붙인 요청을 lophn에게 맡김)과 얼마나 다른지. 코드상 `use`는 목적지만 보내고 요청 본문이 없다. 전송 쪽(`platform secret.send`)까지는 안 읽었다.
- `core/apps/data`, `core/apps/tickets`, `core/apps/packages`(catalog), `core/apps/releases` 내부, shell의 `feedback.ts`는 이 영역 판정에 필요한 부분만 훑었다.
