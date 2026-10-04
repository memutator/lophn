---
type: guide
concerns: [shell, apps]
---
# 이전 lophn 코드 쓰기

이전 lophn 저장소(`/home/pyosechang/projects/lophn-legacy`)는 읽기 전용 참고다. 거기서 git 명령으로 아무것도 바꾸지 않는다.

## 가져와도 되는 것

화면과 데스크톱 shell만 골라서 가져온다.

| 이전 자리 | 새 자리 | 무엇을 |
|---|---|---|
| `apps/desktop/main/` | `apps/shell/main/` | 창, tray, single instance, 패키징 설정, native view 다루기 |
| `apps/desktop/renderer/` | `apps/shell/renderer/` | 화면 컴포넌트, 편집기(CodeMirror) 설정 |
| `packages/sdk/tokens`, `packages/sdk/ui-*` | `packages/design/`, `packages/sdk/ui-*` | token, UI 컴포넌트 |

가져올 때 지킬 것:

- 통째로 복사하지 않고, 지금 requirements와 [architecture.md](architecture.md)에 맞는 부분만 옮긴다.
- 이름을 지금 문서의 말로 바꾼다. 경로와 이름의 판·단계 표시(`v2`, `m1`, `milestone`, `w07` 같은 것)는 지운다.
- 이전 계약(앱별 host journal, lease, 실행 허가 단계, 토큰 다섯 종 같은 v2 장치)에 기대는 코드는 가져오지 않는다.
- 접근성 전용 코드는 가져오지 않는다(범위 밖).

## 가져오지 않는 것

core, store, daemon, indexer, runtime, mcp, cli, 그 밖의 `packages/sdk/cap-*`, `format-*`, `blueprint`, scripts, templates, skills, tests. 이것들은 지금 문서를 보고 새로 짠다.
