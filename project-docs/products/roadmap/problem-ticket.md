# problem과 ticket 덜어내기: App Engineer가 직접 짓고 고친다

상태: 로드맵. 2026-10-20 사람이 problem과 ticket 모델이 너무 빡빡하다며 방향을 냈다. 2026-10-21 "최대한 덜어낸다"로 정하고, 낮은 수준의 선택은 planner에게 맡겼다. 같은 날 "lophn agent는 코드를 짜지 않는다"를 고쳐 App Engineer가 앱을 직접 짓기로 정했다. planner가 정리했다. 단계 1 `problem-remove`가 land했다(problem 모델, 보고 길, reaction 다섯, feedback, 앱 상세 issues 화면, 저장하는 kind 위반이 없어지고 앱 log가 file이 됐다). 아래는 남은 단계의 것이다.
배경 문서: `project-docs/architecture/coding-agent.md`, `project-docs/architecture/activation.md`, `project-docs/architecture/testing.md`, `project-docs/architecture/event.md`, `project-docs/architecture/annotation.md`, `project-docs/products/AGENT-ROLE.md`(A1~A16, K1~K5, T20, 5절, 6절), `project-docs/products/roadmap/approval.md`, `project-docs/products/roadmap/workflow.md`.

## 왜

- **소프트웨어 공학의 절차를 program 규칙으로 박아 두었다.**
  - problem은 open/resolved/ignored 상태 machine이다. program이 "고친 release 전에는 닫지 못한다"와 "고친 뒤 다시 나면 다시 연다"를 지킨다.
  - ticket은 claim → 연장 → 만료 → 완료 보고 → examples 검증 → 확인됨 → activation으로 이어지고, 그 사이를 domain event 7개와 reaction이 잇는다.
- **규칙 하나하나가 agent가 외울 계약이고, 규칙끼리 부딪힌다.**
  - 찾은 사고 17건의 대부분이 "agent가 볼 수 없는 program gate"나 "규칙 둘의 충돌"이었다(아래 "사고").
  - 고친 방식은 대개 규칙이나 지침 줄을 하나 더하는 것이었다.
  - App Engineer 지침 241줄 가운데 11줄 이상이 program gate를 설명하려고 있다.
  - 2026-10-10 뒤 commit 2005개 가운데 285개가 이 흐름을 건드렸다.
- **ticket으로 넘기면 context를 잃는다.** 앱과 그 앱에 필요한 context(사람의 말, domain, 앱 log와 기록)는 App Engineer가 훨씬 잘 닿는다. 맡기는 call 본문은 지금 coding agent에게 가지도 않는다.
- **agent가 메타 소프트웨어 엔지니어링을 보조해도 지금 모양은 아직 너무 무겁다.** 계약, 모양, 로직, tool을 덜어내고 agent의 책임을 높인다.

## 모양

### lophn이 아는 것: runtime 경계에서 원래 하던 것

모두 이미 있고, 앱의 domain을 모른다.

- **앱 log**: 받고, 앱마다 file로 남기고, invocation에 묶고, redaction한다. 예외 stack은 원래 source 줄로 풀어 쓴다.
- **invocation 기록**, changeset, 앱 rewind
- **release**: 준비, data를 잃지 않게 하는 검사(migration, 의존성, blueprint와 handler 일치), activate, 앞 release로 되돌리기. 검사는 release 준비가 그 자리에서 한다. 따로 도는 test runner는 없다. 사람의 동의는 `approval.md`가 정한다.
- **preview**: 봉인된 bundle을 fixture data로 띄우고 tool을 부른다.
- **앱 상태**: 돌고 있나, crash, 재시작 멈춤

### 새로 더하는 것

- **App Engineer가 위 실행을 tool로 쓴다.** preview 띄우기와 그 tool 부르기, release 준비다. 앱 log, invocation, 상태 읽기(`app.logs`, `app.invocations`, `app.status`)는 `problem-remove`가 열었다.

### agent가 맡는 것

