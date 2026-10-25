# highlight

code block을 Shiki(JavaScript regex engine, lazy grammar)로 Worker에서 highlight한다. design `CodeBlock`은 highlighter를 React context에서 받아 token 배열을 React span으로 그리고, shell desktop 창이 Shiki Worker를 그 context로 준다. context가 없는 곳(`@lophn/ui`를 쓰는 앱)은 지금처럼 plain이다.

- 단위: highlight (wave 2)
- 선행: chat-md. `CodeBlock`·`Markdown`에서 `chat-md`가 고친 것 위에 짓는다.
- 소유(이 task만 고친다):
  - `packages/design/components/reading/code-block/`
  - `packages/design/components/reading/reading.module.css`
  - `packages/design/components/reading/mod.ts`
  - `packages/design/tokens.ts`
  - `packages/design/presets.ts`
  - `packages/design/generated/`
  - `packages/shell/renderer/highlight/` (새 폴더)
  - `packages/shell/renderer/build.ts`
  - `packages/shell/renderer/deno.json`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `deno.lock`
  - `tools/wireframes/pages/kit/reading/`
- 읽을 것:
  - 계획: `project-docs/plan/agent-chat/README.md`의 "정한 것"(highlight는 Shiki, JS regex engine, CSP를 바꾸지 않는다, Worker, lazy grammar, token 배열 → React span, `CodeBlock`은 context에서 받는다)과 "lead가 계획 안에서 정할 것"(esbuild 묶기, `shiki` 판. 아래 "정한 것"에 답이 있다)
  - 제품 결정: `project-docs/products/roadmap/agent-chat.md`의 "지금 코드"(글: main renderer CSP 줄, code 줄)와 "무엇을 만드나" 3
  - architecture: `project-docs/architecture/ui-kit.md`(token → design → renderer 흐름, "무엇을 어디에 두나", "사용자 앱에 닿는 길": design이 bare import하는 npm은 앱 template 의존이 된다, "지키는 check"의 kit), `project-docs/architecture/appearance.md`("값과 preset"의 대비 규칙, background preset이 덮는 token, "CSS 모양")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `design`, `design-api`, `shell`, `project-docs/module-catalog.yaml`의 `packages/design`, `packages/shell/renderer`
  - skill: `.claude/skills/ui-design/SKILL.md`(token은 `tokens.ts`, kit page, gallery는 Electron이 아니다), `.claude/skills/write-test/SKILL.md`("사람에게 묻는 test": Worker)
  - 본보기(화면): `tools/wireframes/pages/kit/reading/page.tsx`의 CodeBlock section
  - 고칠 코드:
    - design: `packages/design/components/reading/code-block/code-block.tsx`, `reading/markdown/markdown.tsx`의 `case "code"`(`CodeBlock`에 `language`를 넘긴다. `chat-md`가 info의 첫 낱말로 바꿨다), `reading/mod.ts`, `packages/design/tokens.ts`(228줄 `terminal`: VS Code Light+·Dark+ 색을 light·dark 짝으로 둔 본보기), `packages/design/presets.ts`(92줄 `palette`), `packages/design/flatten.ts`(path → `--a-b-c` 이름), `packages/design/generate.ts`, `packages/design/components/_shared/resize.ts`(`ResizeSourceProvider = ResizeSourceContext.Provider`를 내놓는 본보기), `packages/design/style-check/model.ts`(CSS의 `var()`는 아는 token만)
    - shell: `packages/shell/renderer/build.ts`(entry마다 `esbuild.build`, deno loader), `packages/shell/renderer/deno.json`, `packages/shell/renderer/desktop/entry.tsx`(`mount` 아래 Provider 줄), `packages/shell/renderer/desktop/index.html`(`./desktop.js`를 module로 부른다), `packages/shell/main/desktop/shell-protocol.ts` 8-20줄(CSP, 바꾸지 않는다)과 `createShellHandler`(`lophn-shell://desktop/<path>` → `dist/desktop/<path>`), `packages/shell/main/desktop/security.ts`(`registerViewSchemes`: standard·secure·fetch)
    - 의존 lock: 루트 `deno.json`의 `"lock": {"frozen": true}`, `tools/package-linux.ts` 99줄(`deno install --frozen=false`)
  - Shiki: <https://shiki.style/guide/install#fine-grained-bundle>, <https://shiki.style/guide/regex-engines#javascript-regexp-engine>, <https://shiki.style/guide/theme-colors#css-variables-theme>
