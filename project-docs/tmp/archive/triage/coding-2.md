# triage: coding-2

옛 파일: `coding-agent/connection.md`(R1 ~ R18), `harnesses.md`(R1 ~ R12), `sessions.md`(R1 ~ R10), `guides.md`(R1 ~ R27, R6·R7은 옛 파일에 없음). 새 파일은 `coding-agent.yaml`(subject coding-agent, coding-agent-harness-api; 맡은 interface coding-agent-harness-api). MCP·CLI 쪽 보장은 `coding-agent-mcp.yaml`·`coding-agent-cli.yaml`로 가므로 이 묶음에서는 MCP 오프라인 시작과 tool 발견만 coding-agent-mcp로 둔다.

판정 기준 메모:

- 자격 발급·보관·회수 결정은 server 몫이라 `defer-other`.
- ticket·claim에 기대는 보장은 `ask`(요지·확인 채움). ticket 없이도 서는 부분은 줄을 나눠 candidate로 둔다.
- 앱 개발과 앱 고치기 밖의 안내(탐색, 문서 저장, context)는 `drop-removed`.

## connection

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| connection R1a | candidate | coding-agent | Claude Code, Codex, OpenCode, Hermes, pi, Gemini CLI, OpenClaw가 사람의 터미널에서 연 세션에서 lophn의 MCP, CLI, skill로 연결되어 앱 개발과 앱 고치기에 쓰인다. | 일곱 제품 각각에서 검증된 연결로 MCP tool 발견과 CLI 호출이 성공한다; 연결한 세션이 skill을 필요할 때 읽는다 | |
| connection R1b | candidate | coding-agent | 외부 coding agent process는 사람이 시작을 요청할 때만 열린다. | lophn을 시작하거나 문제가 생겨도 새 coding agent process가 열리지 않는다; 사람이 시작을 요청하면 고른 harness 하나만 열린다 | |
| connection R2a | defer-other | server | 사람이 harness 연결과 이름, 범위(전체 또는 앱 하나)를 고르면 그 선택이 허락이라 확인 창 없이 자격이 발급되어 OS keychain에 보관되고, 연결 회수만 사람이 확인 창에서 결정한다. | | 자격 발급·보관·회수 결정은 server. 이전 묶음의 identity R5·secrets R12와 같은 내용이라 server 쪽에서 한 번만 쓴다 |
| connection R2b | candidate | coding-agent | 연결을 만들면 고른 harness에 MCP와 skill 설치가 이어지고, 설치 실패는 발급한 자격의 성공과 따로 보이며 설치 실패나 제거가 이미 만든 자격을 바꾸지 않는다. | 설치를 실패시켜도 연결의 자격은 그대로 쓸 수 있고 결과에는 설치 실패가 표시된다; 설치를 제거해도 자격은 회수되지 않는다 | |
| connection R2c | drop-dup | | | | req-0212(agent가 자기 자격을 발급하거나 넓히지 못함) |
| connection R3a | candidate | coding-agent | 연결의 표시 이름은 명시한 이름 옵션, 제품 환경이 주는 이름, MCP 초기화 때 client가 알린 이름의 순서로 정한다. | 같은 제품의 두 연결이 서로 다른 이름으로 구별되어 기록된다; 이름 옵션을 주면 환경이 주는 이름보다 우선한다 | |
| connection R3b | drop-dup | | | | req-0205(호출자 자격은 token이 정하고 제품 이름·환경 변수 주장으로 바뀌지 않음) |
| connection R4a | candidate | coding-agent | 앱 등록은 전체 범위 연결에서만 되고, 앱 하나 범위 연결이 낸 등록 요청은 거절한다. | 전체 범위 연결의 등록 요청은 앱 등록 계약대로 처리된다; 앱 하나 범위 연결의 새 앱 등록은 거절된다 | 등록 계약은 apps 쪽 요구와 맞춘다 |
| connection R4b | drop-dup | | | | connection R7b(req-0303: 사람 전용 결정을 연결 자격으로 하지 못함) |
| connection R5a | candidate | coding-agent | 앱 하나 범위 연결은 그 앱의 정보와 문제, 공통 SDK와 템플릿만 읽고, 목록과 검색에서도 같은 범위 검사를 받는다. | 다른 앱이나 project의 문제를 가리켜 읽으면 제목과 본문이 나오지 않는다; 검색 결과에 범위 밖 자료가 섞이지 않는다 | req-0206·req-0210은 core-api 일반 규칙이고 이 줄은 coding agent 통로가 읽는 목록·검색 표면의 범위다. 옛 "앱 문서" 읽기는 지운 것(removed.md 1 앱 문서)이라 뺐다 |
| connection R5b | ask | | 앱 하나 범위 연결은 그 앱의 ticket과 근거를 읽고, 근거의 목록, 첨부, 추가 조회에서도 같은 범위 검사를 받는다. | 다른 앱을 가리키는 근거는 제목과 본문 없이 읽을 수 없다는 사실만 보인다; 근거를 추가로 달아도 범위 밖 자료는 읽히지 않는다 | ticket·claim 모델이 남는지 정해지지 않았다(plan.md 5장). 정해야 할 것: ticket이 남는지, 근거(첨부) 모델이 남는지 |
| connection R6 | candidate | coding-agent | 같은 연결은 MCP와 CLI 어느 통로로 부르든 같은 자격으로 같은 요청에 같은 허용 여부와 결과를 받는다. | 같은 읽기와 쓰기를 두 통로로 요청해 결과와 거절이 같다; 통로를 바꿔도 허용 범위가 넓어지지 않는다 | MCP와 CLI에 같이 걸리므로 부모 coding-agent |
| connection R7a | candidate | coding-agent | 승인이 필요한 요청은 coding agent 통로에서 승인 대기 사실과 사람이 결정할 자리만 돌려준다. | 대기 응답이 대기 사실과 결정 자리를 담는다; 대기 응답 뒤 같은 연결로 permission 변경이나 secret 값 읽기를 시도하면 거절된다 | |
| connection R7b | drop-dup | | | | req-0303(coding agent·MCP 서버는 자기 request를 허락하지 못함) |
| connection R8a | drop-dup | | | | req-0208(자격 회수 뒤 새 호출 즉시 거절) |
| connection R8b | ask | | 연결을 회수하면 그 연결의 현재 claim도 해제되고, claim 정리가 늦어도 회수된 자격은 새 호출이 거절된다. | 회수 직후 그 연결이 쥔 claim이 해제된 것으로 읽힌다; claim 정리를 늦춰도 회수된 자격의 읽기와 쓰기가 거절된다 | ticket·claim 모델이 남는지 정해지지 않았다. 정해야 할 것: claim 개념이 남는지, 남으면 연결 회수가 claim을 푸는지 |
| connection R9 | candidate | coding-agent | 자격을 잃었거나 범위를 바꾸려면 사람이 기존 연결을 회수하고 새 연결을 만든다. 인증이 실패해도 사람 자격으로 대신하거나 회수한 연결을 자동으로 다시 발급하지 않고 재연결을 안내한다. | 인증 실패를 일으켜도 새 자격 발급이나 사람 자격 사용이 일어나지 않는다; 실패 응답에 사람이 다시 연결하라는 안내가 있다 | |
| connection R10 | candidate | coding-agent | coding agent의 파일 접근은 연결된 앱 source 폴더 안으로 제한하며, 실제 경로(symlink를 푼 뒤)로 검사하고 앱 운영 data와 앱 DB로의 직접 접근을 거절한다. | source처럼 보이는 data symlink와 다른 앱의 source 경로 요청이 거절된다; API, MCP, CLI 응답에 앱 운영 data 경로가 담기지 않는다 | |
| connection R11 | candidate | coding-agent | 대상 앱은 명시한 선택, 앱 환경 설정, 현재 작업 폴더의 blueprint 순으로 찾고, 찾은 결과가 연결의 범위를 넓히지 않는다. | 세 방법으로 각각 같은 앱을 찾는다; 범위 밖 앱을 명시해도 접근이 거절된다 | |
| connection R12 | drop-dup | | | | harnesses R6, R7, R8a(설치 대상·ownership·보존)와 connection R2b(설치 실패가 자격을 바꾸지 않음) |
| connection R13 | drop-dup | | | | harnesses R10(네 loading 관측)과 harnesses R3(관측을 따로 둠) |
| connection R14 | drop-dup | | | | harnesses R6(고른 대상에만 적용)과 harnesses R10(override·trust·workspace loading 관측) |
| connection R15 | candidate | coding-agent | MCP server와 CLI는 daemon을 명시한 주소 옵션, daemon 주소 환경 설정, 현재 daemon의 연결 정보, 설치 설정, 기본 loopback port 7431 순으로 찾는다. | 각 설정을 다르게 두어 우선순위대로 고른다; 주소 설정이 없으면 port 7431로 간다 | 두 통로에 걸리므로 부모 |
| connection R16 | candidate | coding-agent-mcp | 패키지로 설치된 MCP server는 설치된 코드, 설정, cache만으로 시작하고 시작할 때 내려받기나 원격 코드에 의존하지 않는다. | 네트워크를 끈 cache-only 실행에서 초기화와 tool 발견이 성공한다 | |
| connection R17a | drop-dup | | | | req-0406(lophn이 만든 token 원문은 보호 저장소 밖에 남지 않음) |
| connection R17b | candidate | coding-agent | MCP server와 CLI는 시작할 때 연결 참조로 OS keychain에서 자격을 받고, keychain이 잠겼거나 자격이 없으면 사용 불가로 끝난다. | keychain을 잠그면 평문 파일이나 사람 자격으로 넘어가지 않고 사용 불가 이유가 나온다; 설정과 wrapper에는 연결 참조만 담겨 있다 | secrets의 keychain 불가 요구(req-0410, req-0411)는 secret 일반이고 이 줄은 coding agent 통로의 시작 규칙이다 |
| connection R17c | ask | | lophn이 터미널 탭에서 연 coding agent에는 자격 원문 대신 연결 참조만 넘기고, 그 아래에서 시작하는 MCP server와 CLI가 같은 방법으로 자격을 받는다. | 터미널 탭에서 연 세션의 환경과 출력에 자격 원문이 없다; 그 세션의 MCP와 CLI가 keychain에서 자격을 받아 성공한다 | 터미널 탭에서 coding agent를 여는 시작 동작이 ticket에 묶이는지 정해지지 않았다(sessions R1b). 정해야 할 것: 시작 동작의 모양 |
| connection R18 | ask | | 외부 세션의 취소와 claim 상실은 현재 ticket 재조회 결과나 연결 회수에 따른 인증 거절로 확인하며, lophn이 외부 파일 편집이나 process 종료를 통제한다고 표시하지 않는다. | 취소나 claim 상실 뒤 허용된 연결로 현재 상태가 읽힌다; 회수된 연결은 새 읽기와 쓰기가 거절되고 옛 claim으로 한 쓰기가 성공으로 보이지 않는다 | ticket·claim 모델이 남는지 정해지지 않았다. 정해야 할 것: claim이 남는지, 취소를 어떻게 알리는지 |

