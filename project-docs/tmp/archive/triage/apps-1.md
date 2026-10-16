# apps-1 분류표 (apps/blueprint, registration, releases, preview)

옛 파일 네 개의 옛 요구 하나하나를 판정했다. 새 요구 YAML은 쓰지 않았다. 열린 질문(ticket·claim 모델, 화면 상태 공유, automation)에 걸리는 줄은 `ask`로 두고 요지와 확인을 채웠다.

## blueprint

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| blueprint R1a | candidate | app-spi | 앱 정의는 이름, 한 줄 설명, 화면, command, permission과 그 이유, problem code, 정확한 SDK 의존을 담는다. 화면이 없는 앱은 빈 화면 목록을 가진다. | 화면 없는 앱 정의를 받는다; 항목이 빠지거나 겹치거나 모르는 항목이 있는 정의는 고칠 이유와 함께 거절된다 | |
| blueprint R1b | drop-removed | | | | 남길 문서 선언(removed.md 1 "앱 문서") |
| blueprint R1c | ask | app-spi | 앱 정의는 automation을 선언하고, 선언하지 않은 automation은 만들어지지 않는다. | 선언한 automation은 정의에서 읽히고 정의에 없는 automation은 실행 목록에 생기지 않는다 | 정할 것: automation 선언이 새 모델에 남는지. removed.md 2의 보류에 걸리는 부분이 있는지도 함께 정한다 |
| blueprint R2 | ask | app-spi | 화면과 command의 설명은 결과, 시작 위치, 선택, 예시, 다루는 정보의 종류, 제약을 사람이 읽고 알 수 있게 담는다. | 설명만 읽은 사람이 화면과 command의 쓰임을 말하고, 자료가 없을 때 결과가 무슨 뜻인지 설명한다 | 정할 것: 설명에 반드시 담을 항목과 거절 기준. 지금 문장은 사람 판단이라 기계로 판정할 규칙이 없다. automation을 끄는 방법은 R1c 결정을 따른다 |
| blueprint R3 | candidate | app-releases | 앱 정의의 구조 검사 통과와 실제 test 통과는 서로 다른 근거로 기록되고, 한쪽이 다른 쪽을 대신하지 않는다. | 구조 검사만 마친 앱에는 test 통과 기록이 붙지 않는다; test 통과는 test result로만 남는다 | |
| blueprint R4 | candidate | app-spi | command는 효과(read, write, external) 하나와, 효과와 따로 사람 확인이 필요한지를 선언한다. | external이면서 확인이 필요 없다고 선언한 command는 추가 approval 없이 호출된다; 확인이 필요하다고 선언한 command는 효과와 상관없이 사람 결정을 거친다 | |
| blueprint R5 | candidate | app-spi | 효과가 섞인 command는 external, write, read 순으로 가장 큰 효과를 선언한다. 앱 밖의 상태를 바꾸는 동작(메일·메시지 보내기, 결제, 외부 서비스의 생성·수정·삭제)은 external이고, 바깥에서 가져오기만 하는 요청은 external이 아니다. 가져온 것을 업무 data에 저장하면 write다. | 외부 일정 조회는 read, 가져와 저장하는 동기화는 write, 외부 캘린더에 일정을 만드는 command는 external로 선언된다; read 호출 앞뒤로 업무 data와 외부 대상이 같다 | |
| blueprint R6 | candidate | app-spi | command의 확인 필요 여부는 선언한 값만으로 정해지고 secret을 쓰는지로 바뀌지 않는다. | secret을 쓰는 read나 write command를 확인 불필요로 선언해도 받아들여지고, 호출마다 추가로 묻지 않는다 | |
| blueprint R7a | candidate | app-runtime | command 호출의 효과와 확인 필요 여부는 호출자의 주장이 아니라 고정된 앱 정의의 선언에서 읽는다. | 호출자가 read라고 주장해도 write 선언이 적용된다 | |
| blueprint R7b | candidate | app-runtime | command 입력은 검증, 기본값 적용, 정규화를 거친 뒤 확인과 실행의 기준이 된다. | 기본값을 생략한 입력과 기본값을 적은 입력은 같은 확인 대상으로 판정된다; 사람이 확인한 입력과 실행한 입력이 같다 | |
| blueprint R8 | candidate | app-releases | 앱 정의가 선언한 command의 목록과 실제 등록된 구현의 목록은 정확히 같다. | 구현이 빠지거나 선언에 없는 구현이 있는 앱은 app test에서 실패하고 시작도 실패한다 | |
| blueprint R9 | drop-detail | | | | 선언을 안전성 증명으로 보지 않는다는 서술이라 판정할 관찰이 없다. 실제 접근 제한과 효과 test는 release 준비 검사(releases R5)와 permission 요구가 맡는다 |
| blueprint R10 | candidate | app-spi | command 입력은 object, array, string, integer, number, boolean, null과 enum, 선택 값, 기본값, 길이와 수 범위로 선언할 수 있고 같은 입력은 항상 같은 검사 결과를 낸다. | 필수 값 누락, 타입 오류, 선언하지 않은 속성, 길이나 수 범위 위반은 거절되고 생략한 값은 기본값으로 채워진다 | |
| blueprint R11 | candidate | app-spi | 외부 schema 참조, union, 사용자 정의 format, 실행 코드, 모르는 keyword가 든 입력 schema는 받지 않는다. | 원격 참조나 지원하지 않는 keyword가 있는 정의는 거절되고, 검사 중 network 호출과 앱 code 실행이 일어나지 않는다 | |
| blueprint R12 | ask | app-runtime | 큰 파일, 이미지, 문서 내용은 본문 JSON에 담지 않고 참조로 전달하며, 참조를 열 때 호출자의 읽기 권한을 검사한다. | 참조 주소를 아는 호출자라도 읽기 권한이 없으면 내용을 얻지 못한다 | 정할 것: 큰 내용을 참조로 넘기는 방식이 새 구조에 남는지와 참조가 가리킬 저장소. 지금 문장은 문서의 판 참조를 함께 말해 그대로 쓸 수 없다 |
| blueprint R13 | drop-removed | | | | 앱 place 문서와 그 저장 선언(removed.md 1 "앱 문서", "문서의 판") |
| blueprint R14 | ask | app-spi | automation은 같은 앱 정의의 command와 검증된 고정 입력을 가리키고, 그 command의 구현을 직접 호출과 같이 쓴다. | 같은 입력으로 직접 호출과 automation 실행을 하면 같은 구현이 동작한다 | 정할 것: automation 선언이 남는지(blueprint R1c와 같은 질문) |
| blueprint R15a | candidate | app-spi | 화면과 command는 표시 이름과 따로 정해진 식별자로 가리킨다. | 표시 이름이나 번역만 바꾼 정의에서도 같은 식별자가 같은 command를 가리킨다 | |
| blueprint R15b | drop-dup | | | | releases R17 |
| blueprint R16a | drop-dup | | | | req-0500 (SDK 검사와 lophn의 정의 검사가 같은 기준) |
| blueprint R16b | candidate | app-releases | 앱 정의의 검사와 조회는 model 호출과 외부 network 없이 결정적으로 같은 결과를 낸다. | model과 network를 끈 상태에서 작성, 검사, 조회 결과가 켠 상태와 같다 | |
| blueprint R17 | candidate | app-releases | TypeScript로 쓴 앱 정의는 권한 없는 별도 Deno process에서 최대 10초 동안 값을 뽑고, release에는 정규 JSON을 고정한다. | 파일·network 접근이나 무한 반복을 하는 정의는 거절되거나 10초 안에 중단된다; release에 고정된 정의는 JSON이다 | |
| blueprint R18a | candidate | app-releases | 정규 JSON에서 목록과 object 이름의 순서는 고정이다. | 순서만 다른 두 정의는 같은 정규 JSON이 된다 | |
| blueprint R18b | drop-dup | | | | blueprint R1a (중복·모르는 항목 거절) |
| blueprint R19a | candidate | app-spi | 화면은 제공하는 크기(전체, 패널, 카드)를 하나 이상 선언한다. | 크기를 하나도 선언하지 않은 화면은 거절된다; 크기를 여럿 선언한 화면은 선언한 크기가 모두 읽힌다 | |
| blueprint R19b | defer-other | shell | 화면은 선언한 크기로만 열리고, 패널과 카드로 열린 화면은 좁은 영역에서도 읽고 조작할 수 있다. | | 열기와 배치는 shell 몫 |
| blueprint R20 | candidate | apps | 앱의 command는 앱 정의에서 agent tool 정의로 드러나며, tool 정의는 이름, 설명, 입력 형식, 효과, 확인 필요 여부를 담는다. | 앱 정의만으로 만든 tool 목록에서 command의 목적, 필수 입력, 효과, 확인 필요 여부를 읽고 별도 MCP 설정 없이 호출한다 | |
| blueprint R21 | ask | app-spi | write command는 되돌림 지원 여부를 선언하고, 지원하면 같은 앱의 되돌림 command와 변경에 묶인 되돌림 자료를 돌려주는 계약을 선언한다. | 지원 여부 선언이 없거나 되돌림 command가 없는 선언은 거절된다; 변경 뒤 되돌림을 실행하면 원래 업무 상태로 돌아간다 | 정할 것: 앱 command 수준의 되돌림 계약이 남는지. 되돌리기는 agent session 안의 rewind로만 정했다(removed.md 4 "되돌리기")와 부딪히는지 사람이 판단한다 |
| blueprint R22a | candidate | app-spi | 다른 앱의 command를 쓰려는 앱은 대상 앱과 command를 정의에 선언한다. | 없는 앱이나 command를 가리키는 선언은 거절된다 | |
| blueprint R22b | ask | app-spi | 앱 정의는 화면 상태를 agent에게 보이는 선언(주석 자리 포함)을 담는다. | 대상이나 주석 자리가 잘못된 선언은 거절된다 | 정할 것: 앱이 화면 상태를 agent에게 보여 주는 기능 자체가 남는지(열린 질문) |

