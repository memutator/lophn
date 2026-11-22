# machine-a2a

한 컴퓨터의 agent가 사람의 다른 컴퓨터(내 기기 명단의 컴퓨터)에 있는 agent에게 일을 맡기고 답을 받는 길이다. 기계 사이의 call, 답, 실패, 취소, 받은 상태는 모두 mail 하나의 꼴로 오간다. 보내는 기계는 call 행과 mail을 한 transaction에 outbox에 넣고 바로 돌아오며, mail은 link가 닿으면 link로, 닿지 않으면 `computers` 폴더의 길(연결, 폰, 같이 보는 폴더)로 간다. 받는 기계는 mail id마다 한 번만 적용하고 자기 Router로 그 기계의 call처럼 돌린다. 보낸 지 10분 넘게 늦게 닿은 call은 돌지 않고 그 기계의 대기 목록에서 사람을 기다린다. agent는 다른 컴퓨터의 agent 목록, 명함, 부를 수 있는 session을 명령으로 읽는다. 따로, session은 handoff note를 남길 수 있고 그 note는 같은 폴더 길로 다른 컴퓨터에 가서 그 컴퓨터의 사람이 이어 열 수 있게 왼쪽 sidebar에 선다. 한 컴퓨터 안의 call 규칙은 `agent-call.md`, link와 기기 자격은 `remote.md`·`approval.md`, 폴더 길은 `folder-sync.md`, workflow step을 다른 컴퓨터로 넘기는 것은 `workflow.md`의 "다른 컴퓨터의 참가자"다.

## 문제

- agent가 다른 컴퓨터에 닿는 길이 앱 command뿐이었다. Windows에서만 되는 build와 test, 늘 켜 둔 기계에 맡기는 긴 일, 집에서 하던 일을 직장에서 잇는 일을 agent가 맡길 길이 없었다.
- 두 컴퓨터가 같은 때 켜지지 않는 사람이 있다(집과 직장, dual boot). 받는 컴퓨터가 꺼져 있으면 실패로 끝나는 길은 쓸 수 없다. 늦게라도 닿아야 한다.
- 늦게 닿은 일을 그대로 돌리면 사람이 모르는 사이 바뀐 상황에 일이 돈다(조사한 제품 하나는 늦게 온 명령이 바뀐 대상에 실행되어 그 대기열을 지웠다).
- 답을 잃은 요청을 다시 보내면 일이 두 번 돌고, 다시 보내지 않으면 보낸 agent가 영영 기다린다.
- 다른 컴퓨터의 agent가 보낸 글은 AI가 만든 글이다. 사람 입력으로 읽히거나, 받은 기계에서 또 다른 기계로 넘기는 고리가 생기거나, 사람이 꺼 둔 허락(터미널 입력)이 mail로 뚫리면 안 된다.
- session을 다른 기계로 옮기면 transcript와 자격을 옮겨야 한다. 꺼진 컴퓨터의 일을 다른 컴퓨터가 이어받는 것은 선례가 없다.

## 목표와 비목표

- 목표: agent가 명단의 다른 컴퓨터의 agent·session에 call을 보내고 같은 call id로 답, 늦은 실패, 취소를 받는다. 받는 컴퓨터가 꺼져 있어도 call은 남아 있다가 닿는다. 결과를 잃어도 일이 두 번 돌지 않는다.
- 목표: 늦게 닿은 call은 받는 컴퓨터의 사람이 정한다. 만료된 call은 돌지 않고 보낸 쪽은 실패로 안다.
- 목표: 보낸 쪽 call card가 그 call이 어느 컴퓨터에서 어디까지 갔는지(닿지 않음, 대기, 도는 중, 모름)를 보이고, 받은 session은 누가 어느 컴퓨터에서 보냈는지를 지워지지 않게 남긴다.
- 목표: agent가 팀원을 다른 컴퓨터에 열고(`team spawn --on`) 그 팀원이 이 컴퓨터의 팀 규칙 하나 아래 이 컴퓨터의 팀원처럼 일한다. 팀 규칙과 팀의 모양은 연 컴퓨터가 쥔다.
- 목표: session이 남긴 handoff note가 사람이 정해 둔 길로 다른 컴퓨터에 가고, 그 컴퓨터의 사람이 그 project에서 note를 첫 말로 새 session을 연다.
- 비목표: agent 정의, skill, 설정, 자격을 기계 사이에 맞추기. 받는 기계는 자기 정의와 자기 model key로 돈다.
- 비목표: transcript, file, image, commit하지 않은 변경을 옮기기. 글만 간다. code는 git이 옮기고 방법은 지침에 있다.
- 비목표: 받은 일을 또 다른 기계로 넘기기. program이 기계나 agent를 대신 고르기, 꺼진 기계 대신 이 기계에서 돌리기, 지침이 가리킨 기계·agent가 맞는지 검사하기.
- 비목표: 결과를 모르는 일을 새 call로 다시 시키기. relay나 서버가 mail을 맡아 두기.
- 비목표: workflow run 화면의 컴퓨터와 배달 상태(roadmap `a2a-multi-device.md`에 남았다). 다른 컴퓨터에 연 팀원이 그 컴퓨터에서 또 팀원을 열기(팀원은 잎이다).
- 비목표: handoff note를 자동으로 다른 컴퓨터의 agent에게 넘기기. note는 사람이 열 때만 돈다.

## 모델

```
 보내는 컴퓨터 A                                                   받는 컴퓨터 B
 agent ─ calls/send_remote ─▶ 검사(private, mail이 연 session, 컴퓨터, 주소, 글)
                              └▶ 한 tx: agent_calls 행(to remote, delivery pending) + mail_outbox 줄
 drain(B마다 한 번에 하나, seq 순) ── link: a2a/mail ──────────────▶ 명단·보낸 기계·받는 기계 확인
 나르기(60초 남은 mail) ── computers/machines/<A>/mail/<mal>.json ─▶ 받는 자리 → mail 입구(같은 적용)
                                                                     mail_seen: (A, mail id) 한 번
                                                                     만료 → 실패 mail
                                                                     10분 넘게 늦음 → 대기 목록(held)
                                                                     아니면 B의 Router로 call
 ◀── reply·state mail (B의 outbox, 같은 두 길) ────────────────────  답, 실패, 끝, 받은 상태
 행의 delivery·state를 고치고 보낸 session에 새 입력
```

### mail

- **꼴.** mail 하나는 `{id: mal_…, call, from, to_machine, seq, sent_at, expires_at}`와 종류마다의 칸이다. id와 call id는 보낸 기계가 짓고 두 기계가 같은 값을 쓴다. `from`은 쓴 쪽 `{machine, agent, session, name}`이고 받는 기계는 `machine`만 믿는다(나머지는 표시다). `seq`는 받는 기계마다 1부터 늘고 줄을 지워도 다시 쓰지 않는다.
  - `call`: 주소, 답 방식(none, result, conversation), 본문, unattended. workflow의 step이면 `step: {instance, name}`(`workflow.md`). `team spawn --on`이면 `spawn: {session}`: 보낸 기계가 지은 팀원 session id이고 받는 기계는 그 id로 session을 열어 보낸 session을 부모(`spawned_by`)로 적는다. 주소는 agent 꼴이고 그 id의 session이 이미 있으면 열지 않고 실패(`not_found`)로 답한다. 다른 컴퓨터가 연 팀원의 질문이나 승인이면 `ask: question | approval`(아래 "다른 컴퓨터에 연 팀원").
  - `reply`: 본문(없을 수 있다), 끝(`outcome`: done·failed·cancelled와 실패 이유, 없으면 conversation의 말), unattended. workflow의 report면 `report: {next, session}`. 받은 컴퓨터에서 step을 가져간 turn이 report 없이 끝나면 그 기계의 program이 `report`에 `ended`(`failed | stopped | restarted`)를 싣고 `next`와 본문 없이 낸다(step은 열어 둔다, `workflow.md` 51). 실패 알림은 본문 없이 이유만 싣고 받는 쪽이 자기 고정 글로 만든다(그 기계가 고른 글을 실을 때만 본문이 있다: 가져간 뒤 재시작). 본문 없는 done·cancelled는 보낸 쪽 행만 닫고 입력을 넣지 않는다(답 없는 call의 소비, 받는 기계의 사람이 취소). 팀원의 승인 ask에 부모가 답하면 `decision: allow | reject`를 싣는다.
  - `cancel`: 보낸 쪽이 call을 취소했다. `end: true`면 그 call이 연 팀원 session을 닫으라는 것이다(연 기계의 `team end`나 사람의 보관).
  - `state`: 받는 기계가 call을 어떻게 받았는지(`held`, `running`, 받은 session)를 알린다. 답이 없는 길(폴더, 대기 뒤 시작)에서만 낸다. link는 답(`{delivery, reason, session}`)이 같은 일을 한다. `ended`는 다른 컴퓨터가 연 팀원 session이 이 기계에서 끝났다는 것이다(그 session을 연 call로 낸다).
