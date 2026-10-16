# SDK UI kit, design system, 앱 화면 쪽 SDK 구현 목록 (2026-10-15)

기준 코드: main `acfe4cc3`. 본 설계: `requirements/sdk.yaml`(req-1511), `requirements/core-apps.yaml`(req-1487, 1512), `requirements/shell.yaml`(req-1486, 1515), `requirements/core-lophn-agent.yaml`(req-1488), `tmp/changes-by-topic.md`(apps/sdk, apps/agent-context, shell/design-system, shell/workspace, lophn-agent/visuals, 7장), `tmp/notes/removed.md`(1장 "앱 화면 메모", 2장 "앱 화면 상태"), `tmp/docs-review.md`(9장 앱 화면 상태 결정, sdk 절, 2026-10-15 project 결정), `tmp/specs/agent-definition.md`(S4 4장 tool 표, 6장 "넣지 않는 것"), `PRODUCT.md`(6장 범위).

이 영역은 요구가 적다. accepted 요구가 UI kit과 design system에 직접 말하는 줄은 하나도 없다(sdk.yaml의 ui-* 줄은 rejected인 req-0511 하나이고, 그 폐기 이유가 "어떤 package가 있는지는 코드가 정한다"이다. shell.yaml에도 token, component 요구가 없다). 그래서 "정할 수 없는 것"을 아래 "아직 정하지 않은 것"에 따로 모았고, 사람이 판단하도록 "그대로 둘 후보"를 한 절 더 두었다. 두 절은 형식이 정한 여섯 칸 밖에 있다.

## 덜어낼 것

