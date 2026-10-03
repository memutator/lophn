---
type: requirements
concerns: [lophn-agent/harness/prompt-assemble]
---
# lophn-agent/harness/prompt-assemble

고정된 지시와 tool을 앞에 둔 prompt 조립·자료 선택·cache 경계·크기 계산·압축과 명시 세션 이어가기 summary를 맡는다. 자료 지시 구분은 lophn-agent/harness/safety, model 한계는 lophn-agent/harness/model을 따른다.

## 요구

### 조립과 출처

**[R1]** 호출마다 제품 규칙·assignment의 preset 판·tool·model과 자료 판을 고정하고 사람 지침·작업 자리는 call 직전 현재 판을 snapshot해 같은 재료와 판에서 byte 단위로 같은 prompt를 만들며 현재 회수·멈춤은 매 call 검사한다.
- 이유: 한 호출에 새 정의와 옛 판단을 섞지 않는다.
- 확인: 같은 call 재료·지침·자리에서 byte가 같고 사람 지침 편집은 다음 call부터 새 hash이며 preset 새 판은 명시 적용 뒤 다음 run부터인지 본다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

**[R2]** prompt는 제품 공통 지시+tool 정의 → 역할 지시+preset prompt → 사람 지침(전역→project→app→preset 첨부) → 세션 이력·자료·run 사실 → 이번 turn 동적 context 순으로 조립하고 필수 제품·역할·지침을 빼서 호출하지 않는다.
- 이유: 역할 책임을 유지하면서 작업 재료를 지시와 분리한다.
- 확인: 다섯 층 순서와 지침 판이 맞고 마지막 동적 context 앞의 이력이 같은 turn들에서 cache prefix로 유지되는지 본다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2, lophn-agent#I8

**[R3]** 작업 재료는 목적·대상과 현재 run 사실 뒤에 명시 이어가기 summary·자료 목차와 요약·압축 summary·이후 세션과 tool 이력을 원래 순서로 넣고 현재 사람 요청과 미반영 steering을 빠짐없이 포함하며 없는 부분은 가짜 세션 없이 생략한다.
- 이유: 원문 시점과 지금의 수정 의도를 혼동하지 않는다.
- 확인: 요약 이전·이후 구간과 tool 짝 순서가 보존되고 미반영 steering·현재 요청 전문이 있는지 확인한다.
- 의도: lophn-agent/harness#I3

### 자료 선택

**[R4]** 초기 기준 자료는 주소·읽은 version·summary·최상위 outline, 참고는 주소·summary, watch는 변경 자료 주소·summary·변경 표시와 미변경 주소만 넣고 본문은 요청한 section만 펼친다.
- 이유: 모든 본문을 미리 보내지 않고 필요한 깊이만 읽는다.
- 확인: 세 관점별 초기 입력과 section 요청 후 본문 포함을 확인하며 관점은 documents/contexts·outline은 documents/outline-and-search를 따른다.
- 의도: lophn-agent/harness#I3

**[R5]** 같은 대상·version·관점은 처음 한 번만 넣고 tool 이력 본문을 초기 자료에 다시 붙이지 않으며 version·관점이 다르면 제목이 같아도 합치지 않는다.
- 이유: 중복 token을 줄이되 서로 다른 근거를 잃지 않는다.
- 확인: 동일 근거 중복과 같은 제목의 다른 version을 넣어 각각 한 번·별도로 포함되는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R6]** skill 이름·설명은 preset의 선택 목록에서만 지시에 넣고 lophn-agent/extensions로 읽은 본문은 tool 이력에만 넣으며 압축으로 잃으면 다시 읽도록 안내한다.
- 이유: 모든 skill 본문을 고정 prompt로 만들지 않는다.
- 확인: 미선택 skill 본문은 없고 선택·압축 후 재읽기 안내를 확인한다.
- 의도: lophn-agent/harness#I3

**[R7]** tool schema는 이번 call의 lophn-agent/harness/tools·lophn-agent/extensions·lophn-agent/harness/tool-judgment가 제공한 목록만 별도로 넣고 다른 역할·미연결 MCP tool을 cache 공유를 위해 보태거나 전체 자료 index를 본문으로 펼치지 않는다.
- 이유: 작은 prompt와 실제 권한 경계를 함께 지킨다.
- 확인: 권한 밖 schema가 없고 index는 단계적으로 읽히는지 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

