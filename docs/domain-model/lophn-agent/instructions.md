---
type: domain-model
concerns: [lophn-agent/instructions]
---
# lophn-agent/instructions

LOPHN.md의 파일 자리·층과 매 call 읽은 값을 정의한다. LOPHN.md는 document·version을 쓰지 않는 그냥 파일이다. 새 entity·ledger 표를 만들지 않고 agent instructions(agent 정의 본문)의 저장은 → lophn-agent/agents다.

## InstructionLocation (값)

| 층 | 파일 자리 | 적용 조건 |
|---|---|---|
| global | `~/.lophn/LOPHN.md` | 모든 call |
| project | `<project 폴더>/LOPHN.md` | 작업 자리가 project 또는 그 안의 app; 그 project의 모든 role·agent가 공유 |
| app | `<앱 자리>/LOPHN.md` | 작업 자리가 app |
| agent | agent 정의 파일 본문 | 그 agent로 도는 call (agent instructions) |

앞 셋은 파일이고 마지막은 agent 정의의 본문이다. 앱 자리와 project 관계는 → apps/registration, documents/projects, agent 정의 파일은 → lophn-agent/agents다. agent runtime이 cwd로 추측하거나 부모 폴더를 순회하지 않는다. LOPHN.md와 coding-agent/guides의 AGENTS.md는 별개이며 lophn agent는 AGENTS.md를 읽지 않는다. 파일 부재는 지침 없음이며 빈 파일을 machine이 만들지 않는다. 파일 생성은 사람이 문서 editor에서 처음 저장하는 일이다. 이 파일들은 document·Version 정본이 아니며 저장 이력이나 판 id를 만들지 않는다.

## InstructionLayer (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `global / project / app / agent` | 아니오 | 이 순서 | 층 |
| `source_hash / transmitted_hash` | sha256 각각 | 예 | 읽은 파일(본문) 내용의 hash / redaction·전송 포장 뒤 hash; 부재면 null | 원문과 전송 구별 |
| `status` | `present / absent / unavailable / invalid / too_large` | 아니오 | absent만 자동 생략 가능 | 읽기 결과 |
| `bytes` | 0 이상 정수 | 예 | 포장 전 UTF-8 byte; absent면 0 | 크기 검사 |

같은 call의 층·내용은 call 준비 때 한 번 읽은 고정 snapshot이다. 읽는 동안 파일이 바뀌어도 한 번 읽은 내용만 쓰고 새 내용은 다음 call에서 읽는다. 실패 상태면 해당 call을 전송하지 않는다. 원문 정본은 파일 자체이고 별도 instruction blob 정본을 만들지 않는다. 과거 call이 실제로 받은 내용은 ModelCall.context_basis/input에 남는 전송 snapshot으로 재현한다.

## 작업 자리와 적용

- 작업 자리는 → lophn-agent/conversation의 WorkPlace다. App Engineer는 맡은 app, Operator는 Assignment.scope의 project/app이다. lophn·Context Engineer는 세션 개설 자리이며 탭 이동·handoff 글로 바뀌지 않는다.
- global → project → app → agent 순이다. 더 좁은 지침이 앞 지침을 구체화하지만 제품 공통/역할 고정 규칙·권한·approval·현재 사람 요청보다 우선하지 않는다. built-in의 role prompt는 사람 지침이 아니라 제품 규칙이며 → lophn-agent/harness/prompt-assemble이 따로 넣는다.
- 지침 파일 하나(agent instructions 포함) 32768 UTF-8 bytes, 모든 층 합산 131072 bytes(포장 전)다. 빈 파일은 빈 사람 지침이며 부재와 구별한다. 인코딩 오류·상한 초과·존재 파일 읽기 실패는 자동 생략이나 truncation 없이 call 차단이다. model 입력 한계가 더 좁으면 → lophn-agent/harness/prompt-assemble의 보호 입력으로 처리한다.
- 매 model call 직전에 LOPHN.md 파일과 agent 정의 본문을 다시 읽는다. 읽은 층·hash는 ContextBasis에 call마다 고정하므로 진행 중 사람 편집도 다음 call부터 따른다. 지침 변경은 cache prefix를 새로 만든다.
- organizing call에도 같은 지침 층을 넣고 새 판단 생성은 금지한다. 실제 원문 요약 범위는 prompt-assemble가 정한다.

## 편집과 권한

- 전역·project·app의 [Instructions]는 shell/editor의 문서 editor로 해당 LOPHN.md를 연다. 저장은 파일에 쓰는 일이며 lophn이 따로 이력을 만들지 않는다. agent instructions는 agent 정의를 저장하는 일(→ lophn-agent/agents)이다.
- agent는 LOPHN.md 파일과 agent 정의 본문을 직접 바꾸지 않고 question으로 초안만 제안한다. 사람의 명시 편집·저장 또는 선택으로 적용하며 actor=user다. 지침 파일은 agent 문서 write 대상에서 제외한다. 이 contract의 지침 읽기만은 역할의 일반 자료 선택과 별도 허용하지만 같은 파일의 주소·연결 자료를 따라 읽는 권한을 만들지 않는다.
- 지침 파일에 secret을 넣지 않도록 안내하고 실제 전송은 platform redaction을 통과한다. 지침 편집 자체가 tool 권한이나 approval 사용을 만들지 않는다.

## 화면

agent 설정(Operator editor, built-in 열기)은 Instructions를 두 겹으로 같이 보인다. 위에는 읽기 전용으로 그 project의 LOPHN.md(첫 몇 줄, "모든 role·agent가 공유")와 [Edit LOPHN.md], 아래에는 이 agent의 instructions 편집기다. agent는 project 지침을 먼저 읽고 agent 지침을 뒤에 읽는다고 한 줄로 알린다. built-in은 읽기 전용인 built-in instructions 줄이 더 있다. [Edit LOPHN.md]는 문서 editor를 열고 agent instructions는 agent 설정의 [Save]로 저장한다. 화면 모양은 → shell/desktop, shell/app-frame이다.

## command·event·ledger 표

독립 instruction command·event·표는 없다. 지침 파일 편집은 문서 editor, agent instructions 저장은 agent 정의, 작업 자리 변경은 Session, prompt 근거는 ModelCall owner contract를 쓴다.
