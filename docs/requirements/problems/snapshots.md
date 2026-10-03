---
type: requirements
concerns: [problems/snapshots]
---
# problems/snapshots

발생 당시 얻을 수 있는 invocation·오류·로그·화면 자료를 snapshot으로 고정하고, 자료별 출처·수집 시점·불확실성·누락과 한도를 함께 보여 준다; 수리 묶음 조립과 출력 크기는 coding-agent/repair-context가 맡는다.

## 요구

### 증거의 시점과 출처

**[R1]** snapshot은 보고 당시의 자료 또는 없는 이유를 보고와 함께 고정하고 나중 자료·현재 release로 과거 내용을 바꾸지 않는다.
- 이유: 수리할 때 현재 상태를 발생 당시 상태로 오해하지 않아야 한다.
- 확인: 보고 뒤 release·화면·로그가 바뀌어도 snapshot은 당시 자료를 보이고 추가 자료는 새 problems/reporting 보고로 남는다.
- 의도: problems#I1, problems#I2

**[R2]** 증거에는 사람 진술·앱 자기 보고·플랫폼 관측·작성된 명세·원인 가설의 출처를 구별하고 하나가 다른 사실을 자동 증명한다고 표시하지 않는다.
- 이유: 앱이 표시했다고 말한 것과 실제 픽셀 관측 또는 업무 정확성은 다르다.
- 확인: 같은 자료에서 출처와 수집 시점이 드러나고 SDK의 표시 주장만으로 픽셀 확인됨이나 검증 통과를 표시하지 않는다.
- 의도: problems#I1, problems#I2

**[R3]** snapshot은 전체 시스템을 한 시각에 원자적으로 찍은 자료가 아니며 서로 다른 수집 시점과 알려진 관측 범위·고정 판을 표시한다.
- 이유: 늦게 얻은 source 자료를 과거 사실로 바꾸지 않는다.
- 확인: source가 늦거나 당시 문서 내용 없이 고정 판 참조만 있을 때 후속 수집과 참조만 있음이 보이고 보존된 원문이라고 표시하지 않는다.
- 의도: problems#I1, problems#I2

### 누락과 수집 범위

**[R4]** invocation·오류·로그·화면의 각 항목에는 실제 값 또는 공백 아닌 누락 이유를 제공하고 정상 빈 목록·일부 잘림·redaction·source 장애를 구별한다.
- 이유: 자료 없음이 실패 없음이라는 잘못된 판단을 막는다.
- 확인: 빈 로그 0줄과 로그 수집 실패가 다르게 보이고 누락·잘림·제외 이유를 숨기지 않는다.
- 의도: problems#I1, problems#I2

**[R5]** 일부 자료 수집이나 blob 저장이 실패하면 그 항목의 이유를 고정하되 남은 자료와 글을 접수하며 작은 보고와 snapshot도 저장할 수 없을 때는 접수 실패로 표시한다.
- 이유: 첨부 실패로 제보 전체를 버리거나 반쪽 성공을 표시하지 않는다.
- 확인: 이미지 저장 실패에도 글과 이유는 접수되지만 보고 저장 실패에서는 성공이라고 하지 않는다.
- 의도: problems#I1, problems#I2

**[R6]** 수집 worker는 허용된 앱과 source 범위만 읽고 업무 DB·command 원입력·secret·사람 파일 전체를 자동 수집하지 않는다.
- 이유: 진단을 위해 읽기 권한과 개인정보 수집 범위를 넓히지 않는다.
- 확인: 다른 앱 source나 DB 전체를 넣으려 하면 제외되고 안전한 타입·길이 형태만 남으며 읽기와 출력 안전은 platform/identity·platform/redaction을 따른다.
- 의도: problems#I2, platform#I2

**[R7]** 진단 상세 수집을 끄는 것은 새 상세 수집만 중단하며 기존 자료 삭제·접근 권한 확대·필수 invocation 기록 중단으로 해석하지 않는다.
- 이유: 수집 설정과 기록 보존·접근 권한은 서로 다르다.
- 확인: 수집을 꺼도 기존 snapshot을 정책대로 읽고 apps/invocations 기록은 계속 남으며 새 자료에는 수집 꺼짐 이유가 보인다.
- 의도: problems#I2