### cache

**[R8]** 명시 cache 경계는 제품 공통 지시와 tool 끝·역할과 preset prompt 끝·사람 지침 끝의 최대 세 곳에 구조로 두고 같은 판의 byte를 유지하며 이력·자료·run 사실과 최신 동적 context는 그 뒤에 두고 단발 압축에 새 경계를 만들지 않는다.
- 이유: 특수 문자열이 경계를 바꾸거나 volatile 정보가 고정 prefix를 깨지 않는다.
- 확인: 동적 탭·시각만 바꾸면 사람 지침까지의 hash와 이전 이력 prefix는 같고 지침 편집은 해당 prefix를 바꾸며 자료 문자열은 경계를 못 만드는지 본다.
- 의도: lophn-agent/harness#I3

### 크기와 보호

**[R9]** 매 call의 입력 예산은 model 입력 한계와 전체 문맥에서 예약 출력을 뺀 값 중 작은 값이며 tool 정의·지시·포장·자료·결과·매체를 전부 세어 cache 적중도 창 점유를 줄이지 않고 필수 요청·규칙만으로 초과하면 호출하지 않는다.
- 이유: 큰 schema·cache 입력을 계산에서 빼지 않는다.
- 확인: 문맥 100,000·출력 10,000·입력 80,000이면 예산 80,000인지 확인하고 필수 입력 초과에서 전송 0개를 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

### 압축

**[R10]** 전체 요청이 입력 예산의 70% 이상이면 자동 압축을 시작하여 50% 이하를 목표로 하며 예산 80,000에서 55,999는 압축하지 않고 56,000은 시작해 40,000 이하로 만든다.
- 이유: 압축 시점을 결정 가능한 경계로 둔다.
- 확인: 주어진 숫자의 바로 아래·같음 경계를 테스트한다.
- 의도: lophn-agent/harness#I3

**[R11]** 압축은 제품·역할·preset·사람 지침·현재 목적·최신 사람 요청 전문·유효 결정·필수 근거를 보호하고 최근 이력은 예산 25%를 2,000~15,000 token 범위로 남겨 call·result 짝을 나누지 않되 전체 입력 한계는 넘지 않는다.
- 이유: 최근 결정과 완전한 call 대응을 잃지 않는다.
- 확인: 예산 40,000은 10,000, 100,000은 최소 15,000 최근 이력을 지키고 짝 경계·필수 전문이 유지되는지 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

**[R12]** 보호 밖 오래된 텍스트 tool 결과가 2,000 Unicode code point를 넘고 원문 재조회 통로가 있으면 앞 1,000·뒤 1,000에 별도 생략 표시·재조회 참조를 붙여 먼저 축소하며 재조회 불가 결과는 자르지 않는다.
- 이유: 결정적인 축소 후 필요하면 원문을 다시 읽는다.
- 확인: 2,000·2,001 경계와 재조회 없는 결과를 테스트하고 원본이 바뀌지 않는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R13]** 결정적 축소 뒤에도 50%를 넘으면 해당 preset의 organizing 선택(없으면 같은 model)으로 보호 밖 오래된 이력·기존 압축 summary를 요약하여 출력 상한을 예산 10%와 4,000 token 중 작은 값으로 정한다.
- 이유: 무작정 긴 요약으로 다시 창을 채우지 않는다.
- 확인: 예산 20,000에서 요약 출력이 최대 2,000이고 보호 전문이 요약 밖에 남는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R14]** 압축 summary는 목적·사람 결정과 제약·확인 진행과 근거·미완료·실패와 다음 행동·추정과 불확실성 여섯 부분을 구별하여 없는 내용은 없다고 쓰고 옛 요청을 현재 지시로 되살리지 않는다.
- 이유: 짧은 요약에서 사실·결정·추정의 차이를 잃지 않는다.
- 확인: 여섯 부분과 미정·부정 조건이 남고 없는 성공·승인·미실행을 만들지 않는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R15]** 요약 재료가 organizing 입력 예산 절반을 넘으면 tool 짝을 유지하여 오래된 순서의 절반 이하 chunk로 요약·병합하고 모든 원문 구간을 보존하며 단일 짝도 못 담으면 압축 실패로 처리한다.
- 이유: 큰 이력을 처리하며 일부 구간을 몰래 버리지 않는다.
- 확인: 큰 이력의 chunk·병합 구간 누락 0개와 단일 짝 초과 실패를 확인한다.
- 의도: lophn-agent/harness#I3