- 계약:
  - 쓰는 것: `chat-md`가 고친 `Markdown`과 `CodeBlock`(label은 fence info의 첫 낱말), main renderer CSP(`packages/shell/main/desktop/shell-protocol.ts`의 `script-src 'self'`, 바꾸지 않는다).
  - 내놓는 것: design `CodeBlock`이 React context의 highlighter로 token을 그린다(HTML 문자열을 넣지 않는다). shell desktop 창이 Shiki Worker를 context로 준다. 파일 읽기와 chat의 code block, `stream-shell`의 자라는 code block이 같은 길을 탄다. 색은 design token(light·dark preset)이다.

## 할 일

1. 의존(근거: README "lead가 계획 안에서 정할 것", AGENTS.md "의존성은 판을 정확히 고정한다"). `packages/shell/renderer/deno.json`의 `imports`에 셋을 더한다. 바깥 package는 `shiki` 하나이고 그 아래 `@shikijs/*`는 `shiki`가 같은 판으로 고정한다.
   ```json
   "shiki/core": "npm:shiki@4.5.0/core",
   "shiki/engine/javascript": "npm:shiki@4.5.0/engine/javascript",
   "shiki/langs": "npm:shiki@4.5.0/langs"
   ```
   lock이 frozen이라 저장소 root에서 `deno install --frozen=false`로 `deno.lock`을 갱신한다. design `deno.json`에는 더하지 않는다. design은 shiki를 모른다(아래 3). 그래서 앱 template(`packages/core/apps/packages/template/app/deno.json.tmpl`)의 의존도 늘지 않는다(`ui-kit.md` "사용자 앱에 닿는 길" 1).
2. token(근거: roadmap 3 "색은 Shiki의 css-variables theme에 design token을 물린다", ui-design skill "token은 `tokens.ts`").
   - `packages/design/tokens.ts`의 `terminal` 옆에 `code`를 더한다. 이름은 Shiki css-variables theme(`variablePrefix: "--code-"`)이 내는 변수와 같아야 한다. 4.5.0 theme가 내는 것은 이 13개뿐이다:
     ```ts
     // code highlight 색. Shiki css-variables theme(variablePrefix "--code-")의 변수와 이름이 같다.
     code: {
       foreground: { light, dark },
       token: { constant, string, comment, keyword, parameter, function, stringExpression, punctuation, link, inserted, deleted, changed }, // 모두 { light, dark }
     }
     ```
     → `--code-foreground`, `--code-token-keyword`, `--code-token-string-expression` …
   - 값은 `terminal`과 같은 출처(VS Code Light+·Dark+)에서 고르고, code block 바탕(`reading.module.css` `.codeBlock`의 `--color-surface-subtle`)과 모든 background preset(warm·neutral·cool)에서 light·dark 모두 4.5:1 이상인지 WCAG 상대 휘도로 계산해 확인한다(`appearance.md` "대비를 지키는 값만 둔다"). `foreground`는 `color.text.primary`와 같은 값이다.
   - `packages/design/presets.ts`의 `palette`가 `code: { foreground: text[0] }`도 덮게 한다. background preset이 바꾸는 본문 글자색을 code의 기본 글자도 따른다.
   - `deno run --allow-read --allow-write --allow-run packages/design/generate.ts`로 `generated/`(`tokens.css`, `vars.ts`, `token-names.ts`, `values.json`)를 다시 만든다. 손으로 고치지 않는다.
3. design `code-block/highlighter.ts`(새 file. React만 import한다):
   ```ts
   /** highlight된 code 한 조각. color는 CSS 색 값이다(shell은 `var(--code-…)`를 준다). */
   export interface CodeToken {
     readonly text: string;
     readonly color?: string;
     readonly italic?: boolean;
     readonly bold?: boolean;
     readonly underline?: boolean;
   }
   export type CodeLine = readonly CodeToken[];
   export interface Highlighter {
     /** code 전체를 줄마다 token으로 낸다. 모르는 언어나 실패는 null이다(plain으로 그린다). */
     highlight(code: string, language: string): Promise<readonly CodeLine[] | null>;
   }
   const HighlighterContext = createContext<Highlighter | null>(null);
   export const HighlighterProvider = HighlighterContext.Provider;
   export function useHighlighter(): Highlighter | null
   ```
   `reading/mod.ts`에 `HighlighterProvider`와 type `Highlighter`, `CodeLine`, `CodeToken`을 내보내고 윗줄에 `//` 한 줄("CodeBlock에 code highlighter를 준다. 없으면 code는 plain이다." 같은 뜻)을 단다(ui-kit.md "지키는 check" 3).