### 연결된 invocation

**[R8]** snapshot은 SDK 또는 view가 실제로 연결한 invocation만 가리키며 비슷한 시각의 invocation으로 대신 연결하지 않는다.
- 이유: 시간상 가까운 성공 호출을 실패의 원인으로 잘못 좁히지 않는다.
- 확인: 같은 시각 여러 호출 뒤 연결 불명 오류를 보고하면 임의 연결이 없고 실제 연결된 호출만 보인다.
- 의도: problems#I1, problems#I2

**[R9]** 실제 invocation 참조를 알지만 기록이 아직 도착하지 않았으면 그 참조와 미도착 이유를 보존하고 다른 호출로 바꾸거나 무기한 기다리지 않는다.
- 이유: 비동기 invocation 기록과 당시 연결을 모두 정직하게 남긴다.
- 확인: 기록 도착을 늦추면 알려진 연결과 미도착이 보이고 접수는 계속 진행된다.
- 의도: problems#I1, problems#I2

### 오류와 source 위치

**[R10]** 오류 증거는 안전한 오류 이름·message·당시 release의 상대 source 위치를 제공하고 redaction된 stack은 최대 16,384 bytes만 보존한다.
- 이유: 수리에 필요한 위치를 남기되 현재 source나 원문 오류를 자동 노출하지 않는다.
- 확인: 16KiB 초과 stack은 제한되고 저장 제외 이유를 읽을 수 있으며 일반 호출자에게 stack이 반환되지 않는다.
- 의도: problems#I1, problems#I2

**[R11]** process stack은 당시 release의 상대 source로, 화면 stack은 그 release의 source map으로 원래 TSX 파일·줄로 찾고 없는 map·앱 frame에는 이유를 표시한다.
- 이유: 현재 파일을 과거 오류의 source라고 가리키면 잘못 고친다.
- 확인: source map 있는 화면 오류는 원래 TSX 위치로 보이고 map 없는 오류는 위치를 추측하지 않으며 당시 commit 내용 조회는 coding-agent/guides로 이어진다.
- 의도: problems#I1, problems#I2

### 안전한 로그 조각

**[R12]** snapshot의 기본 로그는 알려진 invocation으로 가능한 만큼 좁힌 최근 최대 30줄이고 실제 범위·수집 시각·잘림을 함께 표시한다.
- 이유: 안전한 조각으로 조사하고 범위 밖을 발생 없음이라고 해석하지 않는다.
- 확인: 긴 invocation 로그를 보고하면 최근 30줄과 잘림이 보이고 연결 없는 로그는 앱 로그 조각이라고 표시되며 한 줄의 기본 길이는 아직 정하지 않았다고 드러낸다.
- 의도: problems#I1, problems#I2

**[R13]** 임시 로그 buffer가 순환하거나 지워진 뒤에도 이미 snapshot으로 고정한 로그 조각은 독립적으로 남는다.
- 이유: 수리를 시작했을 때 앱의 임시 로그가 이미 사라질 수 있다.
- 확인: apps/runtime의 임시 buffer를 비운 뒤 기존 snapshot 로그가 그대로 읽힌다.
- 의도: problems#I1, problems#I2

**[R14]** 잘린 로그에서 전체 실패율을 계산하지 않고 조각·표본의 통계는 관측 범위가 제한된 통계라고 표시한다.
- 이유: 유한 수집량을 전체 업무 상태처럼 과장하지 않는다.
- 확인: 잘린 로그 30줄만 있는 상황에서 전체 실패율이라는 숫자가 나타나지 않는다.
- 의도: problems#I1, problems#I2

### 선택한 화면 자료

**[R15]** 화면 증거는 problems/feedback에서 사람이 선택한 당시의 안전한 상태와 PNG만 보존하고 미선택·화면 없음·숨김·수집 실패·redaction 제외를 표시한다.
- 이유: automation이나 깨진 view에도 없는 화면을 만들지 않는다.
- 확인: 화면 없는 automation과 보호 화면이 떠 있는 feedback은 화면 없음 또는 수집 불가를 보이고 이미지 크기·선택은 problems/feedback을 따른다.
- 의도: problems#I2

### 보관과 용량

