---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# architecture

lophn을 **어떤 프로세스와 저장소로, 어떤 경계로 나눠 만드는가**를 적는다. 무엇을 지켜야 하는지는 [requirements](../requirements/), 무엇을 기억하는지는 [domain model](../domain-model/)이 정한다.

architecture는 최상위 concern 하나에 파일 하나다. 잎 concern까지 내려가지 않고, 대신 파일마다 **concern 배치표**로 잎 concern이 어느 프로세스·모듈·저장소에서 돌아가는지 적는다. 한 파일이 너무 커지면 그 아래 노드에 파일을 따로 둘 수 있다(예: `architecture/lophn-agent/harness.md`).

| 파일 | concern | 맡는 프로세스 |
|---|---|---|
| [platform.md](platform.md) | platform | core(API, command, ledger writer, read, event 배포, 프로세스 감독), 인증, secret, redaction, backup, 설치 |
| [documents.md](documents.md) | documents | 문서 worker(file watch, hash, version 준비), format 실행, derived store(outline, search) |
| [apps.md](apps.md) | apps | 앱 supervisor, 앱 프로세스(앱마다), direct call 통로, release 준비·적용, automation, 앱 DB |
| [problems.md](problems.md) | problems | 보고 수집, snapshot 조립, test runner |
| [lophn-agent.md](lophn-agent.md) | lophn-agent | agent runtime(run loop, provider adapter, prompt 조립, tool 실행), scheduler, extension(skill, 외부 MCP) |
| [coding-agent.md](coding-agent.md) | coding-agent | MCP server(stdio), CLI, skill과 안내 파일, repair context 조립 |
| [shell.md](shell.md) | shell | Electron main, lophn 화면, confirmation window, 앱 화면 틀, 편집기 |

---

## 1. 출발점

이전 lophn에서 배운 것이다([다시 시작하며 정리한 논의](../../restart-notes.md)).

1. **병목의 원인은 "쓰는 주체가 하나"가 아니었다.** ledger와 무관한 무거운 일(파일 수천 개 순회, hash)이 daemon의 실행 흐름 안에서 동기식으로 돌았고, ledger를 쓸 필요가 없는 일(앱 조회)까지 daemon을 거쳤다.
2. **그 해법으로 ledger를 여러 개로 쪼갠 것(앱별 host journal, lease, 실행 허가 단계, 토큰 다섯 종)은 과했다.**
3. **경로 이름이 시기를 말했다**(`m1/`, `v2/`, `w07_`). 같은 일을 하는 코드가 흩어졌다.

그래서: **ledger는 하나, 쓰는 주체도 하나. ledger를 쓰지 않는 일은 절대 그 주체의 실행 흐름에 올리지 않는다.**

## 2. 원칙

- **A1 ledger 하나, writer 하나.** lophn이 기억하는 사실은 ledger 하나에 있고, 쓰는 것은 core의 command 처리 하나뿐이다. command는 짧다.
- **A2 core의 실행 흐름은 막히지 않는다.** core 안에서 동기 파일 I/O, 디렉터리 순회, 큰 파일 hash, 네트워크 호출, model 호출, 앱 실행, test 실행, 압축을 하지 않는다. 그런 일은 별도 프로세스가 하고, 결과만 비교 기준과 함께 command로 낸다.
- **A3 read는 write 줄을 거치지 않는다.**
- **A4 앱 호출은 core를 거치지 않는다.** 앱 화면과 command 호출은 호출자에서 앱 프로세스로 바로 간다. invocation은 뒤따라 비동기로 적힌다. 예외는 하나, 사람 확인이 필요한 command(confirm)는 실행 직전에 접수와 approval 한 번 사용을 한 command로 확정한다(→ apps/invocations).
- **A5 앱의 업무 데이터는 앱의 것.** 앱 DB는 그 앱 프로세스만 쓴다.
- **A6 derived는 ledger 밖.** outline, search index는 지우고 다시 만들 수 있는 파일로 두고 event seq를 cursor로 따라잡는다.
- **A7 actor는 credential이 정한다.** 요청 본문의 주장은 쓰지 않는다.
- **A8 사람의 결정은 confirmation window에서만.**
- **A9 경계는 contract로만 넘는다.** 다른 구성 요소의 내부(표, 파일, 프로세스 상태)를 직접 만지지 않는다.
- **A10 지금 필요한 것만.** requirements와 domain model에 없는 경우를 위한 프로세스, queue, token 종류, 계층을 미리 만들지 않는다.
- **A11 이름은 하는 일로.** 코드 경로·패키지 이름에 version, milestone, 작업 번호를 넣지 않는다. concern 이름을 쓴다.