## harnesses

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| harnesses R1 | candidate | coding-agent | lophn은 일곱 제품(Claude Code, Codex, OpenCode, Gemini CLI, Hermes, pi, OpenClaw) 각각의 감지, 버전, 인증 확인, MCP·skill·지침·hook 설치, TUI 실행 계약을 검증한 version별 catalog로 가진다. | 제품마다 지원, 미지원, 미검증 capability와 검증한 version을 읽을 수 있다; 미확인 기능이 지원으로 나오지 않는다 | |
| harnesses R2a | candidate | coding-agent-harness-api | 감지는 PATH와 제품 catalog가 정한 유한한 대체 위치만 읽는다. | PATH 밖의 정해진 대체 위치에 있는 실행 파일은 발견된다; 그 밖의 위치는 순회하지 않는다 | |
| harnesses R2b | candidate | coding-agent-harness-api | 재감지는 사람이 요청할 때만 한다. | 화면에 다시 들어오거나 결과가 비거나 timeout이 나도 재감지와 설치가 자동으로 실행되지 않는다; 사람이 요청하면 재감지가 돈다 | |
| harnesses R3 | candidate | coding-agent-harness-api | 실행 파일 발견, 버전 확인, 인증 확인, 설치 파일 상태, 실제 loading, session 상태는 각각 따로 관측해 보이고, 관측 실패, timeout, 미지원 검사를 부재나 성공으로 바꾸지 않는다. | 실행 파일을 찾은 뒤 버전 timeout, 인증 미확인, loading 실패가 서로 구별된다; session 근거가 없으면 session 상태는 알 수 없음으로 남는다 | 설정 쪽 요구(settings R31)에서 넘어온 "감지 결과는 확인한 사실로 따로 둠"도 이 줄이 덮는다 |
| harnesses R4 | candidate | coding-agent-harness-api | 감지, 설치, 시작은 이 컴퓨터의 native 환경만 대상으로 하고, 관측과 receipt는 실행 환경과 profile마다 따로 둔다. | 다른 실행 환경(WSL, 원격) 요청은 지원하지 않는다는 안내로 끝난다; 다른 profile의 실행 파일과 설치 결과가 재사용되지 않는다 | |
| harnesses R5a | candidate | coding-agent-harness-api | 기본 harness는 사람이 고른 값이고, 고른 값이 사라지거나 실행할 수 없게 돼도 다른 제품으로 자동 교체하지 않는다. | 저장한 선택이 사라지거나 실행 불가가 되어도 다른 제품이 기본이 되지 않고 다시 고르라는 안내가 나온다 | |
| harnesses R5b | candidate | coding-agent-harness-api | 기본 harness가 비어 있으면 설치가 확인된 실행 가능한 후보가 하나일 때 그 후보를 제안하고 여럿이면 사람이 고르게 한다. | 후보가 하나면 제안이 나오고 여럿이면 선택을 묻는다; 후보가 없으면 연결 안내가 나온다 | |
| harnesses R6 | candidate | coding-agent-harness-api | 설치, 갱신, 제거는 사람이 고른 harness, native 환경, profile, 사용자 또는 앱 범위의 정확한 대상에만 적용한다. | 제품 둘이 감지되어도 고른 하나만 바뀐다; 연결 자격으로 임의 경로 설치나 다른 profile 설정 읽기·쓰기를 청하면 거절된다 | |
| harnesses R7 | candidate | coding-agent-harness-api | 갱신과 제거는 receipt에 적힌 소유 resource가 마지막으로 쓴 hash와 현재 값이 같을 때만 하고, 사람이 고친 것, 같은 이름의 비관리 resource, 바깥을 가리키는 symlink, 깨진 설정은 그대로 두고 충돌로 돌려준다. | 사람이 고친 resource는 덮거나 지워지지 않고 충돌로 나온다; 읽은 뒤 동시에 바뀐 파일은 무변경과 충돌로 끝난다; 정상 관리 resource만 갱신과 제거가 된다 | |
| harnesses R8a | candidate | coding-agent-harness-api | 설정 merge는 lophn 소유 항목만 바꾸고 기존 server, 환경, permission, trust, hook, 지침을 보존한다. | 일곱 adapter 각각에서 기존 설정을 둔 채 설치하면 lophn 항목 밖의 값이 그대로다; 같은 이름의 key는 교체되지 않고 차이로 표시된다 | |
| harnesses R8b | candidate | coding-agent-harness-api | 사람이 Codex를 고르면 사용자 config에 receipt와 함께 lophn 항목만 설치하고, 사람이 고친 그 파일은 덮지 않고 충돌로 남긴다. | Codex를 고른 연결에서 사용자 config에 lophn 항목과 receipt가 생긴다; 사람이 고친 hash는 무변경과 충돌로 남고 신뢰 범위는 넓어지지 않는다 | guides R18과 같은 내용이라 이 줄 하나로 둔다 |
| harnesses R9 | candidate | coding-agent-harness-api | 설치 결과는 resource마다 변경, 무변경, 건너뜀, 충돌, 실패와 receipt 보관 결과를 돌려주고, 일부 실패를 전체 성공이나 여러 파일의 원자적 성공으로 표시하지 않는다. | 둘째 파일 쓰기나 receipt 저장이 실패해도 이미 쓴 파일과 보존한 파일이 구별된다; 복구는 hash를 다시 확인하고 무조건 재설치하지 않는다 | |
| harnesses R10 | candidate | coding-agent-harness-api | 설치 검사는 MCP 초기화, tool 발견, skill 이름과 설명 발견, 앱 안내 loading을 각각 성공, 실패, 확인 못함으로 표시한다. | trust 거절, override, 같은 이름 skill, 별도 workspace가 단계마다 안전한 이유로 표시된다; CLI 호출이 성공해도 MCP loading은 성공으로 바뀌지 않는다 | |
| harnesses R11a | candidate | coding-agent-harness-api | 시작 summary를 전달하는 hook과 session 상태를 모으는 hook은 목적, 설치, 관측이 따로이고, summary 조회는 작업 상태의 근거나 permission 허락이 되지 않는다. | summary hook이 있어도 session 상태는 상태 수집 근거가 있을 때만 바뀐다; summary 조회가 permission을 바꾸지 않는다 | |
| harnesses R11b | candidate | coding-agent-harness-api | 검증하지 않은 version에 민감한 event는 hook으로 자동 설치하지 않는다. | catalog에 검증된 capability만 상태 수집에 쓰인다; 미확인 version은 검증된 보수적 부분 집합이나 조각 안내로 끝난다 | |
| harnesses R12 | candidate | coding-agent-harness-api | 감지, 관측, receipt, 실행 계획은 token, 인증 원문, 사용자 설정 원문, 전체 transcript를 보관하거나 돌려주지 않는다. | 인증 probe와 설치 실패 진단에도 안전한 상태와 참조만 담긴다; 자격 원문은 keychain 경계 밖에서 나오지 않는다 | |

