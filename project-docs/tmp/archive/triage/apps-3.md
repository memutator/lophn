# apps-3 분류표 (permissions, data, automations, agent-context)

## permissions

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| permissions R1 | candidate | app-runtime | 앱의 외부 파일·네트워크·secret 접근은 처음에 모두 닫혀 있고, 앱이 선언만 해서는 열리지 않으며 정확한 앱·종류·범위에 대한 사람의 승인으로만 열린다. | 선언만 한 외부 접근은 거절된다; 같은 범위의 승인이 적용된 뒤에는 허용된다 | |
| permissions R2 | candidate | app-runtime | 앱이 지금 쓸 수 있는 접근은 현재 release의 선언과 현재 유효한 승인의 교집합이다. | 승인은 남아 있지만 새 release가 선언하지 않은 접근은 거절된다; 선언은 있지만 승인 범위 밖인 접근은 거절된다 | |
| permissions R3 | candidate | app-runtime | 같은 범위를 선언한 뒤 release는 기존 승인을 그대로 쓰고, 새 host·port·경로·secret 이름은 새 사람 결정을 받아야 쓴다. | 승인된 host·port는 새 release에서도 추가 결정 없이 연결된다; 새 host·port는 새 승인 전까지 거절된다 | |
| permissions R4 | candidate | app-runtime | 앱의 기본 접근 범위는 자기 bundle 읽기와 자기 data 읽기·쓰기이고, 그 밖의 앱 저장소·source·log·lophn의 credential에는 닿지 않는다. | 운영 중인 앱이 자기 data를 읽고 쓸 수 있다; 같은 앱이 source, 다른 앱의 DB, lophn의 credential에 접근하면 거절된다 | |
| permissions R5 | candidate | app-runtime | 외부 파일의 읽기와 쓰기는 따로 승인하며 실제 절대 경로와 그 하위에만 적용하고, 쓰기 승인은 읽기를 포함하지 않는다. | 쓰기만 승인한 외부 파일을 읽으면 거절된다; 승인한 경로와 이름 앞부분만 같은 다른 폴더에 접근하면 거절된다 | |
| permissions R6 | candidate | app-runtime | 파일 승인의 home 축약·상대 경로·symlink는 승인할 때 실제 절대 경로로 풀어 기준으로 삼고, 폴더 밖을 가리키는 symlink는 승인 화면에서 경고한다. | 폴더 밖으로 향하는 symlink를 포함한 경로를 승인하면 경고가 보인다; 승인 뒤 접근 판정은 풀린 실제 경로로 한다 | |
| permissions R7 | candidate | app-runtime | home 전체, SSH·AWS·GnuPG credential, keychain, lophn의 보호 경로, 그리고 다른 앱의 DB나 source를 품는 넓은 부모 경로는 승인으로도 열 수 없다. | 다른 앱 폴더를 감싸는 부모 경로를 승인하려 하면 거절된다; 민감한 credential 경로를 승인하려 하면 거절된다 | |
| permissions R8 | candidate | app-runtime | 외부 네트워크 접근은 정확한 DNS host 또는 IP와 1부터 65535까지의 port 하나씩만 승인한다. | wildcard·모든 host·port 0·전체 port를 청하면 거절된다; 승인한 host·port로만 연결된다 | |
| permissions R9 | candidate | app-runtime | 앱의 OAuth callback 듣기는 localhost·127.0.0.1·::1의 정해진 host와 port에서만 열린다. | 승인한 localhost port의 callback 듣기가 열린다; 0.0.0.0이나 외부 주소로 듣기를 청하면 거절된다 | |
| permissions R10a | candidate | app-runtime | localhost, 127.0.0.1, ::1은 서로 다른 선언으로 비교한다. | localhost만 승인한 앱이 127.0.0.1로 바꿔 접근하면 거절된다 | |
| permissions R10b | candidate | app-runtime | callback 듣기 승인은 그 앱 화면의 네트워크 권한을 넓히지 않는다. | callback 듣기를 승인한 앱의 화면이 같은 host·port로 연결하면 거절된다 | |
| permissions R11 | candidate | app-runtime | 앱이 닿을 수 있는 모든 loopback host에서 lophn이 쓰는 port로의 연결은 막고, 듣기와 연결 방향을 구별해 강제할 수 없는 요청은 거절한다. | callback port 듣기는 열려도 lophn이 쓰는 port로의 연결은 실패한다; 방향을 구별할 수 없는 요청은 더 넓은 권한으로 바꿔 허용하지 않고 거절된다 | |
| permissions R12 | candidate | app-runtime | 네트워크 선언의 주소와 port는 정해진 순서로 정규화하고, 잘못된 값과 중복 요청은 오류로 거절한다. | 같은 선언을 다른 순서로 적어도 비교 결과가 같다; 중복 주소와 잘못된 값은 거절된다 | |
| permissions R13 | drop-removed | | | | 앱 문서 저장 권한(removed.md 1장 "앱 문서": 앱의 `document.save` 권한) |
| permissions R14 | candidate | app-runtime | 이름별 선언과 사람의 승인이 있는 secret은 호출마다 확인하지 않고 쓰며, 누가 command를 불렀는지(사람 화면, agent, 다른 앱)로 막지 않는다. | 승인된 앱의 command를 사람 화면·agent·다른 앱이 불러도 secret이 붙는다; 승인을 거두면 그다음 사용부터 거절된다 | |
| permissions R15 | drop-dup | | | | core-secrets req-0400(원값은 keychain에만), req-0404(전송 직전에 lophn이 붙임), req-0402(agent는 값을 받지 못함)가 덮는다 |
| permissions R16 | drop-dup | | | | core-secrets req-0404, req-0405(redirect에 인증이 따라가지 않음)가 덮는다 |
| permissions R17 | drop-dup | | | | core-secrets req-0408(교체·삭제 뒤 새 사용은 이전 값을 쓰지 않음), req-0409가 덮는다 |
| permissions R18 | candidate | app-runtime | 앱 process는 prompt, 전체 접근, subprocess, FFI, 시스템 접근, 환경 전체 읽기를 쓸 수 없고, 앱의 DB migration 코드도 같은 경계 안에서 돈다. | 파일 승인이 있어도 subprocess·native code·FFI는 거절된다; migration 코드에서도 같다 | |
| permissions R19 | candidate | app-runtime | 운영 중인 앱 코드의 import는 준비된 상대 코드와 고정된 SDK로 제한하고, 실행 중 원격 import와 의존 내려받기는 일어나지 않는다. | remote·npm·jsr import를 시도하는 앱은 시작에 실패한다; 준비된 상대 코드와 SDK import는 성공한다 | |
| permissions R20 | candidate | app-runtime | 승인이 바뀌면 새 호출을 먼저 막고, 이전 권한으로 돌던 process의 종료를 확인한 뒤 새 범위로 다시 시작하며, 도는 중에는 권한을 넓히지 않는다. | 승인 변경 중 이전 process의 종료가 확인되기 전에는 새 process가 뜨지 않는다; 새 process는 새 범위의 권한만 갖는다 | |
| permissions R21 | candidate | app-runtime | 권한 회수는 요청을 받은 것과 실제로 끝난 것을 구별해 알리고, 이전 process의 종료를 확인하기 전에는 끝난 것으로 표시하지 않는다. | 종료 확인을 지연시키면 회수가 진행 중으로 보인다; 종료가 확인된 뒤에 회수 완료가 된다 | |
| permissions R22 | candidate | app-runtime | 권한 회수는 회수 전에 이미 일어난 업무 쓰기와 외부 요청을 취소한 것으로 다루지 않는다. | 전송한 뒤 권한을 회수해도 그 전송은 일어난 사실로 남는다 | |
| permissions R23 | candidate | app-runtime | 진단과 수리 시험을 돌려도 앱의 권한이나 lophn의 보호 경계는 넓어지지 않는다. | 진단 runner가 다른 앱이나 lophn의 파일을 요청하면 거절된다 | |
| permissions R24 | candidate | app-runtime | 파일 읽기와 네트워크 접근을 함께 청하면 자료가 밖으로 나갈 수 있는 조합임을 승인 request에 드러내고 자동으로 허락하지 않는다. | 두 접근을 함께 청한 request에 조합 경고가 담긴다; 사람의 승인 전에는 두 접근 모두 거절된다 | |
| permissions R25 | drop-detail | | | | 보안 한계를 알리는 문구 성격이라 판정할 보장이 아니다 |
| permissions R26 | candidate | app-runtime | 다른 앱 호출 승인은 부르는 앱, 대상 앱, 정확한 command 목록을 가진 방향 있는 범위로 기록하고, 부르는 앱이 선언한 호출과의 교집합만 쓴다. | A에서 B로 command 두 개를 승인하면 그 둘은 호출된다; 승인에 없는 command, B에서 A로의 호출, A에서 C로의 호출은 거절된다 | |
| permissions R27 | candidate | app-runtime | agent가 앱 command를 부르는 승인은 앱마다 사람이 정확한 command 목록을 열어야 생기고, 앱 사이 호출 승인이나 화면 열기와 따로 기록한다. | 앱을 열거나 앱 사이 호출을 승인해도 agent의 호출은 거절된다; 사람이 따로 승인한 command만 agent가 부를 수 있다 | |
| permissions R28 | candidate | app-runtime | agent가 실제로 부를 수 있는 앱 command는 앱의 agent 승인, 앱이 지금 선언한 command, 그 agent 정의가 허용하는 범위의 교집합이다. | 같은 앱 승인이라도 agent 정의마다 허용된 command만 보인다; 앱이 더는 선언하지 않는 command는 승인이 남아 있어도 호출되지 않는다 | |
| permissions R29 | candidate | app-runtime | 앱 사이 호출 승인이나 agent 승인을 바꾸거나 거두면 그 승인으로 맺은 직접 연결은 쓸 수 없게 되고, 이전 권한의 process 종료를 확인한 뒤에야 적용된 것으로 알린다. | A에서 B로의 승인을 거두는 동안 A의 종료를 확인하지 못하면 진행 중으로 보인다; 완료된 뒤 A가 옛 연결로 부르면 거절된다 | |

