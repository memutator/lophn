# agent-call

agent 사이의 일 맡기기와 답하기를 하나의 모양(call)으로 푼다. handoff, 결과를 받는 escalate, program의 알림이 모두 같은 봉투를 쓰고, 받는 곳과 답 방식만 봉투의 칸으로 다르다. 보낸 쪽은 기다리며 막히지 않는다. 답과 늦게 안 실패는 보낸 session의 새 입력으로 돌아온다. 사람에게 올리는 것은 call이 아니라 session 안에서 묻는 것이다(escalate는 이 뜻으로만 쓴다).

## 흐름

```
 보낸 쪽                                  Router (core/router)                    받는 쪽
 ───────                                  ────────────────────                    ───────
 person (메시지)             ─┐           받는 곳 풀기                        ┌─ lophn session
 lophn call send|reply|cancel  ─┤       ├ 새 session   : agent handle+workspace로 하나 │   run-loop queue(메모리)
 program (알림)              ─┘─ route ─▶ ├ 열린 session : session ID           │
                                          └ 둘 다        : 열려 있으면 거기,    │
                                            닫혔으면 fallback의 agent+workspace 새 session ┘
                                          agent_calls 행(storage): agent가 보낸 것만
                                          unattended 표시: 봉투, 입력, 행에 싣는다

 agent가 보낸 call이 call 정책 밖이면     ─▶ forbidden     (call 행도 새 session도 없음)
 agent가 보낸 call을 받는 agent가 못 받으면 ─▶ invalid_input (call 행도 새 session도 없음)
```

보낸 쪽은 사람, program(늦은 실패와 취소의 알림, tools_changed 알림, workflow의 step 메시지. 종류만 있고 근거 칸이 없다), agent session 셋이다. step 메시지는 `kind: step`이고 call 행이 없다(`architecture/workflow.md`). 답 방식은 none(답 없음), result(받은 agent가 reply로 결과 하나), conversation이다.

## 지키는 것

- Router는 feature module을 import하지 않는다. session 목록, 배달, call 표는 port이고 wiring이 끼운다.
  - 세 종류의 보낸 쪽이 모두 쓰는 입구라, 한 module에 기대면 순환이 생긴다.
- 보낸 쪽을 막지 않는다. 동기 호출, timeout, 자동 재시도가 없다.
  - 입력 하나가 turn 하나이고 turn이 token이라 재시도가 곧 비용이다.
- agent가 archived 앱 workspace로 보내는 call은 없는 앱과 같은 `not_found`다(사람, 2026-11-07). 새 session을 여는 `SessionDirectory.open`(`packages/core/lophn-agent/workspaces/directory.ts`)이 보낸 쪽이 agent일 때 막는다. 사람과 program이 같은 workspace를 여는 길은 `conflict`(closed) 그대로다.
  - archived 앱이 agent에게 보이지 않는 규칙의 한 부분이다(`architecture/app-call.md`). 이미 열려 있던 session 주소로 보내는 call은 그 session이 입력을 받지 않아 `closed`다.
- 새 session을 열지 열린 session에 보낼지는 보내는 쪽이 고른다. "있으면 보내고 없으면 연다"를 기본으로 두지 않는다.
  - session을 열 때마다 token이 든다. "열린 session, 없으면 새 session"은 놓치면 안 되는 사실을 돌려줄 때만 쓴다.
- 받는 쪽의 앱(id, slug, 이름)과 project(id, 이름)는 정확히 맞아야 풀린다. 짐작하지 않는다. 풀리지 않으면 not_found, 같은 이름이 여럿이면 invalid_input이다.
- 실패는 조용히 버리지 않고 한 번만 알린다. 보낼 때 바로 아는 배달 실패(not_found, closed)는 agent에게 call tool 결과(`state: failed`, 이유)로만 돌려준다. 배달 뒤에 늦게 아는 실패(receiver_ended: 받은 session이 답 없이 끝남, lophn_restarted)는 tool 결과가 이미 돌아간 뒤라 이유를 붙여 보낸 session에 새 입력으로 돌아간다.
  - 같은 실패를 tool 결과와 입력 둘로 받으면 agent가 두 번 반응한다. 사람이 보낸 쪽이면 오류 코드로 바로 돌려준다. 보낸 session이 이미 없으면 알릴 곳이 없어 둔다.
