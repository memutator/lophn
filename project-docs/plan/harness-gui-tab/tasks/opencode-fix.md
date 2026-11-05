# opencode-fix

OpenCode adapter가 acp-more 계약을 채운다. 고칠 것은 `audit-opencode.md` §3의 1-7과 §2 명령 분류다:

- 명령 분류(client 명령을 `source: "harness"`와 `opens`로. 이것으로 `/undo`, `/redo`, `/new`가 산다. `models`, `variants`, `agents`, `usage`, `status`, `stats`, `mcps`, `skills`, `export`, `clear`를 더한다)
- 명령 출력(`/status`, `/stats`, `/mcps`, `/export` 경로를 `command_output`으로)
- todo(`todowrite`를 `plan_changed`로. 다시 열 때는 마지막 완료 `todowrite`)
- subagent(자식 session 이벤트를 `child_update`로, subagent detail, 멈추기는 자식 session의 `session.interrupt`)
- 되살리기(`/redo`와 `session.revert.cleared`를 `hidden_restored`로)
- `api.command`의 delivery·첨부
- 사용 한도(`usage.limits`), auto-accept(`toggles`)
- message `origin`(OpenCode message id)과 meta `harness`

녹화는 다시 뜬다(정한 것 13·19). 녹화는 lead가 돌린다.

