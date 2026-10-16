# 분류표: secrets-diagnostics-base

옛 파일: platform/secrets, platform/diagnostics, platform/redaction. redaction은 subject base로 본다.

## secrets

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| secrets R1 | candidate | secrets | API key, OAuth token, password, 개인 키의 원값은 OS keychain에만 두고 lophn의 다른 기록에는 참조만 둔다. | 네 종류 값을 저장한 뒤 lophn의 저장 파일, 설정, process 환경 변수에서 원값, 값의 일부, 길이가 나오지 않는다; 재시작한 뒤에도 keychain에서 읽어 쓸 수 있다. | |
| secrets R2 | candidate | secrets | 사람이 직접 넣는 secret 값은 전용 보호 입력으로만 받는다. | 각 종류 값을 보호 입력에 넣으면 저장된다; agent가 보호 입력을 대신 제출하려 해도 값이 저장되지 않는다. | 대화·질문 답에 붙인 값의 차단은 redaction R4(agent-sessions)가 맡는다 |
| secrets R3 | defer-other | agent-roles | agent는 secret이 필요하면 사람에게 이름, 사용처, 이유만 말하고 값이나 값의 일부를 붙여 넣으라고 하지 않는다. | | role 지침 몫이다 |
| secrets R4a | candidate | secrets | agent는 secret 값을 받지 못하고, 허용된 이름과 설정 여부만 조회한다. | agent가 이름, 값, 값의 일부, 보호 참조를 조회하면 허용된 이름의 설정 여부만 돌아오고 값이나 참조는 돌아오지 않는다. | 무엇이 "허용된 이름"인지는 새 모델에서 정해야 한다(아래 판단 메모) |
| secrets R4b | candidate | secrets | 허용되지 않은 이름과 없는 이름의 조회에는 같은 응답을 준다. | 허용되지 않은 이름과 등록하지 않은 이름을 각각 조회하면 응답이 구별되지 않는다. | |
| secrets R5a | candidate | secrets | 허용된 목적지로 가는 인증 요청에서 secret 원값은 전송 직전에 lophn이 붙이고, 어느 호출자에게도 돌려주지 않는다. | 허용된 목적지에 인증 요청을 보내면 성공한다; 그때 agent의 문맥과 tool 인자, 앱 코드, 환경 변수, 일반 응답에 원값이 나오지 않고 이름만 나온다. | |
| secrets R5b | candidate | secrets | 인증을 붙인 요청이 다른 목적지로 redirect되어도 인증은 따라가지 않는다. | 허용된 목적지가 다른 host로 redirect하는 요청을 보내면 redirect 대상으로 가는 요청에 인증이 붙지 않는다. | |
| secrets R6 | candidate | secrets | secret을 교체하다 실패하면 이전 값이 계속 쓰인다. | keychain 쓰기 실패와 참조 갱신 충돌을 각각 넣으면 교체 전 값으로 계속 인증된다; 실패한 시도가 keychain에 남긴 항목은 정리 대상으로 구별된다. | |
| secrets R7a | candidate | secrets | secret을 교체하거나 지우라고 한 뒤 새로 시작하는 사용은 이전 값을 쓰지 않는다. | 지우기를 요청한 직후(keychain 삭제가 끝나기 전) 새 요청을 보내면 이전 값이 붙지 않고 사용 불가로 끝난다. | |
| secrets R7b | candidate | secrets | 교체·제거가 끝났다는 표시는 keychain 값 삭제와 이전 값을 쓰던 process의 종료가 확인된 뒤에만 한다. | keychain 삭제와 process 종료를 각각 늦추면 완료 표시가 그만큼 늦어진다; 이미 나간 요청을 취소됐다고 표시하지 않는다. | |
| secrets R8a | candidate | secrets | keychain이 없거나 잠겨 있으면 secret이 필요한 기능만 쓸 수 없고, secret이 필요 없는 기능은 계속 쓴다. | keychain이 없는 환경과 잠긴 keychain에서 secret 기능은 사용 불가 이유와 함께 실패하고, 문서와 로컬 앱은 정상으로 동작한다. | |
| secrets R8b | candidate | secrets | keychain을 쓸 수 없을 때 secret 저장을 시도하면 거절하고 값을 다른 곳에 두지 않는다. | keychain을 쓸 수 없는 상태에서 secret 저장을 시도하면 거절되고, 평문 파일이나 암호화 파일이나 환경 변수에 값이 생기지 않는다. | |
| secrets R9 | drop-removed | | | | Secrets export·import(removed.md 1장 backup) |
| secrets R10 | defer-other | app-runtime | 앱의 secret 사용은 앱에 준 현재 허락 범위로 판단하고, 부른 쪽이 사람 화면, agent, 자동화, 다른 앱 중 무엇인지로 막지 않는다. | | 앱 허락 모델 몫 |
| secrets R11 | defer-other | models | provider 로그인과 갱신 결과는 신뢰한 전송 adapter의 보호 경계에서만 만들고, 현재 참조와 맞는 새 참조만 확정하며, 원값을 agent나 tool에 돌려주지 않는다. | | provider 연결 몫(models) |
| secrets R12 | defer-other | coding-agent | coding agent 연결용 credential은 앱 secret과 다른 용도로 keychain에 두고, 연결을 거두면 새 사용이 바로 막힌다. | | coding agent 연결 몫 |

