# app-call

앱은 선언의 `tools[]`에 MCP tool 모양으로 tool을 선언하고, 그 tool을 부르는 길은 다섯이다: 사람이 연 앱 화면, agent의 tool(그 앱 place의 session은 preview도), 다른 앱, job이 연 tool run(program), flow instance가 연 tool run(flow). 어느 길이든 같은 판정(부른 쪽 확인, 막기)과 같은 기록(invocation)과 같은 직렬화(write는 앱마다 하나씩)를 거쳐야 한다. 그래야 "이 호출이 앱 data에 한 일"을 호출 단위로 알고, 사람이 고른 시점으로 앱 data를 되돌릴 수 있다(rewind). 그래서 모든 호출은 core를 지나고, write 동안의 앱 DB 변경은 changeset으로 떠서 invocation에 붙여 보관한다.

## 흐름

```
 person ── shell 앱 화면 ─────┐
 agent  ── run-loop tool ─────┼─ core-api(app.call_tool) ─▶ 호출 경로 (core/apps/calls)
 app    ── sdk ─ broker ──────┤              1 부른 쪽 확인        (credential, 도는 turn·부모 invocation·job run·instance)
 program ── job run의 tool run ─┤   (core 안 run 연산만. route로는 못 연다)
 flow  ── instance의 tool run ──┘   (같다)
                                             2 막기               agent는 할당(judge), program·flow는 만든 agent의 할당(unattended)과 domain 거르기,
                                                                  앱은 active 앱 grant의 app.call. 묻지 않는다
                                             3 write·external이면 앱별 줄을 얻는다. read는 바로
                                             4 invocation 시작을 남긴다        ─▶ storage (ledger + changeset blob)
                                             5 보낸다
                                                │ child-supervision-protocol (supervisor가 길만 이어 준다)
                                                ▼
                                    앱 process (sdk runtime): handler 실행
                                    write·external 동안만 SQLite session ─▶ 결과와 changeset을 응답에 싣는다
                                                │
                                             6 invocation을 끝으로 남기고 changeset을 붙인다 ─▶ 부른 쪽에 결과

 rewind (사람만): 되돌릴 목록 ─▶ 앱 접수 닫기·drain ─▶ changeset을 최신부터 뒤집기(base)
                  ─▶ 앱 process가 한 transaction으로 적용(sdk) ─▶ 되돌림 표시, 접수 열기
 session rewind에서 사람이 앱을 고르면 같은 rewind로 간다 (place-session)
```

앱이 무엇을 했는지는 호출 기록(invocation)과 앱 log가 말해 준다. log는 앱마다 file 하나로 쌓고 supervisor 한 곳만 쓴다.

```
 앱 stdout·stderr (SDK reportProblem의 줄 포함, `[inv=<id>] ` 머리는 떼어 invocation 칸에) ─┐
 잡히지 않은 예외 (SDK가 frame 풀이 전의 stack을 broker로 보냄) ──────────────────────────┤
 앱 process의 비정상 종료 (supervisor가 관측) ───────────────────┤
 화면 오류 ── shell main ─ core(app.log_view_error) ─ supervisor ─┤
                                                                 ▼
                       app supervisor: 줄마다 redaction ─▶ 300자로 자름 ─▶ 줄 하나 ({ at, invocation, text })
                                                                 ▼
              <data root>/apps/<app>/logs/app.log  ── 8 MiB를 넘길 줄이면 app.log.1로 옮기고 새로 쓴다
 읽기: app.logs ─ core가 app.log.1, app.log를 직접 읽어 거르고 알려진 secret 값을 한 번 더 지운다 (supervisor가 없어도 읽힌다)
```

## 지키는 것

