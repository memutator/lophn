# extension (파일 기반 로컬 tool)

System Extension(manifest·CJS bundle·Settings › System › Extensions)은 걷어내고, `harness`(headless 실행기)와 `harness-gui`(터미널 `<harness> gui`)는 core의 기본 내장 기능으로 합쳤다. agent에 native tool을 더하는 길은 파일 기반 로컬 tool(`tools/`)과 외부 MCP(`mcp__`)다.

## 문제

- 본체 플러그인(System Extension)은 사용자가 선택적으로 설치하는 구조가 아니었고 `harness`·`harness-gui` 둘뿐이어서, 별도 manifest·CJS 번들링·토글 설정을 유지할 이유가 없었다.
- 사용자나 lophn agent가 본체 재빌드 없이 바로 model의 `tools[]`에 native tool을 추가할 수 있는 파일 기반 경로가 필요했다.

## 모델

로컬 tool은 Skill(`skills/`)과 같은 세 층의 `tools/` 폴더에서 발견한다(뒤 층이 같은 이름의 앞 층을 덮어쓴다).

1. **전역**: `<data root>/tools/` (`~/.lophn/tools/`)
2. **workspace 저장소**: `<workspace folder>/.lophn/tools/` (project 첫 폴더 또는 app source)
3. **workspace 데이터(그릇)**: `<data root>/{home,projects/<prj>,apps/<app>}/tools/` (세 workspace 종류 모두 `file.write`·`file.edit` 허용 범위와 rewind 대상에 포함 — Home agent도 자기 `tools/`를 직접 쓰고 rewind로 되돌릴 수 있다)

- 파일 형식: TypeScript·JavaScript 단일 파일(`_`·`.`로 시작하는 파일, test 파일, 타입 선언 파일 제외). 파일 이름(확장자 제외)이 tool 이름(`[a-z][a-z0-9_]*`, `__` 금지)이 된다.
- model에 보이는 이름: `local__<name>` (전체 64자 이하). 내장 tool과 `mcp__`와 충돌하지 않는다.
- export 모양: `export default { description, inputSchema, effect?, execute(input, { cwd }) }`. `effect` 생략 시 `"external"`. `execute`는 문자열 또는 `{ type: "text", text } | { type: "image", mimeType, data }` 배열을 반환한다.
- 노출: `lophn` runtime은 발견된 모든 로컬 tool을 `tools[]`에 싣고, `custom` runtime은 정의의 `tools` 칸에 고른 이름(`local__<name>`)만 싣는다. 파일이 바뀌면 다음 turn에 `tools_changed` notice로 알린다.
- **fail-closed 신뢰 검증 (`(realpath, sha256)`)**: 세 층(`tools/` 전부, agent가 쓸 수 있는 `<data root>/tools/`와 workspace 데이터 `tools/` 포함)의 로컬 tool은 모두 동일한 신뢰 검증을 거친다.
  - 정본은 core 소유 data root 설정 `approvals.local_tool_trust`(`locked: true`, 사람만 수정)의 `{ path: realpath, sha256, trusted_at }` 목록이다. 저장소 안에 신뢰 설정을 두지 않는다.
  - 발견 시점에 각 파일의 `realpath`와 내용 `sha256`을 계산한다. 신뢰 목록에 일치하는 `(realpath, sha256)`이 없는 스크립트는 **메타데이터 읽기(`inspect`) 단계에서도 자식 프로세스로 실행하지 않고** stub 정의와 `local_tool` gate로만 올린다(fail-closed).
  - 실행 직전 `tool_gate/check`의 `local_tool` 판정은 사람 전용 등급(`personOnly`)이다: 신뢰 목록에 없거나 이전 신뢰 이후 내용이 바뀐(`changed`) 스크립트는 어느 권한 단계(`full` 포함)에서도 `once | reject`로 사람에게 직접 묻는다. unattended turn과 팀 자식에서는 `deny no_person`이다(부모가 대신 신뢰하지 못한다).
  - 사람이 승인 카드에서 `once`를 누르면 그 시점의 `(realpath, sha256)`이 `approvals.local_tool_trust`에 기록되어 같은 내용의 이후 실행은 다시 묻지 않고 실행된다. 파일 내용이 바뀌어 `sha256`이 달라지면 다음 실행 때 다시 묻는다.
  - 사람은 `/permissions` 화면(desktop 사람 전용 `permissions/trust-local-tool`, `permissions/untrust-local-tool`)에서 신뢰 상태를 확인·부여·해제할 수 있다. 원격 기기·폰은 로컬 스크립트 신뢰를 부여·해제하지 못한다.

## 지키는 것

1. **격리 실행**: 로컬 tool의 메타데이터 읽기(`inspect`)와 실행(`run`)은 core나 agent-runtime 프로세스 안에서 직접 `import()`하지 않고 별도 Node 자식 프로세스로 실행한다.
2. **신뢰 전 무실행(fail-closed)**: `(realpath, sha256)`이 `approvals.local_tool_trust`에 일치하지 않으면 `inspect`조차 실행하지 않고 stub 정의로만 노출하며, 실행 전 `local_tool` gate에서 사람의 직접 승인(`once`, 사람 전용 등급)을 받아야 한다. 스크립트 내용이 바뀌면 기존 신뢰는 무효화되어 다시 묻는다.
3. **내부 env 차단**: 자식 프로세스에는 `LOPHN_*`, `ELECTRON_*`, `NODE_CHANNEL_FD`를 제거한 환경변수만 넘긴다. agent 자격 토큰이나 내부 설정이 로컬 tool 코드로 새지 않는다.
4. **큰 결과 spill**: 텍스트 결과가 24 KiB(`TEXT_MAX_BYTES`)를 넘으면 내장·MCP tool과 동일하게 `<data>/tool-results/`로 spill한다.
5. **호환성**: 옛 agent 정의 파일에 남아 있던 `extensions` 칸은 `agents.drop-extensions` data step이 기동 시 제거한다.

## 결정

- **System Extension 제거 및 `harness`·`harness-gui` 내장화** (사람, 2026-11-21): `harness`와 `harness-gui`는 항상 켜지는 기본 기능으로 통합하고, 단축키 43개는 기본 단축키 표(`HARNESS_KEYBINDINGS`)로 옮겼다.
- **TS/JS 단일 파일 export + lophn agent `tools[]` 노출** (사람/agent, 2026-11-21): Node 24가 TS/JS 파일을 직접 실행하므로 빌드 없이 파일 하나로 schema와 실행을 같이 둔다. 외부 CLI(`lophn tool`)는 필요할 때 추가한다.
- **로컬 tool `(realpath, sha256)` fail-closed 신뢰 검증** (사람, 2026-11-25): `<workspace>/.lophn/tools/*`뿐 아니라 agent가 `file.write`로 쓸 수 있는 `<data root>/tools/`와 workspace 데이터 `tools/`도 처음과 내용이 바뀌었을 때 사람에게 한 번 묻고 data root 설정(`approvals.local_tool_trust`)에 `(realpath, sha256)`을 기록한다. 신뢰 전에는 `inspect`도 실행하지 않는다. person-only 등급으로 두어 unattended나 팀 부모가 임의 스크립트를 대신 신뢰하지 못하게 한다.
