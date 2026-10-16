# spec index (2026-10-15)

구현에 앞서 쓸 spec의 목록과 쓰는 법이다. 모든 요구에 spec을 두지 않는다. 한 번에 다 쓰지 않고, 하나씩 절마다 확인하며 천천히 정확하게 쓴다.

## 1. 언제 spec을 쓰나

코드가 맞는 곳에서는 코드가 spec이다. 그래서 spec은 **코드가 spec 노릇을 못 하는 곳에만** 쓴다.

아래 넷을 함께 따져 정한다. 점수를 매기는 공식이 아니다.

- **코드가 spec 노릇을 못 하는가.** 새로 생긴 것은 코드가 없고, 바뀐 것은 코드가 옛 모델이라 읽으면 옛것을 다시 짓는다. 그대로인 것은 지금 코드가, 덜어내는 것은 `../changes.md`의 지울 목록이 그 노릇을 한다.
- **여러 부품이 같은 모양에 합의해야 하는가.** 요구는 경계마다 자기 보장만 말한다. 부품 사이에 오가는 모양(봉투, 표, 상태, 순서)은 어느 요구에도 속하지 않는다. package 하나 안에서 끝나면 요구와 구현자의 판단으로 충분하다.
- **요구로 쓸 수 없는 결정이 대화에만 있는가.** 구조, 기각한 대안, 그 이유. 지금은 `../docs-review.md`에만 있어 잃기 쉽다.
- **틀리게 지으면 비싼가.** 여러 package를 다시 고쳐야 하는 일.

예: config 선언 모델과 secret 파일 저장은 바뀌었지만 package 하나 안의 일이라 spec을 쓰지 않는다. 다만 설정 변경을 쓰는 요소에 알리는 길과 secret 파일을 읽는 process는 여러 process에 걸리므로 리팩터링 계획(`../../plan/README.md` 3장)에서 정한다(`../inventory/00-decisions.md` C).

## 2. spec에 담을 것

단위는 요구 파일이나 catalog 요소가 아니라 **여러 경계가 함께 쓰는 장치나 경로 하나**다.

| 담는다 | 담지 않는다 |
|---|---|
| 부품과 소유 | 요구 문장의 되풀이(요구는 ID로 건다) |
| 함께 쓰는 모양(type, 표, 봉투) | 세부 수치 |
| 상태와 전이 | UI 배치 |
| 부품을 가로지르는 흐름 | module 안의 구현 |
| 지울 옛 것 | |
| 기각한 대안과 이유(짧게) | |

## 3. 진행 방식

- spec은 한 번에 하나씩 쓴다. 절마다 사람 확인을 받고 다음 절로 간다.
- 상태: **쓸 것** → **초안** → **확인 중** → **확인됨**. 이 index의 4장 표에 적는다.
- 재료는 accepted 요구, `../architecture/`, `../../products/AGENT-ROLE.md`, `../docs-review.md`, `../changes-by-topic.md`다. 지금 코드는 옛 모델이 무엇인지 확인하는 데만 본다.
- 쓰다가 요구와 어긋나는 것을 찾으면 spec에서 덮지 않는다. 요구를 고치는 표를 내고 확인을 받는다.

## 4. 목록

| # | spec | 다루는 것 | 상태 |
|---|---|---|---|
| S1 | event | domain event, agent event, Bus, Reactor, Router, Gateway, renderer 쪽 계약 | 확인됨(`event.md`) |
| S2 | approval과 grant | grant 셋, Gate 함수, request 두 길 | 확인됨(`approval.md`) |
| S3 | agent call | 봉투, 받는 곳, 답 방식과 상태, grant, transport 둘, tool | 확인됨(`agent-call.md`) |
| S4 | agent definition | 정의의 구성, 공통 tools, role별 tools, instructions, prompt assemble, commands | 확인됨(`agent-definition.md`). lophn의 file tool 범위만 S8 |
| S5 | 앱 호출 경로와 rewind | core를 거치는 app-api 호출, invocation 기록, changeset 저장과 역적용, grant 판정 지점 | 확인됨(`app-call.md`) |
| S6 | coding agent 연결 | harness adapter, 터미널 탭 TUI, hook 신호, token 수명, CLI 명령, ticket·claim·완료 보고와 call 상태 | 확인됨(`coding-agent.md`) |
| S7 | release와 activation | ticket 확인됨에서 activation 열기, 선언 비교, migration이 있을 때만 하는 일(복구본, data를 잃는 migration), drain | 확인됨(`activation.md`) |
| S8 | place와 session 수명 | assignment → place, session 열기·닫기·되살리기, session rewind와 앱 rewind 잇기 | 확인됨(`place-session.md`) |
| S9 | 앱 화면 annotation | annotate mode 고르기, annotation 값, screenshot, 받는 session, App Engineer에게 들어가는 꼴, 저장과 ticket 근거 | 확인됨(`annotation.md`). 화면은 wireframe |

