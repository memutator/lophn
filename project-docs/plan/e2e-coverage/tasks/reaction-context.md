# reaction-context

적용된 context가 있는 project에서 사람이 문서를 고쳐 계약을 어기면 core가 위반을 기록하고 그 project의 Project Manager를 새 session으로 부르는 길(`ContextViolationFound` → Reactor → Router)을 `tests/e2e/pm-context_test.ts`에 행 하나로 더한다. context를 만드는 준비는 `pm-context`의 `submit-and-search` 행이 이미 한 것을 이어 쓴다.

- 단위: reaction-context (wave 3)
- 선행: pm-context. 그 file의 행이 만든 적용된 context와 core를 이어 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/pm-context_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/projects/contexts/`
  - `packages/core/events/reactor/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 8절 `context-violation-reaction`; `candidates-product.md` 후보 `context-violation-reaction`(그 후보는 "fake 4개, support helper로 접어 둘 수 있다"고 썼다. 이 task는 앞 행에 얹어 fake 대답을 1개로 줄인다)
  - architecture: `project-docs/architecture/event.md`("새 일 event만 reaction grant로 끌 수 있다"), `project-docs/products/AGENT-ROLE.md` §6 E5
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `contexts`, `events`, `router`
  - 코드: `packages/core/projects/contexts/api/commands-violations.ts`(`recordViolations`: 새 위반 key가 생기면 `ContextViolationFound`, 줄거나 고쳐지는 것은 event가 아니다. machine `context_worker` 자격만), `packages/core/projects/contexts/work-index.ts`(변경을 보고 위반을 다시 계산해 `context.record_violations`를 낸다), `packages/core/projects/contexts/watch/{detector,folders}.ts`(file 변경을 500ms 창으로 모은다. 계약이 가리키는 폴더만 본다), `packages/core/events/reactor/session-opening.ts`(`callOf`의 `ContextViolationFound`: 그 project의 PM 새 session, 본문에 check와 context id, refs 없음), `packages/protocol/projects/context-api.ts`(`contextViolationsRoute {context}`, `contextGetRoute`, `contextBundlesRoute`), `packages/protocol/lophn-agent/{agent-sessions,received-messages}.ts`(`agentSessionList {agent: {role: "project_manager", project}}`, `receivedMessageList`의 `from`)
  - main의 `tests/e2e/pm-context_test.ts`(`pm-context`가 만든 것: 계약 fixture, `submit-and-search` 행), `tests/support/core/`, `tests/support/fake-server/`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `pm-context`의 file 안 준비(적용된 context, 그 문서 폴더, core)와 `until`(`boot-damaged`가 export). 새 support를 만들지 않는다.
  - 내놓는 것: 없음(test file만)

## 층을 정한 이유와 접은 것

core E2E다. 문서 변경은 disk에서, 감시와 위반 계산은 context worker child에서, event와 반응은 core에서, PM의 turn은 agent runtime child에서 일어난다. 위반을 세는 규칙(`recordViolations`의 새 key 판정)은 `contexts_authority_test` 같은 unit이 본다.

별도 file이 아니라 `pm-context`의 file에 행으로 더하는 이유: 위반은 적용된 context가 있어야 생기고, 그 context를 만드는 PM 대화(fake 대답 셋)가 앞 행에 이미 있다. 따로 만들면 같은 준비를 되풀이한다.

## 할 일

1. 시작 조건: `pm-context`가 merge됐다. `pm-context_test.ts`의 첫 행(`submit-and-search`)이 끝난 뒤에 이어지는 같은 `Deno.test` 안의 행으로 더한다(그 행이 만든 context가 `contextGetRoute`로 applied 판을 가진 상태다). 앞 행의 준비를 다시 쓰지 않는다.
2. 먼저 확인할 것(돌려 보기 전에 코드로 읽고, 막히면 멈추고 보고한다): (a) 앞 행의 applied 판이 `check`를 가졌는지(`contextBundlesRoute`의 applied 판). `recordViolations`는 `check`가 null이면 `internal`이다. (b) 계약이 가리키는 폴더가 test가 고칠 문서를 포함하는지(`watchFolders(contract)`). (c) 앞 행의 PM session이 이 행과 겹쳐 turn을 아직 돌고 있지 않은지(`waitTurnEnd`로 끝나 있어야 한다).
3. 행 표.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `violation-calls-pm` | disk: 앞 행이 index한 문서에서 계약이 요구하는 칸(예 frontmatter의 필수 field)을 지운다 → `until`(`contextViolationsRoute`에 위반 하나 이상) → `until`(`agentSessionList {agent: {role: "project_manager", project}}`에 program 메시지로 열린 session) → `waitTurnEnd` | ① text(reaction turn) | route: `contextViolationsRoute`가 고친 문서의 path를 가리킨다 / ledger: 새 PM session의 첫 메시지 `from`이 program이고 session이 정확히 하나 늘었다(사람이 연 앞 행의 session은 program 메시지가 없어 가려진다) / fake: 그 turn의 요청 마지막 user 글에 context id가 있다(본문 `Check: <check>, context: <id>`의 id. 형식은 `session-opening.ts`가 정한다) | AGENT-ROLE E5, event.md. 위반을 아무도 모르는 문서가 계약을 어긴 채 남는 것을 막는다 |

4. 위반이 안 보이면 감시 지연(500ms 창 + index)을 기다리는 것이지 sleep이 아니다: `until`이 신호를 읽는다. 제한 시간(기본 30초) 안에 안 되면 `contextViolationsRoute`와 `contextGetRoute`의 상태를 담아 실패한다.
5. reaction 모드는 기본 `open`이다. 이 행은 설정을 건드리지 않는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `contexts`(문서가 계약을 어기면 위반이 기록되고 새 위반만 event가 된다), `events`·`router`(새 일 event는 그 project의 PM을 새 session으로 부른다).
- 현실적 회귀: 사람이 문서를 고쳐도 context worker의 감시가 못 봐 위반이 기록되지 않는 것, 위반이 기록됐는데 event가 안 나가 PM이 모르는 것, 다른 project의 PM이 불리는 것.
- 왜 지금 test로 못 잡나: 위반 key 판정은 unit이 보지만 disk 변경 → context worker child의 감시·계산 → core의 command → Reactor → Router → agent runtime child의 turn은 process 셋을 건너야 이어진다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/pm-context_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/pm-context_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "문서가 context 계약을 어기면 그 project의 PM이 새 session으로 불린다"

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
