# extension-settings

설정 화면에 extension 목록을 두고 사람이 설치·켜기·끄기·지우기를 한다.

- 단위: extension (wave 2)
- 선행: extension-core.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/**`, `packages/shell/ipc/` 의 새 extension IPC file, `packages/shell/preload/` 해당 file
  - `packages/design/i18n/catalog/**`
  - `tools/wireframes/pages/screens/` 의 settings page(있으면)
- 읽을 것:
  - architecture: `project-docs/architecture/ui-kit.md`
  - 제품 결정: 계획 README 정한 것 3, 4
- 계약:
  - 쓰는 것: `extension-core`의 registry 목록과 켜기·끄기
  - 내놓는 것: 없음

## 할 일

1. Settings에 Extensions 항목: manifest의 이름, 설명, 판, 상태(설치 안 됨·꺼짐·켜짐·판 다름).
2. 단추: 설치(표시 file), 켜기, 끄기, 지우기(확인 dialog).
3. IPC는 shell 내부, 문구는 i18n.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(화면)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
