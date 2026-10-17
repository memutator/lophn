# agent-definition

lophn agent 하나는 role(고정), place, 설정 층으로 정의되고, turn마다 model 요청 하나로 조립된다. 이 조립에는 `agents`, `agent-roles`(role 층), `agent-tools`, `run-loop`, 지침 파일, skill, `projects`·`apps`가 주는 place 정보가 모두 들어간다. 어려운 점은 두 가지다. 사람이 고친 지침이 며칠씩 열린 session에 닿아야 하고, 그러면서 prompt cache가 깨지지 않아야 한다. 그리고 prompt에 들어오는 글(다른 agent, web, 문서)이 사람의 지시로 읽히면 안 된다.

## 흐름

```
 run-loop: turn 시작 때 한 번 읽어 그 turn의 판을 고정한다
   agents ─────── role(고정) + place + 설정 층 ─▶ resolved agent
   agent-roles ── 제품 고정 규칙 + role 지침(built-in), role별 tool 이름 목록, place 글과 보이는 context,
                  role 표(built-in 이름·기본 profile·정의 file 자리), 설정 층의 project 자리, 내장 skill
   agent-tools ── 조립이 넘긴 tool 정의(범용·domain·role 층) 중 role 목록에 든 것 + grant가 붙인 tool(app-api, 외부 MCP)
   지침 파일 ──── 전역 · project LOPHN.md · agent 지침
   skill ──────── 내장 · 전역 · project
   place 정보 ─── 같은 place의 agent, context 글, 앱·project 목록 (잘 안 바뀌는 것만)
        │
        ▼  assemble (순수 함수. I/O 없음)
   system  1 제품 고정 규칙 + role 지침   ← cache 경계
           2 지침 층 (전역, LOPHN.md, agent)   ← cache 경계
           3 skill 목록 (이름과 설명)
           4 place 정보                    ← cache 경계
   tools[] 정렬된 정의
   대화    Router 입력(tag로 출처 표시) ... 끝에 notice
        ▲
        └─ 지난 turn이 본 판(seen)과 비교해 바뀐 층·목록만 notice로 끝에 덧붙인다.
           첫 turn과 compact 직후는 seen이 없어 notice가 없다(최신 판으로 prefix를 새로 만든다).
```

## 지키는 것

- **도는 turn은 시작 때 읽은 판을 끝까지 쓴다.** 지침, tool, skill, place 정보가 도중에 바뀌어도 prefix는 그대로다. 바뀐 것은 다음 turn 시작에 notice로 대화 끝에 붙는다. prefix를 고치면 이력 전체가 cache miss가 된다.
- **같은 재료는 같은 bytes다.** 정렬하고, 시각·무작위에 기대지 않는다. tag 목록도 코드에서 끼우지 않고 고정 문장으로 둔다. 뭔가 하나라도 흔들리면 cache 경계가 매번 달라진다.
- **사람이 쓴 지침은 조용히 빼지 않는다.** 한 층이라도 못 읽거나 상한을 넘으면 turn을 시작하지 않는다. 빠진 채 일하면 사람이 모른다. 읽은 지침은 redaction을 거치고, 끝나지 않으면 역시 시작하지 않는다.
- **지침 층은 덮지 않고 이어 붙인다.** skill과 MCP server만 같은 이름일 때 마지막 층이 덮는다. 단 끌 수 없는 내장 skill은 사람 skill이 같은 이름으로 덮지 못한다. role이 일하는 데 필요한 skill이 사라지면 lophn 동작이 막힌다.
  - 층의 자리(project 층의 skill 폴더와 `extensions.json`, 앱 place에는 project 층이 없음)와 내장 skill 폴더(`packages/core/agent-roles/skills/`)는 role 층이 정하고 harness는 받아 쓴다. 읽기 허락과 skill 발견이 같은 값을 써야 허락 밖 폴더를 찾다 막히지 않는다.