- **App Engineer가 앱을 직접 짓고 고친다.** 설계(재사용 → 모델 → journey → 화면 → tool), 코드, release 준비, preview에서 확인, `release.activate`까지 한다. 설계는 앱 source에 file로 둔다.
- 지금은 App Engineer가 coding agent에게 일을 맡기지 않는다. 그 흐름을 막는다. coding agent 연결을 어떻게 남길지는 보류다(아래 "정할 것" 1).
- 무엇을 log에 남길지, 오류를 어떻게 읽고 묶을지, 고쳐졌는지, 언제 고칠지
- doctor, health, trace, metric이 필요한지. 필요하면 App Engineer가 앱 tool과 log로 짓는다. lophn은 그 이름도 모양도 모른다.
- 같은 일을 두 session이 맡지 않게 하는 것

### program이 agent를 부르지 않는다

- reaction 여섯을 모두 지운다: 문제 열림, 문제 다시 열림, 재시작 멈춤, activation 실패, kind 위반, 공개 tool 바뀜.
- 사람에게는 지금처럼 toast로 알린다. toast에 쓰는 사실(재시작 멈춤, kind 위반)은 Reactor가 반응하지 않으므로 남지 않는 event로 옮긴다(`architecture/event.md`의 "domain event는 그 뒤에 꼭 움직여야 하는 일에만").
- 정기적으로 앱을 살피게 하고 싶으면 사람이 시킨다. job이나 workflow로 짓는다(`headless-schedule.md`, `workflow.md`). 시킨 것이 승낙이다(`approval.md`).
- activation 실패는 `release.activate`를 부른 App Engineer에게 결과로 돌아간다.
- coding session이 끝나면 맡긴 call이 닫히고, 맡긴 App Engineer에게 마지막 메시지와 함께 한 번 알린다. 맡긴 call을 닫는 사실이라 지금처럼 끌 수 없다.

## 지우는 것

| 지우는 것 | 대신 | 지금 크기·자리 |
|---|---|---|
| 남은 reaction `ReleaseActivationFailed`, reaction 설정 화면 | 없음. activation 실패는 `release.activate`의 결과로 돌아간다 | `packages/core/events/reactor/session-opening.ts` 222, `packages/shell/renderer/desktop/settings/reactions/` |
| ticket(표 6개, claim, 연장, 만료, 완료 보고, 검증 기록, verdict) | call 본문. 길면 file | `packages/core/apps/tickets` 4,057의 대부분, `packages/protocol/coding-agent/ticket` 565 |
| examples gate와 그 실행기, `VerificationRecorded`, `TicketVerified` | App Engineer가 preview에서 확인하고 `release.activate` | `packages/core/problems/tests`의 examples 부분, `apps/tickets/checker` |
| rewind 증명 사슬: platform `rewind` 검사, examples changeset 되감기, app test pass 이유의 증명 못 함 줄 | 없음. changeset과 앱 rewind 자체는 남는다 | `packages/core/problems/tests/unproven.ts` 등 |
| release와 ticket의 묶음: 준비의 claim 검사, `releases.ticket_source`, 보고의 release 대조, activation의 `TicketVerified` 계기 | 준비는 App Engineer가 한다. activate는 App Engineer의 command | `packages/core/apps/releases/commands.ts:98-139`, `activation/handler.ts` |
| ticket의 tool과 CLI 명령 | App Engineer의 preview tool | `packages/core/apps/agent-tools/ticket.ts`, `packages/protocol/coding-agent/cli-commands.ts` |
| 앱 상세의 ticket 화면 | 없음. 사람은 App Engineer에게 묻는다 | `packages/shell/renderer` |
| test runner: 요청 기록과 한 번만 시작하기, `test_requests`·`test_side_starts`·`verifications`·`test_evidence` 표, frozen test, 증거 blob, runner worker, `RecordVerification`, 준비와 마무리의 두 단계 | release 준비가 그 자리에서 확인한다. 의존성은 manifest로, migration은 activation과 같은 `migrateAppDatabase`를 fixture DB에 걸어서, blueprint와 handler 일치는 preview launcher로 봉인된 bundle을 띄워 tool을 찔러서 본다. 앱 test는 App Engineer가 앱 source에서 shell로 돌린다 | `packages/core/problems/tests` 7,352, `packages/core/apps/releases/finalizer.ts` 190, `preparation.ts` 143, `packages/protocol/problems/tests.ts` 428 |
| Reactor, cursor, reaction 멱등 key | 없음. coding session 끝은 그 command가 바로 call을 닫고, 켤 때 sweep이 남은 것을 닫는다 | `packages/core/events/reactor/` 521, cursor와 wiring을 합쳐 약 1.0k |
| 공개 tool 막기(`activation.block`, `PublicToolsChanged`) | release 준비가 "다른 domain이 쓰는 공개 tool을 지운다"를 알려 주기만 하고, 주인인 App Engineer가 정한다 | `packages/core/apps/releases/public-tools.ts` 186, `releases/commands.ts:248-297` |

