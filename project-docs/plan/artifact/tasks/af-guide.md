# af-guide

내장 guide `artifact`를 쓰고, project의 PM과 Operator의 role 지침이 이 guide를 가리키게 한다. artifact를 만드는 agent가 자리, 폴더 모양, `data/`와 `_entries.json`, 제목과 설명, network 없음, appearance token을 이 guide 한 곳에서 읽는다.

- 단위: artifact-scope (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/lophn/guides/artifact.md`
  - `packages/core/agent-roles/roles/guides.ts`
  - `packages/core/agent-roles/roles/project-manager/prompt.md`
  - `packages/core/agent-roles/roles/operator/prompt.md`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "1. artifact model"(폴더 모양, `data/`, `_entries.json`, 일회성·갈아끼우기·series, 수명), "2. artifact 탭"(봉한 view: 외부 library·CDN 없음, `connect-src 'self'`, appearance CSS), "3. 대화와 prompt"의 guide 항목, "정한 것 (사람)"(role agent가 정적 view를 직접 쓴다. 앱 코드(domain tool, live view)는 짜지 않는다)
  - 본보기: `roles/guides.ts`(`GUIDES` 표, `guide.read`가 읽는다), `roles/lophn/guides/rewind.md`(guide 문체), `roles/project-manager/prompt.md`·`roles/operator/prompt.md`(role 지침), `core/agent-roles/tools/guide.ts`(`guide.read`는 모든 role이 가진다: `tool-lists.ts`의 `READ_TOOLS`)
  - 소스 자료: wave 1이 낸 `packages/protocol/projects/artifact.ts`(제목·설명을 읽는 규칙), `packages/shell/main/artifact/serve.ts`(CSP 한 줄), `theme-css.ts`(어떤 token이 오나. `packages/design/generated/tokens.css`가 token 이름 목록)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `guide.read`의 topic `artifact`

## 할 일

1. `roles/lophn/guides/artifact.md`(영어, agent가 읽는 글이라 "you" = 이 guide를 읽는 agent). 다음을 순서대로 쓴다.
   - 자리: `artifacts/<name>/index.html`은 place 정보의 Artifacts 줄이 알려 주는 폴더 아래에 `file.write`로 쓴다. `<name>`은 소문자 slug. 관례 자리에 `index.html`이 생기면 그것이 artifact다. 전용 tool은 없다. 사람에게는 대화에서 path를 말한다(그 path는 link가 되어 열린다).
   - 폴더 모양: `index.html`(입구, template), 같은 폴더의 `chart.js` 같은 file(상대 path로 읽는다), `data/*.json`(template이 읽는 재료).
   - `data/`: 일회성(data를 `index.html` 안에 담는다), 갈아끼우기(template은 두고 `data/latest.json`만 고친다), series(`data/`에 file을 쌓고 template이 `data/_entries.json`을 읽는다). `_entries.json`은 view가 만드는 가상 file이고 `[{ "name", "size", "modified" }]`(이름 순, 하위 폴더 제외)다. 디스크에 쓰지 않는다. 재료는 보통 tool(예: `list`의 집계)을 불러 만든 결과를 `data/`에 쓴다.
   - 제목과 설명: `<title>`과 `<meta name="description" content="…">`를 꼭 쓴다. 목록과 prompt가 이 둘을 읽는다.
   - 봉한 view: network가 없다(`fetch`는 자기 폴더의 file만, 밖 server는 막힌다). 외부 library와 CDN은 쓰지 못한다 — script·style·font는 inline이거나 같은 폴더의 file이다. 한 file은 4 MiB까지. 폴더 밖 file은 읽지 못한다.
   - appearance: lophn의 token을 CSS 변수로 쓴다(`var(--color-surface-base)`, `var(--color-text-primary)`, `var(--chart-series-0)` 등 `tokens.css`의 이름). 색을 hex로 박지 않으면 사람의 theme(light·dark, accent, 배경)을 따른다. 대표 변수 열 개 안팎을 표로 든다.
   - 고친 것이 바로 보인다: 파일을 고치면 열린 탭이 다시 load한다. 지난 data를 남기려면 `data/`에 file을 쌓는다(판을 따로 두지 않는다. 되돌리기는 rewind).
   - 사람이 화면에 annotation을 달아 보내면 마지막으로 그 폴더에 쓴 session이 받는다(그 session이 닫혔거나 기록이 없으면 PM). `image.read`로 screenshot을 연다.
   - 하지 않는 것: tool을 부르는 view는 만들지 않는다(그것은 live view이고 coding agent의 일이다. PM이 ticket을 쓴다). 앱 코드는 짜지 않는다.
2. `roles/guides.ts`: `GUIDES` 표에 `["artifact", artifact]`와 import 한 줄.
3. `roles/project-manager/prompt.md`, `roles/operator/prompt.md`: 각각 "What you do"에 불릿 하나. 사람이 결과를 화면으로 보고 싶어 하면 `artifacts/<name>/index.html`을 쓴다. 쓰기 전에 `guide.read` topic `artifact`를 읽는다. Operator는 project place에서만(앱 place에서는 쓰기가 없다). 기존 글의 "In a project place you can read and write that project's folders"와 모순이 없게 이어 쓴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(글).
- 남지 않음: 새 topic이라 옛 이름이 없다. guide의 사실(CSP, 4 MiB, 가상 file 모양)이 wave 1 코드와 같다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: guide의 token 대표 변수 목록, 불릿 문장
- 넘길 줄: 두 `prompt.md`와 `guides.ts`는 domain-kinds, domain-tools, domain-place도 고친다(role 지침 문장). 불릿 하나씩이라 rebase 때 두 쪽을 다 남긴다.
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
