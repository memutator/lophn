---
type: domain-model
concerns: [lophn-agent/commands]
---
# lophn-agent/commands

Agent composer의 `/` 메뉴가 쓰는 명령 registry의 값을 정의한다. 독립 entity와 ID, 저장하는 표, ledger event는 없다. registry는 코드의 built-in 목록과 resolved agent에서 매번 계산하는 derived 값이고, 명령을 실행한 결과는 각 동작의 concern이 이미 기록하는 command·message로 남는다.

## CommandEntry (값)

메뉴 한 줄이다. 세 출처가 같은 모양을 쓴다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | 문자열 | 아니오 | 슬래시 없이; `[a-z0-9-]` 1~64자; 같은 `source`와 agent 안에서 unique | 부르는 이름 |
| `title` | 문자열 | 예 | 화면 말(영어); built-in·role 명령에만 쓰는 메뉴 제목(예: New session), `source=skill`이면 null | 메뉴에 보이는 이름 |
| `description` | 문자열 | 아니오 | 한 줄; skill은 SkillEntry의 설명 | 메뉴 설명 |
| `source` | `builtin / role / skill` | 아니오 | 아래 세 묶음 | 출처 |
| `skill_origin` | `place / workspace` | 예 | `source=skill`에만; 같은 이름이 둘 이상일 때만 메뉴에 보임; extensions의 `source_kind`에서 `place`는 place, `registered`·`personal`·`bundled`는 workspace로 접는다 | skill을 찾은 층 → lophn-agent/extensions |
| `while_running` | `run / queue / blocked` | 아니오 | 아래 정책 | 작업 중 사용 가능 여부 |
| `action` | CommandAction | 아니오 | `source`와 맞는 가지만 | 실행 방식 |

### CommandAction

| `kind` | 필드 | 뜻 |
|---|---|---|
| `builtin` | `id` | 코드가 아는 동작 하나(전역 built-in) |
| `prompt` | `template` | 정한 prompt를 사람이 보낸 메시지로 접수(role별 built-in) |
| `tool` | `tool` | 정한 tool 하나를 실행(role별 built-in, 현재 판정을 받음) |
| `skill` | `skill_name` | 그 skill을 이번 요청에 쓰라는 사람의 메시지로 접수 |

role별 built-in은 `prompt`나 `tool` 중 하나다. 전역 built-in은 `builtin`, skill은 `skill`만 쓴다.

## 묶음과 첫 목록

registry 목록은 세 묶음으로 보인다. 한 묶음 안의 순서는 아래 표의 고정 순서다(알파벳순이 아님). skill 묶음은 이름 영문 사전순이다.

### Commands (`source=builtin`, 모든 agent 공통)

| 순서 | `name` | `title`과 설명 | `while_running` | `action` |
|---|---|---|---|---|
| 1 | `new` | New session — Start a new session with this agent | run | builtin |
| 2 | `rename` | Rename — Rename this session | run | builtin |
| 3 | `archive` | Archive — Archive this session | run | builtin |
| 4 | `compact` | Compact — Summarize this session to free up context | queue | builtin |
| 5 | `fork` | Fork — Copy this session into a new one | blocked | builtin |
| 6 | `mcp` | MCP — Show MCP server status | run | builtin |
| 7 | `skills` | Skills — Turn skills on or off for this agent | run | builtin |
| 8 | `permissions` | Permissions — Change what this agent may do | run | builtin |

Feedback은 보낼 곳이 없어 두지 않는다. model·속도 명령도 두지 않는다 → lophn-agent/harness/model.

### <agent 이름> (`source=role`, 그 agent의 role에서만)

| role | `name` | `title`과 설명 | `while_running` | `action` |
|---|---|---|---|---|
| lophn | `new-app` | New app — Start a new app in this project | queue | prompt |
| lophn | `repair-app` | Repair app — Find and fix what broke in an app | queue | prompt |
| Context Engineer | `check-contracts` | Check contracts — Check every context against its documents | queue | prompt |
| Context Engineer | `new-context` | New context — Set up a new context with you | queue | prompt |
| App Engineer | 없음 | | | |
| Operator | 없음 | | | |

role 명령이 없는 agent는 이 묶음이 보이지 않는다. role 명령을 더하는 자리는 role마다의 목록 하나다.

### Skills (`source=skill`)

그 agent의 resolved skill 목록 → lophn-agent/extensions. `description`은 SkillEntry의 설명, `while_running`은 `queue`, `action`은 `skill`이다. 출처 badge는 보이지 않는다.

## 정책

- **registry는 계산이다.** 열 때마다 코드의 built-in·role 목록과 그 agent(resolved agent)가 쓸 수 있는 skill에서 만든다. 저장하는 표가 없고 사용 횟수도 남기지 않는다.
- **세 종류.** 메뉴에는 전역 built-in, 그 agent의 role별 built-in, skill만 뜬다. 다른 harness의 명령 파일·plugin·MCP prompt는 가져오지 않는다.
- **이름 예약.** 전역 built-in 이름과 그 agent의 role 명령 이름은 예약이다. `source=skill`의 이름이 같으면 그 skill은 `/` 목록에서 빠지고 `/`로는 built-in만 불리며, 목록 결과의 `notices`에 `reserved_name`(그 skill 이름과 "built-in과 이름이 같아 `/`로 부를 수 없다")이 붙는다. role 명령 이름은 그 role의 agent에서만 예약이다. skill의 읽기·제공은 그대로다 → lophn-agent/extensions.
- **같은 이름 skill.** `source=skill` 이름이 같은 항목이 둘 이상이면 모두 메뉴에 올리고 `skill_origin`을 보여 구분한다. 이름만 제출하면 하나일 때만 실행하고 둘 이상이면 실행하지 않고 고르게 한다. 둘이 한 목록에 올라오는 것은 lophn-agent/extensions가 같은 이름을 하나로 줄이지 않은 경우뿐이다.
- **필터와 정렬.** built-in은 고정 순서다. 입력한 글자는 이름 시작·단어 시작과 설명에 맞춘다. 맞는 명령이 없는 묶음은 숨긴다. 맞는 명령이 하나도 없는 `/…` 제출은 명령으로도 일반 메시지로도 접수하지 않고 알 수 없는 명령으로 알린다.
- **작업 중.** `while_running`은 run이 `running`이거나 `waiting_user`일 때 쓴다. `run`은 바로 실행하고 `queue`는 이번 run이 정상 종료한 뒤 다음 요청처럼 실행하며(→ lophn-agent/conversation의 다음 일 규칙) `blocked`는 흐리게 보이고 이유를 말한다. 실패·멈춘 뒤에는 대기 중이던 `queue` 명령을 자동으로 실행하지 않는다.
- **인자.** `/이름` 뒤에 띄어 쓴 글은 그 명령의 인자다. built-in은 받지 않으면 버리고, role 명령의 prompt와 skill은 그 글을 사람이 보낸 요청에 붙여 접수한다.
- **실행.** `builtin`은 해당 concern의 동작을 사람의 행동으로 부른다. `prompt`·`skill`은 사람이 보낸 메시지로 접수하고 `tool`은 정한 tool 하나를 일반 호출처럼 실행한다. 어느 경우도 권한·승인·상한을 넓히지 않고 현재 판정을 받는다 → lophn-agent/harness/tool-judgment.
- **설정은 명령이 저장하지 않는다.** Skills 명령은 그 agent 정의의 끈 skill을 사람이 바꾸는 입구이고 MCP 명령은 연결 상태를 보여 줄 뿐이다. 저장과 연결은 각 concern이 한다 → lophn-agent/extensions.