## data

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| data R1 | candidate | app-data | 앱 업무 DB는 앱마다 SQLite 파일 하나로 나뉘고, 그 앱의 운영 process나 단독 data 작업 process만 직접 연다. | 앱마다 쓰는 DB 파일이 다르다; core·감독 process·agent는 앱 DB를 직접 열지 않는다 | |
| data R2 | drop-detail | | | | 업무 transaction과 기록 전달의 원자성은 보장하지 않는다는 설명이라 판정할 보장이 아니다 |
| data R3 | candidate | app-data | 앱 DB는 지금 schema 번호와 마지막 migration의 결과를 담고, schema 번호는 0부터 시작할 수 있으며 DB를 쓰지 않는 앱에는 처음 migration이 필요하지 않다. | DB를 쓰지 않는 앱이 schema 0으로 시작한다; DB를 쓰는 앱의 실제 schema 번호와 마지막 변경 결과를 data 작업에서 확인할 수 있다 | |
| data R4 | candidate | app-data | migration은 기존 운영 process의 종료와 업무 쓰기 중지를 확인하고 변경 전 복구본을 확보한 뒤에만 시작한다. | 종료 확인을 지연시키면 migration이 시작되지 않는다; 복구본 확정을 지연시키면 migration이 시작되지 않는다 | |
| data R5 | candidate | app-data | 변경 전 복구본은 WAL에 있는 내용까지 일관되게 담고, 실제 schema와 무결성을 확인한 것만 쓴다. | WAL에 새 항목이 있는 DB의 복구본으로 되돌려도 그 항목이 남는다; DB 본체 파일만 복사한 것은 유효한 복구본으로 받지 않는다 | |
| data R6a | candidate | app-data | migration은 앱 DB에만 쓸 수 있는 격리 process에서 돈다. | migration 코드가 앱 DB 밖 파일이나 네트워크에 접근하면 거절된다 | |
| data R6b | candidate | app-data | migration의 각 단계는 데이터 변경과 schema 번호 갱신을 한 transaction으로 확정한다. | 단계 중간에 실패시키면 데이터 변경과 schema 번호가 함께 되돌아간다 | |
| data R7 | candidate | app-data | 여러 schema 단계를 건너뛰는 migration은 지금 번호부터 목표까지 이어진 단계를 순서대로 적용하고, 중간에 실패하면 변경 전 복구본으로 되돌린다. | 0에서 3으로 가는 migration의 두 번째 단계를 실패시키면 DB가 0의 데이터와 schema로 돌아온다 | |
| data R8 | candidate | app-data | 이미 공개한 migration의 내용은 고칠 수 없고, 새 변경은 새 migration 파일로만 추가한다. | 공개한 migration의 내용을 바꾸려 하면 거절된다; 새 변경은 새 migration으로 다음 release에 담긴다 | |
| data R9 | candidate | app-data | migration 이력에서 출발·도착 schema, 변경 설명, 손실 가능성, 복구본, 실제 적용 결과와 시각을 찾을 수 있다. | 성공한 migration과 실패한 migration을 각각 돌린 뒤 이력에서 바뀐 데이터, 쓴 복구본, 결과를 찾을 수 있다 | |
| data R10a | drop-removed | | | | 복구본 5개 보관(removed.md 1장 "복구본 여러 개 보관") |
| data R10b | candidate | app-data | 진행 중인 migration의 복원에 필요한 복구본은 그 시도가 끝나기 전에 지워지지 않는다. | migration이 진행 중일 때 보존 정리가 돌아도 그 시도가 참조하는 복구본은 남는다 | |
| data R11 | candidate | app-data | 새 업무 통로를 열기 전에 activation이 실패하면 변경 전 복구본으로 되돌리고, 무결성과 schema 확인을 마친 뒤에만 이전 release를 다시 시작한다. | migration을 실패시키면 이전 데이터로 돌아와 이전 release가 쓰인다; 되돌리기에 실패했거나 결과를 확인하지 못하면 앱이 사용할 수 없는 상태로 보인다 | |
| data R12 | candidate | app-data | 새 release가 업무를 받기 시작한 뒤에는 이전 복구본으로 DB를 자동으로 덮어쓰지 않고, 이전 release를 고르는 것만으로 DB나 외부 효과가 되돌아갔다고 보이지 않는다. | activation 뒤 새 항목을 추가하고 이전 release를 골라도 그 항목은 지워지지 않는다; 화면에 DB가 되돌아갔다는 표시가 생기지 않는다 | |
| data R13 | drop-removed | | | | 앱 data export(removed.md 1장 "export 전부": 앱 data export) |
| data R14 | drop-detail | | | | schema 검사 통과를 업무 정확성으로 표시하지 않는다는 표시 원칙이고 판정할 동작이 없다 |

