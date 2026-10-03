---
type: flow
concerns: [documents, apps, problems, lophn-agent, coding-agent]
---
# 일 목록

사람, coding agent, lophn agent의 네 역할, machine, 앱이 하는 일. lophn의 entity는 이 일들이 읽고, 판단하고, 쓰고, 확인하는 것의 합집합이다.

도메인 모델은 이 일들의 합집합이다.  칸 뜻:

- **읽을 것**: 이 일을 하려면 무엇을 봐야 하나
- **판단할 것**: 누가 무엇을 정하나. agent가 정하는 것과 사람에게 물어야 하는 것을 가른다
- **쓸 것**: 결과로 무엇이 남나
- **확인 방법**: lophn이 결과를 어떻게 확인하나(machine이 볼 수 있는 신호, 또는 사람의 확인)

## 사람 (U)

| ID | 일 | 읽을 것 | 판단할 것 | 쓸 것 | 확인 방법 |
|---|---|---|---|---|---|
| U-1 | 앱을 쓴다 | 앱 화면 | — | 앱 명령 호출 | 앱이 응답한다 |
| U-2 | 문서를 쓰고 고친다 | 문서 | — | 디스크 파일, 버전 | 버전이 생긴다 |
| U-3 | 프로젝트 폴더를 등록하고 무엇을 추적할지 정한다 | 폴더 | 추적 범위 | 프로젝트, 추적 규칙 | 파일 상태가 보인다 |
| U-4 | 문제를 알린다(피드백) | 지금 앱 화면 | 무엇이 이상한지 | 피드백(글, 스크린샷·화면 상태 자동) | 문제로 묶여 보인다 |
| U-5 | 승인하거나 거절한다 | approval request(무엇을, 왜, 되돌릴 수 있나) | 허락 여부 | 결정 | 요청한 일이 진행되거나 멈춘다 |
| U-6 | agent의 질문에 답한다 | 질문, 선택지, 추천 | 답 | 답 | agent 일이 이어진다 |
| U-7 | agent가 한 일을 되돌린다 | agent run의 변경 목록 | 되돌릴지 | revert | 변경 전 상태로 돌아간다 |
| U-8 | 고쳐졌는지 확인한다 | 고친 기록 | 고쳐졌나 | 확인 / 아직 | 문제가 닫히거나 다시 열린다 |
| U-9 | lophn agent와 대화한다 | 대화 | 의도, 취향 | 메시지 | agent가 일한다 |
| U-10 | project/app의 Operator를 만들거나 거둔다 | Preset 판·assignment 제안 | 허락 여부 | assignment | 주기 실행이 시작되거나 멈춘다 |
| U-11 | 앱 권한을 거둔다 | 앱 권한 목록 | 무엇을 거둘지 | 회수 | 앱이 줄어든 권한으로 다시 시작한다 |
| U-12 | 문서와 프로젝트를 정리한다(이름, 자리, 보관) | 문서·프로젝트 목록 | 무엇을 어디로 | 이름·자리·보관 변경 | 옛 주소가 새 대상으로 안내된다 |
| U-13 | 문서의 이전 판을 다시 쓴다 | 버전 이력 | 어느 판으로 | 새 버전 | 새 버전이 생긴다 |
| U-14 | release를 활성화하거나 이전 버전으로 바꾸고, 앱 실행을 멈추거나 다시 허용한다 | release, test result | 무엇을 쓸지 | 결정 | 앱이 그 버전으로 돈다 |
| U-15 | 비밀을 넣고 바꾸고 지운다 | 앱이 선언한 비밀 | 값 | 비밀(값은 OS 저장소) | 앱이 그 비밀을 쓴다 |
| U-16 | notification을 읽는다 | notification | — | 읽음 | — |
| U-17 | 질문을 미루거나 approval request를 취소한다 | 질문, approval request | 미룰지, 취소할지 | 상태 변경 | 기다리던 일이 그에 맞게 끝난다 |
| U-18 | assignment를 멈추거나 다시 켠다 | assignment, 멈춘 이유 | 멈출지 | assignment 상태 | 주기 실행이 멈추거나 다시 돈다 |
| U-19 | Operator의 고정 Preset 판·project/app 범위·남길 문서·주기를 승인해 바꾼다 | 변경 제안 | 허락 여부 | 새 assignment 판 | 다음 회차부터 적용된다 |
| U-20 | provider를 연결하고 preset의 계정·model을 고른다 | provider·Preset 구성 | 계정 순서·model | Preset 새 판; 공통 model 값은 생성 후보만 | 다음 run부터 명시 적용한 판을 쓴다 |
| U-21 | agent가 무엇을 했고 얼마나 썼는지 본다 | 실행, 모델 호출, 사용량 | — | — | — |
| U-22 | 진행 중인 일을 고치거나 다음 일을 맡긴다 | 실행 | 무엇을 고칠지 | 메시지 | 실행이 고친 방향으로 이어진다 |
| U-23 | 실행을 멈추거나 남은 일을 다시 맡긴다 | 실행 | 멈출지 | 멈춤, 새 요청 | 실행이 멈춘다 |
| U-24 | coding agent 연결을 만들거나 거둔다 | 연결 목록 | 범위(전체 / 앱 하나) | 연결 | coding agent가 그 범위로만 일한다 |
| U-25 | coding 일을 요청하거나 ticket을 취소한다 | 앱·문제·ticket | 무엇을 맡길지 | lophn/App Engineer가 정리한 ticket·취소 | coding agent가 MCP claim할 준비를 확인한다 |