## registration

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| registration R1 | candidate | apps | 화면이 없고 사람이 보지 않아도 도는 앱도 등록할 수 있다. | 화면 없는 앱과 화면 있는 앱이 모두 등록되고 조회된다 | |
| registration R2a | candidate | apps | 새 앱은 이름, slug, 한 줄 목적만으로 코드, release, source 없이 등록된다. | source도 release도 없는 앱을 등록하고 조회한다; 이름, slug, 목적 중 하나가 없으면 거절된다 | |
| registration R2b | drop-removed | | | | 기획 문서의 고정 판 참조(removed.md 1 "문서의 판") |
| registration R3a | candidate | apps | 앱 등록은 사람의 요청으로 이뤄지고 lophn agent의 직접 요청은 거절된다. | 사람의 요청은 앱을 만들고 lophn agent가 낸 등록 요청은 거절된다 | |
| registration R3b | ask | apps | 앱 개발에 연결된 coding agent는 연결 범위가 전체일 때만 앱을 등록할 수 있다. | 전체 범위로 연결된 coding agent의 등록은 받아들여지고 앱 하나 범위로 연결된 coding agent의 등록은 거절된다 | 정할 것: 새 연결 모델에서 coding agent가 앱을 등록할 수 있는지와 그 범위 구분 |
| registration R4 | candidate | apps | 사람과 해당 앱 범위를 가진 coding agent는 임의 위치의 git 폴더를 앱의 source로 연결할 수 있다. | lophn 관리 위치 밖의 git 폴더를 연결하면 실제 경로가 앱의 연결 정보로 조회된다 | |
| registration R5 | candidate | apps | source를 연결하거나 바꿔도 운영 bundle, 채택한 release, 업무 data는 바뀌지 않는다. | source를 다시 연결하기 전후로 기존 release hash와 앱 data가 같다 | |
| registration R6 | drop-removed | | | | 앱 place 문서의 주소와 관리 폴더(removed.md 1 "앱 문서", "자리 없는 문서") |
| registration R7 | drop-detail | | | | 등록 입력 화면의 이름 추천 문구 |
| registration R8 | candidate | apps | 사람이 앱을 archive하면 앱의 실행은 허용되지 않는 상태가 되고, 보관을 풀어도 사람이 실행을 다시 허용하기 전에는 시작하지 않는다. | archive 뒤 새 호출은 거절되고 보관을 풀어도 앱은 멈춘 상태로 남는다; 사람이 허용하면 시작한다 | |
| registration R9 | candidate | apps | 앱을 archive해도 release 이력은 남는다. | archive 뒤에도 이전 release를 찾을 수 있다 | 앱 문서 place 부분은 removed.md 1 "앱 문서"로 뺐다 |
| registration R10 | candidate | apps | 앱은 project를 고르지 않고 등록되며 project와 따로 조회된다. | project가 하나도 없는 상태에서 앱을 등록하고 앱 목록에서 찾는다 | |