## sessions

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| sessions R1a | candidate | coding-agent-harness-api | 사람은 harness를 골라 project 터미널 탭에서 coding agent TUI를 열 수 있고, 자기 터미널에서 직접 시작한 세션도 같은 연결로 이어진다. | 터미널 탭에서 고른 harness 하나의 TUI가 열린다; 자기 터미널에서 시작한 세션이 같은 연결의 MCP로 이어진다; 시작 요청 없이는 coding agent process가 열리지 않는다 | 터미널 탭 그리는 일은 shell. 여기서는 열기 API만 |
| sessions R1b | ask | | 시작은 지정한 ticket과 harness와 방식을 고르는 동작 하나이고, 두 방식 모두 지정한 ticket을 MCP로 claim하고 작업하고 보고하는 흐름으로 이어진다. | 두 방식이 같은 지정 ticket의 claim, 작업, 보고로 이어진다; 문제 발생, ticket 생성, summary 조회만으로 coding agent가 열리지 않는다 | ticket·claim 모델이 남는지 정해지지 않았다. 정해야 할 것: 시작 동작이 ticket을 가리키는지, 아니면 앱을 가리키는지 |
| sessions R2 | candidate | coding-agent-harness-api | 사람이 시작을 누른 것이 시작 허락이고 별도 확인 창은 없으며, 시작은 자격 발급, 범위 확대, 앱 activation, harness 자체의 trust 결정을 대신하지 않는다. | 사람 동작 없이 온 시작 요청은 거절된다; 연결되지 않은 harness를 시작해도 자격이 발급되지 않고 연결 안내가 나온다; harness의 trust 확인은 그 제품에서 사람이 한다 | 시작 단추가 ticket에 있는지는 sessions R1b 결과를 따른다 |
| sessions R3a | candidate | coding-agent-harness-api | TUI는 연결된 앱 source가 속한 등록 project 안에서 사람이 고른 폴더로 열고, source나 project가 없으면 임의 폴더로 열지 않고 연결 안내로 끝난다. | 등록 폴더가 여럿이면 사람이 고른 폴더로 열린다; source나 project가 없으면 TUI가 열리지 않고 연결 안내가 나온다 | |
| sessions R3b | ask | | 첫 prompt에는 지정한 ticket을 읽고 claim하고 작업하고 완료를 보고하라는 지시와 근거를 읽을 곳만 넣는다. | 첫 prompt에 ticket 읽기, claim, 작업, 완료 보고 지시와 근거 읽을 곳이 있다; 첫 prompt에 token, 전체 log, 수리 묶음 내용이 들어가지 않는다 | ticket·claim 모델이 남는지 정해지지 않았다. 정해야 할 것: 첫 prompt가 무엇을 가리키는지(ticket 또는 다른 일 단위) |
| sessions R4 | candidate | coding-agent-harness-api | harness 선택은 사람의 선택과 기본 harness 규칙을 따르고, 실행 직전에 실행 파일, profile, 지원 version, 연결 범위를 다시 확인하며 다른 harness로 자동 대체하지 않는다. | 실행 파일이 옮겨졌거나 연결이 회수됐거나 다른 profile이면 안전한 다음 행동 안내로 끝난다; 자동 재감지, 재발급, 다른 harness 실행이 일어나지 않는다 | 옛 요구가 함께 확인하던 ticket 현재 상태는 sessions R1b·R9 쪽 |
| sessions R5 | candidate | coding-agent-harness-api | 첫 prompt는 검증된 실행 adapter로 한 번만 전달하고, 준비 신호를 확인하지 못했거나 전달 결과를 모르면 자동으로 다시 보내거나 다시 시작하지 않는다. | 공백, 줄바꿈, shell 문자가 분리 인자나 PTY 입력으로만 들어간다; 준비 timeout이나 응답 유실에서는 알 수 없음 상태와 터미널 확인 안내가 남는다 | |
| sessions R6 | candidate | coding-agent-harness-api | session 상태는 starting, ready, working, waiting_input, ended, unknown 가운데 하나로 관측하고, 실제 process, hook, plugin, extension, 검증된 출력의 근거와 시각, 출처를 붙이며, 관측이 없거나 낡으면 unknown으로 둔다. | hook이 없는 제품과 lophn 재시작 뒤에는 unknown이다; process 종료 근거는 ended로 보이지만 작업 완료나 테스트 통과로 표시되지 않는다 | |
| sessions R7 | candidate | coding-agent-harness-api | 외부 session ID는 harness가 hook, plugin, extension, protocol, session 파일로 실제 알려 준 근거에서만 얻고, 터미널 탭, 연결, lophn agent session의 ID로 대신하지 않는다. | 시작 때 ID가 없으면 없음으로 표시된다; pi의 transcript 경로와 제품 ID가 나뉘고, 검증하지 않은 Hermes·OpenClaw ID는 unknown으로 남는다 | |
| sessions R8 | candidate | coding-agent-harness-api | 자기 터미널에서 시작한 session은 lophn이 시작 허락, process 소유, 첫 prompt 전달을 기록했다고 표시하지 않고, 유효한 자격의 MCP 호출과 명시한 근거만 연결한다. | 연결과 작업 폴더가 같아도 session을 추측해 합치지 않는다; 근거가 없는 외부 session의 상태, 종료, 재개는 unknown이다 | |
| sessions R9 | ask | | 시작 접수, process 시작, session 준비, claim, 작업 보고는 서로 다른 사실이고, session 시작이나 working 관측이 claim의 생성, 갱신, 반납, 완료 판정을 바꾸지 않는다. | 두 session이 같은 ticket을 두고 시작해도 claim 하나만 성공한다; ended, unknown, 무호출로 claim이 자동 해제되거나 연장되지 않는다 | ticket·claim 모델이 남는지 정해지지 않았다. 정해야 할 것: claim이 남는지와 session 관측과의 관계 |
| sessions R10 | candidate | coding-agent-harness-api | lophn을 다시 시작하거나 실행에 실패한 뒤의 새 TUI는 사람이 다시 고를 때만 열고, 기존 process와 첫 prompt 전달 결과를 확인하지 못하면 unknown으로 둔다. | 재시작 뒤 자동 실행이나 prompt 재전송이 없다; 관측 복구가 자동 재시작 없이 따로 이루어진다 | |