앱 화면 상태(보류)와 agent가 다는 화면 메모(지움)에 걸리는 것이 중심이다. 옛 뜻은 "agent가 앱 화면 context를 읽고 주석 칸에 되쓴다"였고, 사람 원문이 말한 보류 뜻("앱 화면의 attempt, 코드 같은 상태를 operator context로 쉽게 보내는 길을 SDK capability로")과 어긋나 있어 어차피 그대로 쓸 수 없다. 보류를 되살릴 때는 새로 짓는다.

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| SDK 화면 context client(`registerScreenContext`, `registerAnnotationTarget`, view session 상태 type, host port `lophn.screen-context`) | removed.md 1장(앱 화면 메모 지움), 2장(앱 화면 상태 보류), changes-by-topic apps/sdk("화면 상태 client" 뺌) | `packages/sdk/cap-schedule/screen-context.ts`(389줄), 이를 내보내는 `packages/sdk/cap-schedule/mod.ts` 14~23줄, `guide.md`의 해당 절 | `cap-schedule`의 나머지(automation, revert)는 다른 영역 몫. 이 파일만 이 영역 |
| SDK blueprint 도우미 `defineAgentContext`와 안내 | 위와 같음 | `packages/sdk/blueprint/define.ts` 28~46줄, `mod.ts` 34줄, `guide.md`, 시험 `context_test.ts` | blueprint 영역 worker와 겹칠 수 있음 |
| blueprint의 `agent_context` 칸과 `annotation_targets`(key, label, write_command) 선언, `sensitive_paths`, 읽기 command 지정 | 위와 같음. `BLUEPRINT_KEYS`에서도 뺀다 | `packages/protocol/apps/blueprint-types.ts`(`AgentContextDeclaration`, `AnnotationTargetDeclaration`, `Blueprint.agent_context`, `BLUEPRINT_KEYS`), `blueprint-value.ts` 72, 246~334줄, `blueprint-read.ts` 48~58, 119줄, `blueprint.ts`, `mod.ts`, `core/apps/blueprint/{mod,reads}.ts`, `core/apps/runtime/entrypoint/startup.ts` 75줄, template `core/apps/packages/template/app/blueprint.ts.tmpl` 65줄(`agent_context: []`) | blueprint 영역 worker와 겹칠 수 있음. 칸을 지우면 template과 fixture 시험도 따라 고친다 |
| 화면 context 규칙 module(입력 검사, 민감 칸 제거, 요약 2,048 bytes 제한, host port 설치) | 위와 같음 | `packages/core/apps/agent-context/`(`schema.ts`, `redaction.ts`, `host.ts`, `mod.ts`와 시험 둘, 약 800줄) | 통째로 지운다 |
| 화면 context 입출력 schema(`screenContextReadInputSchema`, `appScreenContextSchema`, `annotationWriteInputSchema`, `SUMMARY_MAX_BYTES`) | 위와 같음 | `packages/protocol/apps/agent-context.ts`(79줄)와 `agent-context_test.ts`, `protocol/apps/mod.ts` 17~22줄 export | |
| lophn agent tool `app.screen_context`, `app.annotate`와 그 판정 binding | 위와 같음. S4 4장 tool 표에도 없고 6장이 "앱 화면의 상태는 넣지 않는다"고 한다 | `packages/core/lophn-agent/tools/bundles/app-context.ts`(420줄), `tools/app-toolkit.ts` 85, 433, 504줄의 화면 context 분기, `tools/mod.ts` 88~94줄 export, `tool-judgment/app-context-judgment.ts`(157줄), `tool-judgment/mod.ts` 34줄, 시험 `app-context-toolkit_test.ts`, `tool-judgment/app_context_test.ts` | 앱 command tool 쪽은 그대로(다른 영역) |
| 닫힌 화면 view를 앱 process에 알리는 중계(`apps.view_closed` → `control/view-closed`) | `view-closed`의 목적이 "그 view_session의 context 조회와 주석을 버린다"뿐이다(`shell/main/app-frame/view-closed.ts` 머리 주석) | shell 쪽 `shell/main/app-frame/view-closed.ts`, `shell/main/desktop/main.ts` 68, 399, 428줄 | 이 항목은 호출 사슬 전체: core `core/apps/control.ts` 972~1007줄, `core/apps/register.ts` 210~216줄, `core/apps/runtime/{control-protocol,supervisor-link}.ts`, `runtime/entrypoint/{control,wire,limits}.ts`, `core/main/app-supervisor/assembly.ts` 982~994줄, `protocol/apps/channel.ts` 241~256줄, `channel-values.ts` 19줄, `registry.ts`. `protocol/apps/direct-socket.ts` 130줄은 직접 통로 폐기로 다른 영역도 지운다 |
| agent prompt의 앱 패널 탭 줄에 싣는 `view_session`과 shell 쪽 앱 패널 view 참조(`appView`, `panelSession`) | S4 6장 "넣지 않는 것: 앱 화면의 상태" | `packages/core/lophn-agent/prompt-assembly/turn-context.ts` 59줄, `packages/shell/main/workspace/app-view-context.ts`(전체)와 시험, `shell/main/workspace/current-view.ts` 118~190줄의 `app_view` | 현재 보는 탭 정보를 prompt에 주는 것 전체가 남는지는 lophn agent prompt 영역이 정한다. 여기서는 앱 화면 상태에 쓰이던 부분만 |
| 앱 화면 주소에 붙이는 `view_session` query | 화면이 자기 view_session을 알아 context를 등록하던 길 | `packages/shell/main/app-frame/app-protocol.ts` 152~170줄 `appEntryUrl` | view_session을 다른 데(제보 첨부 등)서 쓰는지 확인 못함. 쓰면 query만 남기고 설명을 고친다 |
| `visual.prepare_document` tool(시각 블록을 html 문서 본문으로 준비) | S4 9장(`document.*` 지움, 문서는 디스크 파일). 이 tool의 출력은 `document.create`, `document.save_version`에 넘기는 것뿐이다 | `packages/core/lophn-agent/tools/bundles/visual.ts`의 `visualPrepareDocumentTool`, `bundles/visual-view.ts`의 준비 읽기, `tools/visuals/work.ts`의 `prepareVisualDocument`·`escapeHtml`·`windowText`, `agents/role-caps.ts` 123, 159, 182줄, 시험 | 블록 자체의 MVP 여부와 별개로 문서 판이 없어져 죽는다 |
| SDK UI의 `DocumentAddress`(문서 주소 표시와 복사) | removed.md 1장 "문서 주소 체계(addressing)" | `packages/sdk/ui-reading/document-address.tsx`, `mod.ts` 3~6줄, `guide.md` 13, 32~41, 65~76줄, `examples/weekly-report.tsx`, 시험 `weekly-report_test.tsx`, wording `common.button.copy-address`(`design/wording/en.ts` 421, `placeholders.ts` 424) | 쓰는 곳은 이 예제뿐. 예제는 주소 없이 다시 쓴다 |

