# chat-md

agent 글을 design `Markdown`으로 그린다. `MessageBody`의 글 part와 fallback 글이 새 `ChatMarkdown`(chat 간격, artifact path link, link는 open-external, image는 alt 글의 link)을 쓰고, `Markdown` 공통으로 표 가로 scroll wrapper, task list의 checked 의미, code label의 info 첫 낱말을 고친다. 사람 글(`UserBody`)은 plain 그대로다.

- 단위: chat-md (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/components/reading/markdown/`
  - `packages/design/components/reading/reading.module.css`
  - `packages/design/components/reading/code-block/code-block.tsx`
  - `packages/design/components/reading/mod.ts`
  - `packages/shell/renderer/conversation/message-list/chat-markdown.tsx` (새 file)
  - `packages/shell/renderer/conversation/message-list/message-body.tsx`
  - `packages/shell/renderer/conversation/message-list/message-body.module.css`
  - `packages/shell/renderer/conversation/message-list/artifact-text.tsx`
  - `tools/wireframes/pages/kit/reading/`
  - `tools/wireframes/pages/screens/artifact/chat-link.tsx`
  - `packages/design/wording/catalog/{common,common.placeholders,conversation,conversation.placeholders}.ts` (공용, key만 더한다)
- 읽을 것:
  - 계획: `project-docs/plan/agent-chat/README.md`의 "정한 것"(Lezer `Markdown`, 사람 글은 plain, chat image는 alt 글의 link)
  - 제품 결정: `project-docs/products/roadmap/agent-chat.md`의 "지금 코드 › 글"과 "무엇을 만드나" 2, "정한 것 (agent)"의 markdown·image·사람 글 줄
  - architecture: `project-docs/architecture/ui-kit.md`("무엇을 어디에 두나", "import 방향": design 안은 상대 경로, CSS는 token 변수만, "지키는 check"의 kit), `project-docs/architecture/artifact.md` 14줄(대화 글 ─ `artifactMentions` ─ path 조각이 link ─ `openArtifact`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `design`, `design-api`, `shell`, `project-docs/module-catalog.yaml`의 `packages/design`, `packages/shell/renderer`
  - skill: `.claude/skills/ui-design/SKILL.md`(gallery가 정본, kit page, 확인), `.claude/skills/wording/SKILL.md`
  - 본보기(화면): `tools/wireframes/pages/kit/reading/page.tsx`(Kit · reading), `tools/wireframes/pages/screens/artifact/chat-link.tsx`(page id `artifact-chat-link`. 진짜 `MessageBody`를 `ArtifactsSlice` 고정 값으로 그린다)
  - 고칠 코드:
    - design: `packages/design/components/reading/markdown/markdown.tsx`(`inlines`, `listItem`, `block`의 `table`, `Markdown`), `markdown/parse.ts`(`FencedCode`의 `language`, 212-218줄), `markdown/model.ts`(`Block`의 `code`), `markdown/url.ts`(`safeUrl`: image는 http/https만), `code-block/code-block.tsx`, `reading.module.css`, `reading/mod.ts`
    - shell: `packages/shell/renderer/conversation/message-list/message-body.tsx`(`MessageBody`, `UserBody`), `artifact-text.tsx`(`ArtifactText`와 모르는 path를 보면 목록을 다시 읽는 effect, 24-42줄), `message-body.module.css`(`.text`, `.link`), `packages/protocol/domains/artifact.ts`(`artifactMentions`, `FRAGMENT`), `packages/shell/renderer/workspace/kinds/host.ts`(`ArtifactsSlice`), `packages/shell/renderer/desktop/settings/core-call.ts`(`windowLinkOpener`)
    - 부르는 곳: `packages/shell/renderer/conversation/agent-thread.tsx`(agent 답 187줄, 사람 말 94·334줄, 받은 message 361줄)
- 계약:
  - 쓰는 것: design `Markdown`(`@lophn/ui/reading`, `onOpenLink`·`resolveImage`·`safeUrl`), `ArtifactsSlice`(`packages/shell/renderer/workspace/kinds/host.ts`)와 지금 `ArtifactText`의 artifact path 규칙(모르는 path를 보면 목록을 다시 읽는다), renderer의 `lophnShell.openExternal`.
  - 내놓는 것:
    - `message-list/chat-markdown.tsx`의 `ChatMarkdown`: agent 글 하나를 chat 모양 markdown으로 그린다(body 14/22와 좁은 간격, artifact path와 inline code 전체가 path인 것은 button link, link는 `lophnShell.openExternal`, image는 불러오지 않고 alt 글의 link). `stream-shell`의 live 글과 `reasoning-shell`의 요약이 이것으로 그린다.
    - design `Markdown` 공통: 표는 가로 scroll wrapper 안, task list는 checked를 알리는 disabled checkbox 의미, `CodeBlock` label은 fence info의 첫 낱말. reading 본문(16/28)은 그대로다. `highlight`가 이 `CodeBlock` 위에서 고친다.

## 할 일

1. `markdown/parse.ts`: fenced code의 `language`를 info의 첫 낱말로 둔다(`unescapeText(info)`를 공백으로 나눈 첫 조각, 비면 `undefined`). `model.ts`의 `code` 줄과 `code-block/code-block.tsx`의 `language` prop 주석을 "fence info의 첫 낱말(언어 이름)"으로 고친다. `highlight`도 이 값으로 grammar를 찾는다(근거: roadmap 2 "code 언어 label은 info의 첫 낱말만 쓴다").
2. `markdown/markdown.tsx`의 `MarkdownProps`에 셋을 더하고 `RenderContext`로 넘긴다(근거: roadmap 2. `Markdown`이 글 조각을 그릴 때 shell이 준 함수로 artifact path를 link로 바꾼다. design은 shell을 모른다):
   ```ts
   /** reading(기본): 읽기 본문 16/28. chat: 대화 글 body 14/22와 좁은 간격. */
   variant?: "reading" | "chat";
   /** show(기본): image를 그린다. link: 불러오지 않고 alt 글(비면 주소)의 link로 둔다. */
   images?: "show" | "link";
   /** 글 조각(kind "text")과 inline code 하나(kind "code")를 호출자가 그린다. undefined를 돌려주면 기본으로 그린다. link 글 안에서는 부르지 않는다. */
   renderText?: (text: string, kind: "text" | "code") => ReactNode;
   ```
   - `inlines`: `text`와 `code`는 `renderText`의 결과가 `undefined`가 아니면 `<Fragment key={index}>`로 감싸 그린다. `link`의 children은 `renderText`를 뺀 context로 그린다(`<a>` 안에 button을 넣지 않는다).
   - `image`: `images === "link"`이고 `src`가 있으면 `<img>` 대신 `link`와 같은 `<a className={styles.link} href={src} rel="noreferrer noopener">`(같은 `onOpenLink` click 처리)에 글은 `alt || src`다. `src`가 없으면 지금처럼 `<span>{alt}</span>`. `images === "show"`는 지금 그대로다.
   - 뿌리 `div`: `variant === "chat"`이면 class `styles.markdown`과 `styles.chat`을 같이 단다.
   - `table`: `<table>`을 `<div className={styles.tableScroll}>`로 감싼다(reading과 chat 공통).
   - `listItem`의 task: `taskMark` span에 `role="checkbox"`, `aria-checked={item.task}`, `aria-disabled="true"`를 단다. 안의 `Icon`은 그대로 둔다(아래 "정한 것").
3. `reading.module.css`(token 변수만 쓴다, `ui-kit.md` "import 방향"):
   - `.tableScroll`: `overflow-x: auto`, 아래 여백은 지금 `.table`의 것(`--space-6`)을 옮긴다. `.table`의 margin은 0.
   - `.chat`: `font-size: var(--type-body-size)`, `line-height: var(--type-body-line)`. 그 아래 문단·목록·인용·`codeBlock`·`tableScroll`·`html`의 아래 여백을 줄이고(시작값 `--space-5`), 제목은 h1·h2를 `--type-title-small-*`, h3·h4를 body 크기 semibold로, 위 여백을 줄인다(시작값 `--space-6`). `.chat > :last-child`의 아래 여백은 0이다. reading 값(16/28, 지금 여백)은 바꾸지 않는다. 값은 gallery에서 사람이 본다.
4. `reading/mod.ts`: `Markdown` export 윗줄 `//` 한 줄에 chat 쓰임을 더한다(예: "… variant chat은 대화 글이다"). 새 component export는 없다.
5. `artifact-text.tsx`를 조각으로 나눈다. 동작은 지금 그대로다(근거: roadmap 2 "모르는 path를 보면 목록을 다시 읽는 지금 동작도 남긴다", `artifact.md` 14줄).
   - `export function useArtifactReload(text: string, artifacts: ArtifactsSlice | undefined): void`: 지금 `ArtifactText`의 `asked` ref와 effect(24-42줄)를 그대로 옮긴다.
   - `export function ArtifactLink({ artifacts, domain, name, label }: { artifacts: ArtifactsSlice; domain: string; name: string; label: string }): ReactElement`: 지금의 `Tooltip` + `button`(`data-artifact-link={name}`, `styles.link`, `artifactIcons.kind`, hover 글 `artifact.label.open-link`).
   - `export function artifactPieces(text: string, artifacts: ArtifactsSlice): ReactNode[] | undefined`: `artifactMentions(text, artifacts.names)`가 비면 `undefined`, 아니면 글과 `ArtifactLink`를 번갈아 낸 배열(key는 mention의 `start`).
   - `ArtifactText`는 위 셋으로 지금과 같은 `<p className={styles.text}>`를 그린다. 사람 글이 쓴다.
6. `chat-markdown.tsx`를 새로 만든다. props는 정확히 이것이다(`stream-shell`, `reasoning-shell`이 기댄다):
   ```ts
   export interface ChatMarkdownProps {
     /** agent가 쓴 markdown 원문. 사람 글은 넘기지 않는다(사람 글은 `ArtifactText`). */
     readonly text: string;
     /** 이 project의 domain artifact 목록. 있으면 글과 inline code 속 path를 link로 그리고 모르는 path를 보면 목록을 다시 읽는다. 없으면 path는 글 그대로다. */
     readonly artifacts?: ArtifactsSlice | undefined;
   }
   export function ChatMarkdown({ text, artifacts }: ChatMarkdownProps): ReactElement
   ```
   - `useArtifactReload(text, artifacts)`를 원문 전체에 건다(code 안 path도 본다).
   - `<Markdown source={text} variant="chat" images="link" onOpenLink={…} renderText={…} />`. `resolveImage`는 넘기지 않는다.
   - `onOpenLink`: `windowLinkOpener()`(`../../desktop/settings/core-call.ts`)가 있으면 `(href) => void open(href)`, 없으면(gallery) 넘기지 않는다. 밖으로 가는 이동은 `link` task의 main guard도 막는다.
   - `renderText`: `artifacts`가 없으면 넘기지 않는다. kind `text`는 `artifactPieces(piece, artifacts)`. kind `code`는 `artifactMentions(code, artifacts.names)`가 하나뿐이고 그 `start === 0`, `end === code.length`일 때만 `<ArtifactLink label={code} …/>`, 아니면 `undefined`(근거: roadmap 2 "inline code 전체가 artifact path이면 그것도 link로 둔다").
7. `message-body.tsx`(근거: roadmap 2 "`MessageBody`의 `case "text"`와 fallback 글을 `Markdown`으로 그린다", README "사람 글은 plain이다"):
   - `MessageBodyProps`에 `/** 사람 글. markdown으로 읽지 않고 글 그대로 보인다. */ plain?: boolean`.
   - `case "text"`와 fallback: `plain`이면 지금의 `ArtifactText`, 아니면 `<ChatMarkdown text={…} artifacts={artifacts} />`.
   - `UserBody`는 `MessageBody`에 `plain`을 넘긴다. agent 답(`agent-thread.tsx` 187줄)과 받은 message(361줄: agent, coding agent, program이 보낸 것)는 markdown이다. `agent-thread.tsx`는 고치지 않는다.
   - 머리 주석의 "글과 앱 카드" 설명에 markdown을 더한다.
8. `message-body.module.css`: `.text`는 `ArtifactText`(사람 글)가 계속 쓴다. 머리 주석만 맞춘다. 새 규칙이 필요 없으면 손대지 않는다.
9. wireframe(ui-design skill: gallery는 실제 component를 import만 하고 모양은 design·renderer에서 고친다):
   - `tools/wireframes/pages/kit/reading/page.tsx`: `SOURCE`에 task list(`- [x]`, `- [ ]`), 넓은 표(가로로 넘치는 열), info가 두 낱말인 fence(` ```ts title=app.ts `)를 더한다. Section "Markdown · chat"을 더해 `variant="chat" images="link"`로 같은 글과 `![chart](https://example.com/chart.png)` image를 그린다. 문구는 영어, note는 한국어다.
   - `tools/wireframes/pages/screens/artifact/chat-link.tsx`: agent turn 하나를 더해 목록, 작은 표, code fence, task list, image link와 backtick에 넣은 artifact path(`` `${FOLDER}/spending/index.html` ``)를 보인다. 지금 두 turn과 hover drive(`[data-artifact-link="spending"]`)는 그대로 둔다.
10. wording: 새 화면 문구가 없다(link·image 글은 본문이고 hover 글은 있는 `artifact.label.open-link`다). key를 더하게 되면 wording skill 순서대로 하고 `deno task wording`으로 placeholders를 만든다.

## 정한 것

- 사람 글을 plain으로 두는 길은 `MessageBody`의 `plain` prop 하나다. 이유: `UserBody`가 이미 `MessageBody`로 읽기 전·실패 상태를 그려서, 글 part만 갈라 그리는 것이 가장 작다.
- task list는 지금 icon 모양을 지키고 `taskMark` span에 checkbox 의미(`role`, `aria-checked`, `aria-disabled`)만 단다. 이유: kit에서 승인된 모양을 바꾸지 않는다. design `Checkbox`는 `label` 글 하나를 받아 목록 항목의 블록을 담지 못한다.
- chat image의 link 글은 alt이고 alt가 비면 주소다. 이유: 빈 link는 누를 수 없다.
- 표 wrapper에 `tabIndex`를 두지 않는다. 이유: Chromium은 넘치는 scroll 상자를 keyboard로 닿게 한다.
- `mailto:` link는 `lophnShell.openExternal`이 받지 않아 눌러도 열리지 않는다(`link` task와 같다).

## 끝남

- `deno task check`가 통과한다(style, kit, wording, token 생성 포함).
- 위험 test: 없음. README "위험 test"에 없고 화면이다. 바깥 image를 불러오지 않는 실제 경계는 main CSP `img-src 'self' data: blob:`(`packages/shell/main/desktop/shell-protocol.ts`)다.
- 남지 않음: 없음(지우는 이름이 없다). 사람 글이 plain인지는 `grep -n "plain" packages/shell/renderer/conversation/message-list/message-body.tsx`로 `UserBody`가 넘기는 줄을 본다.
- renderer를 고쳤으므로 `deno run -A packages/shell/renderer/build.ts`가 선다.
- (화면) `deno task wireframes`가 되고:
  - gallery `artifact-chat-link`의 agent turn이 `ChatMarkdown`으로 그려진다: 목록·표·code·task list가 모양을 갖고, image는 alt 글의 link이며, 글과 backtick 속 artifact path가 button link다. light·dark 둘 다 본다.
  - gallery `kit-reading`의 Markdown이 넓은 표를 가로 scroll로 담고, code label이 `ts`(첫 낱말)이며, "Markdown · chat" section이 body 14/22로 그려진다. reading Markdown의 글 크기와 간격은 그대로다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
