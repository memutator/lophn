# coding-3 분류표

옛 파일: coding-agent/tickets, coding-agent/repair-context. 기준: removed.md, terms.md, requirements/README.md.

- ticket에는 catalog 요소가 없어 ticket의 요구는 subject를 `apps`로 둔다. ticket·claim 모델이 남는지는 사람이 정한다(migration-questions 2번). 그 모델에 기대는 보장은 모두 `ask`로 두고, 요지와 확인은 모델이 남는다고 가정해 채웠다.
- 수리 근거를 coding agent에게 넘기는 일은 subject `coding-agent`다. 문제·증거 자체의 뜻은 core-problems.yaml이 맡는다.
- 'repair-context'는 repair-context 파일, 'tickets'는 tickets 파일의 줄이다.

## tickets

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| tickets R1 | ask | apps | ticket은 앱 하나의 구현 또는 수리 둘 중 한 종류다. | 구현 ticket과 수리 ticket은 만들어진다; 앱 둘을 묶은 입력은 거절된다; 두 종류 밖의 종류를 지정한 입력은 거절된다 | ticket 모델 유지 여부 |
| tickets R2 | ask | apps | ticket 입력은 한 줄 제목 1~120자, 무엇과 왜 각각 1~2,000자, acceptance check 1~12개, 고정 근거 1~20개, 볼 곳과 지킬 것 각각 최대 20개 범위를 지키고, 범위를 벗어나거나 필수 칸이 비었거나 근거가 겹치거나 가리킨 대상이 없는 입력은 만들기 전에 거절한다. | 각 상한 값은 통과하고 상한을 하나 넘기면 거절된다; 공백뿐인 필수 칸, 중복 근거, 존재하지 않는 근거를 넣은 입력은 ticket을 만들지 않고 거절된다 | ticket 모델 유지 여부 |
| tickets R28 | ask | apps | ticket은 준비 상태(`needs_confirmation` 또는 `ready`)와 필요한 확인 목록(한 줄 1~200자, 1~12개)을 가지며, ready는 근거와 조건이 모두 채워지고 필요한 확인이 비었을 때만 되고 ready 전환은 한 번뿐이다. | 근거나 조건이 일부만 찬 입력은 `needs_confirmation`으로 만들어진다; ready인데 근거나 조건이 비었거나 필요한 확인이 남은 입력은 거절된다; ready가 된 ticket에 다시 준비 전환을 요청하면 거절된다 | ticket 모델 유지 여부. 옛 줄이 ready 조건에 넣은 "채택한 질문의 답"은 질문 모델이 정해질 때까지 뺐다 |
| tickets R3 | drop-removed | | | | 문서의 판 고정(판 주소로 읽은 판을 ticket에 고정, removed.md 1 "문서의 판과 file-tracking"). 짝으로 묶인 채택 답은 R28 이유 참조 |
| tickets R4a | ask | apps | 수리 ticket은 같은 앱에서 닫히지 않은 문제 1~12개를 묶고, 구현 ticket에는 문제를 묶지 않는다. | 다른 앱의 문제를 섞은 입력, 문제 13개를 넣은 입력, 같은 문제를 두 번 넣은 입력은 거절된다; 구현 ticket에 문제를 묶으려 하면 거절된다; 같은 문제의 수리 ticket 생성을 동시에 둘 요청하면 하나만 성공한다 | ticket 모델 유지 여부 |
| tickets R4b | drop-dup | | | | 문제 하나에 열린 수리 ticket 하나는 req-0155가 덮는다(동시 생성 쪽은 R4a 확인이 맡는다) |
| tickets R5 | ask | apps | 앱 개발과 수리 요청은 사람이 직접 한 요청과 피드백도 같은 입력 검사를 거쳐 ticket이 되며, 담당 agent의 ticket 생성은 사람에게 묻지 않고 만들어지는 즉시 열린 ticket으로 보인다. | 담당 앱의 ticket이 확인 창 없이 만든 즉시 목록에 나온다; ticket을 만들어도 coding agent run이 저절로 시작되지 않는다 | ticket 모델 유지 여부 |
| tickets R6 | ask | apps | ticket의 목표, 본문, 근거, acceptance check, 수리 대상은 만든 뒤 바뀌지 않고, 바꾸려면 사람이 기존 ticket을 취소하고 이전 ticket을 근거로 새 ticket을 만든다. | claim 전과 후 모두 목표를 바꾸는 요청이 거절된다; 새 ticket에서 이전 지시, 취소 이유, 새 지시를 구별해 읽는다 | ticket 모델 유지 여부 |
| tickets R7 | ask | apps | acceptance check는 app test, 실행 가능한 test command, 원래 증상의 reproduction test, 보고한 release의 활성, 연결된 문제 전부의 닫힘, 그리고 reproduction test를 만들 수 없을 때의 사람 확인 중 하나이며 자유 문장 조건은 받지 않는다. | 각 종류를 만들어 검사할 수 있다; 자유 문장 조건은 거절된다; 사람 확인은 "내가 확인함"으로 남고 test result 통과로 세어지지 않는다 | ticket 모델 유지 여부. req-0165, req-0170과 맞물린다 |
| tickets R8 | ask | apps | 구현 ticket은 app test와 실행 가능한 test command를 각각 하나 이상 요구하고, 실제 사용까지 맡길 때만 release 활성 조건을 명시한다. | 필수 test가 빠진 구현 ticket은 거절된다; 활성 조건이 없는 ticket은 승인 대기만으로 완료가 막히지 않는다; 활성 조건이 있으면 실제로 활성인 release와 비교한다 | ticket 모델 유지 여부 |
| tickets R9 | ask | apps | 수리 ticket은 app test, 대상 문제마다의 고정 reproduction test(만들 수 없으면 사람 확인), 연결된 문제 전부의 닫힘을 필수 조건으로 요구한다. | reproduction test도 사람 확인도 없는 수리 ticket은 거절된다; 일부 문제만 통과하면 ticket이 확인됨으로 판정되지 않는다; 사람 확인은 test 통과로 세어지지 않는다 | ticket 모델 유지 여부 |
| tickets R10 | ask | apps | test command 조건은 실행 파일, 분리된 인자, 앱 source 안의 상대 작업 위치, 양의 timeout, 기대 종료 값을 명시해야 하고, shell 문자열 해석이 필요한 값과 앱 source 밖을 가리키는 경로는 거절한다. | 공백이 든 인자가 쪼개지지 않고 그대로 전달된다; 실제 종료 값과 기대 값이 정확히 비교된다; 절대 경로, 외부 symlink, timeout 누락 입력은 거절된다 | ticket 모델 유지 여부. 시작 요청 모양은 req-0195와 겹친다 |
| tickets R11 | ask | apps | coding agent는 사람이 자기 터미널에서 지시하거나 lophn에서 시작한 session의 첫 prompt가 가리킨 ticket을 MCP로 claim하며, ticket 하나의 현재 claim은 하나이고 한 연결은 여러 ticket을 동시에 claim할 수 있고 준비 전 ticket도 claim할 수 있다. | 같은 ticket을 동시에 claim하면 하나만 성공한다; 한 연결이 다른 ticket도 claim할 수 있다; ticket 목록 읽기만으로 claim이 생기지 않는다 | ticket·claim 모델 유지 여부 |
| tickets R12 | ask | apps | claim 기한은 만들거나 마지막으로 명시 갱신한 시각부터 60분(3,600,000ms)이고, 현재 연결만 기한 전에 갱신하거나 반납할 수 있으며, 자료 읽기와 release 준비는 기한을 바꾸지 않는다. | 기한에 정확히 닿은 시각에 옛 갱신이 거절된다; 자료 읽기, 묶음 읽기, release 준비 전후의 기한이 같다; claim 응답에서 기한과 반납 방법을 찾는다 | ticket·claim 모델 유지 여부 |
| tickets R13 | ask | apps | core는 60초마다와 재시작 때 만료되거나 연결이 회수된 claim을 정리하고, ticket을 쓰는 모든 요청과 ticket 근거 release 준비는 그 순간에 claim이 현재 유효하고 기한 안이며 같은 연결의 같은 claim인지 확인한다. | 기한이 막 지난 뒤 정리 전에도 갱신, release 준비, 완료 보고가 거절된다; 같은 연결이 다시 claim한 뒤 옛 claim으로 온 요청은 충돌로 거절된다 | ticket·claim 모델 유지 여부 |
| tickets R14 | ask | apps | claim이 만료, 반납, 연결 회수로 끝나면 ticket은 다시 열린 상태가 되고 이전 완료 보고, 산출물, 고친 기록, test result는 그대로 읽히며, 읽기 실패나 5분 동안 호출이 없다는 이유만으로는 claim을 풀지 않는다. | 5분 동안 호출이 없거나 조회가 일시적으로 실패한 뒤에도 기한이 그대로다; 만료 뒤 새 claim이 가능하다; 과거 결과가 그대로 읽힌다 | ticket·claim 모델 유지 여부 |
| tickets R15 | ask | apps | ticket 근거 release 준비는 현재 유효한 claim을 확인해 그 claim을 release의 출처로 남기고, 완료 보고는 같은 앱의 같은 ticket과 claim이 출처인 release만 받는다. | 다른 앱이나 다른 claim의 release를 연결하려 하면 거절된다; ticket과 release 양쪽에서 출처 claim을 찾을 수 있다 | ticket·claim 모델 유지 여부 |
| tickets R16 | ask | apps | 사람의 직접 제작·수리 요청도 ticket을 만든 뒤 MCP claim, 작업, 완료 보고로 처리한다. | 직접 요청에도 실제 ticket, claim, 완료 보고가 남는다; 근거가 모자라면 담당 agent가 다음 결정을 준비한다 | ticket·claim 모델 유지 여부 |
| tickets R17 | ask | apps | 완료 보고는 만든 release, 변경 내용, 수행한 확인, 하지 못한 확인, 한계, 수리한 문제별 고친 기록, test result 참조를 연결하고, 접수되면 claim이 끝나지만 보고만으로 ticket이 확인됨이 되지는 않는다. | 접수 뒤 그 ticket의 claim이 끝나 있다; 연결된 산출물과 한계가 모두 읽힌다; 검사 전에는 확인됨이 아니다 | ticket·claim 모델 유지 여부. 옛 줄의 "문서 산출물"은 앱 문서(지운 것)라 뺐다 |
| tickets R18 | ask | apps | core는 최신 완료 보고의 release에 대해 모든 acceptance check를 조건별로 검사해 통과, 실패, 미확인과 그 이유, 실제 근거를 보이고, test 근거는 기록된 test result만 가리킨다. | 조건마다 상태, 이유, 근거가 읽힌다; 같은 release 내용의 test result가 각 test 조건에 연결된다; 일반 shell 성공 문장은 통과 근거로 세어지지 않는다; 늦게 도착한 옛 보고의 검사가 최신 상태를 덮지 않는다 | ticket 모델 유지 여부 |
| tickets R19 | ask | apps | ticket은 열림, claim 중, 보고됨, 확인됨, 확인 실패, 취소 여섯 진행 구분 중 하나이며, 최신 보고의 모든 조건 통과는 확인됨, 실제 실패 하나 이상은 확인 실패, 미실행·승인·운영 확인만 남으면 이유와 남은 조건이 붙은 보고됨이다. | 승인 대기와 실제 test 실패가 서로 다른 구분으로 나온다; 확인 실패 ticket은 새 claim을 받을 수 있다; 확인됨과 취소 ticket은 다시 열리지 않는다 | ticket 모델 유지 여부 |
| tickets R20 | ask | apps | core는 재시작 뒤에도 보고된 ticket의 남은 검사를 이어 하고, test result, 문제의 닫힘과 재발, release 활성 상태를 다시 비교해 ticket을 갱신한다. | 검사 도중 재시작해도 결과가 이어진다; 활성 release가 바뀐 뒤 늦게 끝난 검사가 ticket을 확인됨으로 만들지 않는다; 비교에 model 호출이 없다 | ticket 모델 유지 여부 |
| tickets R21 | ask | apps | 수리 ticket의 검사는 문제 쪽이 먼저 판정한 닫힘과 이번 보고의 고친 release 근거를 읽어 판정하고, ticket의 완료 보고, 확인됨, 취소는 문제를 닫지 않는다. | 보고만 내거나 ticket을 취소해도 문제의 진행이 그대로다; 문제 쪽 닫힘 근거가 맞을 때만 해당 조건이 통과한다 | ticket 모델 유지 여부. req-0158, req-0183과 맞물린다 |
| tickets R22a | ask | apps | 사람은 닫히기 전의 ticket을 1~200자 한 줄 사유로 묻지 않고 취소할 수 있다. | 빈 사유와 201자 사유는 거절된다; 유효한 사유로 취소하면 곧바로 적용되고 취소가 완료와 구별되어 읽힌다 | ticket 모델 유지 여부 |
| tickets R22b | drop-removed | | | | App Engineer가 만든 ticket의 revert 취소는 run 단위 revert(removed.md 1). 되돌리기는 agent session이 살아 있는 동안의 session rewind뿐이다 |
| tickets R23 | ask | apps | ticket이 취소되면 옛 claim의 갱신, ticket 근거 release 준비, 완료 보고를 거절하고, 이미 남은 결과와 문제는 그대로 둔다. | 취소 직후 옛 claim의 세 요청이 거절된다; 취소 전의 결과가 그대로 조회된다 | ticket·claim 모델 유지 여부 |
| tickets R24 | ask | apps | 문제의 수리 요청은 담당 agent의 ticket 준비로 이어지고, 사람이 ticket을 지정해 자기 터미널의 coding agent에 지시하거나 lophn에서 시작한 session의 첫 prompt로 전할 때만 claim이 시작된다. | 수리 요청 단추를 누르면 ticket 준비가 이어진다; 지정 ticket 지시와 첫 prompt 각각에서 claim 근거를 찾는다; 우선순위나 요청 표시만으로 coding agent가 시작되지 않고 approval이 자동 생성되지 않는다 | ticket·claim 모델 유지 여부 |
| tickets R25 | ask | apps | 기능 요청으로 판명된 문제는 원문, 기대 기준, 고정 출처를 보존한 채 새 구현 ticket의 근거로 이어지고, ticket의 볼 곳, 지킬 것, claim은 권한을 주지 않는다. | 기능 요청 ticket에서 원문과 이전 문제 근거를 찾는다; claim이나 근거 주소로 다른 앱 data에 접근하거나 임의 코드를 실행하려 하면 거절된다 | ticket 모델 유지 여부 |
| tickets R26 | ask | apps | 사람 화면에서 열린 문제 하나를 골라 수리 ticket을 만들면 제목, 무엇과 왜, 고정 근거, acceptance check를 기존 증상과 근거에서 자동으로 채우고 일반 생성과 같은 검사를 거치며, 만든 ticket은 준비 전 상태로 열린다. | 근거가 갖춰진 문제에서는 양식 입력 없이 필수 검사를 통과한 ticket이 만들어진다; reproduction test를 만들 수 없는 문제는 "내가 확인함" 조건만 생긴다; 근거가 모자란 문제는 ticket을 만들지 않고 다음 행동을 보인다; 새 구현 요청은 담당 App Engineer와의 대화로 이어진다 | ticket 모델 유지 여부. 화면 쪽 규칙이라 subject를 shell로 옮길 수 있다 |
| tickets R27 | ask | apps | ticket은 화면에서 제목, 원래 요청 또는 문제, 지금 결과와 다음 행동을 기본으로 보이고, 여섯 진행 구분은 영어 화면 말로 나오며, claim 기한, 연결 식별자, 전체 조건, 보고와 test 원문은 펼치면 읽힌다. | 여섯 진행 구분이 서로 다른 화면 상태로 보인다; 기한과 연결 ID는 펼쳤을 때 읽힌다; 실제 검사 근거와 남은 조건은 펼쳐서 읽는다 | ticket 모델 유지 여부. 화면 규칙이라 subject를 shell로 옮길 수 있다 |

