# triage: approvals-config

옛 파일: platform/approvals, platform/settings. 줄 머리 표시가 `approvals R1`, `settings R7`처럼 파일 이름과 번호다.

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| approvals R1a | candidate | approvals | 허락을 구하는 request는 결정 전에 요청자, 관련 agent role·tool·MCP 서버 이름, 정확한 대상과 가린 입력 미리보기, 이유, 변경 범위, 외부 전송 내용과 수신처, 되돌릴 수 있는 범위를 제시한다. | 외부 MCP tool 호출과 앱 command를 각각 요청하면 request에서 위 항목을 모두 읽을 수 있다; 입력에 secret이 들어 있어도 미리보기에는 원문이 나오지 않는다. | |
| approvals R1b | candidate | approvals | 필수 설명(이유, 변경 범위)이 없거나 공백뿐이면 request를 만들지 않는다. | 이유를 비우거나 공백만 넣어 요청하면 거절되고 대기 request가 생기지 않는다; 변경 설명을 비워도 같다. | |
| approvals R2 | candidate | approvals | 수리 동작의 request는 바뀌는 범위와 함께 보존되는 data와 실제 검증 기준을 제시한다. | 수리 release를 허락 대기로 올리면 결정 전에 보존 data 목록과 검증 근거를 읽을 수 있다. | 수리 동작이 새 설계에 남는지는 problems 쪽 분류를 따른다. |
| approvals R3 | candidate | approvals | 허락과 거절은 사람이 직접 내린 결정만 인정하고, 요청한 앱·coding agent·lophn agent·MCP 서버는 자기 request를 허락하지 못한다. | 각 요청 주체의 자격으로 허락이나 거절을 보내면 거절되고 request는 대기로 남는다; 사람의 결정을 통해서만 상태가 바뀐다. | |
| approvals R4 | candidate | approvals | request에는 기본 선택이 없고, 침묵·결정 화면 닫기·notification 읽음·대화 안 일반 긍정은 허락이나 거절로 해석되지 않는다. | 결정 없이 화면을 닫거나 notification을 읽거나 대화에서 긍정하는 말을 해도 request가 결정 대기로 남는다. | |
| approvals R5 | candidate | approvals | 허락은 사람이 본 호출 주체·동작·정확한 대상·전체 입력·비교 기준과 필요한 agent 정의·tool·MCP 연결에만 묶이고, 그중 하나가 바뀌면 새 request가 필요하다. | 대상의 현재 release, 입력 값 하나, MCP 연결, agent 정의를 각각 바꾸면 이전 허락으로는 시작되지 않고 새 request가 생긴다; 허락된 범위를 넓히는 요청에도 새 request가 필요하다. | |
| approvals R6 | candidate | approvals | request의 요청자·동작·영향·설명·기한은 생성 뒤 바뀌지 않고, 끝난 결정은 고치거나 다시 열 수 없다. | 결정 전후에 내용을 고치려 하면 거절된다; 끝난 request에 늦은 결정을 보내면 거절된다; 바뀐 제안은 새 request가 된다. | |
| approvals R7 | candidate | approvals | 허락 하나는 실제 적용과 함께 한 번만 쓰인다. | 같은 허락을 동시에 두 번 보내거나 다시 보내면 적용이 한 번만 일어난다; 실패나 결과 미확인 뒤 다시 불러도 새 동작이 시작되지 않는다. | |
| approvals R8a | candidate | approvals | 사람이 확인해야 하는 앱 command의 request는 실제로 부른 주체(agent나 다른 앱)를 요청자로 남기고 사람의 결정과 구별해 기록한다. | agent나 다른 앱이 부른 command를 사람이 허락해도 request의 요청자가 원래 호출 주체로 남는다. | |
| approvals R8b | drop-dup | | | | 정확한 앱·release·command·입력에 묶임은 approvals R5가 덮는다. |
| approvals R8c | defer-other | app-runtime | 같은 command 요청을 다시 보내면 새 접수를 만들지 않고 같은 접수를 돌려준다. | | 접수는 앱 호출 쪽 몫이다. |
| approvals R9 | candidate | approvals | 허락의 접수와 실제 적용의 성공은 구별해 보이고, 허락이 저장됐다는 이유만으로 동작이 끝난 것으로 표시하지 않는다. | 허락한 뒤 적용 쪽을 실패시키면 결정은 허락으로 남고 결과는 적용 실패로 보인다. | |
| approvals R10 | drop-dup | | | | 허락 범위 확대에는 새 request가 필요함은 approvals R5가 덮는다(R5 확인에 넣음). |
| approvals R11 | candidate | approvals | 허락을 받은 뒤에도 적용 직전에 현재 권한·대상·비교 기준·원래 일의 유효성을 다시 검사하고, 맞지 않으면 시작하지 않는다. | 허락 뒤에 대상을 보관하거나 권한을 회수하거나 release를 바꾸면 적용이 거절된다. | |
| approvals R12 | candidate | approvals | request에 기본 기한은 없고, 지정한 기한에 닿으면 새 결정과 허락 사용이 모두 거절되며 자동으로 허락되지 않는다. | 기한 직전에는 허락과 사용이 되고 기한 뒤에는 둘 다 거절된다; 이미 내린 허락의 기록은 남는다. | |
| approvals R13a | candidate | approvals | 사람과 원래 요청자는 대기 중인 request를 취소할 수 있다. | 대기 request를 사람이 취소하면 늦은 결정과 사용이 적용되지 않는다; 요청자가 취소해도 같다. | |
| approvals R13b | candidate | approvals | 원래 일이 끝나거나 취소되거나 전제가 바뀌면 그 일의 대기 request를 취소하고, 끝난 run의 허락으로는 새 동작을 적용하지 않는다. | run을 끝낸 뒤 늦게 허락해도 동작이 시작되지 않고 request는 취소된 상태다. | |
| approvals R14 | candidate | approvals | 사람은 이유 없이 거절할 수 있고, 적은 거절 이유는 요청한 쪽에 secret을 가린 채 내용 그대로 전해지며 다른 대기 request는 바뀌지 않는다. | 이유 없이 거절한 경우와 이유를 적어 거절한 경우를 각각 만들면 요청한 쪽이 둘을 구별해 받고 이유에 든 내용이 전달된다; 다른 request는 그대로 대기다. | |
| approvals R15a | candidate | approvals | 거절·만료·취소는 그 호출을 실행하지 않은 채 끝나고 서로 구별되는 결과로 남는다. | 세 종료를 각각 만들면 호출이 시작되지 않고 결과가 거절, 만료, 취소로 구별된다. | |
| approvals R15b | defer-other | run-loop | 사람의 거절·만료·취소는 tool 실패 횟수에 세지 않고, 원래 run은 허용된 새 판단으로 이어진다. | | run의 실패 처리 몫이다. |
| approvals R16 | defer-other | agent-tools | 사람이 거절한 같은 동작·대상·입력은 같은 run과 그 요청에서 이어진 run에서 다시 묻지 않는다. 새로운 사람 요청은 막지 않는다. | | 허락 판정은 agent tool 몫이다. 이어진 run이라는 개념이 새 설계에 남는지 확인이 필요하다. |
| approvals R17 | defer-other | shell | 결정 화면은 동작·대상·이유·변경·외부 전송·보존 data·되돌릴 수 없는 영향을 요약해 보이고, 정확한 입력과 호출 출처는 상세에서 확인하게 한다. | | 화면 보장이다. |
| approvals R18 | ask | | | | 항상 허락(Always allow)은 사람 말 없이 lead 추천대로 두지 않는 쪽으로 간 것(removed.md 3장). 결정 카드의 선택이 "한 번 허락, session 허락, 거절"로 정해진 것인지, 오래 가는 허락을 어디서 정하는지 사람이 정해야 한다. 사람 결정이 나면 approvals R19, R20a도 같이 본다. |
| approvals R19a | candidate | approvals | session 허락을 고르면 그 request는 한 번 허락되고, 같은 session 안에서 같은 tool(MCP 서버 포함)의 같은 동작은 이어서 묻지 않는다. | session 허락 뒤 같은 session의 같은 tool·동작은 새 request 없이 시작되고, 다른 tool이나 다른 동작은 새 request가 생긴다; 그 request 자체는 한 번만 쓰인다. | approvals R18의 결정에 따라 선택지 구성이 바뀔 수 있다. |
| approvals R19b | candidate | approvals | session 허락은 그 session이 닫히거나 archive되거나 지워지면 사라지고, 다시 열어도 되살아나지 않으며 다른 session·run으로 넘어가지 않는다. | session을 닫고 다시 열거나 archive한 뒤 같은 동작을 시키면 다시 묻는다; 다른 session에서도 묻는다. | |
| approvals R20a | candidate | approvals | session 허락은 agent tool call의 확인 request에만 적용되고, 앱 command 확인이나 release 적용처럼 정확한 대상 하나를 보고 결정하는 request는 매번 사람에게 묻는다. | session 허락을 준 뒤에도 앱 command 확인이나 release 적용 request는 매번 새로 생긴다. | |
| approvals R20b | drop-dup | | | | session 허락 아래서도 적용 직전 재검사는 approvals R11이 덮는다. |
| approvals R20c | defer-other | agent-tools | session 허락이 있어도 사람이 거절한 같은 동작은 다시 묻지 않고 시작하지 않는다. | | approvals R16의 거절 재질문 판정과 같은 몫이다. |
| settings R1a | candidate | config | 일반 설정은 각 요소가 공개한 항목만 받고, 공개 목록 밖의 항목은 거절한다. | 공개하지 않은 항목을 설정하려 하면 거절되고 적용값이 바뀌지 않는다. | |
| settings R1b | candidate | config | 공개한 항목마다 값의 종류, 기본값 또는 필수 선택 여부, 허용값이나 숫자 범위와 단위, 설정할 수 있는 층, 효력이 나는 시점을 조회할 수 있다. | 숫자 항목을 조회하면 단위·경계값·효력 시점이 나온다. | |
| settings R1c | drop-detail | | | | 개발 도구의 설정을 일반 설정에서 빼는 문장이고, 개발 도구는 이번 범위 밖이다. |
| settings R2 | candidate | config | 사람이 명시한 선택만 저장하고, 내장 기본값과 병합한 적용값은 사람의 선택으로 다시 저장하지 않는다. | 한 항목만 선택한 뒤 내장 기본값을 바꾸면 선택하지 않은 항목만 새 기본값을 쓴다. | |
| settings R3 | drop-removed | | | | TOML 설정 교환 문서의 import·export 쌍. export 전부(removed.md 1). import만 남기는 보장은 따로 쓰지 않았다. |
| settings R4a | candidate | config | 필수 선택이 비어 있으면 임의의 provider·model·credential로 채우지 않고 해당 기능을 시작하지 않는다. | 필수 선택을 삭제하면 그 기능이 시작되지 않고 다른 값으로 채워지지 않는다. | |
| settings R4b | drop-detail | | | | 다른 요소의 기본값과 일치하는지 대조하는 문장이다. 각 요소의 요구가 맡는다. |
| settings R5 | ask | | | | 새 설계에서 agent 설정(skill, MCP, 지침, model)은 전역·project·Operator 층에서 정한다(removed.md 4장, req-0038). 옛 요구는 일반 설정을 "내장 기본값과 전역 선택" 두 층으로 한정하고 자리별 agent 설정은 다른 원본에 두라고 했다. 층이 있는 설정 장치(config)가 전역·project·Operator 세 층을 직접 들고 있는지, config는 일반 설정 두 층만 맡고 agent 층은 agents가 원본인지 사람이 정해야 한다. |
| settings R6 | candidate | config | 정해진 층 밖의 출처(환경 변수, CLI 일회 인자, session 안의 말, 외부 서버 응답)는 설정을 덮어쓰지 못한다. | 각 출처에 같은 항목을 넣어도 적용값과 revision이 바뀌지 않는다. | |
| settings R7a | drop-dup | | | | 전역에서 정한 agent 기본값을 자리와 agent가 바꾸지 않은 칸이 따름은 req-0038이 덮는다. |
| settings R7b | defer-other | run-loop | 설정의 기본값을 바꿔도 이미 시작한 run은 바뀌지 않고 다음 run부터 새 값을 쓴다. | | run 시작 때 설정을 고정하는 몫이다. settings R24a와 같다. |
| settings R7c | ask | | | | 옛 요구는 전역 층에 role 네 개 각각의 model과 option, 요약용 model 한 칸, 순서 있는 즐겨찾기 model 목록, 기본 권한, provider·model catalog 보완을 두었다. 새 설계는 model을 agent 설정에서 정하고(req-0039) Context Engineer는 전체에 하나다. role별 기본 model, 요약용 model, 즐겨찾기 목록, 기본 권한(항상 허락과 이어짐)을 새 설계에 남길지 사람이 정해야 한다. |
| settings R8 | candidate | config | 층을 합칠 때 object는 항목별로 합치고, 문자열·숫자·참거짓은 높은 층의 값으로 바뀌고, 목록은 높은 층의 전체 목록으로 바뀐다. | 낮은 층의 두 원소 목록에 높은 층의 한 원소 목록을 적용하면 한 원소만 남고, object에서 생략한 항목만 낮은 층 값을 따른다. | |
| settings R9 | candidate | config | 항목을 생략하거나 선택을 삭제하면 낮은 층을 따르고, nullable 항목의 명시 null·빈 목록·false는 서로 다른 선택이다. | null로 저장한 경우와 선택을 삭제한 경우의 적용값이 다르게 나온다; null을 허용하지 않는 항목에 null을 넣으면 거절된다. | |
| settings R10 | candidate | config | 항목마다 적용값, 그 값을 정한 층, 다른 층의 명시 선택, 적용 revision을 조회할 수 있다. | 같은 항목을 여러 층에서 정하고 조회하면 적용값과 가려진 선택이 함께 나온다. | |
| settings R11 | candidate | config | 검증은 각 층의 문법·알려진 항목·타입·숫자 범위·허용 층을 먼저 보고, 병합한 뒤에 필수값·항목 관계·대상 참조를 본다. | 두 단계의 오류를 따로 만들면 각각 알맞은 항목과 단계에서 거절된다. | |
| settings R12 | candidate | config | 모르는 항목, 틀린 타입, 범위 밖 숫자는 오류로 거절하고 숫자 문자열 변환이나 가까운 이름으로 고치기를 하지 않는다. | 오타 항목과 숫자 문자열을 보내면 전체 적용이 거절되고 아무것도 바뀌지 않는다. | |
| settings R13 | candidate | config | 대상(model, provider 연결 등)의 존재·사용 가능 여부·호환성은 그 대상을 맡은 요소의 검증을 따르고, offline이라 확인하지 못한 것은 그 요소가 허용할 때만 미확인으로 표시해 받는다. | 사용할 수 없는 대상과 offline 대상을 각각 선택하면 맡은 요소의 판정대로 거절되거나 미확인으로 표시된다. | |
| settings R14 | candidate | config | 설정 오류는 틀린 항목·선택 층·기대 타입 또는 허용 범위·고칠 방법을 알리고 secret 값이나 입력 전체를 담지 않는다. | 잘못된 입력을 보내면 고칠 항목을 찾을 수 있고 오류에는 입력 원문과 secret이 없다. | |
| settings R15 | candidate | config | 일반 설정은 API key·password·OAuth token·인증 header·private key 원문을 거절하고, secret이 필요한 항목에는 secrets가 허용한 보호 참조만 받는다. | 키 형태의 값을 원문으로 넣으면 적용이 거절된다; 보호 참조는 받는다. | secrets와 이어진다. |
| settings R16 | candidate | config | 어떤 설정 층도 권한 검사와 안전 금지, 사람의 credential 결정을 해제하지 못한다. | 금지를 풀자는 값을 어느 층에 넣어도 거절되거나 효력이 없다. | |
| settings R17 | candidate | config | 설정 선택은 사람이 명시적으로 적용했을 때만 바뀌고, agent의 제안이나 session 안의 동의 추측은 적용 요청으로 보지 않는다. | agent가 제안만 하거나 session에서 동의하는 말이 나와도 선택과 revision이 바뀌지 않고, 사람이 적용한 뒤에만 바뀐다. | |
| settings R18 | candidate | config | 한 번의 적용은 영향받는 요소의 적용값까지 검증한 뒤 전체 변경을 함께 저장하거나 함께 거절한다. | 여러 항목 중 하나를 틀리게 보내면 어떤 선택도 바뀌지 않는다. | |
| settings R19 | candidate | config | 적용은 편집을 시작한 revision이 현재 revision과 같을 때만 받고, 충돌하면 최신 선택과 충돌 항목을 알린다. | 두 편집 중 하나를 먼저 적용하면 나중 적용이 충돌로 거절되고 최신 선택을 읽을 수 있다. | |
| settings R20a | candidate | config | 성공한 변경은 변경 주체·시각·항목·전후 선택·영향받는 요소·새 revision을 기록한다. | 변경 뒤 기록에서 위 항목을 읽을 수 있다. | |
| settings R20b | candidate | config | 선택과 적용값이 모두 같은 다시 읽기는 새 revision을 만들지 않는다. | 같은 선택을 다시 읽으면 revision이 그대로다. | |
| settings R21 | candidate | config | reload는 저장된 선택과 현재 내장 기본값을 처음부터 병합·검증해 적용값을 교체하고, 화면과 다른 호출자는 같은 적용값을 읽는다. | 내장 기본값을 바꾼 뒤 reload하면 화면과 다른 호출자가 같은 revision과 값을 본다. | |
| settings R22 | candidate | config | 적용이나 reload가 실패하면 마지막 성공값과 revision을 유지하고 실패를 알리며, 일부 항목만 적용하거나 내장 기본값으로 돌아가지 않는다. | 검증 실패와 저장 실패를 각각 만들면 이전 값과 revision이 그대로이고 실패가 알려진다. | |
| settings R23 | candidate | config | 유효한 저장 선택도 마지막 성공값도 없는 첫 시작에는 agent 작업을 시작하지 않고, 설정을 고치는 일과 설정과 무관한 앱 사용·project 파일 읽기는 할 수 있다. | 초기 설정 오류 상태에서 agent는 시작되지 않고 설정 수정 화면과 기존 앱·project 파일은 열린다. | |
| settings R24a | defer-other | run-loop | agent의 model·추론 수준·prompt·tool·run 한도는 run을 시작할 때 정해 그 run에 고정하고, 설정 변경은 다음 run부터 쓴다. | | run 시작 때 설정을 고정하는 몫이다. settings R7b와 같다. skill은 req-0099와 같은 방향. |
| settings R24b | ask | | | | 사람 지침(project 지침 LOPHN.md 등)을 고치면 도는 run에 언제 반영되는지 정해야 한다. 옛 요구는 call마다 다시 읽는다고 했고, 새 설계에서 skill은 도는 run이 시작 때 읽은 것을 끝까지 쓴다(req-0099). 지침은 call마다인지, 다음 run부터인지 정해야 한다. |
| settings R24c | defer-other | agent-tools | 허락을 받은 뒤에도 현재 권한과 안전 제한을 매 호출마다 검사하고, 권한을 회수하면 즉시 호출을 막는다. | | 호출 판정은 agent tool 몫이다. |
| settings R25a | candidate | config | 적용 결과는 새 revision, 즉시 효력이 난 항목, 다음 run부터 효력이 나는 항목을 구별해 알린다. | 한 항목만 바꾸면 그 항목의 적용 시점이 결과에 나온다. | |
| settings R25b | candidate | config | 적용할 때 바뀌지 않은 provider 연결과 앱을 다시 잇지 않고 lophn 전체를 다시 띄우지 않는다. | 한 항목만 바꿔 적용해도 바뀌지 않은 연결과 앱이 끊기지 않고 이어진다. | |
| settings R26 | drop-removed | | | | 설정 교환 문서의 import·export(format version 1). export 전부(removed.md 1). |
| settings R27 | candidate | config | 공개한 설정마다 사람이 읽을 이름, 한 줄 설명, 현재 선택과 기본값의 뜻, 영향받는 기능, 위험, 되돌리는 방법, 효력 시점을 함께 제공하고, 설명이 없는 항목은 공개하지 않는다. | 숫자·목록·model 선택 설정에서 설명과 실제 적용 결과가 맞는다; 설명이 빠진 항목은 공개 목록에 오르지 않는다; secret 값 없이 뜻을 읽을 수 있다. | |
| settings R28 | candidate | config | 설정 화면과 agent는 같은 공개 목록에서 이름·영향·시점·현재값을 읽고, 공개하지 않은 항목은 선택지로 나오지 않는다. | 같은 항목을 설정 화면과 agent에서 읽으면 이름·영향·시점·현재값이 같다. | |
| settings R29 | drop-dup | | | | agent의 제안이나 자유 답은 설정을 바꾸지 않고 사람이 적용해야 바뀜은 settings R17이 덮고, 비교 revision 충돌은 settings R19가 덮는다. 질문 칸 방식은 지운 것(removed.md 1). |
| settings R30 | defer-other | shell | 설정 화면은 기본으로 항목의 뜻·현재값·영향·다음 행동을 보이고, 선택 층·revision은 필요할 때 펼쳐 보게 한다. | | 화면 보장이다. |
| settings R31 | defer-other | coding-agent | coding agent의 실행 파일 경로·감지 결과·session 관측은 이 컴퓨터에서 확인한 사실로 따로 두고, 사람의 설정 선택으로 저장하지 않는다. | | 설정 항목의 뜻은 coding agent 몫이다. |

## 개수

| 판정 | 줄 수 |
|---|---|
| candidate | 45 |
| drop-removed | 2 |
| drop-conflict | 0 |
| drop-dup | 5 |
| drop-detail | 2 |
| defer-other | 10 |
| ask | 4 |
| 합계 | 68 |