| U-26 | agent 지침을 쓰고 고친다 | 현재 LOPHN.md·판 이력 | 어떤 지침을 적용할지 | 사람 파일 저장·새 Version | 다음 call부터 해당 작업 자리 지침을 읽는다 |
| U-27 | ticket의 coding agent를 시작한다 | 준비된 ticket·harness | 자기 터미널 또는 [Start] | exact TUI 시작·첫 prompt 1회 | process/session 관측과 실제 MCP claim을 구별한다 |

U-10/U-19/U-20은 lophn-agent/presets#R6,R14와 lophn-agent/assignments#R2,R5, U-24/U-27은 coding-agent/connection#R3와 coding-agent/sessions#R1~R10, U-26은 shell/editor#R17을 따른다. 모든 coding 요청의 접수/readiness 충돌은 redesign/propagate#Q3에 남기고 가짜 채택·조건으로 우회하지 않는다.

## coding agent (CA)

| ID | 일 | 읽을 것 | 판단할 것 | 쓸 것 | 확인 방법 |
|---|---|---|---|---|---|
| CA-1 | 맥락을 파악한다 | 컨텍스트 목차, 문서 절, 검색, 앱 목록, SDK 목록 | 무엇을 더 읽을지 | 없음 | 적은 토큰으로 필요한 것에 닿는다 |
| CA-2 | 문서를 남긴다 | 자리 후보(프로젝트, 앱) | 어디에 둘지, 형식 | 문서 버전 | 주소를 돌려받는다, 형식 검사 통과 |
| CA-3 | 새 앱을 만든다 | 지정 ticket·채택된 고정 기획/설계, 템플릿, SDK 목록 | 구현 방법 | 필요하면 가벼운 앱 등록(전체 범위 연결만), 구현 시작 때 소스 폴더 연결, 앱 코드(git), blueprint, 문제 코드 선언, release | app test 통과(blueprint 유효, 문제 코드 선언과 보고 경로 포함), 미리보기, activation 뒤 정상 신호 |
| CA-4 | 앱을 바꾼다(구현 티켓) | 티켓(요구, acceptance check), blueprint, 코드 | 구현 방법 | 코드, release, 완료 보고 | 티켓 acceptance check 통과 |
| CA-5 | 문제를 고친다 | 열린 문제, snapshot, 지난 시도, blueprint, 지정 repair ticket·고정 해석 | 원인, 수정 | 코드, reproduction test, release, 고친 기록 | reproduction test 통과, activation 뒤 재발 없음 또는 사람의 확인 |
| CA-6 | 일을 맡고 끝냈다고 알린다 | 열린 티켓과 문제 목록 | 무엇을 맡을지(사람의 지시로) | MCP ticket claim, 작업, 완료 보고 | machine이 acceptance check를 검사한다 |
| CA-7 | 미리보기로 화면과 동작을 확인한다 | 실행 묶음 | 고칠 것이 있나 | 없음 | 미리보기가 뜬다 |