4. design `code-block/code-block.tsx`(근거: README "결과는 token 배열로 받아 React span으로 그린다", roadmap 3 "context가 없는 곳은 지금처럼 plain"):
   - `useHighlighter()`가 null이거나 `language`가 없으면 지금 그대로다.
   - 있으면 effect(`[highlighter, code, language]`)에서 `highlighter.highlight(code, language)`를 부르고 결과를 `{code, lines}`로 state에 둔다. 실패(reject)는 null로 둔다.
   - 그리기: state가 있고 지금 `code`가 `state.code`로 시작하면 줄마다 `<span style={…}>{token.text}</span>`를 `"\n"`으로 잇고 그 뒤에 `code.slice(state.code.length)`를 plain 글로 붙인다. 아니면 plain이다. style은 `color`, `fontStyle: "italic"`, `fontWeight: "var(--font-weight-semibold)"`, `textDecoration: "underline"`만 쓴다. `dangerouslySetInnerHTML`을 쓰지 않는다.
   - `CopyButton`은 지금처럼 `code` 원문을 복사한다. label은 `language` 그대로(`chat-md`가 첫 낱말로 바꾼 값)다.
5. shell `packages/shell/renderer/highlight/`(새 폴더. 근거: README "Worker에서 돌리고 grammar는 lazy로 불러온다", roadmap 3).
   - `messages.ts`: `HighlightRequest {id: number; code: string; language: string}`, `HighlightReply {id: number; lines: readonly CodeLine[] | null}`. `CodeLine`은 `import type`으로만 가져온다(worker bundle에 React가 들어가지 않게 한다).
   - `worker.ts`(Worker entry):
     - `createHighlighterCore({ themes: [createCssVariablesTheme({ name: "lophn", variablePrefix: "--code-" })], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) })`를 module에서 한 번 만든다(`shiki/core`, `shiki/engine/javascript`). `forgiving`은 JS engine이 못 옮기는 pattern을 건너뛰게 한다.
     - 요청마다 `language.toLowerCase()`를 `shiki/langs`의 `bundledLanguages`(id와 alias, 값은 `() => import(…)`)에서 `Object.hasOwn`으로 찾는다. 없으면 `lines: null`. 있으면 `loadLanguage(load)` 뒤 `codeToTokens(code, { lang, theme: "lophn" }).tokens`를 `CodeToken`으로 옮긴다(`content` → `text`, `color`, `fontStyle` bit 1·2·4 → italic·bold·underline. vscode-textmate `FontStyle` 값이다). 예외는 `lines: null`이다.
     - `self.addEventListener("message", …)`로 받고 `self.postMessage(reply)`로 답한다.
   - `client.ts`: `export function createWorkerHighlighter(): Highlighter`.
     - Worker는 첫 `highlight` 때 `new Worker("./highlight-worker.js", { type: "module" })`로 만든다. 문서 주소(`lophn-shell://desktop/index.html`) 기준이라 `lophn-shell://desktop/highlight-worker.js`다. `new URL(…, import.meta.url)`은 쓰지 않는다(esbuild가 다루지 않는다).
     - `id`마다 기다리는 resolve를 `Map`에 둔다. `new Worker`가 던지거나 Worker `error`가 오면 기다리는 것을 모두 null로 풀고 그 뒤로는 바로 null이다(plain).
6. `packages/shell/renderer/build.ts`에 worker entry 하나를 더한다(README "lead가 계획 안에서 정할 것"의 답):
   - `entries`의 모양에 `splitting?: boolean`을 더하고 `{ in: join("highlight", "worker.ts"), out: "highlight-worker", dir: "desktop", format: "esm", splitting: true }`를 더한다. `esbuild.build`에 `splitting: entry.splitting ?? false`, `chunkNames: "highlight/[name]-[hash]"`를 넘긴다.
   - 그러면 `bundledLanguages`의 `import("@shikijs/langs/<id>")`마다 chunk가 `dist/desktop/highlight/`에 나가고, grammar는 그 언어 fence를 처음 볼 때만 불린다. desktop 화면 bundle은 그대로 한 file이다.
   - worker entry를 묶기 전에 `dist/desktop/highlight/`를 지운다(hash 이름이라 옛 chunk가 쌓여 설치본에 실린다. `scripts/stage.ts`가 dist를 통째로 복사한다).
   - 실험(2026-10-25, esbuild 0.28.2 + `@luca/esbuild-deno-loader` 0.11.1 + shiki 4.5.0, 위 설정): 출력 322개(worker 약 370 KB + chunk 321개), 합 약 8.9 MB. bundle을 Deno에서 불러 `ts`·`sh` alias가 `var(--code-token-keyword)` 같은 색으로 나오는 것까지 보았다.