## 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| `useCommand`·`CommandSpec`·guide·예제·시험에서 사람 확인(`confirm`) 개념 빼기 | `CommandSpec = Pick<CommandDeclaration, "key" \| "label" \| "confirm">` → `confirm` 없는 `key`·`label`. `AppBridge` 주석("confirm command의 사람 확인은 lophn이 호출 안에서 받는다")과 실패 code 예(`forbidden: confirmation was declined`) 정리. `@lophn/blueprint` type 의존은 `confirm`이 사라지면 `key`·`label`만 쓰므로 유지할지 줄일지 정한다 | changes-by-topic apps/blueprint("confirm 칸" 뺌), changes.md 3장("사람 확인이 필요한 app-api와 confirm marker" 지움, req-0708 폐기). approval 결정은 grant 때 몰아서 하고 실행 때는 묻지 않는다 | `packages/sdk/ui-action/use-command.ts`, `mod.ts` 1~2줄, `guide.md` 5~8, 20~26, 45, 56, 60~62줄, `examples/order-actions.tsx`(confirm false/true 버튼 둘), 시험 `order-actions_test.tsx` 31~98줄 |
| 시각 블록 출처 `document`(문서 id, 판 id, section)를 새 문서 모델에 맞추기 | 블록이 남는다면: `{document: doc_…, version: ver_…}` → 디스크 파일 경로(와 읽은 시점) 참조. 읽은 판을 run마다 대조하는 `reads.has(run, document, version)`도 같이 | removed.md 1장(문서 판, 주소 지움), req-0001(문서 = 디스크 파일). 블록이 MVP 밖이면 이 항목은 통째로 덜어낼 것으로 옮긴다 | `packages/protocol/lophn-agent/visual-source.ts`(`document` 출처), `core/lophn-agent/tools/bundles/visual.ts` `verifySources`, `tools/bundles/read-log.ts` 쪽 ReadLog, `tools/visuals/blocks.ts`의 `sourceLinks`, shell `renderer/workspace/visuals/registry.ts` 135~274줄 |
| 앱 view 열기 입력에 project 더하기 | `appViewOpenSchema {app, mode, release?, screen, size, card?}` → project(선택)를 더하고 열 때 view에 묶는다. project 안에서 열면 그 project, 앱 place에서는 화면 안에서 고른 project | req-1515, 1513(app-api 호출에 project를 넣는 것은 core, 다른 영역) | `packages/protocol/shell/app-frame.ts` 105~117줄과 `appFrameViewStateSchema`(80~97줄), `packages/shell/main/app-frame/registry.ts`, `shell/ipc/app-frame.ts` |
| 시험 이름과 안내, 주석에 붙은 옛 요구 ID 지우기(`apps/sdk#R19`, `shell/design-system#R41` 꼴) | 시험 이름과 주석에서 요구 ID를 뺀다. 이름은 동작을 말하게 한다 | `AGENTS.md` 코드 절("테스트 이름과 코드 주석에 요구 ID를 넣지 않는다"), 옛 ID는 새 요구 번호(req-NNNN)와 대응하지 않는다 | `packages/design` 300곳(파일 65개), `packages/sdk/ui-*`·`tokens` 75곳(파일 34개) 합 375곳. 많이 나오는 것: `apps/sdk#R38` 27, `shell/design-system#R41` 23, `apps/sdk#R16` 22, `shell/design-system#R33` 21. 전수 개수는 `grep -rn "#R[0-9]"` |