## 3. 전체 구성

```
 ┌──────────────────────────── 사람의 컴퓨터 ─────────────────────────────────┐
 │  shell (Electron)                         coding agent (사람이 연 것)       │
 │   ├ main: 사람 token, confirmation window   ├ MCP server(stdio) ┐            │
 │   ├ 화면: lophn 화면                        ├ CLI               ├ connection │
 │   └ 앱 화면 틀(앱 view + [문제 알리기])       └ skill             ┘   token    │
 │        │ 사람 token        │ 앱 통로(direct)        │                         │
 │        ▼                   │                       ▼                         │
 │  ┌──────────── core ──────────────────────────────────────────────────┐      │
 │  │ API(loopback HTTP JSON + WebSocket) → actor·scope                   │      │
 │  │ command 처리(유일한 ledger writer, 짧은 transaction)                  │      │
 │  │ read 경로(별도 연결)   event 배포(seq cursor)   프로세스 감독           │      │
 │  └───┬────────────┬─────────────┬──────────────┬──────────────────────┘      │
 │      │ 결과는 command로          │              │                             │
 │      ▼            ▼             ▼              ▼                             │
 │  문서 worker   test runner   agent runtime   앱 supervisor ── 앱 프로세스(앱마다)│
 │                                                                              │
 │  저장: ledger · blob store · derived store · 앱마다 앱 DB · OS keychain        │
 │        · 사람의 원본 파일 · 앱 source(git)                                     │
 └──────────────────────────────────────────────────────────────────────────────┘
```

## 4. 최상위 사이의 contract

소유 파일이 자세한 모양(입력, 출력, 오류, 보장, 보장하지 않는 것)을 정하고, 다른 파일은 이름으로 가리킨다.

| contract | 소유 | 쓰는 쪽 | 한 줄 |
|---|---|---|---|
| command | platform | 모두 | 짧은 ledger 쓰기 하나. actor는 credential에서, 비교 기준과 idempotency key를 받는다. 변경과 event를 한 transaction에 |
| read | platform | 모두 | write 줄 밖의 ledger 읽기. scope 검사를 거친다 |
| event 구독 | platform | documents, problems, lophn-agent, apps, shell | seq cursor로 따라잡는 구독. 반응은 다시 command로 |
| blob | platform | 모두 | sha256 content-addressed 불변 저장 |
| 인증 | platform | 모두 | token → actor와 scope |
| secret | platform | apps, lophn-agent, shell | 값은 OS keychain에, ledger에는 참조만. 어떤 agent도 값을 받지 않는다 |
| redaction | platform | 모두 | 저장·model 전송·외부 반환 전에 가린다 |
| approval | platform | apps, lophn-agent, coding-agent, shell | 정확한 대상·입력에 묶인 approval request와 한 번 사용 |
| notification | platform | shell | 정해진 event에서만 생기는 notification |
| 파일 준비 결과 | documents | platform | 관측한 파일을 blob과 검사 결과로 준비해 비교 기준과 함께 command로 |
| 파일 쓰기 | documents | shell | 사람의 원본 파일 쓰기. 수정 전 hash 비교, 원자적 교체 |
| format 실행 | documents | documents, apps, coding-agent | format 검사·section 추출의 격리 실행 |
| outline·search 읽기 | documents | lophn-agent, coding-agent, shell | 고정 version을 돌려주는 단계적 읽기와 saved view |
| 앱 통로 | apps | shell, lophn-agent, coding-agent | core를 거치지 않는 앱 화면·command 호출 |
| invocation 전달 | apps | platform | 앱 실행의 시작·끝·거절을 비동기로 command에 싣는다 |
| release 준비·적용 | apps | coding-agent, platform | 고정 묶음, 승인 뒤 적용(데이터 변경, 시작 확인) |
| 문제 보고 | problems | 앱 프로세스(SDK), shell, apps | 보고·exception·feedback을 redaction 뒤 snapshot과 함께 접수 |
| test 실행 | problems | coding-agent, apps | 고정 bundle의 격리 test. 결과는 runner만 기록 |
| agent run | lophn-agent | shell, platform | 사람 요청·주기 회차·handoff를 run으로 접수, 진행, 기다림, 재개 |
| model 호출 | lophn-agent | — | provider로 보내는 호출. credential은 이 경계 안에서만 |
| coding agent 통로 | coding-agent | coding agent | MCP·CLI가 내보이는 읽기·쓰기 |
| confirmation window | shell | platform, apps | 사람의 결정을 받아 command로. option action은 고르기 전에 그대로 보여 준다 |
| 앱 화면 틀 | shell | apps, problems | 앱 view를 감싸고 [문제 알리기]를 둔다 |