추천 순서는 S4 → S5 → S6이다. S4가 Operator의 앱 tool(S5와 닿음)과 App Engineer의 맡기기 tool(S6과 닿음)을 먼저 정하면 나머지 둘이 그에 맞춰 붙는다. S1~S3은 S4~S6의 재료라 쓰는 중에 필요한 만큼 spec 꼴로 옮긴다.

### S4. agent definition

| 절 | 담을 것 |
|---|---|
| 정의의 구성 | agent 하나 = role, place, model, 지침 층, tools, skills(role마다 내장된 skill 포함), MCP, commands, agent grant. 각 항목이 lophn이 고정하는 것(built-in)인지, 사람이 agent 설정에서 고치는 것인지, place마다 다른 것인지 |
| 공통 tools | 모든 agent의 tool 목록. tool마다 효과(read, write, external)와 Gate 판정. 예: 파일 읽기·쓰기, 검색, shell, web 검색·읽기, call·reply·cancel, 사람에게 묻기, grant 안의 앱 tool |
| role별 tools | AGENT-ROLE의 책임 줄에서 나온다. App Engineer, Operator, Project Manager, lophn. 지울 옛 tool도 적는다 |
| instructions | 층과 순서(built-in role 지침, 전역, project `LOPHN.md`, agent 지침), 누가 고치는지, built-in 지침에 꼭 들어갈 규칙(AGENT-ROLE T19 같은 agent 지침 규칙). 지침 본문 전체는 쓰지 않는다 |
| prompt assemble | 무엇이 어떤 순서로 들어가는지(지침, tool, skill 목록, place 정보). Router 입력(사람 메시지, call, reaction, coding agent 메시지)마다 들어가는 꼴. compact. 넣지 않는 것(요약용 model, 앱 화면 상태) |
| commands | 종류 셋: harness가 바로 실행(compact, recap), 정해진 prompt를 agent에게 보냄(init), skill 실행. 범위: 전역 built-in, role built-in, skill. role마다 내장되는 skill. built-in 목록과 command를 정의하는 꼴 |