## automations

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| automations R1 | ask | app-runtime | automation은 같은 release의 command 하나와 검사를 통과한 고정 입력을 가리키며, 직접 호출과 같은 command 구현을 쓴다. | 같은 입력으로 직접 호출과 automation을 실행하면 같은 구현이 불린다; 선언하지 않은 command와 잘못된 입력은 거절된다 | automation이 보류 항목(주기 실행)을 뜻하는지, 앱 기능으로 남는지 정해야 한다 |
| automations R2a | ask | app-runtime | 앱의 업무 통로가 열린 때 automation 하나가 한 번 시작된다. | 업무 통로가 열린 앱에서 시작 때 한 번 실행되는 automation이 한 번 불린다; 업무 통로가 닫힌 앱에서는 불리지 않는다 | 계기 중 "시작 때 한 번"은 주기가 아니지만 automation 전체가 남는지에 달려 있다 |
| automations R2b | drop-removed | | | | 일정 간격(최소 60000ms) 계기는 주기 실행(removed.md 2장 "Operator 주기": 주기 실행, 주기 설정) 보류에 기댄다 |
| automations R3 | drop-removed | | | | 간격 시계와 회차 계산은 주기 실행 보류(removed.md 2장) |
| automations R4 | ask | app-runtime | automation은 앱과 실제 data schema가 현재 release로 호출 가능한 때만 시작하고, 시작하지 못하면 그 이유를 읽을 수 있다. | data schema가 맞지 않거나 통로가 닫힌 앱에서는 handler가 불리지 않는다; 시작하지 못한 이유가 보인다 | automation이 남는지에 달려 있다(R1과 같은 결정) |
| automations R5 | drop-removed | | | | 이전 호출이 끝나지 않은 다음 회차를 건너뛰는 규칙은 회차(주기 실행) 보류에 기댄다(removed.md 2장) |
| automations R6 | ask | app-runtime | 서로 다른 automation은 병렬로 돌 수 있고, 전체 automation의 동시 호출 수에는 한도가 있어 넘는 요청은 쌓이지 않는다. | 한도보다 많은 automation이 동시에 시작을 청하면 한도만큼만 시작되고 나머지는 대기열에 쌓이지 않는다 | 동시 한도는 주기 없이도 의미가 있어 automation이 남으면 유효하다 |
| automations R7 | drop-removed | | | | 중단·절전 동안 놓친 회차 처리는 주기 실행 보류에 기댄다(removed.md 2장) |
| automations R8a | ask | app-runtime | automation 호출이 실패해도 자동으로 다시 시도하지 않는다. | 호출을 실패시키면 즉시 다시 실행되거나 재시도 timer가 생기지 않는다 | automation이 남는지에 달려 있다 |
| automations R8b | drop-removed | | | | 다음 정해진 회차에 새 호출을 시작하는 규칙은 주기 실행 보류에 기댄다(removed.md 2장) |
| automations R9 | ask | app-runtime | automation 호출에는 제한 시간이 있고, 시간이 지나면 종료를 요청하되 실제 결과를 모르면 성공이나 미실행으로 표시하지 않는다. | 응답하지 않는 command가 제한 시간을 넘으면 종료 요청과 시간 초과 사실을 찾을 수 있다; 실제 결과를 모르는 호출은 성공이나 미실행으로 보이지 않는다 | automation이 남는지에 달려 있다(제한 시간 값도 사람이 정한다) |
| automations R10 | ask | app-runtime | automation의 선언, 지금 실행할 수 있는지, 실제 호출 관측은 구별해 기록한다. | 선언만 있는 경우, 앱이 꺼졌거나 권한이 없거나 입력 source가 없는 경우, 성공·실패한 호출에서 서로 다른 사실과 그때의 release를 찾을 수 있다 | automation이 남는지에 달려 있다 |
| automations R11 | ask | app-runtime | 기록 전달 실패나 재시작 뒤 결과를 확인하지 못한 일은 automation을 다시 돌릴 근거가 되지 않는다. | 호출 기록 전달을 실패시키고 앱을 다시 시작해도 그 호출의 업무를 자동으로 반복하지 않는다 | automation이 남는지에 달려 있다 |
| automations R12 | ask | app-runtime | 사람이 automation의 동작을 손으로 확인할 때는 현재 command의 직접 호출로 처리하고, 운영인지 preview인지 밝힌다. | 손으로 부른 호출이 automation의 자동 호출로 기록되지 않는다; preview 대상이 없을 때 운영 앱을 대신 부르지 않는다 | automation이 남는지에 달려 있다 |
| automations R13 | ask | app-runtime | 밖으로 효과가 나가는 command도 automation으로 돌릴 수 있고, 사람이 automation을 켤 때 command·고정 입력을 한 번 승인하면 그 automation을 끌 때까지 추가 확인 없이 돈다; 호출마다 확인해야 하는 command는 automation에 연결할 수 없다. | 켜는 승인 전에는 돌지 않고 승인 뒤에는 같은 command·입력으로 추가 확인 없이 돈다; command나 입력을 바꾸거나 껐다 다시 켜면 새 승인을 요구한다; 호출마다 확인이 필요한 command를 automation에 연결하면 거절된다 | automation이 남는지에 달려 있다. 승인 범위에 옛 문장은 주기를 포함했으나 새 요지에서는 뺐다 |