- **본문.** 글 block만이고 64개까지, 글의 UTF-8 합이 64 KiB까지다. 보내는 쪽이 redaction을 거치고, 받는 쪽이 받는 session 기록에 쓰기 전에 한 번 더 거친다.
- **만료.** `expires_at`은 보낸 때 + 7일이다. 받는 컴퓨터가 정해진 빼기로 명단에서 빠지면 만료를 기다리지 않는다: 그 기계로 낼 줄을 지우고, 그 기계로 보낸 끝나지 않은 call(닿지 않음, 대기, 모름, 도는 중)을 곧바로 `failed(not_found)`로 닫아 보낸 session에 "그 컴퓨터가 더 이상 사람의 컴퓨터가 아니다"라는 글을 준다(workflow step이면 `not_handed` 줄). 그 컴퓨터에서 도는 이 컴퓨터 팀원의 자리도 같은 쓸기에서 닫고, 열린 call이 없어 그 글을 받지 못한 부모에게 한 번 준다. 주기 sweep과 명단이 바뀔 때(`remote_devices`) 한다.

### 주소

- agent가 적는 주소는 이 기계의 call 주소(`agent-call.md`의 세 꼴)에 `machine`을 더한 것이다. 컴퓨터는 명단의 이름, `mch_`, `dev_`로 고르고(`remote.md`의 "이름 풀기") 이 컴퓨터면 `invalid_input`이다.
- mail 안의 주소는 workspace를 늘 밝히고 기계를 건너는 이름을 쓴다: project는 기계 사이에 같은 id(`pri_…`. 두 컴퓨터가 같은 project를 어떻게 맞추는지는 `project-identity.md`), 앱은 앱 id, Home은 그 기계의 Home이다. 보내는 쪽이 바꾼다: workspace를 빼면 이 기계의 call과 같이 `lophn`은 부른 쪽 workspace, 다른 agent는 Home이다. project 이름이나 `prj_`는 이 기계의 project로 풀어 그 id를 싣고, `pri_`는 그대로 싣는다(그 컴퓨터에만 있는 project). 앱 slug는 앱 id로 바꾼다.
- 받는 기계는 `pri_`를 자기 project로 푼다. 없으면 없다고 답한다(`not_found`). code가 없거나 옛것일 때의 처리는 지침의 일이다.
- session을 가리키는 주소는 그 session을 연 것이 보낸 기계의 mail일 때만 그 session으로 간다. 사람이 연 session, 이 기계의 call이 연 session, 다른 기계의 mail이 연 session은 없는 session과 같다(`{session}` 꼴은 `not_found`, `fallback: new` 꼴은 새 session). 이 기계가 그 기계에 연 팀원이 보낸 mail만 이 기계의 팀원처럼 어느 session이든 가리키고 팀 규칙이 거른다("다른 컴퓨터에 연 팀원").

### 보내는 쪽

- `calls/send_remote`(agent만)가 차례로 본다: 부른 session이 있는가, 그 workspace가 이 기계의 call 정책에서 private이면 `forbidden`, 컴퓨터 풀기, 그 session이 다른 컴퓨터의 mail로 열린 session인데 그 mail을 보낸 컴퓨터가 아니면 `forbidden`, 주소 바꾸기, 글만인가(아니면 `invalid_input` "only text goes to another computer"), redaction(끝나지 않았으면 `unavailable`), 크기. 할당이나 명함은 보지 않는다(명단의 컴퓨터는 mail을 받고 받는 쪽 agent는 그 기계에만 있다). call 정책의 쌍 규칙과 팀 규칙도 기계를 건너지 않는다.
- 쓰는 command는 같은 tx에서 private과 mail이 연 session(연 기계로만)을 한 번 더 보고, dedup(보낸 session + tool call id)이 있으면 처음 결과를 돌려준다. 아니면 `agent_calls` 행(`to: {kind: remote, machine, computer, address}`, `delivery: pending`, 받는 session 없음)과 outbox 줄을 같이 쓰고 `{call, state: accepted}`를 바로 돌려준다. link를 기다리지 않는다.
- 행은 있고 이 기계의 queue에는 없다(앱이 보낸 call과 같다). 켤 때 정산은 이 행을 잃은 call로 닫지 않는다.
- 답(`call reply`)과 취소(`call cancel`)도 mail이다. 받은 call에 답하면 reply mail을 그 기계의 outbox에 넣고 result면 이 기계의 행을 done으로 닫는다. 이 기계가 보낸 conversation call에 보낸 쪽이 말을 이으면 끝 없는 reply mail이다. 다른 컴퓨터로 가는 답도 글만이다. 보낸 call을 취소하면 행을 닫고, 아직 내지 않은 call mail을 지우고, cancel mail을 낸다(drain이 이미 읽었을 수 있다. 기계마다 seq 순이라 cancel은 call 뒤에 닿는다).

### 두 길

- **link.** drain이 받는 기계마다 한 번에 하나, seq 순으로 `a2a/mail`을 그 기계의 link로 부른다(요청한 쪽 `agent`, `remote.md`). 깨우는 때: outbox에 줄이 생김, link 상태가 바뀜, 60초 timer, 시작 때 한 번. link가 없는 기계는 건너뛴다.
  - 답이 오면 그 결과를 적고 줄을 지운다.
  - 보냈는데 답을 잃으면(`unavailable`, 보냄) 줄을 두고 행의 `delivery`를 `unknown`으로 하고 그 기계의 줄을 멈춘다. 다음 때 같은 mail(같은 id)이 다시 간다. 받는 쪽이 id로 거르므로 일은 한 번 돈다.
  - `not_found`(그 route를 모른다)나 `invalid_input`(그 판이 이 꼴을 읽지 못한다)이면 옛 판이다. 줄을 지우고 call은 `failed(old_version)`이다. 두면 그 기계의 줄이 영영 막힌다.
  - 그 밖의 오류는 그 기계 전체의 사정으로 보고 멈췄다가 다음 때 다시 한다. 다만 timer가 시작한 차례마다 줄 맨 앞 mail에 받는 기계가 `internal`로 답한 것이 다섯 번이면 그 mail을 버린다: call mail은 `failed(expired)`로 닫고 다른 종류는 지운다. 횟수는 메모리에 있고 맨 앞이 바뀌면 0이다.
- **폴더.** outbox에 60초 넘게 남은 mail은 `computers` 폴더의 자기 하위 폴더에 file 하나(`machines/<보낸 기계>/mail/<mal id>.json`, 128 KiB까지)로 쓰이고 서명한 manifest의 선택 칸 `mail`에 실려 link, 폰, 같이 보는 폴더로 간다(`folder-sync.md`). 곧 link로 닿을 mail은 file이 되지 않아 manifest가 바뀌지 않는다. 받는 기계마다 seq 순으로 쓰다가 file이 될 수 없는 mail(60초가 안 됨, 크기를 넘음)에서 멈춘다: 뒤 mail만 file로 가면 받는 쪽이 앞 mail 없이 돌린다. outbox에서 빠진 줄의 file은 다음 나르기가 지운다.
  - 받는 기계는 받는 자리가 그 컴퓨터의 지금 명단 key로 검증한 manifest가 싣는 file만 읽고, 그 manifest가 싣는 mail file이 다 왔을 때만 그 기계의 mail을 seq 순으로 link와 같은 입구에 넘긴다. 크기, mail schema, path의 기계와 `from.machine`, 이 기계로 온 것인지를 본다. 틀린 file은 본문 없는 log 한 줄로 넘긴다. 자기 하위 폴더와 사람의 폴더는 mail의 출처가 아니다.
  - 폴더로 받은 mail의 id는 받은 기계가 자기 하위 폴더의 `mail/acks.json`에 적는다. 보낸 기계는 검증한 사본에서 그 file을 읽어 자기 outbox의 그 기계로 가는 줄 가운데 거기 있는 것을 받은 것으로 지운다. 받은 call의 상태는 받은 기계가 `state` mail로 따로 알린다.
  - 입구가 `internal`·`unavailable`로 늘 거절하는 맨 앞 mail은 timer scan 다섯 번 뒤 거절로 적어(아래 "받는 쪽") 그 기계의 뒤 mail을 막지 않는다.