- 재료: req-1489(command 세 종류), shell req-0093(`/` 메뉴의 세 범위), 0036·0037(`LOPHN.md`), 0038(설정 층), 0039(model), 0095, 0098, 0099(skill), 0035, 0041, 0042(Project Manager), 1490, 1499~1505(call), AGENT-ROLE 전체.
- 조사: 다른 coding agent와 harness가 tools, role별 tools, 지침, prompt assemble, commands, skills를 어떻게 하는지 먼저 조사하고 참고한다(`../research/agent-def-*.md`). Claude Code의 prompt assemble은 실제 요청 캡처 `../claude-code-prompt-assembly copy.md`를 본다. 좁은 조사 다섯(`../research-items.md` R2~R6): `../research/non-human-input.md`, `call-target-discovery.md`, `app-api-tools.md`, `instruction-changes.md`, `ask-human-tool.md`. 사람 조사 `../claude-code-cross-session-messaging.md`.
- 옛 요구 주제: lophn-agent의 harness/tools, harness/prompt-assemble, harness/tool-judgment, commands, instructions, extensions, roles/*.
- 지금 코드(옛 모델 확인용): `packages/core/lophn-agent/`의 `tools`(handoff, 문서 tool이 남아 있다), `prompt-assembly`, `commands`, `instructions`, `roles`.
- 정한 것(2026-10-15): file·shell·web tool은 sandbox를 따로 두지 않고 Gate도 거치지 않는다. lophn agent는 coding agent보다 직접 하는 일이 적고, place가 범위를 정한다. sandbox를 spec(S9)으로 두려다 거뒀다. 조사한 사실은 `../research/sandbox-harnesses.md`.

  | 대상 | 규칙 |
  |---|---|
  | file 읽기·쓰기·검색 | place 폴더 안에서만. 묻지 않는다. 밖을 가리키는 경로와 밖으로 나가는 symlink는 거절한다(S4의 결정. req-1475는 사람의 문서 열기에 대한 것이고 rejected다) |
  | `LOPHN.md` 같은 지침 쓰기 | S2의 설정 고치기로 묻는다 |
  | shell(code run) | place 폴더를 작업 폴더로 띄운다. OS sandbox와 묻기 없음. 환경 변수는 필요한 것만 넘기고 lophn token과 secret은 넣지 않는다 |
  | web 검색·읽기 | read. 묻지 않는다 |
  | 앱 data | app-api로만(Gate, 앱 rewind). 지침에 "앱 DB를 직접 열지 않는다" |
  | 되돌리기 | file tool로 바꾼 파일만(req-0044) |

- 걸리는 정할 것:
  - role 내장 skill을 사람이 끌 수 있는지(skill은 전역과 project 층에서 끌 수 있다는 요구와의 관계).
  - place 정보: prompt에 넣을 place 정보는 S8에 걸린다.

### S5. 앱 호출 경로와 rewind

- 재료: req-0887(core를 거치는 호출), 0893, 0894(invocation 기록), 1496, 1497, 0821(rewind), 0859, 0860, 1492(grant 판정), 0802, 0915(다른 앱 호출 선언), 0850, 0853~0857(앱 process), `../architecture/approval.md` 5장(rewind: invocation, changeset, 시점 단위. S2에서 옮겨 옴).
- 옛 요구 주제: apps/connections, invocations, runtime, permissions, blueprint의 효과.
- 지금 코드: `packages/core/apps/revert`, `packages/core/apps/permissions`, SDK `withRevert`, blueprint의 `revert`·`confirm` 칸.
- 확인함: req-0922는 이미 "통로"를 "호출"로 고쳐 두었다.
- project 범위 app-api(req-1511~1515, 2026-10-15): core가 호출 경로에서 부른 쪽의 project를 넣는 지점, 앱 사이 호출에서 project를 넘기는 것, invocation의 project 기록. 앱 화면을 project로 여는 것(req-1515).

### S6. coding agent 연결

- 재료: req-1050~1052, 1054, 1056, 1061~1064, 1067(연결과 token), 1091, 1095, 1098, 1099, 1101(session), 1216, 1491(CLI), 1454(App Engineer 입력), core-app-tickets 0728~0749, `../architecture/agent-call.md`의 transport.
- 옛 요구 주제: coding-agent의 connection, sessions, mcp-server, tickets, repair-context.
- 지금 코드: `packages/coding-agent/`(mcp-server 포함), CLI.

### S7. release와 activation

- 재료: req-1507(ticket 확인됨이 activation을 엶), 1508(drain), 0825(묻는 조건), 0830, 0832(이전 release로 돌아가기), 0952, 0954, 0957, 0960, 0961(migration과 복구본), 0806, 0811, 0812, 0817, 0818, 0193(release 준비).
- 정할 것: ticket 확인됨이 activation을 여는 방법(domain event로 둘지 등), data를 잃는 migration(DB 사본에서 재고 물을지, 복구본을 다음 activation까지 남기고 묻지 않을지). migration이 없는 release는 선언 비교만 한다.
- 쓰기로 한 이유: activation이 releases, app-runtime, app-data, approvals, app-tickets에 걸치고, 순서(접수 닫기, 비우기, 교체, 다시 열기)를 여러 부품이 지켜야 한다.

### S8. place와 session 수명

- 재료: req-0030~0032(place), 0043~0045(session), AGENT-ROLE place 절과 정할 것.
- 먼저 정할 것: App Engineer가 앱 place마다 하나인지, 새 앱의 App Engineer가 어디 놓이는지, req-0044(session rewind와 앱 rewind 잇기).

## 5. 쓰지 않는 것

`../changes-by-topic.md` 기준이다.

- 그대로 20개 주제: 지금 코드가 spec이다.
- 아예 덜어냄 6, 일부 덜어냄 28: `../changes.md` 3장의 지울 목록이면 된다.
- 보류 5: 만들지 않는다.
- 바뀌었지만 package 하나 안의 일: config 선언, secret 파일, problems 축소, contexts의 md 목차 parser, projects. 요구와 `../changes.md` 4장으로 간다.

## 6. 정할 것

- **위치:** spec이 확인되면 `project-docs/specs/`로 옮길지. 리팩터링 계획의 정할 것 1(project-docs를 코드 저장소에 넣기)과 같이 정한다.
- **수명:** 구현이 끝나 코드와 test가 spec 노릇을 하면, spec에는 코드가 말하지 못하는 것(구조의 이유, 기각한 대안)만 남길지.