**[R16]** 압축은 비어 있지 않은 완전 응답·여섯 부분·모든 범위·보호 전문 유지·이전보다 작은 재조립·50% 이하를 모두 만족해야 완료로 쓰고 기본으로 별도 재검토 model call을 추가하지 않는다.
- 이유: 불완전 요약을 성공으로 채택하지 않는다.
- 확인: 각 조건을 하나씩 깨뜨려 완료되지 않고 별도 검토 call이 없는지 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

### 압축 실패

**[R17]** 압축 실패는 원문과 실패 사실을 보존하여 같은 구간 자동 요약을 반복하지 않고 원문이 한계 안이면 그대로 진행하되 한계 밖이면 이유·범위 축소 또는 새 세션 필요를 알려 불완전 prompt를 보내지 않는다.
- 이유: 요약 실패가 무한 지출이나 입력 유실이 되지 않는다.
- 확인: 실패한 같은 구간의 재요약 0개와 한계 안 원문·밖 중단의 구별을 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

### 크기와 보호

**[R18]** 초기 자료 초과는 참고 summary→기준 outline→남은 선택 자료 순으로 줄여 오래된 변경부터 주소만 남기고 생략 범위·수를 밝히되 제품·역할·preset·사람 지침과 현재 요청·필수 근거는 보호한다.
- 이유: 줄이는 순서와 남기는 근거를 알 수 있게 한다.
- 확인: 작은 창에서 축소 순서·주소·생략 수가 보이고 필수 전문 초과는 호출되지 않는지 확인한다.
- 의도: lophn-agent/harness#I3

### 이어가기 summary

**[R19]** 이어가기·압축 summary는 원문을 대체하지 않는 derived 재료로서 실제 organizing 호출·원문 세션과 구간·생성 시각·근거 version을 연결하고 사람 직접 말과 구별하며 정정은 이전 원문·출력을 덮지 않고 새 근거로 남긴다.
- 이유: 요약의 출처와 과거 판단을 되짚을 수 있어야 한다.
- 확인: 원문·옛 출력이 그대로 남고 새 summary가 다른 출처·구간·시각으로 확인되며 종료마다 필수 model call이 없는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R20]** 명시 세션 이어가기 summary 본문은 최대 400 token으로 완성하여 401 token이면 저장된 완성 summary로 쓰지 않고 결정 조건·부정 의미를 보존하여 다시 줄이며 문장 끝을 잘라 맞추지 않는다.
- 이유: 작은 이어가기 정보가 핵심 조건을 왜곡하지 않는다.
- 확인: 400·401 경계와 부정 조건·완전 문장을 확인한다.
- 의도: lophn-agent/harness#I3

**[R21]** summary는 사람 의도·결정, agent 추정, 확인 결과·앱과 문서 근거, 미정·남은 일을 구별하여 낡거나 확인 불가 근거를 표시하고 일회 선호를 영구 취향·지시로 일반화하거나 없는 승인·완료·미실행을 단정하지 않는다.
- 이유: 요약이 사실의 주인이나 장기 기억이 되지 않는다.
- 확인: 낡은 근거·추정·일회 요청의 summary에서 각 구별과 불확실성 표시를 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

**[R22]** 이어가기 summary 실패는 세션 종료를 막지 않고 원문이 한계 안이면 이어갈 수 있으나 밖이면 실패를 알려 범위 축소·새 세션을 안내하여 미완성 summary로 시작하지 않는다.
- 이유: 종료와 이어가기 준비를 구별한다.
- 확인: 요약 실패에서 원문 크기별 종료·이어가기·안내 결과를 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

### 재사용 범위

