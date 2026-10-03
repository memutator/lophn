---
type: requirements
concerns: [documents/versions]
---
# documents/versions

문서의 고정 version과 저장 주체·run·출처를 보존하고 읽기·목록·이전 판 restore·사람의 보관을 맡는다; 주소·형식·파일 관측·derived 목차는 각 documents concern을 따른다.

## 요구

### 고정 판

**[R1]** 문서는 내용 자체가 가치인 읽기 대상으로 첫 저장부터 고정 version을 가지고 판 번호는 문서마다 1부터 연속 증가하며 HTML과 이미지 같은 여러 파일을 대표 파일 하나와 함께 한 판으로 묶어 보존할 수 있다.
- 이유: 본문 가치와 앱의 동작 가치를 구별하고 함께 읽는 자료를 잃지 않는다.
- 확인: 여러 파일 문서를 저장한 뒤 대표 파일과 첨부를 같은 고정 판으로 읽으며 그 문서 자체가 background 동작을 하지 않는다.
- 의도: documents#I2

**[R2]** 확정한 version의 원문·형식·저장 주체·시각·출처는 이후 저장·정정·restore로 바꾸거나 지우지 않는다.
- 이유: 판단 근거를 당시 내용 그대로 다시 읽어야 한다.
- 확인: 새 판과 restore 후에도 이전 판의 바이트와 저장 주체가 그대로다.
- 의도: documents#I2

**[R3]** 같은 문서의 최신 내용과 정확한 format 계약이 모두 같은 저장은 기존 판을 반환하고 새 version을 만들지 않는다.
- 이유: 재전송과 변화 없는 결과로 이력이 부풀지 않게 한다.
- 확인: 같은 내용과 계약을 반복 저장하면 번호가 늘지 않고 형식 계약만 바꾸면 새 판이 생긴다.
- 의도: documents#I2

### 저장과 근거

**[R4]** 기존 문서의 새 저장은 읽었던 이전 판을 기준으로 적용하며 그사이 최신 판이 바뀌었으면 충돌하고 새 판을 덮지 않는다.
- 이유: 서로 다른 사람·agent·앱의 수정이 사라지지 않게 한다.
- 확인: 같은 판을 읽은 두 주체 중 먼저 저장한 후 다른 내용의 늦은 저장은 충돌한다; 비교 규칙은 platform/ledger를 따른다.
- 의도: documents#I2

**[R5]** 저장 성공은 원문 blob과 고정 version 및 변경 기록이 확정됐다는 뜻이며 outline·검색 반영의 완료는 별도로 확인한다.
- 이유: 문서 보존과 찾기 위한 파생 처리는 서로 다른 완료다.
- 확인: index 처리를 늦춰도 저장한 판의 원문을 읽고 검색 지연은 documents/outline-and-search로 확인한다.
- 의도: documents#I2

**[R6]** 문서 저장 결과는 실제 저장한 고정 판의 참조를 반환하고 판 이력에는 확인된 저장 주체·시각과 agent 저장의 run을 보여 준다.
- 이유: agent가 썼다는 표식에서 어느 작업의 결과인지 되짚어야 한다.
- 확인: 사람·coding agent·lophn agent·앱 결과를 남기고 이력에서 주체와 agent run으로 돌아간다; agent 변경 취소는 lophn-agent/revert를 따른다.
- 의도: documents#I2, platform#I1

**[R7]** 저장 주체는 인증된 자격으로 정하고 coding agent의 작업 디렉터리만으로 원본 파일 연결이나 출처를 만들지 않는다.
- 이유: 작업 위치가 문서의 실제 관측 원본이라는 증거는 아니다.
- 확인: 같은 문서를 다른 작업 디렉터리에서 저장해도 원본 연결이 생기지 않고 주장한 사람 이름이 저장 주체가 되지 않는다; 인증은 platform/identity를 따른다.
- 의도: documents#I2, platform#I2

### 읽기와 복원

