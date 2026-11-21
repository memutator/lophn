# machine-a2a: 다른 기계의 agent에게 일을 맡긴다

- 목표: 한 컴퓨터의 agent가 명단에 든 다른 컴퓨터의 agent에게 call을 보내고 답을 받는다. 닿지 않으면 맡겨 두었다가 늦게 닿고, 늦게 온 것은 사람에게 묻고 돈다. session이 남긴 handoff note가 다른 기계로 흘러 그 기계에서 이어 연다.
- 재료: `project-docs/products/roadmap/a2a-multi-device.md`(정한 것 1~16), `project-docs/products/roadmap/a2a-access.md`(정한 것 1·2: 목록, 명함, 부르는 길), `project-docs/architecture/agent-call.md`, `project-docs/architecture/remote.md`(내 기기 명단, link, `machines/call`), `project-docs/architecture/approval.md`("다른 기계로 넘긴 call"), `project-docs/architecture/app-call.md`(다른 컴퓨터의 앱 call), `project-docs/architecture/event.md`(`across_machines`), `project-docs/architecture/folder-sync.md`, `project-docs/architecture/job.md`(hold), `project-docs/architecture/project-identity.md`, `project-docs/architecture/attention.md`.
- 범위 밖: `team spawn`이 기계를 건너기(roadmap 4단계), 한 기계 안의 call 전달을 바꾸기, agent 정의를 기계 사이에 맞추기, transcript와 code 옮기기, 받은 일을 또 다른 기계로 넘기기.
- 본보기: 다른 컴퓨터의 앱 command 호출(`packages/core/apps/calls/forward.ts`, `packages/core/apps/calls/remote-entry.ts`). mail은 같은 자리에 선다: 보내는 쪽 검사, `machines.call`의 `by: agent`, 받는 쪽 입구, 그 기계의 Router. 본보기와 다른 점은 아래 줄마다 적었다.

## 정한 것

roadmap의 "정한 것" 1~16을 그대로 따른다. 아래는 lead가 구현을 위해 더 정한 것이다.

- **받는 쪽 입구는 기기 route를 더한다**(`REMOTE_AGENT_ROUTES`). 받는 쪽은 명단의 컴퓨터인지, 받는 workspace가 private인지, 만료를 본다. 본보기와 다른 점: 터미널 입력 허락을 보지 않는다(roadmap 정한 것 5). 허락은 skip을 따를지에만 쓴다(roadmap 정한 것 16).
- **보내는 쪽 검사**는 본보기와 같다: 보내는 workspace가 private이면 거절하고, 받은 mail로 열린 session은 다른 기계로 보내지 못한다.
- **mail은 응답을 기다리지 않는다.** 보내는 명령은 mail을 outbox에 넣고 call id를 바로 돌려준다(지금 `call send`와 같다). 본보기와 다른 점: link의 command lane을 turn이 끝날 때까지 쥐지 않는다.
- **outbox는 ledger 표다.** 상대 기계마다 순번을 매기고, 받는 쪽이 ack하고, 같은 mail id는 한 번만 적용한다. 본보기와 다른 점: 본보기는 기록 표(`app_remote_calls`)만 있고 다시 보내지 않는다. mail은 닿을 때까지 남는다.
- **reply, 실패, 취소도 mail이다.** 받는 기계의 Router가 낸 결과가 그 기계의 outbox로 보낸 기계에 돌아가 보낸 session의 새 입력이 된다.
- **결과를 모르는 mail은 다시 적용되지 않는다.** 다시 보내도 받는 쪽이 id로 걸러 한 번만 돈다. 보낸 쪽 call의 상태에 "아직 닿지 않음", "대기 목록에서 기다림", "모름"을 더한다.
- **늦게 온 mail.** 보낸 시각보다 10분 넘게 늦게 닿은 mail은 돌지 않고 대기 목록 card로 선다(job의 `hold`가 놓친 차례를 가르는 10분과 같다). [Start now]면 돌고 [Skip]이면 보낸 쪽 call이 실패로 닫힌다. 만료는 7일이다.
- **주소.** `to`에 기계가 붙는다. workspace는 project면 `pri_`, 앱이면 앱 id, Home이면 그 기계의 Home이다. 받는 기계에 그 project가 없으면 없다고 답한다.
- **목록과 명함.** agent는 `--on <컴퓨터>`로 그 기계·workspace의 agent 목록과 명함, 열린 session 목록을 읽고, 기계 목록을 읽는다. 받는 쪽은 private인 workspace의 것을 내주지 않는다. 한 기계 안에서도 정의된 agent의 목록을 명령으로 읽는다(`a2a-access.md` 정한 것 1).
- **handoff note.** session마다 하나이고 agent가 명령으로 쓴다. program이 기계, project 정체, branch와 commit, 시각을 붙인다. `across_machines` event file과 같은 길(folder-sync)로 다른 기계에 간다. private인 workspace는 남기지 않는다. 다른 기계는 그 project 아래에 "다른 기계에서 하던 일"로 보이고 note를 첫 입력으로 새 session을 연다.
- **옛 판의 상대.** 새 route를 모르는 컴퓨터는 `not_found`로 답하고, 보낸 쪽은 그 컴퓨터의 lophn이 옛 판이라고 call을 실패로 닫는다.

