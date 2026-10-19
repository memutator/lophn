# af-wireframes

artifact 화면의 wireframe을 gallery의 Drafts(Experiments)에 먼저 그린다. 사람이 gallery를 보고 모양을 고른 뒤 wave 2 화면 task가 이 코드를 renderer로 옮긴다(ui-design skill, brief-template "화면 task"). 문구는 처음부터 wording key로 쓰고, 그 key를 담을 새 wording 영역 `artifact`를 만든다.

- 단위: artifact-screen (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/artifact/`
  - `tools/wireframes/drafts/index.tsx`
  - `packages/design/wording/catalog/artifact.ts`
  - `packages/design/wording/catalog/artifact.placeholders.ts`
  - `packages/design/wording/en.ts`
  - `packages/design/wording/placeholders.ts`
- 읽을 것:
  - 스킬: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙", "새 화면 만들기", "함정": 앱 view·`<webview>`는 gallery에 없다), `.claude/skills/wording/SKILL.md`(key 이름 `<screen>.<part>.<name>`, 새 영역 file 만드는 순서)
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "2. artifact 탭"(여는 길, [Edit source], 폴더가 없으면 placeholder), "3. 대화와 prompt"(link), "4. artifact annotation"(annotate mode), "5. shell"(gallery에 더할 것 목록)
  - 본보기: `tools/wireframes/drafts/index.tsx`·`drafts/ways-page.tsx`·`drafts/compose.module.css`(Drafts 꼴. CSS는 `drafts/` 안에만 둘 수 있다), `tools/wireframes/mock/app-space/orders-view.tsx`(native view 자리에 넣는 고정 그림), `tools/wireframes/pages/screens/browser/pages.tsx`(browser 탭 화면 묶음), `packages/shell/renderer/app-frame/annotate/annotation-panel.tsx`(annotate 목록 panel, 재사용), `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`(sidebar tab), `packages/shell/renderer/conversation/message-list/message-body.tsx`(대화 글)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `design`
- 계약:
  - 쓰는 것: renderer의 기존 component(`ProjectSidebar`, `AnnotationPanel`, `MessageBody`, `@lophn/ui` 부품)를 import해 그린다.
  - 내놓는 것: page id(wave 2·3이 이 모양을 옮기고 id는 바꾸지 않는다)와 wording key. wave 2 task는 이 key를 `t()`로 쓴다.

## 할 일

1. Drafts(`drafts/index.tsx`의 `draftsArea.pages`)에 아래 page를 더한다. title은 영어, description은 한국어 한두 문장. 가짜 data(artifact 이름, 제목, 설명, 막대 그래프 그림)는 `drafts/artifact/` 안에 둔다.

   | page id | 그릴 것 |
   |---|---|
   | `artifact-tab` | pane 안의 artifact 탭 하나. 탭 줄(종류 아이콘 + page title), toolbar(제목, [Edit source], [Annotate]), 아래 page 영역에 `spending` artifact의 막대 그래프를 token 색으로 그린 고정 그림 |
   | `artifact-tab-file` | 사람의 폴더에 있는 `.html`을 연 탭. 위와 같고 toolbar에 그 file의 폴더가 root임을 알리는 작은 글 |
   | `artifact-annotate` | annotate mode가 켜진 탭. 막대 하나에 번호 표지와 메모, 왼쪽 아래의 모은 목록 panel(`AnnotationPanel`을 import해 쓴다), 보냈을 때 쓰는 toast의 글 |
   | `artifact-missing` | 폴더가 없는 탭의 placeholder. 무엇이 없는지와 [Retry] |
   | `artifact-sidebar-list` | project sidebar의 Artifacts 모양. artifact 줄마다 이름·제목·설명 한 줄, 빈 목록의 안내 |
   | `artifact-chat-link` | 대화 글 안에서 artifact path가 link로 그려진 모양과 hover |

2. 모양 결정을 이 wireframe이 정한다(사람이 고르기 전의 추천안이다. 보고에 적는다): toolbar 단추 순서와 아이콘, link의 모양, sidebar에서 artifact 줄의 정보량, placeholder의 글. "모든 화면의 규칙"(오른쪽 끝 단추 열, 탭 본문 폭, toast, 파일·폴더 아이콘)을 따른다. 규칙과 부딪히면 임의로 정하지 말고 보고에 적는다.
3. 문구는 `t("artifact.…")`로 쓴다. 새 영역 `packages/design/wording/catalog/artifact.ts`를 만들고 `en.ts`(import·`AREAS`·spread)와 `placeholders.ts`에 등록한 뒤 `deno task wording`으로 `artifact.placeholders.ts`를 만든다(손으로 고치지 않는다). 쓸 key: 종류 이름(`artifact.label.kind`), 단추(`artifact.button.edit-source`, `artifact.button.annotate`, `artifact.button.retry` 등), 빈 상태·placeholder(`artifact.empty.*`), annotate 안내와 toast(`artifact.text.*`, `artifact.title.*`), root 안내. 앱 annotate의 글(`app-space.*`)은 "App Engineer"를 말하므로 쓰지 않는다. 같은 뜻이 `common.*`에 있으면 그것을 쓴다.
   - sidebar tab의 이름 key `project-workspace.label.sidebar-tab-artifact`는 `catalog/project.ts`에 둔다(sidebar가 `` `…sidebar-tab-${key}` `` template으로 만든다). 이 한 줄만 그 file을 고친다.
4. `deno task wireframes`로 bundle하고 `python3 -m http.server`로 띄워 light·dark 둘을 본다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, gallery의 Experiments에 위 여섯 page가 그려진다.
- 위험 test: 없음(화면·문구).
- 남지 않음: 새 영역이라 옛 이름이 없다. `tools/wireframes/drafts/artifact/` 밖에 CSS를 두지 않았다.

## 보고

- 바꾼 file
- 통과한 check, 본 light·dark 확인
- 등록할 것: 없음(`en.ts`·`placeholders.ts`의 한 줄씩은 이 task가 직접 했다. 다른 계획과 부딪히면 두 쪽을 다 남긴다)
- 안 쓰게 된 export: 없음
- 정한 것: 위 2번의 모양 결정 목록(사람이 고르기 전의 추천안)
- 넘길 줄: `catalog/project.ts`에 key 한 줄, `drafts/index.tsx`는 다른 계획의 draft도 더한다
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 사람이 gallery를 보고 모양을 고치는 단계가 남아 있다(lead가 wave 2 전에 사람에게 보인다)