## diagnostics

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| diagnostics R1 | candidate | diagnostics | lophn 내부, SDK, desktop의 오류는 앱을 쓰던 중에 났어도 앱 문제로 돌리지 않고 lophn 자체의 진단으로 기록한다. | 앱 코드 frame이 없는 내부 예외와 SDK 내부 오류를 일으키면 앱 문제는 생기지 않고, 진단에 오류 종류와 안전한 위치가 남는다. | |
| diagnostics R2a | candidate | diagnostics | 운영 log와 crash 기록에는 구성 요소, 관측 시각, 오류 종류, 안전한 위치, 가린 설명을 남긴다. | token, 인증 header, secret, 비공개 경로가 든 오류를 일으키면 기록에는 위 항목만 남고 원문은 없다; 가리기가 실패하면 원문 없이 실패 이유가 남는다. | |
| diagnostics R2b | candidate | diagnostics | 운영 log와 crash 기록은 process 메모리 덤프, stdout·stderr 원문, HTTP 덤프를 자동으로 담지 않는다. | process를 crash시키고 stdout, stderr, HTTP 요청을 남긴 뒤 진단 자료를 보면 그 원문이 들어 있지 않다. | |
| diagnostics R3 | candidate | diagnostics | 운영 log는 비동기로 쓰고, log 출력이 막혀도 API와 command와 무관한 앱 응답이 기다리지 않는다. | log 쓰기를 지연시키거나 실패시켜도 다른 API 응답과 앱 응답이 지연 없이 나간다. | 크기 한도는 diagnostics R12 |
| diagnostics R4a | candidate | diagnostics | 디스크 부족과 저장소 손상은 lophn 자체의 실패로 기록하고 앱 문제로 돌리지 않는다. | 디스크 부족과 손상된 저장소를 만들면 lophn 실패로 확인 가능한 이유와 함께 기록되고 앱 문제는 생기지 않는다. | |
| diagnostics R4b | defer-other | storage | 저장이 실패했는데 log나 메모리를 근거로 성공이나 확정된 command 결과를 돌려주지 않는다. | | 저장 commit 보장은 storage 몫 |
| diagnostics R5 | candidate | diagnostics | 진단과 log의 오류 상세는 redaction을 통과한 내용만 보이고, 가릴 수 없는 원문은 보이지 않는다. | 상세를 펼쳐도 처리되지 않은 원문과 stack이 나오지 않고 제외 이유가 보인다. | redaction R14a와 같은 쪽 원칙이지만 진단 화면 경로를 따로 본다 |
| diagnostics R6 | candidate | diagnostics | 인증 실패, Origin 거부, 권한 밖 접근, secret 사용 같은 보안 사건은 일반 진단과 구분해 찾을 수 있다. | 각 사건을 일으키면 보안 진단으로 찾을 수 있고, 범위 밖 대상과 secret 원문은 담기지 않는다. | |
| diagnostics R7 | candidate | diagnostics | 인증하지 않은 요청의 인증 실패와 거부는 용량이 제한된 운영 log에만 남기고 lophn 기록 저장소의 event로 만들지 않는다. | 인증하지 않은 요청을 많이 보내면 lophn 기록의 event는 늘지 않고 제한된 크기의 log만 남는다. | |
| diagnostics R8a | candidate | diagnostics | 상태 점검은 구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 실제로 점검한 시각을 보여 준다. | 구성 요소 하나를 쓸 수 없게 만들면 점검 결과에 그 요소의 불가 이유와 점검 시각이 나온다. | |
| diagnostics R8b | candidate | diagnostics | 상태 점검은 호출한 쪽의 인증과 scope를 확인한다. | 인증 없이 점검을 부르면 안전한 일반 오류만 받고, 인증한 뒤에는 현재 상태를 받는다. | server 묶음의 core-api 인증과 겹치는지 합칠 때 확인 |
| diagnostics R9 | ask | | | | 번들된 SDK와 설치된 같은 version SDK의 내용 hash 비교가 diagnostics의 점검인지, install-and-update(보류) 범위인지 정해야 한다 |
| diagnostics R10a | candidate | diagnostics | 보안 상태 점검은 실행 자격을 담은 저장소의 권한이 너무 열려 있는지 검사하고 안전한 결과로 보여 준다. | 권한을 넓게 연 자격 저장소를 두고 점검하면 근거와 점검 시각이 나오고 자격 값은 나오지 않는다. | |
| diagnostics R10b | ask | | | | 점검 항목 중 너무 넓은 grant, file과 network를 같이 허락한 앱, 오래 쓰지 않은 grant가 새 앱 허락 모델에서도 있는지 정해야 한다 |
| diagnostics R10c | candidate | diagnostics | 보안 상태 점검은 log에 남은 가리지 않은 key 패턴을 찾아 알려 준다. | key 모양 값이 든 log를 두고 점검하면 위치와 점검 시각이 나오고 의심 값의 원문은 나오지 않는다. | |
| diagnostics R11 | candidate | diagnostics | 운영 log의 기본 level은 info다. | 처음 설치한 직후 적용 중인 level이 info이고 설정에서 조회된다. | |
| diagnostics R12 | candidate | diagnostics | 운영 log와 crash 기록은 용량 상한을 넘으면 오래된 것부터 지우고, 영구 기록은 지우지 않는다. | 상한을 넘기면 가장 오래된 log만 지워지고 최근 진단은 조회된다; 확정된 command 결과와 결정은 그대로다. | |