- tool 선언은 MCP tool 정의(`name`, `title`, `description`, `inputSchema`, 선택 `outputSchema`)에 lophn 칸 셋을 더한 것이다. `effect`(`read`, `write`, `external`)는 program이 강제하고(write 줄, 기록), `public`은 다른 domain에 보이는지, `domain`은 그 tool이 다루는 객체의 domain(그 앱의 domain 이름)이다. `domain`은 필수이고 앱의 active domain 이름이 아니면 release 준비, `declaration.check`, activation 직전 재검사가 거절한다(`architecture/domain.md`). 이름은 1~64자 `[A-Za-z0-9_.-]`이고 schema의 root는 `object`다(인자가 없으면 `inputSchema: null`).
  - MCP annotation(`readOnlyHint`, `destructiveHint`, `openWorldHint`)은 effect에서 만들어(`toMcpTool`) 바깥에 보일 때만 싣는다. 힌트일 뿐이고 강제하지 않는다.
- 모든 tool 호출은 core를 지난다. 화면에서 앱으로, 앱에서 앱으로 가는 직통 통로를 두지 않는다.
  - 막기, 기록, write 줄이 core 한 곳에 있어야 changeset이 빠지지 않는다.
- 부른 쪽은 호출 본문이 주장하는 대로 믿지 않고 core가 확인한다. credential의 종류와 caller 종류가 맞아야 하고, agent는 지금 도는 turn의 tool call이어야 하고, 앱은 활성 release이면서 부모 invocation이 지금 도는 호출이어야 하고, program은 본문의 job과 job run이, flow는 본문의 instance가 core가 만든 자격과 같아야 한다.
  - 끝난 turn이나 꺼진 판의 호출이 실수로 섞이면 막기와 기록이 틀린다. agent, 앱, program, flow는 늘 live 활성 release만 부른다.
- tool 호출은 domain을 싣지 않고 invocation에도 domain이 없다. 어느 domain이 불렀는지는 부른 session의 agent가 맡은 domain으로 안다.
  - 앱 code가 호출자별로 data를 나누는 관례는 core가 지키지 못한다. 그래서 호출에 범위를 싣지 않는다.
- 다른 domain의 agent는 앱의 `public` tool만 본다. 맡은 domain의 agent는 그 domain의 모든 tool을 본다. 같은 앱의 다른 domain도 다른 domain이다. 어느 domain을 맡았는지는 agent의 place와 정의가 정한다(`architecture/domain.md`, `agent-definition.md`).
- 호출 경로는 묻지 않고 막기만 한다. agent의 호출은 그 agent의 지금 할당을 `judge`로 보고(할당 안 된 앱, 뺀 tool이면 막는다), 앱의 호출은 부른 앱의 active grant 가운데 `app.call`이 그 대상 앱의 그 tool을 덮는지 본다. 막히면 `denied(gate_blocked)`다. 판정 자리는 write 줄 앞이다.
  - 사람에게 묻는 자리는 run-loop tool gate 하나다(`architecture/approval.md`). agent의 호출이 여기 닿았으면 물을 것은 이미 물었다. 앱이 앱을 부르는 것은 activation 때 사람이 grant로 허락한 것이라 묻지 않는다.
- program은 job이 연 tool run의 호출이다(`architecture/job.md`). 부른 쪽 사람이 없고 부른 turn도 없다. 자격(`CallAuth.program`: job, job run, 그 job을 만든 agent와 place)은 route가 만들지 못하고 core 안 run 연산이 만든다(`packages/core/main/daemon/wiring/runs.ts`). caller 본문은 `{kind: program, job, job_run}`뿐이고 자격과 같아야 한다(`verifyCaller`).
  - 판정은 만든 agent의 지금 할당이다. 호출 때 읽고(`judge`를 mode `unattended`로 부른다) 그 job을 만든 뒤에 할당이 바뀌었으면 바뀐 대로 본다. 거기에 domain 거르기를 더한다: 공개(`public`) tool이거나 만든 agent가 맡은 domain의 tool이어야 한다. 그 agent의 tool 목록에 뜰 tool만 부른다는 같은 규칙이다(`packages/core/apps/calls/gate.ts`의 `callAllowed`). 어느 domain을 맡았는지 읽는 셈은 사용 관계와 같다(`packages/core/main/daemon/agent-domains.ts`). 읽지 못하면 막는다.
  - 막히면 `denied(gate_blocked)`가 기록되고 run은 `tool_denied`로 실패한다. job run은 `failed`다. 그 밖의 줄, 기록, 직렬화는 다른 호출과 같다. invocation의 `caller_kind`에 `program`이 있다.
  - job은 만든 agent의 할당으로 돈다. 그래서 다른 agent가 그 job을 고치면 남의 할당으로 일을 시키게 되므로 job은 만든 agent만 고친다(`architecture/job.md`).