## lophn agent — lophn (LA)

| ID | 일 | 읽을 것 | 판단할 것 | 쓸 것 | 확인 방법 |
|---|---|---|---|---|---|
| LA-1 | 무엇을 만들지 기획한다 | 프로젝트·앱·컨텍스트의 목적, 앱 목록, SDK 목록, 문서 | 기존 앱 고치기 / 문서로 남기기 / 기존 SDK로 충분 / 새 앱 중 무엇 | 기획 문서, 채택을 묻는 질문(새 앱이면 등록 동작이 붙은 선택지), App Engineer나 Context Engineer에게 handoff | 사람이 기획을 고른다 |
| LA-2 | 자리 없는 문서의 자리를 추천한다 | 자리 없는 문서, 프로젝트·앱의 목적 | 어디에 둘지 | 이동 동작이 붙은 선택지를 가진 질문 | 사람이 고르면 machine이 옮긴다 |
| LA-3 | 사용법을 안내한다 | 사용 안내 문서 | 답 | 대화의 답 | — |
| LA-4 | 운영 상황을 보고한다 | 앱 상태, 열린 문제, 진행 중 티켓 | 해석 | 보고(대화나 문서) | 사실과 해석이 나뉘고 근거 주소가 있다 |

## lophn agent — App Engineer (AE)

| ID | 일 | 읽을 것 | 판단할 것 | 쓸 것 | 확인 방법 |
|---|---|---|---|---|---|
| AE-1 | 앱을 설계한다(인터뷰) | 기획 문서, 대화 | 요구, 범위, acceptance check. 정하지 못한 것은 사람에게 묻는다 | 설계 문서, 질문 | 사람이 설계를 받아들인다 |
| AE-2 | 구현을 coding agent에게 맡긴다 | 받아들여진 설계 문서 | 일을 어떤 단위로 나눌지 | 구현 티켓(요구, 실행 가능한 acceptance check) | machine이 acceptance check를 검사한다 |
| AE-3 | 문제를 해석한다 | 문제, snapshot, 설계, release 이력 | 원인 가설, 코드로 고칠 일인가 | 문제 해석, 수리 티켓 | 수리 뒤 문제가 닫힌다 |
| AE-4 | 새 release를 검토한다 | release, blueprint, invocation, test result | 설계와 어긋나는가 | 검토 메모, 후속 티켓 | — |
| AE-5 | lophn이나 Context Engineer에게 일을 넘긴다 | 원래 사람 요청, 근거 판 | 누구에게 무엇을 | 받는 실행의 출처 | 받는 실행이 시작한다 |

## lophn agent — Context Engineer (CE)

| ID | 일 | 읽을 것 | 판단할 것 | 쓸 것 | 확인 방법 |
|---|---|---|---|---|---|
| CE-1 | 컨텍스트를 짠다 | 문서 목차, 기존 컨텍스트, 앱 blueprint의 명령 목록 | 목적, 무엇을 기준·참고·watch로 둘지 | 컨텍스트, 항목 | 사람이 되돌릴 수 있다 |
| CE-2 | 용어를 정리한다 | 여러 문서 본문 | 용어 후보 | 용어 후보(정의는 사람이 한다) | 사람이 정의한다 |
| CE-3 | Operator assignment를 제안한다 | 컨텍스트의 변화 빈도, 반복되는 수동 일 | 반복 판단이 있나 | Operator Preset 고정 판·project/app assignment 초안, approval request | 사람이 승인한다 |
| CE-4 | lophn에게 일을 넘긴다 | 원래 사람 요청, 근거 판 | 무엇을 | 받는 실행의 출처 | 받는 실행이 시작한다 |