- **`AGENTS.md`는 읽지 않는다.** 지침은 `LOPHN.md`뿐이다. 다른 도구의 지침이 섞이면 사람이 무엇이 prompt에 들어가는지 모른다.
- **lophn은 place가 없어 project 지침을 prompt에 넣지 않고 tool로 읽는다.** project를 가리지 못한 채 아무 project의 지침을 싣는 것을 막는다.
- **Router가 넣는 입력은 모두 user role이고 `lophn-` tag로 출처를 밝힌다.** 본문 속 `lophn-` tag는 escape하고 속성 값은 scrub한다. 사람의 steer만 `<lophn-steer>` 모양을 믿는다고 고정 본문에 적는다. 받은 메시지, 알림, tool 결과는 허락도 사람의 지시도 아니다.
- **감싸는 결과는 web 검색과 web 읽기뿐이다.** file, shell, app-api, 외부 MCP 결과는 감싸지 않는다. 앱과 MCP는 사람이 grant로 배정한 순간 믿는다는 철학이고, 실행 때 의심을 더하지 않는다. "안전해 보이니 감싸자"로 되돌리지 않는다.
- **tool 목록은 session을 시작할 때 고정한다.** session 도중 activation이나 grant로 app-api, MCP tool이 더해지거나 빠져도 `tools[]`는 그대로 두고 대화 끝에 notice로 알린다. notice는 program이 쓴 고정 문장만 쓰고 앱이 쓴 글(tool 설명)은 넣지 않는다. notice도 다음 turn부터는 이력의 앞부분(prefix)이라, 앱 글이 들어가면 그 글이 바뀔 때마다 같은 재료가 같은 bytes가 아니게 되어 cache가 깨진다.
- **role의 tool 목록은 코드가 고정하고, 목록 밖 tool은 정의에도 실행에도 없다.** 사람은 목록을 넓히거나 좁히지 않는다. 넓히는 길은 agent grant 하나다. 읽기 tool은 모든 role에 주고 쓰기 tool만 role로 나눈다. 목록은 role 층(`agent-roles/tool-lists.ts`)에 있고, 목록의 이름마다 정의가 있고 정의마다 어느 목록에 든다(`main/agent-tools_test.ts`). 어긋나면 agent가 그 tool을 말없이 못 본다.
- **agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다.** core는 route 이름으로 대조하므로 tool 이름(`ticket.create`)을 넣으면 command가 `forbidden`이다. tool 정의는 helper가 부르는 것까지 `routes`에 적고, 상한은 role 목록 tool의 route 합집합에 place 읽기, rewind, Gate 대기 같은 보조 operation을 더한 것이다.
- **"tool 정의가 바뀌었나"는 정의에서 계산한다.** 이름, 설명, 입력 JSON schema, effect의 hash다. 따로 들고 다니는 판 번호를 두지 않는다. 손으로 올리는 번호는 잊히고, 정의가 같으면 release가 바뀌어도 알림이 나가지 않는 것이 맞다.
- **효과(read, write, external)는 model에 보이는 정의에 넣지 않는다.** registry와 Gate만 안다. model이 효과를 보고 Gate를 피해 가려 하지 않게 한다.
- **file tool은 place 폴더 안에 가둔다.** realpath로 판정하고, 새 파일이면 가장 가까운 상위 폴더의 realpath에 이름을 붙여 판정한다. 끊어진 symlink는 따라 쓰면 밖에 쓰게 되므로 거절한다. 읽기·쓰기·shell은 Gate를 거치지 않는다. 대신 `LOPHN.md` 쓰기만 설정 고치기로 묻는다.
- **agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다.** agent가 자기 정의나 지침을 file tool로 고쳐 grant를 우회하지 못한다.
- **shell은 환경 변수 허용 목록만 넘긴다.** lophn token과 secret은 이름으로 막는 것이 아니라 목록에 없어서 나갈 수 없다. 앱 data는 app-api로만 다루고 앱 DB는 직접 열지 않는다(고정 본문).
- **Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다.** grant는 사람이 할당한다. agent가 자기 권한을 넓히는 길이 없어야 한다.
- **tool 결과는 model에 약 24 KiB까지만 싣는다.** shell도 stream마다 앞 12 KiB와 뒤 12 KiB만 남기고 가운데는 생략 표시로 바꾼다. 오류는 끝에 나오므로 뒤를 버리지 않는다. 출력 많은 명령 한 번이 context를 채우지 않게 한다.
- **model 요청에 싣는 이미지는 그 turn의 최신 둘뿐이다.** 오래된 이미지 조각은 빼고 짝 tool 결과 글 끝에 `[image omitted]`를 붙인다. 요청 body 전체를 blob으로 저장하고 그 상한이 16 MiB라, 이미지가 쌓이면 model call을 보내지 못한다. 입력 예산은 이미지를 base64 byte가 아니라 이미지당 고정 token(4096)으로 센다. byte=token 가정은 이미지에 맞지 않아 screenshot 하나로 `context_limit`이 난다.
- **provider credential(API key, 구독 OAuth access token)은 `secrets.json`의 이름 `provider.<id>`로만 가리킨다.** ConnectProvider는 그 provider 몫의 이름만 받는다. 값은 core가 전송 직전에 그 이름을 가진 회수되지 않은 provider의 endpoint origin과 요청 목적지가 같을 때만 읽어 agent runtime의 전송 callback 하나에 준다. 값은 ledger, event, log, 오류, model 입력에 없다. 다른 이름을 가리킬 수 있으면 앱·MCP secret이 provider endpoint로 나간다.
- **secret 저장소는 `secrets.json` 하나이고 이름의 앞머리가 이름 공간이다.** `provider.`는 provider credential(구독 OAuth는 옆에 `provider.<id>.refresh`·`.meta`를 둔다. 둘은 어떤 provider의 secret_name과도 같지 않아 core 밖으로 안 나간다), `mcp.`(보통 `mcp.<global 또는 project id>.<서버>`)는 사람이 넣은 MCP credential, `mcp-oauth.<scope>.<서버>.access`·`.refresh`·`.meta`는 MCP OAuth token이다. 전송 부착(`core/secrets/file-attach.ts`)은 앞머리로 용도를 정하고 그 밖의 이름은 보내지 않는다. 목적지는 이름 공간마다 따로 찾는다(`lophn-agent/secret-destinations.ts`): `mcp.` 값은 그 이름을 header나 bearer·api_key로 보내는 켜진 http 서버(전역과 project 층)의 URL origin으로만, `mcp-oauth.` 접근 token은 그 meta가 묶인 서버 URL origin으로만 간다. 갱신 token과 meta는 core 밖으로 나가지 않는다. MCP 설정 schema는 `mcp.` 이름만 받으므로 설정(사람 실수나 agent가 고친 project 설정)이 provider key나 다른 서버의 token을 가리켜 MCP URL로 보내지 못한다.
- **MCP OAuth의 접근 token과 갱신 token은 각자 이름이다.** 알려진 값 registry가 값 전체로 맞추므로 JSON 하나로 합치면 token 하나를 redaction할 수 없다. 만료가 가까우면 core가 보내기 전에 갱신하고 secret store의 put이 새 값을 먼저 알려진 값으로 올린다. 발급자가 갱신을 거절하면 세 이름을 지우고 사람이 다시 로그인한다.
- **구독 provider 로그인(ChatGPT, SuperGrok)은 token을 core만 만진다.** `providers/login.ts`가 writer queue 앞에서 `BeginProviderLogin`·`CompleteProviderLogin`·`CancelProviderLogin`을 받는다. ChatGPT는 OpenAI 공식 Sign in with ChatGPT(PKCE, 127.0.0.1 loopback `/auth/callback`, 첫 로그인에 `dynamic_agent_client`로 client 등록, id_token의 JWKS 서명·issuer·audience·nonce 검증, granted scope에 `chatgpt.tokens.use.direct`)이고 SuperGrok은 device code다. Complete는 기다리지 않고 한 번 보고 pending이나 연결된 provider를 낸다. 끝나면 core가 token 셋을 저장하고 사람의 context로 ConnectProvider를 부른다. token은 renderer와 ledger·event·log를 지나지 않는다. 발급자 주소와 client 값은 provider 정의 data라서 fake 발급자는 정의만 바꿔 돈다. Claude 구독 로그인은 두지 않는다(Anthropic이 제3자 앱의 Claude.ai 로그인과 구독 credential 사용을 금지한다).
- **구독 OAuth access token은 runtime에 건네기 직전에 갱신한다.** agent runtime이 `provider.<id>`를 달라고 하면 core(`providers/oauth-refresh.ts`, `runtime-secret.ts`의 hook)가 만료까지 5분 미만일 때 provider마다 한 번에 하나만 refresh grant를 보낸다. refresh token은 회전하므로 새 refresh를 먼저 저장하고 access를 저장한 뒤 `RefreshProviderCredential`로 만료를 올린다. 발급자가 grant를 거절하면 credential이 `revoked`가 되고 token을 건네지 않는다. 그 밖의 실패는 지금 token이 살아 있으면 그대로 건넨다. 같은 refresh token을 두 곳에서 쓰면 발급자가 둘 다 폐기한다.
- **OAuth 발급자 호출(MCP와 provider)은 대기열 하나로 runtime이 대신 보낸다.** core module graph에는 외부 fetch가 없다. core가 요청(https이거나 loopback http, GET·POST)을 `lophn-agent/issuer-requests.ts`에 놓고 agent runtime의 `issuer-pump.ts`가 machine 입구(`TakeIssuerRequest`·`FinishIssuerRequest`)로 가져가 보낸 뒤 답한다. 요청과 응답 본문은 작업 메모리에만 있다.
- **stdio MCP 서버의 env는 값만 받는다.** 실행 파일은 대조할 목적지가 아니라서 secret을 넘기지 않는다. 설정 schema가 `{secret}`을 거절한다.
- **model catalog는 동봉 snapshot 위에 models.dev 갱신을 덮는다.** snapshot은 판을 낼 때 `tools/models-snapshot.ts`가 만들고, 실행 때 갱신(24시간에 한 번 공개 GET, 설정 `lophn-agent.model.catalog_auto_update`로 끈다)이 같은 변환을 쓴다. catalog 밖 model은 사람이 한계를 명시하지 않으면 거절한다. 기본값으로 허용하면 실제 한도와 달라 예산이 틀린다.
- **compact는 사람이 부를 때만 한다.** 같은 model이 요약하고, 요약 대상 원문은 data 경계로 감싸 지시로 읽히지 않게 한다. 입력이 예산을 넘으면 call을 보내지 않고 turn이 `context_limit`으로 실패한다. 자동 compact는 없다.
- **skill은 목록(이름과 설명)만 prompt에 넣고 본문은 tool로 읽는다.** 꺼진 skill은 목록에서 빼고 읽기도 막는다. 도는 turn은 시작 때 읽은 판을 쓴다.
- **사람이 composer에 붙인 것(context, 파일, 위반)은 이름과 한 줄만 싣는다.** 상세는 agent가 tool로 읽는다. 사람이 붙인 글 전체가 prompt를 부풀리거나 지시로 읽히지 않게 한다.
- **place 정보에는 잘 안 바뀌는 목록만 넣는다.** 열린 session 목록과 앱 화면 상태는 넣지 않는다. 화면에서 본 것은 annotation이나 메시지로만 들어온다.
- **context 글은 program이 적용된 판에서 결정적으로 조립한다.** 계약 원문(자료 위치, rule, script)은 넣지 않는다. 같은 판이면 같은 글이다.
- **사람에게 묻는 중 사람이 그 session에 메시지를 보내면 기다림을 끝내고 그 메시지를 tool 결과로 넘긴다.** 그것이 답인지는 LLM이 읽는다. harness가 뜻을 가리지 않는다.

