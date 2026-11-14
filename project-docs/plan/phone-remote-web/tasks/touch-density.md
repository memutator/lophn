# touch-density

UI kit에 손가락으로 누르는 크기의 density `touch`를 더한다.

- 단위: design (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/{appearance.ts,appearance_test.ts,presets.ts,tokens.ts}`, `packages/design/generated/`
  - `tools/wireframes/`의 kit page 하나
- 읽을 것:
  - architecture: `project-docs/architecture/{ui-kit,appearance}.md`
  - `ui-design` skill
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: density 값 `touch`(`appearanceCss`가 그 token override를 낸다)

## 할 일

1. `DENSITIES`에 `touch`를 더한다. control 높이 44px 이상, 줄 높이(menu, list, tree)와 간격을 그에 맞춘다. 본문 글자는 16px이다.
2. Settings의 density 고르기에는 넣지 않는다(desktop 사람이 고르는 값이 아니다). 설정 schema가 받는 값은 그대로 둔다.
3. gallery의 kit page에 `touch`로 그린 control 한 줄을 더한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- `npm run wireframes`가 된다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