**[R23]** 압축 summary는 같은 run 후속 call에서만 교체·재사용하고 이어가기 summary는 사람이 지정한 같은 세션의 최신 완성본 하나만 써서 그 뒤 원문을 붙이며 무관한 세션·다음 주기·handoff에 옛 원문이나 요약을 자동 주입하지 않는다.
- 이유: 세션을 넘는 장기 기억을 만들지 않는다.
- 확인: 새 세션·다음 주기·handoff 입력에 옛 세션이 없고 명시 이어가기만 지정 범위를 쓰는지 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

### 조립과 출처

**[R24]** 내부 추론 본문은 prompt와 영속 기록에서 제외하고 필수 opaque 추론 상태의 같은 run 비영속 전달은 lophn-agent/harness/provider를 따른다.
- 이유: 가독 추론과 provider 연속 호출의 opaque 상태를 구별한다.
- 확인: 본문·서명 원문이 세션·blob·trace에 없고 허용 상태만 provider 경계에서 재전송되는지 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

### 새 기능

**[R25]** 매 judgment turn 직전에 UTC 시각·timezone·열린 탭·초점·허용 앱 화면 요약을 새로 모아 이력·자료·run 사실 뒤 맨 마지막 최신 메시지의 동적 context로 붙인다.
- 이유: 지금 화면과 시각이 기존 이력의 cache prefix를 깨지 않게 한다.
- 확인: 다음 turn의 화면·시각이 최신 메시지 끝에서 바뀌고 같은 이력·고정 층의 byte는 바뀌지 않는지 본다.
- 의도: lophn-agent/harness#I3, lophn-agent#I3

**[R26]** 매 turn context는 포장 포함 UTF-8 8 KiB·열린 탭 최대 20개·초점 앱 요약 최대 2 KiB로 제한하고 초점 탭을 먼저 남겨 생략 수·수집 시각·조회 불가를 표시하며 상세 본문은 허락된 앱 read tool로 가져온다.
- 이유: 작은 화면 요약 때문에 대화와 요청이 밀려나지 않는다.
- 확인: 탭 21개·큰 앱 상태에서 요약 상한과 생략 표시가 있고 상세는 자동 주입되지 않는지 본다.
- 의도: lophn-agent/harness#I3, lophn-agent#I3

**[R27]** 탭 제목·선택 내용·앱 요약과 상세는 platform/redaction·lophn-agent/harness/safety를 거친 data로 취급하여 열린 탭 자체를 command 허락으로 보지 않는다.
- 이유: 지금 보는 화면도 자료이지 새 권한이나 시스템 지시가 아니다.
- 확인: 민감한 칸·가짜 system 지시가 행동으로 이어지지 않고 앱 호출 범위가 유지되는지 본다.
- 의도: lophn-agent/harness#I3, lophn-agent#I3

**[R28]** 새 context 수집이 실패하거나 세션 없는 주기 run이면 없는 화면과 이유를 표시하고 이전 turn의 화면을 현재 화면으로 재사용하지 않으며 실제 포함한 context를 model call 근거에 남긴다.
- 이유: 오래된 화면으로 새 힌트를 쓰거나 관측되지 않은 상태를 만들지 않는다.
- 확인: 앱 종료·shell 끊김·주기 run에서 부재 표시와 해당 call의 수집 근거를 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

**[R30]** call의 지침 층은 lophn-agent/instructions와 세션 작업 자리로 resolve해 보호 입력으로 포함하고 사람 지침 편집·명시 자리 변경은 다음 call에서 새 prefix로 조립하되 탭 이동은 층 선택을 바꾸지 않는다.
- 이유: 늘 읽는 지침과 현재 화면의 volatile context를 분리한다.
- 확인: 같은 run에서 파일 편집 뒤 새 version을 읽고 탭만 이동한 경우 지침·작업 자리는 같으며 지침 읽기 실패나 한계 초과는 호출을 막는지 본다.
- 의도: lophn-agent/harness#I3, lophn-agent#I8

## 버린 것

- subagent 문맥은 공통·자기 역할·부모가 명시한 일·허용 자료만 새로 조립하고 부모 대화·세션 summary·압축 summary는 상속하지 않는다. — 유지 결정의 subagent 제외: 네 역할 모두 subagent 없음; 역할 handoff의 이력 비복사는 별도 handoff 규칙.
