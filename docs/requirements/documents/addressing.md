---
type: requirements
concerns: [documents/addressing]
---
# documents/addressing

문서 address·project나 앱 자리·자리 없는 문서의 ID 읽기와 rename·move 뒤 옛 address 안내를 맡는다; 이름은 권한이 아니며 문서·판 자체는 documents/versions를 따른다.

## 요구

### 문서 참조

**[R1]** 문서 address는 프로젝트나 앱의 이름/문서 이름 뒤 선택 section과 0으로 시작하지 않는 양의 10진 version 번호를 붙이며 context는 address의 자리에 넣지 않는다.
- 이유: 소유 자리와 읽는 관점을 분리한다.
- 확인: mahas/weekly-report#summary@3으로 해당 판의 section을 열고 version을 생략하면 해석 시점 최신 판을 고르며 앱 command는 apps/blueprint를 따른다.
- 의도: documents#I3

**[R2]** 프로젝트와 앱 이름은 하나의 전역 이름 공간을 공유하고 문서 이름은 같은 자리 안에서 유일하며 현재 또는 옛 예약 이름을 다른 대상에 재사용할 수 없다.
- 이유: 옛 참조가 새 대상을 가리키면 안 된다.
- 확인: 프로젝트 이름을 앱에, 옛 문서 이름을 다른 문서에 쓰려 하면 충돌하며 보관 후에도 예약이 남는다.
- 의도: documents#I3

**[R3]** 자리 없는 문서는 제목으로 목록·검색에서 찾고 ID와 고정 판으로 읽을 수 있으며 임의 기본 자리에 자동으로 넣지 않는다.
- 이유: 기획이나 메모가 아직 소속을 정하지 못해도 잃지 않아야 한다.
- 확인: 자리 없이 저장한 문서를 제목으로 찾고 ID로 읽으며 원본 연결의 자리는 명시 저장·이동 규칙을 따른다.
- 의도: documents#I3

**[R4]** section은 조상 이름을 /로 이은 전체 경로를 우선하고 문서 안에서 유일한 마지막 이름만으로도 찾되 중복이면 모호함을 반환한다.
- 이유: 짧은 참조를 허용하되 같은 제목 중 하나를 임의로 고르지 않는다.
- 확인: 전체 경로·유일 마지막 이름으로 같은 section을 열고 두 section의 마지막 이름이 같으면 짧은 참조는 거절된다.
- 의도: documents#I4

**[R5]** section은 선택한 고정 판의 같은 key만 가리키며 최신 판에서 소실됐으면 소실 또는 미확인을 표시하고 유사한 section으로 redirect하지 않는다.
- 이유: 제목·hash·유사도가 실제 같은 판단 근거의 증거는 아니다.
- 확인: 옛 key를 지우고 비슷한 section을 만들면 최신 참조는 소실 표시이고 옛 판을 지정한 참조는 당시 section을 읽는다.
- 의도: documents#I2, documents#I3

### 이름과 자리 변경

**[R6]** 프로젝트·앱·문서의 이름 변경과 문서 자리 이동 후에도 같은 ID·이력·고정 근거 참조를 유지하고 모든 옛 address는 같은 대상의 현재 참조로 안내한다.
- 이유: 정리 때문에 오래된 문서와 근거 링크를 깨뜨리지 않는다.
- 확인: 이름과 자리를 여러 번 바꾸고 처음 address를 열어 원래 대상과 지정 판에 닿으며 옛 address 응답에 현재 참조가 함께 나온다.
- 의도: documents#I3

**[R7]** 옛 address 대상이 보관되거나 자리 없음이 되어도 이름 예약을 지우지 않고 같은 문서의 보관 상태나 ID 읽기를 안내한다.
- 이유: 처음부터 영구 삭제 없는 제품에서 보관을 사라짐으로 취급하지 않는다.
- 확인: 보관하거나 자리를 뺀 문서를 옛 address로 열어 대상 부재 대신 같은 문서 상태와 읽을 참조를 받는다.
- 의도: documents#I3, documents#I2

**[R8]** 문서의 자리 변경만으로 원본 파일 경로·내용·원본 연결·추적 규칙을 바꾸지 않는다.
- 이유: 문서 정리가 디스크 이동을 몰래 수행하면 안 된다.
- 확인: 프로젝트 문서를 앱 자리로 옮겨도 원본 파일은 그대로이며 파일로 두기와 해제는 documents/file-tracking을 따른다.
- 의도: documents#I3, documents#I1

**[R9]** 문서 이름·자리 변경은 사람 또는 사람이 고른 정확한 option action으로 적용하고 자유 답이나 낡은 비교 기준으로 이동하지 않는다.
- 이유: 추천과 사람 결정을 구별한다.
- 확인: 추천만 받은 때에는 이동하지 않고 고른 선택지만 적용되며 중간 변경 뒤에는 다시 확인한다; 동작 결합은 lophn-agent/questions를 따른다.
- 의도: documents#I3

### 문서 이름 선택

**[R10]** 문서 address 이름은 제목과 독립된 영문 이름을 사람에게 제안하고 고칠 수 있게 하며 밑줄로 시작하는 이름·address 구분자·공백·제어 문자를 거절한다.
- 이유: 파일 이름 fallback만으로 국제 문서 제목을 강제 음역하거나 예약 이름을 쓰지 않게 한다.
- 확인: 첫 파일 이름을 제안 재료로 쓰되 사람이 고친 이름으로 저장하고 금지 이름은 거절되며 한글 제목 자체는 유지된다.
- 의도: documents#I3

## 열린 질문

- documents/addressing#Q1 hash 동일·5글자 shingle Jaccard 0.8 이상·0.5~0.8 대응과 사람 확정을 유지할까.
- documents/addressing#Q2 section보다 작은 code block·table 주소를 추가할까.
- documents/addressing#Q3 문서 영문 address 이름을 어떻게 고르고 최대 길이는 얼마로 할까.
- documents/addressing#Q4 현재 이름 우선·문자열 redirect chain을 유지할까 영구 ID 예약으로 직접 해석할까.
- documents/addressing#Q5 저장 위치를 MCP 원본 경로로 자동 결정할까.

## 버린 것

- Home·View·context의 별도 소유 자리와 예전 주소 이관 호환은 버렸다; 주소 첫 자리는 프로젝트나 앱이며 context는 관점이다.
- 플랫폼 전용 자리·기본 수신 자리를 만든다는 요구는 버렸다; 자리 없는 문서는 ID로 읽는다.
- hash confidence 1.0·5글자 shingle Jaccard 0.8 이상·0.5~0.8 후보 판단과 사람 대응 확정·redirect chain은 버렸다; section은 같은 key만 이어지고 소실을 명시한다.
