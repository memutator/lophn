---
type: requirements
concerns: [platform/redaction]
---
# platform/redaction

secret과 개인정보가 저장·표시·model 전송·외부 반환에 섞이지 않도록 출력 복사본을 검사하고 redaction하며 원본을 몰래 바꾸지 않고 실패·불확실·부재를 명시한다; 자격은 platform/identity, 원값 보관은 platform/secrets, snapshot 수집 항목은 problems/snapshots를 따른다.

## 요구

### 검사 규칙

**[R1]** 알려진 secret은 보호 프로세스 메모리에 원문 전체를 등록해 길이·앞머리·개수로 제외하지 않고 긴 값부터 정확히 검사하며 잠금·재시작 뒤 다시 쓰기 전에 재등록한다.
- 이유: 짧거나 겹치는 값도 인증 원문이며 긴 값 일부만 남으면 안 된다.
- 확인: 1자·2자·겹치는 값·65개 이상의 값과 재시작 사례를 넣어 모든 알려진 원문이 출력에 남지 않는지 확인한다.
- 의도: platform#I2, platform#I8

**[R2]** 알려지지 않은 secret은 동일한 고정 gitleaks credential prefix·PEM 개인 키 규칙 판으로 입력과 출력을 검사하고 규칙 갱신을 양쪽에 동시에 적용한다.
- 이유: 입력만 막거나 출력만 처리하면 같은 키가 다른 경로로 새어 나간다.
- 확인: OpenAI·Anthropic·GitHub·AWS·Slack key·JWT·PEM 표본이 입력과 출력에서 동일하게 검출되는지 확인하며 이 목록은 provider 지원 목록으로 사용하지 않는다.
- 의도: platform#I2, platform#I8

**[R3]** Authorization·Cookie header, URL 사용자 이름·password·인증 query, JSON의 secret·token·password·credential 값은 원문 일치 여부와 관계없이 중첩 object·array·오류까지 제거한다.
- 이유: 알 수 없는 인증 값도 구조로 식별할 수 있다.
- 확인: 중첩 배열과 object의 header·URL·JSON 인증 값을 무작위 문자열로 바꿔도 원문이 저장·출력되지 않는지 확인한다.
- 의도: platform#I2, platform#I8

### 입력·출력 경계

**[R4]** 알려진 secret이나 패턴에 맞는 세션 입력·질문 답은 저장·model 전송 전에 전체 제출을 막고 원문 없는 전용 secret 입력 안내만 남긴다.
- 이유: secret을 먼저 저장한 뒤 안전한 출력만 만들면 이미 유출된 기록이 남는다.
- 확인: 입력 끝부분과 질문 답에 key를 넣어 원문·일부가 message·blob·model input에 없고 안내만 남는지 확인한다.
- 의도: platform#I8, platform#I2

**[R5]** tool 결과·오류·model context·model 출력·문서 산출물·trace·notification·handoff·수리 자료·첨부는 각 수신자에게 가기 전에 redaction하고 stream 조각 경계에 걸친 secret도 처리한다.
- 이유: 저장·전송·표시 중 한 경로라도 빠지면 같은 값이 다시 드러난다.
- 확인: secret을 각 경로와 모든 조각 경계에 나누어 넣고 text·JSON·이미지 추가 읽기까지 검사해 값이 없고 실제 model input 기록과 전송 본문이 같은지 확인한다.
- 의도: platform#I2, platform#I8

**[R6]** model 전송과 저장·기록에서 secret 대체 표시는 길이·종류와 관계없이 별표 하나로 통일하고 앞뒤 문자·원래 길이·공개 hash를 남기지 않으며 agent나 설정으로 redaction을 끌 수 없다.
- 이유: 대체 표시의 길이와 일부 문자도 원값 정보를 준다.
- 확인: 길이와 종류가 다른 값이 동일한 표시로 바뀌고 해제·원문 보기·복사 요청이 거절되는지 확인한다.
- 의도: platform#I8, platform#I2

**[R7]** 세션·tool 상세·전후 비교·오류·notification·복사·export preview·tooltip에는 redaction 처리된 값을 다시 드러내는 동작을 제공하지 않고 표시에서도 값의 type·길이·점 개수를 숨긴다.
- 이유: 기본 화면만 안전하고 자세한 정보가 원문을 되살리면 안 된다.
- 확인: 각 화면·복사·export 결과에서 같은 안전한 표시만 나오고 hover·펼침으로 원문이 드러나지 않는지 확인하며 시각 모양은 shell/wording을 따른다.
- 의도: platform#I2, platform#I8

### 수집 최소화와 개인정보

**[R8]** secret은 수집하지 않는 것을 기본으로 하고 자료 소유 concern이 명시한 안전 필드만 남기며 미선언 value와 필요 없는 이름·연락처·이메일·경로는 제외하거나 자료 안에서만 통하는 표식으로 바꾼다.
- 이유: 패턴 검사는 미지 password와 모든 개인정보를 자동으로 알아낼 수 없다.
- 확인: 미선언 중첩 값·이메일·개인 경로를 넣은 자료가 외부 수리 자료에 남지 않고 필요한 안전 필드만 포함되는지 확인한다.
- 의도: platform#I2

**[R9]** 필드명 변경을 익명화로 취급하지 않고 가명 표식의 비교 범위를 명시하며 shape의 type·길이도 공개 정책으로 검사하고 제외한 값은 유추 가능한 구조까지 뺀다.
- 이유: 구조나 식별자를 남기면 값만 제거해도 개인을 알아낼 수 있다.
- 확인: alias만 바꾼 개인정보를 통과시키지 않고 shape·가명·전체 제외 사례에서 허용 범위 밖 비교나 길이 추정이 불가능한지 확인한다.
- 의도: platform#I2