## agent-context

앱이 화면 상태를 agent에게 보여 주는 기능이 남는지 정하지 않았으므로 모두 ask다.

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| agent-context R1 | ask | app-spi | 앱은 화면마다 현재 상태를 돌려주는 read command와 메모를 받는 write command 및 허용된 자리를 선언하고, 선언하지 않은 화면은 agent에게 상태를 보이거나 메모를 받지 않는다. | 선언한 화면의 코드 입력과 지난 시도는 조회된다; 선언하지 않은 화면과 메모 자리는 조회·변경되지 않는다 | 앱이 화면 상태를 agent에게 보여 주는 기능이 남는지 정해야 한다 |
| agent-context R2 | ask | app-runtime | 화면 상태 조회는 현재 앱·release·화면·열린 view와 상태 revision에 묶인 짧은 요약과 추가 자료를 돌려주고, 현재 화면에 연결할 수 없으면 없음 또는 unavailable을 돌려준다. | 같은 앱의 두 탭에서 서로 다른 시도를 열면 각각의 상태가 돌아온다; 탭을 닫은 뒤에는 옛 상태가 최신으로 돌아오지 않는다 | 같은 결정(화면 상태 기능) |
| agent-context R3 | ask | app-runtime | 매 turn에 쓰는 화면 상태 요약은 민감한 칸을 가린 뒤 UTF-8 2KiB 이하이고, 추가 자료는 같은 read command의 조회로만 얻는다. | 큰 코드 입력과 지난 시도가 있어도 요약은 2KiB를 넘지 않는다; 상세는 별도 조회에서만 나온다 | 같은 결정; 2KiB 값도 사람이 정한다 |
| agent-context R4 | ask | app-runtime | 앱이 민감하다고 선언한 칸은 요약·상세·오류 모두에서 내보내기 전에 가리고, redaction 검사에 실패하면 원문 대신 생략했다는 사실만 돌려준다. | 민감한 입력칸의 값이 요약·상세·오류에 담기지 않는다; redaction이 실패해도 원문이 돌아오지 않는다 | 같은 결정 |
| agent-context R5 | ask | app-runtime | 화면 메모 쓰기는 선언된 자리와 조회했던 화면 revision을 입력으로 검사하고, 대상이 닫혔거나 revision이 달라졌으면 충돌로 거절한다. | 조회한 뒤 코드를 바꾸거나 탭을 닫고 메모 쓰기를 청하면 적용되지 않고 현재 화면을 다시 읽도록 안내한다 | 같은 결정 |
| agent-context R6 | ask | app-runtime | 화면 상태 조회와 메모 쓰기는 앱 command를 부르는 같은 통로와 agent의 앱 command 승인을 쓰고, 되돌릴 수 없는 메모 쓰기는 사람의 결정을 기다린다. | 화면을 열어 둔 채 agent의 command 승인을 거두면 조회와 쓰기가 거절된다; 되돌릴 수 없는 메모 쓰기는 사람이 결정하기 전에 적용되지 않는다 | 같은 결정 |

## 개수

| 판정 | 개수 |
|---|---|
| candidate | 37 (app-runtime 25, app-data 12) |
| drop-removed | 8 |
| drop-conflict | 0 |
| drop-dup | 3 |
| drop-detail | 3 |
| defer-other | 0 |
| ask | 16 |
| 합계 | 67 |