## guides

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| guides R1 | candidate | coding-agent | 앱 제작과 앱 수리 두 절차를 Agent Skills로 제공하고, 처음에는 이름과 설명만 발견하게 한다. | 두 절차를 skill로 찾을 수 있다; 시작 입력에 skill 본문이 모두 복사되지 않고 고른 skill만 추가로 읽힌다 | skill 수는 정해 두지 않는다 |
| guides R2 | candidate | coding-agent | 배포 skill은 YAML frontmatter와 UTF-8 Markdown이며 이름은 소문자 영문, 숫자, 단일 하이픈으로 1~64자, 설명은 비어 있지 않은 1~1,024자, 본문은 500줄 미만이고 배포 전에 검사한다. | 최대 길이, 한 글자 초과, 연속 하이픈, 이름과 디렉터리 불일치, 빈 설명, 500줄 본문을 넣은 배포는 거절된다 | |
| guides R3a | candidate | coding-agent | skill의 부가 metadata는 문자열에서 문자열로의 map만 허용하고, 보조 자료는 본문에서 직접 가리키는 한 단계 상대 참조로만 제공한다. | 배열, 중첩 map, 문자열이 아닌 값, package 밖 참조, 참조의 재참조가 배포 검사에서 거절된다; metadata를 해석하지 않아도 본문에서 필요한 통로를 찾는다 | |
| guides R3b | drop-detail | | | | tool 설명을 "짧게" 유지한다는 기준이 판정할 수 없는 말이고, 절차를 skill 본문에 둔다는 것은 guides R1이 덮는다 |
| guides R4 | candidate | coding-agent | skill은 고른 제품의 skill root 바로 아래 skill별 디렉터리에 본문과 보조 자료를 함께 설치하고, 바깥 symlink나 여러 단계의 디렉터리 발견에 기대지 않는다. | 원본을 치워도 root 안의 본문과 보조 자료가 읽힌다; root 밖을 가리키는 참조는 배포 검사에서 거절된다 | |
| guides R5a | drop-dup | | | | harnesses R1(제품별 skill 위치·trust catalog)과 harnesses R7(같은 이름 자원 보존) |
| guides R5b | candidate | coding-agent | pi에서는 별도 실행 script 없이 MCP tool이 직접 호출된다. | pi 세션에서 script 없이 lophn MCP tool이 호출되고 결과가 돌아온다 | |
| guides R6 | drop-removed | | | | 옛 파일에 이 번호는 없고 "버린 것"에 탐색 안내(R6)가 있다(removed.md 1: coding agent의 앱 밖 tool) |
| guides R7 | drop-removed | | | | 옛 파일에 이 번호는 없고 "버린 것"에 문서 저장 안내(R7)가 있다(removed.md 1: coding agent의 앱 밖 tool) |
| guides R8a | candidate | coding-agent | 앱 제작 안내는 설치된 SDK와 재사용할 재료 찾기, 필요하면 전체 범위 연결의 앱 등록, source 연결과 템플릿, blueprint 먼저 수정, 구현, 실제 테스트, preview, release 준비, 결과 반환의 순서를 따른다. | SDK 탐색이 구현보다 앞에 나온다; 앱 하나 범위 연결은 등록 대신 이미 등록된 앱을 쓴다; 앱 test가 실패하면 release 준비를 시도하지 않는다 | |
| guides R8b | ask | | 앱 제작 안내는 구현에 앞서 지정한 ticket을 읽고 claim하고, ticket에 적힌 유지할 제약과 볼 곳을 읽게 한다. | claim 전에는 구현에 들어가지 않는다; ticket의 제약과 볼 곳을 읽은 흔적이 안내 순서에 있다 | ticket·claim 모델이 남는지 정해지지 않았다. 정해야 할 것: 제작 일의 시작 단위 |
| guides R9a | candidate | coding-agent | 앱 수리 안내는 수리 대상의 근거 읽기, 수정, 실제 테스트와 preview, release 준비, 결과 반환의 순서를 따르고, 탐색만 요청받으면 임의로 수리에 착수하지 않는다. | 지정한 일을 다시 고르라고 묻지 않고 진행한다; 탐색만 요청한 경우 수정이 시작되지 않는다 | |
| guides R9b | ask | | 앱 수리 안내는 사람이 지정한 ticket을 읽고 claim하며, 수리 묶음을 읽고, 필요한 근거를 추가로 조회하고, release 준비 전에 현재 claim을 다시 확인한다. | claim을 잃은 뒤에는 release 준비와 보고를 하지 않는다; 수리 묶음과 추가 근거 조회가 안내 순서에 있다 | ticket·claim 모델과 수리 묶음(repair-context)이 남는지 정해지지 않았다. 정해야 할 것: claim 재확인과 수리 묶음이 새 모델에 있는지 |
| guides R10 | ask | | 사람이 직접 제작이나 수리를 요청해도 검사할 수 있는 ticket으로 정리한 뒤 claim하고 작업하고 보고하며, ticket 없이는 code 작업을 시작하지 않는다. | 직접 요청 예제에도 ticket 생성 근거, claim, 보고가 있다; 필요한 채택 답이나 재현 기준이 없으면 ticket이 만들어지지 않고 다음 행동 안내가 나온다 | ticket·claim 모델이 남는지 정해지지 않았다. 정해야 할 것: 사람의 직접 요청이 일 단위(ticket)를 거치는지 |
| guides R11 | candidate | coding-agent | 제작과 수리 안내는 문제 코드 선언, 보고, 예외 수집, 피드백 연결과 원래 증상 테스트를 포함하게 하고, 기존 fixture와 업무 제약을 보존하며 선언 삭제나 기대값 완화로 문제를 숨기지 않게 한다. | 안내의 확인 목록에 문제 코드 선언·보고·예외 수집·피드백 연결과 원래 증상 테스트가 있다; 선언 삭제나 조건 완화 사례를 정상 수리로 안내하지 않는다 | |
| guides R12 | candidate | coding-agent | 결과 안내는 완료 주장, preview, 실제 test 결과, release 준비, activation, 문제 닫힘을 구별하고 실행한 확인과 실행하지 않은 것, 한계를 보고하게 한다. | 테스트 실패, 테스트 미실행, 승인 대기 예제에서 실제 결과와 한계가 보고에 나온다; 보고가 test 결과나 문제 닫힘을 대신 만들지 않는다 | |
| guides R13 | candidate | coding-agent | 앱 공통 안내는 앱 root의 Markdown 정본 하나로 두고, 제품마다 그 정본을 읽게 한다(Codex, pi, OpenCode, Hermes는 직접, Claude Code는 얇은 import 안내, Gemini CLI는 기존 안내 목록을 보존한 추가 참조). | 정본을 고치면 새 session에 반영된다; Claude Code의 기존 안내와 Gemini CLI의 기존 목록이 보존된다; 제품별 loading은 따로 검사된다 | |
| guides R14 | candidate | coding-agent | 앱 공통 안내는 lophn 앱 설명, 필요한 skill, 설계와 blueprint와 구현과 machine 생성물의 구별, 수정 주의, SDK 확인, 문제 보고, 테스트, preview, 결과 반환만 담는다. | 안내에 위 항목과 생성물 수정 주의가 있다; 일의 본문, 수리 묶음 전체, 역할 판단 값은 담기지 않는다 | 옛 요구가 함께 담던 시작 summary와 지시 claim 항목은 guides R22 쪽 ask |
| guides R15 | candidate | coding-agent-harness-api | 공통 안내 갱신은 짝이 맞는 lophn 관리 구간 하나의 안쪽만 바꾸고 바깥의 사람 내용은 바이트 그대로 보존하며, 경계가 없거나 중복이거나 불완전하거나 짝이 맞지 않으면 무변경과 복구 안내로 끝난다. | 앞뒤 사람 문장이 갱신을 두 번 해도 같다; 각 경계 오류에서 파일이 바뀌지 않는다 | |
| guides R16 | candidate | coding-agent-harness-api | 안내 갱신은 읽은 파일과 현재 파일이 다르면 덮지 않고, 임시 파일의 원자적 교체로 반영한다. | 읽은 뒤 사람이 고친 파일은 충돌 안내와 무변경으로 끝난다; 교체가 중단돼도 불완전한 본문이 남지 않는다 | harnesses R7이 동시 변경 보존을 덮지만 원자적 교체는 이 줄만의 보장 |
| guides R17 | candidate | coding-agent | 앱 템플릿과 도구 재배포는 MCP 설정, skill, CLI wrapper, 공통 안내, 제품별 얇은 안내를 제공하고 앱 code, 사람이 쓴 안내, 다른 MCP 설정은 건드리지 않는다. | 같은 배포를 두 번 해도 중복이 생기지 않는다; 설치 경로가 바뀐 뒤 재배포해도 앱 code와 기존 설정이 그대로다 | 템플릿 소유가 apps인지는 sdk 묶음에서 미룬 문제와 같다. 도구 재배포는 coding-agent로 둔다 |
| guides R18 | drop-dup | | | | harnesses R8b(Codex는 사용자 config에 receipt와 함께 설치) |
| guides R19 | defer-other | app-releases | 운영 release 묶음에는 coding agent 배포 안내, skill, hook, CLI wrapper, MCP 설정이 들지 않고, 개발용 통로는 source에만 있다. | | release 구성은 app-releases 몫. local hook 설정을 ignore 안내에 넣는 부분은 구현 세부 |
| guides R20a | candidate | coding-agent | 배포 skill과 앱 템플릿은 version과 content hash로 고정하고, 같은 version의 내용 변경은 배포 검사에서 거절한다. | 같은 version의 내용을 바꾸면 검사가 실패한다; 새 version으로 내면 통과한다 | |
| guides R20b | defer-other | install-and-update | 배포 skill은 lophn binary와 함께 서명되고 설치된다. | | 서명과 설치는 install-and-update 몫(이번 범위 밖). catalog에 요소가 없다 |
| guides R21a | candidate | coding-agent | 시작 summary는 요청할 때 연결 범위 안의 현재 열린 문제를 요약하고, 전체 본문, log, 첨부는 담지 않으며 각 항목에서 상세 조회로 이어진다. | 범위 밖 자료가 summary에 없다; 항목마다 상세 조회가 된다; summary를 읽는 것만으로 수리에 착수하지 않는다 | |
| guides R21b | ask | | 시작 summary는 열린 ticket, 현재 claim의 기한과 읽을 곳, 완료 보고 뒤 남은 검사 조건도 요약한다. | summary에 ticket과 claim 기한이 있고 각각 상세 조회가 된다; summary를 읽어도 claim 생성이나 갱신이 일어나지 않는다 | ticket·claim 모델이 남는지 정해지지 않았다 |
| guides R22 | ask | | 시작 summary와 제작·수리 skill은 사람이 자기 터미널에서 지시하거나 시작 동작의 첫 prompt가 지정한 ticket만 claim하고, 목록 발견과 summary 읽기는 착수 지시가 아님을 밝힌다. | ticket이 생긴 뒤 summary만 읽으면 작업이 시작되지 않는다; 사람이 특정 ticket을 지시하면 다시 고르라고 묻지 않는다 | ticket·claim 모델이 남는지 정해지지 않았다 |
| guides R23a | candidate | coding-agent | Claude Code의 시작, 재개, 초기화 hook은 현재 작업 앱의 warning 이상이고 coding agent가 맡는 열린 문제를 10줄과 1,200자 이하로 보여 주고, 문제는 최대 3개 뒤 나머지 수와 상세 읽기 방법을 안내한다. | 4개 이상의 문제를 넣어도 상한을 지키고 3개 뒤 나머지 수가 나온다; info 문제와 사람이 처리할 문제는 요약에 들지 않는다 | |
| guides R23b | ask | | 같은 hook 요약은 열린 ticket도 담고, 끝에 사람의 수리 지시 전에는 착수하지 말라는 안내를 붙인다. | ticket을 넣어도 10줄과 1,200자 상한을 지킨다; 끝에 착수 전 지시를 기다리라는 안내가 있다 | ticket·claim 모델이 남는지 정해지지 않았다 |
| guides R24 | candidate | coding-agent | Claude Code 시작 hook은 전체 timeout 5초, daemon 대기 3초로 제한하고, daemon 장애나 요약할 것이 없는 경우에는 빈 출력과 종료 값 0으로 끝나 세션 시작을 막지 않는다. | hook 명령을 직접 실행해 요약, 마지막 안내, 빈 출력 계약을 검사한다; timeout과 daemon 장애에서도 종료 값이 0이다 | |
| guides R25a | candidate | coding-agent | 시작 summary hook은 Claude Code에만 두고, 다른 여섯 제품에는 명시적 summary 조회 방법을 안내한다. | 다른 hook과 permission이 유지된다; 다른 여섯 제품에서 summary 조회 안내를 찾을 수 있고, 검증된 상태 hook이 있어도 summary 지원으로 표시되지 않는다 | |
| guides R25b | drop-dup | | | | harnesses R11a(summary hook과 상태 수집 hook의 분리), harnesses R8a·R7(설정 보존) |
| guides R26 | candidate | coding-agent | 수리 조사 안내는 접수 내용, 당시 앱 정의, 호출 기록, 증거와 누락, 원인 가설, 변경안, 재현과 검증, 결론 제안 순서로 사실과 해석을 나누어 찾게 한다. | 조사 예제에서 당시 고정 근거와 현재 가설이 구별된다 | 수리 묶음(repair-context)을 가리키던 부분은 guides R9b ask에 있다 |
| guides R27a | drop-removed | | | | 문서, context, 용어, series를 읽거나 저장하라는 안내는 coding agent의 앱 밖 tool과 context 통로(removed.md 1) |
| guides R27b | candidate | coding-agent-mcp | 앱 제작·수리 skill과 공통 안내가 가리키는 모든 lophn tool은 MCP tool 발견에서 찾을 수 있다. | skill과 공통 안내 본문에 나오는 tool 이름마다 MCP tool 발견 결과에 있다 | |

## 개수

| 판정 | 개수 |
|---|---|
| candidate | 60 |
| drop-removed | 3 |
| drop-conflict | 0 |
| drop-dup | 12 |
| drop-detail | 1 |
| defer-other | 3 |
| ask | 13 |

합계 92줄이다(옛 요구 65개를 나눈 줄 포함; guides R6·R7은 옛 파일에 요구가 없고 "버린 것"에만 있어 drop-removed 한 줄씩을 더했다).

candidate의 subject별: coding-agent 32, coding-agent-harness-api 26, coding-agent-mcp 2.
