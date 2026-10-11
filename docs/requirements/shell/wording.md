---
type: requirements
concerns: [shell/wording]
---
# shell/wording

UI·안내·오류의 문체와 기본/상세 정보의 말, message key 기반 i18n과 en-only 시작을 맡는다; 화면은 바이브코딩 사용자가 아는 말을 쓰고 문서·코드의 말 규칙과 구별하며 표시할 실제 사실은 각 concern을 따른다.

## 요구

### 화면과 조작

**[R1]** 기본 UI는 en의 짧고 직접적인 1~2문장·사람이 지은 이름·사람 단위 숫자·다음 행동 하나를 먼저 보이며 사람을 user라고 부르지 않고 문장에 마침표를 붙이되 버튼·제목에는 붙이지 않으며 모든 고정 문구는 message key로 관리하고 처음에는 en만 제공한다.
- 이유: 기본 안내만 읽어도 영향과 다음 행동을 알 수 있게 한다.
- 확인: 오류·일정·결과 요약만으로 일과 다음 행동을 설명할 수 있고 en 외 locale 없이도 모든 고정 문구가 message key로 표시된다.
- 의도: shell#I1

**[R2]** 화면에는 바이브코딩 사용자가 아는 en으로 대상·영향·행동을 설명하고 ledger·invocation·assignment 같은 안쪽 개념은 내보내지 않으며 개발자가 쓰는 영어·굳은 음차를 유지하는 규칙은 문서와 코드에만 적용한다.
- 이유: 화면 사용자가 안쪽 개념을 배워야만 행동할 수 있게 만들지 않는다.
- 확인: 기본 화면과 사용자용 상세에도 ledger·invocation·assignment가 없고 문서와 코드의 개념 이름은 유지된다.
- 의도: shell#I3

**[R3]** en 문구는 완성된 문장 단위의 message key와 이름·숫자 등의 placeholder로 구성하고 다른 언어를 더할 때 조사·복수형·어순을 해당 locale의 메시지가 처리하게 하며 문장 조각을 연결하지 않는다.
- 이유: 처음 en만 제공하더라도 다른 언어의 문법을 화면 코드에 고정하지 않는다.
- 확인: 이름과 숫자를 바꿔도 en 문장이 자연스럽고 다른 locale의 문장 순서를 화면 코드 변경 없이 지정할 수 있다.
- 의도: shell#I3

**[R4]** 사람이 정한 제목과 이해할 수 있는 en 상태 라벨로 기본 대상을 설명하되 내부 slug·enum·ID와 안쪽 개념 이름을 사용자용 라벨로 그대로 표시하지 않는다.
- 이유: 사람이 정한 이름을 내부 저장값으로 대체하지 않는다.
- 확인: 기본 카드에는 사람이 지은 이름과 이해할 수 있는 영향이 보이고 내부 저장값이나 안쪽 개념 이름이 사용자용 라벨에 없다.
- 의도: shell#I3

**[R5]** 문제 안내는 짧고 직접적인 en 한 문장으로 원인 추측 대신 사람이 겪는 영향을 적는다.
- 이유: 확인하지 않은 원인을 사실처럼 말하지 않는다.
- 확인: Parser error만 쓰지 않고 Some usage details are missing처럼 관찰된 영향을 en message key로 표시한다.
- 의도: shell#I1

**[R6]** 고정 사용자 문구 검사는 snake_case·ID 접두사·원시 enum과 ledger·release·invocation·assignment 같은 안쪽 개념의 사용자 화면 노출을 경고하되 문서·코드·별도 개발자 diagnostics의 기술 용어는 이 검사 대상에서 제외한다.
- 이유: 원시 값과 안쪽 개념을 사용자가 알아야 하는 화면 언어로 만들지 않는다.
- 확인: 기본 안내·사용자용 상세·tooltip에서 원시 값과 안쪽 개념은 경고되고 문서·코드·별도 개발자 diagnostics의 이름은 유지된다.
- 의도: shell#I3

**[R7]** 고정 사용자 문구 검사는 화면 코드의 직접 문구·존재하지 않는 message key·en 메시지 누락·placeholder 불일치를 오류로 처리하고 다른 locale을 추가하면 그 locale의 문법 검사를 분리하여 적용한다.
- 이유: message key와 실제 en 문구가 빠지거나 서로 다른 입력을 기대하는 화면을 채택하지 않는다.
- 확인: 직접 문구·없는 key·빠진 en 값·다른 placeholder를 넣으면 검사에서 실패하고 en-only 빌드에는 다른 locale을 요구하지 않는다.
- 의도: shell#I3