- 같은 mail이 두 길로 와도 받는 쪽이 id로 한 번만 적용한다. 어느 길이 먼저인지는 결과를 바꾸지 않는다.

### 받는 쪽

- 입구 `a2a/mail`은 명단의 컴퓨터인 기기(principal `device:<id>`, kind computer)만 받고, 요청한 쪽이 `agent`여야 한다. 폰, 모르는 기기, 다른 요청한 쪽은 `forbidden`이다. mail의 `from.machine`이 그 기기의 기계이고 `to_machine`이 이 기계여야 한다(이 기계 자신이 보낸 것은 받지 않는다). 폴더 길도 같은 입구로 들어오고 실어 온 하위 폴더의 기계가 지금 명단의 다른 컴퓨터여야 한다.
- 터미널 입력 허락은 받을지가 아니라 skip을 따를지에만 쓴다: mail이 여는 session은 받는 컴퓨터가 보낸 컴퓨터에 그 허락을 켜 두었을 때만 agent 정의의 skip을 따르고, 아니면 묻는 session이다.
- 적용은 tx 하나다: `mail_seen`에 (보낸 기계, mail id)를 적고 처음이 아니면 지난 결과를 돌려준다. 그다음 call mail은 만료면 실패(`expired`), 같은 call id가 이미 있으면 실패(`not_found`), 보낸 기계의 cancel이 먼저 닿았으면 실패(`closed`), 늦었으면 대기(아래), 아니면 이 기계의 Router로 같은 call id를 쓰는 call이다. 보낸 쪽은 `{kind: remote, machine, computer, agent, session, name}`이고 `computer`는 받은 때 이 기계 명단의 그 컴퓨터 이름으로 얼린다. call 정책의 쌍 규칙, 팀 규칙, 명함 검사는 하지 않는다(부른 agent가 `agent card --on`으로 이미 읽었다). 보낸 session이 이 기계가 그 기계에 연 팀원의 자리면 그 자리가 보낸 것처럼 셋을 다 거친다. 받는 workspace가 이 기계에서 private이면 없는 workspace와 같다. 배달하지 못하면 실패 행과 실패 reply mail이다.
- mail이 연 session에는 `sessions.opened_by_machine`(보낸 기계, 바뀌지 않는다)이 달리고 탭을 열지 않는다. 그 session은 그 mail을 보낸 컴퓨터로만 보내고 셋째 컴퓨터로는 보내지 못한다. 다른 컴퓨터의 목록과 명함도 읽지 못한다.
- 받은 입력의 tag는 `from="remote:<name>@<computer>"`이고 끝의 고정 줄이 다른 컴퓨터의 agent가 보냈고 사람이 보낸 것이 아니라고 말한다. 이 기계 agent의 줄은 그대로다(prompt cache).
- reply mail은 이 기계가 그 기계로 보낸 행이면 보낸 session에 입력(답, 고정 글의 실패 알림)으로 넣고, 끝이 있으면 행을 그 상태로 닫고 남은 call mail을 지운다. 그 기계에서 받은 conversation call이면 받은 session에 넣는다. cancel mail은 그 기계가 보낸 받은 call을 취소로 닫고 받은 session에 취소 알림을 넣는다. 행이 없는 call의 cancel은 대기 줄을 닫거나 기억해 같은 call이 뒤에 와도 돌지 않게 한다. state mail은 보낸 행의 `delivery`와 받은 session을 고치고 남은 call mail을 지운다. 끝난 행에 온 mail은 아무것도 바꾸지 않는다. reply·cancel·state는 늦어도 바로 적용한다.
- 적용이 `not_found`·`forbidden`·`invalid_input`·`conflict` 오류로 되돌아가면 본 것으로 따로 적고(state `refused`) call mail이면 실패 mail(`conflict`는 `closed`, 나머지는 `not_found`)을 낸다. 아니면 그 기계가 같은 mail을 끝없이 다시 낸다. `unavailable`·`internal`은 그대로 돌려줘 보낸 쪽이 다시 보낸다.
- 받은 call의 끝도 mail이다: 답 없는 call을 turn이 가져가면 `{done}`, 받는 기계의 사람이 취소하면 `{cancelled}`, 받은 session이 끝나면 `receiver_ended`, 켤 때 가져가지 않은 call은 `lophn_restarted`, 가져간 result call의 turn이 실패하거나 멈추거나 재시작으로 끊기면 `receiver_ended`·`lophn_restarted`(`agent-call.md` 18. 재시작이면 "그 컴퓨터에서 일하던 중 재시작했다"는 글을 싣는다). 가져간 workflow step은 같은 때 닫히지 않고 `ended`를 실은 report mail 하나가 간다.

### 배달 상태

보낸 행의 `delivery`는 call이 accepted인 동안만 있다. 끝난 행에는 없다.

| 값 | 뜻 | 바뀌는 때 |
|---|---|---|
| `pending` | 아직 닿지 않음 | 보낼 때 |
| `unknown` | 보냈는데 답을 잃음(받았는지 모름) | link 답을 잃음. 같은 id로 다시 간다 |
| `held` | 그 기계의 대기 목록에서 사람을 기다림 | link 답이나 state mail |
| `running` | 그 기계가 받아 돌림 | link 답이나 state mail(받은 session을 같이 안다) |

call의 상태는 그대로 넷(accepted, done, failed, cancelled)이다. 실패 이유에 `expired`(만료 전에 그 컴퓨터가 가져가지 않음), `skipped`(그 컴퓨터의 사람이 돌리지 않음), `old_version`(그 컴퓨터의 lophn이 mail을 모름)이 더해졌다.

### 대기(hold)

- 보낸 시각보다 10분 넘게 늦게 닿은 call mail은 돌지 않고 받는 기계의 `mail_seen` 줄(state `held`, mail을 그대로 든다)로 선다. 10분은 job의 `hold`가 놓친 차례를 가르는 값과 같다. 늦음은 받는 기계의 시계와 보낸 기계의 `sent_at`을 견준다.
- 돌았을 call만 선다: 만료, 이미 있는 call id, 먼저 닿은 취소, 받을 곳이 없는 주소(없는 agent·workspace, private, 그 기계의 mail이 열지 않은 session, 닫힌 session)는 늦었어도 바로 실패로 답하고 본문을 두지 않는다.
- 보낸 기계는 `held`를 보인다(link 답, 폴더면 state mail). 대기 줄에는 push와 toast가 없다. 대기 목록 card와 badge로만 보인다.
- 정하기는 사람만이다. `mail/decide_hold`(`run_now` | `skip`)는 사람 자격이고 기기 목록에 있어 이 컴퓨터의 창, 다른 컴퓨터의 창(`screen`), 폰이 부른다. 다른 컴퓨터의 터미널(`terminal`)과 agent·앱 요청은 받지 않는다(`REMOTE_TERMINAL_DENIED`, `approval.md`). 이 컴퓨터의 사람 CLI token은 된다(job hold와 같다).
  - [Start now]: 늦음 판정 없이 받는 길로 돌린다. skip은 누른 기기가 아니라 정하는 때 이 컴퓨터가 보낸 컴퓨터에 준 터미널 입력 허락으로 본다. 줄은 `started`이고 보낸 기계에 state mail(`running`, session)이 간다.
  - [Skip]: 돌리지 않는다. 줄은 `skipped`이고 실패 mail(`skipped`)이 가서 보낸 session은 "The person on the other computer chose not to run this call."을 받는다.
  - 이미 정했거나 취소된 줄은 `conflict`, 없는 줄은 `not_found`다. 만료된 줄을 정하면 줄을 `expired`로 닫고 실패 mail을 낸 뒤 `conflict`다. 보낸 컴퓨터가 명단에서 빠진 줄은 목록에 보이지 않고, 정하려 하면 돌리지 않고 닫은 뒤 `not_found`다.
