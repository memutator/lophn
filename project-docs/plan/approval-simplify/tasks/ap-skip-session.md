# ap-skip-session

skip을 session 표시와 Operator 정의의 기본값 칸으로 둔다. session의 skip은 사람만 켜고 끄고(`ChangeSessionSkip`), 정의 칸은 사람만 쓴다(PM과 App Engineer의 `operator.create`·`operator.update` 입력에 없다). 새 Operator session은 정의의 기본값으로 시작하고, fork한 session도 출처의 skip을 가져가지 않고 정의의 기본값으로 시작한다.

- 단위: skip (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{sessions.ts,agent-sessions.ts,operators.ts,agent-values.ts}`
  - `packages/core/lophn-agent/session/{model.ts,commands.ts,reads.ts}`
  - `packages/core/lophn-agent/session/history_test.ts`(가짜 session 읽기의 `skip` 한 줄)
  - `packages/core/lophn-agent/places/lifecycle.ts`
  - `packages/core/lophn-agent/places/ports.ts`
  - `packages/core/lophn-agent/agents/{definition-file.ts,validate.ts}`
  - `packages/core/lophn-agent/register.ts`(command 등록 한 줄)
  - `packages/core/agent-roles/agents/operator-directory.ts`
  - `packages/core/agent-roles/tools/operator.ts`
  - `packages/core/agent-roles/tools/operator_test.ts`(새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`("session을 여는 길은 … 모두 같은 연산으로 연다", "fork는 이력만 복사한다"와 "왜 이 모양인가"의 "fork는 있는 그대로 복사하되 묶인 것은 놓고 간다"), `project-docs/architecture/agent-definition.md`("Operator 정의 층의 MCP server는 … 정의 file을 쓰는 것은 사람뿐이다", "Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다"), `project-docs/architecture/approval.md`(결정은 사람만 한다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `agents`, `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/agent-roles`(Operator 조회)
  - 제품 결정: `project-docs/products/roadmap/approval.md`의 "turn mode"(skip 줄, "skip은 session에 붙는 표시다", "skip은 call을 따라 가지 않는다")와 "정한 것 (agent)"의 "Operator 정의의 skip 기본값 칸은 사람만 쓴다", `project-docs/plan/approval-simplify/README.md`의 "정한 것"(skip)과 "뼈대 검토에서 정한 것"(fork는 skip을 가져가지 않는다, CLI `--dangerously-skip-permissions`는 두지 않는다)
  - 본보기(코드): `packages/core/lophn-agent/session/commands.ts`의 `changeModel`(사람만, archive면 conflict, 같은 값이면 이전 결과, `state_seq` 비교), `packages/core/agent-roles/tools/operator.ts`의 `operatorDefinitionSchema.omit({ name, mcp_servers })`(사람만 쓰는 칸을 tool 입력에서 뺀다)
- 계약:
  - 쓰는 것: ap-contract `mode.ts`의 session 규칙
  - 내놓는 것: `sessions.skip`, session record의 `skip: boolean`(`ReadSession`·`ListSessions` 출력), command `ChangeSessionSkip`(resource `sessions`, method `change-skip`, 입력 `{id, skip}`, compare `{state_seq}`, actors `user`), Operator 정의의 `skip?: boolean`(정의 file frontmatter `skip`), `OperatorInfo.skip`. 새 session(사람, Router의 call, fork 어느 길이든)의 skip은 Operator 정의의 기본값이고 Operator가 아니면 false다. fork는 출처 session의 skip을 가져가지 않는다. CLI flag `--dangerously-skip-permissions`는 두지 않는다(CLI가 여는 run은 처음부터 unattended다. `headless-run`).

## 할 일

줄 번호는 main `e192a9d8c` 기준이다. 앞 계획 land 뒤 path 확인: `packages/protocol/lophn-agent/sessions.ts`는 problem-remove의 `pr-cleanup`이 `openingTargetSchema`를 먼저 고친다.

1. Operator 정의(`packages/protocol/lophn-agent/operators.ts`): `operatorDefinitionSchema`와 `operatorDefinitionOutputSchema`의 `.extend`(28-33)에 `skip: z.boolean().optional()`을 더한다. 16-18 주석에 "skip은 그 Operator의 새 session이 skip으로 시작하는 기본값이고 사람만 쓴다"를 더한다. `agent-values.ts`는 고칠 것이 없으면 두지 않는다(`mcp_servers`처럼 operators.ts에서 더한다).
2. session record(`packages/protocol/lophn-agent/agent-sessions.ts`의 `agentSessionSchema` 26-39): `skip: z.boolean()`을 더하고 "사람이 켠 동안 이 session의 turn은 허락을 묻지 않는다(deny는 막는다). 바꾸면 다음 turn부터 닿는다" 주석을 단다.
3. command(`packages/protocol/lophn-agent/sessions.ts`): `changeSessionModel`(339-352) 옆에 `changeSessionSkip`을 둔다.
   - `defineCommand({ resource: "sessions", method: "change-skip", name: "ChangeSessionSkip", input: z.strictObject({ id: idSchema("ses"), skip: z.boolean() }), output: z.object({ id: idSchema("ses"), skip: z.boolean(), state_seq: seqSchema }), compare: z.strictObject({ state_seq: seqSchema }), actors: ["user"], errors: ["invalid_input", "not_found", "conflict", "unauthorized"] })`
   - `SESSION_COMMANDS`(460)에 더한다. `packages/protocol/lophn-agent/registry.ts`의 `ROUTES`가 `SESSION_COMMANDS`를 펼치고 shell의 `SHELL_ROUTES`가 `ALL_ROUTES`를 쓰므로 renderer 허용 목록은 따로 고치지 않는다.
4. sessions 표(`packages/core/lophn-agent/session/model.ts`)
   - `create table sessions`(46-77)에 `skip integer not null default 0 check (skip in (0, 1))`을 더한다. step을 새로 더하지 않고 있는 step의 글을 고친다. 옛 개발 data는 `history_mismatch`로 기동이 거절되니 `.dev-data/`를 지우고 새로 만든다(AGENTS.md "호환성"). `default 0`은 칸을 적지 않고 행을 넣는 test(`packages/core/lophn-agent/places/places_test.ts`, `instructions/read_test.ts`, `session/message-commands_test.ts`, `session/rewind/rewind_test.ts`, `session/rewind/artifact-writer_test.ts`) 때문이다.
   - `AgentSessionRow`(148)에 `skip: boolean`, `SESSION_COLUMNS`(171)에 `skip`, `sessionRowOf`(176)에 `skip: Number(row["skip"]) === 1`, `agentSessionOf`(250)에 `skip: row.skip`을 더한다.
5. Operator 조회
   - `packages/core/lophn-agent/places/ports.ts`의 `OperatorInfo`(18-24)에 `skip: boolean`("정의의 skip 기본값. 없으면 false")을 더한다.
   - `packages/core/agent-roles/agents/operator-directory.ts`의 `toInfo`(24-33)가 `skip: loaded.definition !== null && "skip" in loaded.definition && loaded.definition.skip === true`를 채운다.
6. session 열기(`packages/core/lophn-agent/places/lifecycle.ts`)
   - `placeOfAgent`(44-63)가 Operator 정의를 이미 읽는다. 그 값에서 skip 기본값도 함께 돌려주게 바꾼다(`{ place, skip }`). Operator가 아니면 false다.
   - `startSession`(66)의 `insert into sessions`(92)에 `skip`(0 또는 1)을 넣는다. `inherit`(74-78)에는 skip을 더하지 않는다. 주석으로 "fork는 skip을 가져가지 않는다. 새 session은 정의의 기본값으로 시작한다(place-session의 fork가 허락을 가져가지 않는 것과 같은 이유)"를 단다.
   - `packages/core/lophn-agent/session/fork.ts`와 `packages/core/lophn-agent/places/directory.ts`는 `startSession`을 부르므로 고치지 않는다. 읽어서 확인만 한다.
7. command handler(`packages/core/lophn-agent/session/commands.ts`): `createConversationCommands`의 return type과 값에 `changeSkip: CommandDefinition<typeof changeSessionSkip>`을 더한다. 순서는 `changeModel`(228-271)과 같다: `requireUser` → `loadSession`(없으면 `sessionNotFound`) → archive면 `conflict` → 같은 값이면 이전 결과 `{ id, skip, state_seq }` → `state_seq`가 다르면 `conflict` → `nextSessionSeq` → `update sessions set skip = ?, state_seq = ?` → 결과. 도는 turn은 시작 때 정한 mode를 쓰므로(ap-mode-turn) 바꾼 값은 다음 turn부터 닿는다.
8. 등록(`packages/core/lophn-agent/register.ts` 751): `conversationCommands.changeModel` 다음 줄에 `conversationCommands.changeSkip`을 더한다.
9. `packages/core/lophn-agent/session/reads.ts`: `agentSessionOf`가 칸을 채우므로 고칠 것이 없으면 두지 않는다.
10. 정의 file(`packages/core/lophn-agent/agents/definition-file.ts`의 `orderedFrontmatter` 201-216): 목록 칸 뒤에 `if (value.skip !== undefined) out.skip = value.skip;`를 더한다. false도 쓴다. 쓴 글을 다시 읽으면 처음 값이 나와야 한다(file 머리 주석의 규칙). `validate.ts`는 `serializeAgentFile`로 검사하므로 고칠 것이 없으면 두지 않는다.
11. Operator tool(`packages/core/agent-roles/tools/operator.ts`): `operatorDefinition`(33-37)을 `operatorDefinitionSchema.omit({ name: true, mcp_servers: true, skip: true })`로 바꾸고 33줄 주석에 "skip 기본값"을 더한다. `operator.update`는 지금 정의에 보낸 칸만 덮으므로(`{ ...definition, ...patch }`) 사람이 켠 skip이 남는다. `operator.create`는 skip 없이 만든다.
12. `packages/core/lophn-agent/session/history_test.ts`의 가짜 `/sessions/read`(22-35) session에 `skip: false`를 더한다. `readOf`가 출력 schema로 다시 검사해 칸이 없으면 실패한다.
13. 위험 test(아래 "끝남")를 `packages/core/agent-roles/tools/operator_test.ts`에 쓴다.
14. 문서(`architecture/agent-definition.md`의 skip 칸, `place-session.md`)는 lead가 계획 끝에 고친다(README "lead가 할 일"). 고치지 않는다.

정한 것:
1. `ChangeSessionSkip`은 event를 내지 않는다. 이유: `ChangeSessionModel`도 내지 않고 화면은 `state_seq`로 다시 읽는다.
2. 정의 file은 `skip: false`도 쓴다. 이유: 정의 file 규칙 "쓴 글을 다시 읽으면 처음 값이 나온다"(`definition-file.ts` 머리 주석)를 지킨다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "Operator 정의의 skip 기본값 칸은 PM과 App Engineer의 tool로 쓸 수 없다"
  - `packages/core/agent-roles/tools/operator_test.ts`. `OPERATOR_TOOLS`에서 `operator.create`와 `operator.update`를 꺼내 표로 돈다.
  - 경우마다 통과하는 최소 입력(create: `place`, `name`, `body`. update: `operator`와 바꿀 칸 하나)이 `tool.input.safeParse`를 지나고, 같은 입력에 `skip: true`를 더하면 지나지 못한다.
  - 판정은 입력 검사의 결과다. 순수 함수 층이고 core를 띄우지 않는다.
- 남지 않음:
  - `grep -rn "dangerously-skip-permissions\|dangerously_skip" packages tools`가 0줄이다.
  - `grep -n "skip" packages/core/lophn-agent/session/fork.ts`가 0줄이다(fork는 skip을 가져가지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