**[R8]** 최신 판과 지정한 옛 판을 각각 읽을 수 있고 원문 파일 읽기는 저장한 바이트와 MIME Content-Type을 그대로 제공한다.
- 이유: format 추출에 맞지 않는 자료도 원문을 다시 받아야 한다.
- 확인: HTML·PDF·이미지의 고정 판을 읽어 저장 바이트와 Content-Type을 대조하고 부분 본문 읽기는 documents/outline-and-search를 따른다.
- 의도: documents#I2, documents#I8

**[R9]** 문서 목록은 자리·활성 또는 보관 상태·개수 조건으로 고를 수 있고 각 문서의 최신 판 저장 주체·시각·format을 제공하되 사람 화면은 제목·지금 필요한 상태만 기본으로 보여 주고 저장 근거와 format은 펼쳐 본다.
- 이유: 분류 전과 보관 문서를 이력 없이 추측하지 않게 한다.
- 확인: 자리 없는 문서와 보관 문서를 조건으로 찾고 이력의 최신 판 정보와 목록을 대조한다.
- 의도: documents#I3, documents#I2

**[R10]** 이전 판 restore는 선택한 내용과 형식으로 새 version을 남기고 이후 이력도 보존하며 이미 최신 판과 같으면 새 판을 만들지 않는다.
- 이유: restore도 이후에 한 변경이고 과거 삭제가 아니다.
- 확인: 1번 판으로 restore한 뒤 2번 판도 읽고 새 최신 판은 1번 내용이며 같은 restore 반복으로 판이 늘지 않는다.
- 의도: documents#I2

### 보관과 원본

**[R11]** 사람은 문서를 보관·보관 해제할 수 있고 보관·폴더 해제·추적 중단·원본 삭제 뒤에도 확정 version은 읽을 수 있다.
- 이유: 디스크 파일과 저장한 자료의 생애를 분리한다.
- 확인: 각 작업 뒤 고정 판을 열고 lophn agent의 직접 보관·보관 해제는 거절한다; 자동 관측 중단은 documents/file-tracking을 따른다.
- 의도: documents#I2, documents#I1

**[R12]** 첫 판에는 문서와 version의 영구 삭제를 제공하지 않는다.
- 이유: 고정 근거와 옛 address를 안전하게 보존하는 삭제 규칙이 아직 없다.
- 확인: 보관 후 고정 근거가 남고 문서·version 영구 삭제 요청은 제공되지 않는다.
- 의도: documents#I2

**[R13]** 원본 연결 문서는 현재 파일 관측으로만 새 version을 확정하고 직접 내용 저장은 거절하며 원본 연결 해제·재연결은 사람이 명시적으로 한다.
- 이유: 저장된 내용과 실제 원본이 서로 다른 최신판을 주장하지 않게 한다.
- 확인: 원본 연결 문서에 직접 저장하면 충돌하고 파일 삭제나 추적 해제만으로 원본 연결이 자동 사라지지 않는다.
- 의도: documents#I1, documents#I2

### 산출물

**[R14]** 기획·설계·반복 판단과 앱이 남긴 결과는 다시 읽을 수 있는 고정 문서 version으로 보존한다.
- 이유: 세션이나 invocation이 끝나도 결과를 다시 사용할 수 있어야 한다.
- 확인: 각 결과 완료 뒤 고정 참조를 열며 역할별 저장 범위는 lophn-agent/assignments와 lophn-agent/roles, 앱 출력 선언은 apps/blueprint를 따른다.
- 의도: documents#I2

**[R15]** 한 문서의 내용 갱신은 새 version으로 쌓고 독립적으로 고칠 주간 보고 같은 가족 문서는 documents/series로 묶는다.
- 이유: 같은 문서의 판과 서로 다른 문서의 순서를 혼동하지 않는다.
- 확인: 하나의 보고를 고치면 그 문서 판이 늘고 다음 주 보고는 별도 문서로 가족 목록에 남는다.
- 의도: documents#I2, documents#I6

### 내보내기