- 부를 수 있는 session 목록의 상태는 running, waiting, idle, unknown이다. waiting·unknown은 지금 내는 곳이 없다. lophn session은 reader가 허락 기다림을 못 봐서 running으로 보인다. 구별이 필요해지면 turn 행에 적는 쪽을 본다.
- 부르는 것 자체에는 묻지 않는다. call tool에 Gate가 없다. workspace 안에서 누구를 부를지는 지침과 workflow의 일이다(`products/AGENT.md` T5).
- 어느 workspace에서 어느 workspace로 부를 수 있는지(시야)는 call 정책이 정한다(사람, 2026-11-04: workspace마다 agent가 열이면 agent 쌍을 하나하나 고르기엔 경우가 너무 많다). 기본은 모두 허용이다(사람, 2026-11-04: project → 앱의 lophn 같은 lophn 자신의 위임을 program이 고정 표로 막지 않는다. 먼저 있던 기본 거절 표는 agent의 추천이었고 되돌렸다). 사람이 설정 `lophn-agent.call_policy`의 `private`(project·앱)으로 workspace를 통째로 떼어 놓고, `workspaces`(workspace 쌍)와 `agents`(agent id 쌍)로 그 위에 예외를 둔다. private workspace는 다른 workspace(home 포함)와 call을 주고받지 않고 안에서는 부른다(사람, 2026-11-05: 들어오는 쪽·나가는 쪽을 나누면 경우가 너무 많아진다). home은 전역 agent가 어디서든 불리는 자리라 private이 될 수 없다. 판정은 agent 쌍 규칙 → workspace 쌍 규칙 → private → 기본(허용) 순이고 같은 쌍은 먼저 적힌 것이 이긴다(`packages/protocol/lophn-agent/call-policy.ts` `mayCall`). agent 쌍 규칙은 workspace를 보지 않아 모든 workspace 사이에 닿는다(private도 뚫는다). 고정 예외 하나(사람, 2026-11-07): Home의 lophn(`lophn_home`)이 private workspace의 lophn(`lophn_<id>`)에게 `reply: none`으로 보내는 call은 private 검사만 통과한다(`mayCall`의 `reply` 인자, Router가 `input.reply`를 넘긴다). `update-apps`가 앱의 lophn에게 일을 넘기는 길이다. 일은 들어가고 답·결과는 나오지 않는다. `result`·`conversation` reply, 다른 home agent, lophn(`isLophn`)이 아닌 받는 agent, private 쪽에서 나가는 call은 그대로 막힌다(home을 통째로 열면 home의 전역 agent가 private에 일을 넣고 결과를 받아 가 private의 뜻이 없어진다). 이 예외는 agent 쌍·workspace 쌍 규칙을 이기지 않는다(그 규칙이 이 쌍을 막으면 막힌다). 명함의 `callable`은 home·here만 묻고 home에서 다른 workspace로 가는 이 길은 그 둘에 없어서 예외를 반영하지 않는다. Router는 agent가 보낸 call만 받는 곳을 푼 뒤 본다(`router.ts` `policyRefusal`, 명함 검사보다 앞). 거절은 `forbidden`이고 tx가 되돌아간다. 설정은 writer Worker가 call마다 data root의 설정 file에서 읽어 바꾸면 다음 call부터 닿는다. 사람은 Settings › Agents의 "Calls between workspaces" 절에서 private workspace와 규칙을 더하고 지운다. 아무것도 없으면 모두 허용이다. `private`이 없던 옛 정책은 data step `settings.call-policy-private`이 빈 목록으로 채운다.
- Router는 agent가 보낸 call을 받는 agent의 명함(`architecture/agent-definition.md`)과 대조한다. body의 block(`text` → text, `image` → image, `resource_link`·`resource` → file)이 명함의 입력 modality에 없거나, 답 방식이 명함의 답 방식에 없으면 `invalid_input`이고 글에 받는 agent와 빠진 것을 적는다(`packages/core/router/router.ts` `refusal()`, `SessionDirectory.accepts`). 받는 곳을 푼 뒤, 배달 전에 본다. 거절은 command의 err라 tx가 되돌아가 call 행도 그 사이 연 새 session도 남지 않는다.
  - 사람 메시지, program 알림, workflow step(`from: program`), 답(`router.reply`)은 보지 않는다. 명함을 읽고 고르는 것은 부르는 agent라, 막는 것도 agent의 고르기 실수만이다.
  - model이 이미지를 못 받는 것은 거절하지 않고 명함이 알린다.