- flow는 workflow instance가 연 tool run의 호출이다(`architecture/workflow.md` "flow"). program과 같은 길이다. 자격(`CallAuth.flow`: instance, 그 project의 PM과 project place)은 core 안 run 연산만 만들고, caller 본문 `{kind: flow, instance}`의 instance가 자격과 같아야 한다. 판정은 PM의 지금 할당과 PM이 맡은 domain이다. code를 쓴 것이 PM이라 code로 PM의 할당을 넓히지 못한다. 사람이 PM에게 그 앱을 할당해야 flow가 그 tool을 쓴다. invocation의 `caller_kind`는 `flow`다.
- 앱 process의 caller parser(`packages/core/apps/runtime/entrypoint/wire.ts`)와 `packages/sdk/cap-tool/context.ts`, invocation의 `InvocationCaller`는 protocol schema의 손 사본이라(앱 process는 Zod를 싣지 않는다) caller 다섯 종류(person, agent, app, program, flow)를 protocol과 같이 받아야 한다. 하나라도 빠지면 그 caller의 호출이 앱에서 말없이 거절된다. invocation 표의 `caller_kind` CHECK는 protocol의 `appToolCallerSchema`에서 만든다(`packages/core/apps/invocations/schema.ts`).
- write와 external은 앱마다 한 번에 하나다. core의 줄과 앱 process 안의 mutex, 두 겹이다. read는 동시에 돈다.
  - SQLite session은 연결 단위라 두 write가 겹치면 한 changeset에 두 호출의 변경이 섞여 호출 단위로 되돌릴 수 없다. 줄을 쥔 호출이 돌아오지 않아도 줄이 영영 막히지 않게 abandon이 줄을 비운다.
- changeset은 앱 process(sdk)만 뜨고 적용한다. 앱 DB는 그 앱의 process만 열기 때문이다. core는 보관하고, 뒤집고, 지휘한다.
  - sdk migration으로 만드는 표는 PRIMARY KEY가 필수다. 없으면 SQLite session이 그 표의 변경을 기록하지 않아, 되돌릴 수 없는데 되돌린 것처럼 보인다.
  - read tool이 DB를 바꾸지 않는다는 선언은 믿고 검사하지 않는다. 틀린 선언이 rewind를 충돌시키면 통째로 취소되고 이유가 남는다.
- 보냈는데 응답을 못 받은 호출은 실패가 아니라 결과 모름(unknown)이다. 추정하지 않고 같은 일을 다시 부르지 않는다. 보내기 전에 막힌 것(앱이 멈춤, 연결 없음)은 unavailable로 구분한다. core가 다시 켜질 때 running으로 남은 invocation도 unknown으로 닫는다.
  - 쓰기가 일어났는지 모르는 채 성공이나 실패로 적으면 rewind와 재호출이 틀린다. 한 앱의 문제가 부른 쪽의 다른 일을 멈추지 않는다.
- invocation 기록은 지우지 않는다. 끝난 행은 되돌림 표시와 changeset 정리 말고는 바뀌지 않고(trigger), rewind 기록도 불변이다. 성공한 read는 남기지 않고, 실패한 read와 막힌 호출(denied)은 남긴다.
  - 감사와 session rewind 연결(session·turn별 write 목록)이 이 기록에서 나온다.
- rewind는 사람만 하고 시점 단위다. 고른 invocation부터 최신까지 live, 활성 release 안, 아직 되돌리지 않은 write·external을 모두 되돌린다. 누가 한 호출이든 같다.
  - 읽기 의존을 알 수 없어 호출 하나만 빼낼 수 없다. 그 앱을 쓴 모두의 변경이 함께 사라지므로 agent에게 rewind tool을 주지 않는다.