## releases

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| releases R1a | candidate | app-releases | release는 고정된 git commit의 code, 화면, 앱 정의, 정확한 SDK, permission 요청, data 변경 계약을 바꿀 수 없는 bundle로 고정하고, test 뒤 bundle byte를 바꾸지 않는다. | source와 SDK 최신판을 고친 뒤에도 기존 bundle의 hash와 선언이 그대로다 | |
| releases R1b | candidate | app-releases | release는 준비 근거(test result 참조, 준비한 주체, 시각)를 담고 그 근거는 바뀌지 않는다. | release 하나에서 test result 참조, 준비한 주체, 시각을 읽고 이후에도 값이 같다 | |
| releases R2 | candidate | app-releases | release 준비는 연결된 source 안에서 지정한 commit의 파일만 읽고, symlink 자체, commit에 없는 변경, git 관리 정보, 개발용 credential, agent 도구, 임시 설정을 bundle에 넣지 않는다. | source 밖 경로나 commit에 없는 변경을 내면 거절된다; 만든 bundle에 credential과 symlink가 없다 | |
| releases R3a | candidate | app-releases | release 준비는 준비 도중 원본이 바뀐 것을 감지하면 release를 확정하지 않는다. | 준비 중 source를 바꾸면 release가 만들어지지 않고 실패 이유가 남는다 | |
| releases R3b | candidate | app-releases | release 준비(copy, hash, 정의 검사, 화면 build)는 core process 밖에서 돌고, 준비 중에도 core는 다른 요청에 응답한다. | 준비를 돌리는 동안 core API가 평소처럼 응답한다 | |
| releases R3c | drop-dup | | | | releases R19 (취소와 상한) |
| releases R4 | candidate | app-releases | 화면 build 결과와 external source map은 bundle에 들어가고, 운영 process는 build나 의존 다운로드 없이 그 결과만 쓴다. | 설치 뒤 network 없이 화면이 열린다; 화면 오류 위치를 bundle의 source map으로 원래 source 위치에 잇는다 | |
| releases R5 | candidate | app-releases | release를 준비하려면 test runner가 같은 bundle hash로 실제 돌려 통과한 app test result가 있어야 한다. | release 없이 bundle을 test한 뒤 같은 hash로만 release가 준비된다; byte 하나를 바꾸거나 결과를 직접 제출하면 거절된다 | |
| releases R6 | ask | app-releases | coding 작업의 release 준비는 ticket의 현재 연결, claim 순번, 기한을 요청 때와 확정 때 다시 확인하고, ticket과 당시 claim을 바꿀 수 없는 출처로 남긴다. | 누락, 만료, 반납, 연결 회수, claim 변경은 거절된다; claim을 풀거나 ticket을 취소한 뒤에도 과거 release의 출처는 그대로다 | 정할 것: ticket·claim 모델이 남는지(migration-questions 2번) |
| releases R7 | ask | app-releases | 사람이 자기 터미널에서 맡긴 코드 수리도 ticket과 현재 claim을 거쳐 새 release를 준비한다. | claim 없는 release 준비는 거절된다; 사람 approval에 따른 이전 release 선택에는 새 ticket이 필요하지 않다 | 정할 것: ticket·claim 모델이 남는지. 옛 release를 위한 보충 규칙은 가져오지 않는다 |
| releases R8 | candidate | app-releases | release activation은 정확한 대상 release에 대한 사람 approval이 있어야 하고, ticket 완료나 설계 채택은 그 결정을 대신하지 않는다. | coding agent가 준비한 release도 approval 없이는 활성화되지 않는다; 같은 요청을 다시 보내면 새 결정을 받는다 | |
| releases R9 | candidate | app-releases | activation 전에 사람은 이전 release와 비교한 화면과 command의 입력, 효과, 확인 필요 여부, permission 추가와 축소, data 변경과 손실 가능성을 확인할 수 있다. | 새 필수 입력, external 효과, permission 추가, 데이터를 잃을 수 있는 migration이 각각 비교 내용에 나타난다 | automation 비교는 blueprint R1c 결정을 따른다 |
| releases R10 | candidate | app-releases | 이전 release와의 비교는 입력 schema가 같다는 이유로 호환이라고 표시하지 않는다. 선언한 효과나 확인 필요 여부가 바뀐 release는 검토가 필요한 변경으로 구별한다. | schema는 같고 효과 선언만 바뀐 release가 호환으로 표시되지 않는다; 설명만 바뀐 release는 동작 변경과 구별된다 | |
| releases R11 | drop-dup | | | | releases R9 (비교 근거 조회). permission 재동의는 permissions 묶음이 맡는다 |
| releases R12 | candidate | app-releases | activation은 시작할 때와 확정할 때 현재 release, bundle, grant, 사람의 결정, 실제 data schema가 비교 기준과 같은지 다시 확인한다. | approval 뒤에 grant나 채택된 release가 바뀌면 낡은 activation이 거절된다 | |
| releases R13a | candidate | app-releases | 앱 하나에는 activation이 하나만 진행되고, 그동안 다른 activation과 grant 변경은 거절된다. | activation 두 개와 grant 변경을 동시에 요청하면 하나만 진행되고 나머지는 거절된다 | |
| releases R13b | candidate | app-runtime | 이전 release의 process와 새 release의 process는 같은 업무 DB에 동시에 쓰지 않는다. | activation 중 이전 process가 끝난 뒤에야 새 process가 시작된다 | |
| releases R14 | candidate | app-releases | 필요한 data 변경과 실제 시작 준비 확인을 마친 뒤에만 새 release를 채택하고, 이전 release 대체와 앱 이름·설명 변경을 함께 확정한다. | handler, hash, schema, 직접 연결이 맞지 않으면 현재 release가 바뀌지 않는다; 성공이 확정된 뒤에만 업무 호출이 열린다 | |
| releases R15a | candidate | app-releases | activation이 실패하면 실패 근거를 남기고 이전 활성 release를 그대로 가리킨다. | migration이나 시작 준비가 실패한 뒤에도 이전 release가 활성이고 실패 이유를 읽을 수 있다 | |
| releases R15b | candidate | app-data | activation 뒤에 쓴 업무 data는 activation 전에 만든 복구본으로 자동으로 덮이지 않는다. | activation 뒤에 만든 data가 이전 복구본으로 되돌아가지 않는다 | |
| releases R16 | candidate | app-releases | 사람이 이전 release를 고르는 것도 새 activation으로 처리하고, 현재 data schema와 같은 release만 바로 허용한다. | schema가 다른 옛 release는 바로 활성화되지 않는다; 같은 schema의 옛 release는 approval을 거쳐 활성화된다 | |
| releases R17 | candidate | app-releases | 과거 호출 기록과 test result는 현재 앱 정의가 아니라 당시 release로 해석한다. | command를 지운 새 release 뒤에도 이전 호출은 당시 command의 설명과 대상으로 조회된다 | |
| releases R18 | candidate | app-releases | 열린 problem의 code를 지우거나 선언을 약하게 한 release는 준비할 때 경고를 남기고, 그 삭제를 고친 근거나 문제 닫힘으로 처리하지 않는다. | 열린 problem의 code를 지운 release를 준비하면 경고를 읽을 수 있고 그 problem은 열린 채로 남는다 | |
| releases R19 | candidate | app-releases | release 준비의 기본 상한은 입력 source 64MiB, 완성 bundle 256MiB, 파일 10000개, 전체 300000ms이고, 상한 초과, 취소, worker 종료 때 부분 bundle을 release로 확정하지 않는다. | 상한을 하나씩 넘기는 입력과 준비 중 취소, worker 종료에서 release가 만들어지지 않고 실패 이유가 남는다 | |