- `mail/holds`는 오래 기다린 것부터 만료되지 않았고 보낸 컴퓨터가 명단에 있는 줄을 낸다. 항목은 보낸 쪽(agent 이름과 컴퓨터), 주소, 답 방식, 본문 앞 500자, 보낸 때, 닿은 때, 만료다. 줄이 생기고, 정해지고, 만료되고, 취소되면 `StateChanged{mail_holds}`.
- 대기 목록 card(desktop과 폰). desktop 창의 대기 목록과 폰 Inbox의 Now에 묶음 "Mail from other computers"가 선다. card는 보낸 쪽("<agent> on <computer>"), 맡긴 글, 받는 곳("To <agent> in <workspace>" 또는 session), 보낸 때·닿은 때·만료, 오른쪽 끝 [Skip]과 [Start now]다. 다른 컴퓨터의 줄은 그 컴퓨터의 `mail/holds`로 읽고 그 컴퓨터의 `mail/decide_hold`로 정한다(job hold card와 같은 길). `mail_holds` 변경에 다시 읽고, 읽기가 `not_found`(옛 판)면 빈 목록이며 job card 읽기와 묶지 않는다. `conflict`·`not_found` 답은 "already decided or has expired"를 두고 단추를 막는다.

### 만료와 정리

drain의 60초 timer가 돌 때마다 먼저 쓸기(sweep)를 한다.

- 이 기계 outbox의 만료된 줄을 지운다. 그 call이 아직 열려 있으면 `failed(expired)`로 닫아 보낸 session에 늦은 실패로 알린다.
- 그 기계가 가져갔는지 모르거나 대기 중인 call(`delivery`가 `held`나 `unknown`)은 보낸 때에서 7일 + 10분이 지나면 `failed(expired)`로 닫는다. 그 기계가 영영 돌아오지 않아도 보낸 쪽이 열려 있지 않게 한다. 10분은 두 기계의 시계 차이를 위한 여유다. 받는 기계는 만료된 대기 줄을 시작하지 않으므로 늦은 [Start now]가 여기서 닫은 call을 돌리지 않는다. 그 뒤에 온 답은 끝난 call의 답처럼 버린다. 도는(`running`) call은 나이로 닫지 않는다: 답, 실패, 취소, 재시작 규칙이 닫는다.
- 만료된 대기 줄을 `expired`로 닫고 실패 mail을 낸다.
- 받은 기록(`mail_seen`) 가운데 대기 줄이 아닌 것은 만료의 두 배(14일)보다 옛 것을 지운다. 그 안에 같은 mail이 다시 와도 한 번만 돈다.

### 다른 컴퓨터에 연 팀원

`team spawn --on <컴퓨터>`의 팀원(`agent-call.md` 29a)은 연 컴퓨터 A의 팀원이고 도는 곳은 B다. 팀 규칙은 하나이고 A가 쥔다. B는 mail이 이미 주는 것(명단, 보낸 기계, 늦은 mail의 대기, private, skip 허락, 자기 agent 정의)만 본다.

```
 A(연 컴퓨터)                                      B(도는 컴퓨터)
 sessions: 팀원의 자리(runs_on=B, B의 handle)      sessions: 같은 id의 session(spawned_by=A의 부모, opened_by_machine=A)
 A의 call → 정책·팀 규칙 → call mail ──────────────▶ 그 session(그 기계의 mail이 연 session)
 자리가 보낸 것처럼 정책·팀 규칙·명함 ◀── call mail(from.session=자리) ── 팀원의 call, ask(부모에게)
 team end·보관 → 자리 닫음 + cancel{end} ─────────▶ session 보관
 자리 닫음 ◀─────────────────────────────── state{ended} ── 보관·지움
```

- **자리.** A의 자리는 session 행이다: 부모는 부른 session, 기계는 B(`runs_on`, 바뀌지 않는다), agent는 B의 handle 그대로, workspace는 부모의 것. 자리는 이 컴퓨터의 팀원과 같은 규칙으로 열려 있는 동안 팀 상한의 한 자리다(spawn call이 끝나도 센다). id는 B의 session id와 같다(A가 짓고 spawn mail이 싣는다). 이 컴퓨터의 session이 아니라 turn, queue, 받은 메시지가 없고 사람의 입력, 앱, 다른 컴퓨터의 mail, program 알림은 닫힌 session과 같다. session 목록(Recent, `session list`, 앱의 session 목록), session read, 탭 넘기기(`tabs/hand`)는 자리를 내지 않는다. `SessionStarted`도 내지 않는다(그 agent는 이 컴퓨터의 agent id가 아니다): 열리면 `StateChanged{sessions}`, 닫히면 `SessionEnded`다.
- **A의 call.** A의 session이 자리에 보내는 call은 이 컴퓨터의 call처럼 call 정책과 팀 규칙을 거친 뒤(명함은 B의 것이라 보지 않는다) queue 대신 B로 가는 call mail이다(`{session: 자리}` 주소, 컴퓨터 이름은 spawn call에 얼어 있다). 행은 받는 session과 `remote_session`이 자리이고 배달 상태, 만료, 옛 판 규칙이 그대로다. 답, 취소, dedup도 다른 컴퓨터로 보낸 call과 같다. A의 탭은 열리지 않는다.
- **팀원의 mail.** B의 팀원이 보낸 call mail은 `from.session`이 A가 B에 연 자리면 A에서 그 자리가 보낸 것으로 거른다: 주소는 A의 어느 session이든 가리키고 call 정책, 팀 규칙(부모, 형제, 자기 밑), 명함 검사를 거친다(막히면 거절이고 B에는 실패 mail). 행의 보낸 쪽은 그대로 B의 agent(`remote`)라 답과 실패는 mail로 간다. 팀원은 자기 부모를 A 쪽 session id로 부르고(`call send --to <부모>`나 `--on <A>`) B는 그 주소가 자기에게 없고 부모라는 것만 보고 A로 낸다.
- **ask.** 팀원의 질문과 승인은 B의 사람이 아니라 A의 부모에게 간다: B는 부모가 자기에게 없으면 `ask`를 실은 call mail을 A로 낸다. A의 부모는 이 컴퓨터의 ask처럼 답하고(승인은 `--allow | --reject`), 결정은 reply mail의 `decision`으로 돌아가 B가 짝(request·질문)을 푼다. 답이 아닌 끝(실패, 취소, 닿지 못함)은 짝을 거절로 푼다. 짝은 B의 메모리라 B가 다시 켜지면 그 ask call은 켤 때 정산에서 닫히고 A에 cancel mail이 간다(이 컴퓨터의 재시작 규칙과 같다).
- **잎.** 팀원은 B에서 팀원을 열지 못하고(`conflict`) 다른 컴퓨터에도 열지 못한다(`forbidden`). B에서 돌던 팀원도 셋째 컴퓨터로 보내지 못한다(지키는 것 7).
- **끝.** A에서 자리를 닫으면(`team end`, 사람의 보관·지움) 자리는 이 컴퓨터에서 곧바로 닫힌다: 자리로 보낸 열린 call은 `receiver_ended`, 아직 내지 않은 call mail은 거두고, B로 cancel(`end`) mail을 낸다. B가 영영 오지 않아도 자리는 닫혀 있다. B는 그 mail이 닿으면 그 session을 사람의 보관처럼 닫는다. B에서 session이 끝나면(보관, 지움, A의 `end`) B는 A에 state(`ended`)를 내고 A는 자리를 닫는다(부모는 열린 call의 `receiver_ended`로 안다). 상대가 이미 닫았으면 그 mail은 아무것도 바꾸지 않는다.
- **늦은 실패.** spawn은 B가 꺼져 있어도 바로 돌아온다. B에서 돌기 전에 spawn call이 실패하면(없는 agent·workspace, 이미 있는 id, 닫힘, 만료, 건너뜀, 옛 판, 명단에서 빠짐) 부모는 call의 실패를 받고 자리는 닫힌다. 받은 turn이 답 없이 끝난 실패(`receiver_ended`, `lophn_restarted`)로는 닫지 않는다: session이 B에 살아 있다. 늦게 닿은 spawn mail은 B의 대기 목록에서 B의 사람을 기다린다. 그동안 A의 자리는 `held`이고, B의 사람이 시작하면 `running`, 건너뛰면 spawn call의 실패(`skipped`)로 자리가 닫힌다.
- **읽기.** `team read`는 자리를 자식으로 내고 `computer`와 spawn call의 배달로 읽은 상태(`pending`: 아직 닿지 않음·모름, `held`: B의 대기 목록, `running`)를 싣는다(설명과 runtime은 B의 것이라 없다). 그래서 팀이 바뀐 notice(`team_changed`)도 이 컴퓨터의 팀원과 같다. session snapshot은 자리를 agent 없이 `runs_on {machine, computer, handle, state, state_seq}`로 싣는다(`state`에 `ended`가 더 있다). A의 창은 다른 기계의 session 탭(탭의 `machine`)으로 B의 그 session을 연다(`workspace-layout.md`).

