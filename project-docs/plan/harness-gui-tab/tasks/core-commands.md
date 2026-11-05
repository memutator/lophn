# core-commands

lophn agent의 `/` 명령이 acp-more의 새 명령 칸을 채운다. 내장 명령은 `source: "app"`과 `opens`를 받고, skill은 출처에 맞는 `source`를 받고, 별칭이 붙는다. screen-thread가 화면의 명령 이름 switch(`agent-view.tsx`의 `source === "builtin"` 분기)를 지워도 lophn agent의 내장 아홉(`new, rename, archive, compact, fork, mcp, skills, permissions, status`)은 그대로 돈다(정한 것 5: lophn agent의 동작은 그대로). 정한 것 16의 화면 동작 중 lophn agent가 이미 가진 것(model, effort, rewind, usage·context)도 명령 목록에 넣고, `/clear`는 `new`의 별칭으로 둔다.

- 단위: acp (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/commands.ts`
  - `packages/core/lophn-agent/commands/{registry.ts,reads.ts}`
  - `packages/core/main/daemon/wiring/{acp-build.ts,acp-build_test.ts,acp-send.ts,acp-send_test.ts}`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/ui-reference.md` §1(묶음 "lophn", 순위의 출처 순서), `audit-claude.md` §5.4 A(내장 목록과 별칭)
  - 화면의 지금 분기: `packages/shell/renderer/conversation/agent-view.tsx`의 `runSlash`(내장 아홉이 하는 일. 읽기만)
  - architecture: `project-docs/architecture/acp.md`, `agent-chat.md`
- 계약:
  - 쓰는 것: acp-more의 `AcpCommand`(`source`, `aliases`, `opens`), `ListCommands`(`commandsList`), `readSessionMeta`와 draft meta(`acp-build.ts`)
  - 내놓는 것: lophn session meta와 draft meta의 `commands`가 새 칸을 채운다. 내장마다 어느 `opens`인지는 이 task가 정해 보고한다. screen-thread의 fake source는 같은 값을 손으로 적는다.

## 할 일

근거: README 정한 것 5(lophn agent의 동작은 그대로), 16(화면은 `opens`만 본다), `project-docs/architecture/acp.md`(lophn core가 ACP 입력을 지금 route로 옮긴다). acp-more가 `AcpCommand`에 `source: "app" | …`, `aliases`, `opens`를 더했고 lophn 내장은 아직 `opens: null`·`aliases: []`로 낸다(`acp-build.ts`의 `commandsOf`). 이 task가 그 값을 채운다.

lophn 명령의 표(정한 것. 순서가 메뉴 순서다. `ui-reference.md` §1 "lophn" 묶음의 순서 model → permissions → status → rewind → fork → rename → compact를 따르고 `/new`를 맨 앞에 둔다):

| 이름 | `opens` | `aliases` | `argument_hint` | session이 있어야 | 지금 |
|---|---|---|---|---|---|
| `new` | `new` | `clear` | null | 아니 | 있음 |
| `model` | `model` | — | null | 아니 | 새로(화면에 model picker가 있다) |
| `effort` | `effort` | — | null | 아니 | 새로(picker의 option 축) |
| `permissions` | `permissions` | — | null | 아니 | 있음 |
| `status` | `status` | — | null | 예 | 있음 |
| `usage` | `usage` | — | null | 예 | 새로(`session.usage`. lophn은 `limits`가 비었다) |
| `context` | `context` | — | null | 예 | 새로(`usage.context`. lophn은 `parts`가 비었다) |
| `rewind` | `rewind` | — | null | 예 | 새로(화면에 rewind 고르기가 있다) |
| `fork` | `fork` | — | null | 예 | 있음 |
| `rename` | `rename` | — | `[title]` | 예 | 있음(인자를 기다리는 지금 동작이 `argument_hint`로 드러난다) |
| `compact` | `compact` | — | null | 예 | 있음 |
| `archive` | `archive` | — | null | 예 | 있음 |
| `mcp` | `mcp` | — | null | 아니 | 있음 |
| `skills` | `skills` | — | null | 아니 | 있음 |

skill은 모두 `source: "skill"`, `opens: null`, `aliases: []`, `argument_hint: null`이다. lophn에는 plugin·MCP prompt·사람 명령 file이 없어 다른 출처를 쓰지 않는다. "session이 있어야"는 지금 화면의 `SESSION_ONLY`(`packages/shell/renderer/conversation/agent-view-model.ts`, 읽기만)가 이름으로 가르던 것이다. 화면이 이름을 해석하지 않도록 core가 draft meta에서 뺀다.

1. `packages/protocol/lophn-agent/commands.ts`: `BUILTIN_COMMAND_IDS`를 위 표의 열네 개와 순서로 바꾼다. 주석의 "아홉"을 고친다. `commandEntrySchema`는 그대로다(ListCommands를 쓰는 곳은 `acp-build.ts` 하나뿐이고, ACP 꼴로 옮기는 일은 wiring이 한다).
2. `packages/core/lophn-agent/commands/registry.ts`: `BUILTIN_TABLE`에 새 다섯의 title·description을 더한다(영어, 지금 꼴): `model` "Model" / "Choose the model and its options", `effort` "Effort" / "Change how much the model thinks", `usage` "Usage" / "Show tokens and cost for this session", `context` "Context" / "Show how full the context window is", `rewind` "Rewind" / "Go back to an earlier message". 내장 이름과 같은 skill을 빼는 지금 규칙은 그대로다(사람의 skill `model`·`context` 등은 `/`로 부를 수 없게 된다. 보고의 "정한 것"에 적는다).
3. `packages/core/main/daemon/wiring/acp-build.ts`:
   - `commandsOf` 옆에 표 `LOPHN_COMMAND_FACES: Record<(typeof BUILTIN_COMMAND_IDS)[number], {opens: AcpCommandOpens; aliases: readonly string[]; argument_hint: string | null; session: boolean}>`를 둔다(위 표 그대로. `Record`라 내장이 늘면 tsc가 빈 칸을 잡는다). 주석: "lophn 내장 명령이 화면에서 하는 일. ACP 쪽 얼굴이라 ListCommands가 아니라 여기 둔다."
   - `commandsOf`가 내장(`source === "builtin"`)이면 `source: "app"`과 표의 `opens`·`aliases`·`argument_hint`를, skill이면 위 skill 값을 낸다. 별칭과 같은 이름의 skill(`clear`)은 뺀다(registry가 내장 이름과 같은 skill을 빼는 것과 같은 규칙).
   - `readDraftMeta`는 표의 `session: true`인 내장을 `commands`에서 뺀다. `readSessionMeta`는 다 낸다.
4. `packages/core/main/daemon/wiring/acp-send.ts`의 `run_command`: 지금 `BUILTIN_COMMAND_IDS`에 든 이름을 `invalid()`로 거절한다. 별칭(`LOPHN_COMMAND_FACES`의 `aliases`)도 같이 거절한다(화면이 `opens`로 처리할 이름이 skill 요청 글로 model에 가지 않게).
5. `acp-build_test.ts`: draft meta case(453줄)의 기대를 "session meta에서 title·usage·cli_session과 session이 있어야 하는 내장을 뺀 것"으로 고치고, fixture의 `commandsList`에 session이 있어야 하는 내장 하나(`rename`)를 더해 draft에 없는 것을 본다. 이 case가 이미 "첫 메시지를 보낸 순간 단추가 바뀐다"는 회귀를 막고 있어 새 case는 두지 않는다.
6. `acp-send_test.ts`: 고칠 것이 없으면 두지 않는다(권한 경계 case는 그대로).
7. 같은 값을 화면 fake source(`packages/shell/renderer/conversation/agent-tab-fake-commands.ts`, `screen-thread` 소유)가 손으로 적는다. 이 task는 그 file을 고치지 않고 표를 보고에 싣는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(위 5는 있는 case를 고친다).
- 남지 않음: `grep -rn "아홉\|nine" packages/protocol/lophn-agent/commands.ts packages/core/lophn-agent/commands`가 0줄. `grep -rn 'opens: null' packages/core/main/daemon/wiring/acp-build.ts`는 skill 줄 하나뿐이다.
- 사람이 lophn agent 화면에서 `/new`·`/rename x`·`/fork`·`/status`·`/permissions`·`/mcp`·`/skills`·`/compact`·`/archive`를 쓰던 동작은 `screen-thread`가 `opens`로 옮긴 뒤에도 같다(그 확인은 `app-check`의 목록에 든다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 위 표(내장마다 `opens`·`aliases`·`argument_hint`·session 필요)를 그대로 싣는다. `screen-thread`의 fake source와 화면의 `BUILTIN_TITLES`(새 다섯의 제목 i18n)가 그것을 쓴다.
