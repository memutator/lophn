# app-call

앱은 blueprint `tools[]`에 MCP tool 모양으로 tool을 선언하고, 그 tool을 부르는 길은 넷이다: 사람이 연 앱 화면, agent의 tool, 다른 앱, coding agent의 MCP(preview만). 어느 길이든 같은 판정(부른 쪽 확인, Gate)과 같은 기록(invocation)과 같은 직렬화(write는 앱마다 하나씩)를 거쳐야 한다. 그래야 "이 호출이 앱 data에 한 일"을 호출 단위로 알고, 사람이 고른 시점으로 앱 data를 되돌릴 수 있다(rewind). 그래서 모든 호출은 core를 지나고, write 동안의 앱 DB 변경은 changeset으로 떠서 invocation에 붙여 보관한다.

## 흐름

```
 person ── shell 앱 화면 ─────┐
 agent  ── run-loop tool ─────┼─ core-api(app.call_tool) ─▶ 호출 경로 (core/apps/calls)
 app    ── sdk ─ broker ──────┤              1 부른 쪽 확인        (credential, 도는 turn·부모 invocation)
 coding agent ── MCP /mcp ────┘                preview만(previewOnly): preview bundle 선언으로 판정하고 기록·Gate·줄 없이 보낸다
                                             2 Gate(approvals)      agent·앱만. 사람 화면은 거치지 않는다
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

- tool 선언은 MCP tool 정의(`name`, `title`, `description`, `inputSchema`, 선택 `outputSchema`)에 lophn 칸 셋을 더한 것이다. `effect`(`read`, `write`, `external`)는 program이 강제하고(Gate, write 줄, runtime 권한), `public`은 다른 domain에 보이는지, `domain`은 그 tool이 다루는 객체의 domain(그 앱의 domain 이름)이다. `domain`은 필수이고 앱의 active domain 이름이 아니면 release 준비, `blueprint.check`, activation 직전 재검사가 거절한다(`architecture/domain.md`). 이름은 1~64자 `[A-Za-z0-9_.-]`이고 schema의 root는 `object`다(인자가 없으면 `inputSchema: null`).
  - MCP annotation(`readOnlyHint`, `destructiveHint`, `openWorldHint`)은 effect에서 만들어(`toMcpTool`) 바깥에 보일 때만 싣는다. 힌트일 뿐이고 강제하지 않는다.
- 모든 tool 호출은 core를 지난다. 화면에서 앱으로, 앱에서 앱으로 가는 직통 통로를 두지 않는다.
  - Gate, 기록, write 줄이 core 한 곳에 있어야 changeset이 빠지지 않는다.
- 부른 쪽은 호출 본문이 주장하는 대로 믿지 않고 core가 확인한다. credential의 종류와 caller 종류가 맞아야 하고, agent는 지금 도는 turn의 tool call이어야 하고, 앱은 활성 release이면서 부모 invocation이 지금 도는 호출이어야 한다.
  - 끝난 turn이나 꺼진 판의 호출이 실수로 섞이면 Gate와 기록이 틀린다. agent와 앱은 늘 live 활성 release만 부른다.
- tool 호출은 domain을 싣지 않고 invocation에도 domain이 없다. 어느 domain이 불렀는지는 부른 session의 agent가 맡은 domain으로 안다.
  - 앱 code가 호출자별로 data를 나누는 관례는 core가 지키지 못한다. 그래서 호출에 범위를 싣지 않는다.
- 다른 domain의 agent는 앱의 `public` tool만 본다. 맡은 domain의 agent는 그 domain의 모든 tool을 본다. 같은 앱의 다른 domain도 다른 domain이다. 어느 domain을 맡았는지는 agent의 place와 정의가 정한다(`architecture/domain.md`, `agent-definition.md`).
- Gate의 사람 대기는 write 줄에 서기 전에 끝낸다. 허락은 줄을 얻은 뒤 실행 직전에 consume한다(한 번 쓰는 허락이면 그때 소비).
  - 사람이 답하는 몇 분 동안 앱의 write를 막지 않는다. 그사이 intent가 달라졌거나 허락이 이미 쓰였으면 실행하지 않는다.
- write와 external은 앱마다 한 번에 하나다. core의 줄과 앱 process 안의 mutex, 두 겹이다. read는 동시에 돈다.
  - SQLite session은 연결 단위라 두 write가 겹치면 한 changeset에 두 호출의 변경이 섞여 호출 단위로 되돌릴 수 없다. 줄을 쥔 호출이 돌아오지 않아도 줄이 영영 막히지 않게 abandon이 줄을 비운다.
- changeset은 앱 process(sdk)만 뜨고 적용한다. 앱 DB는 그 앱의 process만 열기 때문이다. core는 보관하고, 뒤집고, 지휘한다.
  - sdk migration으로 만드는 표는 PRIMARY KEY가 필수다. 없으면 SQLite session이 그 표의 변경을 기록하지 않아, 되돌릴 수 없는데 되돌린 것처럼 보인다.
  - read tool이 DB를 바꾸지 않는다는 선언은 믿고 검사하지 않는다. 틀린 선언이 rewind를 충돌시키면 통째로 취소되고 이유가 남는다.
- 보냈는데 응답을 못 받은 호출은 실패가 아니라 결과 모름(unknown)이다. 추정하지 않고 같은 일을 다시 부르지 않는다. 보내기 전에 막힌 것(앱이 멈춤, 연결 없음)은 unavailable로 구분한다. core가 다시 켜질 때 running으로 남은 invocation도 unknown으로 닫는다.
  - 쓰기가 일어났는지 모르는 채 성공이나 실패로 적으면 rewind와 재호출이 틀린다. 한 앱의 문제가 부른 쪽의 다른 일을 멈추지 않는다.
- invocation 기록은 지우지 않는다. 끝난 행은 되돌림 표시와 changeset 정리 말고는 바뀌지 않고(trigger), rewind 기록도 불변이다. 성공한 read는 남기지 않고, 실패한 read와 Gate 등에 막힌 호출(denied)은 남긴다.
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
- coding agent는 core의 MCP endpoint(`POST /mcp`, Streamable HTTP `2025-06-18`)로 맡은 앱의 tool을 부른다. 자격은 그 앱 하나 범위의 coding token이고(operation `coding.mcp`), MCP tools/list는 그 앱의 tool만 보인다.
  - MCP tools/call은 그 앱의 지금 도는 preview로만 간다. preview가 없거나 준비 전이면 `unavailable`이고 live 앱은 어떤 경우에도 부르지 않는다. coding agent는 자기 코드를 확인하려고 부른다. AI가 만든 코드와 agent의 실수로 사용자 data를 잃지 않게 한다.
  - 호출 길에는 `person` caller와 `previewOnly` 자격으로 들어간다. `previewOnly`는 어떤 조회보다 먼저 live target을 `forbidden`으로 막는다. 사람 화면의 preview 호출과 같은 취급이라 Gate를 거치지 않고, 새 caller 종류를 만들지 않아 ledger와 rewind가 그대로다.
  - MCP tools/list는 preview가 돌면 그 bundle의 선언, 아니면 활성 release의 선언이다. `listChanged`가 없어 preview를 연 뒤 생긴 tool은 client가 목록을 다시 읽을 때 보인다.
- 앱 호출 사슬은 같은 앱이 다시 나오면(call_loop) 또는 깊이 한도를 넘으면 handler에 가기 전에 막는다. 앱끼리 서로 부르다 줄이 영영 풀리지 않는 것을 막는다.
- 앱 log는 앱마다 `<data root>/apps/<app>/logs/app.log`와 돌린 앞 file `app.log.1` 둘이다(`appLogFile`, `packages/protocol/apps/app-storage.ts`). file 하나는 8 MiB까지이고 앱마다 합쳐 16 MiB다. 줄을 더해 8 MiB를 넘게 되면 `app.log`를 `app.log.1`로 옮기고(앞 `.1`은 버린다) 새 `app.log`에 쓴다. 모양은 `packages/protocol/apps/app-log.ts`가 정한다.
  - JSON Lines이고 줄마다 `{ at, invocation, text }`다. `invocation`은 아는 줄에만 있고 아니면 null이다. 앱 안에서 SDK가 invocation 문맥으로 찍는 줄(`reportProblem`, 잡히지 않은 예외)만 invocation을 싣고, 그 밖의 stdout·stderr 줄은 null이라 시각으로 찾는다.
  - 쓰는 쪽은 app supervisor 하나다. 앱 process는 data root를 fs grant로 열지 못해 log file에 닿지 않는다. 그래서 supervisor의 Deno 쓰기 권한이 `<data root>/apps`를 연다(`appSupervisorSpec`의 `allow_write`).
  - 줄의 출처는 다섯이고 `text`의 꼴이 다르다. 앱의 stdout·stderr 한 줄은 그대로(머리 `[inv=<id>] `만 떼어 `invocation`으로), SDK `reportProblem(name, message?, details?)`은 `error <name>[: <message>][ <details JSON>]`, 잡히지 않은 예외는 `exception <name>: <message>` 한 줄에 이어 봉인된 bundle의 source map으로 원래 source 줄로 푼 frame마다 `  at <path>:<line>:<column>`, 화면 오류는 `view_error <observation> <name>: <message>`, 앱 process의 비정상 종료는 `process_exit <근거>: <message>`다(근거는 `unexpected_exit`, `v8_oom`, `start_failed`, `ready_timeout`, `crash_loop`). 의도한 정지는 쓰지 않는다. preview와 app test 자식의 출력과 오류는 쓰지 않는다. 화면 오류도 live 화면의 것만 쓴다.
  - 줄마다 redaction을 하고 그 뒤에 300자로 자른다. 순서가 바뀌면 자른 줄에 secret 일부가 남는다. supervisor의 redaction은 credential pattern과, core에서 받아 앱에 건넨 secret 값(`apps.secret_value`)을 지운다. log가 disk에 남으므로 바깥 응답에 되돌아온 secret을 앱이 찍어도 file에 남지 않게 하려는 것이다.
  - 읽기는 core route `apps/logs`(`app.logs`)다. core가 두 file을 바로 읽어 `invocation`, `since`(포함), `until`(제외)로 거르고 가장 최근 `limit`줄(기본 200, 최대 1000)을 오래된 것부터 준다. supervisor를 거치지 않으므로 앱이 멈췄거나 crash loop여도 읽힌다. 읽을 때 알려진 secret 값으로 한 번 더 지우고, 안전하게 만들지 못한 줄이 있으면 읽기 전체가 `unavailable`이다.
  - actor는 user, coding_agent, agent, app이다. lophn과 App Engineer는 tool `app.logs`로, coding agent는 CLI `app logs`로 같은 route를 부른다. 앱 상태(`app.status`)와 호출 기록(`app.invocations`)도 같은 식으로 읽어, 앱을 진단하는 쪽은 이 셋을 본다.
- 앱이 바깥으로 나가는 길은 SDK 셋(`@lophn/cap-net`, `@lophn/cap-secret`, `@lophn/cap-fs`)뿐이고, 어느 길이든 선언 ∩ 사람의 grant 안이다. 앱 process의 Deno 권한에는 외부 net이 없다.
  - net: 요청은 앱 supervisor의 broker(`net/fetch`)가 보낸다. supervisor는 lophn의 코드라 host 없는 `--allow-net`으로 뜨고(`net_any`, launch spec은 agent runtime과 apps supervisor만 허락한다), 앱 process가 아니라 broker가 요청마다 목적지(host·port)를 선언 ∩ grant로 검사한다. redirect는 한 단계마다 같은 검사를 다시 받고, 플랫폼 port는 grant가 있어도 막는다. 이 검사가 틀리면 supervisor가 아무 곳이나 간다.
  - loopback 목적지는 http, 그 밖은 https다. 사람이 켠 같은 컴퓨터의 서비스를 부르려는 것이고 기계 밖으로 나가지 않는다. https에서 http로 내려가는 redirect는 거절한다.
  - secret: 앱의 `useSecret`은 이름과 목적지를 말할 뿐 값을 읽지 못한다. broker가 secret 이름 선언 ∩ grant와 그 목적지의 `net.fetch` 허락을 검사하면, supervisor가 core route `apps.secret_value`로 값을 한 번 받는다. 이 route는 supervisor의 machine 자격만 부르고, 부른 supervisor가 지금 보는 live 자식과 맞을 때, core가 현재 선언 ∩ active grant로 다시 판정해 통과할 때, 알려진 값 registry가 그 값을 알 때만 값을 준다. 모르는 값은 redaction이 지우지 못해서다.
  - supervisor는 받은 값을 같은 invocation의 같은 (host, port) 요청에만 `Authorization: Bearer`로 붙이고, 60초가 지나면 버린다. redirect로 목적지가 바뀌면 값을 다시 찾아 붙지 않는다. 앱의 응답과 오류에 값이 없고, 앱이 찍어도 log의 redaction이 지운다. 다른 방식의 인증은 쓰는 앱이 생길 때 더한다.
  - fs: 앱 process의 Deno `--allow-read`·`--allow-write`가 선언 ∩ grant한 경로다. 운영 bundle은 읽기만 되고 source, 다른 앱 DB, 플랫폼 credential, 앱 log file은 어느 grant로도 열리지 않는다.
  - live 자식만 바깥에 닿는다. 준비 모드, preview, app test의 자식이 같은 통로를 부르면 broker가 거절한다(`liveOnly`). SDK의 stand-in이 그 자리를 채운다.

## 왜 이 모양인가

- **core 경유로 일원화했다.** 이전에는 부르는 쪽이 core가 서명한 연결로 앱 process socket을 직접 부르고 앱이 invocation을 나중에 알렸다. Gate, 기록, 줄 세우기가 흩어지고 신원 증명(proof) 장치가 따로 필요했다. 지금은 경로가 하나다.
- **앱이 되돌림 tool을 선언하게 하는 모델을 버렸다.** 앱마다 맞게 짜야 하고 틀려도 알 수 없다. SQLite session의 changeset은 앱 코드와 무관하게 DB 변경을 호출 단위로 잡는다.
- **뒤집기는 직접 구현했다.** node:sqlite에는 session과 apply는 있고 changeset을 뒤집는 함수(`sqlite3changeset_invert`)가 없다. changeset에는 UPDATE와 DELETE의 원래 값이 들어 있어, SQLite 문서의 changeset format을 읽는 순수 함수로 뒤집는다(base). patchset은 원래 값이 없어 뒤집지 못한다.
- **호출 단위가 아닌 시점 단위로 되돌린다.** write가 무엇을 읽고 썼는지 모르니, 호출 하나만 빼면 뒤 호출의 전제가 깨진다.
- **되돌린 invocation을 지우지 않고 표시한다.** 기록은 감사에 쓰이고, 반쯤 되돌아간 DB는 남기지 않는다. 되돌린 것을 다시 하기(redo)는 없다.
- **agent에게는 앱 tool이 그대로 tool로 보인다**(`domain__<domain>__<tool>`). domain 이름은 모든 domain에서 하나라 앱 id 없이 겹치지 않는다. 앱 할당, release 선언, agent grant의 교집합만 tool 정의가 되고 사람이 뺀 tool은 요청에 아예 없다. 효과(read, write, external)와 `outputSchema`는 tool 정의에 싣지 않고 core가 blueprint 선언에서 읽어 Gate에 쓴다. 조사한 harness 모두 정의에 효과를 싣지 않고 호출 때 판정한다. tool 이름은 parse하지 않고 정의 목록이 (앱, tool)을 안다.
- **선언은 MCP tool 모양 하나다.** 화면 bridge(`window.lophnApp.callTool`), SDK(`tool(name, handler)`), agent tool, ticket 예시, coding agent MCP가 모두 같은 이름과 schema를 쓴다. lophn 칸(`effect`, `public`)은 MCP 정의 밖에 두고, 바깥에는 annotation으로만 보인다.
- **session rewind가 앱 data를 저절로 되돌리지 않는다.** 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라지기 때문이다. 사람이 앱을 골랐을 때만, 함께 되돌아갈 목록을 보인 뒤 같은 rewind로 간다(Claude Code의 rewind 메뉴가 코드와 대화를 따로 고르게 하는 것과 같다).
- **바깥 net의 목적지 검사는 OS 권한이 아니라 broker가 요청마다 한다.** supervisor의 `allow_net`을 grant된 host 목록으로 두면 OS 수준 경계가 남지만 grant가 바뀔 때마다 모든 앱이 다시 뜬다. 앱 process에는 net이 없고 supervisor는 lophn의 코드라서, 요청마다 현재 선언 ∩ grant를 읽는 쪽을 골랐다.
- **secret은 값을 앱에 주지 않고 전송 직전에 붙인다.** 앱이 값을 쥐면 응답, 오류, log로 새는 길을 앱 코드마다 막아야 한다. 앱은 쓰겠다는 요청만 내고, 값은 core가 supervisor에게 한 번 주어 붙인다.
- **앱 log를 앱마다 file로 남기고 쓰는 쪽을 supervisor 하나로 했다.** 앱 안에서 쓰게 하면 앱 code가 log를 지우거나 고칠 수 있고, 권한을 열어야 한다. supervisor는 이미 앱의 stdout·stderr를 쥐고 있고 lophn의 코드라, 앱이 쓴 줄과 lophn이 아는 사실(비정상 종료, 화면 오류)을 같은 file에 같은 redaction으로 쌓는다. 메모리 buffer가 아니라 file인 것은 앱이 죽거나 supervisor가 다시 뜬 뒤에도 원인을 읽어야 해서다.
- **저장하는 problem 모델 대신 log를 primitive로 둔다.** 오류를 상태 machine(열림, 닫힘), 묶음, 보고 표로 올리면 계약과 tool이 앱 쪽 진단보다 무거워진다. lophn은 줄을 남기고 읽게만 하고, 무엇이 문제인지 읽고 판단하는 일은 agent가 한다.
- **예외 stack은 쓸 때 원래 source 줄로 푼다.** 봉인된 bundle 사본은 agent의 file 범위 밖이라 agent가 stack의 bundle 위치를 직접 풀 수 없다. 당시 release의 source map으로 supervisor가 풀어 읽을 수 있는 줄만 남긴다.