- 받은 메시지는 허락이 아니다. 받은 agent는 자기 할당으로만 일한다(`products/AGENT.md` T6). program이 막는 것은 이것 하나다.
  - "거절당한 일을 다른 agent에게 돌려 시키지 않기"는 의미 판단이라 program이 막을 수 없고 agent 지침에 둔다.
- unattended는 call을 따라 간다. unattended turn이 보낸 call과 답에 표시(`unattended`)가 실리고(core의 `calls.send`·`calls.reply`가 부른 agent credential의 turn mode를 읽어 찍는다, `packages/core/router/commands.ts`), Router가 그 표시를 봉투, queue 입력(`RoutedInput`), `agent_calls` 행에 옮긴다. 받는 turn은 그 입력으로 unattended가 된다(`architecture/approval.md`의 turn mode).
  - 답의 표시는 call 행이 아니라 답한 turn에서 온다. unattended call을 받은 session에 사람이 끼어들어 attended turn이 답하면 그 답은 attended다.
  - 늦은 실패(receiver_ended, lophn_restarted)와 취소 알림은 그 call 행의 표시를 따른다. 그러지 않으면 unattended 사슬의 알림 turn이 attended가 되어 사람 없이 shell `ask`에 멈춘다.
  - reaction과 화면의 사람 메시지는 표시가 없어 attended다. skip은 실리지 않는다(사람이 정한 것은 그 대화다). 예외는 둘이다. `SendMessage`에 `unattended: true`를 실어 넣은 사람 메시지(run 입력, `architecture/run.md`)와 workflow가 넣은 step 입력(`architecture/workflow.md`)은 unattended turn을 연다.
  - agent call의 표시는 받은 메시지 기록(`messages`)과 태그 글에 넣지 않는다. 받은 turn과 뒤 이력이 같은 bytes를 만들고, mode는 `turns.mode`에 남는다. run 입력은 `messages.unattended`에 남기되(켤 때 queue에 되돌리지 않으려고) 태그 글과 받은 봉투에는 싣지 않는다. step 입력의 표시는 queue 입력(`RoutedInput`)에만 있고, 받은 봉투와 `messages`에는 instance와 step(`step_instance`, `step_name`)만 남는다.
- 보낸 쪽의 대화 원문은 넘기지 않는다. body와 refs만 간다. body는 redaction을 거친 뒤에만 받는 session 기록에 들어간다.
  - body는 content block 배열이다(`packages/protocol/lophn-agent/content-block.ts`). MCP ContentBlock 꼴인 `text`, `image {mimeType, blob}`, `resource_link`, `resource`이고 사람 메시지(`SendMessage.content`)도 같은 꼴이다. 저장할 때는 block마다 메시지 content의 part 하나가 된다.
  - redaction은 글(text, link, resource text)에만 한다. 이미지는 bytes 대신 blob hash를 싣는다. 본문 상한(240 KiB)에 이미지가 들어가지 않기 때문이다. bytes는 보낸 자격이 먼저 올린 blob이다. 사람은 `message-images/upload`, agent는 `message-images/prepare`로 올린다. command는 같은 transaction에서 그 blob의 참조를 그 이미지를 담은 메시지에 건다.
  - 넘길 것은 값으로 싣는다. agent는 `lophn call send|reply --image <path>`로 자기 session이 읽을 수 있는 file(file tool과 같은 `resolveInWorkspace` 검사, 180 KB 이하)을 image block으로 싣는다. 받는 쪽에는 그 file의 읽기 허락이 가지 않는다.
  - 이미지는 그 blob을 참조하는 메시지가 있는 session에서만 읽힌다(`imageReferenced`). 다른 session은 hash를 알아도 읽지 못한다. 참조를 걸 때 blob store가 현재 자격이 그 hash를 준비했는지 확인하므로, 남의 hash를 자기 메시지에 실어 읽기를 얻을 수도 없다.
  - 고정 문구(늦은 실패 알림, 취소 알림)와 body는 tx 안에서 blob을 만들 수 없어서 command 앞단이 미리 준비해 둔다.