**[R10]** 표본을 지원하는 경우 원값은 명시한 경로만 secret 처리 뒤 최대 64자로 남기고 다른 값은 허용된 shape로 줄이며 ID형 문자열은 표본 안에서 가명 처리하고 표본 하나를 2KiB 이하로 제한한다.
- 이유: 수리 표본이 업무 DB의 원값 공개 통로가 되지 않아야 한다.
- 확인: UUID·16자 이상 hex·ULID형 식별과 긴 문자열·중첩 표본을 넣어 가명·64자·2KiB 한도를 확인한다.
- 의도: platform#I2

**[R11]** 표본 원값 허용 경로에 단독 또는 경로 중간 wildcard를 허용하지 않는다.
- 이유: 모든 업무 값의 무차별 공개를 한 글자로 허락할 수 없어야 한다.
- 확인: 전체 wildcard와 중간 wildcard의 원값 선언을 거절하고 명시한 개별 경로만 허용하는지 확인한다.
- 의도: platform#I2

**[R12]** 화면 상태의 문자열은 80자를 넘으면 원값 대신 안전한 형태로 줄이고 private 필드는 길이와 실제 화면 표시 여부에 관계없이 통째로 제외하며 짧은 문자열도 개인정보 검사를 생략하지 않는다.
- 이유: 이미 화면에 보였다는 사실과 80자 길이는 외부 공개 허락이 아니다.
- 확인: 80자·81자 문자열과 짧은 이메일·private 필드를 넣어 한도와 개인정보·private 차단이 함께 적용되는지 확인한다.
- 의도: platform#I2

**[R13]** 보호 화면·secret 입력은 수집하지 않고 screenshot의 private 영역을 안전하게 처리할 수 없으면 자동 첨부하지 않으며 사람이 최종 검토·redaction 또는 제외한 자료만 받는다.
- 이유: 사람이 보았다는 이유만으로 비공개 화면의 외부 반환을 안전하다고 할 수 없다.
- 확인: private 영역 처리 실패·보호 화면·secret 입력에서는 이미지 대신 생략 이유가 남고 안전한 최종 이미지에만 첨부가 가능한지 확인한다.
- 의도: platform#I2

### 실패와 불변 자료

**[R14]** redaction 실패·불확실·한도 초과·미지원 매체는 원문 저장·표시·model 전송·외부 반환을 중단하고 빠진 범위·안전한 이유만 남기며 이미 일어난 효과를 다시 실행하지 않는다.
- 이유: 실패한 검사를 통과로 취급하거나 기록 실패를 효과 재시도의 이유로 삼지 않는다.
- 확인: 검사 exception·timeout·미지원 이미지·한도 초과를 주입해 원문·부분 원문이 없고 생략 이유가 보이며 같은 외부 효과가 반복되지 않는지 확인한다.
- 의도: platform#I2, platform#I8

**[R15]** 자격 증명·model 내부 추론 본문·재생용 서명과 원시 stdout·stderr·HTTP dump·crash 메모리는 자동 보관·내보내지 않으며 처리 못한 exception은 안전한 종류·위치만 남긴다.
- 이유: 진단 상세가 숨겨진 인증·내부 추론을 수집하는 우회가 되어서는 안 된다.
- 확인: 내용 기록을 켜도 제외 자료가 없고 안전화 불가능한 stack·메시지가 원문으로 남지 않는지 확인한다.
- 의도: platform#I2, platform#I8

**[R16]** 이미 저장 단계에서 redaction한 자료도 조회·export·model 전송 전에 현재 규칙으로 다시 검사하고 정책 강화나 새 secret 발견은 원본을 바꾸지 않고 반환을 차단하거나 출력에 추가 redaction한다.
- 이유: 과거 규칙의 통과가 현재 공개 허락은 아니고 고정 근거를 조용히 바꿀 수도 없다.
- 확인: 정책을 강화한 뒤 이전 blob hash·원본은 같지만 출력의 새 민감 값은 나오지 않는지 확인한다.
- 의도: platform#I2, platform#I1

**[R17]** 잘못 수집한 secret·개인정보의 삭제·차단 감사에는 상세 값·공개 hash·원문 일부를 다시 복사하지 않는다.
- 이유: 삭제 기록이 새 유출 기록을 만들면 안 된다.
- 확인: 민감 자료를 차단한 뒤 감사 event·오류·정리 결과에서 원값과 일부를 찾을 수 없는지 확인한다.
- 의도: platform#I2, platform#I1

## 열린 질문

- platform/redaction#Q1 첫 gitleaks commit과 credential prefix 목록을 무엇으로 고정할까?
- platform/redaction#Q2 알려진 secret의 URL encoding·Base64도 자동 검출할까?
- platform/redaction#Q3 수집한 비밀을 패턴 redaction만으로 충분히 막을 수 있을까?
- platform/redaction#Q4 secret 대체 표시는 옛 별표 셋·redacted 표식과 현재 모델의 별표 하나 중 무엇인가?
- platform/redaction#Q5 텍스트·JSON·이미지 크기와 redaction 처리 기한을 얼마로 둘까?

## 버린 것

- 사람이 screenshot을 미리 본다는 이유로 redaction하지 않는 요구는 private 영역을 처리할 수 없으면 제외하는 현재 원칙과 충돌해 적용하지 않는다.
