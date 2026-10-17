# pm-context

PM이 context 초안을 열고 계약을 쓰고 격리 test를 돌리고 제출하면 context가 적용되어 검색이 되고, 격리 test를 못 통과한 초안은 적용되지 않는 것을 `tests/e2e/pm-context_test.ts`로 본다. PM의 본업이고 core가 만든 id를 다음 tool 인자에 넣어야 해서 `reply-fn`이 필요하다.

- 단위: pm-context (wave 2)
- 선행: reply-fn. 함수 대답과 `probe.ts`를 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/pm-context_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/agent-roles/tools/context/`
  - `packages/core/projects/contexts/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-product.md` 후보 `context-draft-submit-search`, `context-bad-draft-kept-out`, 묶음 G1
  - `project-docs/plan/e2e-coverage/research/candidates-bugs.md` 후보 `pm-draft-folder-write-rewind`(초안 폴더 규칙이 세 번 어긋난 전례)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `contexts`, `projects`, `agent-roles`, `agent-tool-spi`, `supervision`(context worker child `documents/contexts`)
  - 코드: `packages/core/agent-roles/tools/context.ts`(`context.draft/test/submit/list/get/search`)와 `context/draft.ts`(`context_draft`의 결과 `{context, draft, folder}`, `ctx.scope.open(folder)`), `packages/core/agent-roles/skills/context-init/SKILL.md`(계약 작성 절차), `packages/protocol/projects/{context-contract,context-drafts,context-api}.ts`(`contextGetRoute`, `contextSearchRoute`, `bundleTestDraftRoute`, `bundleSubmitRoute`), `packages/core/projects/contexts/{drafts_test,contexts_authority_test}.ts`(유효한 계약과 draft folder 모양의 실제 예. 이 test의 계약 내용을 거기서 가져온다), `project-docs/issues/contexts.md`(md가 아닌 문서는 아직 context가 못 된다)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `reply-fn`이 더하는 `tests/support/fake-server/probe.ts`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)의 함수 대답과 `probe.ts`(`lastToolResult`, `idIn`), `contextGetRoute`·`contextSearchRoute`(`packages/protocol/projects/mod.ts`), `toolCallList`.
  - 내놓는 것: 없음(test file만)

## 할 일

1. 새 file이다. 같은 `Deno.test` 한 개 안에서 core를 한 번 띄우고 행마다 새 session을 연다(행의 준비를 반복하지 않는다). 준비: `connectFakeProvider`, project 폴더 `proj`(frontmatter가 있는 md 문서 하나 이상), `openProject`, 행마다 `openSession(PM)`.
2. 계약의 정확한 내용(type 이름, `source`, search 이름과 example)은 위 읽을 것의 test fixture에서 가져온다. 이 brief는 정하지 않는다. 계약 file의 위치와 이름은 `context_draft`가 준 폴더가 이미 가진 layout을 따른다(skill: "the layout the draft folder already has"). 폴더가 아무 layout도 안 주면 보고하고 멈춘다.
3. 행 표.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `submit-and-search` | `say` → `waitTurnEnd` → `contextGetRoute` → 문서가 index될 때까지 `contextSearchRoute` poll(`until`) | ① tool `context_draft {name, purpose}` ② 함수: ①의 결과에서 `context`·`draft`·`folder`를 뽑아 `file_write`(계약, 필요하면 search script 몇 개)·`context_test`·`context_submit`을 한 reply로 ③ text | disk: draft 폴더에 계약 file이 쓰였다 / ledger: `contextGetRoute`의 applied 판이 제출한 draft이고 `toolCallList`의 `context_test`·`context_submit`이 `success` / route: `contextSearchRoute`가 test가 둔 문서의 key를 돌려준다(context worker를 지났다) | `context-draft-submit-search`. PM의 유일한 산출물 |
| `bad-draft-kept-out` | 위와 같고 계약이 문서를 어긴다(필수 field가 문서에 없음) | ① 같은 `context_draft` ② 함수: 어긴 계약 + `context_test` + `context_submit` ③ text | fake: 3번 요청의 `context_test`/`context_submit` tool_result가 통과가 아니다(구조만) / ledger: `contextGetRoute`에 applied 판이 없다 / route: `contextSearchRoute`가 거절한다(`not_found` 계열) | `context-bad-draft-kept-out`. 틀린 계약이 적용되면 다른 agent가 틀린 정보를 받는다 |

4. 함수 대답은 던지지 않게 쓴다(앞 tool_result가 없으면 명시적 text로 답해 turn이 끝나게 한다). `reply-fn`이 던진 함수를 400으로 받아 주지만 그건 안전망이다.
5. context worker(`documents/contexts` child)가 뜨지 않으면 이 행은 실패해야 한다(skip하지 않는다). `layers.md`가 말하는 "시작부터 죽는 child"를 이 행이 처음 지난다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `contexts`(제출한 초안은 격리 test를 통과해야만 적용되고 검색은 적용된 판으로 한다), `agent-roles`·`agent-tool-spi`(PM만 초안을 열고 쓸 수 있다), `supervision`(context worker child).
- 현실적 회귀: 초안 폴더 규칙(turn scope, rewind 폴더 목록, runtime Deno 권한)이 어긋나 같은 turn에 쓰기가 `forbidden`이 되는 것(두 번 고친 일), 틀린 계약이 test를 건너 적용되는 것, 적용됐는데 검색이 worker를 못 지나는 것.
- 왜 지금 test가 못 잡나: 지금 PM으로 도는 E2E는 file 쓰기뿐이다. 초안 폴더는 data root 아래라 runtime의 `<dataRoot>/projects` 쓰기 허락, file scope의 `openDraft` 확장, context worker가 한꺼번에 맞아야 하고 이 id들은 정적 대답으로는 줄 수 없다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/pm-context_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/pm-context_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "PM이 제출한 초안은 격리 test를 통과할 때만 적용되고 적용된 context는 검색된다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
