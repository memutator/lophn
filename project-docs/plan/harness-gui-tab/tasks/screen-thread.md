# screen-thread

채팅 화면의 대화 쪽이 acp-more 계약을 그리고 보낸다. lophn agent와 harness GUI가 같이 쓰는 화면이다. 사람이 찾은 화면 결함(README 정한 것 14) 가운데 대화 쪽을 고친다:

- `info` notice가 아예 안 그려진다. 명령 출력, compaction, 재시도가 다 사라진다.
- 명령을 고르면 무조건 prompt로 간다.
- `/` palette 순위·묶음·아이콘이 나쁘다.
- harness 아이콘 대신 글자 "C"가 보인다.
- tool 줄을 펼쳐도 입력·출력 본문이 없다(harness).
- plan 승인 카드가 없다.

정한 것 15·16대로 명령 세 갈래(화면 동작은 `opens`만 보고, CLI 명령은 보내고 출력 블록을 그리고, TUI 전용은 숨김), palette, `command_output`·`info` 블록, vendor 얼굴, tool 본문 펼치기, plan 승인 카드를 넣는다. composer dock(todo, subagent, task, 대기열, 켜고 끄기, goal, role, 사용 한도)은 `screen-dock`(wave 6), thread index는 `thread-index`(wave 7)다. 그 자리도 미리 두지 않는다.