- 크기는 다 합쳐 만 줄을 넘는다. test runner만 약 6천 줄이 줄고, 남는 검사는 1천 줄 안쪽이다(2026-10-21 조사의 추정).
- domain event 12개는 모두 빠진다. 다만 `events` 표는 Reactor의 일감 목록만이 아니라 앱 상태 기록(`AppStarted` 등)과 compare token으로도 쓰여서 남는다.
- 옛 표, event, route, test는 migration 없이 지우고 새 설계로 다시 쓴다(AGENTS.md "호환성").

## 지금 코드

- **앱 log**는 앱마다 file(`<data root>/apps/<app>/logs/app.log`, 돌린 `app.log.1`, 합쳐 16 MiB)이다. 쓰는 쪽은 app supervisor 하나이고, `app.logs`가 file을 읽는다(`packages/protocol/apps/app-log.ts`).
- **invocation 기록**은 tool call 하나마다 시작과 끝, 상태, 부른 쪽, 효과를 남긴다(`packages/core/apps/invocations/schema.ts`). 성공한 read는 남기지 않는다(`architecture/app-call.md`).
- **ticket 규칙**
  - 표 6개, 상태 6개(`open, claimed, reported, verified, failed, cancelled`)
  - claim 1시간에 60초마다 만료를 쓸어 낸다(`packages/core/apps/tickets/expiry.ts`).
  - 넘기기는 `open|failed`만 받는다(`coding/transport.ts:43-57`).
- **release와 activation**
  - release 준비에 지금 claim이 있어야 한다(`packages/core/apps/releases/commands.ts:98-139`).
  - 마무리에 같은 bundle의 app_test pass가 있어야 한다(`finalizer.ts`). platform 검사는 `blueprint_handler_match`, `dependencies`, `migration_empty`, `migration_upgrade`, `rewind`다(`packages/core/problems/tests/harness/definitions.ts:14-22`).
  - activation의 유일한 계기는 `TicketVerified`다(`activation/handler.ts:81`). activate 기계 자체(`activation/` 2,125줄 가운데 `handler.ts` 151줄 말고 나머지)는 ticket과 상관없는 primitive다.
- **App Engineer에게 없는 것.** 앱 log, invocation, 상태, test, preview는 coding agent CLI에만 있다(`packages/protocol/coding-agent/cli-commands.ts:157-192`).
- **coding agent에게 가는 것.**
  - Router의 `launchCoding`은 ticket id만 넘기고, 첫 prompt는 "ticket을 읽어라"뿐이다. 맡기는 call의 본문은 coding agent에게 가지 않는다.
  - 그래서 0.6.0에서 App Engineer의 설계를 ticket goal에 싣게 하고, goal 한도를 2,000자에서 16,000자로 올렸다(`products/change-log/0.6.0.md`).
- **App Engineer는 코드를 쓸 수 있지만 release는 못 낸다.** `file.write`, `file.edit`, `shell.run`으로 앱 source를 고친다. 그러나 release 준비는 coding agent의 claim 없이는 core가 거절한다(`checkPreparationClaim`).

### 사고 (2026-10-20 조사, 다 찾은 것은 아니다)