### 다른 컴퓨터의 목록과 명함

agent가 누구를 부를지 고르는 길이다. system prompt에 싣지 않고 명령으로 읽는다. 어느 컴퓨터, 어느 agent를 고를지는 지침과 사람이 정한다.

- `lophn machine computers`: 사람의 컴퓨터(id, 이름, 상태, 이 컴퓨터 표시, 늘 켜 둠). agent도 읽는다.
- `lophn agent list [--workspace] [--on <컴퓨터>]`, `lophn agent card <handle> --on <컴퓨터>`, `lophn session list --on <컴퓨터>`, `lophn call send --on <컴퓨터>`. `agent list`는 `--on` 없이도 이 기계의 한 workspace에 정의된 agent의 명함을 읽는다(agent는 이 기계에서 private인 다른 workspace를 읽지 못한다).
- 보내는 쪽 `machines/sessions`, `machines/agents`(agent만): 부른 session이 private workspace나 mail이 연 session이면 `forbidden`, 그 컴퓨터의 `a2a/sessions`·`a2a/agents`를 요청한 쪽 `agent`로 부르고 5초 안에 답이 없으면 `unavailable`("not reachable now")이다. 그 컴퓨터가 `not_found`면 옛 판이라고(`unavailable`), 그 밖의 오류는 "<컴퓨터> refused: <글>" 꼴로 다시 쓰고 details는 싣지 않는다. 답은 output schema로 다시 보고 모든 글 칸의 제어 문자를 빼고 길이와 개수를 줄인다(항목 200개, 한 줄 칸 256자, 글 칸 1,024자, 명함 하나의 차이 50줄과 note 20개, 시각이 아닌 `last_active_at`은 버린다). 다른 컴퓨터의 글이기 때문이다.
- 받는 쪽 `a2a/sessions`, `a2a/agents`(명단의 컴퓨터만, 폰은 `forbidden`). session 목록은 그 컴퓨터의 mail이 연 열린 session 가운데 private이 아닌 workspace의 것뿐이다(목록에 있는 것은 모두 부를 수 있다). 명함은 workspace(`pri_`, 앱 id, Home)를 풀어 내고, 없는 workspace, 보관한 것, private인 것은 똑같이 `{found: false, cards: []}`다(있는지를 알리지 않는다). 다른 컴퓨터에 내주는 명함은 이 기계에서 private인 앱을 할당하지 않은 것처럼 만들어 그 앱의 이름, command, skill이 나가지 않는다. 명함의 `callable`은 싣지 않는다.
- 두 받는 route는 `not_found`를 내지 않는다. 보내는 쪽은 `not_found`를 "그 route를 모르는 옛 판"으로 읽는다.
- `--on`의 자리: 사람의 터미널의 `--on`은 그대로 `machines/call`(`terminal`)이다. agent의 `lophn` tool과 harness agent의 binary(agent 자격)에서는 `on` 칸을 가진 네 명령(`call send`, `session list`, `agent list`, `agent card`)만 `--on`을 그 명령의 칸으로 받아 그 명령의 route로 보내고(명령 낱말 앞에 써도 된다), 다른 내장 명령의 `--on`은 거절한다. 앱 command의 `--on`은 그대로다(`app-call.md`).

### 화면

- 보낸 쪽 call card(`agent-call.md` 35): 머리 줄의 받는 곳 뒤에 컴퓨터 이름, 끝나지 않은 call은 배달 상태 한 줄("Not delivered yet. It goes when <computer> is reachable.", "Waiting in <computer>'s Inbox for the person to start it.", "Running on <computer>.", "Sent to <computer>; not known whether it arrived."). 그 call의 `StateChanged{agent_calls}`를 받으면 다시 읽는다. [Open conversation]은 그 컴퓨터에서 받은 session을 알 때만 서고 그 컴퓨터의 session을 연다. 세 새 실패 이유는 한 줄 글이 있다.
- 받은 session의 보낸 쪽 chip: "<name> on <computer>", panel은 보낸 컴퓨터와 session이고 그 컴퓨터의 session을 연다. 사람 메시지로 그리지 않는다. live와 이력이 같은 이름을 낸다.
- ACP의 call 항목은 `remote: {machine, computer, delivery, session}`(이 기계 안의 call은 null)을 싣는다.
- 연 컴퓨터의 팀 tree: 다른 컴퓨터에서 도는 팀원은 current에 선 부모 줄 아래에만 선다. 줄은 컴퓨터 아이콘, 그 컴퓨터의 handle, 컴퓨터 꼬리표와 상태 글(`pending`은 "Waiting", `held`는 "Needs approval", `running`은 없음, hover하면 한 문장)이다. 이 컴퓨터의 turn 점, 이름 바꾸기, 끌기는 없다. 누르면 그 컴퓨터의 session을 그 기계를 단 탭으로 열고, 오른쪽 끝 x(End team member)가 자리를 보관한다(snapshot의 `state_seq`). 창의 session store는 자리를 session 목록과 따로 들어 Recent, 찾기, 넘기기, session 고르기에 들지 않고, `StateChanged{sessions}`·`StateChanged{agent_calls}`에 자리의 snapshot을 다시 읽는다.
- 도는 컴퓨터: 탭은 저절로 열리지 않는다. 사람이 그 session을 열면 부모가 있고 대화의 첫 항목이 다른 컴퓨터의 메시지라 그 chip이 "Team member · from <agent> on <연 컴퓨터>"다(보낸 쪽 chip 그대로, 새 mail 칸 없이 이미 아는 이름).

### handoff note

- **쓰기.** agent가 `lophn handoff write --body <글>`(`handoff/write`)로 자기 session의 note를 쓴다. session은 부른 agent 자격에서 정한다(입력으로 받지 않아 다른 session의 note를 쓰지 못한다). project workspace의 session만 쓰고(아니면 `invalid_input`), 이 기계에서 private인 project는 `forbidden`이다. 언제 쓸지는 지침과 사람이 정한다. program은 쓰라고 하지 않고 스스로 쓰지 않는다.
- **program이 붙이는 것.** 이 기계, project의 기계를 건너는 id, 첫 등록 폴더의 git branch와 commit(읽기만 한다. git이 아니거나 읽지 못하면 null), 쓴 때, agent 이름. 글은 redaction을 거치고 32 KiB까지다.
- **자리.** `computers` 폴더의 자기 하위 폴더 `machines/<mch>/notes/<ses id>.json`(64 KiB까지) file 하나다. session마다 하나이고 다시 쓰면 바꾼다. ledger 표는 없다. 쓰면 나르기를 깨운다.
- **흐르기.** 서명한 manifest의 선택 칸 `notes`에 실려 mail과 같이 link, 폰, 같이 보는 폴더로 간다(`folder-sync.md`). 쓴 기계의 나르기는 manifest를 쓰기 전에 7일보다 옛 자기 note, 읽지 못하는 note, 지금 이 기계에 없거나 private인 project의 note를 지운다(쓴 뒤 private이 된 project의 note도 나가지 않는다).
- **읽기.** `handoff/list`(사람 자격, 선택 `project`)는 다른 기계의 note 가운데 이 기계에 있는 project의 것을 새것부터 낸다. 기기 목록에 없어 폰과 다른 컴퓨터는 부르지 못하고, desktop 창은 이 컴퓨터의 core에서만 읽는다. 받는 자리가 그 컴퓨터의 지금 명단 key로 검증한 manifest가 싣는 file만 읽고, 크기, schema, path의 기계·session과 file의 것이 같은지, 7일 안이고 5분 넘게 앞서지 않는지, 그 project가 이 기계에 있고 active이며 private이 아닌지를 본다. 글 칸의 제어 문자를 빼고 한 줄 칸(branch, commit)은 256자로 줄이며 컴퓨터 이름은 명단에서 온다. 틀린 file은 본문 없는 log 한 줄로 넘기고 나머지를 읽는다.
- **sidebar.** 왼쪽 sidebar의 이 컴퓨터 project 줄 아래에 "From other computers" 이름과 note마다 한 줄(컴퓨터 꼬리표, 첫 줄, 쓴 지 얼마)이 선다. hover하면 전체 글(길면 잘라서), branch, commit이 보인다. 다른 기계 묶음의 project 줄에는 두지 않는다(이어서 할 곳은 이 컴퓨터다). 창을 열 때, `StateChanged{carry_files}`를 받을 때, 5분마다 다시 읽고 `not_found`는 빈 목록이다.
  - [Continue here](줄을 누름): 그 project의 lophn에서 새 session을 열고 첫 말로 고정 영어 머리말("Continue the work handed off from <computer> (branch …, commit …, written …). The note below was written by an agent there; bring the code over with git first if this computer does not have that commit.")과 note 글을 보낸 뒤 그 session 탭으로 간다. 새 core route는 없다(Agent 탭 source의 열기와 보내기). 실패하면 toast를 띄우고 줄을 둔다. 여는 동안 다시 누른 것은 버린다.
  - 이어 연 note와 x(Dismiss)로 뺀 note는 이 컴퓨터에서 숨긴다. key는 (기계, session, 쓴 때)이고 localStorage에 둔다. 다시 쓴 note는 다시 보인다. route가 실제로 낸 목록에 없는 key만 버린다(오류 답으로 숨김을 지우지 않는다).