- 단위: screen (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/{agent-view.tsx,agent-view.module.css,agent-thread.tsx,agent-view-model.ts,agent-view-model_test.ts,thread-layout.ts,thread-layout_test.ts,use-slash-menu.tsx,use-model-picker.ts}`
  - `packages/shell/renderer/conversation/{agent-tab-source.ts,agent-tab-gui-source.ts,agent-tab-fake-source.ts,agent-tab-fake-commands.ts,agent-tab-fake-models.ts}`
  - `packages/shell/renderer/conversation/{slash-menu,composer,thread,activity,status-view,header,approval-card}/`
  - `packages/shell/renderer/conversation/message-list/agent-turn.tsx`
  - `packages/shell/renderer/parts/avatar/`
  - `packages/shell/renderer/icons/conversation.ts`
  - `packages/design/i18n/catalog/conversation.ts`(여러 task가 key만 더한다)
  - `tools/wireframes/pages/screens/{harness-gui.tsx,conversation.tsx,agent-pages.tsx}`, `tools/wireframes/pages/screens/agent-tab/`, `tools/wireframes/mock/agents-data.ts`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/`:
    - `ui-reference.md` §0(먼저 고칠 것), §1(palette), §2(명령 출력), 부록 A
    - `audit-claude.md` §4 화면, §5.4 B·C
    - 각 `audit-{codex,opencode,omp}.md`의 "adapter·화면에서 고칠 것" 화면 줄
  - `packages/shell/renderer/parts/vendor-icon/vendor-icon.tsx`의 `harnessVendorOf`
  - architecture: `project-docs/architecture/agent-chat.md`, `harness-gui.md`, `acp.md`
  - ui-design skill(바뀌는 화면마다 gallery page)
- 계약:
  - 쓰는 것:
    - acp-more: 명령 칸(`source`, `aliases`, `opens`), `command_output`, `info.level`, `turn` 없는 notice, tool `body`, plan 승인 subject, meta `harness`
    - core-commands가 채우는 lophn 명령의 `opens`(fake source는 같은 값을 손으로 적는다)
  - 내놓는 것:
    - `AgentProfile`에 vendor 얼굴
    - screen-dock과 thread-index가 고칠 `agent-view.tsx`는 지금 꼴대로 둔다(`message-list/thread-scroll.tsx`는 이 task가 고치지 않는다)

## 할 일

줄여 쓴 path: `CV` = `packages/shell/renderer/conversation/`. 이름은 acp-more가 고정한 것을 따른다(아래는 `tasks/acp-more.md`의 이름). 칸 이름이 다르면 acp-more 쪽을 따른다.

1. **info와 명령 출력 줄**(정한 것 14의 첫째 원인. `ui-reference.md` §0-1, §2, §13, §20).
   - 지금: `CV/thread-layout.ts`의 `entryOf`가 notice `info`를 `{kind: "info"}` entry로 만든다(`case "notice"`). 그런데 `CV/agent-thread.tsx`의 `itemsOf` `switch (entry.kind)`에 `case "info"`가 없어 버려진다. 그래서 명령 출력, compaction, 재시도, rate limit 알림이 모든 CLI에서 안 보인다.
   - `CV/agent-tab-source.ts`의 `ThreadInfo`에 `level: "info" | "warning"`을 더한다. 새 entry `ThreadCommandOutput {kind: "command-output", command, text, format, turn}`을 `ThreadEntry`에 더한다. `thread-layout.ts`가 notice `command_output`을 이 entry로 옮긴다.
   - 새 `CV/thread/info-row.tsx`: 회색 한 줄이다. `warning`이면 경고색 `StatusMark`를 붙인다. 3줄이 넘으면 접고 펼친다.
   - 새 `CV/thread/command-output.tsx`:
     - 머리는 `/<command>`와 시각이다.
     - 본문은 `format`대로 그린다. `markdown`이면 `CV/message-list/chat-markdown.tsx`, `preformatted`이면 design `CodeBlock`(`@lophn/ui/reading`)이다.
     - 10줄이 넘으면 접고 [Show more]로 펼친다.
   - `agent-thread.tsx`의 `itemsOf`에 두 case를 더한다. notice `turn`이 null이면(turn 밖 명령 출력) 그 줄은 agent 덩어리에 넣지 않는다. 그래서 `flush()` 뒤 따로 `out.push`하고 "Worked for"가 붙지 않는다. turn이 있으면 지금 `add()`처럼 그 덩어리에 넣는다.
   - turn-end·provider-error는 notice `turn`이 nullable이 되어도 늘 turn이 있다. 그 줄의 type은 acp-more가 맞춘 대로 둔다.
2. **명령 세 갈래**(정한 것 16, `audit-claude.md` §5.1·§5.4 A·B, `audit-codex.md` S2).
   - 지금: `CV/agent-view.tsx`의 `runSlash`가 `command.source === "builtin"`(acp-more 뒤 `"app"`)이면 이름으로 `switch`한다. 모르는 이름은 `return`이라 OpenCode `/undo`·`/redo`·`/new`가 아무 일도 하지 않았다. 나머지는 모두 `run_command`다.
   - 이름 `switch`를 지우고 `command.opens`로 가른다.
     - `opens !== null`: 화면 동작을 한다. CLI에 보내지 않는다.
     - `opens === null`: `run_command`로 보낸다. 출력은 1의 줄로 온다.
     - TUI 전용 명령은 adapter가 목록에서 뺀다(adapter task 몫). 화면은 할 일이 없다.
   - `opens` 값마다 하는 일(값 목록은 acp-more가 고정한 것. 아래는 그 값이 가리키는 화면 동작):

     | 화면 동작 | 하는 일 |
     |---|---|
     | 새 session | 지금 `startNew()`. lophn만 이 값을 낸다. harness의 `/clear`·`/new`는 `opens: null`이고 adapter가 같은 탭에 새 session을 연다 |
     | 이름 바꾸기 | 지금 `rename` 분기(인자를 기다렸다 `act rename`) |
     | archive, compact, fork | 지금 분기 그대로 |
     | mcp, skills | `host.openAgentSettings`(lophn만) |
     | lophn 할당 보기 | `showPermissions()`(lophn `/permissions`) |
     | mode | composer의 mode menu(`CV/composer/session-controls.tsx`의 `ModeMenu`)를 연다. 인자가 mode id면 바로 `set_mode` |
     | model | 인자가 없으면 composer model picker를 연다. 인자가 있으면 `meta.models`에서 id나 label이 맞는 것으로 `set_model`, 없으면 problem 줄 |
     | effort | picker를 effort 축으로 연다. 인자가 있으면 지금 model에 `options.effort`로 `set_model` |
     | status, usage, context | 지금 status layer(`showStatus`, `CV/status-view/status-view.tsx`)를 연다. 한도·context 분해는 screen-dock이 그 안에 더한다 |
     | rewind | 마지막 사람 메시지로 rewind panel을 연다. 대화 줄의 [Rewind to here]와 같은 layer다 |

   - picker와 mode menu는 composer 안 상태다(`CV/use-model-picker.ts`의 `open`, `ModeMenu`의 `open`). composer가 `onCommand`를 부르기 전에 model·effort·mode 동작을 스스로 연다. `AgentComposer`가 받는 slash 실행 함수 앞에서 가로챈다.
   - "session이 있어야 하는 명령"은 이름 표 `SESSION_ONLY`(`CV/agent-view-model.ts`)를 `opens` 값 표로 바꾼다.
   - 인자 받기(`audit-claude.md` §5.4 B): 메뉴에서 고른 명령(클릭, 또는 이름만 친 Enter)이 `argument_hint !== null`이고 인자가 비었으면 실행하지 않는다. 입력칸을 `/<name> `로 바꾸고 기다린다. 다시 Enter를 치면 `CV/use-slash-menu.tsx` `submit`의 `spaced` 길로 빈 인자째 실행된다.
   - 그래서 지금 `rename` 분기의 "인자를 기다림"은 이 규칙 하나로 합친다.
   - `CV/use-slash-menu.tsx`의 `onPick`은 지금 `onRun(entry, "")`로 곧장 실행한다. 이것을 위 규칙으로 바꾼다.
3. **`/` palette 순위·묶음·아이콘**(정한 것 16, `ui-reference.md` §1).
   - 지금:
     - `CV/agent-view-model.ts`의 `slashGroupsOf`는 출처 묶음(`GROUPS`)을 먼저 나누고, 묶음 안은 source 순서다.
     - 설명 단어가 맞아도 이름이 맞은 것과 같은 자격이다. 그래서 `/context`를 쳐도 `context`가 4번째로 나온다.
     - `CV/slash-menu/slash-menu.tsx`의 `iconOf`는 모르는 이름을 모두 렌치(`settingsIcons.tools`)로 그린다.
   - 순위 함수 하나를 `agent-view-model.ts`에 둔다. 낮은 tier가 위다.

     | tier | 조건 |
     |---|---|
     | 0 | 이름 정확 일치 |
     | 1 | 이름 앞부분 일치. 짧은 이름이 위 |
     | 2 | 별칭(`aliases`) 정확 일치나 앞부분 일치 |
     | 3 | 이름 조각(`-` `_` `:`) 앞부분 일치 |
     | 4 | 이름 포함 |
     | 5 | 설명 단어 앞부분 일치 |

     - 같은 tier에서는 출처 순서로 놓는다: `app` → `harness` → `skill` → `plugin`·`mcp` → `custom_user`·`custom_project`. 그다음 이름 순이다.
     - fuzzy는 넣지 않는다.
   - 묶음:
     - query가 비면(`/`만 침) 머리 글이 있는 묶음이다. 순서는 lophn(`app`) → `<Harness 이름>`(`harness`) → Skills → Plugins & MCP → Custom이다.
     - query가 있으면 머리 글 없이 한 목록이다. 줄 오른쪽 끝에 출처 배지를 단다.
     - `SlashMenuState`·`SlashGroupView`(`CV/slash-menu/types.ts`)를 이 두 꼴로 바꾼다. `use-slash-menu.tsx`의 `entriesOf`와 `submit`도 같은 함수를 쓴다.
     - `submit`의 "이름 정확 우선"(`exact`)은 그대로 둔다.
   - harness 묶음 머리: 이름은 `meta.harness`로 `HARNESS_ADAPTERS[...].label`(`packages/protocol/coding-agent/harness-adapter.ts`), 아이콘은 `VendorIcon`(`harnessVendorOf`)이다. `SlashMenu`에 `harness: string | null`을 넘긴다.
   - 아이콘(`iconOf`):

     | 출처 | 아이콘 |
     |---|---|
     | `app` | `opens` 값마다 lucide. `ICONS` 표를 이름 대신 `opens` 값으로 둔다. 더할 것: context=Gauge, usage=Coins, effort=Brain, rewind=History, model=`modelIcons` 계열 |
     | `harness` | 그 harness의 `VendorIcon` |
     | `skill` | Sparkles |
     | `plugin` | `settingsIcons.extensionPackages` |
     | `mcp` | `settingsIcons.providers` |
     | `custom_user` | UserRound |
     | `custom_project` | Folder |

     새 lucide 이름은 `packages/shell/renderer/icons/conversation.ts`에 더한다(화면은 lucide를 직접 들이지 않는다).
   - 줄은 `[아이콘] /name` · 흐린 `argument_hint` · 흐린 설명(truncate) · (query가 있으면) 출처 배지다.
     - 맞은 글자를 굵게 하는 `mark`는 그대로 쓴다.
     - 별칭으로 맞았으면 이름 뒤에 `(alias)`를 흐리게 붙인다.
   - 제목: lophn 내장의 메뉴 제목(`BUILTIN_TITLES`, i18n `conversation.label.slash-title-*`)은 이름 대신 `opens` 값으로 찾는다. harness 명령은 `/name`을 그대로 보인다.
4. **vendor 얼굴**(`ui-reference.md` §0-2, §18).
   - 지금: `CV/agent-tab-gui-source.ts`의 `face`가 `profile: {kind: "initial", text: label.slice(0, 1)}`이다. `CV/message-list/agent-turn.tsx`의 `AgentTurn`이 그것을 `Avatar`로 그린다.
   - 바꿀 곳:
     - `packages/shell/renderer/parts/avatar/avatar.tsx`의 `AvatarProfile`에 `{kind: "vendor", vendor: Vendor}`를 더한다. 그리는 것은 `parts/vendor-icon/vendor-icon.tsx`의 `VendorIcon`이고, 크기는 avatar size에 맞춘다.
     - `CV/agent-tab-source.ts`의 `AgentProfile`에 같은 줄을 더한다.
     - gui source는 `harnessVendorOf(info.harness)`(codex → openai)를 쓴다. undefined면 지금처럼 글자다.
   - header(`CV/header/agent-header.tsx`)와 대화 줄은 같은 `agent.profile`을 읽으니 따로 고칠 것이 없다. 그려지는지만 본다.
5. **tool 본문 펼치기**.
   - 지금: `CV/agent-tab-gui-source.ts`의 `toolCallBody`가 늘 `not_found`라 harness tool 줄을 펼쳐도 비어 있다.
   - `feed.state().items`(숨긴 구간 `hidden.items` 안까지)에서 그 id의 tool item을 찾아 그 `body`의 `input`·`output`을 돌려준다.
     - 값은 `{value: <글>, truncated}`(`ToolCallBodyView`)다.
     - 칸이 null이면 `not_found`다.
     - lophn source(`agent-tab-core-source-bodies.ts`)는 그대로 blob을 읽는다.
   - `CV/activity/tool-line.tsx`의 `inputText`·`outputText`는 `value`가 string이면 `JSON.stringify` 없이 그대로 보인다. 지금은 따옴표와 `\n`이 보인다.
   - `CV/activity/file-edit-card.tsx`의 `readInput`도 같은 source 함수라 따라온다.
6. **plan 승인 카드**(`ui-reference.md` §11, `audit-claude.md` §3-4).
   - `pending.approval.subject.kind === "plan"`이면 `ApprovalCard` 대신 새 `PlanCard`를 둔다.
   - 본문은 plan markdown(`chat-markdown.tsx`)이다. 12줄에서 접고 [Show full plan]으로 펼친다.
   - 주 단추는 `subject.modes`마다 하나다("Approve · {label}"). 맨 오른쪽이 첫 mode다(ui-design: 주 단추는 오른쪽 끝).
   - [Keep planning]은 거절이다. 이유 칸은 `ApprovalCard`의 거절 이유 칸을 재사용한다.
   - 고른 mode는 `decide`에 실린다(acp-more가 정한 칸). `CV/agent-view-model.ts`의 `decideChoiceOf`가 mode를 받게 한다.
   - 결정 뒤 줄(`ApprovalResult`, `approval-card/subject-text.ts`의 `targetOf`·`titleOf`)은 plan이면 "Plan approved · {mode label}" 또는 "Plan not approved"다.
7. **thread-index가 쓸 칸**. `ThreadMessage`(`CV/agent-tab-source.ts`)에 `origin: string | null`을 더한다. `thread-layout.ts`의 `messageEntry`가 message item의 `origin`(acp-more 12)을 옮긴다. 화면은 이 칸을 쓰지 않는다. wave 7 bookmark의 key다.
8. **fake와 gallery**(ui-design skill. 화면이 바뀌면 page가 같이 바뀐다).
   - `CV/agent-tab-fake-commands.ts`를 새 칸(`source`, `aliases`, `opens`)으로 바꾼다.
     - lophn 내장 아홉은 core-commands가 낼 값을 손으로 적는다. 이름과 같은 화면 동작의 `opens`이고, 별칭은 `clear` → `new`다.
     - `CLI_COMMANDS`는 `source: "harness"`다. 하나는 `argument_hint`가 있는 명령, 하나는 `aliases`가 있는 명령으로 둔다.
     - core-commands가 다르게 정하면 merge 뒤 lead가 맞춘다.
   - `CV/agent-tab-fake-source.ts`의 `harness` 장면에 command_output(markdown 하나, preformatted 하나), turn 없는 info 한 줄, warning info 한 줄을 넣는다. 새 장면 `plan-approval`도 둔다(plan subject approval 대기).
   - `tools/wireframes/pages/screens/harness-gui.tsx`는 `SCRIPT`에 `session_changed`(명령 목록, `harness: "claude"`), command_output, tool `body`가 있는 tool 하나를 더한다. page를 더한다:
     - `harness-gui-slash-empty`: `/`만 친 묶음과 Claude 머리
     - `harness-gui-slash-query`: `/con`을 친 한 목록과 출처 배지. `type`으로 친다
     - `harness-gui-command-output`
     - `harness-gui-tool-body`: tool 줄을 `click`으로 펼친 것
     - `harness-gui-plan-card`: 6이 되면
   - lophn 쪽 palette page는 `tools/wireframes/pages/screens/agent-tab/scenes.tsx`에 장면을 둔다. page 줄은 `agent-pages.tsx`에 넣는다.
   - 화면 문구는 `packages/design/i18n/catalog/conversation.ts`에 key로 더한다. 묶음 머리 `slash-group-*`는 새 출처 이름에 맞춰 바꾼다. 옛 `slash-group-cli` 같은 key는 `slash-group-` 앞부분으로 grep해 지운다.
9. 문서: `project-docs/architecture/agent-chat.md`에서 `/` 메뉴와 명령 실행을 다룬 절을 위 규칙(세 갈래, 순위, 묶음)으로 고친다. 이 file은 소유 밖이다. 고칠 문장을 보고의 "넘길 줄"에 적는다(lead가 merge 때 고친다).

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 선다.
- 위험 test(두 번 고친 bug: `/status`에서 MCP가 돈 일, `/context` 순위): `CV/agent-view-model_test.ts` 한 file에 넣는다. 결과는 이렇다.
  - query `context`이면 이름이 같은 `context`가 맨 위다.
  - 이름이 `con`으로 시작하는 둘 중 짧은 것이 위다.
  - 설명에만 `context`가 든 명령은 그 둘 아래다.
  - 이 file은 새로 만든다. 소유 목록에 없는 test file이라 보고에 적는다.
- 남지 않음:
  - `grep -rn '"builtin"\|"cli"' packages/shell/renderer/conversation`이 0줄이다. 명령 출처 literal의 옛 이름이다.
  - `grep -n "case \"rename\"\|case \"new\"" packages/shell/renderer/conversation/agent-view.tsx`가 0줄이다. 화면이 명령 이름을 해석하지 않는다.
  - `grep -n "kind: \"initial\", text: label" packages/shell/renderer/conversation/agent-tab-gui-source.ts`가 0줄이다.
- `npm run wireframes`가 되고, 위 harness-gui page들이 renderer component로 그려진다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 `opens` 값마다 정한 화면 동작 표, `agent-chat.md`에 넣을 문장을 "넘길 줄"에 적는다.