| 출처 | 원인 | 고친 방식 |
|---|---|---|
| `products/change-log/0.6.0.md` | 두 coding session의 같은 `request_key` test 요청이 부딪혀, 둘째가 log 없이 영영 다시 시도함 | 규칙 더함 |
| `products/change-log/0.6.0.md` | 실패한 examples가 `rewind_unproven`을 내 App Engineer가 둘이 되고, 같은 ticket을 서로 반대로 고침 | 규칙 지움 |
| `products/change-log/0.6.0.md` | examples `expect` 모양을 agent가 모름. examples는 active 전 release라 다른 앱 tool을 못 부름 | 지침 |
| `issues/coding-agent.md:21-30` | `reported` ticket을 다시 넘기면 맨 `unavailable`. 앱이 끝내 live가 되지 못함 | 지침. 이슈 열림 |
| `issues/coding-agent.md:32-42` | 첫 넘기기 전 blueprint 선언과 "source 폴더는 첫 넘기기 때 만든다"가 부딪힘 | 지침. 이슈 열림 |
| `issues/archived/activation.md:163-217` | rewind 검사가 지어낸 입력으로 write tool을 불러 맞는 앱이 막힘 | 규칙 더함. 계획 넷 |
| `issues/archived/problems.md:88-112` | agent가 고친 release 없이 닫아, 다시 나도 아무도 모름 | 규칙 더함(A16) |
| `issues/archived/coding-agent.md:347-382` | ticket check `test_command`에 runner가 없음 | 규칙 바꿈(examples) |

## 정한 것 (사람)

- (2026-10-20) problem과 ticket 모델은 너무 빡빡하고 program이 처리하기 어렵다. 메타 소프트웨어 엔지니어링을 agent가 보조해도 지금은 너무 무겁다.
- (2026-10-20) 계약, 모양, 로직, tool을 최대한 느슨하게 하고 agent의 책임을 높인다. lophn은 agent가 앱의 관측성, 진단, trace, doctor를 만들고 다룰 수 있는 primitive로 두고, 나머지는 agent에게 맡긴다.
- (2026-10-20) 앱 problem이 생기면 App Engineer를 자동으로 여는 흐름을 지운다.
- (2026-10-21) 최소한의 tool, 규격, UI만 둔다. 최대한 덜어낸다. 낮은 수준의 선택은 planner에게 맡긴다.
- (2026-10-21) "lophn agent는 코드를 짜지 않는다"를 바꾼다. lophn agent가 하지 않는 것은 길고 복잡한 coding agent의 일이다.
  - lophn에서 만드는 앱과 그 앱에 필요한 context는 App Engineer가 훨씬 잘 닿는다. ticket으로 넘기며 context를 잃을 필요가 없다.
  - 개인 앱은 규모가 작아 코딩용 최적화의 부담도 적다.
  - workflow에서도 lophn agent가 직접 코딩한다.
- (2026-10-21) lophn program이 test runner를 알고 돌리는 것도 지운다. 앱의 test는 App Engineer가 앱 source에 짓고 직접 돌린다. data를 지키는 검사는 release 준비 안으로 옮긴다(아래 "정한 것(agent)").
- (2026-10-21) eval과 e2e test는 이 개편 동안 고치지 않는다. 다 바뀐 뒤 e2e를 고치고 eval을 돌린다.
- (2026-10-21) 지금은 App Engineer가 coding agent에게 외주를 주는 흐름을 막는다. coding agent 연결을 얼마나 남길지(B-lite, B)는 보류한다. 뒤에 workflow에서 coding agent 같은 다른 harness를 불러와야 할 수 있기 때문이다.

## 정한 것 (agent, 사람이 맡김)