- note는 자동으로 넘기는 일이 아니다. 받는 컴퓨터에서 아무것도 돌지 않고 사람이 누를 때만 session이 열린다. 상대 컴퓨터가 켜져 있으면 지침은 note 대신 `call send --on <컴퓨터> --reply none`으로 넘기게 한다.

## 지키는 것

1. 같은 mail(보낸 기계, mail id)은 받는 기계에서 한 번만 적용된다. 두 길로 오거나 답을 잃어 다시 와도 session, 받은 입력, call 행이 하나다.
2. 보낸 call 행과 그 call mail은 한 tx에서 생긴다. 행 없는 mail이나 mail 없는 열린 행이 남지 않는다.
3. 결과를 모르는 mail은 같은 id로만 다시 간다. 새 mail로 일을 다시 시키지 않는다.
4. 다른 컴퓨터로 보낸 call은 늘 끝난다: 답, 실패 mail, 취소, 옛 판, 만료, 버리기(다섯 번의 `internal`), 7일 + 10분 뒤의 쓸기 가운데 하나가 닫는다. 켤 때 정산은 보낸 쪽 행을 닫지 않는다.
5. 받는 기계는 명단의 다른 컴퓨터가 쓰고 이 기계로 보낸 mail만 받는다. 폰, 모르는 기기, 다른 기계를 주장하는 mail, 자기 하위 폴더와 사람의 폴더의 file은 Router에 닿지 않는다. 요청한 쪽의 이름과 agent는 표시이고 무엇도 정하지 않는다.
6. 다른 컴퓨터의 mail은 그 기계의 mail이 연 session에만 이어 들어간다. 사람이 연 session과 다른 기계의 mail이 연 session에 끼어들지 못한다. 예외는 이 컴퓨터가 그 기계에 연 팀원의 mail 하나이고 이 컴퓨터의 팀원처럼 팀 규칙이 거른다(16).
7. mail이 연 session은 그 mail을 보낸 컴퓨터로만 보내고 셋째 컴퓨터로는 보내지 못한다(목록과 명함은 어디로도 읽지 못한다). `opened_by_machine`은 바뀌지 않는다. A의 일이 B를 거쳐 C에 닿지 않는다.
8. private인 workspace는 mail을 보내지도, 받지도, 목록과 명함에 보이지도, handoff note를 남기지도 않는다. 받는 쪽은 없는 workspace와 private workspace를 같은 답으로 낸다.
9. mail이 연 session은 받는 컴퓨터가 보낸 컴퓨터에 터미널 입력 허락을 켜 두었을 때만 skip이다. [Start now]는 정하는 때의 허락으로 본다.
10. 늦게 닿은 call은 사람의 [Start now] 없이 돌지 않는다. 만료된 call과 만료된 대기 줄은 돌지 않는다. 대기 줄의 결정은 사람만 하고 다른 컴퓨터의 터미널과 agent·앱은 하지 못한다.
11. 기계를 건너는 것은 글뿐이다(64 블록, 64 KiB). 보내는 쪽과 받는 쪽이 모두 redaction을 거친다. image, file, refs, transcript, 자격은 가지 않는다.
12. 받은 입력은 받은 turn과 이력에서 같은 bytes로 다른 컴퓨터의 agent가 보낸 것으로 싸인다. 사람 입력으로 그리지 않는다.
13. 다른 컴퓨터가 낸 글(목록, 명함, note)은 model이나 사람에게 닿기 전에 schema로 다시 보고 제어 문자를 빼고 길이를 줄인다.
14. 기계마다의 mail은 seq 순으로 적용된다: link는 한 번에 하나, 폴더는 manifest가 싣는 file이 다 온 뒤, 보내는 쪽은 앞 mail이 file이 될 수 없으면 뒤 mail을 file로 쓰지 않는다.
15. handoff note는 부른 agent 자신의 session의 것만 쓰고, 다른 기계의 note는 그 컴퓨터의 지금 key로 검증한 사본에서만 읽는다. note를 여는 것은 사람의 누름뿐이다.
16. 다른 컴퓨터에 연 팀원의 팀 규칙은 연 컴퓨터 하나가 건다: 그 팀원에게 가는 call과 그 팀원이 보낸 mail이 모두 연 컴퓨터의 자리로 call 정책과 팀 규칙을 거친다. 자리는 이 컴퓨터의 queue로 입력을 받지 않는다.
17. 연 컴퓨터에서 자리를 닫는 일은 상대에 닿지 않아도 늘 이 컴퓨터에서 끝난다. 자리는 spawn call이 돌기 전에 실패하거나, 도는 컴퓨터에서 session이 끝나거나, 그 컴퓨터가 명단에서 빠지면 닫히고, 받은 turn이 답 없이 끝난 것으로는 닫히지 않는다.

## 경계와 계약

- boundary: `router`(mail을 call처럼 돌리기, outbox와 받은 기록, 대기, 쓸기), `remote`(mail과 목록의 두 입구, drain), `remote-protocol`(기기 route 목록과 요청한 쪽마다 거르는 목록), `folder`(mail file, ack file, note file의 나르기), `projects`(handoff note 쓰기와 읽기).
- route(memory):
  - `calls/send_remote`(`SendRemoteCall`, agent): `to`(이 기계 주소의 세 꼴 + `machine`), `reply`, `body`, `dedup` → `{call, state, fail_reason}`. 오류 `invalid_input`, `forbidden`, `not_found`, `unavailable`, `unauthorized`.
  - `team/spawn_remote`(`SpawnRemoteTeamMember`, agent): `agent`, `workspace?`, `machine`, `reply`, `body`, `dedup` → `{session, call}`. 오류는 `calls/send_remote`에 `conflict`(팀 상한·깊이)를 더한 것이다.
  - `a2a/mail`(user, 기기): `{mail}` → `{delivery: running | held | failed | null, reason, session}`. 오류 `invalid_input`, `forbidden`, `conflict`, `unavailable`, `internal`(`not_found`는 없다).
  - `a2a/sessions`(`{}` → `{sessions}`), `a2a/agents`(`{workspace}` → `{found, cards}`)(user, 기기).
  - `machines/sessions`(`{machine}`), `machines/agents`(`{machine, workspace?}`)(agent).
  - `machine/computers`(user, app, agent).
  - `mail/holds`(`{}` → `{holds}`), `mail/decide_hold`(`{origin, mail, decision: run_now | skip}` → 적용 결과. 오류 `not_found`, `conflict`)(user).
  - `handoff/write`(agent, `{text}` → `{identity, branch, commit, written_at}`), `handoff/list`(user, `{project?}` → `{notes: [{machine, computer, session, project, agent_name, text, branch, commit, written_at}]}`).
  - core 안 machine 명령: `calls/mail-send`, `calls/mail-apply`, `calls/mail-refuse`, `calls/mail-sent`(link의 답, 폴더의 ack, 버리기), `calls/mail-decide`, `calls/mail-sweep`, `calls/step-report`(`workflow.md`).