- rewind는 접수를 닫고 도는 호출을 drain한 뒤 적용한다(유예를 넘으면 취소). 어떤 길로 끝나도 접수를 다시 연다. 앱마다 applying rewind는 하나다.
  - changeset은 최신부터 뒤집어 한 transaction으로 적용하고, 충돌하면 통째로 취소한다. 반쯤 되돌아간 DB를 남기지 않는다.
  - 그래서 뒤집은 changeset 전부가 요청 하나로 간다. core는 control frame 한도를 넘을 수 있는 이 본문을 json 요청(`apps.apply`, payload는 `{ app }`) 뒤 같은 channel의 bytes frame과 `end`로 supervisor에 보낸다. 보내다 실패하거나 기한이 지나면 `abort`를 보내고 `unavailable`로 끝낸다. write 하나씩 나눠 보내면 중간 실패 때 일부만 되돌아간다.
- 결과 모름으로 닫혀 changeset이 없는 write가 범위에 있으면 rewind를 막는다. 얼마나 바뀌었는지 모르기 때문이다. 크기 한도로 changeset을 못 붙인 write는 막지 않고 "DB를 되돌리지 못함"으로 표시한다.
  - 앱 호출 입력과 응답은 supervisor control frame 하나씩으로 오간다. 응답이 frame 한도(`CALL_RESPONSE_MAX_BYTES`, 256KiB에서 envelope 여유를 뺀 값)를 넘으면 앱 process가 changeset만 빼고 `changeset_dropped: "too_large"`를 싣는다. 호출은 결과 모름이 아니라 성공·실패로 닫히고 요약에 `changeset_dropped`가 남는다. 빼지 않으면 frame에서 거절되어 결과 모름이 되고 rewind가 통째로 막힌다.
  - 결과 상한(`RESULT_MAX_BYTES`)은 그 frame 한도에서 결과 밖 칸 몫을 뺀 값이라, 상한 안의 결과는 changeset을 빼면 늘 frame에 든다. 입력 상한(`CALL_BODY_MAX_BYTES`)도 frame 한도 아래이고, 넘는 입력은 core가 보내기 전에 `invalid_input`으로 거절한다. 큰 값은 blob이나 file로 넘긴다.
- release를 넘는 rewind는 없다. activation이 끝나면 이전 release의 changeset을 지운다(invocation 기록은 남는다). 이전 release로 돌아가는 것은 activation의 일이다.
- preview는 따로 띄운 process와 일회용 DB로 돈다. invocation을 남기지 않고(응답의 `invocation`은 null) rewind 대상이 아니다. 운영 앱의 drain과 정지에도 걸리지 않는다.
  - preview 호출은 그 preview bundle의 선언으로 tool과 effect를 판정한다. 아직 release에 없는 새 앱과 새 tool도 부를 수 있다. ledger의 `release`는 비울 수 없어 release 없는 bundle의 호출은 기록할 자리도 없다.
  - preview를 부르는 쪽은 사람과 그 앱 place의 session(`preview.call`)이다. agent caller는 그 앱 place의 session일 때만 preview target을 부르고, 다른 place의 session은 `forbidden`이다(`verifyCaller`, `packages/core/apps/calls/caller.ts`). 앱 place의 session이 지은 release를 운영 data 없이 확인하는 길이다. agent의 live 호출 규칙(활성 release, `release` 없음)은 그대로다.
