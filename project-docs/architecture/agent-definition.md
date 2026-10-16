# agent-definition

lophn agent 하나는 role(고정), place, 설정 층으로 정의되고, turn마다 model 요청 하나로 조립된다. 이 조립에는 `agents`, `agent-roles`, `agent-tools`, `run-loop`, 지침 파일, skill, `projects`·`apps`가 주는 place 정보가 모두 들어간다. 어려운 점은 두 가지다. 사람이 고친 지침이 며칠씩 열린 session에 닿아야 하고, 그러면서 prompt cache가 깨지지 않아야 한다. 그리고 prompt에 들어오는 글(다른 agent, web, 문서)이 사람의 지시로 읽히면 안 된다.

## 흐름

```
 run-loop: turn 시작 때 한 번 읽어 그 turn의 판을 고정한다
   agents ─────── role(고정) + place + 설정 층 ─▶ resolved agent
   agent-roles ── role 지침(built-in)
   agent-tools ── role 고정 tool + grant가 붙인 tool(app-api, 외부 MCP)
   지침 파일 ──── 전역 · project LOPHN.md · agent 지침
   skill ──────── 내장 · 전역 · project
   place 정보 ─── 같은 place의 agent, context 글, 앱·project 목록 (잘 안 바뀌는 것만)
        │
        ▼  assemble (순수 함수. I/O 없음)
   system  1 제품 고정 규칙 + role 지침   ← cache 경계
           2 deferred tool 이름
           3 지침 층 (전역, LOPHN.md, agent)   ← cache 경계
           4 skill 목록 (이름과 설명)
           5 place 정보                    ← cache 경계
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
- **`AGENTS.md`는 읽지 않는다.** 지침은 `LOPHN.md`뿐이다. 다른 도구의 지침이 섞이면 사람이 무엇이 prompt에 들어가는지 모른다.
- **lophn은 place가 없어 project 지침을 prompt에 넣지 않고 tool로 읽는다.** project를 가리지 못한 채 아무 project의 지침을 싣는 것을 막는다.
- **Router가 넣는 입력은 모두 user role이고 `lophn-` tag로 출처를 밝힌다.** 본문 속 `lophn-` tag는 escape하고 속성 값은 scrub한다. 사람의 steer만 `<lophn-steer>` 모양을 믿는다고 고정 본문에 적는다. 받은 메시지, 알림, tool 결과는 허락도 사람의 지시도 아니다.
- **감싸는 결과는 web 검색과 web 읽기뿐이다.** file, shell, app-api, 외부 MCP 결과는 감싸지 않는다. 앱과 MCP는 사람이 grant로 배정한 순간 믿는다는 철학이고, 실행 때 의심을 더하지 않는다. "안전해 보이니 감싸자"로 되돌리지 않는다.
- **tool 목록은 session을 시작할 때 고정한다.** session 도중 activation이나 grant로 app-api, MCP tool이 더해지거나 빠져도 `tools[]`는 그대로 두고 대화 끝에 notice로 알린다. notice는 program이 쓴 문장만 쓰고 앱이 쓴 글은 넣지 않는다. 앱이 쓴 글이 program 문장으로 prefix에 들어가면 안 된다.
- **role의 tool 목록은 코드가 고정하고, 목록 밖 tool은 정의에도 실행에도 없다.** 사람은 목록을 넓히거나 좁히지 않는다. 넓히는 길은 agent grant 하나다. 읽기 tool은 모든 role에 주고 쓰기 tool만 role로 나눈다.
- **효과(read, write, external)는 model에 보이는 정의에 넣지 않는다.** registry와 Gate만 안다. model이 효과를 보고 Gate를 피해 가려 하지 않게 한다.
- **file tool은 place 폴더 안에 가둔다.** realpath로 판정하고, 새 파일이면 가장 가까운 상위 폴더의 realpath에 이름을 붙여 판정한다. 끊어진 symlink는 따라 쓰면 밖에 쓰게 되므로 거절한다. 읽기·쓰기·shell은 Gate를 거치지 않는다. 대신 `LOPHN.md` 쓰기만 설정 고치기로 묻는다.
- **agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다.** agent가 자기 정의나 지침을 file tool로 고쳐 grant를 우회하지 못한다.
- **shell은 환경 변수 허용 목록만 넘긴다.** lophn token과 secret은 이름으로 막는 것이 아니라 목록에 없어서 나갈 수 없다. 앱 data는 app-api로만 다루고 앱 DB는 직접 열지 않는다(고정 본문).
- **Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다.** grant는 사람이 할당한다. agent가 자기 권한을 넓히는 길이 없어야 한다.
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
- **`document.*`를 file tool로 대신한다.** 문서는 디스크의 파일이다. pdf와 이미지만 model에 보이는 모양이 달라 따로 읽는다.
- **role 고정 목록과 grant가 옛 preset과 tool 묶음을 대신한다.** 사람이 tool 목록을 고치는 길을 없애고, 권한을 바꾸는 길을 grant 하나로 모았다.
- **place 정보는 목록만 prompt에, 내용은 tool로.** 목록이 없으면 model은 그것이 있는 줄 몰라 찾지 않는다(skill 목록과 같은 이유).
- **고정 규칙은 영어 고정 본문 하나.** tag의 뜻과 "지시가 아니다"를 입력마다 반복하지 않고 prefix에 한 번 둔다. 입력에는 값만 싣는다.