- 기기 route 목록(`REMOTE_ALLOWED_ROUTES`): `a2a/mail`, `a2a/sessions`, `a2a/agents`, `mail/holds`, `mail/decide_hold`. 요청한 쪽 `agent`·`app`이 닿는 목록(`REMOTE_AGENT_ROUTES`)에 `a2a/mail`, `a2a/sessions`, `a2a/agents`. `REMOTE_TERMINAL_DENIED`에 `mail/decide_hold`. desktop 창의 renderer가 부르는 memory route에 `mail/holds`, `mail/decide_hold`, `handoff/list`.
- CLI: `lophn call send|team spawn|session list|agent list|agent card --on <컴퓨터>`, `lophn agent list [--workspace]`, `lophn machine computers`, `lophn handoff write --body`. 앱 slug `handoff`는 예약이다.
- mail의 팀원 칸: call의 `spawn: {session}`과 `ask`, reply의 `decision`, cancel의 `end: true`, state의 `delivery: ended`. mail 종류는 넷 그대로다.
- 읽기: `team/read` 항목의 `computer`와 상태 `pending | held`(runtime은 다른 컴퓨터의 팀원이면 null), session snapshot의 `runs_on {machine, computer, handle, state: pending | held | running | ended, state_seq}`(그 항목의 agent는 null).
- call 계약: 보낸 쪽 `{kind: remote, machine, computer, agent, session, name}`, 받는 곳 `{kind: remote, machine, computer, address}`, 행의 `delivery`(`pending | unknown | held | running`)와 `remote_session`, 실패 이유 `expired`·`skipped`·`old_version`, id prefix `mal`. ACP call 항목의 `remote`. SDK `@lophn/agent` 1.16.0이 넓어진 call 값을 낸다(migrate-sdk 메모 `agent-1.16.0`).
- event: `StateChanged`의 change 이름 `agent_calls`(다른 컴퓨터를 건넌 call 행이 바뀜, id는 call), `mail_holds`(대기 줄, id는 mail), `sessions`(다른 컴퓨터에 연 팀원의 자리가 열림, id는 자리).
- 저장: ledger `agent_calls`의 `from_machine`·`delivery`·`remote_session`, `messages.from_kind`의 `remote`, `sessions.opened_by_machine`, `sessions.runs_on`, `mail_outbox`(받는 기계, seq, call, 종류, mail, 보낸 때, 만료), `mail_seq`, `mail_seen`(보낸 기계, mail id, call, 종류, 상태 `applied | held | started | skipped | expired | cancelled | refused`, 대기 줄의 mail, 컴퓨터 이름, 닿은 때). schema step `router.remote-sender.agent-calls`, `lophn-agent.remote-sender.messages`, `lophn-agent.remote-sender.sessions`, `router.mail.tables`, `lophn-agent.member.runs-on`.
- 폴더(`computers`): `machines/<mch>/mail/<mal id>.json`(mail 하나, 128 KiB), `machines/<mch>/mail/acks.json`(`{format: 1, machine, mails}`, 8,000개·512 KiB), `machines/<mch>/notes/<ses id>.json`(`{format: 1, machine, session, identity, agent, name, text, branch, commit, written_at}`, 64 KiB). manifest 선택 칸 `mail`, `notes`.
- 고정 글: 세 실패 이유의 알림, 가져간 뒤 재시작의 알림(이 기계와 다른 기계), 받은 입력의 끝 줄, handoff 머리말.

## 결정