- 앱 호출 사슬은 같은 앱이 다시 나오면(call_loop) 또는 깊이 한도를 넘으면 handler에 가기 전에 막는다. 앱끼리 서로 부르다 줄이 영영 풀리지 않는 것을 막는다.
- 앱 log는 앱마다 `<data root>/apps/<app>/logs/app.log`와 돌린 앞 file `app.log.1` 둘이다(`appLogFile`, `packages/protocol/apps/app-storage.ts`). file 하나는 8 MiB까지이고 앱마다 합쳐 16 MiB다. 줄을 더해 8 MiB를 넘게 되면 `app.log`를 `app.log.1`로 옮기고(앞 `.1`은 버린다) 새 `app.log`에 쓴다. 모양은 `packages/protocol/apps/app-log.ts`가 정한다.
  - JSON Lines이고 줄마다 `{ at, invocation, text }`다. `invocation`은 아는 줄에만 있고 아니면 null이다. 앱 안에서 SDK가 invocation 문맥으로 찍는 줄(`reportProblem`, 잡히지 않은 예외)만 invocation을 싣고, 그 밖의 stdout·stderr 줄은 null이라 시각으로 찾는다.
  - 쓰는 쪽은 app supervisor 하나다. 앱 process에 log를 쓰게 하지 않고 supervisor가 `<data root>/apps`에 쓴다.
  - 줄의 출처는 다섯이고 `text`의 꼴이 다르다. 앱의 stdout·stderr 한 줄은 그대로(머리 `[inv=<id>] `만 떼어 `invocation`으로), SDK `reportProblem(name, message?, details?)`은 `error <name>[: <message>][ <details JSON>]`, 잡히지 않은 예외는 `exception <name>: <message>` 한 줄에 이어 봉인된 bundle의 source map으로 원래 source 줄로 푼 frame마다 `  at <path>:<line>:<column>`, 화면 오류는 `view_error <observation> <name>: <message>`, 앱 process의 비정상 종료는 `process_exit <근거>: <message>`다(근거는 `unexpected_exit`, `v8_oom`, `start_failed`, `ready_timeout`, `crash_loop`). 의도한 정지는 쓰지 않는다. preview 자식(release 준비의 handler 검사 포함)의 출력과 오류는 쓰지 않는다. 화면 오류도 live 화면의 것만 쓴다.
  - 줄마다 redaction을 하고 그 뒤에 300자로 자른다. 순서가 바뀌면 자른 줄에 secret 일부가 남는다. supervisor의 redaction은 credential pattern과, core에서 받아 앱에 건넨 secret 값(`apps.secret_value`)을 지운다. log가 disk에 남으므로 바깥 응답에 되돌아온 secret을 앱이 찍어도 file에 남지 않게 하려는 것이다.
  - 읽기는 core route `apps/logs`(`app.logs`)다. core가 두 file을 바로 읽어 `invocation`, `since`(포함), `until`(제외)로 거르고 가장 최근 `limit`줄(기본 200, 최대 1000)을 오래된 것부터 준다. supervisor를 거치지 않으므로 앱이 멈췄거나 crash loop여도 읽힌다. 읽을 때 알려진 secret 값으로 한 번 더 지우고, 안전하게 만들지 못한 줄이 있으면 읽기 전체가 `unavailable`이다.
  - actor는 user, agent, app이다. agent는 tool `app.logs`로 부른다. 앱 상태(`app.status`)와 호출 기록(`app.invocations`)도 같은 식으로 읽어, 앱을 진단하는 쪽은 이 셋을 본다.