## 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| SDK project 목록 client | 앱이 lophn project의 ID, 이름, 목적을 읽는 typed client. 읽기만 한다(보관된 project도 앱 data는 남는다). 앱이 project ID를 data에 남기고 lophn에서 다시 찾는다 | req-1511. 지금 `packages/sdk`에는 project를 다루는 코드가 없다(`grep project` 결과 `format-document` 한 곳뿐이고 그것도 지울 것) | `packages/sdk` 아래 새 package 또는 기존 cap의 일부(이름은 "아직 정하지 않은 것" 4). 앱 process가 core를 부르는 길은 `cap-store/host.ts`, `cap-net/host.ts`의 host port 꼴을 따른다. core 쪽 route는 다른 영역(app runtime, projects) |
| SDK component가 그린 요소에 component 이름을 싣기 | `Button`, `Card` 같은 SDK component가 DOM 요소에 자기 이름을 표시(예: data 속성)해, 사람이 고른 요소에서 "어느 SDK component인가"를 읽을 수 있게 한다 | req-1487("SDK component로 그린 요소를 고르면 그 component 이름이 담긴다"). 지금 `packages/design/components`, `sdk/ui-*`에는 그런 표시가 없다(`data-component` 같은 속성 grep 0건) | `packages/design/components/shared.ts`와 각 component. ui-* 열은 design을 다시 내보내므로 design 한 곳에서 한다. ui-layout, ui-filter, ui-overlay처럼 SDK 안에서 직접 그리는 component(`app-shell.tsx`, `filter-bar.tsx`, `toast-queue.tsx` 등)도 포함 |
| 그린 요소의 앱 source 위치(파일과 줄) 얻는 길 | 요소를 그린 JSX가 앱 source의 어느 파일 몇째 줄인지 annotation에 담는다 | req-1487. 방식이 정해지지 않았다("아직 정하지 않은 것" 3). 재료는 있다: release의 ui build가 external source map을 bundle에 담는다 | `packages/core/apps/releases/ui-build/build.ts` 100~140줄(`sourcemap: "external"`)과 template `scripts/build-ui.ts.tmpl`(개발 build는 `minify: true`, source map 없음, `NODE_ENV=production`) |
| annotation 값의 모양(메모, 고른 요소 또는 영역의 screenshot, component 이름, source 파일과 줄, 앱 release, 화면 위치) | 한 annotation이 담는 것을 protocol 값으로 정한다. 여럿을 모아 한 번에 보내는 묶음 | req-1487, 1486, 1488. spec은 없다 | `packages/protocol/apps` 또는 `protocol/shell`(어느 쪽인지는 사람이 정할 일). 지금 `annotation` 낱말은 위의 "agent가 다는 주석"뿐이고 이것과 반대 방향이다 |
| annotation을 App Engineer session 메시지와 ticket 근거로 넘기기 | 보낸 annotation이 그 앱의 App Engineer session에 메모와 screenshot으로 들어가고, 그 요청으로 만든 ticket 근거에 붙어 coding agent가 CLI로 읽는다 | req-1488 | 다른 영역(agent call, ticket, coding agent CLI)에 넘긴다. 아래 "다른 영역에 넘긴 것" |

## UI 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 시각 블록의 [Save as document] 단추, 요청 진행 표시(`SaveState`), 저장된 고정 문서 링크 | 문서 판과 `document.*` tool이 없어진다. 문서는 디스크 파일이라 agent가 file tool로 쓴다(S4 9장) | `packages/shell/renderer/workspace/visuals/block-frame.tsx`(`SaveState`, `SaveRequest`, `VisualHost.save`), `document-block.tsx`(`DocumentLink`), wording `conversation.body.save-visual-request`, `conversation.button.save-visual`, `conversation.label.visual-saved`, `visual-document-unavailable`, `conversation.notice.visual-save-*`, `visual-not-saved`(`design/wording/en.ts` 1071, 1119, 1241, 1248, 1296~1302줄) | 블록 자체가 남아도 이 단추는 `visual.prepare_document`와 같이 죽는다. 대화 쪽 연결: `renderer/conversation/agent-view.tsx`(`SaveRequest`), `drafts.ts` 128줄 `isSaveRequest`, `agent-view-model.ts`, `agent-thread.tsx`(문서로 남기기 요청을 보내는 길) |

## UI 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| `CommandButton`의 확인 표시 빼기 | `confirm`이면 방패 아이콘, hover 문구("lophn asks you before this runs."), 기다리는 동안 "Waiting for your confirmation." → 모두 없애고 pending(시계 아이콘, `aria-busy`)과 실패 문구만 남긴다. `data-confirm` 속성도 지운다 | 위 "고칠 것" 첫 항목과 같은 근거 | `packages/sdk/ui-action/command-button.tsx`(`ShieldCheck`, `Tooltip`, `data-confirm`, `common.notice.asks-first`·`waiting-confirmation` 쓰는 곳), wording `en.ts` 518~520줄, `placeholders.ts` 549~551줄(다른 곳에서 쓰는지 확인 못함. shell confirmation 화면이 쓰면 남긴다), `action.module.css` |
| 앱 view 위에서 project 맥락이 보이는지 | 앱 화면 chrome이 어느 project로 열렸는지를 보이는 곳이 필요한지 | req-1515 | 위치만 적는다: `packages/shell/renderer/app-frame/view-chrome.tsx`, `app-bar.tsx`. 필요한지는 "아직 정하지 않은 것" 4 |

