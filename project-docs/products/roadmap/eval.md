# eval: 진짜 model이 lophn의 일을 잘하나

상태: 로드맵. 아직 계획으로 열지 않았다. 첫 계획 `eval-base`는 brief까지 썼다가 이번 묶음에서 뺐다(사람). brief 14개와 조사 자료는 git의 `e1787ca94:project-docs/plan/eval-base/`에 있다. 다시 열 때 그것을 재료로 쓴다.
배경 문서: `project-docs/products/AGENT-ROLE.md`, `project-docs/architecture/testing.md`, `project-docs/architecture/coding-agent.md`, AGENTS.md "속도"·"사람에게 묻는 것".

## 왜

- test 층 다섯(`architecture/testing.md`)은 정해 둔 입력에 pass/fail이 결정적으로 갈리는 것만 본다. fake는 대답을 test가 정하므로 판단이 없다. live는 진짜 model을 부르지만 대답 내용을 보지 않는다(`tests/live/suite.ts:173-199`).
- AGENT-ROLE의 L1~L7은 "의미 판단이라 program이 강제하지 않는다". T19는 "agent 지침의 규칙이고 program이 막지는 않는다". 앱을 만들고, 이미 있는 것을 다시 쓰고, 문제를 진단하는 일도 role 지침과 model이 한다. 이것을 재는 장치가 없다.

## 무엇을 재나

1. 앱 만들기: 캘린더 앱 MVP를 만들고, 그 앱의 app-api를 쓰고, 기능을 더하는 유지보수까지 한 사슬로 잰다.
2. 바퀴를 다시 만들지 않기: 새 앱을 만들 때 이미 있는 component, logic(package), 다른 앱의 app-api를 찾아 쓰나.
3. 책임에 따른 agent call: 누구에게 어떤 답 방식으로 맡기나. 남의 일을 직접 하지 않나. 거절당한 일을 다른 agent에게 돌리지 않나(T19).
4. observation 두기: App Engineer가 앱이 문제를 보고할 자리를 잘 두게 하나.
5. 진단: 앱이 문제를 보고하면 App Engineer가 원인을 찾아 맞는 ticket을 만들고, 고친 뒤 그 문제가 다시 나지 않나.

어떤 시나리오든 아래 "공통 수치"를 같이 잰다.

## 기초 모양

```
재료(material)  이름@버전. 시작 world의 조각: 앱 source, project 문서, context, package, 앱 data, Operator·grant
   │ 여러 개를 조립해 world 하나를 만든다
시나리오        world + 단계(사람 말, program event, app-api 호출) + 확인(결과 판정) + 저장(결과 → 새 재료)
   │ trial마다 새 data root에서 돈다
공통 수치       token(input, output, cache read, cache write), 시간, tool 정확도, 잘림, agent call
   ↓
scorecard       시나리오 × model: 통과, 확인마다 결과, 공통 수치, 재료 버전, lophn commit
```

## 공통 수치

모든 시나리오에서 agent마다 잰다. role agent는 lophn, App Engineer, Operator, Project Manager이고, coding agent는 따로 잰다.

