# triage: problems-b (repairs, reporting, snapshots, tests)

옛 파일: `problems/repairs.md`, `problems/reporting.md`, `problems/snapshots.md`, `problems/tests.md`. problems-a(closing, feedback, grouping, problem-codes)의 분류표는 아직 없어서, 겹칠 수 있는 줄은 이유 칸에 적었다.

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| repairs R1a | candidate | problems | 고친 기록은 coding agent만 제출하며, 그 문제의 이전 release와 서로 다른 준비된 release를 가리켜야 한다 | coding agent가 낸 기록이 접수된다; 앱이 대신 내거나, 다른 앱의 release나 준비되지 않은 release를 가리키는 기록은 거절된다 | |
| repairs R1b | candidate | problems | 고친 기록은 이전 release와 고친 release, 공백이 아닌 변경 설명, 인증된 작성자와 시각을 담는다 | 문제 상세에서 두 release, 변경 설명, 작성자, 시각을 읽는다; 공백뿐인 변경 설명은 거절된다 | |
| repairs R2 | candidate | problems | 고친 기록은 고친 release 내용과 일치하는 test result만 가리키고, test result가 없으면 미실행 테스트와 남은 한계를 설명으로 적어 기록한다 | test result가 하나도 없는 기록이 접수된다; 다른 release 내용의 test result를 가리키는 기록은 거절된다; 터미널 테스트 로그는 설명으로만 남고 test result로 읽히지 않는다 | |
| repairs R3a | candidate | problems | 고친 기록은 제출자가 읽은 문제 상태가 아직 유효할 때만 추가된다 | 문제가 바뀐 뒤 옛 상태를 기준으로 낸 기록은 충돌로 거절된다 | |
| repairs R3b | candidate | problems | 재발, 새 수리, 나중에 끝난 test result는 이미 남은 고친 기록을 바꾸지 않는다 | 새 수리와 늦게 끝난 test result가 생긴 뒤에도 이전 기록의 변경 설명과 결과 참조를 그대로 읽는다 | |
| repairs R4a | ask | | | | 수리 작업 항목(repair ticket)과 MCP claim 모델이 새 설계에 남는지 정해야 한다. catalog에 ticket 요소가 없다. 남는다면 "고친 기록은 문제를 포함한 ticket의 유효 claim을 가진 coding agent만 낸다"가 새 요구가 되고, 그 subject(problems 또는 apps 쪽)도 정해야 한다 |
| repairs R4b | drop-detail | | | | ticket 없는 옛 기록을 당시 출처대로 읽는 것은 옛 기록 호환 장치다(AGENTS.md 호환성) |
| repairs R5 | ask | | | | R4a와 같다: ticket claim이 새 설계에 있어야 새 수리 기록의 제출 자격(만료, 반납, 다른 claim 거절)을 요구로 쓸 수 있다 |
| repairs R6 | candidate | problems | 고친 기록을 내는 것만으로는 test result도 문제 닫힘도 생기지 않는다 | 기록을 낸 뒤 test 실행이 시작되지 않고 문제는 닫히지 않는다; release 준비나 coding session 종료만으로 수리가 확인된 것으로 읽히지 않는다 | closing(problems-a)과 겹칠 수 있다. 합칠 때 확인 |
| repairs R7 | candidate | problems | 사람이 설정이나 입력만 고친 문제는 고친 기록과 release 없이 사람 확인으로 닫는다 | 사람이 설정만 고친 문제를 새 release 없이 확인할 수 있다; 그 확인은 코드 테스트 통과로 표시되지 않는다 | closing(problems-a)의 사람 확인과 겹칠 수 있다. 합칠 때 확인 |
| reporting R1a | candidate | problems | 앱이 선언한 problem code의 실패가 발생하면, 그 자리에서 낸 보고가 즉시 접수된다 | 선언한 실패 경로를 일으키면 보고가 바로 접수된다 | |
| reporting R1b | candidate | problems | 앱은 자기 앱의 보고만 낼 수 있다 | 다른 앱 이름으로 낸 보고는 거절된다 | |
| reporting R2a | candidate | problems | 보고는 출처(앱의 보고, lophn이 수집한 예외, 사람 feedback)를 구별해 담는다 | 출처를 위조한 보고는 거절되고, 접수된 보고에는 실제 출처가 읽힌다 | |
| reporting R2b | candidate | problems | 보고는 운영, preview, test 중 어디서 난 것인지와 실제 실행한 release를 담는다 | release가 바뀐 뒤에도 당시 보고의 환경과 실행 release가 읽힌다; release를 알 수 없으면 그 이유가 읽힌다 | |
| reporting R3 | candidate | problems | 유효한 운영 보고는 첫 발생부터 문제로 모인다 | 운영 보고 하나만으로 문제가 만들어져 읽힌다; 두 번째 발생이나 severity를 기다리지 않는다 | grouping(problems-a)과 겹칠 수 있다. 합칠 때 확인 |
| reporting R4 | candidate | problems | preview와 test의 보고는 해당 진단 범위에서만 읽히고, 운영 문제를 만들거나 다시 열지 않는다 | 닫힌 운영 증상을 preview와 test에서 재현해도 운영 문제의 상태와 보고 수가 그대로다 | |
| reporting R5 | candidate | problems | 앱 process와 view의 처리되지 않은 오류, Promise rejection, view 루트 render 오류는 앱이 따로 보고하지 않아도 수집한다 | 세 경우를 각각 일으키면 그 앱에 귀속된 보고가 생기고 원래 실패는 성공으로 바뀌지 않는다 | |
| reporting R6 | candidate | problems | view에서 온 오류의 앱, release, 환경은 인증된 view 연결로 정한다 | 다른 앱 이름을 넣은 view 오류도 실제로 부른 view의 앱 진단으로만 접수된다 | |
| reporting R7 | candidate | problems | 오류 상세(stack, raw code)는 허용된 수리 조회에서만 읽히고 일반 호출 응답에는 실패 설명과 다음 행동만 담긴다 | 실패를 일으킨 호출의 응답에 stack과 raw code가 없다; 허용된 수리 조회에서는 redaction한 상세를 읽는다 | 앱 화면 쪽 문구(tooltip, 접힌 상세)는 shell 몫이라 뺐다 |
| reporting R8a | candidate | problems | 선언하지 않은 problem code나 잘못된 입력의 보고는 접수 오류로 거절하고, 원래 제출마다 잘못된 보고 진단을 최대 하나 남긴다 | 같은 잘못된 제출을 다시 보내면 거절되고 진단은 하나다 | problem-codes(problems-a)와 겹칠 수 있다 |
| reporting R8b | candidate | problems | 잘못된 보고 진단을 남기지 못하면 그 실패는 diagnostics로 가고 다시 보고를 만들지 않는다 | 진단 생성 실패를 주입하면 diagnostics에 남고 새 보고는 생기지 않는다 | |
| reporting R9 | candidate | problems | 같은 발생의 재전송은 처음 낸 인증 주체와 내용이 같으면 같은 접수 결과를 돌려주고, 주체나 내용이 다르면 충돌로 거절한다 | 응답을 잃은 뒤 다시 보내도 보고, snapshot, 문제가 하나씩이다; 글이나 선택 자료를 바꾼 재전송은 충돌한다 | |
| reporting R10 | candidate | problems | 보고, snapshot, 문제 변경은 함께 확정하고 일부만 저장한 상태를 접수 성공으로 돌려주지 않는다 | 저장 중 실패를 주입하면 접수가 실패하고 새 문제나 증거만 따로 읽히지 않는다 | |
| reporting R11a | candidate | problems | 접수한 보고는 합치거나 고치거나 지우지 않는다 | 접수 뒤 같은 문제의 다른 보고가 늘어도 이미 접수한 보고의 내용이 그대로 읽힌다 | |
| reporting R11b | candidate | problems | 서로 다른 발생은 지문이나 시간이 가깝다는 이유만으로 하나로 합치지 않는다 | 같은 시각, 같은 지문의 서로 다른 발생이 각각 남는다 | |
| reporting R12 | candidate | problems | 앱 하나당 60,000ms 동안 새 보고를 최대 20개 접수하고, 같은 발생의 재전송은 그 수에 넣지 않는다 | 21번째 새 보고는 접수되지 않고 손실 이유가 읽힌다; 이미 접수한 보고의 재전송은 건수를 늘리지 않는다 | |
| reporting R13a | candidate | sdk | 보고는 메모리 대기, 전송 실패, 영구 접수 성공을 구별해 알린다 | 접수 실패 뒤 대기 중인 보고가 저장 완료로 표시되지 않는다 | |
| reporting R13b | candidate | sdk | 보고를 다시 보내도 원래 앱 command를 다시 부르지 않는다 | 접수에 실패한 뒤 보고만 재시도되고 원래 호출은 한 번만 실행된다 | |
| reporting R14 | drop-dup | | | | snapshots R4가 항목별 값 또는 누락 이유를 덮는다. 이유 종류(수집 꺼짐, 발생 기회 없음, 기한 내 미수신, 수집 실패)는 snapshots R4 확인에 넣는다 |
| reporting R15 | candidate | problems | 앱의 문제 보고는 lophn의 문제 목록으로 모이고, 허용된 발생, 안전한 상세, snapshot을 거기서 조회할 수 있다 | 보고한 앱에서 문제 목록과 문제 상세로 가서 당시 자료를 읽는다 | |
| reporting R16a | candidate | sdk | SDK의 보고 대기는 앱당 32개, 4,194,304 bytes로 제한한다 | 한도를 넘는 보고는 실패하고 손실 이유가 읽힌다 | |
| reporting R16b | candidate | problems | 보고를 받는 쪽의 대기는 전체 128개, 16,777,216 bytes, 동시 조립 4개로 제한하고, 자동 보고 본문은 262,144 bytes 이하만 받는다 | 각 한도를 넘는 보고는 실패하고 손실 이유가 읽힌다 | |
| reporting R16c | candidate | sdk | 일시적으로 접수되지 않거나 응답을 잃은 보고는 첫 시도 뒤 최대 3번, 250, 1,000, 3,000ms 간격으로 같은 고정 내용만 다시 보낸다 | 최종 실패 뒤 재시도가 멈춘다; 재시도는 같은 내용이고 자료를 다시 조립하지 않는다 | |
| snapshots R1 | candidate | problems | snapshot은 보고 당시의 자료 또는 없는 이유를 보고와 함께 고정하고 나중 자료나 현재 release로 바뀌지 않는다 | 보고 뒤 release, 화면, 로그가 바뀌어도 snapshot은 당시 자료를 보인다; 추가 자료는 새 보고로 남는다 | |
| snapshots R2 | candidate | problems | snapshot의 자료는 출처(사람 진술, 앱의 보고, lophn의 관측)를 구별해 담고, 하나가 다른 사실을 입증한다고 표시하지 않는다 | 같은 자료에서 출처와 수집 시각이 읽힌다; 앱이 화면에 표시했다는 보고만으로 화면 확인됨이나 검증 통과가 표시되지 않는다 | |
| snapshots R3 | candidate | problems | snapshot은 한 시각의 전체 상태가 아니며, 자료마다 수집 시각과 관측 범위를 담는다 | 늦게 얻은 자료는 늦은 수집 시각과 함께 읽힌다 | 원문의 "고정 판 참조만 있을 때" 부분은 문서의 판이면 지운 것이라 뺐다 |
| snapshots R4 | candidate | problems | invocation, 오류, 로그, 화면의 각 항목은 실제 값 또는 공백이 아닌 누락 이유를 담고, 정상적인 빈 목록, 일부 잘림, redaction, source 장애를 구별한다 | 로그 0줄과 로그 수집 실패가 다르게 읽힌다; 수집이 꺼졌거나 발생 기회가 없거나 기한 내 받지 못한 경우도 각각 이유가 읽힌다 | |
| snapshots R5 | candidate | problems | 일부 자료 수집이나 큰 자료 저장이 실패하면 그 항목의 이유를 고정하고 남은 자료와 글은 접수한다; 보고와 snapshot 자체를 저장하지 못하면 접수 실패다 | 이미지 저장 실패에도 글과 실패 이유가 접수된다; 보고 저장 실패는 성공으로 답하지 않는다 | |
| snapshots R6 | candidate | problems | 수집은 허용된 앱과 source 범위만 읽고, 업무 DB, command 원입력, secret, 사람 파일 전체는 수집하지 않는다 | 다른 앱 source나 DB 전체를 넣으려 하면 제외되고 안전한 타입과 길이 형태만 남는다 | |
| snapshots R7 | ask | problems | | | 상세 수집을 끄는 설정이 새 설계에 있는지 정해야 한다. 있다면 "끄면 새 수집만 멈추고 기존 snapshot과 invocation 기록은 그대로다"가 요구가 된다 |
| snapshots R8 | candidate | problems | snapshot은 SDK나 view가 실제로 연결한 invocation만 가리키고, 시각이 비슷한 invocation으로 대신하지 않는다 | 같은 시각의 여러 호출 뒤 연결 정보 없는 오류를 보고하면 임의 연결이 생기지 않는다 | |
| snapshots R9 | candidate | problems | 연결된 invocation의 참조를 알지만 기록이 아직 도착하지 않았으면 참조와 미도착 이유를 보존하고, 다른 호출로 바꾸거나 무기한 기다리지 않는다 | invocation 기록 도착을 늦춰도 접수는 진행되고 알려진 참조와 미도착 이유가 읽힌다 | |
| snapshots R10 | candidate | problems | 오류 자료는 안전한 오류 이름, message, 당시 release 기준의 상대 source 위치를 담고, redaction한 stack은 최대 16,384 bytes만 보존한다 | 16,384 bytes를 넘는 stack은 잘리고 이유가 읽힌다; 일반 호출자에게는 stack이 돌아가지 않는다 | |
| snapshots R11 | candidate | problems | process 오류의 위치는 당시 release의 상대 source로, 화면 오류의 위치는 그 release의 source map으로 원래 TSX 파일과 줄을 찾는다 | source map이 있는 화면 오류는 원래 TSX 위치로 읽힌다; source map이나 앱 frame이 없으면 위치를 추측하지 않고 이유를 보인다 | |
| snapshots R12 | candidate | problems | snapshot의 기본 로그는 알려진 invocation으로 좁힌 최근 최대 30줄이며 실제 범위, 수집 시각, 잘림을 함께 담는다 | 긴 invocation 로그를 보고하면 최근 30줄과 잘림이 읽힌다; invocation과 연결되지 않은 로그는 앱 로그 조각으로 표시된다 | |
| snapshots R13 | candidate | problems | snapshot에 고정한 로그 조각은 앱의 임시 로그 buffer와 따로 남는다 | 임시 로그 buffer를 비운 뒤에도 기존 snapshot의 로그가 그대로 읽힌다 | |
| snapshots R14 | drop-detail | | | | 잘린 로그로 전체 실패율을 계산하지 않는다는 문장은 없는 기능에 대한 부정문이다(README 2장). 로그 조각의 범위 표시는 snapshots R12가 맡는다 |
| snapshots R15 | candidate | problems | 화면 자료는 사람이 고른 당시의 안전한 상태와 PNG만 snapshot에 담고, 선택 안 함, 화면 없음, 숨김, 수집 실패는 그 이유로 남긴다 | 화면이 없는 automation의 보고와 보호 화면이 떠 있는 feedback은 화면 없음 또는 수집 불가 이유를 보인다 | feedback(problems-a)과 겹칠 수 있다. 이미지 크기와 선택은 feedback 몫 |
| snapshots R16 | candidate | problems | snapshot의 큰 자료는 앱 data와 분리해 불변 내용으로 보존하고, 앱이 직접 읽지 못한다 | 앱 process에서 snapshot 첨부를 직접 읽을 수 없고, 허용된 진단 조회로만 읽힌다 | |
| snapshots R17a | candidate | problems | snapshot의 큰 자료(첨부 이미지, 로그 조각, stack)는 용량 상한을 넘으면 오래된 것부터 정리하고 그 부재 이유를 남긴다 | 상한을 넘기면 가장 오래된 큰 자료부터 정리되고 부재 이유가 읽힌다 | |
| snapshots R17b | candidate | problems | 고친 기록, 닫힘 결정, 확정된 결과 참조는 영구 보존하며, 문제가 닫혀도 큰 자료의 정리 계기가 되지 않는다 | 큰 자료를 정리한 뒤에도 닫힌 문제의 닫힘 근거, 고친 기록, 결과 참조가 읽힌다 | closing(problems-a)과 겹칠 수 있다 |
| snapshots R18 | drop-dup | | | | snapshots R20(수집 한도)와 R17a(용량 정리)가 덮는다 |
| snapshots R19 | candidate | problems | 저장 공간이 모자라면 기존 자료를 지우지 않고 새 수집을 제한하며, 제한 이유와 가능한 해결을 보여 준다 | 디스크 부족을 주입하면 기존 snapshot이 남고 실패 원인이 읽힌다 | 원문의 해결책 중 내보내기는 지운 것이라 뺐다. 한도 조정 같은 해결책이 남는지는 후속 확인 |
| snapshots R20 | candidate | problems | snapshot 조립은 전체 2,000ms, 오류 frame 32개, 최근 로그 30줄과 65,536 bytes, 큰 자료 준비 총 2,359,296 bytes를 넘지 않고, 넘은 항목은 잘림, timeout, 제외 이유를 고정한다 | 각 상한을 넘긴 수집도 정해진 시간에 끝나고 제외 이유와 남은 자료가 읽힌다; 보고 자체의 저장 실패는 성공으로 표시되지 않는다 | |
| tests R1 | candidate | problems | 실제로 시작한 app test, reproduction test, test command는 1회마다 test runner가 불변 test result를 하나 기록하고, 다른 곳은 그 결과를 참조한다 | 문제 없는 app test와 test command의 결과도 읽힌다; agent, 앱, 테스트 child가 직접 결과를 등록하면 거절된다 | |
| tests R2 | candidate | problems | test result는 테스트한 고정 release 내용, 테스트, 입력, 기대, runner, 환경, 시작과 끝 시각, 종료 이유, 출력, 제외 범위를 담는다 | release 준비 전에도 고정 내용의 결과를 읽는다; 실제 시작·종료나 업무 관측이 없는 결과는 통과 근거로 채택되지 않는다 | |
| tests R3 | candidate | problems | 같은 주체의 같은 요청과 내용은 같은 test 접수와 결과로 이어지고, 내용을 바꾸거나 다시 돌리려면 새 요청으로 남긴다 | 같은 요청을 재시도해도 child가 추가로 시작되지 않는다; 입력을 바꾼 재시도는 충돌한다; 재실행은 새 불변 결과로 읽힌다 | |
| tests R4 | candidate | problems | test result는 통과, 실패, 판정 불가를 구별하고 timeout, 중단, runner 상실, 근거 부족은 통과로 기록하지 않는다; 시작 전 거절에는 결과를 만들지 않는다 | 시작 뒤 timeout과 중단은 판정 불가로 남는다; 시작 전 거절에는 test result가 없다; 기대를 못 채운 테스트은 실패다 | |
| tests R5 | candidate | problems | agent의 완료 보고와 test의 대기, 진행, 통과, 실패, 미확인은 구별해 읽히고, 실제 결과에는 종료 시각과 근거가 있다 | 완료 보고 뒤 test가 실행되지 않았거나 실패하면 통과로 읽히지 않는다; 실제 결과가 있으면 그 종료 시각과 실행 근거를 연다 | |
| tests R6 | defer-other | app-releases | release 준비의 app test는 고정 blueprint를 검증하고 lophn 소유의 필수 검사를 만든 뒤 최소 권한 Deno 테스트를 실제로 돌리며, coding agent가 필수 검사를 바꾸지 못한다 | blueprint와 handler가 어긋나거나 필수 검사를 지우면 실패한다 | 앱 release 준비 검사라 app-releases 쪽 |
| tests R7 | defer-other | app-releases | app test는 선언한 problem code마다 실제 실패 경로 하나 이상과 보고, 예외, feedback, redaction, 권한 거절, 고정 SDK를 검사한다 | 경로 하나를 뺀 fixture는 통과하지 못한다 | 앱 release 준비 검사라 app-releases 쪽 |
| tests R8 | defer-other | app-releases | 앱 DB migration은 빈 DB에 전체 적용한 경우와 이전 release schema에서 새 schema로 적용한 경우를 모두 검사한다 | 두 fixture를 각각 돌려 한쪽이 실패하면 통과하지 못한다 | 앱 release 준비 검사라 app-releases 또는 app-data 쪽 |
| tests R9 | defer-other | app-releases | app test는 read command의 입력 계약과 부작용 없음, automation의 실행 가능 범위, 되돌리기를 지원하는 write의 되돌림을 fixture로 검사한다 | 잘못된 입력, read의 업무 쓰기, grant 없는 접근을 넣으면 실패한다; write는 변경 뒤 되돌리면 원래 상태와 일치한다 | 앱 release 준비 검사라 app-releases 쪽. blueprint, automation, 되돌림이 새 설계에 어떻게 남는지는 그 쪽에서 확인 |
| tests R10 | candidate | problems | reproduction test는 보고된 원래 증상을 이전 release에서 재현하고, 고친 release에서 같은 고정 테스트, 입력, 업무 기대를 확인한다 | 이전 release에서 증상이 확인되고 고친 release에서 기대가 충족될 때만 통과한다; 이전 release도 통과하거나 오류 이름만 같으면 판정 불가다 | |
| tests R11 | candidate | problems | test runner는 원래 problem code나 보고 경로를 지웠는지, 기대를 약화했는지를 고정된 이전·이후 근거로 검사하고, 약화가 있으면 reproduction 통과로 인정하지 않는다 | 보고 경로만 제거하거나 기대를 낮춘 변경은 판정 불가와 약화 이유로 남고 확인됨으로 채택되지 않는다 | |
| tests R12 | candidate | problems | 통과한 test result는 실제로 검사한 고정 기준과 입력의 범위만 보이고, 원래 증상, 변경 후 기대, 인접 불변식 확인은 따로 읽힌다 | 결과에서 세 확인을 각각 읽는다; 외부 효과 사실은 invocation 기록으로 구별된다 | |
| tests R13 | candidate | problems | 테스트 실행은 운영 DB, keychain, 사람 파일, 일반 홈, 실제 외부 서비스에 접근하지 못하고, 고정 source는 읽기만 하며 쓰기는 테스트 폴더와 테스트 DB로 제한한다; Deno 권한은 prompt 없이 테스트 폴더와 고정 대역으로만 허용한다 | 운영 DB, keychain, 홈 접근은 실패하고 fixture DB만 바뀐다; 권한 prompt 없이 테스트이 끝난다; 전체 권한이나 무제한 읽기·쓰기·환경·network를 요청한 실행은 거절된다 | tests R14를 합쳤다 |
| tests R14 | drop-dup | | | | tests R13이 덮는다 |
| tests R15 | candidate | problems | 외부 효과가 있는 reproduction은 replay, stub, sandbox로 확인하고 실계정에 원래 요청을 다시 보내지 않는다 | 외부 효과 fixture에서 실제 서비스 접속이 일어나지 않고 고정 대역의 입력과 출력으로 재현을 확인한다 | |
| tests R16 | candidate | problems | 테스트 실행 방법은 실행 파일과 인자를 나누어 받고 유한한 timeout을 반드시 정하며, shell 문자열 해석과 작업 폴더 밖 접근은 거절한다 | shell 문법, 상위 경로, 폴더 밖 symlink를 넣은 요청은 거절된다; timeout 없는 요청도 거절된다 | tests R19a와 겹친다. 합칠 때 확인 |
| tests R17 | candidate | problems | 시작한 테스트이 끊겨도 실제 실행 근거와 판정 불가를 보존하고, 복구하면서 몰래 다시 돌리거나 낡은 문제의 결과를 버리지 않는다 | runner를 중단하면 결과가 남고 같은 요청이 다시 시작되지 않는다; 문제가 바뀐 뒤 끝난 결과도 보존되고 현재 확인으로 채택할지는 닫기 쪽이 다시 검사한다 | |
| tests R18 | drop-detail | | | | 개발용 fixture 종류(수집·집계, 파일 변환, 외부 연동)의 구성이라 보장이 아니다 |
| tests R19a | candidate | problems | 테스트은 고정된 Deno test 진입점과 lophn harness를 통한 앱 command·화면 fixture로만 시작하고, 그 밖의 실행 파일은 시작 전에 거절한다 | native 실행 파일과 shell 문자열을 넣은 요청은 시작 전 거절된다 | tests R16과 겹친다. 합칠 때 확인 |
| tests R19b | candidate | problems | 테스트의 판정은 stdout의 통과 문구가 아니라 따로 받은 구조화된 관측으로 하며, 관측이 잘못되었거나 빠졌거나 frame당 65,536 bytes, side당 1,048,576 bytes를 넘으면 판정 불가다 | 잘못된, 빠진, 초과한 관측은 통과가 되지 않는다; runner가 실제 lifecycle과 기대 약화 여부를 함께 판정한다 | |
| tests R20a | candidate | problems | 테스트은 실제 실행 동시 2개, 준비 대기 16개, 요청 timeout 최대 300,000ms, side별 안전 출력 1,048,576 bytes로 제한한다 | 한도를 넘는 요청은 시작 전 거절된다; 시작 뒤 timeout은 판정 불가이고, 출력 초과는 계속 비우되 잘림이 남는다 | |
| tests R20b | candidate | problems | 테스트 process는 전체 메모리 536,870,912 bytes, Deno heap 268,435,456 bytes로 제한하고, 전체 process 메모리 경계를 강제할 수 없는 환경에서는 시작 전에 거절한다 | 메모리 경계를 강제할 수 없는 환경의 요청은 시작 전 거절되어 실행도 결과도 없다; 시작 뒤 메모리 초과로 끝나면 판정 불가다 | |
| tests R21 | candidate | problems | 시작 여부를 확인할 수 없는 테스트은 test result를 만들지 않고 요청 조회에 확인 불가를 남기며, 확정되지 않은 결과의 임시 기록은 최대 24시간 유지한 뒤 판정 불가로 확정한다 | 응답을 잃은 뒤 같은 결과를 복구해도 재실행이 없다; 임시 기록을 잃었거나 기한이 지나면 실제 시작한 실행만 판정 불가로 남는다; 작업 폴더를 정리해도 기존 결과는 읽힌다 | |

## 개수

- 합계: 77
- ask: 3
- candidate: 64
- defer-other: 4
- drop-detail: 3
- drop-dup: 3