- `agent_calls` 행은 agent가 보낸 call에만 둔다. 사람 메시지와 reaction(program 알림)은 행이 없다.
  - 이름을 풀지 못한 call도 행이 없다(받는 곳을 적을 수 없다). 끝난 행은 trigger가 막아 바뀌지 않는다. 이어지는 일은 새 call이다.
- dedup(보낸 session + tool call ID)은 unique다.
  - run-loop는 일시 실패한 read tool을 같은 tool call로 한 번 더 부른다. `call.send` 명령(`packages/cli/commands/call.ts`)의 효과는 read라 그 대상이고 dedup은 명령의 idempotency key(그 tool call ID)다. 첫 시도가 call을 만들고 실패로 돌아오면 재시도가 call과 session을 하나 더 만든다.
- queue는 메모리라 꺼지면 사라진다. 그래서 turn이 입력을 가져갔는지(consumed)를 행에 적고, lophn을 켤 때 accepted인데 가져가지 않은 call을 failed(lophn_restarted)로 닫는다. 팀의 ask call은 가져갔어도 닫는다(아래 "팀").
  - 같은 tx에서 돌던 turn도 interrupted로 닫고, agent runtime이 turn을 읽기 전에 끝낸다. durable queue를 만들지 않는 대신 조용히 사라지는 call이 없게 하는 장치다.
- 답 없는 call(none)은 받는 turn이 입력을 가져갈 때(consumed) done이 된다. 그 전까지는 accepted다.
  - 배달할 때 done으로 두면 켤 때 queue와 함께 잃은 handoff를 위 장치가 가리지 못한다. 가져간 뒤에도 accepted로 두면 받은 session을 archive할 때 이미 넘어간 일에 receiver_ended가 가고 화면의 [Cancel]이 남는다.
- 같은 사실을 두 길로 알리지 않는다. 이미 끝난 call(취소, Router가 먼저 닫음)에는 Router의 실패 알림이 다시 가지 않는다.
- queue 순서는 사람 메시지가 먼저, 그다음 들어온 순서다. steer(도는 turn의 다음 model 요청 앞에 넣기)는 사람 메시지만 고른다. call, 답, reaction, 알림은 항상 다음 turn이다.
  - 아직 turn이 가져가지 않은 사람 메시지는 사람이 글을 고치거나 사람 메시지끼리 순서를 바꿀 수 있다. 고치면 redaction을 거친 새 본문 blob으로 `messages.body`와 blob 참조를 같은 transaction에서 바꾸고 queue의 본문도 command가 돌려준 값으로 바꾼다. 고친 본문에는 이미 있던 image block만 남길 수 있다(새 이미지는 `invalid_input`). 이미지 참조는 본문 참조와 따로라 고쳐도 남는다. 순서는 `created_seq`를 이웃과 맞바꿔 켤 때 queue에 다시 넣는 순서까지 같게 한다. 가져간 뒤에는 본문과 순서가 trigger로 고정된다.
- 다른 agent·program이 보낸 입력(call, 답, reaction, 알림)은 받은 turn의 입력과 뒤 turn의 이력에서 같은 함수로 태그에 싼다. 그 turn이 끝나도 사람 글과 구별되어야 한다. 사람 메시지는 싸지 않는다.
  - 그 함수는 `packages/core/lophn-agent/run-loop/input-text.ts`의 `inputParts` 하나다. 이력 재생(`receivedParts`, `session/history.ts`)도 같은 함수를 부른다. 결과는 part 목록이다. 순서는 tag를 여는 글과 본문 글 줄, 그 뒤 image part를 block 차례대로, 마지막에 닫는 글이다. `resource_link`·`resource`는 본문과 같은 escape를 거쳐 글 줄이 된다.
  - image part는 blob hash만 갖고, `loadParts`가 같은 reader로 bytes를 붙인다. reader는 agent 자격의 `message-images/path`로 파일 경로를 푼다. 그래서 받은 turn과 뒤 이력은 이미지까지 같은 bytes다. 읽지 못한 이미지는 두 길 모두 `[image unavailable]` 글이 되어, 깨진 이미지 하나가 session을 막지 않는다. 두 길이 같은 bytes를 만들도록 받은 메시지의 봉투가 call의 답 방식(`reply`), reaction이 알리는 사실 이름(`event`), 실패한 답의 이유(`fail_reason`)를 같이 저장한다. 앞 두 속성 중 하나라도 이력에서 빠지면 call·reaction을 받은 turn 다음 요청부터 그 자리의 prefix가 달라져 cache가 한 번 깨지고, 답 방식 줄이 빠지면 결과를 받는 call을 받은 agent가 답해야 한다는 것을 잊는다.
