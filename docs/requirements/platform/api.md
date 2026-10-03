---
type: requirements
concerns: [platform/api]
---
# platform/api

loopback API의 HTTP JSON command·read와 WebSocket event 구독, RPC 경로, 안전한 성공·오류 반환, transport version과 호환을 맡는다; 자격과 actor는 platform/identity, event의 확정·재전달은 platform/ledger를 따른다.

## 요구

### transport와 RPC

**[R1]** core의 command와 read는 기본 port 7431의 loopback HTTP JSON으로 제공하며 읽기도 변경도 POST RPC를 사용하고 event 구독은 WebSocket으로 제공한다.
- 이유: 클라이언트마다 다른 전송 규칙을 만들지 않는다.
- 확인: 동일 클라이언트가 JSON command·read와 WebSocket 구독을 사용할 수 있고 HTTP read가 상태를 변경하지 않으며 다른 port 설정도 같은 계약을 따르는지 확인한다.
- 의도: platform#I6

**[R2]** RPC 경로는 v와 major 숫자를 결합한 첫 구간·resource 구간·method 구간의 순서로 고정하고 등록되지 않은 version·resource·method를 다른 동작으로 추정하지 않고 거절한다.
- 이유: 주소 철자가 우연히 다른 명령을 실행하면 안 된다.
- 확인: major 1의 등록된 RPC는 작동하고 누락·추가·알 수 없는 구간은 명시적으로 실패하는지 확인한다.
- 의도: platform#I1

### 반환 계약

**[R3]** HTTP 성공은 해당 동작의 JSON 결과 객체를 그대로 반환하되 문서 원본 파일 읽기만 원본 바이트와 Content-Type을 반환하고 실패는 오류 객체 하나 안에 공통 오류 종류·안전한 설명·선택적인 안전 상세를 담아 각각 400·401·403·404·409·503·500 상태로 구별한다.
- 이유: 성공과 입력 오류·자격 없음·범위 거절·부재·충돌·사용 불가·내부 실패를 클라이언트가 같은 방법으로 다뤄야 한다.
- 확인: 일반 성공에는 JSON 결과가 나오고 문서 파일 성공에는 JSON 포장·문자열 변환 없이 원본 바이트와 올바른 Content-Type이 나오며, 파일 실패를 포함한 일곱 공통 실패는 platform/ledger의 분류 순서대로 상태가 대응되는지 확인한다.
- 의도: platform#I4

**[R4]** 앱 실패를 일반 API caller에게 반환할 때는 안전한 오류 종류와 설명만 주고 앱의 stack·원시 상세·입력 원문·token을 반환하지 않는다.
- 이유: 진단용 원문이 일반 API 오류에서 누출되면 안 된다.
- 확인: secret과 개인정보를 포함한 앱 exception을 만들고 caller에 stack·상세가 없는지 확인하며 증거 수집은 problems/snapshots와 출력 검사는 platform/redaction으로 확인한다.
- 의도: platform#I2

### event transport

**[R5]** WebSocket 연결과 HTTP event 재조회는 같은 범위 검사·전역 순번·재전달 계약을 사용하며 WebSocket 재생 시작 순번은 해당 순번을 포함하고 범위 필터로 생략한 event가 있어도 읽어 지난 위치를 반환한다.
- 이유: 연결이 끊겨도 숨긴 event를 누출하거나 계속 같은 범위를 조회하는 일이 없어야 한다.
- 확인: 허용·금지 event를 섞고 연결을 끊어 HTTP 재조회와 WebSocket 재연결의 결과·진행 위치가 일치하며 WebSocket에 지정한 시작 순번의 허용 event도 다시 오는지 확인하고, 처리 위치 이후 재개는 platform/ledger를 따른다.
- 의도: platform#I1, platform#I2

### version과 호환

**[R6]** 동일 major API에서는 선택 필드 추가만 호환 변경으로 허용하고 필수 입력·기존 의미·오류 분류·event 의미를 바꾸는 변경은 새 major로 분리하며 미지원 major는 조용히 변환하지 않고 거절한다.
- 이유: 서로 다른 시기에 업데이트한 shell·CLI·MCP가 같은 요청을 다른 뜻으로 보내면 안 된다.
- 확인: 이전 클라이언트 fixture로 새 선택 필드가 있는 응답을 읽고 필수 입력·의미 변경은 같은 major에서 실패하는 contract 테스트를 실행한다.
- 의도: platform#I4

### 구독 재생 위치

**[R7]** 이름 있는 WebSocket 구독자의 확인 응답은 자기 자격에 묶인 읽어 지난 위치 이하의 감소하지 않는 재생 위치로 저장하고 재연결에 사용하되, 이 derived 관리 상태를 도메인 변화나 platform/ledger의 반응 처리 완료로 취급하지 않는다.
- 이유: 전송 재개를 위한 기억과 실제 반응 확정은 서로 다른 사실이다.
- 확인: 확인 응답 뒤 재연결에서 저장 위치를 사용할 수 있고 다른 구독자·아직 읽지 않은 위치·위치 후퇴는 거절되며 전달만으로 위치를 올리거나 도메인 변경·처리 완료를 만들지 않는지 확인한다.
- 의도: platform#I1

## 열린 질문

- platform/api#Q1 API major 지원 기간과 호환 변경 규칙을 어떻게 고정할까?
- platform/api#Q2 RPC와 오류 응답의 정확한 wire 식별자를 requirements에 적을까?

## 버린 것

없음.