## base (redaction)

| 옛 | 판정 | subject | 요지 (새 말) | 확인 (새 말) | 이유 |
|---|---|---|---|---|---|
| redaction R1a | candidate | base | 등록된 secret 값은 길이나 개수와 상관없이 긴 값부터 정확히 찾아 출력에서 모두 가린다. | 1자 값, 2자 값, 서로 겹치는 값, 65개가 넘는 값을 등록하고 출력을 만들면 어느 값도 남지 않는다. | |
| redaction R1b | candidate | base | lophn을 다시 띄우거나 잠금을 푼 뒤에도 secret을 쓰기 전에 다시 등록해 가림이 이어진다. | 재시작한 뒤 secret을 쓰는 출력을 만들면 원문이 가려진다. | |
| redaction R2 | candidate | base | 등록하지 않은 secret도 고정한 규칙(잘 알려진 key prefix, PEM 개인 키)으로 입력과 출력에서 같은 판정으로 찾는다. | OpenAI, Anthropic, GitHub, AWS, Slack key, JWT, PEM 표본이 입력과 출력에서 모두 찾아진다; 규칙을 바꾸면 양쪽에 같이 적용된다. | |
| redaction R3 | candidate | base | Authorization·Cookie header, URL의 사용자 이름·password·인증 query, JSON의 secret·token·password·credential 값은 중첩 구조와 오류 안에서도 가린다. | 중첩 배열과 object 안의 header, URL, JSON 인증 값을 무작위 문자열로 바꿔도 저장과 출력에 원문이 남지 않는다. | |
| redaction R4 | defer-other | agent-sessions | session 입력과 질문 답이 secret이면 저장과 model 전송 전에 제출 전체를 막고 보호 입력 안내만 남긴다. | | 입력 차단은 session 몫 |
| redaction R5a | candidate | base | stream 조각 경계에 걸친 secret도 text와 JSON 출력에서 가린다. | secret을 여러 조각에 나눠 보내면 이어 붙인 출력에 원문이 없다. | |
| redaction R5b | defer-other | run-loop | tool 결과, 오류, model context, model 출력, 산출물, trace는 받는 쪽에 가기 전에 가리고, 기록하는 model 입력과 실제 전송 본문이 같다. | | 적용 위치는 run-loop 몫 |
| redaction R6 | candidate | base | 가린 자리는 값의 길이나 종류와 상관없이 같은 표시 하나로 바꾸고, 앞뒤 문자, 원래 길이, hash를 남기지 않는다. | 길이와 종류가 다른 secret이 같은 표시로 바뀐다; 표시에서 원래 길이와 일부 문자를 알 수 없다. | |
| redaction R7 | defer-other | shell | 화면의 상세, 전후 비교, 오류, 복사, tooltip에서도 가린 값이 드러나지 않는다. | | 화면 몫 |
| redaction R8 | candidate | base | 자료를 밖으로 내보내기 전에는 그 자료의 소유자가 선언한 안전 필드만 남기고, 선언하지 않은 값과 불필요한 이름, 연락처, email, 경로는 빼거나 자료 안에서만 통하는 표식으로 바꾼다. | 선언하지 않은 중첩 값, email, 개인 경로가 든 자료를 처리하면 결과에는 선언한 필드만 남는다. | |
| redaction R9a | candidate | base | 필드 이름만 바꾼 개인정보는 통과시키지 않고, 가명 표식은 어느 범위 안에서만 비교되는지 정해진 대로 둔다. | 이름만 바꾼 개인정보를 넣으면 걸러진다; 가명 표식을 정해진 비교 범위 밖에서 비교할 수 없다. | |
| redaction R9b | candidate | base | 값의 type과 길이도 공개 기준으로 검사하고, 빼기로 한 값은 그 값을 짐작할 수 있는 구조까지 뺀다. | 길이로 값을 추정할 수 있는 필드와 통째로 제외한 필드를 넣으면 결과에서 길이와 구조가 드러나지 않는다. | |
| redaction R10 | defer-other | problems | 문제 자료에 넣는 표본의 원값은 명시한 경로만 secret 처리 뒤 최대 64자로 남기고, ID형 문자열은 표본 안에서만 통하게 바꾸며, 표본 하나는 2KiB 이하다. | | snapshot 수집 항목은 problems 몫(redaction 머리말) |
| redaction R11 | defer-other | problems | 표본에 원값을 허용하는 경로에는 전체 wildcard도 중간 wildcard도 쓸 수 없다. | | R10과 같은 몫 |
| redaction R12 | defer-other | problems | 화면 상태의 문자열은 80자를 넘으면 안전한 형태로 줄이고, private 필드는 통째로 빼며, 짧은 문자열도 개인정보 검사를 거친다. | | snapshot 수집 항목은 problems 몫 |
| redaction R14a | candidate | base | 가리기가 실패하거나 불확실하거나 한도를 넘거나 지원하지 않는 매체를 만나면 원문을 내보내지 않고 빠진 범위와 안전한 이유만 남긴다. | 검사 예외, timeout, 지원하지 않는 이미지, 한도 초과를 각각 넣으면 원문과 부분 원문이 나오지 않고 생략 이유가 남는다. | |
| redaction R14b | defer-other | run-loop | 가리기에 실패해도 이미 일어난 외부 효과를 다시 실행하지 않는다. | | 효과 재시도는 run-loop 몫 |
| redaction R15a | drop-dup | | | | diagnostics R2b |
| redaction R15b | defer-other | run-loop | 자격 증명, model 내부 추론 본문, 재생용 서명은 trace에 자동으로 담지 않는다. | | trace 기록은 run-loop 몫 |
| redaction R15c | drop-dup | | | | diagnostics R2a(처리 못한 예외는 오류 종류와 안전한 위치만 기록) |
| redaction R16 | candidate | base | 이미 가려서 저장한 자료도 조회와 model 전송 전에 현재 규칙으로 다시 가리고, 저장된 원본은 바꾸지 않는다. | 규칙을 강화한 뒤 저장 자료를 조회하면 새로 걸리는 값이 출력에서 가려지고 저장된 원본의 hash는 그대로다. | |
| redaction R17 | candidate | base | 잘못 모은 secret이나 개인정보를 지우거나 막은 기록에는 값, 공개 hash, 값의 일부를 다시 담지 않는다. | 민감 자료를 막은 뒤 남은 event, 오류, 정리 결과에서 원값과 일부를 찾을 수 없다. | |

## 판단 메모

- secrets R4a, R4b의 "허용된 이름"(어느 agent가 어느 이름을 조회할 수 있는가)은 앱 허락 모델이 정한다. 2단계에서 상대를 확인해야 한다.
- redaction R10~R12는 보장은 맞지만 problems의 snapshot 수집 항목이라 defer-other로 뒀다. problems-b 쪽 결과와 맞춰 본다.
- diagnostics R5와 redaction R14a, diagnostics R8b와 server 묶음의 token 확인은 겹칠 수 있다. 합칠 때 하나로 줄인다.

## 개수

| 판정 | 개수 |
|---|---|
| candidate | 37 |
| drop-removed | 1 |
| drop-conflict | 0 |
| drop-dup | 2 |
| drop-detail | 0 |
| defer-other | 13 |
| ask | 2 |
| 합계 | 55 |