- **꺼져 있는 컴퓨터에 맡겨 둔다. 늦게 온 mail은 사람에게 묻고 돈다.** 늦은 것을 가르는 꼴은 job의 `hold`를 쓴다. 버린 안: 늦은 mail을 그대로 돌리기(바뀐 상황에 일이 돈다), 꺼진 컴퓨터에는 보내지 못하게 하기. (사람, 2026-11-21. 꼴은 agent)
- **agent가 다른 컴퓨터를 부르는 길을 열고 누가 언제 어느 컴퓨터를 고르는지는 workflow, 지침, prompt가 정한다.** program은 고르지도, 지침이 가리킨 것이 맞는지 검사하지도 않는다. 버린 안: program이 기계를 고르거나 꺼진 기계 대신 이 기계에서 돌리기. (사람, 2026-11-21)
- **agent 정의는 기계 사이에 맞추지 않는다.** 부르는 쪽은 그 기계·workspace의 agent 목록을 읽어 고르거나 지침에 적힌 것을 쓴다. 버린 안: agent 정의 동기화(환경과 지침이 기계마다 다르다). (사람, 2026-11-21)
- **받는 컴퓨터에 project가 없거나 옛것일 때의 처리는 지침의 일이다.** program은 기계를 건너는 id로 찾고 없으면 없다고 답한다. 버린 안: code를 옮기기. (사람, 2026-11-21)
- **명단에 든 내 컴퓨터끼리는 mail을 받는다.** 컴퓨터마다 켜는 스위치가 없다. 터미널 입력 허락은 받을지가 아니라 skip을 따를지에만 쓴다. 버린 안: 앱 command처럼 허락이 있어야 받기(허락이 없는 컴퓨터에는 말도 못 건다), 허락 없이 skip을 따르기(꺼 둔 허락이 mail로 뚫린다). (사람, 2026-11-21. skip 규칙은 agent)
- **handoff 재료는 미리 남겨 두고 사람이 정해 둔 길을 따라 흐른다.** note는 `computers` 폴더의 file이고 폴더 길이 나른다. 버린 안: 꺼진 컴퓨터에서 transcript를 꺼내 옮기기. (사람, 2026-11-21)
- **transcript, file, 커밋하지 않은 변경, 자격은 가지 않는다.** 글만 간다. (사람, 2026-11-17의 적용)
- **private인 workspace는 mail을 보내지도 받지도 않고 handoff note도 남기지 않는다.** (사람, 2026-11-17 "private은 기계 사이에도 선다"의 적용)
- **기계 사이의 call, 답, 취소는 mail 하나이고 id는 보낸 쪽이 짓는다.** 이유: id를 맞추는 표가 필요 없고 한 번 적용의 key가 된다. 버린 안: 종류마다 다른 길(실패 처리가 여러 벌). (agent)
- **한 mail이 두 길로 와도 받는 쪽이 한 번만 적용한다.** `across_machines` event와 같은 규칙이다. 버린 안: 한 길만 고르기(어느 길이 닿을지 보내는 쪽이 모른다). (agent)
- **mail은 응답을 기다리지 않는다.** 보내는 명령은 outbox에 넣고 call id를 바로 돌려준다. 이유: turn이 분 단위라 link의 call lane을 turn 끝까지 쥘 수 없다. 버린 안: 앱 command처럼 link로 동기 호출(받는 쪽이 꺼져 있으면 실패뿐이다). (agent, 2026-11-21)
- **outbox는 ledger 표다.** 받는 기계마다 순번을 매기고, 받는 쪽이 받았다고 답하거나 옛 판이라 거절할 때까지 남는다. 버린 안: 기록 표만 두고 다시 보내지 않기(앱 command의 길. 꺼진 기계에 닿지 않는다). (agent, 2026-11-21)
- **결과를 잃은 mail은 같은 id로 다시 보낸다.** `unknown`은 지나가는 배달 상태다. 받는 쪽이 id로 걸러 일이 두 번 돌지 않으므로 같은 mail을 다시 보내는 것은 일을 다시 시키는 것이 아니다. 버린 안: 결과를 모르는 mail을 "모름"으로 두고 다시 보내지 않기(조사한 제품이 모인 곳이지만 보낸 agent가 영영 기다린다). (agent, 2026-11-21. roadmap 정한 것 11을 이 뜻으로 고쳤다)
- **다른 컴퓨터의 mail이 가리킬 수 있는 session은 그 기계의 mail이 연 session뿐이다.** 이유: mail이 연 session이 다른 컴퓨터로 보내지 못하는 규칙이 있는데, 있는 session에 mail을 넣을 수 있으면 사람이 연 session이 셋째 컴퓨터로 넘기는 길이 열린다. 사람의 대화에 다른 컴퓨터의 agent가 끼어드는 것도 막는다. 버린 안: 앱 command의 넘기기처럼 session 주소를 그대로 받기. (agent, 2026-11-21)
- **받은 mail로 열린 session은 그 mail을 보낸 컴퓨터로만 보낸다.** 기계 사이 고리(A의 일이 B를 거쳐 C로)를 막는 것은 그대로이고, 다른 컴퓨터가 연 팀원이 부모에게 닿는 길만 연다. 버린 안: 모든 다른 컴퓨터를 막기(팀원이 부모에게 묻지 못한다). (agent, 2026-11-21. 연 컴퓨터로 좁힌 것은 agent, 2026-11-22)
- **다른 컴퓨터에 연 팀원은 연 컴퓨터의 행 하나로 팀에 든다.** 팀 규칙, 상한, 팀의 모양은 연 컴퓨터 하나가 쥐고 도는 컴퓨터는 mail이 이미 주는 것만 본다. 두 컴퓨터가 같은 session id를 쓴다. 새 mail 종류 없이 call·reply·cancel·state에 칸만 더한다. 버린 안: 두 컴퓨터가 팀 규칙을 나눠 갖기(규칙이 두 벌), 팀원을 연 컴퓨터의 queue로 받기(turn은 그 컴퓨터에 있다). (agent, 2026-11-22)
- **팀원 spawn은 비동기다.** spawn은 session id를 바로 돌려주고 그 컴퓨터에서의 실패는 늦게 call의 실패로 오며 자리가 닫힌다. 팀원은 잎이고, 팀원의 `ask`는 그 컴퓨터의 사람이 아니라 연 컴퓨터의 부모에게 가며, 늦은 spawn은 다른 mail처럼 그 컴퓨터의 대기 목록에 서고, 자리는 `max_members`의 한 자리다. (agent, 2026-11-22)
- **자리를 닫는 일은 상대를 기다리지 않는다.** 연 컴퓨터는 자리를 곧바로 닫고 `end` cancel을 낸다. 상대가 이미 닫았으면 그 mail(또는 되돌아온 `ended`)은 아무것도 바꾸지 않는다. 이유: 그 컴퓨터가 영영 돌아오지 않을 수 있고, 어느 쪽이 닫았는지 가리는 표가 필요 없다. 버린 안: 상대의 확인 뒤에 닫기. (agent, 2026-11-22)
- **자리는 이 컴퓨터의 session 목록과 session read에 없다.** 화면의 팀 tree는 session snapshot의 `runs_on`으로 그리고 사람의 보관에 드는 `state_seq`도 거기 싣는다. 자리는 `SessionStarted`를 내지 않는다. 이유: 자리의 agent는 그 컴퓨터의 handle이라 이 컴퓨터의 agent id가 아니고, 목록에 서면 입력을 받는 session처럼 보인다. 버린 안: session 꼴의 agent 칸을 넓히기(모든 session 화면이 다른 컴퓨터의 handle을 다뤄야 한다). (agent, 2026-11-22)
- **늦음은 10분, 만료는 7일이다.** 10분은 job의 `hold`가 놓친 차례를 가르는 값, 7일은 `across_machines` file의 수명이다. 버린 안: 만료 없는 mail(돌아오지 않는 컴퓨터로 보낸 call이 영영 열린다). (agent. 7일은 사람에게 물었고 답이 없어 추천대로 두었다)
- **대기 목록에는 돌았을 call만 선다.** 받을 곳이 없는 call은 늦었어도 바로 실패로 답한다. 이유: 사람이 [Start now]를 눌러야 실패를 아는 card는 쓸모가 없고 본문을 오래 둔다. (agent)
- **대기 줄은 push와 toast를 내지 않는다.** 대기 목록 card와 badge로만 보인다. 알림은 요구가 생기면 더한다. 버린 안: job의 `JobHeld`처럼 push를 내기. (agent, 2026-11-21)
- **대기 줄의 결정은 job hold와 같은 사람의 길이다.** 기기 목록에 두고 `screen`과 폰은 허락 없이 정하며 터미널과 agent·앱은 막는다. skip은 누른 기기가 아니라 보낸 컴퓨터에 준 허락으로 본다. 버린 안: 받는 컴퓨터 앞에서만 정하기(꺼 둔 기계에 사람이 가야 한다). (agent)
- **보낸 쪽은 가져갔는지 모르거나 대기 중인 call을 만료 + 10분 뒤 닫는다.** 이유: 받는 컴퓨터가 영영 돌아오지 않으면 보낸 쪽이 영영 열려 있다. 도는 call은 나이로 닫지 않는다(긴 일이 닫힌다). (agent)
- **늘 실패하는 맨 앞 mail은 timer의 다섯 번 뒤 버린다.** 이유: 그 하나가 그 기계로 가는 모든 mail을 막는다. 짧은 고장 동안 몰려오는 깨움은 세지 않는다. call은 옛 판도 아는 이유 `expired`로 닫는다. (agent)
- **폴더 길의 mail은 outbox에 60초 남은 것만 file이 된다.** 이유: link로 곧 닿을 mail마다 manifest를 다시 서명하고 나르면 낭비다. 받은 기계가 받은 id를 file로 알리는 것(acks)은 폴더 길에 답이 없어서다. 버린 안: 보낸 기계가 state mail로만 알기(state mail도 폴더로 와 보낸 줄을 언제 지울지 모른다). (agent)
- **옛 판의 상대.** 새 route를 모르는 컴퓨터는 `not_found`(또는 꼴을 모르는 `invalid_input`)로 답하고 보내는 쪽은 그 call을 `old_version`으로 닫는다. 받는 쪽 route는 그래서 `not_found`를 내지 않는다. 버린 안: remote protocol 판을 올려 옛 컴퓨터와 붙지 않기(mail 말고 다른 길까지 끊긴다). (agent, 2026-11-21)
- **다른 컴퓨터의 목록과 명함은 받는 쪽이 private을 빼고 보내는 쪽이 글을 다시 거른다.** 다른 컴퓨터에 내주는 명함은 private인 앱을 할당하지 않은 것처럼 만든다. 이유: 명함의 차이(할당한 앱의 command, skill)가 private 앱의 이름을 알린다. (agent)
- **harness agent의 binary도 네 명령의 `--on`을 그 명령의 칸으로 보낸다.** 이유: `machines/call`은 사람 자격만 받아 harness agent는 다른 컴퓨터에 닿지 못했다. 다른 명령의 `--on`은 거절한다. (agent)
- **handoff note의 글은 agent가 쓰고 언제 쓸지는 지침이 정한다.** program은 사실만 붙인다. (agent, `PRODUCT.md` §3)
- **handoff note는 ledger 표가 아니라 session마다 file 하나다.** 이유: 폴더 길이 file을 나르고, 다시 쓰면 바꾸는 값이라 기록이 필요 없다. 버린 안: 표에 두고 내보내기(같은 것을 두 곳에 둔다). (agent)
- **"Continue here"의 첫 말은 고정 머리말과 note 글이고 믿지 못할 data로 싸지 않는다.** 이유: 사람이 그 줄을 누른 것이 명령이다. 사람의 첫 메시지로 보낸다. 버린 안: note를 다른 agent의 입력처럼 tag로 싸기(사람이 고른 일이 사람의 지시로 읽히지 않는다). (agent)
- **이어 연 note와 뺀 note는 이 컴퓨터의 창에서만 숨긴다.** key에 쓴 때가 있어 다시 쓴 note는 다시 보인다. 버린 안: note file을 지우기(쓴 기계만 쓴다), core에 숨김 표 두기(가장 단순한 것보다 무겁다). (agent)
- **가져간 result call은 그 turn이 실패하거나, 사람이 멈추거나, 재시작으로 끊겨도 보낸 쪽에 실패로 돌아간다.** `agent-call.md` 18. 다른 컴퓨터가 보낸 call이면 실패 mail이다. (agent, 2026-11-21)

## 열린 것

- 늦음은 두 기계의 시계를 견준다. 시계가 10분 넘게 어긋난 두 컴퓨터는 모든 mail이 서거나 하나도 서지 않는다.
- 명단에서 빠진 컴퓨터로 간 mail은 만료(7일)로만 끝난다. 보낸 agent는 그동안 `pending`을 본다.
- `unknown`인 동안 그 기계의 줄은 다음 깨움(새 mail, link 바뀜, 60초 timer)까지 멈춘다. 그 사이 뒤의 mail(취소 포함)도 기다린다.
- 다른 컴퓨터에서 도는 팀원은 그 컴퓨터의 `team read`에서 부모(연 컴퓨터의 session)를 보지 못한다. 부모의 id는 spawn의 첫 call과 `spawned_by`에 있다. 자리의 이름은 그 컴퓨터의 handle이다(그 agent의 보이는 이름은 연 컴퓨터가 모른다).
- 다른 컴퓨터에 연 팀원의 길은 두 Router를 잇는 test로만 돌려 보았고 개발 core 둘로 돌려 보지 않았다.
- 확인은 한 기계에 띄운 개발 core 둘(link로 붙인 것)로 했다. 서로 다른 기계와 OS, 폰을 거치는 길, 실제 동기 도구(Syncthing, Google Drive)로 가는 folder 길은 돌려 보지 않았다.
