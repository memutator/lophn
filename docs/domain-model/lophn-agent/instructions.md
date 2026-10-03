---
type: domain-model
concerns: [lophn-agent/instructions]
---
# lophn-agent/instructions

LOPHN.md의 파일 자리·층·읽은 판과 preset 연결 값을 정의한다. 새 entity·ledger 표를 만들지 않고 파일·Document·Version 정본은 → documents/file-tracking, documents/versions다.

## InstructionLocation (값)

| 층 | 파일 자리 | 적용 조건 |
|---|---|---|
| global | `~/.lophn/LOPHN.md` | 모든 call |
| project | `<project 폴더>/LOPHN.md` | 작업 자리가 project 또는 그 안의 app |
| app | `<앱 자리>/LOPHN.md` | 작업 자리가 app |

앱 자리와 project 관계는 → apps/registration, documents/projects다. agent runtime이 cwd로 추측하거나 부모 폴더를 순회하지 않는다. LOPHN.md와 coding-agent/guides의 AGENTS.md는 별개다. 파일 부재는 지침 없음이며 빈 파일을 machine이 만들지 않는다. 파일 생성·복원은 사람이 편집기에서 저장하는 documents contract다.

## InstructionAttachment (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | Document ID | 아니오 | 사람이 고른 UTF-8 Markdown 지침 파일 연결 문서 | preset에 붙인 지침 |

Preset.instructions 배열 순서가 적용 순서다. 연결한 파일의 최신 확정 Version은 call마다 다시 읽으며 목록 변경은 Preset 새 판이다. global/project/app에 이미 포함한 같은 document는 다시 넣지 않고 첫 층 근거만 남긴다. 지침으로 표시한 문서는 agent 문서 write 대상에서 제외한다. 이 contract의 지침 읽기만은 역할의 일반 자료 선택과 별도 허용하지만 같은 문서의 주소·연결 자료를 따라 읽는 권한을 만들지 않는다.

## InstructionLayer (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `global / project / app / preset` | 아니오 | 이 순서; preset 안 배열 순서 | 층 |
| `document / version` | Document ID / Version ID | 예 | 파일 있으면 확정 판 필수; 존재해야 하는 preset 첨부가 사라졌으면 unavailable; 경로 층 파일 부재면 둘 다 null | 읽은 지침 판 |
| `source_hash / transmitted_hash` | sha256 각각 | 예 | 판 원문·redaction/전송 포장 근거; 부재면 null | 원문과 전송 구별 |
| `status` | `present / absent / unavailable / invalid / too_large` | 아니오 | absent만 자동 생략 가능 | 읽기 결과 |
| `bytes` | 0 이상 정수 | 예 | 포장 전 UTF-8 byte; absent면 0 | 크기 검사 |

같은 call의 층·판·본문은 한 번 resolve한 고정 snapshot이다. call 준비 중 파일이 바뀌면 documents CAS·version으로 한 판을 고르고 새 판은 다음 call에서 읽는다. 실패 상태면 해당 call을 전송하지 않는다. 원문은 문서 version이며 별도 instruction blob 정본을 만들지 않는다. 실제 전송 snapshot은 ModelCall.context_basis/input에 남는다.

## 작업 자리와 적용

- 작업 자리는 → lophn-agent/conversation의 WorkPlace다. App Engineer는 맡은 app, Operator는 Assignment.scope의 project/app이다. lophn·Context Engineer는 세션 개설 자리이며 탭 이동·handoff 글로 바뀌지 않는다.
- global → project → app → preset 첨부 순이다. 더 좁은 지침이 앞 지침을 구체화하지만 제품 공통/역할 고정 규칙·권한·approval·현재 사람 요청보다 우선하지 않는다.
- 지침 파일 하나 32768 UTF-8 bytes, 모든 층 합산 131072 bytes(포장 전)다. 빈 파일은 빈 사람 지침이며 부재와 구별한다. 인코딩 오류·상한 초과·존재 파일 읽기 실패는 자동 생략이나 truncation 없이 call 차단이다. model 입력 한계가 더 좁으면 → lophn-agent/harness/prompt-assemble의 보호 입력으로 처리한다.
- 매 model call 직전에 현재 확정 version을 읽는다. preset 구성 판은 RunBasis에 고정하되 파일 내용은 ContextBasis에 call마다 고정하므로 진행 중 사람 편집도 다음 call부터 따른다. 지침 변경은 cache prefix를 새로 만든다.
- organizing call에도 같은 지침 층을 넣고 새 판단 생성은 금지한다. 실제 원문 요약 범위는 prompt-assemble가 정한다.

## 편집과 권한

[Instructions]는 shell/editor의 원본 파일 편집을 연다. 저장·version 확정·파일 반영은 documents의 서로 다른 사실이다. agent는 파일·문서 새 Version·첨부 연결을 직접 바꾸지 않고 question으로 초안만 제안한다. 사람의 명시 편집·저장 또는 선택으로 적용하며 actor=user다. 지침 파일에 secret을 넣지 않도록 안내하고 실제 전송은 platform redaction을 통과한다. 지침 편집 자체가 tool 권한이나 approval 사용을 만들지 않는다.

## command·event·ledger 표

독립 instruction command·event·표는 없다. 편집·복원·변경 이력은 documents, 첨부 목록 변경은 Preset, 작업 자리 변경은 Session, prompt 근거는 ModelCall owner contract를 쓴다.