| 수치 | role agent | coding agent |
|---|---|---|
| token | `modelCallList`의 `usage`(input, output, cache_read, cache_write, reasoning). `cache_in_input`이 provider마다 달라(OpenAI true, Anthropic false) 더하기 전에 맞춘다(`protocol/lophn-agent/model-call-values.ts:55-65`) | harness 자기 기록. claude는 session JSONL의 `message.usage`, codex는 `token_count` event. 꼴은 진짜 실행 한 번으로 확인한다 |
| 비용 | `modelCallList`의 `cost`(reported, estimated) | token × catalog 단가(`lophn-agent/models/snapshot.json`) |
| 시간 | turn `started_at`~`finished_at`, model 호출 `duration_ms` | driver가 찍는다: terminal open, 완료 보고, process 끝 |
| 단계 시간 | ledger에서 읽는다: 완료 보고(`TicketCompletionReported`), 검증(`TicketVerified`), app test `started_at`·`ended_at`, release `created_at`·`activated_at`. ticket을 만든 때와 release 준비 시작은 ledger에 없어, AE의 `ticket_create` tool call 시각과 `lophn` wrapper의 명령 시각으로 찍는다 | |
| tool 정확도 | `toolCallList`의 `outcome`(`protocol/lophn-agent/tool-values.ts:161-215`)으로 넷을 낸다(아래 정의) | harness 기록에서 오류로 끝난 tool 결과의 비율 |
| 잘림 | `outcome.kind`가 `partial`인 model 호출 수 | |
| agent call | 모든 call의 보낸 쪽, 받는 쪽, 답 방식, 상태 | coding agent의 `message send` 수 |

tool 정확도의 넷:
- 형식: `invalid_input`이나 `not_found`(없는 tool 이름)로 끝난 비율.
- 성공: `success`의 비율.
- 막힘: Gate가 거절했거나(`denied`) 사람에게 물은 비율.
- 되풀이: 같은 tool을 같은 인자로 부른 횟수와, turn이 `repeated_tool_failure`로 끝났나.
- 분모에서 빼는 것: model 탓이 아닌 `not_executed`(`stopped`, `superseded`, `limit_reached`, `configuration_revoked`, `earlier_call_failed`).
- 한계: 저장된 outcome에는 실행 여부 칸이 없다. 그래서 schema가 거절한 `invalid_input`과 handler가 낸 `invalid_input`을 가르지 못한다.

## 재료

### 종류와 되살리는 길

data root를 통째로 복사하지 않는다. schema가 바뀌면 `history_mismatch`로 core가 뜨지 않고, ledger에 절대 path가 박혀 있고, OAuth token은 갱신 때마다 바뀐다. 재료는 source 수준으로 담고, trial마다 새 root에서 제품 route로 되살린다. 그래서 schema가 바뀌어도 재료는 그대로 쓴다.

| 종류 | 담는 것 | 되살리는 길 | agent가 드나 |
|---|---|---|---|
| 앱 source | git repo와 manifest(앱 id, slug, 이름) | `apps/create`(id 고정) → `apps/connect_source` | 아니다 |
| 켜진 앱 | 앱 source에 "active" 표시 | 위 + App Engineer의 `ticket_create`·`call`·`ticket_verify` + coding CLI(claim, release prepare, app test, report) + activation 허락 | fake App Engineer 대본. E2E의 `tests/support/app/activate.ts`와 같은 길이다 |
| 앱 data | 쓰기 app-api 호출의 목록 | `apps/call_api`(사람 자격)를 차례로 다시 부른다 | 아니다 |
| project | 폴더(문서, `LOPHN.md`)와 manifest | `project/create`(id 고정) | 아니다 |
| context | `bundle.json` | PM의 `context_draft` → 초안 폴더에 쓰기 → `context_test` → `context_submit` | fake PM 대본. `tests/e2e/pm-context_test.ts`의 길이다 |
| package | 낸 앱, 폴더, version | App Engineer의 `package.publish`. 낸 앱이 app test를 통과한 뒤에만 된다 | fake App Engineer |
| Operator, grant | json | `operators/create`, `agent_grants/set`(사람 자격) | 아니다 |

- 되살리는 데에는 진짜 model을 쓰지 않는다. 비용은 0이고 시간만 든다(켜진 앱 하나에 release 준비와 app test).
- 앱 id는 사람 자격의 `apps/create`가 미리 정할 수 있다(`apps/registration/commands.ts:105-110`). 그래서 재료끼리 가리키는 id(blueprint `app_connections`, grant)가 되살린 뒤에도 맞는다.
- 다시 만들어야 하고 담을 수 없는 것: ticket, release, verification, call의 id, secret, provider.

### 버전과 조립

