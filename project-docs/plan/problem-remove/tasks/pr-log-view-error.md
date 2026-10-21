# pr-log-view-error

앱 화면의 처리되지 않은 오류를 core problems collector 대신 앱 log 줄로 쓴다. shell main이 core 메모리 route `app.log_view_error`로 보내고, core가 supervisor에 넘겨 그 앱 log file에 쓴다(쓰는 쪽은 supervisor 하나다).

- 단위: log (wave 5)
- 선행: pr-log-read, pr-log-exception, pr-issues-ui-main. supervisor 조립과 control 통로를 앞 task들이 고친 뒤이고, `reportIdOf`를 같이 쓰던 shell feedback wiring이 없어진 뒤다.
- 소유(이 task만 고친다):
  - `packages/shell/main/app-frame/view-error.ts`
  - `packages/shell/main/desktop/wiring/app-views.ts`
  - `packages/core/apps/runtime/view-errors.ts` (새 file)
  - `packages/core/apps/runtime/control-protocol.ts`
  - `packages/core/apps/register.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/main/app-supervisor/assembly.ts`
  - `packages/protocol/apps/registry.ts`
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md`의 "정한 것"(잡히지 않은 예외와 화면 오류는 log 줄이 된다), "뼈대 검토에서 정한 것"(preview와 test mode의 오류는 이번에 log에 쓰지 않는다), "lead가 할 일"(wave 4와 5를 같이 land한다. 그 사이 화면 오류가 core에 닿을 길이 없다)
  - 계약 task: `project-docs/plan/problem-remove/tasks/pr-log-contract.md`(`appLogViewError`와 줄 꼴 `view_error <observation> <name>: <message>`), `project-docs/plan/problem-remove/tasks/pr-log-writer.md`(`logFileOf(app)`, `AppLogFile.append`)
  - architecture: `project-docs/architecture/annotation.md`의 "지키는 것" 첫 줄(앱, release, mode는 shell main이 sender view로 정한다. 화면 오류도 같은 원칙이다), `project-docs/architecture/app-call.md`(core와 supervisor의 control 통로)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `core-api`, `app-runtime`, `child-supervision-protocol`; `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/core/apps`, `packages/core/main`, `packages/protocol`
  - skill: `.claude/skills/orchestrate/SKILL.md`의 "막힘과 겪은 함정"(memory handler와 `memoryRoutes`를 둘 다 등록한다. core 기동이 대조한다), `.claude/skills/write-test/SKILL.md`
  - 코드: `packages/shell/main/app-frame/view-error.ts`, `packages/shell/main/desktop/wiring/app-views.ts`의 `createViewErrors` 조립, `packages/shell/main/desktop/core/client.ts`의 `internal`(registry로 route를 찾는다), `packages/core/main/daemon/parent.ts`의 `userOperations`(사람 token의 operation은 route actor에서 나온다), `packages/core/apps/routes.ts`(`callToolHandler` 같은 memory handler 꼴), `packages/core/apps/runtime/supervisor-link.ts`의 `SupervisorChannel.request`, `packages/core/main/daemon/wiring/apps.ts`의 `memory` 목록과 `appsControl.channel`
- 계약:
  - 쓰는 것: `appLogViewError`(`packages/protocol/apps/app-log.ts`, `pr-log-contract`), `logFileOf(app)`·`AppLogFile.append`(`pr-log-writer`), 줄 꼴 `view_error <observation> <name>: <message>`
  - 내놓는 것:
    - core 메모리 route `apps/log_view_error` 등록: protocol registry, apps team `memoryRoutes`, wiring의 memory handler. handler는 supervisor op로 넘기고 `{ written }`을 답한다.
    - supervisor op `append_log`(`packages/core/apps/runtime/control-protocol.ts`의 `SUPERVISOR_OPS`): 입력 `{ app, invocation: null, text }`, 그 앱 `AppLogFile.append`로 쓴다.
    - shell main은 `worker problems/observe-view-error`를 부르지 않는다. 창당 상한(`VIEW_ERRORS_PER_WINDOW`)과 메시지 검사는 그대로 둔다. `reportIdOf`는 쓰는 곳이 없어지면 지운다.

## 할 일

근거는 README "정한 것"의 "잡히지 않은 예외와 화면 오류는 log 줄이 된다"와 `pr-log-contract`의 `appLogViewError`다. 화면 오류는 앱 process가 아니라 shell main에 오므로 core를 지나 supervisor가 쓴다. `appLogViewError`는 `packages/protocol/apps/mod.ts`에서 import한다(lead가 `pr-log-contract` 뒤 `app-log.ts`를 등록했다). 없으면 `app-log.ts`에서 직접 import하고 "등록할 것"에 적는다.

1. protocol registry: `packages/protocol/apps/registry.ts`의 `ROUTES`에 `appLogViewError`(`./app-log.ts`)를 더한다. shell main의 `internal`이 이 목록에서 route를 찾고, actor가 `user`라 사람 token의 operation에 저절로 든다.
2. supervisor op: `packages/core/apps/runtime/control-protocol.ts`에 더한다.
   - `SUPERVISOR_OPS.appendLog = "apps.append_log"`(정한 것 1). 주석: 앱 log file에 줄 하나를 쓴다. 쓰는 쪽은 supervisor 하나다.
   - `appendLogInputSchema = z.strictObject({ app: appId, invocation: z.null(), text: z.string().min(1) })`, `appendLogOutputSchema = z.strictObject({ written: z.boolean() })`.
3. supervisor 조립: `packages/core/main/app-supervisor/assembly.ts`의 `ops`에 `[SUPERVISOR_OPS.appendLog]`를 더한다. 입력을 `parse`로 읽고 `logFileOf(input.app).append({ invocation: null, text: input.text })` 뒤 `{ written: true }`를 답한다. redaction과 300자 자르기는 `append`가 한다.
4. core handler: `packages/core/apps/runtime/view-errors.ts`를 만든다.
   - `viewErrorText(input)`: `view_error <observation> <name>: <message>`. message가 null이면 `view_error <observation> <name>`이다.
   - `viewErrorLogHandler(deps: { request: SupervisorChannel["request"] }): MemoryHandler`. 입력은 dispatch가 route schema로 검사한 뒤 온다(`packages/core/server/dispatch.ts`). `MemoryHandler`는 `packages/core/apps/routes.ts`처럼 `packages/core/server/mod.ts`의 type이다.
     - `mode`가 `preview`면 supervisor에 넘기지 않고 `ok({ written: false })`다(README "preview와 test mode의 오류는 이번에 log에 쓰지 않는다", 정한 것 2).
     - `live`면 `deps.request(SUPERVISOR_OPS.appendLog, { app, invocation: null, text })`의 답을 `appendLogOutputSchema`로 읽어 `{ written }`을 답한다. 답 모양이 틀리면 `unavailable`, supervisor가 없거나 답하지 않으면 그 오류를 그대로 낸다.
     - `release`는 줄에 싣지 않는다(줄 꼴에 없다).
5. core 등록: 둘 다 해야 core가 뜬다.
   - `packages/core/apps/register.ts`의 `memoryRoutes`에 `appLogViewError`를 더한다.
   - `packages/core/main/daemon/wiring/apps.ts`의 `memory` 목록에 `` [`${appLogViewError.resource}/${appLogViewError.method}`, viewErrorLogHandler({ request: (op, payload) => appsControl.channel.request(op, payload) })] ``을 더한다.
6. shell main `packages/shell/main/app-frame/view-error.ts`:
   - 보낼 값을 route 입력 모양으로 바꾼다: `{ app: view.target.app, release: view.binding.release, mode: view.target.mode, observation, name, message }`. `send`는 이 값을 받아 core가 받았으면 true다.
   - 지운다: `ExceptionObservation`, `ViewErrorOrigin`, 옛 `ViewErrorForward`, `reportIdOf`, `CROCKFORD`, deps의 `ids`와 `clock.nowIso`.
   - 그대로: `checkViewError`, 창당 상한(`VIEW_ERRORS_PER_WINDOW`, `VIEW_ERROR_WINDOW_MS`), 글자 상한, main log 줄(넘친 뒤 log를 남기지 않는 것 포함).
   - 주석을 고친다: 머리 주석의 "원문은 collector의 bounded memory로만 간다"는 "core가 그 앱 log에 쓴다"로, 상한 주석의 "core problems/reporting의 REPORTING_LIMITS … 같은 값"은 이유(깨진 page가 오류를 쏟아도 앱 log를 채우지 않게)로, 글자 상한 주석의 "자동 보고 본문 상한"은 "`appLogViewError` 입력 상한과 같은 값"으로.
7. `packages/shell/main/desktop/wiring/app-views.ts`: `createViewErrors`의 `send`가 `session.internal("memory", appLogViewError.resource, appLogViewError.method, forward)`를 부르고 `result.ok`를 돌려준다. `ids`, `clock.nowIso`, `reportIdOf` import를 지운다. `randomBytes`는 view token이 계속 쓴다.
8. 지운 이름(`observe-view-error`, `reportIdOf`, `report_id`, `view_stack_not_collected`, `view_message_missing`)을 주석과 문구에서도 grep한다. preload(`packages/shell/preload/app-tool.ts`)와 IPC channel(`app:view-error`)은 그대로다.

정한 것:
1. op 문자열은 `apps.append_log`(key `appendLog`)다. 이유: 계약의 `append_log`를 다른 op(`apps.logs`, `apps.block`)처럼 `apps.` 아래에 둔다.
2. preview 화면 오류는 core handler가 거른다(`{ written: false }`). 이유: route 입력에 `mode`가 있어 core 한 곳에서 거르면 되고, shell main은 mode와 상관없이 지금처럼 보낸다. `ae-builds`가 preview를 App Engineer에게 열 때 이 한 줄만 바꾸면 된다.

## 끝남

- `deno task check`가 통과한다.
- `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다. memory route와 handler 대조, supervisor op 추가를 core 기동이 본다.
- 위험 test: 없음. 화면 오류의 신원(앱, release, mode)은 지금처럼 shell main이 sender view로 정하고 바꾸지 않는다. 줄의 redaction은 `pr-log-writer`의 `log-file_test.ts`가 본다. 나머지는 전달과 글 만들기라 write-test의 위험 기준에 들지 않는다.
- 등록: `grep -rn "appLogViewError\|appendLog" packages/protocol/apps/registry.ts packages/core/apps/register.ts packages/core/main/daemon/wiring/apps.ts packages/core/main/app-supervisor/assembly.ts packages/shell/main/desktop/wiring/app-views.ts`가 file마다 한 줄 이상이다.
- 남지 않음: `grep -rn "observe-view-error\|reportIdOf\|view_stack_not_collected\|view_message_missing" packages/shell`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). `packages/protocol/apps/mod.ts`가 `app-log.ts`를 내지 않았으면 그 줄
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
