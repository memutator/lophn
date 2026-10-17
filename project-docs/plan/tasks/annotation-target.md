# annotation-target

annotation에서 source 위치 잇기를 통째로 지우고, 고른 곳의 component를 가장 안쪽 하나가 아니라 바깥에서 안쪽까지 겹(`List > Card > Button`)으로 보낸다.

- 단위: annotation (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/annotation.ts`
  - `packages/protocol/coding-agent/ticket/{routes,values}.ts`
  - `packages/coding-agent/cli/commands/ticket.ts`
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
  - `packages/core/apps/annotations/{commands,message,mod,ports,schema,send,source,store}.ts`
  - `packages/core/apps/annotations/annotations_test.ts`
  - `packages/core/apps/tickets/reads.ts`
  - `packages/core/apps/releases/bundle/read.ts`
  - `packages/core/apps/releases/ui-build/app-build.ts`
  - `packages/core/apps/packages/template/app/scripts/build-ui.ts.tmpl`
  - `packages/shell/ipc/annotation.ts`
  - `packages/shell/preload/annotate/{pick,describe}.ts`
  - `packages/shell/main/app-frame/{annotate,annotate_test}.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/annotation.md` (흐름, "지키는 것", "왜 이 모양인가". 고치는 것은 lead다)
  - 이슈: `project-docs/issues/annotation.md`의 "겹친 화면 요소에서 가장 안쪽 component 하나만 간다", "source 위치 잇기를 지운다"
  - 이어 읽을 코드: `packages/core/problems/snapshots/work.ts`(app.js.map의 `mappings`를 읽는 다른 사용처. 아래 "정한 것" 참고)
- 계약:
  - 쓰는 것: `packages/protocol/apps/annotation.ts`의 `annotationInputSchema`, `annotationSchema`, `annotationReadSchema`
  - 내놓는 것(protocol 모양이 바뀐다): `annotationSchema`에서 `source`가 사라진다. `annotationInputSchema`에서 `bundle_position`이 사라진다. `AnnotationSource`, `annotationSourceSchema`, `AnnotationBundlePosition`이 사라진다. `component`는 칸 이름과 `string | null` 그대로이고 뜻만 바뀐다: 바깥에서 안쪽 순서로 ` > `로 이은 SDK component 이름들(`List > Card > Button`), SDK component 안이 아니면 null.
  - 쓰는 쪽 전부를 이 task에서 같이 고친다: core `annotations/*`, `tickets/reads.ts`(주석), shell `ipc/annotation.ts`, `preload/annotate/*`, `main/app-frame/annotate.ts`. `ticket show`의 CLI 출력은 route 출력 그대로(`annotationReadSchema`)라서 `source` 칸이 자연히 없어진다. CLI 쪽에 따로 렌더하는 코드는 없다(확인함: 주석과 SKILL.md 문장뿐).
  - 명령 모양 변경: `AnnotationPersist`(`annotations/commands.ts`)의 `annotations`가 `{input, source}[]`에서 `annotationInputSchema[]`로 바뀐다. 쓰는 곳은 `send.ts`와 test뿐이다.

## 정한 것

- `protocol/coding-agent/cli-commands.ts` 116줄 근처 주석에도 "source 위치"가 있지만 `harness-global-install`이 소유한 file이라 여기서 열지 않는다. 보고의 "넘길 줄"에 적는다.

- `component`는 칸을 배열로 바꾸지 않고 ` > `로 이은 한 문자열로 둔다. 이유: ledger 표 `annotations.component TEXT`, `AnnotationRead`, ticket 출력이 그대로이고 바꿀 곳이 가장 적다. 메시지에 `Button "저장"`처럼 글자까지 붙이지 않는다. 요소 글자는 이미 `Element:` 줄(role, 이름, text)에 있어서 겹치지 않게 둔다.
- 겹 순서는 바깥 → 안쪽. 안쪽에서 최대 8개만 남긴다(앱 화면이 깊어도 메시지가 길어지지 않게). 이름 하나는 60자로 자른다.
- `app.js.map`(`ui-build/build.ts`가 합쳐 만든다, `bundle/seal.ts`·`prepare/flow.ts`가 봉인한다)은 **지우지 않는다.** `core/problems/snapshots/work.ts`가 앱 오류 stack을 앱 source 위치로 풀 때 `mappings`를 읽기 때문이다(annotation과 상관없다). 그래서 `ui-build/build.ts`, `bundle/seal.ts`, `prepare/flow.ts`는 손대지 않는다. 화면이 둘 이상이면 `mappings`가 빠지는 한계는 그 오류 쪽의 문제로 남긴다. 보고의 "알려진 미완 동작"에 한 줄 적는다.
- 개발 data는 schema step을 고치면 지우고 새로 만든다(AGENTS.md). `apps.annotations.tables` step을 그 자리에서 고친다. migration step을 더하지 않는다.
- `core/main/daemon/wiring/{context,apps,annotations}.ts`는 소유에 적지 않았다(lead의 조립 목록). 지운 것을 가리키던 `releaseSourceMaps` 줄만 뺀다. 아래 할 일 6 참고.

## 할 일

1. `packages/protocol/apps/annotation.ts`
   - 지운다: `annotationSourceSchema`, `AnnotationSource`, `annotationBundlePositionSchema`, `AnnotationBundlePosition`, `annotationInputSchema.bundle_position`, `annotationSchema.source`.
   - `annotationInputSchema`와 `annotationSchema`의 `component`에 주석을 단다: `List > Card > Button`처럼 바깥에서 안쪽 순서의 겹, 없으면 null.
   - 주석 고침: "보내는 쪽 입력. source는 없고 bundle_position만 있다" 줄을 지운다. `annotationSend` 위 주석의 "source map 읽기와 Router 전달이 비동기라"는 "Router 전달이 비동기라"로 고친다.
2. shell (근거: architecture `annotation.md` 흐름)
   - `shell/ipc/annotation.ts`의 `pickedItemSchema`에서 `bundle_position`을 지운다.
   - `shell/preload/annotate/describe.ts`의 `bundlePositionOf`를 지운다.
   - `shell/preload/annotate/pick.ts`
     - `bundlePositionOf` import와 `pickElement`/`pickRegion`의 `bundle_position` 줄을 지운다.
     - `componentChainOf(target: Element): string | null`을 더한다. `target`부터 위로 `closest("[data-lophn-component]")`를 되풀이해 모든 component 이름을 모으고(`parentElement?.closest`), 바깥 → 안쪽으로 뒤집어 안쪽 8개, 이름 60자 컷, ` > `로 잇는다. 하나도 없으면 null.
     - `pickElement`의 `component`를 `componentChainOf(target)`로 바꾼다. `pickRegion`은 `component: null` 그대로. `targetAt`과 `labelOf`(윤곽과 이름표는 가장 안쪽 component)는 그대로 둔다.
   - `shell/main/app-frame/annotate.ts`: `annotations.push({...})`에서 `bundle_position` 줄을 지운다. 머리 주석의 "페이지가 적은 앱·release·화면은 쓰지 않는다"를 "페이지는 자기가 어느 앱인지 모른다. 신원(앱, release, 화면)은 sender view에서 정한다"로 고친다. `annotate_test.ts`의 `item()`에서 `bundle_position: null`을 지운다.
3. core `annotations/`
   - `commands.ts`: `annotationPersist.input.annotations`를 `z.array(annotationInputSchema).min(1).max(ANNOTATION_BATCH_MAX)`로 바꾼다. `annotationSourceSchema` import와 "source는 core가 release의 source map으로 푼 값" 주석을 지운다. `handle`의 `for (const { input: item, source } ...)`를 `for (const item of input.annotations)`로, INSERT에서 `source_file, source_line, bundle_position` 칸과 값 셋을 뺀다(`VALUES`의 `?` 수도 맞춘다).
   - `schema.ts`: 표에서 `source_file`, `source_line`, `bundle_position` 칸과 `CHECK ((source_file IS NULL) = (source_line IS NULL))`를 지운다.
   - `store.ts`: `readOf`에서 `source` 칸을 지운다.
   - `send.ts`: `resolveAll` import와 호출, `sourceMaps` dep, `ReleaseSourceMaps` import, `persist` 입력의 `source`, `stored`의 `source` 칸을 지운다. `AnnotationDeps` 주석의 "source map은 없는 것과 같다"를 지운다.
   - `source.ts`: file을 지운다.
   - `mod.ts`: `resolveAll`과 `ReleaseSourceMaps` export를 지운다. `ports.ts`: `ReleaseSourceMaps` type을 지운다.
   - `message.ts`: `blockOf`의 `Source` 줄을 지운다. `Component` 줄은 그대로 두되 값이 겹 문자열이다(`Component: List > Card > Button`). `Element:` 줄은 그대로.
4. `annotations/annotations_test.ts`: `SOURCE_MAP`, `input()`의 `bundle_position`, `open()`의 `sourceMaps`, 두 번째 test의 `source` assertion과 제목의 "source 위치"를 지운다. `component: "DataTable"` assertion은 `"List > DataTable"` 같은 겹 값으로 바꿔 넣어 문자열이 그대로 저장되고 읽히는지만 본다. 새 test는 만들지 않는다.
5. release build (근거: issue "source 위치 잇기를 지운다")
   - `core/apps/releases/ui-build/app-build.ts`: `AT_RUNTIME`, `atRuntime`, `plugins`의 `atRuntime(root)`와 위 주석(23~26줄)을 지운다. 머리 주석의 "앱 source는 신뢰하지 않으므로"는 "앱 폴더의 build script는 AI가 쓴 code라 실행하지 않고"처럼 AI code의 실수가 퍼지지 않게라는 이유로 고친다(사용자 앱을 공격자로 보는 문장을 쓰지 않는다. issue `code-health.md` "사용자 앱을 공격자로 보는 장치와 문장"). `sourcemap: "inline"` 주석은 그대로(problems가 map을 쓴다).
   - `core/apps/packages/template/app/scripts/build-ui.ts.tmpl`: 같은 `AT_RUNTIME`/`atRuntime`과 그 주석, `plugins`의 `atRuntime()`을 지운다.
   - `core/apps/releases/bundle/read.ts`: `createReleaseSourceMaps`를 지운다. 머리 주석에서 "annotation의 source 위치(ReleaseSourceMaps)" 부분을 지운다. `SOURCE_MAP_COPY_NAME` import는 `GENERATED_FILES`가 쓰니 남는다.
6. core 조립 목록(소유 밖. 지운 것을 가리키던 줄만 뺀다. 리뷰 예외에 해당)
   - `core/main/daemon/wiring/context.ts`: `ReleaseSourceMaps` import, `Late.releaseSourceMaps`, `LATE_KEYS.releaseSourceMaps`와 그 주석("releases가 releaseSourceMaps를 채운다", "source 위치는 비운다").
   - `core/main/daemon/wiring/apps.ts`: `createReleaseSourceMaps` import와 `ctx.provide("releaseSourceMaps", ...)` 블록과 그 주석.
   - `core/main/daemon/wiring/annotations.ts`: `createAnnotations({... sourceMaps: ...})`의 줄과 "Router와 releases가 채우는 칸" 주석을 "Router가 채우는 칸"으로.
7. 주석과 문장: `core/apps/tickets/reads.ts`(머리 2줄), `protocol/coding-agent/ticket/routes.ts`(115줄 근처), `protocol/coding-agent/ticket/values.ts`(110줄 근처), `coding-agent/cli/commands/ticket.ts`(머리 2줄)의 "source 위치"를 "component 겹"으로 고친다. `SKILL.md`의 순서 1에서 "component, source 위치, screenshot 파일 경로"를 "component 겹, 요소 글자, screenshot 파일 경로"로 고치고, 순서 3의 "ticket이 가리킨 source를 읽는다" 뒤에 "(component 겹과 요소 글자, 화면 이름으로 source를 검색해 찾는다)"를 덧붙인다.
8. architecture 문서(`annotation.md`)는 lead가 고친다. project-docs는 건드리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 지운 것과 문자열 값 하나를 고치는 일이고 기존 test가 저장·읽기를 본다.
- 남지 않음(모두 0줄이어야 한다):
  - `grep -rnE "data-lophn-at|bundlePositionOf|bundle_position|ReleaseSourceMaps|releaseSourceMaps|createReleaseSourceMaps|resolveAll|AnnotationSource|annotationSourceSchema|AnnotationBundlePosition|AT_RUNTIME|atRuntime" packages tools` (단 `core/lophn-agent/providers/adapters/oauth-transport.ts`의 무관한 `resolveAll`은 예외)
  - `grep -rn "source_file\|source_line" packages/core/apps/annotations`
  - `test ! -e packages/core/apps/annotations/source.ts`
- `grep -rn "app.js.map\|sourceMap" packages/core/apps/releases/ui-build/build.ts packages/core/apps/releases/bundle/seal.ts packages/core/apps/releases/prepare/flow.ts`는 그대로 나온다(지우지 않는다).
- 개발 data: schema를 고쳤으니 `.dev-data`로 core를 띄워 볼 때 기존 `.dev-data`가 있으면 지우고 새로 만든다.

## 보고

기본 보고 꼴(brief-template)을 따른다. "알려진 미완 동작"에 "화면 둘 이상인 앱의 합친 app.js.map에는 mappings가 없다(problems가 쓴다)"를 적는다.