- 앱 process는 권한을 막지 않는다(사람이 정했다). SDK 셋(`@lophn/cap-net`, `@lophn/cap-secret`, `@lophn/cap-fs`)으로 나가는 일은 선언에 적고, net과 secret은 broker가 요청마다 선언 사실 ∩ 사람의 grant를 본다. fs는 선언이 무엇에 닿는지 보이는 값일 뿐 막지 않는다.
  - net: SDK의 요청은 앱 supervisor의 broker(`net/fetch`)가 보낸다. broker가 요청마다 목적지(host·port)를 선언 사실 ∩ grant로 검사한다. 앱 process의 network는 막지 않으므로 이 검사는 이 client를 지나는 요청에만 걸린다. redirect는 한 단계마다 같은 검사를 다시 받고, 플랫폼 port는 grant가 있어도 막는다. 이 검사가 틀리면 supervisor가 아무 곳이나 간다.
  - loopback 목적지는 http, 그 밖은 https다. 사람이 켠 같은 컴퓨터의 서비스를 부르려는 것이고 기계 밖으로 나가지 않는다. https에서 http로 내려가는 redirect는 거절한다.
  - 앱은 요청에 본문(글 또는 bytes, 풀어 쓴 크기 10 MiB까지)과 header(32개까지)를 싣는다. `Authorization`·`Cookie`·`Host`·`Content-Length`·`Proxy-Authorization`은 schema(`brokerNetFetchInputSchema`)가 거절하고 `GET`·`HEAD`에는 본문이 없다. 인증은 앱이 아니라 secret 길이 붙인다. redirect가 301·302(GET·HEAD 아님)·303이면 `GET`으로 바꾸고 본문과 `content-type`을 버리며, 307·308은 method와 본문을 그대로 다시 보낸다. 앱 header는 처음 목적지와 같은 origin의 hop에만 실린다. 응답은 지금처럼 1 MiB 이하의 글·JSON이다.
  - secret: 앱의 `useSecret`은 이름과 목적지를 말할 뿐 값을 읽지 못한다. broker가 secret 이름 선언 사실 ∩ grant와 그 목적지의 `net.fetch` 허락을 검사하면, supervisor가 core route `apps.secret_value`로 값을 한 번 받는다. 이 route는 supervisor의 machine 자격만 부르고, 부른 supervisor가 지금 보는 live 자식과 맞을 때, core가 현재 선언 사실 ∩ active grant로 다시 판정해 통과할 때, 알려진 값 registry가 그 값을 알 때만 값을 준다. 모르는 값은 redaction이 지우지 못해서다.
  - supervisor는 받은 값을 같은 invocation의 같은 (host, port) 요청에만 `Authorization: Bearer`로 붙이고, 60초가 지나면 버린다. redirect로 목적지가 바뀌면 값을 다시 찾아 붙지 않는다. 앱의 응답과 오류에 값이 없고, 앱이 찍어도 log의 redaction이 지운다. Bearer 말고 다른 방식의 인증은 쓰는 앱이 생길 때 더한다.
  - OAuth secret: 선언의 `secret.use`에 `oauth`(authorize·token 끝점, scope, 추가 authorize parameter)가 있으면 그 이름의 값은 사람이 sign-in해 받은 access token이다. 사람이 앱 Access 탭에서 client id와 client secret(선택)을 넣고 [Sign in]을 누르면 core가 loopback callback을 열고 authorize URL(PKCE)을 만들고 shell이 OS browser로 연다. core가 background에서 callback을 받아 token으로 바꾸고 화면은 상태(`apps/oauth_state`)를 다시 읽는다. 끝점은 https이거나 loopback http다.
  - OAuth secret의 값은 `apps.secret_value`가 보내기 직전에 core가 refresh한다(남은 시간 5분 이하, 이름마다 한 번에 하나, 발급자 호출 대기열). 발급자가 400·401·`invalid_grant`로 거절하면 access·refresh·meta를 지우고 상태를 `failed`(`refresh_rejected`)로 두며 앱은 `conflict`("oauth sign-in required")를 받는다. 닿지 못하거나 5xx면 지금 token이 만료 전일 때 그 token을 보내고, 만료 뒤면 `unavailable`이다. client id나 선언의 끝점·scope·parameter가 바뀌면 옛 token을 쓰지 않는다(상태 `none`).
  - refresh token, meta, client id·secret은 `app-oauth.<이름>.refresh|.meta|.client_id|.client`에 두고 어느 호출로도 보내지 않는다(`core/secrets/file-attach.ts`). OAuth가 없는 secret의 값도 사람이 같은 탭에서 보호된 입력 창으로 넣는다.
  - 사람은 같은 탭에서 값을 지운다. plain secret의 [Remove value]는 `secrets/delete`이고, OAuth secret의 [Sign out]은 `apps.oauth_sign_out`이 진행 중인 시도를 버리고 access·refresh·meta를 지운다(client id·secret은 남는다). grant [Revoke]는 값을 지우지 않는다. 앱 secret 이름은 전역이라 같은 이름을 선언한 다른 앱도 그 값을 쓴다.
  - fs: `@lophn/cap-fs`는 OS가 허락하는 파일을 어디든 읽고 쓴다. 선언의 `fs.read`·`fs.write`(경로)는 앱이 무엇에 닿는지 보이는 값이고 `checkDeclaration`이 그것을 요구한다. 운영 bundle의 사본은 file 0444·폴더 0555다.
  - broker는 live 자식의 요청만 받는다. 준비 모드와 preview의 자식이 같은 통로를 부르면 거절한다(`liveOnly`). SDK의 stand-in이 그 자리를 채운다.