- 그래서 받은 순서와 turn 순서가 다르다. turn의 이력은 앞 turn들이 가져간 message를 turn 순서로 놓고 그 turn의 입력을 붙인다. 받은 순서로 자르면 아직 아무 turn도 가져가지 않은 call이 앞 turn의 prompt에 들어간다.
- 닫힌 call에 늦게 온 답은 오류가 아니라 closed로 돌려준다. 받은 agent가 답이 전해지지 않았음을 알아야 하기 때문이다.
- lophn runtime의 result 답은 받은 agent가 reply로 직접 보내야 call이 done이 된다. lophn session은 저절로 끝나지 않아 program이 끝을 모른다. conversation은 program이 done으로 만들지 않는다. 취소나 실패로 끝난다.
- harness runtime session은 run-loop queue가 아니라 harness queue가 받는다(`TargetSession.transport`가 `harness`, `architecture/coding-agent.md`). 설정 `extensions.harness.enabled`(Settings › System › Extensions)가 꺼져 있으면 그 session으로 가는 메시지·call·step은 `unavailable`이다. 답은 bare와 같다.
- bare runtime(`architecture/agent-definition.md`)은 result call을 받은 turn이 끝날 때 마지막 응답 글이 답이다. 받은 call 글도 `lophn call reply` 대신 그렇게 알린다.
  - core wiring(`packages/core/main/daemon/wiring/bare-reply.ts`)이 `TurnEnded`를 구독해, outcome이 `completed`이고, turn 입력이 result call이고, 그 call이 아직 이 session이 받은 `accepted`이고, turn이 고정한 resolved agent(`turn_resolved`)가 bare이고, 그 turn의 마지막 agent 메시지 글이 비지 않았을 때만 보낸다.
  - 답은 redaction과 본문 준비를 거쳐 machine 명령 `AutoReplyCall`(`calls/auto-reply`, `packages/core/router/commands.ts`)로 `router.reply`를 부른다. agent의 `ReplyCall`과 같은 규칙이고, 이 session이 받는 쪽이라 call이 done이 된다. unattended 표시는 그 turn의 mode를 따른다.
  - 그 밖(멈춤, 실패, 빈 글, conversation·none call)에는 보내지 않는다. call은 lophn에서 답하지 않은 때처럼 accepted로 남고, 받은 session을 archive하거나 지울 때 `receiver_ended`로 닫힌다. turn 도중 bare가 고른 `call.reply`로 이미 답했으면 call이 done이라 다시 보내지 않는다.
  - runtime 쪽(turn을 닫기 전)이나 tx 안에서 하지 않는다. 멈춘 turn에 답이 나가면 안 되고, 본문 blob은 tx 안에서 만들 수 없다.
  - 마지막 응답 읽기는 run의 결과와 같은 함수다(`wiring/turn-answer.ts`의 `turnAnswer`, `architecture/run.md`). 글만 싣는다.