**[R16]** snapshot의 큰 자료는 앱 운영 데이터와 분리하여 platform/blob-store의 불변 내용으로 보존하고 앱이나 source의 직접 접근을 허용하지 않는다.
- 이유: app DB 권한이 수리 자료 읽기 권한을 뜻하지 않는다.
- 확인: 앱 프로세스에서 snapshot 첨부를 직접 읽을 수 없고 허용된 진단 조회만 가능하며 저장 방식은 platform/blob-store를 따른다.
- 의도: problems#I2, platform#I2

**[R17]** 첫 판에는 문제 닫힘 후에도 snapshot 참조와 자료를 유지하며 자동 삭제 기간을 두지 않는다.
- 이유: 증거를 삭제해 놓고 과거 닫힘 근거가 그대로 있다는 약속을 해서는 안 된다.
- 확인: 닫힌 지 90일이 지나도 참조 자료가 읽히고 보존 정책 변경 전에는 자동 첨부 삭제가 없다.
- 의도: problems#I5, problems#I2

**[R18]** 항목별·snapshot별 bytes와 자료 개수·수집 시간·동시 수에는 유한 한도를 두고 초과와 손실 범위를 자료의 부재 이유로 보인다.
- 이유: 영구 보존·무제한 제보·고정 용량을 동시에 약속하지 않는다.
- 확인: 한도를 초과한 수집은 끝나고 이유가 보이며 실제 디스크 공간·metadata·임시 자료 비용도 용량 판단에 포함된다.
- 의도: problems#I1, problems#I2

**[R19]** 저장 공간 부족은 기존 자료를 몰래 지우지 않고 새 수집 제한 이유와 내보내기·한도 조정 등 가능한 해결을 보여 준다.
- 이유: 접수 제한과 기존 증거 삭제는 사람에게 다른 결과다.
- 확인: 디스크 부족을 주입하면 기존 snapshot은 남고 실패 원인과 내보내기 또는 한도 조정 방법을 읽을 수 있다.
- 의도: problems#I1, problems#I2

**[R20]** 첫 판의 snapshot 조립은 전체 2,000ms·오류 frame 32개·최근 로그 30줄 및 65,536 bytes·큰 자료 준비 총 2,359,296 bytes를 상한으로 사용하고 초과한 항목은 실제 잘림·timeout·제외 이유를 고정하며 한 줄의 별도 기본 길이는 정하지 않는다.
- 이유: 유한 수집과 기존 최근 로그 범위를 함께 지켜 큰 자료 하나가 보고 접수를 막지 않게 한다.
- 확인: 각 상한을 넘긴 수집도 정해진 시간에 끝나고 큰 항목 제외 이유와 남은 자료를 읽을 수 있으며 보고 자체 저장 실패를 성공으로 표시하지 않는다.
- 의도: problems#I1, problems#I2

## 열린 질문

- problems/snapshots#Q1 snapshot 자료의 사람 전용 명시 삭제와 재전송·재연결 복원 방지를 첫 판에 추가할까.
- problems/snapshots#Q2 요청할 때만 앱에서 안전한 추가 표본을 받는 기능을 지원할까.
- problems/snapshots#Q3 큰 관측 자료의 보존 기간과 앱별·전체 bytes 한도를 어떻게 정할까.
- problems/snapshots#Q4 로그 총 bytes·오류 frame 수·전체 수집 timeout·동시 수의 기본값을 얼마로 둘까.
- problems/snapshots#Q5 옛 첨부 90일 자동 삭제를 불변 snapshot 참조 유지보다 우선할까.
- problems/snapshots#Q6 첫3개·최근50개 발생 보존 및 error300자·frame10개·로그 첫10+최근30·줄300자 기본값을 그대로 가져올까.

## 버린 것

- 별도 EvidenceCapture·CaptureLink·증거 registry와 여러 증거 상태·관측 계약 coverage 체계는 보고별 고정 snapshot의 값 또는 누락 이유로 충분하므로 버린다.
- 수집 pending·lease·attach·finalize·역할별 추가 연결·cancel 및 30분 lease는 수집 밖에서 준비한 불변 자료를 한 번 접수하므로 버린다.
- 앱별 host journal에서 중앙 flush로 분산 snapshot을 완성하는 구조는 새 단일 ledger 설계에서 없으므로 버린다.