- **reaction 여섯을 모두 지운다.** 근거: program이 agent를 부르지 않는다. 사람에게는 toast가 남는다. 이로써 `approval.md`의 reaction 부분과 그 "정할 것" 2가 없어진다.
- **보고 길을 log로 합친다.** log를 앱마다 file로 남기고, 예외 stack의 source map 풀이만 log 쪽에 붙인다. 근거: agent가 볼 곳이 하나가 된다. 보고 길이 주던 것 가운데 잃으면 안 되는 것은 "재시작 뒤에도 남음"과 "원래 source 줄"뿐이다.
- **ticket을 지운다.** App Engineer가 직접 지으니 넘길 문서가 필요 없다. coding agent에게 맡기는 흐름도 지금은 막는다. 근거: 무엇을 맡겼는지는 call 기록과 session 대화에 이미 남는다.
- **examples gate와 그 실행기를 지운다.** App Engineer가 preview에서 tool을 직접 불러 확인한다. 근거: preview가 이미 fixture data로 격리된 앱을 띄운다. 같은 일을 하는 실행기가 둘일 이유가 없다.
- **rewind 증명 사슬을 지운다.** changeset 기록과 앱 rewind는 남긴다. 근거: 계획 넷과 commit 60개 넘게 쓴 마찰이다. 잃는 것은 changeset에 안 잡히는 효과를 내는 tool을 미리 알려 주는 장치다.
- **사람의 feedback을 지우고 annotation으로 둔다.** 근거: 둘 다 사람이 앱 화면에서 App Engineer에게 문제를 알리는 길이다.
- **doctor, health, trace, metric과 그 규격과 상태 화면을 만들지 않는다.** 근거: 그런 tool은 그냥 앱 tool이고 agent는 이미 앱 tool을 부른다. lophn이 이름과 모양을 알 이유가 없다.
- **activation 계기는 App Engineer의 `release.activate`다.** 근거: ticket이 없으면 남는 계기가 없다. 앱의 주인은 App Engineer다(AGENT-ROLE P5).
- **release 준비는 App Engineer가 한다.** 근거: claim이 없어지고, App Engineer가 직접 짓는다.
- **coding session 끝은 하나다.** 근거: 완료 보고, 만료, 보고 없는 끝 셋 모두 "맡긴 call이 닫혔다"이고, 다음 일은 App Engineer가 마지막 메시지를 보고 정한다.
- **redaction, data 검사(migration, 의존성, blueprint), changeset과 rewind는 program에 남긴다.** 근거: AGENTS.md가 secret 경계와 사용자 data를 잃는 규칙을 지키라고 한다.
- **kind 검사 자체는 program에 남기고, 저장하는 위반 기록만 지운다.** 근거: 문서와 `kinds.yaml`의 대조는 PRODUCT 3절이 program의 몫으로 든 예다. 저장된 행을 읽는 곳은 `problem.list`의 domain 갈래뿐이고 `kind.check`와 겹친다. 잃는 것은 "해결됨/다시 열림" 이력이다.
- **test runner의 data 검사는 release 준비 안에서 바로 한다.** 근거: 사람이 "lophn이 test runner를 알고 돌리는 것"을 지우기로 했다. 남는 검사(의존성, migration, blueprint와 handler)는 앱 test가 아니라 release가 data를 잃지 않게 하는 일이다. migration은 activation과 같은 코드(`migrateAppDatabase`)를 쓰고, activation의 backup과 되돌리기가 그 뒤를 지킨다. 잃는 것은 "이 bundle이 이 검사를 통과했다"는 위조 못 하는 증명 기록과 runner의 재시도와 복구 상태다.
- **Reactor를 지운다.** 근거: 네 roadmap이 land하면 반응할 domain event가 하나도 남지 않는다. 마지막 후보인 "coding session 끝"은 그 command가 같은 tx에서 call을 닫을 수 있고(`coding/close-call.ts`는 event 없이 닫는 길이 있다), 꺼졌던 사이의 것은 켤 때 sweep이 닫는다. 5초 poller와 "handler 이름이 멱등 key의 일부" 같은 함정도 같이 없어진다.
- **공개 tool 막기를 알림으로 바꾼다.** 근거: 막기는 쓰는 쪽을 깨우는 reaction과 짝이었다(`architecture/domain.md`). reaction이 없으면 agent가 이유를 모르는 gate가 된다. 잃는 것은 다른 domain을 깨뜨리는 release를 막는 바닥이다. 쓰는 쪽은 부를 때 `not_found`로 알게 된다.
- **source 폴더 만들기는 `app.create`로 옮긴다.** 근거: 지금은 첫 넘기기 때 만들어서(`scaffold-source.ts`), App Engineer가 직접 지으면 폴더가 없다(`issues/coding-agent.md:32-42`).

### App Engineer 혼자 코딩한 실험 (2026-10-21)