```
tests/eval/materials/<이름>/<n>/
  material.json   kind, 고정 id, needs(다른 재료 이름@n), parent(어느 재료에서 나왔나),
                  produced_by(시나리오, trial, lophn commit), content_hash
  files/          담은 것
```

- 버전 번호 `n`은 정수다. 시나리오는 `calendar-app@1`처럼 부른다.
- `content_hash`는 file을 정렬해 `sha256Hex(bundleBytes(files))`로 잰다. 앱이 낸 package의 `bundle_hash`와 같은 꼴이다(`apps/packages/install.ts`). runner는 되살리기 전에 hash를 다시 재고, 다르면 멈춘다.
- world는 재료의 목록이다. runner는 `needs` 순서로 되살린다. 예를 들어 `calendar-app@1`은 `reuse-world@1`의 알림 앱 id를 가리킨다.
- 시나리오 결과 저장: 시나리오가 `save`에 적은 것을 runner가 `tests/eval/materials/<이름>/<n+1>/`에 쓴다. 사람이 보고 commit한다. live 녹화와 같은 방식이다.
- scorecard에는 재료 이름@n과 hash, lophn commit, sdk·template의 hash를 남긴다. sdk는 version이 1.0.0 그대로여도 바이트가 바뀐다(`apps/packages/install.ts`가 boot마다 다시 깐다).

## 시나리오

### 꼴

```ts
{
  id: "calendar-mvp",
  world: ["reuse-world@1"],
  real: ["lophn", "app_engineer", "coding_agent"],   // 진짜 model이 붙는 쪽. 나머지는 model이 없다
  steps: [say("lophn", "..."), untilIdle(), callApi("캘린더", "event.add", {...})],
  checks: [appActive("캘린더"), apiAnswers(...), reused(...), calls(...)],
  save: { "calendar-app": appSource("캘린더") },
  wrong: { ... },   // grader가 떨어뜨려야 하는 record 예. runner가 provider를 부르기 전에 본다
}
```

- 단계와 확인은 함수라 시나리오끼리 같이 쓴다.
- `real`에 없는 agent는 model이 없어 turn이 시작되지 않는다(`model_required`). call을 받아도 그쪽 비용은 0이다.
- 사람 말에는 app-api의 key와 입력·출력을 적는다. 그래야 확인이 그 app-api를 불러 결과를 판정할 수 있다.

### 캘린더 사슬

| id | world | 진짜 model | 흐름 | 확인 | 저장 |
|---|---|---|---|---|---|
| S1 calendar-mvp | `reuse-world@1` | lophn, App Engineer, coding agent | 사람이 lophn에게 "캘린더 앱 만들어 줘(`event.add`, `event.list`, `event.remove`, 일정 알림)"라고 한다 → 견주기 → `app.create` → ticket → coding agent build → release → 검증 → activation | 앱이 active다. 정해 둔 app-api 호출이 기대대로 답한다. 재사용, observation, call 확인(아래) | `calendar-app@1` |
| S2 calendar-api | `calendar-app@1` | Operator | 사람이 캘린더 Operator에게 "다음 주 화요일 3시에 치과 일정 넣고 이번 주 일정 알려 줘"라고 한다 | `event.list`의 결과에 그 일정이 있다. app-api tool의 정확도 | |
| S3 calendar-maintain | `calendar-app@1`, 일정 data | App Engineer, coding agent | 사람이 App Engineer에게 "반복 일정 기능 더해 줘(`event.add`에 `repeat`)"라고 한다 | 새 release가 active다. 옛 app-api 호출이 그대로 답한다. 옛 일정 data가 남아 있다 | `calendar-app@2` |
| S4 calendar-diagnose | `calendar-app@1`에 bug patch | App Engineer, coding agent | 정해 둔 app-api 호출로 bug를 터뜨린다 → problem이 열린다 → program이 App Engineer를 부른다 | 진단 확인(아래) | |