## repair-context

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| repair-context R1 | candidate | coding-agent | 수리 자료는 요청마다 현재 허용 범위의 정본에서 조립하며, 조립 시각, 증상 관찰 시각, 발생 release, 발생 release의 source 기준 commit을 함께 보인다. | 두 조회 사이에 발생과 release를 바꾸면 둘째 조회가 새 상태와 새 조립 시각을 보인다; source 줄 번호가 발생 release의 commit 기준으로 표시된다 | |
| repair-context R2 | ask | coding-agent | 수리 자료는 ticket에 연결된 여러 문제를 문제별로 구별해 보이고, ticket을 만들기 전의 조사에서는 같은 구성으로 문제 하나를 읽게 한다. | 여러 문제 ticket에서 각 근거가 어느 문제의 것인지 확인된다; ticket 준비 전 조사로 자료를 읽어도 ticket이나 claim이 생기지 않는다; 조사 자료의 코드 작업 시작 안내가 담당 agent의 ticket 준비로 이어진다 | ticket·claim 모델 유지 여부 |
| repair-context R3 | candidate | coding-agent | 수리 자료의 절은 대상과 증상, 사람 말, 볼 곳, 검사 조건, 지킬 것, 발생 근거와 실패 invocation, 대표 발생, 직전 변화, log, 지난 고친 기록, 관련 문제, 첨부, 재현·더 읽기·반환 안내 순서로 나오고, 내용도 누락 사실도 없는 빈 절만 생략한다. | 같은 입력이면 절 순서가 같다; 누락 이유가 있는 절은 이유와 함께 나온다; 반환 안내가 맨 끝에 있다 | 볼 곳, 검사 조건, 지킬 것 절은 ticket 모델에 달려 있다 |
| repair-context R4a | candidate | coding-agent | 수리 자료 머리는 앱, 문제, 상태, 발생 횟수, 처음과 마지막 시각, 발생 release를 6줄 이하로 보인다. | 긴 이름과 여러 발생에서도 6줄 안에 각 항목이 있다 | |
| repair-context R4b | ask | coding-agent | 수리 자료 머리는 문제에 연결된 ticket의 현재 claim 연결을 보인다. | claim이 있는 ticket은 머리에서 연결을 찾는다; claim이 없는 문제의 머리에는 claim 항목이 나오지 않는다 | ticket·claim 모델 유지 여부 |
| repair-context R5a | candidate | coding-agent | 사람에게 보이는 증상 문구는 문제당 1줄·전체 2줄, 사람 원문 excerpt는 전체 5줄·문제당 300자 이내로 보이고, 넘치는 부분은 실제 근거 읽기로 이어진다. | 긴 사람 원문을 넣어도 각 상한이 지켜진다; 원문 전체를 추가 조회로 읽는다 | |
| repair-context R5b | ask | coding-agent | 볼 source와 고정 근거는 기본 묶음에 10줄·최대 5개까지만 담고 나머지는 근거 읽기로 잇는다. | 많은 source를 넣어도 줄 수와 개수 상한이 지켜진다; 나머지를 근거 읽기로 이어 읽는다 | 볼 곳과 고정 근거는 ticket 필드라 ticket 모델 유지 여부에 달려 있다 |
| repair-context R6 | ask | coding-agent | acceptance check와 지킬 것은 각각 8줄·200자 요약으로 보이되 전체 조건과 지킬 것을 읽을 곳을 연결한다. | 조건 12개와 지킬 것 20개에서도 요약 상한이 지켜진다; ticket의 전체 조건을 빠짐없이 읽는다; 문제 닫힘 조건은 문제 쪽 닫힘 근거로 이어진다 | ticket 모델 유지 여부 |
| repair-context R7 | candidate | coding-agent | 대표 발생은 최대 3개·전체 30줄·각 excerpt 400자, 실패 invocation은 15줄 이하로 당시 실패 연산과 근거를 보이고, 대표 보고, snapshot, 당시 invocation 기록으로 이어 읽게 한다. | 긴 stack과 수백 개 발생에서도 각 상한이 지켜진다; 대표 보고와 snapshot과 invocation 기록으로 이어 읽는다 | |
| repair-context R8 | candidate | coding-agent | 직전 변화는 최대 12개·14줄·각 100자, 기본 log는 45줄, 지난 고친 기록은 최신 5개·10줄이다. | 큰 변화 목록, 긴 log, 많은 수리 이력에서 각 상한이 지켜진다; 실제 release, 고친 기록, test result로 이어 읽는다 | |
| repair-context R9 | candidate | coding-agent | 관련 문제는 관계 묶음마다 5줄·전체 10개, 첨부는 40줄·이미지 metadata 20개, 읽기 명령 결과는 명령마다 3행까지 보이고 나머지는 추가 조회로 읽는다. | 많은 관련 문제와 화면 결과에서 각 상한이 지켜진다; 나머지 행과 첨부를 추가 조회로 읽는다; 첨부는 기본 텍스트에서 metadata로 나온다 | |
| repair-context R10a | candidate | coding-agent | 수리 자료 끝의 재현 안내(6줄·500자), 더 읽기 안내(5줄), 반환 안내(4줄)는 실제 동작하는 전체 근거 읽기와 테스트 요청으로 이어지고, coding agent가 문제를 직접 닫도록 안내하지 않는다. | 각 안내가 상한을 지킨다; 안내가 가리키는 읽기와 테스트 요청이 실제로 동작한다; 안내가 제시하는 다음 행동은 읽기, 고친 기록, 테스트 요청이다 | |
| repair-context R10b | ask | coding-agent | 반환 안내는 지금 ticket의 완료 보고로 잇고, ticket 없이 조회한 경우에는 담당 agent의 ticket 준비로 잇는다. | ticket을 지정해 읽은 자료의 반환 안내가 그 ticket의 완료 보고로 이어진다; ticket 없이 읽은 자료의 반환 안내가 담당 agent의 ticket 준비로 이어진다 | ticket·claim 모델 유지 여부 |
| repair-context R11 | candidate | coding-agent | 문제 summary는 문제당 2줄·전체 10줄·1,200자 이하이고, 전체 묶음과 추가 텍스트 페이지는 각각 UTF-8 24 KiB(24,576 bytes)와 300줄을 모두 지킨다. | 다국어 입력과 한 줄짜리 큰 자료에서도 summary와 두 전체 상한이 지켜진다; 한 요청의 모든 문제를 합산해도 상한 안이다; 누락 표시와 이어 읽기 안내도 예산에 들어간다 | |
| repair-context R12 | candidate | coding-agent | 전체 상한을 넘으면 log, 대표 발생 excerpt, 첨부 metadata 순으로 줄이고 줄인 자리마다 잘림, 원래 범위, 실제 추가 읽기를 남기며, 그래도 넘치면 필수 참조와 상태는 두고 나머지를 이어 읽기로 바꾼다. | 큰 log와 여러 문제와 첨부를 넣으면 축소 순서와 누락 위치가 확인된다; 나머지를 이어 읽을 수 있다; 잘린 결과도 Unicode와 JSON 구조가 유효하다 | |
| repair-context R13 | candidate | coding-agent | 대표 발생은 첫 발생, 마지막 발생, 고정 근거가 가장 다른 발생을 중복 없이 최대 3개 고르고, 같은 후보에서는 먼저 접수된 발생을 앞에 두어 같은 자료에서 같은 결과를 낸다. | 같은 발생 자료를 반복 조립해도 대표 순서가 같다; 첫 발생과 마지막 발생이 같으면 한 번만 나온다 | |
| repair-context R14 | candidate | coding-agent | 직전 변화는 첫 발생 7일 전부터 조회 시점까지의 변화 중 첫 발생에 가까운 순서로 최대 12개를 고르고, 같은 거리에서는 먼저 기록된 변화를 앞에 두며, 원인이라고 단정하지 않는다. | 기간 경계와 같은 거리의 변화를 넣어 결정적 순서를 확인한다; 자료에 원인을 확정하는 표현이 나오지 않는다 | |
| repair-context R15 | candidate | coding-agent | 추가 근거는 종류를 지정한 요청에서만 log 200줄, 발생 목록 20개, source diff 300줄, 화면 텍스트 24 KiB까지 페이지로 주고, 넘는 목록과 텍스트는 조건을 유지하는 cursor로 이어 읽게 한다. | 각 상한을 넘는 자료에서 페이지 상한과 다음 cursor가 나온다; 같은 조건으로 이어 읽으면 누락과 중복 없이 보존된 근거를 읽는다 | |
| repair-context R16 | candidate | coding-agent | source diff는 첫 발생 전의 고정 release와 현재 고정 release 사이의 변경 통계와 관련 source 차이를 주고, 보존된 근거가 없으면 그 이유를 표시한다. | 두 release의 통계와 diff가 300줄 안에 나온다; source 보존이 없는 사례에서는 이유와 읽을 수 있는 근거가 나온다 | |
| repair-context R17 | candidate | coding-agent | 이미지는 redaction 뒤 하나당 2 MiB(2,097,152 bytes)까지 주고, 이미지를 받지 못하는 통로에는 허용된 로컬 첨부 열기 참조, 종류, 크기를 알려 CLI로 열게 한다. | 이미지를 받는 MCP와 텍스트 전용 session에서 같은 허용 첨부를 찾는다; 큰 이미지는 크기와 미제공 이유가 나온다; 이미지가 텍스트 상한 안의 base64로 담기지 않는다 | |
| repair-context R18 | candidate | coding-agent | 요약, 전체 묶음, 추가 근거는 같은 문제, 보고, snapshot, release를 가리키며, 자료 없음, 부분 수집, 미검증, redaction, 범위 거절, 잘림을 요약에서도 드러낸다. | 누락과 미검증 근거가 있는 문제는 summary만 읽어도 그 한계가 보인다; 추가 조회 결과가 summary와 다른 사실로 바뀌지 않는다 | |
| repair-context R19 | candidate | coding-agent | 묶음, 추가 페이지, 첨부마다 coding agent 연결의 허용 범위를 검사하고 redaction을 적용하며, 사람 말, 앱 문자열, log 원문은 명시된 data fence 안에 두어 agent의 해석과 구별한다. | 허용 범위 밖의 고정 주소를 요청해도 그 내용이 텍스트, JSON, 이미지 어디에도 나오지 않는다; secret이 섞인 자료는 redaction을 거친 값만 나온다; 인용한 자료 속 지시문은 data fence 안에 있어 해석과 구별된다 | |
| repair-context R20a | candidate | coding-agent | 수리 자료를 읽어도 문제의 상태가 바뀌지 않고, 기본 응답에는 전체 raw log 대신 길이를 제한한 log excerpt를 담는다. | 반복해서 읽기 전후 문제의 상태가 같다; 기본 응답의 log가 상한 안의 excerpt다 | |
| repair-context R20b | ask | coding-agent | 수리 자료를 읽어도 ticket의 상태와 claim 기한이 바뀌지 않는다. | 반복해서 읽기 전후 claim 기한과 ticket 상태가 같다 | ticket·claim 모델 유지 여부 |

## 개수

| 판정 | 개수 |
|---|---|
| candidate | 18 |
| drop-removed | 2 |
| drop-conflict | 0 |
| drop-dup | 1 |
| drop-detail | 0 |
| defer-other | 0 |
| ask | 33 |
| 합계 | 54 |

candidate의 subject별: coding-agent 18.