## UI 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| 앱 화면의 annotate mode | 앱 화면 위에서 mode를 켜고 요소를 클릭하거나 영역을 끌어 고르고, 그 위에 메모 칸이 붙고, annotation을 모아 한 번에 보낸다. 고른 요소·영역의 screenshot을 뜬다(main에서 view를 capture) | req-1486(shell), 1487. 지금 shell에 annotate 코드는 없다(`annotat` grep 결과가 agent-context 쪽뿐) | `packages/shell/renderer/app-frame/`(view-chrome, embedded-view)과 `shell/main/app-frame/`(view capture, 요소 선택을 앱 view 안 script로 하는 길). shell UI 영역 worker와 겹칠 수 있음 |
| 앱 place에서 앱 화면 안에 project 고르기 | 앱 place에서 연 앱 화면이 project를 정하지 못한 상태일 때 화면 안에서 project를 고른다. 목록은 core에서 받는다 | req-1515("앱 place에서 열면 앱 화면 안에서 project를 고른다") | `packages/shell/renderer/app-frame/app-space.tsx`. 고르는 UI가 shell 쪽 component인지 SDK UI component인지는 "아직 정하지 않은 것" 4 |
| annotation 모아 보내기 목록 | 모은 annotation을 보내기 전에 보고 지우고 한 번에 보내는 작은 화면 | req-1486("여러 annotation을 모아 한 번에 보낸다") | annotate mode와 같은 곳 |

## 아직 정하지 않은 것

요구나 spec이 없어 판정하지 않은 것이다. 각각 지금 코드가 무엇을 하는지와 추천을 적는다.

1. **SDK UI kit과 design system의 요구가 없다.** 7장 "sdk UI kit"이 이 일이다. 지금 `packages/sdk/ui-*` 열 개(action, chart, control, filter, layout, overlay, reading, stat, state, table)와 `tokens`가 있고, 대부분 `packages/design/components`를 다시 내보내는 얇은 입구다(`ui-control`, `ui-layout`, `ui-overlay`, `ui-stat`, `ui-state`, `ui-table`, `ui-reading`). 직접 그리는 것은 `ui-layout`(`AppShell`, `Grid`, `Sidebar`), `ui-filter`(필터 3종), `ui-overlay`(`ToastProvider`), `ui-state`(`AppErrorBoundary`, `ReadState`), `ui-action`(`CommandButton`)뿐이다. template 앱은 `ui-control`, `ui-layout`, `ui-state` 셋을 고정 의존으로 쓴다. 추천: 요구는 만들지 않고 코드를 "그대로 둘 후보"로 둔다. MVP 범위에 SDK UI가 들어 있는지부터 사람이 정한다.
2. **시각 블록(표, 차트, 도표, 앱 카드)이 MVP에 남는지.** 문서 안의 말이 엇갈린다(아래 "문서끼리 어긋난 것"). 남기면: 위의 출처 `document` 고치기와 [Save as document] 제거만 하고 나머지는 그대로. 빼면: 아래가 통째로 지워진다.
   - 규모: `packages/protocol/lophn-agent/visuals.ts`·`visual-source.ts`·`visual-specs.ts`(약 270줄)와 시험, `core/lophn-agent/tools/visuals/`(8개 파일, 시험 포함 약 2,200줄), `tools/bundles/visual.ts`·`visual-view.ts`, `session/message-body.ts` 170줄과 `message-commands.ts` 403줄의 `checkVisualContent`, `agents/role-caps.ts`의 `visual.show/read/prepare_document`(121~123, 157~159, 180~182줄), `tool-judgment/builtin-binding.ts` 145줄, `shell/renderer/workspace/visuals/`(파일 13개, 시험·testdata 포함 약 3,000줄), `protocol/shell/app-frame.ts`의 `appViewCardSchema`, `shell/main/app-frame/registry.ts` 269줄의 card 크기, wording `conversation.*visual*` 24개 key.
   - S4 4장 tool 표에는 `visual.*`가 없다(자원별 tool 표와 role별 쓰기 tool 표 어느 쪽에도 없다). 새 설계의 tool 이름 꼴(`<자원>.<동사>`)에도 맞지 않는다(`visual.show`는 자원 하나 동사 하나로 보이나 효과가 session 출력 기록이다).
   - 빼더라도 `ui-chart`와 `packages/design/chart`는 앱 화면이 쓰므로 남는다. 시각 블록 전용인 것은 `shell/renderer/workspace/visuals/chart-plan.ts`와 `chart-block.tsx`뿐이다.
   - 추천: PRODUCT.md 6장 "채팅 안에서 앱의 부품을 가져다 쓰는 데까지"가 MVP이므로 앱 카드(`app_card`)는 남기고, agent가 만드는 표·차트·도표 블록은 MVP 밖으로 본다. 단 사람 확인이 필요하다.