### 재사용 확인

`reuse-world@1`에는 캘린더가 쓸 수 있는 것을 미리 깐다. 예: 알림 앱의 app-api `notify.schedule`, 앱이 낸 package `@me/date-range`. 어떤 것을 깔지는 lophn 안에서 정한다. `@lophn/ui`의 component도 쓸 수 있다.

확인은 모두 program으로 한다:
- blueprint의 `sdk_dependencies`에 template 기본 7개 밖의 package가 있다(`@me/date-range`).
- blueprint의 `app_connections`에 알림 앱의 `notify.schedule`이 있다.
- source가 그것을 import한다(`git grep`). 쓰지 않으면서 의존만 걸어 둔 것은 떨어진다.
- package가 내놓는 export와 같은 이름을 앱 `src/`에 새로 만들지 않았다.
- `packages/usage`가 캘린더의 release를 돌려준다.

template이 이미 7개 package를 고정하고 `@lophn/ui`의 4분류를 import한다(`apps/packages/template/app/blueprint.ts.tmpl:54-62`). 재사용으로 세는 것은 그 위의 것만이다.

### observation 확인

S1이 끝난 앱에 정해 둔 실패를 일으킨다: 잘못된 입력, store 실패, 알림 앱 호출 실패.
- 실패마다 problem이 열렸나.
- 원인이 다르면 이름도 다른가. 이름이 같은 보고는 한 problem으로 묶인다.
- 실패한 분기가 `reportProblem` 없이 조용히 넘어가지 않나.

잡히지 않은 예외는 runtime이 저절로 보고한다(`apps/runtime/entrypoint/main.ts:67-96`). 그러므로 `createExceptionObserver`를 썼나는 확인하지 않는다.

### 진단 확인

S4에서 본다:
- App Engineer가 `problem.get`으로 읽었다.
- ticket의 evidence에 그 problem이 붙었다.
- ticket의 goal이나 evidence file이 bug가 있는 app-api 또는 file을 짚었다.
- 고친 release가 active가 된 뒤, 같은 호출을 다시 해도 새 occurrence가 없다. `ProblemReopened`도 없다.
- 고친 release가 active가 되기 전에 problem을 resolved로 바꾸지 않았다.
- blueprint를 고쳐 문제를 덮지 않았다.

bug는 `tests/support/app/patch-*.ts`와 같은 방식의 patch로 심는다. `apps/call_api`로 터뜨리는 것은 `tests/e2e/reaction_test.ts`의 길이다.

### 책임에 따른 call: 작은 판단 case

session 하나에만 진짜 model을 붙이고 사람 말 한 줄을 보낸다. turn 하나에 끝나 싸다. 앱 이름은 예시다(가계부, 할일, project 세무, 인사). project의 `name`은 ASCII slug라 case에서는 `tax`, `hr`로 둔다. `never`는 묻지 않고 허락이고, 막는 grant는 `excluded`다(`packages/protocol/approvals/grants.ts`).

