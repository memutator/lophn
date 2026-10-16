# triage: coding-1 (coding-agent/mcp-server, cli)

옛 파일: `coding-agent/mcp-server.md`, `coding-agent/cli.md`. 다음 묶음과 겹칠 수 있는 줄은 이유 칸에 적었다: coding-2(connection, harnesses, sessions, guides)와 coding-3(tickets, repair-context). ticket·claim에 기대는 보장은 모두 `ask`다(모델이 남는지 정하지 않았다). MCP와 CLI가 같은 보장을 내는 줄은 MCP 쪽 한 줄만 candidate이고 CLI 쪽은 `drop-dup`이다.

## mcp-server

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| mcp-server R1a | candidate | coding-agent-mcp | MCP server는 coding agent session마다 로컬 stdio server 하나로 시작되고, stdout에는 MCP 메시지를 쓰고 stderr에는 진단을 쓴다 | 설치된 실행 파일을 절대 위치와 나뉜 인자로 시작하면 초기화와 tool 발견이 성공한다; 진단 문장은 stderr로만 나가고 stdout에서 MCP 메시지가 깨지지 않는다 | |
| mcp-server R1b | candidate | coding-agent-mcp | MCP server는 공백이 든 설치 위치와 작업 위치에서, 네트워크가 막힌 상태에서도 시작한다 | 공백이 든 경로에 설치하고 그 경로에서 작업하는 session에서 초기화가 성공한다; 네트워크를 막아도 초기화와 tool 발견이 성공한다 | OpenClaw의 session 소유 stdio 확인 여부는 harnesses 몫(coding-2) |
| mcp-server R2 | candidate | coding-agent | MCP와 CLI는 core API 위의 얇은 통로이고, 같은 자격과 입력이면 core API를 직접 부를 때와 같은 결과와 거절을 낸다 | 같은 자격과 입력으로 core API, MCP, CLI를 각각 불러 결과와 거절 이유를 비교하면 같다; 통로가 도메인 기록을 직접 쓰지 않고 core API의 변경 경로를 거친다 | MCP와 CLI에 걸린 보장이라 coding-agent. cli R1의 같은 결과 부분도 덮는다 |
| mcp-server R3a | candidate | coding-agent-mcp-interface | MCP는 앱 개발, SDK, 문제, runtime 기능을 한 묶음(앱 toolset)으로 내보이고 기본으로 켠다 | 옵션이나 환경 설정 없이 MCP에 연결하면 그 묶음의 tool이 발견된다 | ticket 기능은 ask 줄(R26~R28)에서 따로 다룬다 |
| mcp-server R3b | drop-detail | | | | 유사 동작을 한 tool의 동작 선택으로 묶는 것은 schema 설계 선택이다 |
| mcp-server R3c | drop-removed | | | | core toolset과 옛 toolset 이름·별칭: coding agent의 앱 밖 tool(removed.md 1), 옛 이름 호환 장치(AGENTS.md 호환성) |
| mcp-server R3d | drop-dup | | | | req-0206, req-0209: tool이 목록에 보인다는 사실이 권한이 아니라 호출자 자격의 범위로 판정한다 |
| mcp-server R4a | ask | coding-agent-mcp-interface | MCP가 내보내는 전체 tool schema는 정한 token 상한 이내이다 | 새 tool 목록의 schema를 재면 상한 이내이다 | 옛 문서가 "2,000 token 이내를 목표로 재측정"이라 쓰고 옛 측정값은 보장값이 아니라고 했다. 상한 숫자를 요구로 둘지, 새 목록을 잰 뒤 정할지 사람이 정해야 한다 |
| mcp-server R4b | candidate | coding-agent-mcp-interface | 읽기 전용 표시는 내보낸 모든 동작이 읽기인 tool에만 붙는다 | 읽기와 변경 동작을 함께 가진 tool에는 읽기 전용 표시가 붙지 않는다; 읽기 동작만 가진 tool에는 붙는다 | |
| mcp-server R5a | candidate | coding-agent-mcp-interface | 성공 결과는 짧은 요약, 구조화 data, 다음에 더 읽거나 기다리며 확인할 방법을 담는다 | 목록, test 요청, release 준비, 승인 대기의 결과에 세 가지가 모두 있다 | 본문 전체를 요약에 되풀이하지 않는다는 말은 표현 선택이라 뺐다 |
| mcp-server R5b | candidate | coding-agent-mcp-interface | 성공 결과는 구조화 data와 같은 뜻의 JSON 텍스트를 함께 돌려준다 | 같은 호출의 구조화 data와 텍스트를 비교하면 사실이 같다 | |
| mcp-server R6a | candidate | coding-agent-mcp-interface | 모르는 동작, 빠진 필수 입력, 범위를 벗어난 값, 맞지 않는 cursor는 실행하기 전에 거절한다 | 빈 필수 값, 틀린 종류의 값, 다른 목록의 cursor를 넣으면 아무것도 바뀌지 않고 거절된다 | 폐지된 옛 별칭과 인자의 거절은 호환 장치 얘기라 뺐다 |
| mcp-server R6b | candidate | coding-agent-mcp-interface | 요청이 실패하면 실패 이유, 현재 판정, 다음에 읽을 곳을 돌려준다 | 거절된 호출의 응답에 이유와 다음 확인 방법이 있다; 도메인 오류는 core API의 오류 종류를 그대로 담는다 | core API 오류 객체는 req-0202 |
| mcp-server R7a | candidate | coding-agent-mcp-interface | tool 실행 실패와 효과를 확인할 수 없는 경우는 MCP의 tool 오류로 표시하고, 모르는 tool이나 잘못된 MCP 요청의 protocol 오류와 구별한다 | 실행이 실패한 호출은 tool 오류로 나오고 모르는 tool을 부르면 protocol 오류로 나온다 | |
| mcp-server R7b | candidate | coding-agent | 변경 요청의 응답이 끊겨 결과를 모르면 성공이나 실패로 추측하지 않고 자동으로 다시 실행하지 않으며, 현재 상태를 읽을 곳을 안내한다 | 기록 직후 응답을 끊어도 같은 변경이 두 번 생기지 않는다; 결과 불명으로 표시되고 현재 상태를 읽는 방법이 나온다 | cli R5와 같은 보장. ticket을 읽으라는 안내는 뺐다 |
| mcp-server R18a | candidate | coding-agent | 사람의 승인이 필요한 앱 작업은 tool·명령 결과에 승인 대기 사실, 정확한 대상과 영향, 사람이 열 확인 링크를 담는다 | release 준비, 앱 호출의 결과에서 대기와 적용을 구별해 읽을 수 있다; 링크를 읽는 것만으로는 승인되지 않는다; 승인 대상이 호출 때의 release, command, 입력과 같다 | cli R21, cli R32b와 같은 보장. ticket 완료 결과의 대기는 ask(R28) |
| mcp-server R18b | drop-removed | | | | 질문과 approval request의 목록·상세 읽기 tool: coding agent의 앱 밖 tool(removed.md 1) |
| mcp-server R18c | drop-dup | | | | req-0303: 사람 답, 허락, 거절은 coding agent가 대신 내리지 못한다 |
| mcp-server R19a | candidate | coding-agent | coding agent는 이름과 제목만으로 앱을 가볍게 등록한다 | blueprint나 code가 없어도 이름과 제목으로 등록이 성공한다; 등록 뒤 앱 목록에 보인다 | 등록의 입력 검사는 apps 몫(apps-1). cli R25a와 같은 보장 |
| mcp-server R19b | candidate | coding-agent | coding agent는 구현을 시작할 source를 연결하고 template을 준비한다 | 등록된 앱에 source를 연결하면 template이 준비된다; 다시 호출해도 사람이 고친 파일을 덮어쓰지 않는다 | source 위치 규칙은 apps-1의 등록과 겹칠 수 있다 |
| mcp-server R19c | candidate | coding-agent | blueprint 검사는 오류, 경고, permission 검토를 구별해 돌려준다 | 부적합한 blueprint를 검사하면 오류가 나오고 성공으로 끝나지 않는다; 경고와 permission 검토는 오류와 따로 읽힌다 | cli R26a와 같은 보장 |
| mcp-server R19d | candidate | coding-agent | 앱 test 요청은 test runner에 맡기고, 결과는 runner가 남긴 test result로만 읽힌다 | 요청한 뒤 같은 묶음의 test result를 조회하면 통과, 실패, 판정 불가가 구별된다; 터미널 출력은 test result로 읽히지 않는다 | test result 기록은 req-0185. cli R26b와 같은 보장 |
| mcp-server R19e | candidate | coding-agent | coding agent는 fixture로 격리된 preview를 시작하고 멈추며, 상태와 접속 안내와 중지 결과를 받는다 | 앱이나 연결된 source로 preview를 시작하면 상태와 접속 안내가 나온다; 중지하면 중지 결과가 나온다 | cli R27a와 같은 보장. 격리와 운영 앱에 미치는 영향은 R20c |
| mcp-server R19f | candidate | coding-agent | release 준비는 준비된 release, 실제 test 근거, 다음에 조회할 방법을 돌려주고, 준비와 activation을 구별해 알린다 | 준비가 끝난 결과에 release와 test 근거와 다음 조회가 있다; 준비 성공이 activation 성공으로 표시되지 않는다 | cli R28과 R21a의 같은 부분. 준비 규칙은 app-releases(R21b, R21d), claim 근거는 R21c |
| mcp-server R19g | candidate | coding-agent | coding agent는 범위 안 앱의 현재 상태, release 상태, 현재 blueprint, command 호출 이력, 앱 log를 읽는다 | 활성 release와 preview를 구별해 읽는다; source가 연결되지 않은 앱은 그 이유가 나온다; log는 redaction이 끝난 것이다 | cli R24와 같은 보장. 이력의 개수와 log 줄 수 제한은 R32 |
| mcp-server R19h | ask | coding-agent | coding agent는 automation의 호출 이력을 읽는다 | automation으로 좁힌 이력이 앱, command와 같은 방식으로 나온다 | automation이 주기 실행(보류)을 가리키는지 정해야 한다. 가리키면 drop-removed, 수동 실행만이면 candidate. cli R24, cli R31, mcp-server R32도 같다 |
| mcp-server R19i | candidate | coding-agent | 앱 도구 재배포는 기존 앱 code와 사람이 쓴 안내를 보존하고, 갱신 대상마다 변경, 무변경, 건너뜀과 이유를 돌려준다 | 두 번 부르면 중복이 생기지 않는다; 충돌한 파일과 바꾸지 않은 이유가 읽힌다 | cli R29와 같은 보장. 설치 파일 규칙은 guides(coding-2)와 겹칠 수 있다 |
| mcp-server R20a | drop-dup | | | | R19c, R19d: 검사 결과와 test result를 구별해 돌려준다 |
| mcp-server R20b | defer-other | app-releases | release 준비는 부적합한 blueprint나 같은 묶음의 실패한 test 결과가 있으면 거절한다 | | release 준비 판정은 앱 쪽(app-releases) 몫이다 |
| mcp-server R20c | defer-other | app-runtime | preview의 읽기와 command는 운영 자료를 바꾸지 않는다 | | preview 격리는 app-runtime 몫이다 |
| mcp-server R21a | drop-dup | | | | R19f |
| mcp-server R21b | defer-other | app-releases | 같은 묶음의 앱 test 통과 없이 release를 준비할 수 없다 | | 준비 판정은 app-releases 몫이다. cli R28, mcp-server R33c도 같은 보장 |
| mcp-server R21c | ask | coding-agent | release 준비는 지정한 작업의 현재 claim을 근거로 받고, 작업이 없거나 문제를 직접 가리킨 준비는 거절한다 | 현재 claim이 있는 작업을 가리킨 준비는 성공한다; 작업 없는 준비와 문제를 직접 가리킨 준비는 거절된다 | ticket·claim 모델이 남는지 정해야 한다(남으면 subject는 problems·apps 중 정해야 한다). cli R28, cli R34의 claim 부분도 같다 |
| mcp-server R21d | defer-other | app-releases | 새 release의 activation은 사람이 한 번 눌러 고른다 | | activation은 app-releases 몫이다 |
| mcp-server R22a | candidate | coding-agent | SDK 검색은 설명이나 API 이름으로 package의 이름, 최신 version, 종류, 한 줄 설명 목록을 돌려준다 | 설명 검색과 API 이름 검색이 각각 목록을 돌려준다; 설치되지 않은 package와 없는 package가 구별된다 | cli R30의 읽기 부분과 같은 보장. 개인 SDK는 첫 판에 두지 않는 범위라 뺐다. package 목록 자체는 app-packages 몫 |
| mcp-server R22b | candidate | coding-agent | package를 고르면 API, type, permission, peer 의존, 예제를 읽을 수 있다 | package 하나를 고르면 다섯 가지가 모두 나온다 | cli R30의 상세 부분과 같은 보장 |
| mcp-server R23a | candidate | coding-agent | SDK 추가는 package와 정확한 version을 받아 고정 import 안내를 돌려주고, 범위로 지정한 version은 거절한다 | 정확한 version으로 추가하면 앱의 import map에 쓸 고정 안내가 나온다; 최신이나 범위로 지정하면 거절된다; 같은 version을 두 번 추가해도 중복이 없다 | cli R30의 추가 부분과 같은 보장. version 고정 규칙은 app-packages 몫(sdk R7) |
| mcp-server R23b | candidate | coding-agent | SDK 추가에서 source 반영을 고르면, 허용된 파일에만 반영하고 변경, 무변경, 충돌을 알린다 | 반영을 고르면 결과가 파일마다 변경, 무변경, 충돌로 표시된다; 이미 다른 version이 들어 있으면 충돌로 나온다 | |
| mcp-server R24a | candidate | coding-agent | 문제 목록과 상세는 앱, 진행 상태, 처리를 맡을 쪽으로 좁혀 읽고 목록에는 요약이 있다 | 앱과 진행 상태를 고르면 해당 문제만 나온다; 목록 항목에서 상세를 읽을 수 있다 | cli R33과 같은 보장 |
| mcp-server R24b | candidate | coding-agent | 수리 자료(snapshot, 지난 고친 기록, 요약, 전체 수리 묶음, 종류별 추가 근거)를 읽는 호출은 문제의 상태를 바꾸지 않는다 | 수리 자료를 읽은 뒤 문제의 진행 상태와 기록이 그대로다 | 묶음의 내용·순서·상한은 repair-context(coding-3). 이미지를 못 읽는 환경의 첨부 안내(cli R33)는 coding-3과 같이 본다 |
| mcp-server R25a | candidate | coding-agent | coding agent는 tool로 고친 기록을 내고, reproduction test와 app test를 요청한다 | 고친 기록을 내면 문제에 기록이 붙는다; test를 요청하면 runner가 결과를 남긴다 | 고친 기록 제출 규칙은 problems 몫(req-0178). cli R34가 덮는 쓰기도 같다 |
| mcp-server R25b | ask | coding-agent | 코드를 고치는 쓰기(고친 기록, test 요청)는 지정한 작업의 현재 claim 아래에서만 받는다 | claim이 있는 작업에 연결된 쓰기는 접수된다; claim이 없거나 풀린 뒤의 쓰기는 거절된다 | ticket·claim 모델이 남는지 정해야 한다(req-0184와 같은 질문). cli R34 |
| mcp-server R25c | drop-dup | | | | req-0185, req-0158: test result는 runner만 기록하고 coding agent의 문제 닫기 요청은 거절된다 |
| mcp-server R25d | drop-detail | | | | 직접 문제 claim, 별도 시도 단계, workflow 조작, 증상 결론이 없다는 열거는 없는 기능 목록이다(README 2) |
| mcp-server R26 | ask | coding-agent | 작업 항목 목록은 앱과 진행 상태로 좁혀 한 번에 최대 20개 요약과 cursor를 돌려주고, 상세는 본문, 현재 claim과 작업 가능 여부, 조건별 검사 결과를 담는다 | 항목이 21개 이상이면 20개 이하만 나오고 cursor로 이어 읽는다; 상세에 모든 조건과 현재 claim이 있다 | ticket·claim 모델이 남는지 정해야 한다. cli R36의 읽기 부분도 같다 |
| mcp-server R27 | ask | coding-agent | 작업 항목의 쓰기는 사람 지시에 따른 claim, 명시한 갱신, 반납, 근거 release 연결, 완료 보고이고, claim 응답에 현재 연결, 기한, 이번 claim을 구별할 근거를 담는다 | 만료되거나 취소된 claim으로 하는 뒤의 쓰기는 거절된다; 통로가 따로 기한을 붙이거나 자동으로 늘리지 않는다 | ticket·claim 모델이 남는지 정해야 한다. 기한과 재claim 규칙은 tickets(coding-3). cli R36, cli R41도 같다 |
| mcp-server R28 | ask | coding-agent | 완료 결과는 원래 작업 항목, 앱, release, test result를 이어 완료 주장, 보고 접수, 확인 실패, 승인 대기, activation, 문제 정상 확인을 따로 알린다 | 각 단계가 원래 작업 항목에서 구별되어 읽힌다; 보고만으로는 확인됨이나 문제 닫힘이 생기지 않는다 | ticket·claim 모델이 남는지 정해야 한다 |
| mcp-server R29a | candidate | coding-agent | coding agent는 범위 안 앱의 process와 preview 상태, 활성 release, 호출할 수 있는 command를 읽는다 | 범위 안 앱은 상태와 command 목록이 나온다 | cli R24와 겹치는 읽기(R19g)와 합칠 수 있다 |
| mcp-server R29b | candidate | coding-agent | 읽기 효과의 command 호출은 앱, command, JSON 입력, 환경 선택(preview 또는 운영), 선택 기한을 받아 결과를 돌려주고, 환경을 고르지 않으면 preview이며 기한은 양수만 받는다 | 환경을 생략하면 preview에서 실행된다; 0이나 음수 기한은 거절된다; 호출 결과를 invocation으로 다시 조회할 수 있다 | cli R31과 같은 보장. 읽기 효과가 아닌 command는 R34b |
| mcp-server R29c | candidate | coding-agent | invocation 조회는 결과가 아직 없는 경우, 결과를 모르는 경우, 실제 실패를 구별해 돌려준다 | 결과를 알 수 없는 호출을 조회하면 결과 불명으로 나오고 실패로 표시되지 않는다 | cli R32a와 같은 보장 |
| mcp-server R29d | candidate | coding-agent | 조회한 환경에서 결과가 없거나 실패해도 다른 환경으로 바꾸어 다시 조회하지 않는다 | preview에서 실패한 호출을 운영에서 다시 부르지 않는다 | |
| mcp-server R29e | defer-other | app-runtime | 앱 읽기 command의 호출은 호출 기록의 확정을 기다리지 않고 앱으로 바로 간다 | | 호출 경로는 app-runtime·app-direct-protocol 몫(server-supervision responsiveness R2와 같은 보장). mcp-server R35, cli R31에도 같은 말이 있다 |
| mcp-server R30a | candidate | coding-agent | 모든 tool·명령의 결과(목록, 검색, 요약, 본문, 첨부, 이어 읽기, 다음 안내)는 연결된 범위 안의 자료만 담고 redaction을 거친다 | 범위 밖 앱의 제목, 본문, 건수, 첨부가 나오지 않는다; 결과 어디에도 token이 없다 | req-0206과 겹치지만 이쪽은 요약, 건수, 이어 읽기까지 결과 전체에 대한 보장이다. 연결 범위는 connection(coding-2). cli R6의 범위 부분도 같다 |
| mcp-server R30b | drop-dup | | | | req-0303(approval 결정), req-0402(secret 값), req-0158(문제 닫기)이 덮는다. backup은 지운 것(removed.md 1) |
| mcp-server R31a | drop-removed | | | | project 등록, agent assignment 변경, 사람 원본 임의 읽기: coding agent의 앱 밖 tool(removed.md 1) |
| mcp-server R31b | drop-dup | | | | req-0185: test result는 test runner만 쓴다 |
| mcp-server R31c | ask | coding-agent | coding agent는 작업 항목의 목표를 바꾸거나 확인 여부를 판정하지 못한다 | 목표를 바꾸거나 확인됨을 선언하는 호출은 거절된다 | ticket·claim 모델이 남는지 정해야 한다 |
| mcp-server R31d | drop-detail | | | | 앱 DB 직접 접근이 tool에 없다는 열거는 없는 기능 목록이다(README 2). 접근 범위의 판정은 req-0206, req-0209가 한다 |
| mcp-server R32a | candidate | coding-agent | command 호출 이력은 앱과 command로 좁혀 한 번에 최대 20개를 주고, 남은 것은 이어 읽는다 | 21개가 있으면 20개가 나오고 이어 읽기가 가능하다; 조용히 잘리지 않는다 | cli R24의 개수 부분과 같은 보장 |
| mcp-server R32b | candidate | coding-agent | 앱 log는 한 번에 1~200줄을 요청할 수 있고, 남은 log는 이어 읽으며 redaction으로 가린 수를 알려 준다 | 201줄 이상이나 0줄을 요청하면 거절된다; 남은 log가 있으면 이어 읽기가 가능하다; redaction으로 가린 수가 나온다 | 수리 묶음의 log 상한은 repair-context(coding-3) |
| mcp-server R32c | ask | coding-agent | 이력을 automation으로 좁혀 읽는다 | automation으로 좁힌 이력이 앱, command로 좁힌 이력과 같은 방식으로 나온다 | automation이 주기 실행(보류)을 가리키는지 정해야 한다(R19h) |
| mcp-server R33a | candidate | coding-agent | 앱 test 요청은 기본 timeout 300초를 runner에 명시해 전달한다 | 요청을 만들면 runner가 받은 timeout이 300초이다; 호출자가 정한 timeout은 runner의 상한 안에서만 받는다 | runner 상한은 req-0198 |
| mcp-server R33b | drop-dup | | | | req-0188: test의 실패, timeout, 시작 전 거절이 구별된다 |
| mcp-server R33c | drop-dup | | | | R21b: 바뀐 source는 이전 test 통과로 release를 준비할 수 없다 |
| mcp-server R34a | candidate | coding-agent-mcp-interface | 연결 범위 안 앱의 읽기 command는 blueprint의 이름, 설명, 입력 형식 그대로 tool로 나온다 | tool의 schema가 blueprint와 같다; 범위 밖 앱의 command는 목록에 나오지 않는다 | |
| mcp-server R34b | ask | coding-agent | coding agent가 부를 수 있는 앱 command의 효과 범위를 정한다 | 허용하지 않는 효과의 command는 목록에도 직접 호출에도 거절된다 | MCP는 첫 판에서 읽기 command만 내보내라 했고, CLI(cli R31)는 읽기, 변경, 확인 필요 효과 모두의 결과를 돌려준다고 했다. 둘이 다르다. 읽기만인지, 변경과 확인 필요까지인지 정해야 한다 |
| mcp-server R35a | candidate | coding-agent-mcp-interface | 앱의 release나 연결이 바뀐 뒤에는 옛 schema의 호출을 거절하고, tool 목록을 다시 읽으면 새 schema가 나온다 | release를 바꾼 뒤 옛 schema로 부르면 거절된다; 목록을 다시 읽으면 새 schema로 호출된다 | |
| mcp-server R35b | drop-detail | | | | 앱 직접 호출 경로를 쓰고 별도 중계 경로를 두지 않는다는 것은 구현 선택이다. preview 기본값과 범위와 redaction은 R29b, R30a |
| mcp-server R36a | candidate | coding-agent-mcp | MCP server는 시작할 때 연결 참조로 OS keychain에서 자격을 받는다 | 설정 파일과 prompt에 token이 없어도 초기화가 성공한다 | 연결과 자격 발급은 connection(coding-2)과 겹칠 수 있다 |
| mcp-server R36b | candidate | coding-agent-mcp | keychain을 읽을 수 없으면 MCP server는 사용할 수 없다고 알리고, 다른 자격이나 평문 파일로 대신하지 않는다 | keychain이 잠긴 상태에서 초기화하면 unavailable이 나오고 다른 자격으로 호출되지 않는다 | req-0205와 겹치지만 이쪽은 시작 실패에서의 대응이다 |
| mcp-server R36c | drop-dup | | | | req-0406: lophn이 만든 token의 원문은 보호 저장소 밖에 남지 않는다 |
| mcp-server R37a | candidate | coding-agent | coding agent의 자격으로는 harness 설치, session 시작과 재개, 권한 응답을 호출하지 못한다 | 그 호출을 직접 보내면 거절된다 | session 시작과 harness 설치의 사람 쪽 경로는 sessions, harnesses(coding-2). 권한 응답은 req-0303도 덮는다. cli R40b도 같다 |
| mcp-server R37b | ask | coding-agent | 작업 항목의 시작은 사람의 시작 선택으로만 하고 coding 자격은 지정한 항목의 claim, 작업, 보고만 한다 | 시작을 coding 자격으로 호출하면 거절된다 | ticket·claim 모델이 남는지 정해야 한다 |
| mcp-server R38 | drop-removed | | | | 앱 toolset 말고 다른 tool을 주지 않는다는 항목: 탐색, 문서, project, context, series, 질문 읽기 tool은 coding agent의 앱 밖 tool(removed.md 1)이고 context 통로(removed.md 1)다. 터미널에서 띄운 coding agent는 터미널 프로그램일 뿐이다. 기본 묶음이 앱 toolset이라는 보장은 R3a |
| mcp-server R39a | candidate | coding-agent | 작업 요약은 요청할 때 연결 범위 안의 열린 문제를 읽어 알려 주고, 항목마다 상세를 읽는 방법을 준다 | 요약에 범위 밖 자료가 없다; 항목마다 상세 조회 방법이 나온다; 요약을 읽은 것만으로 수리 착수나 상태 변경이 없다 | 시작 요약의 계약은 guides(coding-2) |
| mcp-server R39b | ask | coding-agent | 작업 요약은 현재 claim, 기한, 보고 뒤 남은 검사 조건도 담는다 | 요약에 claim과 기한과 남은 검사가 나온다 | ticket·claim 모델이 남는지 정해야 한다 |