다른 session이 사람의 지시로 한 일회성 실험이다. repo에는 남기지 않았다. 같은 요청이고, 둘 다 `claude-sonnet-5-5`, n=1이다.

| | 시작→확인 | 코딩 쪽 model call | 비용 |
|---|---|---|---|
| coding agent가 코딩 | 7.6분 | 72 | 약 $1.34(run 전체 약 $1.80) |
| App Engineer가 코딩 | 16.5분 | 85 | $5.36(run 전체 약 $6.93) |

- App Engineer의 첫 commit은 더 빨랐다(약 3분). 그러나 release가 coding agent의 claim에 묶여 다섯 번 오갔다.
- 제품 기본 turn 한도는 model call 30번(`packages/protocol/lophn-agent/turn-values.ts:77-81`)이고 eval은 15번이다. 이 한도로는 App Engineer가 앱 하나를 한 turn에 짜지 못한다.
- 비용 차이의 대부분은 lophn agent runtime이 Anthropic 요청의 system에만 cache 표시를 다는 것에서 왔다. 대화는 매번 cache 없이 매겨진다(`issues/agent-definition.md`).
- 입력 없는 tool의 "입력 없음 / `null` / `{}`"을 검사가 엄격히 구별해 agent가 하루 세 번 걸렸다.
- 직접 짜는 길에서는 설계를 건너뛰어 화면이 목록이 됐다.

## 정할 것

1. **coding agent 연결을 얼마나 남길까. (보류, 사람 2026-10-21)** 지금은 App Engineer가 맡기는 흐름을 막는다. 뒤에 workflow에서 coding agent 같은 다른 harness를 불러와야 할 수 있어, 크기는 그때 정한다. ticket을 지운 뒤에도 그 길은 약 8~9천 줄이다: PTY launch, hook에서 읽는 상태, 도는 중의 메시지 줄, harness 물음 비추기, 사람 home에 skill과 hook 설치, coding token과 CLI, Settings의 coding agent 화면.
   - **B-lite**: harness 설치, 감지 화면, guide를 지운다(약 2천 줄). hook, 메시지, CLI는 남긴다. 잃는 것: 사람 home에 자동 설치와 감지 화면.
   - **B**: coding agent를 한 번 띄우는 PTY로만 쓴다. call 본문이 첫 prompt가 되고, process가 끝나면 call이 닫힌다. 결과는 App Engineer가 앱 source의 file과 git diff로 읽는다. lophn CLI, hook, `packages/coding-agent`가 없어진다(약 5~6천 줄 더).
     - 잃는 것: 도는 중에 App Engineer와 coding agent가 주고받는 메시지, 돌기와 기다림 표시, harness 물음 비추기.
     - `approval.md`의 "unattended면 lophn이 hook으로 받은 harness 물음에 shell 규칙으로 답한다"(사람이 고른 C)가 hook 없이는 안 된다. B로 가면 그 자리는 "unattended면 harness의 skip을 켜고 띄운다"가 된다.
   - 사람이 터미널 탭에서 자기 coding agent를 쓰는 길(PRODUCT 6절)은 둘 다 그대로다.

## 단계