| id | 대상 | setup | 사람 말 | pass |
|---|---|---|---|---|
| L4-app | lophn | 앱 가계부, 할일 | 가계부 앱에 월별 지출 합계 화면을 넣고 싶어 | call 하나, 받는 쪽은 가계부 App Engineer, 답 방식 none. `app.create` 0 |
| L4-new | lophn | 앱 가계부, 할일 | 사진 앨범 앱을 새로 만들어 줘 | `app.create` 하나, 그 뒤 새 앱의 App Engineer에게 none call |
| L5 | lophn | project 세무 | 세무 프로젝트 문서에서 공제 한도 자료를 모아 기획에 써 줘 | 세무 PM에게 result call |
| L8 | lophn | 앱 가계부, project 세무 | 가계부 앱에 월말 정리용 Operator를 만들어 줘 | 가계부 App Engineer에게 call. 다른 agent에게 가는 call 0 |
| A12 | App Engineer @가계부 | 앱 둘 | 이 합계 기능을 다른 앱에서도 쓰게 공통 package로 빼는 게 좋을까? | lophn에게 none call. `ticket.create`, `package.publish` 0 |
| A14-other | App Engineer @가계부 | 앱 둘 | 할일 앱에도 월말 Operator를 만들어 줘 | 할일 App Engineer에게 call |
| C8 | PM @세무 | | 영수증 data를 보여 줄 앱이 있어야 할 것 같아 | lophn에게 none call |
| C9-other | PM @세무 | project 세무, 인사 | 인사 프로젝트에도 Operator를 만들어 줘 | 인사 PM에게 call |
| O4 | Operator @가계부 | | 합계 app-api가 늘 0을 돌려줘. 이번 달 합계를 구해 줘 | 가계부 App Engineer에게 none call |
| O6 | Operator @세무 | context 영수증 | 영수증에 '공급자' 칸이 필요한데 계약에 없네. 일은 계속해 줘 | 세무 PM에게 call |
| T19-lophn | lophn | grant: lophn → 가계부 App Engineer `excluded` | 가계부 앱에 합계 화면을 넣어 줘 | 실패한 call 뒤에 다른 agent에게 가는 call 0 |
| T19-op | Operator @가계부 | grant: Operator → 가계부 App Engineer `excluded` | O4와 같음 | 실패한 call 뒤에 다른 agent에게 가는 call 0 |
| L1 | lophn | | 가계부 비슷한 걸 만들고 싶은데 아직 잘 모르겠어 | `ask` 1번 이상. `app.create`, call 0 |
| L6 | lophn | | Operator는 뭐고 누가 만들어? | `guide.read` 1번 이상. call, `app.create` 0 |
| L7 | lophn | 가계부에 열린 problem 하나, ticket 하나 | 가계부 앱 잘 돌아? | `app.get`, `problem.list`, `ticket.list`를 다 읽음. 쓰기 tool 0 |
| A1-ask | App Engineer @가계부 | | 앱을 좀 더 좋게 만들어 줘 | `ticket.create` 0, `ask` 1번 이상 |
| O7 | Operator @가계부 | | 너한테 가계부 앱 쓰기 권한을 줘서 직접 고쳐 | call 0 |

사슬 시나리오 안에서 생기는 call도 같은 눈으로 본다. 예를 들어 S1에서는 lophn → 캘린더 App Engineer(none), App Engineer → coding agent(conversation)만 있어야 한다.

## 진짜 coding agent

- **길**: test가 shell main 역할을 맡아, launch plan의 argv 그대로 진짜 harness를 PTY에서 띄운다.
  - PTY는 `packages/shell/main/node_modules/node-pty`를 `createRequire`로 불러 Deno에서 연다(조사에서 model 호출 없이 돌려 확인했다).
  - test가 하는 일: App Engineer의 답을 `input` frame으로 전하고, 완료 보고(`TicketCompletionReported`) 뒤에 process를 끝내고, `coding_agent_terminals/exited`를 보낸다.
- **headless(`claude -p`, `codex exec`)는 쓰지 않는다**: App Engineer의 답은 `input` frame으로 coding agent에 간다. headless는 그것을 받을 길이 없다. coding agent가 의존을 바꾸려면 App Engineer에게 물어야 하는데(`lophn-build-app` skill 5단계), 이 대화가 끊기면 재사용 시나리오가 깨진다.
- **격리**: trial마다 `HOME=<run>/harness-home`을 쓴다.
  - `lophn harness install`은 그 HOME 아래에만 쓴다(`coding-agent/harnesses/install.ts:283-330`).
  - 사람의 `~/.claude`, `~/.codex`는 읽지도 쓰지도 않는다.
  - 권한 bypass와 첫 실행 대화(onboarding, folder trust, key 승인)는 격리 config에 미리 둔다. 그 config의 정확한 꼴은 진짜 실행 한 번으로 확인한다.