**[R16]** 사람은 프로젝트나 앱 자리의 문서와 선택 고정 판을 Markdown·JSON으로 export하고 원래 바이트와 판 참조를 함께 보존할 수 있다.
- 이유: 다른 도구에서도 문서의 내용과 당시 근거를 확인해야 한다.
- 확인: 자리 export를 읽어 선택 판 내용과 참조를 대조하고 HTML·PDF 등 Markdown으로 바꿀 수 없는 원문은 원래 MIME과 바이트로 남으며 derived index는 포함하지 않는다.
- 의도: documents#I8

### 함께 배포하는 사용 안내

**[R17]** lophn 사용 안내는 설치 묶음에 포함한 읽기 전용 문서 목록으로 배포하고 lophn version·안내 제목·고정 내용 hash로 판을 구별하여 사람과 lophn 역할이 같은 설치 판을 offline으로 읽게 한다.
- 이유: lophn 자체의 설명은 인터넷이나 사용자 프로젝트 생성 없이 설치한 기능과 일치해야 한다.
- 확인: offline에서 사용 안내의 목록·목차·절·본문을 읽고 설치 version과 내용 hash를 확인하며 사용자 Document가 자동 생성되지 않는지 본다.
- 의도: lophn-agent#I3, platform#I6

**[R18]** 배포 안내는 사용자 프로젝트·앱 자리·자동 system 자리나 tracking 대상으로 넣지 않고 사람이 수정하여 남기려면 일반 문서의 복사본으로 저장하게 한다.
- 이유: 설치 문서와 사람이 작성한 고정 version의 생애를 섞지 않는다.
- 확인: 설치 안내를 직접 편집·이동·보관할 수 없고 복사본은 documents/versions의 일반 판 이력으로 남으며 update가 복사본을 덮지 않는지 본다.
- 의도: documents#I2, lophn-agent#I3

**[R19]** 사람이 지정한 lophn 지침은 실제 UTF-8 Markdown 파일의 확정 version으로 이력을 만들고 최초 저장·외부 변경·옛 내용 복원을 같은 원본 비교와 새 판 규칙으로 처리하며 지침이라는 이유로 과거 판을 덮지 않는다.
- 이유: 지침을 textarea 설정이나 별도 이력 원본으로 복제하지 않는다.
- 확인: 전역·project·app·preset 지침을 고치고 복원하여 파일 hash와 확정 판을 확인하며 없는 파일은 사람의 첫 저장 전에 version이 없고 LOPHN.md·AGENTS.md가 구별되는지 본다.
- 의도: documents#I2, lophn-agent#I8

**[R20]** 지침으로 등록된 문서는 lophn agent·coding agent·앱의 문서 write·이동·원본 연결 변경 대상에서 제외하고 agent는 사람에게 question으로 변경을 제안한다.
- 이유: 자료·출력 경로를 통해 지침 수정 금지를 우회하지 못하게 한다.
- 확인: 같은 지침 문서를 다른 자리로 옮기거나 출력으로 지정하여 저장하려 해도 거절되고 사람의 직접 저장·복원과 신뢰한 파일 관측만 새 판을 만드는지 본다.
- 의도: documents#I1, lophn-agent#I8

## 열린 질문

- documents/versions#Q1 자리 문서·version export의 선택 판·첨부 포함 범위를 어떻게 확정할까.
- documents/versions#Q2 대용량 HTML·data의 파일 수·바이트·준비 시간 상한을 무엇으로 할까.
- documents/versions#Q3 문서 영구 삭제를 추가할까.
- documents/versions#Q4 series 없음이라는 기존 domain model 정책을 이번 series 채택에 맞춰 어떻게 바꿀까.
- documents/versions#Q5 MCP 작업 디렉터리를 저장 원본으로 기록할까.

## 버린 것

- 참조 간선을 보고 문서 영구 삭제를 보관으로 바꾸던 규칙은 버렸다; 첫 판은 영구 삭제 없이 보관만 제공한다.
- Series 전체를 version 저장 concern 안에 두던 방식은 버렸다; 채택한 가족 기능은 documents/series가 맡고 새 인스턴스 작성용 draft 값은 documents/series가 맡는다.