- eval과 e2e test는 이 계획들에서 고치지 않는다(사람, 2026-10-21). 앞으로도 크게 바뀌므로, 다 바뀐 뒤 e2e를 고치고 eval을 돌린다. 그동안 `tests/e2e`와 `tests/eval`은 `deno task check`에서 뺀다.
- 계획 셋으로 연다. 첫째는 `approval-simplify`보다 먼저 연다. reaction이 없어지면 approval이 더 작아진다.
  1. `problem-remove`: land했다.
  2. `ae-builds`
     - 먼저 App Engineer가 코딩하는 데 걸리는 것을 고친다(위 실험).
       - turn 한도를 앱 하나를 짓는 데 맞게 올린다.
       - 대화를 cache한다(`issues/agent-definition.md`).
       - 입력 없는 tool의 `없음 / null / {}` 구별을 느슨하게 한다.
       - 지침에 "짓기 전에 설계한다"를 둔다.
     - ticket, claim, examples gate, 검증 기록, rewind 증명을 지운다.
     - test runner를 지우고 남는 검사(의존성, migration, blueprint와 handler)를 release 준비 안으로 옮긴다. 준비와 마무리의 두 단계도 하나로 합친다.
     - release를 ticket에서 뗀다. App Engineer가 release를 준비하고 `release.activate`로 올린다. source 폴더 만들기를 `app.create`로 옮긴다.
     - 공개 tool 막기를 release 준비의 알림으로 바꾼다.
     - App Engineer에게 preview tool을 연다(`problem-remove`에서 옮겼다).
     - 남은 reaction `ReleaseActivationFailed`와 reaction 설정 화면을 지운다. activation 실패는 `release.activate`의 결과로 돌아간다.
     - App Engineer가 coding agent에게 맡기는 흐름을 막는다. 지침과 tool 설명에서 지우고, call의 받는 곳 `coding_agent`를 받지 않는다. 연결 장치(launch, hook, CLI, 설치)는 "정할 것" 1의 보류가 풀릴 때까지 두고, ticket에만 쓰이던 CLI 명령과 event는 지운다.
     - 열린 이슈 `issues/coding-agent.md`의 "examples가 떨어진 reported ticket을 다시 넘기면 `ticket_unavailable`"은 ticket과 함께 닫힌다.
     - App Engineer 지침을 다시 쓴다(설계, 코딩, release, 확인). coding agent skill `lophn-build-app`은 ticket 절차라 지운다(`lophn-repair`는 `problem-remove`가 지웠다).
  3. `reactor-remove`: `problem-remove`, `ae-builds`, `approval-simplify`가 모두 land한 뒤 연다. 남은 domain event가 없으면 Reactor, cursor, 멱등 key를 지우고, coding session 끝은 그 command와 켤 때의 sweep이 닫는다. program call의 `from.event_seq`를 없앤다.
- 화면을 지우거나 바꾸는 것은 `ui-design` skill로 wireframe부터 고친다.

test(AGENTS.md "속도", `write-test` skill):
- migration 검사에 떨어진 release는 activate되지 않는다.
- (log file의 redaction과 상한 test는 `problem-remove`가 썼다: `packages/core/apps/runtime/observations/log-file_test.ts`)

계획 끝에 고칠 것:
- `architecture/coding-agent.md`, `architecture/activation.md`, `architecture/testing.md`, `architecture/event.md`, `architecture/domain.md`(공개 tool 막기)
- `project-docs/products/AGENT-ROLE.md`: P6, P8, L4, A1~A16, K1~K5, T20, 5절 그림, 6절
- `project-docs/boundary-catalog.yaml`(`app-tickets`, `problems`의 test runner 몫), `project-docs/module-catalog.yaml`
- `project-docs/PRODUCT.md` 6절의 MVP 목록("ticket"). 3절과 5절의 "코드를 짜지 않는다"는 2026-10-21에 이미 고쳤다.
- changelog 열린 판

## 끝남 기준

- 앱이 오류를 내도 agent session이 저절로 열리지 않는다. 사람에게는 toast가 뜬다.
- 사람이 App Engineer에게 "앱 봐 줘"라고 하면, App Engineer가 앱 log(재시작 뒤 것까지, 예외는 원래 source 줄로)와 invocation을 직접 읽고 진단한다.
- App Engineer가 사람의 말에서 앱을 설계하고, 직접 짓고, release를 준비하고, preview에서 확인한 뒤 `release.activate`로 올린다. coding agent, ticket, claim, 검증 기록 없이 한 바퀴가 돈다.
- migration이 data를 잃는 release는 여전히 막힌다.

## 하지 않는 것

- **doctor, health, trace, metric을 lophn의 개념과 규격과 화면으로 두기.** 하지 않는다는 뜻이 아니다. 필요한 앱마다 App Engineer가 앱 tool과 log로 짓고, lophn은 그 재료(앱 log, invocation 기록, 앱 tool 부르기, preview)를 준다.
- **program이 오류를 보고 agent를 부르기.** 사람이 시키거나, 사람이 지은 job과 workflow가 한다.
- **"고쳐졌나"를 program이 판정하기.**
- **같은 일을 두 session이 맡는 것을 program이 막기.**