3. **annotation의 source 위치를 어떻게 얻는가.** component 이름은 SDK component가 표시하면 된다. 그러나 "그 component를 쓴 앱 코드의 파일과 줄"은 방식이 갈린다. (가) JSX 개발 transform(`jsxDEV`의 `__source`)을 release build에서 켜고 요소마다 위치를 표시. 단점: bundle이 커지고 `NODE_ENV=production`과 `minify`를 바꿔야 한다. (나) 요소 → bundle 안 위치를 얻어 release에 든 external source map으로 core나 shell이 원래 위치로 푼다. 단점: 요소에서 bundle 위치를 얻는 길이 React 내부(fiber)에 기댄다. (다) esbuild plugin이 앱 source의 SDK component 사용 지점에 위치 prop을 넣는다. 지금 build는 `packages/core/apps/releases/ui-build/build.ts`(release, source map 있음)와 template `scripts/build-ui.ts.tmpl`(개발, source map 없음) 둘로 나뉜다. 추천: (나). 이미 source map을 bundle에 담고 있고 problems의 오류 위치가 같은 재료를 쓴다.
4. **앱 화면이 자기 project를 아는 길과 그 UI.** req-1511은 "화면을 project마다 나눌 수 있다"고만 한다. req-1515는 shell이 project를 정해 연다고 한다. 앱 화면 코드가 어느 project로 열렸는지 읽는 길(예: view 시작 때 주는 값, SDK client의 `current()`), project 고르기 component를 SDK UI에 둘지, 이름을 `cap-*`로 할지 `ui-*`로 할지가 정해지지 않았다. 추천: 목록 읽기는 `cap-project` 꼴의 client 하나, "현재 project"는 같은 client가 view bridge(`lophnApp`)에서 읽는다. 고르는 UI는 shell(앱 place)이 맡고 SDK UI에는 두지 않는다.
5. **`@me/` 사용자 package와 SDK UI의 관계.** tmp-review.md 485줄의 lead 추천("앱 안에서 token 바꾸기와 부품을 복사해 `@me/` package로 만들어 고치기")이 사람 확인 없이 남아 있다. PRODUCT.md의 "앱의 부품"이 앱 카드를 말하는지 사용자 package의 UI 부품을 말하는지 문서로는 가릴 수 없다. req-1001~1009(사용자 package)는 UI kit을 말하지 않는다.
6. **보류한 앱 화면 상태의 되살림 모양.** 사람 원문은 "앱 renderer가 가진 상태(attempt 번호, 그 attempt의 code, 문제)를 operator context로 쉽게 보내는 길을 SDK capability로 열어 두어 coding agent가 앱을 개발하기 쉽게" 하는 것이다. 지금 코드는 그 뜻이 아니라 "agent가 화면을 읽고 주석을 되쓴다"로 지어졌다. 되살릴 때까지 위 "덜어낼 것"만 하고 새 설계는 하지 않는다.

## 그대로 둘 후보

사람이 판단할 수 있도록 지금 코드가 무엇을 하는지만 적는다. 위 "아직 정하지 않은 것" 1이 정해지면 바뀔 수 있다.

