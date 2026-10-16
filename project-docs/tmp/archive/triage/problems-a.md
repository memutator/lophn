# triage: problems-a (closing, feedback, grouping, problem-codes)

옛 파일 4개의 요구를 한 줄씩 판정했다. 새 요구 YAML은 쓰지 않았다. subject가 problems가 아닌 candidate는 없다.

공통 확인 사항(여러 줄의 `ask` 이유가 같다): 수리 작업(repair ticket)과 그 claim이 새 설계에 남는지. 남는다면 이 표의 `ask` 중 ticket·claim 줄은 candidate로 바뀐다.

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| closing R1 | candidate | problems | 문제는 reproduction 통과 판정이나 사람의 결정으로만 닫히고, coding agent·lophn agent·앱의 닫기 요청은 거절한다. | coding agent, lophn agent, 앱이 닫기·무시·사람 대신 확인하기를 요청하면 거절되고 문제 상태가 그대로다; reproduction 통과 판정과 사람이 직접 내린 결정은 적용된다 | |
| closing R2 | drop-dup | | | | closing R3 (자동 닫힘의 근거를 reproduction 통과 결과로 한정하면 나열된 신호는 모두 닫지 못한다) |
| closing R3 | candidate | problems | 자동 닫힘의 근거는 reproduction 통과 결과뿐이다. | reproduction 통과 결과가 없을 때 app test 통과, test command 통과, release 활성화, 앱 시작, 앱의 해소 주장, 수리 작업 완료 기록을 차례로 만들어도 문제가 닫히지 않는다; agent가 통과했다고 주장해도 닫히지 않는다 | R2의 나열 신호를 acceptance에 흡수 |
| closing R4 | candidate | problems | 자동 닫힘은 reproduction을 통과한 고친 release가 지금 활성이고, 테스트를 요청한 뒤 같은 문제의 새 운영 보고가 없을 때만 한다. | 활성 release가 고친 release가 아니면 닫히지 않는다; 요청 뒤 새 운영 보고가 하나라도 있으면 닫히지 않는다; 이전 release에서 늦게 도착한 새 보고도 이 판정에 들어간다 | |
| closing R5 | candidate | problems | 자동 닫힘 조건이 모두 맞으면 추가 대기 없이 닫는다. | reproduction 통과, 활성 release, 새 보고 없음이 맞은 직후 24시간을 기다리지 않고 닫힌다 | 낡은 기준 재판정은 closing R14가 맡는다 |
| closing R6 | candidate | problems | 사람의 고쳐짐 확인은 그때 쓰는 release와 본 문제 기준에 묶인 한 번짜리 결정으로 문제를 닫고, reproduction 통과 결과를 새로 만들지 않는다. | 사람이 고쳐졌다고 확인하면 닫힘 근거가 "내가 확인함"으로 남고 test result가 새로 생기지 않는다; 같은 결정을 다시 쓰려 하면 거절된다; release가 바뀐 뒤 그 결정을 적용하려 하면 거절된다 | |
| closing R7 | candidate | problems | "현상이 안 보임" 닫힘은 사람이 현재 release와 마지막 보고를 보고 선택한 경우에만 하고, 특정 코드 변경이 고쳤다고 표시하지 않는다. | 새 보고 없이 72시간이 지나도 문제는 열림이다; 사람이 현상이 안 보임을 선택하면 그 근거로 닫힌다; 이 닫힘은 특정 변경이 고쳤다는 표시를 달지 않는다 | |
| closing R8 | candidate | problems | "더 다루지 않음"과 오탐 판단은 사람이 공백 아닌 한 줄 이유를 남겨 닫고, 수리 성공으로 기록하지 않는다. | 빈 이유나 공백뿐인 이유는 거절된다; 이유를 남기면 닫히고 근거가 수리 확인과 구별되어 남는다; 오탐이면 기대 기준과 판단 이유를 남길 수 있다; 보고가 없다는 사실만으로 고쳐졌다고 기록하지 않는다 | |
| closing R9a | ask | problems | | | repair ticket과 claim을 거쳐야 reproduction 없는 코드 수리도 사람 확인으로 닫을 수 있다는 규칙인데, ticket·claim 모델이 새 설계에 남는지 정해야 한다 |
| closing R9b | drop-dup | | | | closing R6 (사람 확인 닫힘의 구별)와 closing R3 (다른 통과·완료로 확인을 대신하지 않음) |
| closing R10a | candidate | problems | 사람이 "아직입니다"라고 답하면 열린 문제는 닫히지 않고 닫힌 문제는 다시 열린다. | 열린 문제에 아직입니다를 답하면 열림으로 남는다; 닫힌 문제에 답하면 열림으로 돌아간다 | |
| closing R10b | candidate | problems | 같은 release에는 같은 고쳐짐 확인을 다시 요청하지 않는다. | 아직입니다 뒤 같은 release에서 확인 요청이 다시 생기지 않는다; 새로 고친 release나 새 근거가 생기면 확인 요청이 다시 생긴다 | |
| closing R11 | candidate | problems | 닫힌 문제와 같은 분류의 운영 보고가 현재 활성 release에서 들어오면, 경과 기간과 닫힘 이유에 상관없이 같은 문제를 다시 연다. | 닫힌 지 15일 뒤의 재발이 같은 문제를 연다; "더 다루지 않음"으로 닫은 뒤의 재발도 같은 문제를 연다; 이전 닫힘 근거와 고친 기록을 계속 읽을 수 있다 | grouping R10 이 덮는다 |
| closing R12 | candidate | problems | 이전 release에서 늦게 도착한 운영 보고는 기존 문제에 쌓되 현재 release의 재발로 다시 열지 않는다. | 현재 release에서 닫힌 뒤 이전 release의 보고를 접수하면 그 보고는 읽히고 문제는 닫힘으로 남는다 | |
| closing R13a | candidate | problems | 닫힘은 "테스트로 확인됨", "내가 확인함", "현상이 안 보임", "더 다루지 않음" 네 가지 근거로 구별해 기록하고, 확인한 범위와 확인하지 않은 부분, release, 근거를 읽을 수 있다. | 네 가지 닫힘이 각각 다른 근거로 읽힌다; 실행하지 않은 테스트, 확인하지 못한 외부 효과, 발생할 기회가 없었던 경우가 확인된 것으로 채워지지 않는다; 근거에서 닫힌 때의 release를 읽을 수 있다 | |
| closing R13b | defer-other | shell | 닫힌 문제는 기본으로 닫힌 이유와 지금 필요한 주의만 보여 주고, 확인 범위·미확인 부분·release·근거는 펼친 상세에서 보인다. | | 화면 표시(shell) |
| closing R14 | candidate | problems | 닫힘을 적용할 때 최신 문제 기준과 활성 release를 다시 비교하고, 그 뒤 바뀐 보고·release를 낡은 판정으로 덮어쓰지 않는다. | reproduction 결과, 활성화, 새 보고가 동시에 들어와도 낡은 상태를 읽고 보낸 닫기 요청은 충돌로 거절된다; 근거 없는 상태 전이는 거절된다; 기준이나 활성 release가 바뀌면 이전 결과로 닫지 않고 다시 판정한다 | closing R5의 재판정 절반을 흡수 |
| feedback R1a | candidate | problems | 제보는 사람이 직접 낸 것만 접수한다. | 앱과 agent가 사람을 대신해 제보를 내려 하면 거절된다; 사람이 쓴 글은 이후 해석과 별개로 원문 그대로 보존된다 | |
| feedback R1b | candidate | problems | 제보 글은 redaction을 거친 뒤 공백을 뺀 1~500 Unicode 문자일 때만 접수한다. | 빈 글과 공백뿐인 글은 거절된다; 500자는 접수되고 501자는 거절된다; 저장된 글에 비밀값이 남지 않는다 | |
| feedback R2 | candidate | problems | 앱이 성공으로 응답했거나 기대 동작이 따로 선언되지 않은 경우에도, 기대와 실제 결과가 다르다는 제보를 낼 수 있다. | 성공 응답을 받은 집계가 틀렸다는 제보에 기대 값, 실제 값, 기간, 시간대, 출처를 글로 남길 수 있다; 기대 동작이 선언되지 않았다는 이유로 거절되지 않는다 | |
| feedback R3 | candidate | problems | 제보는 사람이 본 표시 결과를 가리키고, 어떤 호출인지 알 수 없으면 모른다고 기록한다. | 조회 결과가 뒤바뀌어 도착해도 제보가 실제로 화면에 표시된 결과를 가리킨다; 연결을 알 수 없는 제보에는 임의의 호출 기록이 붙지 않는다 | 원문의 "고정 문서·데이터 판"과 "automation" 지목은 새 모델에 맞지 않아 뺐다 |
| feedback R4 | candidate | problems | 입력 검사로 command가 시작되지 못한 상태에서 낸 제보는 시작 전 실패로 기록한다. | 입력 검사에 걸려 동작이 막힌 뒤 제보하면 실행 전 실패로 기록된다; 실행되지 않은 호출 기록이 만들어지지 않는다 | |
| feedback R5 | defer-other | shell | [문제 알리기]를 누른 시점의 앱 화면만 캡처하고, 보호된 확인 창이나 dialog가 떠 있거나 앱 화면이 가려진 동안과 다른 창은 캡처하지 않는다. | | shell overlay와 창 구성은 shell 몫 |
| feedback R6a | defer-other | shell | 제출 전에 글, 화면 상태, screenshot을 미리 보고 각각 뺄 수 있다. | | 미리보기 dialog는 shell 몫 |
| feedback R6b | candidate | problems | screenshot은 사람이 미리보기를 보고 고른 뒤에만 저장하고, 고른 이미지는 사람이 본 그대로 저장한다. | 고르기 전에는 screenshot이 저장되지 않는다; 고른 이미지가 가려지지 않은 채 같은 내용으로 저장된다; 글과 화면 상태는 이미지와 따로 제외할 수 있다 | |
| feedback R7 | candidate | problems | 제보에 자동으로 붙는 화면 상태는 화면 이름, 선택한 탭, 경로, 입력 형태로 한정한다. | query 값과 민감한 표시 결과가 있는 화면에서 제보하면 원문 값은 저장되지 않고 위치와 형태만 남는다; 업무 data와 command 입력 원문은 화면 상태에 들어가지 않는다 | |
| feedback R8 | candidate | problems | 첨부 screenshot은 PNG만 받고 2,097,152 bytes 이하, 긴 변 1,600px 이하로 한정한다. | PNG가 아닌 자료는 거절된다; 2MiB를 넘는 이미지는 거절된다; 큰 정상 캡처는 긴 변 1,600px 이하로 줄여 준비된다 | |
| feedback R9 | candidate | problems | 화면 상태는 redaction한 JSON 65,536 bytes 이하, 제보 하나의 전체 전송은 3,145,728 bytes 이하로 한정한다. | 64KiB를 넘는 화면 상태가 거절된다; 3MiB를 넘는 제보 전송이 거절된다; 글과 이미지의 개별 한도도 각각 적용된다 | |
| feedback R10 | candidate | problems | 첨부가 없거나 준비에 실패해도 글은 접수하고, 첨부가 빠진 이유를 남긴다. | 첨부 미선택, 화면 없음, 수집 실패, redaction으로 제외됨, 저장 실패를 각각 일으켜도 글이 접수된다; 저장되지 않은 screenshot은 첨부됨으로 기록되지 않고 빠진 이유가 남는다 | |
| feedback R11 | defer-other | shell | 접수 실패 때 글을 잃지 않도록 이유와 함께 복사할 수 있게 하고, 미제출·접수 대기·접수 완료를 구별해 보여 준다. | | 제출 dialog 동작은 shell 몫 |
| feedback R12 | defer-other | shell | dialog를 취소하면 접수 전 자료를 저장하지 않고, 이미 접수한 제보는 dialog를 닫아도 남는다. | | dialog 동작은 shell 몫 |
| feedback R13 | defer-other | shell | 제보 화면은 기존 문제를 골랐는지를 분명히 보여 주고, 제출한 뒤 묶인 문제로 돌아갈 수 있게 한다. | | 제출 화면 표시는 shell 몫. 묶기 자체는 grouping R6 |
| feedback R14 | candidate | problems | "직접 해 봤지만 안 됩니다"라는 제보는 새 보고로 남고, 무시·오탐 판단이나 수리 확인으로 처리되지 않는다. | 직접 시도 실패 제보가 새 보고로 읽힌다; 이 제보만으로 문제가 닫히거나 오탐으로 바뀌지 않는다 | 닫힘 쪽 구별은 closing R8이 맡는다 |
| grouping R1a | candidate | problems | 문제는 유효한 운영 보고가 최소 하나 있을 때만 존재한다. | 수리 작업이나 원인 가설만 만들면 문제가 생기지 않는다; 운영 보고가 접수되면 문제가 생긴다 | |
| grouping R1b | candidate | problems | 같은 앱의 같은 선언 problem code는 release와 업무 data 대상이 달라도 한 문제로 모은다. | 서로 다른 release와 다른 data 행에서 같은 code로 보고하면 하나의 문제에서 모두 읽힌다 | |
| grouping R2 | candidate | problems | 예외는 오류 이름과, 그 release의 source map으로 찾은 위쪽 앱 source 위치 최대 3개(상대 위치와 함수)로 묶는다. | 같은 함수에서 줄, 열, 업무 message만 다른 예외는 한 문제로 모인다; 위쪽 앱 위치가 다른 오류는 다른 문제가 된다; 절대 경로, SDK frame, runtime frame은 묶는 기준에 들어가지 않는다 | 앞쪽 예외 지문의 SHA-256 같은 구현은 뺐다. grouping R3의 제외 항목을 흡수 |
| grouping R3a | drop-dup | | | | grouping R2 (지문에서 줄·열·경로·message·SDK·runtime frame을 빼는 규칙을 R2의 확인에 포함) |
| grouping R3b | candidate | problems | 앱 source 위치가 없는 예외는 발생마다 별도 문제로 둔다. | 앱 frame이 없는 같은 TypeError 둘이 자동으로 한 문제로 합쳐지지 않는다; source map이 없으면 위치가 불확실하다고 보인다 | |
| grouping R4 | candidate | problems | 잘못된 앱 보고는 안전하게 남길 수 있는 잘못된 code별로 묶고, 안전하게 알 수 없으면 발생마다 따로 둔다. | 같은 안전한 미선언 code 이름은 한 문제로 모인다; redaction 때문에 구별할 수 없는 발생들은 자동으로 합쳐지지 않는다; 안전하지 않은 code 원문은 묶는 기준으로 저장되지 않는다 | |
| grouping R5 | ask | problems | | | 같은 분류로 묶는 것이 같은 원인의 증명이 아님을 문제 상세가 보고(관측)와 원인 가설을 갈라 보인다는 규칙이다. 해석 연결(grouping R13)이 지운 것에 걸려 원인 가설이 문제에 붙는 자리가 새 설계에 남는지 정해야 한다. 안 남으면 drop-detail |
| grouping R6 | candidate | problems | 제보는 사람이 같은 앱의 기존 문제를 직접 고른 경우에만 그 문제에 덧붙이고, 그 밖에는 각각 별도 문제로 만든다. | 같은 앱·같은 화면에서 비슷한 글로 낸 제보 둘은 별도 문제가 된다; 기존 문제를 직접 고른 제보만 그 문제에 연결된다 | |
| grouping R7 | candidate | problems | preview와 test에서 온 진단은 운영 문제의 묶기와 재발 판정에 들어가지 않는다. | preview나 test에서 예외를 보고해도 운영 문제의 상태와 보고 수가 바뀌지 않는다 | |
| grouping R8a | ask | problems | | | 문제 진행이 열림·고치는 중·닫힘 셋이라는 규칙인데, "고치는 중"이 repair ticket의 claim에 달려 있다. ticket·claim 모델이 새 설계에 남는지 정해야 한다 |
| grouping R8b | ask | problems | | | 문제 하나에 열린 repair ticket을 최대 하나만 연결한다는 규칙이다. ticket 모델이 새 설계에 남는지 정해야 한다 |
| grouping R9 | ask | problems | | | "고치는 중"을 열린 repair ticket의 유효한 claim이 있을 때만 보이는 규칙이다. ticket·claim 모델이 새 설계에 남는지 정해야 한다 |
| grouping R10 | drop-dup | | | | closing R11 (기간 제한 없이 같은 문제로 연결·재오픈하고 이전 근거를 보존) |
| grouping R11a | candidate | problems | 문제는 앱과 진행 상태로 찾을 수 있고, 발생 수, 처음과 가장 최근 보고 시각, 보고 당시 release를 읽을 수 있다. | 앱과 진행 상태로 거른 목록에서 최근 발생이 있는 문제를 찾을 수 있다; 문제를 고르면 발생 수와 시각과 release가 실제 보고와 맞게 읽힌다 | |
| grouping R11b | defer-other | shell | 문제 목록은 기본으로 앱·증상·진행·다음에 할 일만 보이고, 발생 수·시각·release 같은 상세는 펼치면 보인다. | | 화면 표시(shell) |
| grouping R12 | defer-other | shell | 앱 카드는 지금 필요한 문제 안내만 보이고, 문제 상세는 진행과 담당과 사람이 할 조치를 먼저 보인다. | | 화면 표시(shell). 담당 표시는 repair ticket·claim 모델 결정(grouping R9)에 달려 있다 |
| grouping R13 | drop-removed | | | | 해석 문서의 고정 판·절 연결: 문서의 판(removed.md 1 "문서의 판과 file-tracking"), 앱 문서(같은 표 "앱 문서"), run 단위 revert로 복원(같은 표 "run 단위 revert") |
| grouping R14a | drop-removed | | | | 해석 변경과 이전 해석 참조 보존: 해석 연결이 지운 것(grouping R13과 같은 줄) |
| grouping R14b | ask | problems | | | repair ticket 상태 갱신이 읽은 문제 기준이 같을 때만 적용된다는 동시성 규칙이다. ticket 모델이 새 설계에 남는지 정해야 한다 |
| problem-codes R1 | candidate | problems | 앱의 예상 실패마다 고유한 problem code를 정하고, code는 2~48자로 소문자 알파벳으로 시작하며 소문자·숫자·underscore만 쓴다. | 1자, 49자, hyphen, 대문자, 중복 이름은 거절된다; 올바른 2자와 48자 이름은 통과한다 | |
| problem-codes R2a | candidate | problems | 예상 실패의 선언은 사람이 겪는 영향을 설명하는 공백 아닌 고정 한 줄을 함께 낸다. | 설명이 비었거나 줄바꿈이나 치환 자리표시자가 들어 있는 선언은 거절된다; 정상 선언은 통과한다 | message key 같은 문구 관리 방식은 shell 몫이라 뺐다 |
| problem-codes R2b | candidate | problems | 예상 실패의 선언은 코드를 고쳐야 하는 일인지 사람이 설정·입력을 조정할 일인지를 함께 낸다. | 고칠 쪽이 없는 선언은 거절된다; 프로필 기록 누락은 코드 수리로, 계정 인증 실패는 사람 조치로 선언할 수 있다 | |
| problem-codes R3 | drop-detail | | | | 선언 작성 규범이라 자동으로 판정할 수 없다. 과거 보고의 의미를 지키는 부분은 problem-codes R4가 덮는다 |
| problem-codes R4 | candidate | problems | 보고에는 보고 당시 release의 선언 문구가 남고, 이후 선언을 바꾸거나 지워도 그 문구가 유지된다. | 새 release에서 선언을 바꾸거나 지운 뒤 이전 보고를 읽어도 당시 문구가 보인다; 당시 선언을 읽을 수 없으면 앱 이름과 확인할 문제가 있다는 안내가 보인다 | |
| problem-codes R5 | candidate | problems | underscore로 시작하는 problem code는 lophn만 쓴다. | 앱이 그런 code를 선언하거나 제출하면 거절된다; 정상 이름은 접수된다 | |
| problem-codes R6 | candidate | problems | 앱이 예상 실패를 하나도 선언하지 않아도 처리되지 않은 process·view 예외, 사람이 낸 제보, 잘못된 앱 보고의 세 분류로 보고할 수 있고, 분류마다 사람이 이해할 고정 문구가 있다. | 선언이 없는 앱에서 세 분류를 각각 일으키면 앱 이름과 해당 고정 문구가 따로 보인다; 앱이 사람의 제보나 lophn의 관측 분류를 대신 제출할 수 없다 | |
| problem-codes R7 | drop-dup | | | | closing R1 (agent와 앱이 문제를 닫지 못함) |
| problem-codes R8 | defer-other | app-releases | 앱은 예상 실패를 선언하지 않아도 process 예외 수집과 저장 전 redaction 경로를 갖추고, 화면이 있으면 view 예외 수집과 제보 경로도 갖춰야 release로 인정된다. | | release 인정 검사는 app-releases 몫이다. problems-b tests가 같은 검사를 덮는지 대조가 필요하다 |
| problem-codes R9 | defer-other | app-releases | 선언한 problem code마다 실제 실패 경로를 거쳐 그 보고가 접수됨을 확인하는 테스트가 최소 하나 있어야 release로 인정된다. | | release 인정 검사는 app-releases 몫이다. problems-b tests와 대조가 필요하다 |
| problem-codes R10 | candidate | problems | 문제 보고 경로를 지운 변경은 reproduction이 통과해도 자동 닫힘의 근거로 쓰지 않는다. | 보고 경로를 지운 변경 뒤 reproduction이 통과해도 문제가 자동으로 닫히지 않는다 | 원문의 "기대 약화"는 자동 판정이 어려워 뺐다. problems-b 쪽에서 같은 판정을 덮는지 확인이 필요하다 |

## 개수

| 판정 | 개수 |
|---|---|
| ask | 6 |
| candidate | 39 |
| defer-other | 10 |
| drop-detail | 1 |
| drop-dup | 5 |
| drop-removed | 2 |
| 합계 | 63 |