contract를 더 만들거나 바꿔야 하면 소유 파일에 쓰고 이 표를 고친다.

## 5. 기술 선택

| 영역 | 선택 | 이유 |
|---|---|---|
| 언어 | TypeScript (strict) | shell, core, 앱, SDK, MCP를 한 언어로 |
| shell | Electron | 창, 앱 view session 분리, 네트워크 정책, 알림, 패키징 |
| core·worker·앱·agent runtime | Deno | 경로·호스트 단위 권한 플래그로 앱 권한을 프로세스 수준에서 강제 |
| ledger | SQLite 파일 하나(WAL), Deno 내장 SQLite | 로컬 단일 사용자, read 연결 여럿과 write 하나 |
| 앱 DB | 앱마다 SQLite 파일 | 격리, backup, 데이터 변경 단위 |
| blob store | sha256 content-addressed 파일 | 불변, 중복 없음 |
| derived store | SQLite FTS5 파일 | 지우고 다시 만들 수 있다 |
| secret | OS keychain | 평문 금지 |
| coding agent 통로 | MCP(stdio), CLI, skill | 특정 coding agent에 묶이지 않는다 |

(기술 선택 유지 여부는 [open-issues.md](../../open-issues.md)의 H6.)

## 6. 코드 배치

- 패키지와 폴더는 concern 이름으로 짓는다(A11).
- concern마다 ledger command와 read를 한 모듈로 모은다. 한 concern의 표는 그 concern의 모듈만 쓴다.
- 최상위 사이 호출은 4장의 contract 모듈을 통한다.
- 테스트는 대상 옆에 둔다.

## 7. 파일 모양

```markdown
---
type: architecture
concerns: [<최상위 concern id>]
---
# <최상위 concern id>

## 1. 맡는 것과 맡지 않는 것
## 2. 프로세스 (무엇이 어떤 프로세스에서 도나, 누가 띄우고 지켜보나, 프로세스 사이 통신. 그림 하나)
## 3. 저장 (ledger 표가 어느 모듈 것인가, 파일·blob·derived·앱 DB·keychain에 무엇을 어디 두나, 경로)
## 4. concern 배치표 (잎 concern마다: 프로세스 | 모듈 | 저장 | 주로 쓰는 contract)
## 5. 내놓는 contract (4장 표에서 이 파일이 소유한 것마다: 입력, 출력, 오류, 보장, 보장하지 않는 것. API 경로나 tool·command 목록처럼 실제 모양까지)
## 6. 쓰는 contract
## 7. 흐름 (대표 흐름 4~6개. 어느 프로세스가 무엇을 하고 어디서 command가 나가나. 순서도)
## 8. 실패와 재시작 (프로세스가 죽거나 결과를 모를 때)
## 9. 이전과 달라진 것 ("이전: … / 지금: … / 이유: …")
```

정하지 않은 것과 충돌은 파일에 쓰지 않고 [open-issues.md](../../open-issues.md)로 모은다.