| 후보 | 지금 하는 일 | 근거 |
|---|---|---|
| `packages/sdk/ui-control`, `ui-layout`, `ui-overlay`, `ui-stat`, `ui-table`, `ui-filter` | 버튼·입력·선택, 앱 shell·탭·grid·카드·페이지 틀, tooltip·메뉴·dialog·toast·palette, 수치 tile, 정렬·page 표, 기간·다중 선택·검색 filter. 대부분 design component를 다시 내보내고 container 폭에 반응한다 | removed.md, changes에 지운다는 줄이 없다. shell/design-system은 changes-by-topic에서 "그대로" |
| `packages/sdk/ui-state` | loading·empty·error·freshness 표시와 `AppErrorBoundary`(render 오류를 DOM event `lophn:render-error`로 앱 preload에 넘겨 problems가 받는다) | problems의 "처리되지 않은 오류 자동 수집"(req-0110)이 남는다 |
| `packages/sdk/ui-chart`와 `packages/design/chart` | 선·막대·분포·산점 차트와 node·edge 도표. d3-scale·d3-shape로 계산하고 React SVG로 그린다. 앱 화면이 쓴다 | 위 2의 어느 쪽이든 앱 화면 쪽은 남는다 |
| `packages/sdk/ui-reading` 중 `Markdown`, `Toc`, `CodeBlock`, `ReadingFrame` | Markdown·목차·code block 표시. raw HTML은 실행하지 않는다. `parseMarkdown`이 목차를 뽑는 쪽은 contexts의 md 파서(req-1484, 1485)와 따로 있는 UI 파서라 합칠지는 projects 영역이 본다 | `DocumentAddress`만 덜어낸다 |
| `packages/sdk/ui-action`의 호출 로직(`useCommand`, `appBridge`, pending·실패 code) | `lophnApp.call` 하나로만 command를 부르고 pending·결과·실패를 둔다 | confirm 부분만 고친다. project는 main·core가 넣으므로 이 코드는 project를 모른다 |
| `packages/sdk/tokens`와 `packages/design`의 tokens·theme·generate·`generated/`·style-check·`base.css`·fonts | token 값과 CSS 변수 생성, 색·간격·글꼴, 규칙 검사 | shell/design-system은 "새 요구 없음, 그대로" |
| `packages/design/components` 나머지(button, card, dialog, menu, palette, popover, sheet, tabs, toast, tooltip, tree, table, data-table, avatar, chip, status-mark, skeleton, empty/error state, stale-note, stat-tile, field, input, select, switch, textarea, checkbox, kbd, list, page-frames, copy-button, icon) | lophn 화면과 앱이 같이 쓰는 component | 위와 같음 |
| `packages/design/components/author-mark`(`AuthorMark`) | agent가 쓴 내용에 붙이는 작은 작성자 표식 | `shell`, `sdk`의 비시험 코드에서 쓰는 곳이 없다(grep 0건). 그대로 두면 죽은 component다. 지울지는 사람이 정한다 |
| `packages/design/reading/diff-view`와 `components`의 `DiffMark` | 줄 diff 표시. `DiffView`는 `shell/renderer/editor/conflict/conflict-view.tsx`, `DiffMark`는 confirmation 화면과 editor compare가 쓴다 | 쓰는 쪽(editor 충돌, 확인 창)이 남는지는 documents, approvals 영역이 정한다 |
| `packages/design/wording`(catalog 도구: `check`, `scan`, `generate`, `format`) | en 문구의 key 타입과 규칙 검사 | shell/wording "새 요구 없음". 문구 내용은 각 영역이 고친다 |

## 문서끼리 어긋난 것

