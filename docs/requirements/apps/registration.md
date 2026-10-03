---
type: requirements
concerns: [apps/registration]
---
# apps/registration

동작에 가치가 있는 개인 앱을 코드 없이 등록하고 구현 source를 나중에 연결하며 앱을 보관한다; 앱 문서의 주소는 documents/addressing, 등록 뒤 App Engineer assignment는 lophn-agent/assignments가 맡는다.

## 요구

### 가벼운 등록

**[R1]** 보는 사람이 없어도 돌아야 하거나 코드로 돌봐야 하는 대상을 문서와 별개의 앱으로 등록할 수 있다.
- 이유: 내용과 동작은 서로 다른 사용 대상이다.
- 확인: 화면 없는 수집 앱과 화면 있는 앱을 등록하고 문서 등록과 구별한다.
- 의도: apps#I1

**[R2]** 새 앱은 필수 이름·slug·한 줄 목적과 선택적인 기획 문서의 고정 version만으로 코드·release·source 없이 등록할 수 있다.
- 이유: apps/registration에 따라 설계가 구현보다 먼저 시작되어야 한다.
- 확인: source가 없는 앱을 등록하고 기획 version이 있는 경우와 없는 경우 모두 조회한다.
- 의도: apps#I1

**[R3]** 앱 등록은 사람의 직접 요청 또는 lophn-agent/questions의 고정 등록 선택지 적용과 전체 범위 coding-agent/connection에서만 허용한다.
- 이유: lophn-agent/questions·apps/registration의 등록 주체를 지켜 범위 밖 앱 생성을 막는다.
- 확인: 전체 범위 연결은 등록되고 앱 하나 범위 연결과 lophn agent의 직접 요청은 거절된다.
- 의도: apps#I1, coding-agent#I2

### source 연결

**[R4]** 사람과 해당 앱 범위를 가진 coding agent는 구현을 시작할 때 임의 위치의 git source 폴더를 앱에 연결할 수 있다.
- 이유: 관리 폴더 강제 대신 apps/registration의 등록·구현 분리를 따른다.
- 확인: 관리 저장소 밖 git 폴더를 연결하고 실제 경로가 연결 정보로 조회되는지 확인한다.
- 의도: apps#I1

**[R5]** source를 연결하거나 바꿔도 운영 bundle·채택한 release·업무 데이터는 바뀌지 않는다.
- 이유: 개발 위치 변경을 운영 변경으로 취급하지 않는다.
- 확인: source 재연결 전후 기존 release hash와 앱 데이터가 같다.
- 의도: apps#I2

### 이름과 보관

**[R6]** 앱 slug의 이름 공간과 옛 주소 안내는 documents/addressing을 따르며 lophn이 만드는 관리 폴더에는 주인 없는 기존 폴더를 자동 입양하지 않는다.
- 이유: 사람이 열 수 있는 이름과 기존 파일의 소유권을 보존한다.
- 확인: 같은 이름의 기존 비소유 폴더가 있을 때 내용과 소유자가 바뀌지 않는다.
- 의도: documents#I3

**[R7]** 등록 입력의 이름 추천은 slug의 대시·밑줄을 공백으로 바꾸고 단어 첫 글자를 대문자로 하되 사람이 입력한 이름을 그대로 쓴다.
- 이유: 읽을 수 있는 기본 이름을 주면서 apps/registration의 이름 필수 조건을 지킨다.
- 확인: 사용량 형태의 slug를 넣으면 읽을 수 있는 이름이 추천되고 MAHAS를 입력하면 그대로 남는다.
- 의도: apps#I1

**[R8]** 사람이 앱을 archive하면 실행을 비허용으로 만들고 다시 꺼내도 사람의 실행 허용 전에는 시작하지 않는다.
- 이유: 보관 해제가 실행 재개의 숨은 동의가 되어서는 안 된다.
- 확인: archive 뒤 apps/runtime의 새 호출이 닫히고 보관 해제 뒤에도 멈춘 상태다.
- 의도: apps#I5

**[R9]** 앱 archive는 release 이력과 앱 문서 place를 삭제하지 않는다.
- 이유: 오래 쓰는 앱의 근거와 결과를 보존한다.
- 확인: archive 뒤 이전 release와 앱 문서를 계속 찾는다.
- 의도: platform#I1

**[R10]** 앱 등록에는 project 선택을 요구하지 않고 documents/addressing의 독립 앱 place로 조회할 수 있다.
- 이유: 앱을 문서 project의 하위 폴더로 강제하지 않는다.
- 확인: project가 없는 상태에서 앱을 등록해 그 앱의 독립 문서 주소와 목록을 찾는다.
- 의도: apps#I1, documents#I3

## 열린 질문

- apps/registration#Q1 앱 slug 변경 때 관리 폴더와 외부 source를 어디까지 이동할까?

## 버린 것

- 등록 뒤 별도 개발 시작 approval과 designed→developing 실행 허가 단계는 apps/registration의 가벼운 등록과 새 상태 모델에 없어 두지 않는다.
