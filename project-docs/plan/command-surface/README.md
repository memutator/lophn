# command-surface

- 목표: lophn이 내놓는 일을 명령 표 하나(`packages/cli`)로 세워 lophn agent(native tool `lophn`)와 coding agent(`lophn` binary)가 같이 쓰게 하고, 앱 선언을 앱 내부 operation과 바깥 명령 두 층으로 나눈다.
- 재료: `project-docs/products/roadmap/command-surface.md`(정한 것 1~16이 이 계획의 결정이다), `project-docs/architecture/app-call.md`, `agent-definition.md`, `coding-agent.md`, `run.md`, `approval.md`, `layers.md`
- 범위 밖: coding agent가 `reply`를 받는 길(roadmap 15), 외부 MCP tool(roadmap 14, provider tool로 남는다)
- 단위: `cli`(명령 표, binary, `lophn` tool, 내장 tool을 명령으로 옮기기, 늦게 싣기 지우기), `apps`(선언 두 층, 화면 operation 길, 앱 바깥 명령)
- 순서:
  - wave 1: `cs-foundation`(명령 표와 `lophn` tool, job 명령), `app-layers`(선언 두 층)
  - wave 2: 남은 내장 tool을 명령으로(묶음별), 늦게 싣기 지우기, 화면 operation의 큰 결과, 앱 바깥 명령을 `lophn <domain> <command>`로
  - wave 3: model이 읽는 글(place prompt, 내장 skill, eval)의 tool 이름 고치기, 문서
  - wave 4: 사람 data root의 앱을 worker가 새 모양으로 옮기기(단계마다 사람에게 묻는다, roadmap 16)
- 사람이 정할 것: 없음(roadmap에서 다 정했다)
- 이 계획은 사람의 요청으로 brief 단계를 줄였다(2026-11-01). wave 2부터의 task는 앞 wave가 merge된 뒤 lead가 쓴다.
- lead가 할 일: land 전에 `architecture/app-call.md`, `agent-definition.md`, `coding-agent.md`, `run.md`, `workflow.md`, `layers.md`, `module-catalog.yaml`, `boundary-catalog.yaml`을 고친다. `plan/context-cache`의 `defer-responses`는 하지 않는다고 그 README에 적는다. 끝나면 changelog 결정에 roadmap 16(사람 앱을 worker가 옮긴 이번만의 예외)을 남긴다.
