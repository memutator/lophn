---
type: screen
concerns: [platform/settings, platform/install-and-update, platform/backup-and-migration, platform/diagnostics, lophn-agent/harness/provider, coding-agent/connection, lophn-agent/extensions]
---
# settings

사람이 provider·연결·백업·진단 같은 설정을 보고 바꾼다.

이 화면은 영역별로 나뉘고 영역마다 다른 주 행동을 가진다("화면 하나에 주 행동 하나"는 각 영역 안에서 지킨다, screens/README.md#G4). 왼쪽은 영역 목록, 오른쪽은 선택한 영역의 상세다(shell/design-system#R21 목록360px+상세). 다른 concern이 공개하는 단순 값(참거짓·숫자·목록) 설정은 이 화면이 같은 설명 형식(이름·한 줄 설명·현재 값·기본값·영향·되돌리는 법·적용 시점, platform/settings#R27, R28)으로 자동으로 모아 보여 주며 이 문서는 아래 다섯 영역만 자세히 다룬다.

## 보이는 것

### Model connections (lophn-agent/harness/provider)
- 연결 목록: 실제 제품 이름(Claude, ChatGPT, API key 이름 등) 하나하나와 지금 상태(Ready / Needs attention / Waiting).
- 지금 "For decisions"·"For summaries"에 쓰는 연결과 model(platform/settings#R7, shell/wording#R13).
- 같은 제품에 연결이 여럿이면 사람이 정한 사용 순서(lophn-agent/harness/provider#R8, R10).

### Coding agent connections (coding-agent/connection)
- 연결 목록: 제품 이름, 범위(전체 또는 앱 하나의 이름), 만든 날짜.
- 선택한 연결의 설치 확인 결과 네 가지(MCP 초기화 / tool 발견 / skill 발견 / 안내 loading)를 성공/실패/확인 못함으로(coding-agent/connection#R13).

### Extensions (lophn-agent/extensions)
- 등록한 로컬 skill 폴더 목록과 각 폴더에서 찾은 skill 이름들, 형식 오류나 이름 충돌이 있으면 그 이유(lophn-agent/extensions#R1-R3).
- 등록한 외부 MCP 서버 목록: 이름, 전송 방식(로컬/원격), 지금 연결 상태.
- 선택한 서버의 원래 도구마다 사람이 지정한 분류(읽기/쓰기/바깥 동작, lophn-agent/extensions#R27)와, 분류하지 않은 새 도구는 "분류가 필요하다"는 표시(lophn-agent/extensions#R28).

### Backup & data (platform/backup-and-migration)
- 가장 최근 자동 backup의 시각과 복원 가능 여부(platform/backup-and-migration#R10, R12).
- 최근 7개 backup 목록과 각각의 시각·복원 가능 여부.
- 선택한 backup에 포함된 것(ledger·blob·설정 선택)과 빠진 것(앱 업무 DB, 외부 project·앱 source, keychain, platform/backup-and-migration#R8, R11).

### Software & diagnostics (platform/install-and-update, platform/diagnostics)
- 지금 설치된 version, 데이터 폴더 위치(platform/install-and-update#R7).
- 새 version이 있으면 지원 OS·schema 호환·재시작 필요 여부(platform/install-and-update#R13).
- 상태 점검 결과: 구성 요소별 지금 사용 가능 여부와 확인 시각(platform/diagnostics#R8).

## 숨긴 것

- credential 값 자체, OAuth token, 인증 header는 화면 어디에도 평문으로 보이지 않는다. 입력은 confirmation window의 안전 입력으로만 받는다(lophn-agent/harness/provider#R7, platform/settings#R15).
- provider가 거절·사용량 대기 중인 다음 credential로 넘어가는 선택, model 전용 대기와 provider 전체 대기의 구분 계산은 안 보이고 결과(지금 못 쓴다, 언제 다시 쓸 수 있다)만 보인다(lophn-agent/harness/provider#R10, R24).
- coding agent 연결의 claim 정리, 회수 뒤 뒤늦게 오는 완료 보고의 무시는 보이지 않는다(coding-agent/connection#R8, R18).
- MCP 서버의 재연결 재시도(최대 3회), 도구 이름 충돌 해소, 목록 다시 읽기는 "연결됨/끊김"이라는 결과로만 보인다(lophn-agent/extensions#R20, R23, R24).
- backup의 SQLite snapshot·압축·hash 검사와 migration 단계별 복구본은 전혀 안 보인다. 복원 전에는 "지금 자료는 먼저 보존된다"만 보인다(platform/backup-and-migration#R9, R13).
- 설정 값의 층(기본값/공통 선택/역할별 선택)과 CAS 판 비교는 "누가 먼저 바꿔서 다시 확인해야 한다"는 충돌 안내가 필요할 때만 보인다(platform/settings#R10, R19).
- 보안 상태 점검의 세부 근거(어떤 key 패턴을 봤는지 등)는 "자세히 보기"에만, 의심 값 원문은 절대 보이지 않는다(platform/diagnostics#R10).

## 행동

영역마다 주 행동이 다르다.

- **Model connections**: 주 행동 **Add connection**(구독 로그인 / API key / 로컬 model 선택). 보조: Test connection, Replace, Remove, Reorder, For decisions/For summaries 고르기.
- **Coding agent connections**: 주 행동 **Connect**(제품과 범위를 고르는 confirmation window). 보조: Revoke(confirmation window).
- **Extensions**: 주 행동 **Add**(skill 폴더 또는 MCP 서버). 보조: 도구 분류 바꾸기, Remove.
- **Backup & data**: 주 행동 없음(자동으로만 만들어진다, platform/backup-and-migration#R12). 보조: Restore(confirmation window, 잃을 범위 확인), Export app.
- **Software & diagnostics**: 새 version이 있을 때만 주 행동 **Install update**(confirmation window, 재시작 필요 안내). 보조: Run a check, 자세히 보기.

설정 변경 제안이 대화에서 나오면, 실제로 바뀌는 때는 사람이 그 질문의 정확한 선택지를 고를 때뿐이다. 설명을 묻거나 자유롭게 답하기만 하면 아무것도 바뀌지 않는다(platform/settings#R29).

## 상태

- **준비 안 됨**: 연결된 model이 하나도 없으면 "agent를 쓰려면 연결이 필요하다"와 Add connection만 보이고, 문서·기존 앱 사용은 막지 않는다(lophn-agent/harness/provider#R28, platform/settings#R23).
- **Waiting**: 구독 로그인 진행 중("브라우저에서 로그인해 주세요" 류), 15분 안에 끝나지 않으면 취소로 끝난다(lophn-agent/harness/provider#R14).
- **Needs attention**: 인증이 끊겼거나 권한이 폐기된 연결 — 다시 로그인/교체가 다음 행동.
- **Resumes at …**: 사용량 제한으로 지금은 못 쓰는 연결 — 다시 쓸 수 있는 시각을 보인다(모르면 비워 두지 않고 "최대 1시간 뒤"처럼 보인다, lophn-agent/harness/provider#R24).
- **연결 끊김**: 오프라인이면 provider·coding agent 연결 확인은 "확인 못함"으로 남고 마지막 확인 시각을 유지한다(공통 패턴, screens/README.md#6).
- **설치 확인 실패/확인 못함**: coding agent 연결마다 네 단계 중 실패·확인 못함 각각의 안전한 이유와 다음 확인 방법을 보인다(coding-agent/connection#R13).
- **복원 불가**: backup이 미완성이면 목록에 남되 복원 선택은 비활성화하고 이유를 보인다(platform/backup-and-migration#R10).
- **적용 실패**: 설정 저장이 실패하면 마지막 성공값을 그대로 보이고 일부만 적용된 것처럼 보이지 않는다(platform/settings#R22).
- **달라졌음**: apply를 누른 값의 기준 판이 그사이 다른 곳에서 바뀌었으면 적용을 거절하고 최신 값을 다시 확인하게 한다(screens/README#6, platform/settings#R19).

## 문구

| key | en |
|---|---|
| settings.nav.connections | Model connections |
| settings.nav.coding_agent | Coding agent connections |
| settings.nav.extensions | Extensions |
| settings.nav.backup | Backup & data |
| settings.nav.software | Software & diagnostics |
| settings.connections.add | Add connection |
| settings.connections.not_ready | You'll need a connection before agents can work |
| settings.connections.resumes_at | Resumes at {time} |
| settings.connections.needs_attention | Needs attention — reconnect to keep using this |
| settings.connections.for_decisions | For decisions |
| settings.connections.for_summaries | For summaries |
| settings.coding_agent.connect | Connect |
| settings.coding_agent.revoke | Revoke |
| settings.coding_agent.check.mcp | Connected |
| settings.coding_agent.check.tools | Tools found |
| settings.coding_agent.check.skills | Skill found |
| settings.coding_agent.check.guide | Guide loaded |
| settings.coding_agent.check.unknown | Couldn't check this |
| settings.extensions.add_skill | Add skill folder |
| settings.extensions.add_server | Add MCP server |
| settings.extensions.needs_classification | Needs a read/write/outside setting |
| settings.backup.last | Last backup: {time} |
| settings.backup.restore | Restore |
| settings.backup.incomplete | This backup can't be restored |
| settings.backup.excluded | Not included: app data, external files, saved logins |
| settings.software.update_available | Version {version} is ready to install |
| settings.software.install | Install update |
| settings.software.restart_required | This will restart lophn |
| settings.conflict.title | This changed since you opened it |
| settings.conflict.body | Review the current value and try again. |

## 크기와 접근성

목록·상세 틀은 shell/design-system#R21을 쓰고 1024px 미만에서는 영역 목록과 상세를 한 화면씩 보인다(shell/design-system#R24). 영역 목록은 shell/design-system#R31 수치의 목록 행을 쓴다. 설치 확인 네 단계와 상태 점검 결과는 표 대신 상태 표식(아이콘+라벨)로 색 없이 구별한다(shell/design-system#R10). credential 입력은 반드시 confirmation window로 열리며 그 화면의 focus·제출 규칙(shell/confirmation-window#R4)을 따른다.