- 화면의 call 블록은 펼치지 않는다. 머리 줄이 답 방식에 맞는 말(none은 "Handoff to", result는 "Asked", conversation은 "Working with")과 받는 곳이고, 오른쪽 끝 [Open conversation]이 받은 session을 연다. 실패만 그 자리에 이유 한 줄로 보이고, 답과 늦게 안 실패는 이어지는 새 메시지다(`packages/shell/renderer/conversation/thread/call-block.tsx`).
- call의 `to`는 셋 중 하나다(`callAddressInputSchema`, `packages/protocol/lophn-agent/calls.ts`): `{session}`(열린 session), `{agent, workspace?}`(새 session), `{agent, workspace?, session, fallback: "new"}`(열린 session, 닫혔으면 그 agent+workspace의 새 session). `agent`는 agent의 handle이고 workspace가 없으면 home이다. handle은 전역에 하나라(범위 있는 agent 포함) 하나로 풀린다. 단 handle `lophn`은 workspace마다 하나라 workspace와 짝으로 풀린다(`resolveAddress`: `{agent: "lophn", workspace: X}`는 `lophnIdOf(X)`, workspace를 빼면 Home). agent가 보낸 call은 workspace를 빼면 부른 session의 workspace로 바뀐다(`router.ts`의 `resolve`, `lophn`과 `spawn`만. 다른 agent는 home 그대로다). 그래서 workspace를 뺀 `lophn` call은 부른 쪽 workspace의 lophn에게 새 session을 연다. Home lophn은 Home에서 보낸 call이나 사람과 program의 call로만 닿는다. 범위 있는 agent(`architecture/agent-definition.md`)는 그 workspace에 여는 call(`{agent, workspace: <그 workspace>}`)로만 닿고, 다른 곳에 열려 하면 not_found다. call 정책(private workspace 포함)은 그대로 걸린다. `fallback`은 session이 닫혔을 때 열 새 session의 `{agent, workspace?}`를 같이 적는 꼴이다. 보낸 이(`from`)는 사람, program, agent session 셋이다.


## 팀