## lophn agent — Operator (OP)

| ID | 일 | 읽을 것 | 판단할 것 | 쓸 것 | 확인 방법 |
|---|---|---|---|---|---|
| OP-1 | 담당 project/app에서 반복 판단을 한다 | 고정 Preset 판이 고른 context 문서, 승인된 앱의 읽기 명령 결과 | 무엇이 바뀌었나, 판단 | 남길 문서의 새 버전(바뀐 게 없으면 없음) | 산출물이 생긴다. 반복 실패하면 멈춘다 |

## machine (M)

| ID | 일 | 읽을 것 | 쓸 것 |
|---|---|---|---|
| M-1 | 추적 파일의 변화를 버전으로 만든다 | 추적 파일 | 문서 버전 |
| M-2 | 목차와 검색을 만든다 | 문서 버전 | 파생물 |
| M-3 | 앱을 돌린다(시작, automation, 재시작) | blueprint, 앱 권한 | 실행 기록 |
| M-4 | 오류를 모아 문제로 묶는다 | 앱 보고, 처리 안 된 예외, 피드백 | 문제, snapshot |
| M-5 | 문제 닫힘을 판정한다 | test result, 재발 여부, 사람의 확인 | 문제 상태 |
| M-6 | 앱 권한을 강제한다 | 부여된 권한 | 거절 기록 |
| M-7 | Operator를 주기에 맞춰 깨운다 | assignment, 주기 | agent run 접수 |
| M-8 | 티켓 acceptance check를 검사한다 | 티켓, 테스트 실행 | 검사 결과 |
| M-9 | 반복 실패하는 agent assignment를 멈춘다 | 실행의 끝 결과 | 멈춤 |
| M-10 | 컨텍스트의 watch 항목에서 바뀐 부분을 알린다 | watch 항목, 새 버전 | watch 변화 |
| M-11 | 승인된 release를 적용한다(데이터 변경, 시작 확인) | release, 승인 | activation 결과 |
| M-12 | 문제 보고 기능이 빠진 release를 막는다 | blueprint, app test 결과 | 거절 |
| M-13 | 테스트를 실행해 기록한다(app test, reproduction test, test command) | 실행 묶음 | test result |
| M-14 | 결정된 승인을 전달해 한 번만 쓰이게 하고, 고른 선택지의 동작을 적용한다 | 결정된 승인·질문 | 적용 결과 |
| M-15 | notification 계기 표의 이벤트로 notification을 만든다 | 이벤트 | notification |
| M-16 | 기한이 지나거나 원래 일이 끝난 질문·approval request를 끝낸다 | 질문, approval request | 끝 상태 |
| M-17 | lophn agent의 도구 호출을 허용 / 물어봄 / 거부로 판정한다 | assignment, 도구 규칙 | 판정 |
| M-18 | 끊긴 agent run을 확인하고 잇는다 | 실행 | 재개 또는 끝 |
| M-19 | 대화를 이어 갈 요약을 준비한다 | 대화 | 요약 |
| M-20 | 티켓 claim의 만료와 연결 회수를 처리한다 | claim 기한, 연결 | claim 놓기 |

## 앱 (APP)

| ID | 일 | 쓸 것 |
|---|---|---|
| APP-1 | 선언한 문제 코드로 문제를 보고한다 | 보고 |
| APP-2 | 선언한 문서를 남긴다 | 문서 버전 |

## 제품 기본 agent와 자료 경계

전역 lophn·Context Engineer는 각각 하나, App Engineer는 앱마다 하나, Operator는 project/app마다 0개 이상이다. 네 역할 모두 제품 기본 Preset에서 사람의 새 판을 구성할 수 있다. context·capability·MCP·skill·계정·model은 Preset 구성, 실제 대상·출력·주기는 assignment다. Agent는 LOPHN.md를 직접 쓰지 않고 question으로 제안한다. (lophn-agent/assignments#R2, lophn-agent/presets#R1, lophn-agent/presets#R9, lophn-agent/instructions#R3)