## cli

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| cli R1a | candidate | coding-agent-cli | CLI는 호출마다 core API client 하나로 동작해, MCP가 없거나 꺼진 session에서도 같은 자격으로 앱 개발과 고치기의 조회와 보고를 한다 | MCP를 끈 session에서 조회와 보고가 성공한다; 변경은 core API를 통해서만 남는다; 같은 입력에 MCP와 같은 허용과 거절이 나온다 | 같은 결과 부분은 mcp-server R2 |
| cli R1b | ask | coding-agent-cli | CLI에서 claim을 하려 하면 MCP 연결로 안내한다 | claim 시도가 MCP 연결 안내로 끝난다 | ticket·claim 모델이 남는지 정해야 한다. cli R41과 같다 |
| cli R2a | candidate | coding-agent-cli-interface | 모든 command는 JSON 출력을 낼 수 있고, 같은 일을 하는 MCP tool의 구조화 data와 같은 사실을 담는다 | 도움말, 설치 점검, daemon, test, 승인 대기를 JSON으로 읽을 수 있다; 같은 호출의 MCP 결과와 사실이 같다 | |
| cli R2b | candidate | coding-agent-cli-interface | 성공은 종료 값 0이고, 입력 오류, 권한 거절, 실행 실패, 효과를 확인할 수 없는 경우는 0이 아닌 종료 값이다 | 실패한 호출과 결과 불명인 호출이 종료 값 0으로 끝나지 않는다; 부적합 blueprint 검사도 0으로 끝나지 않는다 | |
| cli R3a | candidate | coding-agent-cli-interface | JSON을 고르면 stdout에는 완전한 결과 하나만 쓰고 stderr에는 안전한 오류와 추가 안내만 쓴다 | stdout을 redirect해 JSON으로 파싱할 수 있다; daemon 연결이 끊긴 실패에서도 stdout이 깨지지 않고 오류에 다음 조회가 있다 | |
| cli R3b | drop-dup | | | | req-0402, req-0406: secret 값과 token 원문은 어느 출력에도 나오지 않는다 |
| cli R4a | candidate | coding-agent-cli-interface | 입력은 필수 위치 인자, 선택 옵션, 숫자 범위, JSON 종류, 지원하는 command인지를 실행 전에 검사해 거절한다 | 빠진 필수 값, 범위 밖 숫자, 깨진 JSON, 모르는 command를 넣으면 아무것도 바뀌지 않고 거절된다 | 폐지된 별칭의 거절은 호환 장치 얘기라 뺐다 |
| cli R4b | candidate | coding-agent-cli-interface | JSON 본문은 inline이나 지정한 파일 하나에서만 읽고, 상대 위치는 현재 작업 위치 기준으로 해석한다 | inline과 파일을 함께 주면 거절된다; 공백이 든 위치와 인자가 그대로 전달된다; 상대 경로가 호출한 위치 기준으로 열린다 | |
| cli R5 | drop-dup | | | | mcp-server R7b |
| cli R6a | candidate | coding-agent-cli | coding 자격으로는 daemon 시작과 중지를 하지 못한다 | coding 자격으로 daemon 시작과 중지를 부르면 거절된다 | |
| cli R6b | drop-dup | | | | req-0303(approval 결정과 grant), req-0402(secret 값), req-0158(문제 닫기와 무시): coding 자격이 하지 못한다 |
| cli R6c | drop-removed | | | | project와 agent assignment 관리, 원본 파일 접근: coding agent의 앱 밖 일(removed.md 1). 앱 DB 직접 접근은 mcp-server R31d |
| cli R6d | drop-dup | | | | mcp-server R30a(연결 범위 적용), req-0205(거절한 요청을 사용자 자격으로 대신하지 않는다) |
| cli R7a | candidate | coding-agent-cli-interface | 사람의 결정이 필요한 명령은 대상, 입력, 기한을 정확히 묶은 승인 요청을 만들고 사람이 열 링크를 돌려줄 뿐 그 자리에서 실행하지 않는다 | 승인 요청을 열지 않거나 닫거나 기한이 지나면 아무것도 바뀌지 않는다; coding 자격의 호출이 사람의 결정으로 기록되지 않는다; TTY 여부와 headless 여부에 상관없이 같은 안내가 나온다 | 어떤 일이 사람 결정을 요구하는지의 목록(연결 회수, secret 값, 운영 앱 시작과 중지, release activation, 문제 닫기)은 각 도메인이 정한다 |
| cli R7b | drop-dup | | | | req-0303, req-0304: TTY의 yes나 옵션이나 비대화 script로는 사람의 결정이 되지 않는다 |
| cli R7c | drop-detail | | | | 그 밖의 일은 묻지 않고 진행한다는 것은 승인을 요구하는 일의 범위를 정하는 말이다. 범위는 approvals와 각 도메인이 정한다 |
| cli R8a | candidate | coding-agent-cli-interface | 사람은 lophn 창 없이도 daemon을 시작하고 멈추고, 현재 연결 상태와 redaction을 거친 daemon log를 CLI로 읽는다 | 이미 시작하거나 멈춘 상태에서 다시 부르면 현재 상태로 응답한다; daemon 장애의 안전한 이유를 읽는다; log에 secret이 없다 | daemon 자체는 server, supervision 몫이고 여기는 명령의 계약만 맡는다 |
| cli R8b | candidate | coding-agent | 보통 조회와 MCP 사용은 lophn 창이 떠 있지 않아도 daemon이 떠 있으면 동작한다 | 창이 닫힌 상태에서 MCP tool과 CLI 조회가 성공한다 | |
| cli R9 | candidate | coding-agent-cli-interface | MCP 설정 출력은 선택한 coding agent 제품에 맞는 실행 파일, 나뉜 인자, 환경 설정 조각을 돌려주고 제품의 설정 파일은 고치지 않는다 | 제품마다 유효한 조각이 나온다; 출력 뒤 제품의 기존 설정 파일이 그대로다; secret 원문과 운영 data 위치가 출력에 없다 | 지원 제품 목록은 harnesses(coding-2) |
| cli R10a | candidate | coding-agent-cli-interface | skill은 설치할 수 있는 목록의 이름, 설명, version을 읽고 사람이 고른 target에 설치한다 | 목록에 세 가지가 나온다; 고른 target에만 설치된다 | 보존, 충돌, 서명, 위치 규칙은 guides(coding-2) |
| cli R10b | candidate | coding-agent-cli-interface | 설치 점검은 daemon, 인증, 설정의 결과와 coding agent가 실제로 tool을 발견해 불러 오는 단계별 결과를 따로 돌려준다 | 단계마다 성공, 실패, 확인 못함과 다음 확인 방법이 나온다 | 단계 정의는 harnesses(coding-2) |
| cli R21 | drop-dup | | | | mcp-server R18a: 승인 대기와 허락, 적용, 실패의 구별. 질문·approval request 목록 command는 mcp-server R18b와 같이 앱 밖 일(removed.md 1) |
| cli R24 | drop-dup | | | | mcp-server R19g, R32a, R32b. 별도 host journal이 없다는 말은 없는 기능 목록이다. automation으로 좁히기는 R19h |
| cli R25a | drop-dup | | | | mcp-server R19a, R19b |
| cli R25b | candidate | coding-agent | 앱 등록은 전체 범위의 coding 연결만 할 수 있고, 앱 하나에 묶인 연결은 그 앱의 개발만 한다 | 앱 하나에 묶인 연결로 새 앱 등록을 부르면 거절된다; 그 연결로 자기 앱의 개발은 된다 | 연결 범위는 connection(coding-2)과 겹칠 수 있다 |
| cli R26 | drop-dup | | | | mcp-server R19c, R19d, R33a, R2b. 지금 test result를 직접 입력해 꾸밀 수 없는 것은 req-0185 |
| cli R27a | drop-dup | | | | mcp-server R19e |
| cli R27b | candidate | coding-agent | coding 자격으로는 운영 앱 시작과 중지를 하지 못한다 | coding 자격으로 운영 앱 시작과 중지를 부르면 거절된다; preview 시작과 중지는 된다 | 운영 앱 시작·중지가 사람 결정을 요구하는 일인지는 app-runtime이 정한다. R7a의 링크와 함께 본다 |
| cli R28 | drop-dup | | | | mcp-server R19f(준비와 activation의 구별), R21b(app test 통과), R21c(claim 근거) |
| cli R29 | drop-dup | | | | mcp-server R19i |
| cli R30 | drop-dup | | | | mcp-server R22a, R22b, R23a, R23b |
| cli R31 | ask | coding-agent | 앱 command 호출은 읽기, 변경, 확인 필요 효과별 결과와 호출 기록을 돌려주고, automation의 수동 수행도 같은 command 경계를 쓴다 | 읽기 호출은 기록 확정을 기다리지 않는다; 확인 필요 호출은 대기로 나온다; preview와 운영 결과가 섞이지 않는다 | MCP는 읽기 command만 내보낸다(mcp-server R34b)와 다르다. automation이 주기 실행(보류)을 가리키는지도 정해야 한다(R19h). 읽기 부분은 mcp-server R29b, 기록을 기다리지 않는 부분은 R29e가 덮는다 |
| cli R32a | drop-dup | | | | mcp-server R29c |
| cli R32b | drop-dup | | | | mcp-server R18a, req-0308: 확인이 필요한 승인 대상이 정확한 release, command, 입력에 묶인다. app read의 허가를 별도 receipt로 복제하지 않는다는 말은 구현 세부 |
| cli R33 | drop-dup | | | | mcp-server R24a, R24b |
| cli R34a | ask | coding-agent | 제작과 수리의 쓰기는 모두 지정한 작업의 현재 claim에 결과, 고친 기록, test, release 근거를 연결하고 완료 보고로 끝난다 | 쓰기가 원래 작업에서 다시 읽힌다; 작업 없는 쓰기와 문제 직접 claim은 거절된다 | ticket·claim 모델이 남는지 정해야 한다. mcp-server R25b, R21c와 같은 질문 |
| cli R34b | drop-detail | | | | claim 없던 옛 고친 기록을 조회만 유지한다는 것은 옛 기록 호환 장치다(AGENTS.md 호환성) |
| cli R35a | candidate | coding-agent-cli-interface | 문제 제보와 문제 닫기(확인, 무시)는 CLI에서 처리하지 않고, 사람이 여는 화면의 링크와 대기 사실만 돌려준다 | 이 명령을 부른 것만으로 문제나 제보의 상태가 바뀌지 않는다; coding 자격의 호출은 실행 전에 거절된다; 돌려준 링크의 화면에서 요청한 결정을 할 수 있다 | 제보 접수는 problems(feedback)와 shell 몫. 닫기 결정은 req-0158, req-0165와 이어진다 |
| cli R35b | ask | coding-agent-cli | 수리 요청은 담당 agent가 작업 항목을 준비하는 화면의 링크를 돌려주고, 요청만으로 coding agent를 띄우거나 문제를 닫지 않는다 | 호출한 것만으로 coding agent가 시작되지 않고 문제가 닫히지 않는다 | ticket·claim 모델이 남는지 정해야 한다. 사람이 시작 단추를 누른 TUI 시작은 sessions(coding-2) |
| cli R35c | drop-dup | | | | req-0165, req-0170: 사람의 "내가 확인함"은 테스트 통과와 구별된다 |
| cli R36 | ask | coding-agent-cli | 작업 항목 명령은 최대 20개 요약 목록과 cursor, 본문, 현재 claim, 조건별 검사, claim 안내, 갱신, 반납, release 연결, 완료 보고를 낸다 | MCP의 같은 읽기와 같은 결과가 나온다; 완료 주장, 승인 대기, activation, 확인됨이 따로 읽힌다 | ticket·claim 모델이 남는지 정해야 한다. mcp-server R26, R27, R28과 같은 질문 |
| cli R37 | ask | coding-agent-cli | 작업 항목 생성과 취소는 같은 필수 입력 검사를 거치고 취소 사유를 받으며, 승인 요청 없이 적용된다. coding 자격에는 목표 수정, 공개, 취소, 확인 판정을 주지 않는다 | 사람이 만든 항목이 바로 열린 상태로 읽힌다; 취소 뒤 옛 claim의 연결과 보고가 거절된다; coding 자격의 취소 호출은 거절된다 | ticket·claim 모델이 남는지 정해야 한다. 생성·취소를 승인 없이 하는지도 함께 정해진다 |
| cli R38 | drop-dup | | | | req-0402, req-0400: secret 값은 keychain에만 있고 agent가 받지 못한다. 사람의 secret 관리 command가 없다는 열거는 없는 기능 목록이다(README 2) |
| cli R39 | candidate | coding-agent-cli-interface | 도움말은 지원하는 command마다 목적, 필수와 선택 입력, JSON 출력, 읽기와 변경의 구분, 사람 결정이 필요한지, 다음 조회를 알려 준다 | 도움말 목록에서 test, blueprint, SDK, daemon log 명령을 찾는다; 도움말에 나온 command가 모두 실제로 동작한다 | |
| cli R40a | candidate | coding-agent-cli-interface | CLI는 coding agent 제품의 catalog 조회, 감지, 선택 target의 설치 계획, 설치, 갱신, 제거, 관측을 화면과 같은 adapter와 규칙으로 한다 | 고르지 않은 제품은 바뀌지 않는다; 사람이 고친 파일과 충돌하면 같은 결과가 나온다; loading 관측 결과가 화면과 같다 | harnesses(coding-2)와 겹친다. 합칠 때 확인 |
| cli R40b | drop-dup | | | | mcp-server R37a: coding 자격은 설치를 호출하지 못한다 |
| cli R41 | ask | coding-agent-cli | claim은 MCP로만 하고 CLI는 읽기와 보고, MCP claim 안내를 제공하며 자체 claim을 실행하지 않는다 | CLI의 claim 시도가 MCP 연결 안내로 끝난다; MCP가 없는 session은 읽을 수는 있어도 claim 없이 code를 쓰지 못한다 | ticket·claim 모델이 남는지 정해야 한다. cli R1b와 같다 |
| cli R42 | drop-removed | | | | 앱 개발·고치기 말고 다른 command를 주지 않는다는 항목: 문서, project, context, 용어, series, 질문 읽기, 원본 파일 관리 command는 coding agent의 앱 밖 일이고 context 통로다(removed.md 1). 앱 개발과 고치기를 CLI로 할 수 있다는 보장은 req-0097 |

## 개수

- candidate: 59 (coding-agent 31, coding-agent-mcp 4, coding-agent-mcp-interface 9, coding-agent-cli 2, coding-agent-cli-interface 13)
- ask: 19
- defer-other: 5 (app-releases 3, app-runtime 2)
- drop-removed: 6
- drop-conflict: 0
- drop-dup: 29
- drop-detail: 6
- 합계: 124줄 (mcp-server 76줄 + cli 48줄)