- **시각 블록.** `tmp/changes-by-topic.md` 123줄(shell/workspace)은 "시각 블록(MVP 밖)"이라 하고, 146줄(lophn-agent/visuals)은 "새 요구 없음. 표·차트·앱 카드 블록"으로 그대로 둔 항목에 넣고, 165줄(7장)은 "MVP에 남는지"를 열어 둔다. `PRODUCT.md` 6장은 "채팅 안에서 앱의 부품을 가져다 쓰는 데까지"만 말한다. S4(`tmp/specs/agent-definition.md`) 4장 tool 표에는 `visual.*`가 하나도 없는데 지울 목록(9장)에도 없다. 지금 코드에는 `visual.show/read/prepare_document`가 있다.
- **`apps/sdk` 줄과 정본.** `changes-by-topic.md` 99줄은 "cap-save, format, cap-schedule, 화면 상태 client"를 뺀다고 쓰는데, 같은 파일 55줄(apps/agent-context)은 앱 화면 상태를 "보류"로, 화면 메모를 "지움"으로 나눈다. 코드로는 같은 파일(`screen-context.ts`)이라 둘 다 지운다. 이 목록은 둘을 같이 덜어낸 것으로 센다.
- **`tmp/changes.md` 72줄**은 "앱 화면 메모 | 위치 미확인"인데 실제 위치는 위 "덜어낼 것"에 적은 곳이다(SDK `cap-schedule/screen-context.ts`, `core/apps/agent-context/`, lophn agent tool 둘, blueprint `agent_context`).
- **annotation 낱말.** `removed.md` 1장은 agent가 다는 "annotation"을 지운 것으로 두고 사람이 다는 annotation(req-1486~1488)은 반대 방향이라 남긴다고 적는다. 그런데 지금 코드의 `annotation`(`annotation_targets`, `app.annotate`, `registerAnnotationTarget`)은 모두 지운 쪽이다. 새로 짓는 annotation과 이름이 부딪히므로 지운 뒤에 새 이름을 쓴다.
- **req-1511의 "화면을 project마다 나눈다"** 는 요구가 어떤 UI를 말하는지 정하지 않았다(위 4).

## 다른 영역에 넘긴 것

- annotation 전달(App Engineer session 메시지, ticket 근거, coding agent CLI가 읽기)과 ticket 근거 모양: agent call, tickets, coding agent 영역.
- annotate mode의 shell 쪽 세부(앱 view 안에서 요소 고르기, 영역 끌기, screenshot capture): shell UI 영역. 이 목록에는 위 UI 새로 만들 것에 올렸지만 겹친다.
- core가 project 범위 app-api 호출에 project를 넣는 것(req-1512~1514), 앱이 project 목록을 읽는 core route: app runtime, apps, projects 영역.
- blueprint의 `agent_context`·`confirm`·`revert` 칸 정리와 blueprint 도우미: blueprint, release 영역(이 목록에는 agent_context만 올렸다).
- `packages/sdk/cap-schedule`의 나머지(automation 등록, `revert.ts`)와 `cap-save`, `format-document`: SDK capability 영역.
- 시각 블록이 쓰는 문서 판 reads, 문서 id: documents 영역(`shell/renderer/app-frame/document-view-slot.tsx`와 `documentViewOpenSchema`의 `version`도 같은 부류).
- `packages/design/wording/en.ts`에 남은 옛 role 이름(`Context Engineer`가 `contexts.*` key 12곳 이상), 문서 판·tracking 문구: shell/wording 영역.
- `shell/renderer/editor/conflict`의 `DiffView` 쓰임: editor, documents 영역.

## 확인 못함

- `view_session`을 agent-context 밖에서 쓰는 곳(제보 첨부, screenshot 등). 쓰면 위 "앱 화면 주소의 view_session query"는 남긴다.
- wording key `common.notice.asks-first`, `common.notice.waiting-confirmation`을 shell confirmation 화면이 쓰는지.
- `design/components/tree`, `sheet`, `chip`이 어느 화면에서 쓰이는지는 각각 비시험 파일 1곳이라는 것만 봤고 쓰임은 확인 못함. 죽은 component인지 판단하지 않았다.
- 시험 파일의 개수와 줄 수: 지울 항목마다 따로 세지 않았다. `core/apps/agent-context` 폴더와 화면 context tool 둘의 시험만 위에 이름을 적었다.
- 시각 블록 파일 줄 수는 `wc -l`로 센 값(core visuals 폴더 2,218줄은 시험 포함, shell visuals 폴더는 `testdata` 빼고 약 2,700줄)이고 wording key 24개는 `grep "conversation.*visual"` 수.
- 개발 build(`scripts/build-ui.ts.tmpl`)와 release build(`ui-build/build.ts`)가 같은 SDK component 결과를 내는지.