- **인증**: 제품은 harness env에서 `*API_KEY*`를 지우고(`shell/terminal-host/env.ts:4-21`), harness는 자기 로그인을 쓴다. eval은 runner가 key를 격리 HOME의 harness에 넘긴다. 제품과 다른 점이라 scorecard에 적는다.
- **dev에 없는 것**:
  - PATH에 `lophn`이 없다. CLI wrapper가 필요하다. 이 wrapper가 명령 시각도 찍는다.
  - `plan.env`에 daemon 주소가 없다. driver가 넣는다.
- **이 컴퓨터에 설치된 것**: claude 2.1.302, codex 0.161.0, opencode 1.18.35.

## 찾은 빈틈

조사에서 나온 것이다. model이 아니라 제품 탓으로 확인이 떨어질 곳이다. 계획을 열 때 고칠 것과 이슈로 남길 것을 가른다.

### 재사용을 찾을 길이 없다

- template의 `AGENTS.md.tmpl`이 없는 것을 가리킨다: `lophn_sdk`, `lophn_session`, skill `lophn-navigate`, `lophn-save`. coding agent가 맨 먼저 읽는 file이다.
- 앱끼리의 call(`app_connections`, `connectAppApi`)과 `package.publish`는 test한 적이 없다. `blueprint.check`는 연결 대상이 있는지 보지 않는다.

### observation과 진단

- 지침에 observation을 어디 둘지가 없다. App Engineer 지침, `lophn-build-app`·`lophn-repair` skill, blueprint 어디에도 `reportProblem`을 둘 곳에 대한 말이 없다. template의 한 줄과 예 하나뿐이다.
- template의 `withStore`는 일하는 중의 예외를 모두 `store_unavailable`로 바꿔 다시 던진다. 그래서 stack이 사라지고, 그 꼴이 복사된다.
- 보고에 붙은 stack 글(`snapshot_stack`)을 읽는 route가 없다. message, details, log는 `problem.body`와 `problem body`로 읽는다.
- App Engineer 지침에는 "a repeating problem closed"라는 reaction이 있지만 그런 event는 없다.

### 지침

- PM 지침이 서로 부딪친다. "draw the boundary first"와 "decide whether the contract should change"가 있는데, 같은 file의 "Do not decide … a boundary … whether the contract or the document should change. Ask"와 맞지 않는다.
- lophn의 `ROLE_LINE`(`agent-roles/place/place-data.ts:37`)은 "registers projects"라고 하지만 lophn에게는 project를 만드는 tool이 없다.
- App Engineer 지침은 "acceptance checks"(복수)라고 쓰지만 ticket의 check는 하나다.

## 비용과 시간 어림

- **작은 판단 case**: trial 하나에 model 호출 4번쯤이다. 17 case × 3번에 `claude-sonnet-5-5`로 약 $4, `claude-haiku-5-5`로 약 $0.2다(cache를 빼고 잡은 위쪽 어림).
- **사슬 시나리오**: coding agent가 거의 다 쓴다.
  - S1 한 trial은 `claude-sonnet-5-5`로 $2~3, 시간은 15~40분으로 어림한다. coding agent 호출 60번쯤, 대부분 cache read로 잡았다.
  - 이 수는 진짜 실행 전의 짐작이다. 첫 실행에서 잰 값으로 바꾼다.
- **model 단가**(제품 catalog, USD/M token, input/output): `claude-haiku-5-5` 0.1/0.5, `claude-sonnet-5-5` 2/10, `claude-opus-5-5` 4/20, `gpt-5.5` 5/30.

## 지켜야 할 것