**[R8]** 앱 사용자 화면의 기본 안내·접힌 상세·tooltip에는 code·check 식별·ID·원시 key·stack·log·원문 오류를 넣지 않고 문제 전달용 복사 문장의 문제 ID 및 별도 개발자 diagnostics만 예외로 둔다.
- 이유: 앱 안내가 원문 diagnostics로 변하지 않게 한다.
- 확인: 앱 오류 tooltip에도 stack이 없고 필요한 원문은 problems/reporting·platform/diagnostics로 이어진다.
- 의도: shell#I1

**[R9]** shell은 problems/problem-codes가 확정하여 전달한 문구를 사용하고 자리표시자를 자체 해석하거나 앱 제목과 문구를 임의로 합치지 않는다.
- 이유: 소유 concern의 고정 문구 의미를 shell이 다시 해석하지 않는다.
- 확인: 같은 문제의 문구가 앱·shell에서 같고 추가 조사 치환으로 달라지지 않는다.
- 의도: shell#I3

**[R10]** 안내·오류는 실패한 대상과 사람이 겪는 영향 및 가능한 다음 행동 하나를 먼저 적고 모르는 원인은 추측하지 않는다.
- 이유: 실패의 실제 영향과 가능한 복구 행동을 먼저 알려야 한다.
- 확인: 저장 충돌에는 어느 문서의 저장을 못 했는지와 비교해 보기, 연결 실패에는 어느 연결과 다시 연결하기를 보여 준다.
- 의도: shell#I1

**[R11]** 문서와 코드의 개념 이름은 docs/README.md의 말 규칙을 따르고 화면의 고정 문구는 바이브코딩 사용자가 아는 en message key 문구를 사용하되 agent가 생성한 자유 글은 message key 없이 같은 en 화면 말 규칙을 지켜 ledger·invocation·assignment 같은 안쪽 개념을 노출하지 않는다.
- 이유: 문서와 코드의 이름은 유지하되 화면이 안쪽 개념 학습을 요구하지 않게 한다.
- 확인: 같은 대상의 사용자용 화면과 안내가 일관된 en 문구를 쓰고 문서·코드에서만 안쪽 개념 이름을 확인할 수 있다.
- 의도: shell#I3

**[R12]** 내부 식별자·content hash·파일 경로·조건식·원시 오류는 기본 안내와 분리한 자세한 정보에 두되 shell/confirmation-window의 정확한 대상·경로 확인 및 앱 사용자 화면의 원문 금지 예외를 지킨다.
- 이유: 기본 안내와 정확한 기술 확인의 정보 밀도를 분리한다.
- 확인: 기본 안내가 원시 값으로 채워지지 않고 보호 화면에서는 정확한 경로를 확인한다.
- 의도: shell#I1

### 개념 이름

**[R13]** 컨텍스트 관점은 en message key의 Baseline·Reference·Follow changes로 표시하고 model 선택은 Default models·Model for summaries, agent 작업은 Agent activity·앱 작업은 App activity로 구별하며 안쪽 개념 이름은 문서·코드·별도 개발자 diagnostics에만 둔다.
- 이유: 사람이 필요한 차이를 알되 watch·run·invocation 같은 안쪽 개념을 배울 필요가 없게 한다.
- 확인: 관점·model·작업 화면에서 en message key 라벨을 읽어 역할과 대상을 구별하고 안쪽 개념 이름은 사용자 화면에 없다.
- 의도: shell#I3

**[R14]** 화면 message key는 `<screen>.<part>.<name>` 패턴을 쓰고 en 문구는 ICU MessageFormat으로 작성하여 이름·숫자 placeholder와 복수형을 처리하며 날짜·숫자·상대 시각은 Intl.DateTimeFormat·Intl.NumberFormat·Intl.RelativeTimeFormat으로 formatting하고 직접 문자열을 계산해 붙이지 않는다.
- 이유: key 패턴과 formatting 방법을 한 곳에서 정하여 다른 언어를 더할 때 화면마다 계산과 문장을 다시 만들지 않는다.
- 확인: 모든 message key가 화면 이름과 자리·문구 이름으로 구성되고 날짜·숫자·상대 시각이 Intl API로 formatting되며 복수형과 placeholder는 ICU 메시지로 처리된다.
- 의도: shell#I3

## 열린 질문


## 버린 것