## 왜 이 모양인가

- **지침 반영: 대화 끝에 덧붙이기.** 조사한 harness는 세 갈래다. session 시작에 고정(Claude Code, Hermes)은 며칠 열린 lophn session에서 `LOPHN.md` 수정이 안 닿는다. 매 call 다시 조립(Goose)은 편집 한 번이 이력 전체의 cache miss다. 바뀐 것만 대화 끝에 붙이는 Codex와 OpenCode를 따랐다. 옛 설계(매 model call 직전에 다시 읽기)는 Goose 쪽이었고 버렸다.
- **sandbox를 따로 두지 않는다.** 조사한 harness 여덟 가운데 경계를 기본으로 켜는 것은 Codex 하나다. lophn agent는 coding agent보다 직접 하는 일이 적고 place가 범위를 정한다. 대신 경로 가두기와 환경 변수 목록을 둔다.
- **MCP와 app-api 결과를 감싸지 않는다.** 일곱 harness 가운데 다섯이 그대로 넣고, server 신뢰 표시로 결과 처리를 바꾸는 곳은 없다. 감싸는 것은 아무도 배정하지 않은 web 결과뿐이다.
- **tool은 자원 하나에 동사 하나(`<자원>.<동사>`).** 효과, 쓸 수 있는 role, 상태 전이의 전제, 결과 모양 가운데 하나라도 다르면 나눈다. Gate, rewind, role 목록이 모두 tool 단위이기 때문이다. 거르기와 범위만 다르면 인자로 합친다.
- **일의 흐름은 tool로 만들지 않는다.** `app.plan` 같은 흐름 tool을 버리고 지침과 skill이 primitive를 엮게 했다. 예: 문제로 ticket 만들기는 `problem.get`과 근거를 붙인 `ticket.create`다.
- **`document.*`를 file tool로 대신한다.** 문서는 디스크의 파일이다. pdf와 이미지만 model에 보이는 모양이 달라 따로 읽는다. 이미지 결과는 JSON 글이 아니라 `tool_result_image` 조각으로 싣는다. App Engineer는 같은 `image.read`로 annotation screenshot(`annotation:<id>`)도 연다(annotation).
- **role 고정 목록과 grant가 옛 preset과 tool 묶음을 대신한다.** 사람이 tool 목록을 고치는 길을 없애고, 권한을 바꾸는 길을 grant 하나로 모았다.
- **place 정보는 목록만 prompt에, 내용은 tool로.** 목록이 없으면 model은 그것이 있는 줄 몰라 찾지 않는다(skill 목록과 같은 이유).
- **고정 규칙은 영어 고정 본문 하나.** tag의 뜻을 입력마다 반복하지 않고 prefix에 한 번 둔다. 입력에는 값만 싣는다. reaction(`<lophn-reaction>`)은 lophn이 감지한 사실이고 그 값은 lophn과 사람의 앱에서 온다. 사용자 앱을 공격자로 보지 않으므로 "data, not instructions"를 붙이지 않는다.
- **model catalog는 OpenCode 꼴이다.** OpenCode와 Codex는 catalog snapshot을 넣고 실행 때 받는다. 손으로 쓴 목록은 새 model이 나와도 판을 올리기 전에는 쓸 수 없다. models.dev 항목의 `limit.input`이 없으면 context 한도를 입력 한계로 두고, 출력 예약은 입력 예산이 따로 뺀다.
- **오래된 이미지만 빼고 기록은 그대로 둔다.** tool 호출 기록과 그 출력 blob에는 이미지 base64가 남는다. 기록에서 빼는 길은 model call이 막히지 않으니 실제로 막힐 때 한다.
- **deferred tool(이름만 싣고 `tool.search`로 불러오기)은 두지 않는다.** 켜는 tool이 없었다. tool 목록이 커져 실제로 막히면 그때 만든다.
- **active context는 project place만 읽는다.** project place의 PM과 Operator가 그 project의 active context를 받는다. App Engineer가 앱을 app-data source로 읽는 context를 받는 길은 쓰는 곳이 없어 지웠다.