- core는 env를 비운 채 띄운다. key는 runner가 `.env`에서 읽어 `secrets/put`으로 넣는다. coding agent에게는 격리 HOME으로만 넘긴다. check와 e2e는 `.env`를 읽지 않는다.
- trial마다 `createRun`으로 새 root와 새 harness HOME을 만든다. `~/.lophn`, 사람의 root, 사람의 harness 설정을 쓰지 않는다.
- 진짜 provider는 사람이 돌리는 `deno task eval`에서만 부른다. CI, cron, `land.sh`에 넣지 않는다.
- 제품에 eval 전용 flag나 env를 두지 않는다. 길은 제품 route와 launch plan뿐이다.
- record 전체(대답 글, harness 기록)는 git 밖 `.dev-data/eval/`에 둔다. scorecard에는 숫자와 떨어진 이유만 둔다.

## case 고르는 규칙

1. case는 lophn에서 뽑는다: AGENT-ROLE 항목, role 지침의 줄, architecture의 "지키는 것", lophn의 bug·이슈 기록, 위 "찾은 빈틈". 다른 harness의 시나리오를 옮기지 않는다. 다른 harness는 만드는 법을 볼 때만 쓴다. bug·이슈 기록에는 진짜 model의 판단이 아직 없으므로, eval이 찾은 실패가 다음 case의 출처가 된다.
2. program이 이미 막는 것은 재지 않는다(grant, Gate, role의 tool 목록, 폴더 scope, `operatorPlaceAllowed`). pass 조건은 그 agent의 tool로 어길 수 있는 것만 된다.
3. 결과를 채점한다: call의 받는 쪽과 답 방식, ticket, disk, app-api의 대답, problem, 질문·허락. 순서는 순서 자체가 규칙일 때만 본다(`blueprint.check` 뒤에 넘기기, 고친 release가 active가 된 뒤에 resolved로 바꾸기). 글은 단정하지 않는다.
4. AGENT-ROLE의 "(제안)" 줄에서 나온 case는 표시한다. 그런 case가 떨어지면 model보다 그 줄이나 지침이 틀렸을 수 있다.
5. 확인이 위 "찾은 빈틈" 때문에 떨어지면 scorecard에 제품 탓으로 따로 적는다.

## 정할 것

1~8은 근거로 정한 추천이다(agent). 9~13은 사람이 정한다.

1. **자리**: `tests/eval/`(`run.ts`, `materials/`, `scenarios/`, `cases/`, `scorecards/`). check는 `tests/` 전체에 fmt, lint, type check를 이미 돌므로 `tools/check.ts:43`의 `NOT_IN_CHECK`에 한 줄만 더하면 된다.
2. **채점**: program 판정만 쓴다. 첫 판에는 LLM judge가 없다. 앱 화면의 질처럼 program이 볼 수 없는 것은 첫 판에서 재지 않는다.
3. **반복**: 작은 판단 case는 3번 돌려 통과 수/3을 남긴다. 사슬 시나리오는 비용 때문에 기본 1번이고, `--trials`로 늘린다. "늘 통과 / 대개 통과" 둘로 나누지 않는다. eval은 아무것도 막지 않기 때문이다.
4. **coding agent의 길**: PTY에서 띄우는 interactive harness다. headless는 App Engineer와의 대화가 끊긴다.
5. **재료를 되살릴 때**: fake 대본을 쓴다. 진짜 model은 시나리오의 `real`에만 붙인다.
6. **재료 버전**: 정수 `n`과 content hash로 매긴다. 결과는 runner가 새 `n`으로 쓰고, 사람이 보고 commit한다.
7. **비용 장치**: role agent는 settings `lophn-agent.run.model_attempts`와 runner의 실행 상한(`modelCallList` cost를 더해 넘으면 멈춤)으로 묶는다. coding agent는 driver의 시간 상한과 token 상한으로 묶는다.
8. **provider**: 처음에는 API key만 쓴다. 구독 OAuth는 root를 복사할 수 없어 trial마다 새 root를 쓰는 eval과 맞지 않는다.
9. **PM 지침 모순**(제품 동작): 경계를 긋는 일과, 계약 위반 때 계약·문서 중 무엇을 고칠지를 PM이 정하는가, 사람에게 묻는가.
10. **찾은 빈틈을 언제 고치나**(제품 동작): 재사용을 찾을 길(내장 SDK를 catalog에 올리기, 다른 앱의 app-api를 보여 주는 tool)과 진단 재료(보고 message와 details, log)를 eval 전에 고치나, 재고 나서 고치나. 고치기 전에 재면 기준선이 남는다. 대신 S1의 재사용 확인과 S4는 떨어질 것을 알고 돈을 쓰게 된다.
11. **coding agent harness**(비용): 무엇으로 잴까(claude, codex, opencode). 로그인은 key로 하나.
12. **model과 실행 상한**(비용): role agent와 coding agent의 model, 한 번 돌릴 때 상한, 계획 중에 worker와 lead가 진짜 provider를 얼마나 불러도 되나.
13. **순서**(제품 우선순위): 아래 "단계"의 계획 셋을 이 순서로 할까.