## 왜 이 모양인가

- **core 경유로 일원화했다.** 이전에는 부르는 쪽이 core가 서명한 연결로 앱 process socket을 직접 부르고 앱이 invocation을 나중에 알렸다. 판정, 기록, 줄 세우기가 흩어지고 신원 증명(proof) 장치가 따로 필요했다. 지금은 경로가 하나다.
- **앱이 되돌림 tool을 선언하게 하는 모델을 버렸다.** 앱마다 맞게 짜야 하고 틀려도 알 수 없다. SQLite session의 changeset은 앱 코드와 무관하게 DB 변경을 호출 단위로 잡는다.
- **뒤집기는 직접 구현했다.** node:sqlite에는 session과 apply는 있고 changeset을 뒤집는 함수(`sqlite3changeset_invert`)가 없다. changeset에는 UPDATE와 DELETE의 원래 값이 들어 있어, SQLite 문서의 changeset format을 읽는 순수 함수로 뒤집는다(base). patchset은 원래 값이 없어 뒤집지 못한다.
- **호출 단위가 아닌 시점 단위로 되돌린다.** write가 무엇을 읽고 썼는지 모르니, 호출 하나만 빼면 뒤 호출의 전제가 깨진다.
- **되돌린 invocation을 지우지 않고 표시한다.** 기록은 감사에 쓰이고, 반쯤 되돌아간 DB는 남기지 않는다. 되돌린 것을 다시 하기(redo)는 없다.
- **program caller를 따로 둔다.** 사람이 연 run의 호출은 사람의 호출이라 Gate를 거치지 않는다. job의 호출은 사람이 없는데 그 사슬을 맡긴 것은 agent가 만든 job이라, 만든 agent의 할당 안이어야 한다. agent caller는 도는 turn과 tool call을 싣고 그것으로 확인하는데 job에는 그것이 없다. 그래서 job과 job run을 싣고 core가 만든 자격과 맞춰 본다. person을 빌려 쓰면 Gate를 건너뛰고, agent를 빌려 쓰면 없는 turn을 만들어야 한다.
- **flow caller를 program에서 가른다.** flow instance의 호출도 사람이 없고 자격의 agent(`workflow.yaml`의 `agent`, 없으면 lophn)가 따로 있어 판정은 program과 같다. 그래도 job이 없으니 본문과 자격이 맞춰 볼 것이 instance다. 같은 kind에 job과 instance를 nullable로 두면 parser 손 사본마다 둘 중 하나만 있는지를 다시 검사해야 한다.
- **agent에게는 앱 tool이 그대로 tool로 보인다**(`<domain>_<tool>`, tool 이름의 `.`은 `_`, 예: `calendar_event_list`). 내장 tool의 `<자원>_<동사>`와 같은 꼴이다. domain 이름은 모든 domain에서 하나이고 `_`가 없어 앱 id 없이 겹치지 않는다. 내장 자원 이름과 `mcp`는 domain 이름으로 쓰지 못하고(`RESERVED_DOMAIN_NAMES`), 한 앱 안에서 이름이 같아지는 두 tool은 선언 검사가 거절한다. hash는 64자를 넘을 때만 붙인다. 앱 tool은 deferral이 켜진 session에서 이름만 알리고 domain 묶음으로 불러온다(`architecture/agent-definition.md`). 앱 할당과 release 선언 사실(tool 이름)의 교집합만 tool 정의가 되고 사람이 뺀 tool은 요청에 아예 없다. 효과(read, write, external)와 `outputSchema`는 tool 정의에 싣지 않고 core가 release의 선언에서 읽어 줄 세우기와 기록에 쓴다. 조사한 harness 모두 정의에 효과를 싣지 않고 호출 때 판정한다. tool 이름은 parse하지 않고 정의 목록이 (앱, tool)을 안다.
- **선언은 MCP tool 모양 하나다.** 화면 bridge(`window.lophnApp.callTool`), SDK(`tool(name, handler)`), agent tool이 모두 같은 이름과 schema를 쓴다. lophn 칸(`effect`, `public`)은 MCP 정의 밖에 두고, 바깥에는 annotation으로만 보인다.
- **session rewind가 앱 data를 저절로 되돌리지 않는다.** 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라지기 때문이다. 사람이 앱을 골랐을 때만, 함께 되돌아갈 목록을 보인 뒤 같은 rewind로 간다(Claude Code의 rewind 메뉴가 코드와 대화를 따로 고르게 하는 것과 같다).
- **바깥 net의 목적지 검사는 broker가 요청마다 한다.** 앱 process의 OS 권한을 막지 않으므로(사람이 정했다) process 권한으로는 목적지를 가둘 수 없다. 그래서 SDK 요청마다 현재 선언 사실 ∩ grant를 읽는 쪽을 골랐다.
- **secret은 값을 앱에 주지 않고 전송 직전에 붙인다.** 앱이 값을 쥐면 응답, 오류, log로 새는 길을 앱 코드마다 막아야 한다. 앱은 쓰겠다는 요청만 내고, 값은 core가 supervisor에게 한 번 주어 붙인다.
- **OAuth access token은 선언한 secret 이름 그대로 둔다.** 그러면 broker의 판정, `apps.secret_value`, supervisor의 Bearer 붙이기가 OAuth를 몰라도 된다. OAuth가 더하는 것은 값을 보내기 직전의 refresh 하나다. 앱이 token을 받아 직접 refresh하면 refresh token이 앱 코드에 닿는다.
- **refresh 거절만 sign-in을 끝낸다.** 앱 OAuth와 MCP OAuth(같은 refresh 코드 `packages/core/lophn-agent/extensions/mcp-auth.ts`의 `refreshToken`), provider 구독 OAuth 모두 400·401·`invalid_grant`만 거절로 본다. 발급자의 일시 오류(5xx, 닿지 못함)에는 만료 전 token을 그대로 쓴다. 사람이 다시 sign-in해야 하는 일을 막으려는 것이다.
- **client는 사람이 그 서비스에 만든 것을 넣는다.** Google 같은 곳은 자동 등록이 없고, lophn이 자기 client를 들고 다니려면 서비스마다 심사를 받아야 한다. OAuth는 표준 authorization code와 PKCE로만 열고 서비스에 맞춘 것은 선언의 추가 parameter(`access_type=offline` 같은 것)뿐이다.
- **앱 log를 앱마다 file로 남기고 쓰는 쪽을 supervisor 하나로 했다.** 앱 안에서 쓰게 하면 앱 code가 log를 지우거나 고칠 수 있다. supervisor는 이미 앱의 stdout·stderr를 쥐고 있고 lophn의 코드라, 앱이 쓴 줄과 lophn이 아는 사실(비정상 종료, 화면 오류)을 같은 file에 같은 redaction으로 쌓는다. 메모리 buffer가 아니라 file인 것은 앱이 죽거나 supervisor가 다시 뜬 뒤에도 원인을 읽어야 해서다.
- **저장하는 problem 모델 대신 log를 primitive로 둔다.** 오류를 상태 machine(열림, 닫힘), 묶음, 보고 표로 올리면 계약과 tool이 앱 쪽 진단보다 무거워진다. lophn은 줄을 남기고 읽게만 하고, 무엇이 문제인지 읽고 판단하는 일은 agent가 한다.
- **예외 stack은 쓸 때 원래 source 줄로 푼다.** 봉인된 bundle 사본은 agent의 file 범위 밖이라 agent가 stack의 bundle 위치를 직접 풀 수 없다. 당시 release의 source map으로 supervisor가 풀어 읽을 수 있는 줄만 남긴다.