- 단위: adapter (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/audit-opencode.md` 전부, `opencode.md`(첫 조사)
  - 앞 녹화 원본: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/opencode/`와 README의 scrub 규칙
  - architecture: `project-docs/architecture/harness-gui.md`, `acp.md`
- 계약:
  - 쓰는 것: acp-more의 명령 칸, `command_output`·turn 없는 notice, subagent detail·`child_update`·`stop_child`, `hidden_restored`, `limits`, `toggles`·`set_toggle`, meta `harness`, message `origin`. `HarnessGuiAdapter`·`HarnessGuiRun`(`adapter.ts`, 바꾸지 않는다)
  - 내놓는 것:
    - adapter 표의 `opencode` 칸(이름 그대로)
    - 녹화 script `fixtures/opencode/record.ts`. 원본을 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/opencode-v2/`에 쓰고, model은 `openrouter/deepseek/deepseek-v4.1-flash-1017`이다(`gemini-4-argon`은 쓰지 않는다). scenario는 할 일 12의 목록이다. worker는 돌리지 않고 scenario 목록을 보고한다

## 할 일

약어: `HG/` = `packages/shell/main/extensions/bundled/harness-gui/`, `OC/` = `/home/pyosechang/projects/harness-lab/open-code/open-code-cli/packages/`(OpenCode 소스, 읽기만). 줄 번호는 지금 `HG/opencode.ts`의 것이다(acp-more가 맞춘 뒤 조금 밀린다). 화면이 기대하는 모양은 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/ui-reference.md` §2(명령 출력), §4(subagent), §5(todo), §6(background task)에 있다.

순서: 1-11은 지금 fixture와 test 안에서 손으로 만든 event로 짠다. 12에서 녹화 script를 고치고 **중간 보고**를 한다. lead가 녹화를 돌려 원본 경로를 주면 13을 한다.

1. 명령 목록(`client()` 264, `CLIENT_COMMANDS` 274, `loadMeta`의 `commands` 1354). acp-more가 `source`를 이름만 바꿔 두었다(`builtin`→`app`, `cli`→`harness`). OpenCode 자기 명령은 `app`이 아니라 `harness`다. `app`은 lophn 것이고, harness 내장 명령은 vendor 아이콘을 단다(README 정한 것 16). 아래 표대로 고친다. `opens` 값의 이름은 acp-more가 고정한 것을 쓴다. 아래 열은 뜻만 적었다.

   | name | 별칭 | `opens` | 누가 하나 |
   |---|---|---|---|
   | `new` | `clear` | null | adapter `newSession()`(1691). 같은 탭에 새 session을 연다(정한 것 16) |
   | `undo` | — | null | adapter `rewind(마지막 사람 메시지, true)`(지금 1698) |
   | `redo` | — | null | adapter `api.revertClear`, 할 일 4 |
   | `fork` | — | fork | 화면 → `fork` 입력 |
   | `compact` | — | compact | 화면 → `compact` 입력 |
   | `rename` | — | rename | 화면 → `rename` 입력. `argument_hint: "title"` |
   | `models` | TUI 별칭 | model 고르기 | 화면 model picker |
   | `variants` | TUI 별칭 | effort 고르기 | 화면 |
   | `agents` | `agent`(desktop 이름) | mode 고르기 | 화면 |
   | `usage` | — | usage | 화면(할 일 7의 `limits`) |
   | `status` | — | null | adapter, 할 일 2 |
   | `stats` | — | null | adapter, 할 일 2 |
   | `mcps` | `mcp`(desktop 이름) | null | adapter, 할 일 2 |
   | `skills` | — | null | adapter, 할 일 2 |
   | `export` | — | null | adapter, 할 일 2 |

   - 별칭은 TUI의 그 명령 `slash` 칸에서 그대로 옮긴다(`OC/tui/src/app.tsx` 768-1180, `OC/tui/src/routes/session/index.tsx` 1058-1349).
   - server 명령(`api.commands()` 1288)은 `source: "harness"`, `aliases: []`, `opens: null`, `argument_hint: null`이다. `/api/command`의 칸은 `name`과 `description`뿐이라 출처를 가를 수 없다(`OC/schema/src/command.ts`). 이름이 위 표와 겹치면 표가 이긴다(지금 `clientNames` 걸러내기).
   - skill: `GET /api/skill`(`OC/protocol/src/groups/skill.ts:9`)의 skill 하나가 명령 하나다. `source: "skill"`이고, 이름이 이미 있으면 뺀다. 고르면 `POST /api/experimental/session/:id/skill {id}`(`OC/protocol/src/groups/session.ts:379`)로 보낸다.
   - TUI 전용 명령(`audit-opencode.md` §2 (3))은 목록에 넣지 않는다(지금도 없다).
   - meta `harness: "opencode"`.
2. `runCommand`(1696):
   - 출력은 acp-more의 `command_output {command, text, format: "markdown"}` notice다.
   - `status`: server 판(`api.info()`), 지금 agent와 model, `GET /api/mcp`의 server별 상태를 표 하나로 낸다.
   - `stats`: `GET /api/experimental/session/stats`(`session.ts:146`, 모양 `OC/schema/src/session-stats.ts`). 기간은 TUI `/stats`의 기본값을 쓴다(`OC/tui/src/feature-plugins/system/stats.tsx`).
   - `mcps`: `GET /api/mcp` 목록. 켜고 끄기는 범위 밖이다.
   - `skills`: skill 목록.
   - `export`: `GET /api/experimental/session/:id/export`(`session.ts:206`)의 JSON을 TUI처럼 tmpdir의 `session-<id>.json`에 쓰고(`OC/tui/src/routes/session/index.tsx:1377-1381`) 그 경로를 출력한다. 쓰기는 `OpencodeDeps`(214)에 `writeExport(name, text): Promise<string>`을 더해 인자로 받는다(AGENTS.md "코드": 파일 시스템은 인자).
   - default(server 명령): `api.command(sessionId, {name, text, ...(executing ? {delivery: "queue"} : {})})`다. 도는 중에 보낸 명령은 desktop처럼 줄에 선다(`OC/app/src/composer/submit.ts:567-590`). `run_command`에 첨부 칸이 없어 첨부는 싣지 못한다. 계약 바꾸기 요청으로 보고한다.
   - `createApi`(145)에는 쓰는 endpoint만 더한다: usage limits, session stats, export, mcp 목록, skill 목록, skill 실행.
3. 알림: `info()`(479)를 고친다.
   - turn이 없으면 `turn: null`이다(지금은 새 turn id를 만든다).
   - acp-more의 `level`을 받는다. warning은 `attempt`(494)의 실패, compaction 실패(1194), 재시도(1198), 판 다름(1876)이다. info는 compaction 시작·끝, server 재시작(`RESTART_NOTICE`), "Nothing to undo."다.
   - `runCommand` redo의 "stay hidden in this view" 글은 지운다. 할 일 4가 고친다.
4. redo 되살리기(audit §3-4):
   - `hideFrom`(954)이 만든 hidden id를 돌려주게 하고, `session.revert.staged`(1216)에서 그 id를 둔다.
   - `session.revert.cleared`(1230)가 오면 그 id로 acp-more `hidden_restored {hidden}`을 내고 지운다. TUI가 한 redo도 같은 event로 온다.
   - `session.revert.committed`는 되살리지 않는다. 다음 보내기가 되돌린 것을 확정했다(`sendPrompt` 1611).
5. todo(audit §3-2):
   - `onToolEvent`(991)의 `session.tool.success`에서 `call.name === "todowrite"`이면 `call.input.todos`를 `plan_changed`로 낸다. todo는 `{content, status}`이고 status는 `pending | in_progress | completed | cancelled`다(`OC/app/src/session/composer/todos.ts:3-30`). content가 빈 것은 뺀다.
   - 다시 열 때(`replayMessage` 1470)는 지나간 마지막 완료 todowrite로 한 번 낸다. desktop `sessionTodos`와 같다(server에는 todo 상태가 없다).
6. subagent(audit §3-3, §0 S4):
   - detail: `detailOf("subagent")`(612)와 `endDetail`(1022)의 `call` detail을 acp-more `subagent` detail로 바꾼다. 칸은 `agent = input.agent`, `description = input.description || input.prompt`, `child`, `state`, `model = input.model ?? null`, `last`다.
   - 자식 session 짝짓기: 지금은 `session.created {parentID}`를 끝나지 않은 첫 subagent call에 붙인다(1071-1080). 여럿이 같이 뜨면 틀린 짝이 된다. `session.tool.success`의 `metadata.sessionID`(1032)가 오면 그것으로 고친다. input에 `sessionID`가 있으면 이미 있는 자식에게 이어 말하는 것이다(`OC/core/src/tool/plugin/subagent.ts:41`).
   - 자식 event: 지금 `onChild`(984)는 running 표시만 한다. 부모 event를 옮기는 상태와 함수(turn, writing, calls, seq를 쓰는 `startTurn`·`stream`·`toolStart`·`toolEnd`·`endTurn`)를 자식마다 하나씩 더 만들 수 있게 묶는다. 자식 것의 갱신은 `child_update {child, update}`로 싸서 낸다. 자식의 승인과 질문은 지금처럼 부모에 그린다(1083-1110).
   - `state`는 자식의 `session.execution.*`에서, `last`는 자식의 마지막 글 한 줄에서 온다.
   - 다시 열 때: subagent tool의 `state.metadata.sessionID`로 `allMessages(child)`(1576)를 읽어 같은 replay로 `child_update`를 낸다.
   - 입력: `stop_child {child}` → `api.interrupt(child)`. capability `stop_child`는 true다. `steer_child`는 false다. OpenCode desktop은 자식 session에 composer 대신 상태 줄만 둔다(`OC/app/src/session/composer/subagent-bar.tsx:13-73`).
   - background task: `background: true`로 띄운 subagent(`subagent.ts:46`)는 tool이 바로 끝나고 자식이 계속 돈다.
     - 이 자식을 acp-more `tasks`에 `{id: child, kind: "agent", description, state, started_at, output: null}`로 두고 `tasks_changed`로 낸다.
     - `stop_task {task}` → `api.interrupt(task)`. capability `tasks`는 true다.
     - `running().tasks`(1927)는 이 목록에서 도는 것의 수다(acp-more 계약).
     - OpenCode 2.1.4 server API에는 shell background 목록과 멈추기가 없다. `session.background`(`session.ts:691`)는 도는 tool을 뒤로 돌릴 뿐이다.
7. 사용 한도(audit §3-6):
   - `GET /api/experimental/usage/limits`(`OC/protocol/src/groups/usage.ts:10`, 모양 `OC/schema/src/usage-limits.ts`)를 `usageOf`(1412)가 같이 읽어 `usage.limits`에 둔다. 로그인하지 않았으면 null이 오고 빈 배열이 된다.
   - Go의 `rolling`·`weekly`·`monthly` meter: `used_percent = percent`, `resets_at`은 `resetsAt`(ms)을 ISO로.
   - budget: `used_percent = spent / limit * 100`, `left`는 남은 금액 글.
   - label은 TUI `/usage`를 따른다(`OC/tui/src/component/usage.tsx:29-81`). 못 읽으면 빈 배열이다(사용량은 꾸밈, 1406 주석).
   - `context.parts`는 분해를 모르니 빈 배열이다.
8. auto-accept(audit §1 "자동 승인 토글"):
   - meta `toggles`에 `{id: "auto_accept", label, description, on}` 하나를 두고 `set_toggle`을 받는다. capability `toggles`는 true다.
   - 켜져 있으면 `openApproval`(760)이 카드를 열지 않고 `api.permissionReply(..., {decision: "once"})`만 보낸다. 켜는 순간 열려 있는 카드도 once로 답한다(desktop의 sweep과 같다, `OC/app/src/session/requests/auto-approve.ts:14-45`).
   - `always`와 session 규칙(`api.update {permissions}`)은 보내지 않는다(README 정한 것 12).
   - 값은 이 run의 adapter 상태다. desktop은 client 설정에 두지만 lophn은 저장하지 않는다.
9. tool 본문: acp-more의 tool `body`를 채운다.
   - input은 `session.tool.called`의 `data.input`을 JSON으로, output은 `session.tool.success`의 `content` 글이나 `session.tool.failed`의 error message다.
   - 다시 열 때는 part의 `state.input`과 결과 칸을 쓴다. `!` shell 줄(`shellLine` 1238)도 명령과 출력을 싣는다.
   - 길이 상한은 acp-more가 정한 값이다.
10. message `origin`: 그 CLI 자신의 message id다.
    - 사람 메시지: 보낸 것은 `userQueued`(919)의 `inbox`다. inbox id가 곧 message id다(`rewind`가 이 id를 `revertStage {messageID}`로 쓴다). 다시 연 것은 `replayMessage`의 `item.id`다.
    - 답: `session.text.delta`의 `assistantMessageID`(`stream`의 `messageId`), 다시 연 것은 `item.id`다.
    - fork·new 뒤(`moveTo` 1657)는 session id가 바뀌어 bookmark의 session key도 바뀐다(README 정한 것 17).
    - acp-more가 origin을 `message_taken`에도 싣는지 보고 맞춘다. 사람 메시지는 queued → taken 길로 그려진다.
11. 하지 않는 것(이유):
    - plan 승인 카드: OpenCode에는 plan을 끝내는 tool이 없다(`OC/core/src/tool/plugin/`에 없음). plan agent에서 build로 가는 것은 사람의 mode 바꾸기다. plan subject를 내지 않는다.
    - goal과 role: OpenCode에 없다. meta `goal: null`, `roles: null`이고 capability는 false다.
    - `/undo`가 그 글을 composer로 되돌리기(TUI와 desktop은 한다): 계약에 composer 채우기가 없다. 알려진 미완으로 보고한다.
12. 녹화 script `fixtures/opencode/record.ts`(README 정한 것 13·19):
    - 출력: `ROOT = resolve(".dev-data/adapter-opencode/rec")`(30)를 `--out <dir>` 인자로 바꾼다. 없으면 쓰는 법을 찍고 끝낸다. lead가 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/opencode-v2/`를 준다(worktree는 merge 뒤 지워진다).
    - scenario cwd: `os.tmpdir()` 아래 `mkdtemp` 폴더에서 `git init`하고, scenario가 끝나면 지운다. 이유:
      - OpenCode는 project 뿌리를 git toplevel로 잡는다(`OC/core/src/git.ts:222`).
      - 지난 녹화의 `init`이 task worktree 뿌리에 AGENTS.md·a.txt·b.txt를 쓴 것이 이것 때문이다.
      - `.cache`도 lophn root checkout 안이라 cwd로 쓰지 않는다.
    - model: `MODEL`(33)은 그대로 `openrouter/deepseek/deepseek-v4.1-flash-1017`이고 첫 "/"에서만 자른다(699-701, 지금 그렇다). `gemini-4-argon`은 쓰지 않는다.
    - 영구 규칙: `always` 승인과 session 규칙(`session.update permissions`)은 보내지 않는다(9줄 주석 그대로). 사람의 전역 OpenCode 설정은 건드리지 않는다. ask 규칙은 지금처럼 `OPENCODE_CONFIG_CONTENT` env로만 준다(`ASK_CONFIG` 36).
    - 새 scenario(이름이 곧 fixture file 이름):
      - `command_server`: uncommitted file 하나를 둔 scratch repo에서 `POST session.command {name: "review"}`. 사람 메시지가 template이 펼쳐진 글로 오는지, `/review` 그대로 오는지 본다(audit §2 (2)).
      - `command_queued`: 도는 중에 `session.command`를 `delivery: "queue"`로 보낸다.
      - `todowrite`: todo 셋을 만들고 하나를 끝내라는 prompt.
      - `subagent`(지금 것을 고친다, 598): 자식 session event를 다 받는다(`session.created {parentID}`, 자식 text·tool·execution, `metadata.sessionID`).
      - `subagent_background`: `background: true` subagent 하나. 부모 turn이 끝난 뒤의 자식 execution을 받고, 자식에 `session.interrupt`를 보낸다.
      - `undo_redo`: `revert.stage` → `DELETE revert` → `session.revert.cleared`, 그 뒤 message 목록.
      - `server_reads`(model을 부르지 않는다): `GET` usage limits, session stats, export, `/api/mcp`, `/api/skill`.
    - 지금 scenario(216-637)는 그대로 둔다.
    - 여기까지 하고 **중간 보고**를 한다: scenario 목록과 돌리는 명령 한 줄. lead가 녹화 전에 `opencode --version`을 보고, `RECORDED_OPENCODE_VERSION`(30)과 다르면 알려 준다.
13. fixture와 test:
    - lead가 준 원본에서 test에 필요한 줄만 `fixtures/opencode/<scenario>.jsonl`로 옮긴다. 원본은 commit하지 않는다.
    - scrub은 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/README.md`의 "Scrub" 절을 따른다. scratch 경로 → `/work/<scenario>`, `/home/pyosechang` → `/home/user`, `stderr` 줄은 뺀다. MCP·skill·model 목록은 test가 읽는 칸만 남긴다.
    - 녹화가 2.1.4와 다른 판이면 `RECORDED_OPENCODE_VERSION`을 녹화한 판으로 바꾼다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`opencode_test.ts`, 녹화 fixture로):
  - "auto-accept가 켜져 있으면 permission 요청마다 `once` reply만 나가고, `always` reply와 `session.update permissions`는 나가지 않는다"
  - "`run_command`의 `undo`·`redo`·`new`가 각각 `revert/stage`·`DELETE revert`·`POST /api/session`에 닿고, redo 뒤 undo가 숨긴 메시지가 `hidden_restored`로 같은 자리에 돌아온다". 사람이 찾은 "명령이 아무것도 안 한다"를 두 번째로 고치는 것이다.
- 남지 않음:
  - `grep -n 'source: "builtin"\|source: "cli"\|"stay hidden in this view"' packages/shell/main/extensions/bundled/harness-gui/opencode.ts`가 0줄이다.
  - `grep -n "adapter-opencode/rec" packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/record.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 할 일 12 뒤의 중간 보고에는 scenario 목록과 돌리는 명령만 쓴다.