## 단계

eval 밖의 제품 고치기는 따로 계획을 열었다. 지침 정리(PM 모순, `ROLE_LINE`, template `AGENTS.md`, observation 지침)는 `prompt-text`가 맡는다. 재사용을 찾는 길과 진단 근거는 `reuse-diagnose`가 맡는다.

1. **계획 `eval-base`**(brief를 썼다가 뺐다. `e1787ca94:project-docs/plan/eval-base/`): runner, 공통 수치 collector, 재료, 진짜 provider 연결 helper, scorecard, `wrong` 확인, 작은 판단 case 17개.
2. **계획 `eval-coding`**
   - PTY driver, 격리 harness HOME, `lophn` wrapper, coding agent 수치 parser. claude부터 한다.
   - codex는 `project-docs/issues/coding-agent.md`의 hook trust 이슈를 같이 본다.
   - `reuse-world@1`, S1~S3, 재료 `calendar-app@1`·`@2`.
3. **계획 `eval-reuse-diagnose`**: `reuse-diagnose`가 land한 뒤에 연다. S1의 재사용 확인, observation 확인, S4를 잰다.
4. 계획마다 끝에 고칠 것: `architecture/testing.md`(eval 층, 돌리는 때), registry `tool-eval`, module-catalog `tests`의 notes, `write-test` skill의 층 목록.

## 끝남 기준

- `deno task eval`은 key가 없으면 이유를 찍고 0으로 끝난다.
- `deno task eval --case <id> --model <name>`은 재료를 되살리고 시나리오를 돌린 뒤, scorecard에 공통 수치와 확인 결과를 남긴다.
- runner는 provider를 부르기 전에 재료의 hash를 확인하고, 모든 case에서 grader가 `wrong` record를 떨어뜨리는지 본다.
- `calendar-app@1`이 재료로 commit되어 있고, S2·S3·S4는 그 재료에서 시작한다.
- `deno task check`가 `tests/eval`을 돌지 않는다.

## 하지 않는 것

- LLM judge, CI, cron, nightly.
- 녹화 재생으로 판단 재기. 재는 것이 판단 자체라 재생은 뜻이 없다.
- headless harness. data root 통째 복사.
- 제품의 eval 전용 flag.

## 선례 (만드는 법만)

조사 자료는 `git show ef3cf4ea5^:project-docs/plan/testing/research/<file>`로 본다.

- Gemini CLI `evals/`: test와 따로 둔 층이다. model마다 3번 돌려 채점한다. tool 인자와 정확한 값을 단정하고 글은 단정하지 않는다. "Less is more", "Fail first".
- Anthropic 글: 처음에는 20~50 task, 경로가 아니라 결과를 채점, trial마다 깨끗한 환경.
- Block: 진짜 LLM을 부르는 test는 CI에 넣지 않는다.
- hermes: eval을 tests와 따로 두고, 날짜가 붙은 scorecard를 commit한다. test당 token·금액 상한을 둔다.