- **다른 컴퓨터의 mail이 가리킬 수 있는 session은 그 기계의 mail이 연 session뿐이다.** 사람이 연 session이나 다른 기계의 mail이 연 session을 주소로 쓰면 없는 session과 같다. 이유: mail이 연 session은 다른 컴퓨터로 보내지 못한다는 규칙(다시 넘기지 않기)이 이미 있는데, 있는 session에 mail을 넣을 수 있으면 그 session이 셋째 컴퓨터로 넘기는 길이 열린다. 사람의 대화에 다른 컴퓨터의 agent가 끼어드는 것도 같이 막는다. (lead, 2026-11-21. 본보기 `forward.ts`와 다른 점: forward는 session 주소를 그대로 받는다)
- **답을 잃은 mail은 같은 id로 다시 보낸다.** roadmap 정한 것 11("결과를 모르는 호출은 자동으로 다시 보내지 않는다")은 일을 두 번 시키지 않는다는 뜻이고, 받는 쪽이 mail id마다 한 번만 적용하므로 같은 mail을 다시 보내는 것은 일을 다시 시키지 않는다. `unknown`은 지나가는 배달 상태다. (lead, 2026-11-21)
- **대기에 선 mail은 push나 toast를 내지 않는다.** 대기 목록(Inbox)의 card와 badge로만 보인다. 알림은 요구가 생기면 더한다. (lead, 2026-11-21)

## task

계약은 첫 task `mail-router`가 고정한다(protocol `packages/protocol/lophn-agent/mail.ts`, `calls.ts`의 새 갈래, writer 명령 `calls/mail-*`, ledger 표). 같은 wave의 다른 task는 그 뒤에 선다. 이유: mail의 꼴, 보낸 쪽 `remote`, 실패 이유, call 행의 칸이 core·화면·CLI 모두에 닿아 type 오류가 여러 package에 한 번에 난다. 한 task가 그 꼴과 그 여파를 같이 고쳐야 나머지가 병렬로 설 수 있다.

| wave | id | 선행 | 한 줄 | worker |
|---|---|---|---|---|
| 1 | `mail-router` | 없음 | mail 계약(protocol, ledger 표와 migration), Router의 보내기·받기·답·취소·켤 때 정산, writer 명령 `calls/mail-*` | opus-high |
| 1 | `mail-link` | `mail-router` | 보내는 입구 `calls/send_remote`(검사, 기계·project 풀기, redaction), 받는 입구 `a2a/mail`(명단, 허락→skip), outbox drain(link·timer·옛 판·모름) | opus-high |
| 1 | `mail-lists` | `mail-router` | `--on`을 `call send`·`session list`·`agent card`·새 `agent list`에, `machine computers`, 받는 쪽 목록·명함 route(private을 뺀다), skill 글 | opus-high |
| 1 | `mail-screen` | `mail-router` | call card의 기계 이름과 실시간 상태, 받은 session의 보낸 쪽(기계·agent), [Open conversation]을 그 기계로 | sonnet-high |
| 2 | `mail-hold` | 없음 | 늦게 온 mail을 hold로 세우기, `mail/holds`·`mail/decide_hold`, 7일 만료(보낸 쪽·받는 쪽) | opus-high |
| 2 | `mail-carry` | 없음 | outbox를 folder-sync의 길(`computers` 폴더의 mail file, manifest `mail` 칸)로 싣고 받은 file을 같은 입구로 적용 | opus-high |
| 2 | `mail-hold-card` | `mail-hold` | 대기 목록의 mail hold card([Start now]·[Skip]), desktop과 폰 | sonnet-high |
| 3 | `handoff-note` | 없음 | `lophn handoff write`, program이 붙이는 사실, note file이 folder-sync로 흐르기, `handoff/list` | opus-high |
| 3 | `handoff-screen` | `handoff-note` | 왼쪽 sidebar의 project 줄 아래 "다른 기계에서 하던 일"과 note로 새 session 열기 | sonnet-high |

## lead가 할 일

- 권한 경계를 바꾸는 계획이다. task마다 구현하지 않은 worker의 review를 받는다(공격 입력을 만들고 규칙마다 mutation으로 test가 깨지는지 본다).
- wave마다 개발 core 둘을 짝지어 실제 앱에서 확인한다(mail이 가고 답이 오는 것, 꺼진 상대, 늦게 온 mail의 card).
- merge마다 보고의 "등록할 것"(protocol `mod.ts`, core 조립 목록, schema step lock)을 고친다.
- `mail-link`와 `mail-hold`가 merge되면 task `workflow-remote-step`(roadmap 정한 것 17, 5단계)의 brief를 쓰고 wave 3에 더한다. workflow engine을 읽어야 계약이 선다(instance는 시작한 컴퓨터에 있고 다른 컴퓨터의 참가자는 그 기계에서 `workflow report`를 부르지 못한다. report를 mail의 답으로 받는 길을 brief에서 정한다). 화면(run 화면의 컴퓨터와 배달 상태)은 branch `ui/workflow-ux`의 새 run 화면 위에 선다.
- 끝나면: `architecture/agent-call.md`(기계를 건너는 call), `architecture/remote.md`(기기 route 목록), `architecture/approval.md`, `architecture/machine.md`(비목표의 낡은 줄), flows, change-log.