7. `packages/shell/renderer/desktop/entry.tsx`: module에서 `const highlighter = createWorkerHighlighter()`를 한 번 만들고 `mount`의 뿌리 `div` 바로 안을 `<HighlighterProvider value={highlighter}>`로 감싼다. 파일 읽기(`MarkdownPane`)와 세 chat 화면이 같이 얻는다(roadmap 3 "파일 읽기와 chat이 같이 얻는다"). overlay·secret-input entry는 고치지 않는다.
8. CSP와 scheme 권한은 바꾸지 않는다(README). `shell-protocol.ts`의 `script-src 'self'`가 같은 origin의 module Worker와 chunk를 허락하고 JS regex engine은 `new RegExp`만 쓴다(eval·wasm 없음). 실제 Electron에서 Worker가 뜨지 않으면 `shell-protocol.ts`나 `security.ts`를 고치지 말고 보고한다.
9. kit(ui-design skill "design에 component를 더하면 그 분류 kit page에 견본을 같이 더한다"): `tools/wireframes/pages/kit/reading/page.tsx`의 CodeBlock section에 "highlighted" Row를 더한다. 고정 `CodeLine[]`(comment, keyword, function, string, constant, parameter, punctuation 색을 한 번씩 쓴 몇 줄)을 돌려주는 가짜 `Highlighter`를 `HighlighterProvider`로 주고, `code`는 그 token 글을 이은 것이다. gallery에는 Shiki를 싣지 않는다. Light·Dark로 색을 본다.

## 정한 것

- `shiki`는 4.5.0이다(npm registry 최신, 2026-10-01 판. 2026-10-25에 `npm view shiki version`으로 봤다). `shiki/core`, `shiki/engine/javascript`, `shiki/langs` 세 subpath만 쓴다. `shiki` 본체(`codeToHtml`, oniguruma wasm)는 import하지 않는다.
- 언어는 `shiki/langs`의 `bundledLanguages` 전부를 lazy로 둔다. 이유: roadmap 3 "언어 목록을 미리 고르지 않는다". 값: dist가 약 9 MB 커지고 설치본도 그만큼 커진다. 불리는 것은 쓴 언어의 chunk뿐이다.
- token은 design 자기 모양(`CodeToken`)으로 받는다. Shiki type을 design에 들이지 않는다. 이유: design은 사용자 앱이 판 고정 사본으로 쓰고, 앱 template의 의존을 늘리지 않는다(`ui-kit.md`).
- 자라는 code block(streaming)은 받은 결과가 지금 code의 앞부분이면 그만큼 색을 칠하고 나머지는 plain으로 붙인다. 이유: 새 결과가 올 때까지 plain으로 돌아가 깜빡이지 않는다. 요청은 따로 버리지 않는다(Worker가 받은 순서대로 답한다).
- 위 `code` token의 이름은 Shiki가 정한 변수 이름을 따른다(`token.stringExpression` → `--code-token-string-expression`). 이유: css-variables theme의 `var()`가 바꾸지 않고 바로 design token을 가리킨다.

## 끝남

- `deno task check`가 통과한다(token 생성, kit, style, shell renderer `deno check` 포함).
- 위험 test: 없음. README "위험 test"에 없고 화면이다. Worker를 띄우는 test는 사람의 허락이 먼저다(AGENTS.md "사람에게 묻는 것", README "사람에게 묻는 것": Shiki Worker 포함). 만들지 않는다.
- 남지 않음·바뀌지 않음:
  - `grep -rn "shiki" packages/design`이 0줄이다(design은 shiki를 모른다).
  - `grep -rn "dangerouslySetInnerHTML\|innerHTML" packages/design/components/reading packages/shell/renderer/highlight`가 0줄이다.
  - `git diff main -- packages/shell/main/desktop/shell-protocol.ts packages/shell/main/desktop/security.ts`가 비어 있다(CSP와 scheme 권한 그대로).
- `deno run -A packages/shell/renderer/build.ts`가 서고 `packages/shell/renderer/dist/desktop/highlight-worker.js`와 `dist/desktop/highlight/`의 chunk(300개 넘게)가 생긴다.
- (화면) `deno task wireframes`가 되고 gallery `kit-reading`의 CodeBlock "highlighted" Row가 Light·Dark 모두 token 색으로 그려진다. 다른 Row와 Markdown의 code는 plain 그대로다.
- (앱) 할 수 있으면 `deno task dev:mock`에서 code fence가 있는 글(파일 읽기나 agent 답)을 열어 색이 나오고 DevTools console에 CSP·Worker 오류가 없는지 본다. gallery는 Electron이 아니라 CSP와 Worker를 보지 못한다(ui-design skill "함정"). 못 했으면 보고의 "알려진 미완 동작"에 적는다.

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
