# remote-settings

Settings에 Remote 화면을 만든다: remote 켜기, pairing QR, 기기 목록.

- 단위: remote (wave 3)
- 선행: remote-devices.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/remote/`(새 폴더)
  - `packages/shell/renderer/desktop/settings/{settings-screen.tsx,model.ts,core-source.ts,source.ts}`
  - `packages/shell/main/desktop/core/allowlist.ts`
  - `packages/design/i18n/catalog/`의 설정 영역
  - `tools/wireframes/pages/screens/settings-pages.tsx`
  - `packages/shell/package.json`
- 읽을 것:
  - 계획 README "정한 것"
  - `ui-design` skill(wireframe을 먼저 그리고 옮긴다)
  - 본보기: `packages/shell/renderer/desktop/settings/browser/`(기기 목록 줄)
- 계약:
  - 쓰는 것: route `pairing/start`, `devices/*`, 설정 `remote.enabled`
  - 내놓는 것: 없음

## 할 일

1. wireframe: Remote 켜기 toggle, "기기 더하기"(QR과 남은 시간, 다시 만들기), 기기 목록(이름, OS, 마지막 연결, 기준 표시, 이름 바꾸기, 기준으로, 끊기). 꺼져 있으면 QR과 목록 대신 안내 한 줄.
2. renderer로 옮긴다. QR을 그리는 library는 판을 정확히 고정한다.
3. 기기를 끊기 전에 한 번 확인한다(끊으면 그 폰은 다시 pairing해야 한다).
4. 새 route를 renderer allowlist에 더한다.
5. 글은 i18n catalog에 넣는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- `npm run wireframes`가 되고 gallery의 설정 page에 Remote가 그려진다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
