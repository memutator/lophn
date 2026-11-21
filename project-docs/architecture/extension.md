# extension (파일 기반 로컬 tool)

System Extension(manifest·CJS bundle·Settings › System › Extensions)은 걷어내고, `harness`(headless 실행기)와 `harness-gui`(터미널 `<harness> gui`)는 core의 기본 내장 기능으로 합쳤다. agent에 native tool을 더하는 길은 파일 기반 로컬 tool(`tools/`)과 외부 MCP(`mcp__`)다.

## 문제

- 본체 플러그인(System Extension)은 사용자가 선택적으로 설치하는 구조가 아니었고 `harness`·`harness-gui` 둘뿐이어서, 별도 manifest·CJS 번들링·토글 설정을 유지할 이유가 없었다.
- 사용자나 lophn agent가 본체 재빌드 없이 바로 model의 `tools[]`에 native tool을 추가할 수 있는 파일 기반 경로가 필요했다.

## 모델

로컬 tool은 Skill(`skills/`)과 같은 세 층의 `tools/` 폴더에서 발견한다(뒤 층이 같은 이름의 앞 층을 덮어쓴다).

1. **전역**: `<data root>/tools/` (`~/.lophn/tools/`)
2. **workspace 저장소**: `<workspace folder>/.lophn/tools/` (project 첫 폴더 또는 app source)
3. **workspace 데이터(그릇)**: `<data root>/{home,projects/<prj>,apps/<app>}/tools/` (agent의 `file.write` 허용 범위에 포함)

- 파일 형식: TypeScript·JavaScript 단일 파일(`_`·`.`로 시작하는 파일, test 파일, 타입 선언 파일 제외). 파일 이름(확장자 제외)이 tool 이름(`[a-z][a-z0-9_]*`, `__` 금지)이 된다.
- model에 보이는 이름: `local__<name>` (전체 64자 이하). 내장 tool과 `mcp__`와 충돌하지 않는다.
- export 모양: `export default { description, inputSchema, effect?, execute(input, { cwd }) }`. `effect` 생략 시 `"external"`. `execute`는 문자열 또는 `{ type: "text", text } | { type: "image", mimeType, data }` 배열을 반환한다.
- 노출: `lophn` runtime은 발견된 모든 로컬 tool을 `tools[]`에 싣고, `custom` runtime은 정의의 `tools` 칸에 고른 이름(`local__<name>`)만 싣는다. 파일이 바뀌면 다음 turn에 `tools_changed` notice로 알린다.

## 지키는 것

1. **격리 실행**: 로컬 tool의 메타데이터 읽기(`inspect`)와 실행(`run`)은 core나 agent-runtime 프로세스 안에서 직접 `import()`하지 않고 별도 Node 자식 프로세스로 실행한다.
2. **내부 env 차단**: 자식 프로세스에는 `LOPHN_*`, `ELECTRON_*`, `NODE_CHANNEL_FD`를 제거한 환경변수만 넘긴다. agent 자격 토큰이나 내부 설정이 로컬 tool 코드로 새지 않는다.
3. **큰 결과 spill**: 텍스트 결과가 24 KiB(`TEXT_MAX_BYTES`)를 넘으면 내장·MCP tool과 동일하게 `<data>/tool-results/`로 spill한다.
4. **호환성**: 옛 agent 정의 파일에 남아 있던 `extensions` 칸은 `agents.drop-extensions` data step이 기동 시 제거한다.

## 결정

- **System Extension 제거 및 `harness`·`harness-gui` 내장화** (사람, 2026-11-21): `harness`와 `harness-gui`는 항상 켜지는 기본 기능으로 통합하고, 단축키 43개는 기본 단축키 표(`HARNESS_KEYBINDINGS`)로 옮겼다.
- **TS/JS 단일 파일 export + lophn agent `tools[]` 노출** (사람/agent, 2026-11-21): Node 24가 `.ts`를 직접 실행하므로 빌드 없이 파일 하나로 schema와 실행을 같이 둔다. 외부 CLI(`lophn tool`)는 필요할 때 추가한다.