- **팀은 spawn tree다.** `lophn team spawn <agent> [--workspace …] --body …`(route `team/spawn`, `packages/protocol/lophn-agent/team.ts`, 명령 `packages/cli/commands/team.ts`)로 연 session은 연 session의 자식이고 `sessions.spawned_by`(ledger step `lophn-agent.sessions.spawned-by`, 바꾸지 못한다)에 부모가 남는다. spawn은 `call.send`의 새 session 길(`route`에 `spawn: true`)을 그대로 거쳐 call 하나를 같이 만든다. 받는 곳 풀기, call 정책, 명함 검사가 같다. `--workspace`가 없으면 부모의 workspace다. 부모는 입력이 아니라 자격의 session이라 spawn은 늘 내 밑이다. 지금 `call.send`의 `to: {agent, workspace}` 새 session은 `spawned_by`가 없는 팀 밖이다(home lophn이 project lophn에 넘기는 흐름이 팀 규칙에 묶이지 않게).
- **`spawned_by`가 있는 session의 call은 부모, 형제(같은 부모), 자기 자손에게만 간다.** Router `route()`가 call 정책(`policyRefusal`) 다음에 `teamRefusal`로 보고 아니면 `forbidden`이다. call 정책은 그 위에 그대로 겹친다. root(`spawned_by` 없음), 사람 메시지, program 입력, `reply`·`cancel`은 거르지 않는다. 팀 밖에서 팀원에게 오는 call도 지금 규칙 그대로다. member의 `session list`도 같은 집합만 보인다.
- **끝내기는 자기 엄격한 자손만이다.** `lophn team end <ses>`(`team/end`, `packages/core/lophn-agent/session/team-commands.ts`)가 대상과 그 밑의 열린 session을 잎부터 archive처럼 닫는다(`endSession`). 남의 자손이면 `forbidden`이다. 사람이 부모를 archive하거나 지워도 자식은 남는다.
- **상한은 설정 `lophn-agent.team`(기본 `max_members: 8`, `max_depth: 2`)이다.** core는 desk를 모르므로 root session 아래 열린 자손 수와 새 자식의 깊이(root 0)로 센다(`checkSpawnSlot`, `workspaces/lifecycle.ts`). desk는 root가 있는 자리라 같은 뜻이다. 넘으면 `conflict`이고 tx가 되돌아가 session도 call 행도 남지 않는다. 거절 글은 "do the work yourself or ask your parent"로 끝난다. 설정은 call 정책처럼 data root 설정 file에서 spawn마다 읽는다.
- **연락처는 prompt가 아니라 `lophn team read`(`team/read`)다.** 부모, 형제, 자식의 handle·이름·description·runtime·상태와, caller가 그 팀원에게 보내고 아직 답을 받지 못한 call(`open_calls`)이다. lophn 자식이 `call reply`를 잊으면 부모가 깨지 않으므로 부모가 이것으로 알아챈다. 팀이 바뀌면 turn을 준비할 때 앞에 본 팀(`SeenBasis.team`, 부모·형제·자식의 `ses_id handle` 줄)과 비교해 고정 글 notice `team_changed`를 대화 끝에 붙인다(`tools_changed`와 같은 길). queue에 입력으로 넣지 않으므로 쉬던 session을 깨우지 않고 그 session의 다음 turn에 닿는다. bare는 팀을 보지 않는다.
- **`team spawn`의 `--reply` 기본은 `result`이고, 첫 call 본문 앞에 core가 고정 글(`TEAM_MEMBER_PREAMBLE`, `packages/protocol/lophn-agent/team.ts`)을 붙인다.** 직접 하라, 끝나면 `call reply`, 모르면 `ask`(부모에게 간다), spawn한 뒤 turn을 끝내고 poll하지 마라. 같은 말이 `team spawn` help와 skill `lophn-agent`에 있다. system prompt에는 넣지 않는다(prompt cache). 받은 메시지로 저장되어 이력 재생이 같은 bytes다.
- **팀의 ask call.** 자식의 질문과 shell 승인은 부모에게 가는 result call이다(`approval.md` "팀 자식의 물음"). core main thread(`wiring/approvals.ts`)가 machine 명령 `calls.ask-open`으로 자식 이름의 call을 연다. call 정책, 팀 규칙, 명함 검사를 그대로 거친다. 행의 `agent_calls.ask`(`question` | `approval`, ledger step `router.agent-calls.ask`)가 표시다. call과 request·질문의 짝은 request처럼 main thread 메모리에 있다.
  - 답(`call reply`)은 자식의 queue로 배달하지 않는다. Router가 call을 `done`으로 두고 commit 뒤 topic `router.ask-answered`를 내면 main thread가 짝을 푼다. 승인 call의 답은 `decision`(`allow` | `reject`)이 있어야 하고 다른 call의 답은 `decision`을 싣지 못한다(`invalid_input`). harness·bare 부모의 자동 답(`calls.auto-reply`)이 승인 call에 닿으면 `reject`다.
  - 자식 쪽이 먼저 끝나면 main thread가 `calls.ask-withdraw`로 취소하고 부모는 취소 알림을 받는다. 부모가 끝나 `receiver_ended`면 자식 queue에 실패 알림을 넣지 않고 topic `router.ask-ended`로 기다리는 쪽을 거절로 푼다.
  - 재시작하면 짝이 메모리와 함께 사라진다. 그래서 켤 때 `lophn_restarted`로 닫는 call에 부모가 이미 가져간 ask call도 넣는다. 자식에게는 알리지 않는다(자식 turn은 같은 recover에서 interrupted로 닫힌다). 부모의 늦은 답은 `closed: true`다.
- **같은 workspace의 자식은 부모 옆에 열린다.** spawn이 commit된 뒤 router wiring이 `hostQueue.openTab({opener: 부모, target: {session: 자식}, place: "group", source: 부모})`를 부른다(`workspace-layout.md` "agent가 연 탭"). 다른 workspace의 자식은 tree에만 있고 탭을 열지 않는다. layout은 보이는 방식일 뿐이라 사람이 탭을 옮겨도 팀은 바뀌지 않는다.

## 왜 이 모양인가

- **팀은 spawn tree이고 규칙은 세 줄이다(사람, 2026-11-08).** 일손을 늘리고 줄이는 것과 누가 누구에게 말할지를 연 관계 하나로 정한다. layout group을 팀으로 쓰면 사람이 탭을 옮길 때 팀이 바뀐다. 연락처를 prompt에 싣지 않는 것은 팀원이 늘고 줄 때마다 prompt cache가 깨지지 않게 하려는 것이다.