## preview

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| preview R1 | candidate | app-runtime | 사람과 coding agent는 activation 없이 완성된 고정 bundle을 별도 preview process로 열어 화면과 command를 써 볼 수 있다. | 준비된 release가 없는 bundle도 preview로 열리고, 현재 활성 release와 운영 호출 통로는 바뀌지 않는다 | |
| preview R2 | candidate | app-runtime | preview는 읽기 전용 bundle과 fixture를 읽고 따로 만든 일회용 SQLite DB와 파일 영역에만 쓰며, 운영 DB를 복사해 오지 않는다. | preview에서 항목과 파일을 바꿔도 운영 data는 그대로이고, preview를 끝내면 임시 data를 버릴 수 있다 | |
| preview R3 | candidate | app-runtime | preview command는 살아 있는 preview process만 부르고, 없으면 사용할 수 없다고 돌려주며 운영 앱으로 대신 부르지 않는다. | preview를 끝낸 뒤 command를 부르면 실패하고 운영 앱의 같은 command는 호출되지 않는다 | |
| preview R4 | candidate | app-runtime | preview는 실제 secret, 외부 쓰기, 다른 앱 조회, 실제 loopback 듣기 권한을 받지 않고, 필요한 효과는 테스트 대역으로만 확인한다. | secret 사용, 외부 전송, 다른 앱 조회를 시도하면 테스트 대역만 동작하고 실제 secret, 외부 대상, 다른 앱은 바뀌지 않는다 | 문서 저장 부분은 removed.md 1 "앱 문서"로 뺐다 |
| preview R5 | candidate | app-runtime | preview에서는 사람 확인이 필요한 command의 실제 handler를 실행하지 않고 approval도 소비하지 않는다. | 확인이 필요한 command를 요청해도 실제 handler와 approval 사용이 진행되지 않고, 대역의 성공이 실제 실행 성공으로 표시되지 않는다 | |
| preview R6 | ask | app-runtime | preview에서는 automation이 스스로 돌지 않고 같은 command를 사람이 부를 때만 handler가 실행된다. | 시작 계기를 가진 automation이 있는 bundle을 preview로 열어도 스스로 실행되지 않고 직접 호출에서만 handler가 돈다 | 정할 것: automation이 남는지와 보류 항목(removed.md 2)을 가리키는지(blueprint R1c와 같은 질문) |
| preview R7a | candidate | app-runtime | preview 화면은 운영 화면과 분리된 view session을 쓴다. | 운영과 preview를 함께 열어도 session이 섞이지 않는다 | |
| preview R7b | candidate | app-runtime | 호출의 응답과 기록은 운영인지 preview인지를 담는다. | preview 호출의 응답과 기록에서 mode가 preview로 읽힌다 | 보고와 test result의 mode 기록은 req-0082가 덮는다 |
| preview R8 | drop-dup | | | | req-0151 |
| preview R9 | candidate | app-runtime | release가 아직 없는 preview의 오류 근거는 bundle을 가리키는 test result와 개발 진단으로 남고, 없는 release나 호출 기록을 만들어 가리키지 않는다. | 준비 전 preview에서 오류가 나면 bundle을 가리키는 근거가 남고 존재하지 않는 release를 가리키는 호출 기록은 없다 | |
| preview R10 | candidate | app-runtime | preview의 성공은 grant, activation approval, 앱 실행 허용을 바꾸지 않는다. | preview만 통과한 앱은 grant나 activation을 얻지 못하고 운영 상태와 운영 data가 그대로다 | |

## 개수

| 판정 | 개수 |
|---|---|
| candidate | 54 |
| drop-removed | 4 |
| drop-conflict | 0 |
| drop-dup | 6 |
| drop-detail | 2 |
| defer-other | 1 |
| ask | 10 |
| 합계 | 77 |

candidate의 subject별: app-releases 23, app-runtime 12, apps 9, app-spi 9, app-data 1.