- **call 하나의 모양.** handoff, escalate, program 알림을 따로 만들면 실패 처리와 화면이 세 벌이 된다. 다른 것은 받는 곳(새 session, 열린 session)과 답 방식(none, result, conversation)뿐이다. 선례: A2A의 id 없음/taskId, Erlang의 cast/call.
- **동기 호출과 subagent는 버렸다.** turn이 분 단위라 보낸 turn이 결과를 기다리면 맞지 않는다(Erlang call 5초, Orleans의 turn 점유). 답은 Akka ask의 pipeToSelf처럼 보낸 session의 새 입력으로 온다. A2A의 polling, SSE, webhook도 쓰지 않는다.
- **Orleans식 "없으면 만든다"를 버렸다.** session을 여는 것이 token이라 보내는 쪽이 명시해야 한다.
- **dead letter를 버렸다.** 조용히 버리면 보낸 agent는 일이 진행 중인 줄 안다. Erlang monitor의 DOWN처럼 이유를 돌려준다.
- **상태는 accepted, done, failed, cancelled 넷이다. `sent`와 `declined`가 없다.** Router가 행 만들기와 입력 넣기를 한 번에 해서 sent로 머무는 때가 없다. declined와 done을 나눠도 program이 다르게 하는 일이 없고, "맡지 않겠다"는 글은 보낸 agent가 읽을 의미다. 그래서 맡지 않을 때도 reply로 이유를 보낸다. 봉투의 여는 방식 칸(tab, tui, headless)도 transport마다 값이 하나뿐이라 뺐다. 되살리고 싶어지면 이 이유를 먼저 본다.
- **주소는 session ID다.** 사람이 읽는 label은 표시용이다. 보이는 이름은 겹칠 수 있어 주소가 아니다(agent의 주소는 handle이다). 열린 session 목록(ID, agent handle·이름, 제목, workspace, 상태, 마지막 활동 시각)은 prompt가 아니라 tool result(`session.list`)로만 주어 prompt cache를 깨지 않는다. 상태 `waiting`은 사람의 동의나 질문 답을 기다리는 turn이다. workspace prompt의 "Agents you can call"은 session ID 없이 agent의 handle(이름이 다르면 함께)만 싣고(그 workspace에서 보이는 agent: 전역과 그 workspace의 범위 agent, 그 workspace의 lophn), session이 아직 없는 agent도 넣는다. call이 새 session을 열 수 있기 때문이다. 어느 workspace에서 열지는 보내는 쪽이 고른다.
- **call을 판정하지 않는다.** 예전에는 call tool이 turn 안에서 묻고 Router가 tx 안에서 한 번 더 판정해 둘을 `gate_allowed`로 이었다. 부르는 것을 막아도 받은 agent의 할당이 이미 일을 거르고, 사람이 workflow에서 "call 금지 같은 딱딱한 규칙을 두지 않는다"고 정했다(`project-docs/products/roadmap/approval.md`).
- **도는 turn에 끼우지 않는다.** 조사한 harness 대부분은 도는 turn을 끊지 않고 다음 model 요청 앞에 붙인다. lophn은 사람의 "그만"만 급하다고 보고 사람 메시지에만 steer를 열었다. 다른 agent의 입력까지 끼우면 입력 하나가 turn 하나라는 셈이 흐려진다.
- **넘길 것은 값(content block)으로 싣고 읽기 grant를 만들지 않는다.** call 동안 file을 읽게 해 주는 장치를 두면 grant의 범위와 끝을 따로 관리해야 한다. 값으로 실으면 부른 쪽이 봉투에 실은 것이 곧 불린 agent에게 여는 시야다. block 꼴을 MCP ContentBlock에서 빌린 것은 ACP와 MCP tool 결과가 같은 꼴이라 harness 쪽과 그대로 이어지기 때문이다.
- **reply 명령을 모르는 runtime은 turn 끝의 마지막 응답이 답이다(agent, 2026-11-04).** bare는 고른 tool만 받아 사람이 `call.reply`를 고르는 것을 잊으면 result call이 영영 accepted로 남아 부른 쪽(workflow 포함)이 멈춘다. lophn은 지금처럼 reply 명령이다. lophn은 한 turn에 답 말고도 할 말이 많아 마지막 응답을 답으로 보면 틀린다.
- **원문 넘기기와 fuzzy 매칭을 버렸다.** OpenAI handoff의 history 전달은 맥락 비용과 오염이 크고, CrewAI식 비슷한 이름 짐작은 엉뚱한 agent에게 일을 맡긴다.
