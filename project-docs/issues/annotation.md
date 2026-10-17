# annotation

사람이 앱 화면에서 가리킨 곳(component, source 위치, release, screenshot)을 App Engineer와 coding agent에게 전하는 길이다. `project-docs/architecture/annotation.md`.

## annotation screenshot이 App Engineer model에 안 간다

```yaml
kind: bug
modules: [packages/core/main, packages/core/apps]
```

지금: `core/main/daemon/wiring/router.ts`의 `annotationDelivery.deliver`가 `input.images`를 받고 쓰지 않는다. 사람 메시지는 `parts: [{kind: "text"}]`와 `attached: []`뿐이라 본문에는 `core/apps/annotations/message.ts`의 `[image: Annotation N. ...]` 줄만 있다. 메시지 content에는 image part가 없다(`protocol/lophn-agent/message-content.ts`: text, attached, app_card). screenshot blob은 `general_read: false`(`annotations/blobs.ts`)라 일반 읽기로도 안 열리고, 메시지에 파일 경로도 없어서 App Engineer의 이미지 읽기 tool(`tools/file/image.ts`)로도 열 수 없다. coding agent만 `ticket show`가 주는 파일 경로로 본다. architecture는 "이미지는 메시지에 싣지 않고 ref로 가리킨다"고 적었다.

영향: 사람이 화면을 가리켜 보내면 App Engineer는 "이미지가 있다"는 줄만 본다. 색, 배치, 잘림 같은 시각 문제는 말로 옮긴 메모에만 기댄다. screenshot을 캡처하고 줄이는 비용은 App Engineer에게는 헛수고다.

고치려면:
- 메시지 content에 image part를 더하고 prompt assembly와 provider adapter가 image block으로 싣는다(protocol, lophn-agent, provider 여러 곳, 큼).
- ref를 푸는 읽기 tool 하나(예: annotation 번호로 screenshot을 `tool_result_image`로 돌려준다)를 App Engineer에 준다(tool 하나와 blob 읽기 권한, 중간). 이미 있는 `tool_result_image` 길을 쓴다.
- 의도라고 보고 architecture에 "App Engineer는 screenshot을 못 본다"를 적는다(없음).
- 추천: 둘째. 메시지 모양을 안 바꾸고 필요할 때만 이미지를 읽는다.

정할 것: App Engineer가 screenshot을 볼 필요가 있는지.

## 화면이 여럿인 앱은 annotation 위치가 안 풀린다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: `core/apps/releases/ui-build/build.ts`가 화면마다 esbuild로 묶어 source map을 얻고, 합친 map(`app.js.map`)에는 `mappings`를 화면이 하나일 때만 담는다("화면이 여럿이면 한 map에 이어 붙일 수 없다"). 그래서 `annotations/source.ts`의 `resolveSource`가 `mappings`가 없는 map을 읽어 null을 돌려주고, 보내기는 component와 source를 비운 채 element와 rect로 간다. 화면 하나인 앱은 된다.

영향: 화면이 둘 이상인 앱에서는 annotation에 source 위치가 없다. coding agent가 어느 파일을 고칠지 `component`와 element 설명으로만 짐작한다.

고치려면:
- 화면마다 map을 따로 저장하고(`<screen>.js.map`) `sourceMap(app, release, bundleFile)`이 bundle 파일에 맞는 map을 고른다. 지금 시그니처가 이미 `bundleFile`을 받는다(중간).
- 합친 map에서 `sections`(index map)를 쓴다. 각 화면 map을 오프셋 없이 section으로 이어 붙인다(작지만 오프셋 계산이 필요).
- 추천: 첫째. 화면마다 파일이라 읽는 쪽도 단순하다.

## annotation command 넷과 ref 표, 24시간 sweep, 1시간 유예

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: `AnnotationPersist/Discard/AddRefs/Sweep` command 넷(`core/apps/annotations/commands.ts`), `annotation_batches`·`annotations`·`annotation_refs` 표, 하루 한 번 sweep(`retention.ts`), 방금 보낸 묶음의 1시간 유예(`SWEEP_GRACE_MS`)가 있다. `annotations.send`는 memory route라 ledger를 못 써서 사람 자격으로 command를 다시 낸다. session 메시지와 ticket이 `addRef`/`removeRefs`로 ref를 붙이고 뗀다.

영향: annotation 하나를 남기고 지우는 데 command, 표, ref, sweep, 유예가 모두 걸려 있다. ticket과 session 메시지 쪽 코드도 ref를 관리해야 한다.

고치려면:
- annotation을 메시지 본문에만 남기고 표·sweep을 없앤다. ticket 근거가 annotation을 직접 가리키지 않으니 coding agent가 `ticket show`로 screenshot 경로와 source를 받는 길(`AnnotationLookup`)이 사라지거나 ticket이 값을 복사해 가져야 한다(큼).
- 남긴다. ticket 근거를 값으로 풀어 주는 일에는 표가 필요하다.
- 추천: 남긴다. 줄이려면 먼저 coding agent가 annotation을 받는 길을 정한다.

정할 것: ticket 근거로 annotation을 계속 가리킬지.

## jsx-runtime esbuild plugin이 jsx 호출마다 stack으로 위치를 읽는다

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: `core/apps/releases/ui-build/app-build.ts`의 `atRuntime`이 앱 `src/` 안의 `react/jsx-runtime`을 `AT_RUNTIME`으로 바꾼다. 그 `jsx`·`jsxs`가 호출마다 `new Error().stack`을 만들어 위치를 읽고(`at()`), 컴포넌트(함수 type)면 `data-lophn-at`을 props에 싣는다. 옛 글과 달리 SDK component만이 아니라 앱 source의 모든 jsx 호출에서 stack을 만들고, 문자열 type(DOM 요소)이면 그 값을 버린다. production build(minify)에도 들어간다. 앱 template의 `scripts/build-ui.ts`에 같은 코드가 복사돼 있어 한쪽만 고치면 어긋난다.

영향: 렌더마다(jsx 호출마다) stack 생성 비용이 든다. 이 길은 annotation의 source 위치 한 가지만 위해서다.

고치려면:
- DOM 요소일 때는 `at()`을 부르지 않는다(`typeof type === "string"`을 먼저 검사, 한 줄로 비용 대부분이 사라진다).
- 위치 잇기를 뺀다. annotation은 component 이름과 element 설명, rect만 남긴다(`data-lophn-at`, preload의 `describe.ts`, source map 풀이, 아래 이슈들이 같이 지워진다. 큼).
- 추천: 첫째를 지금 하고, 둘째는 source 위치가 실제로 쓰이는지 써 보고 정한다.

정할 것: source 위치 잇기를 유지할지.

## source map으로 bundle 위치를 source 위치로 푼다

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: `annotations.send`가 `annotations/source.ts`의 `resolveAll`을 불러 release의 `app.js.map`을 읽고, VLQ `mappings`를 직접 풀어 bundle 위치를 앱 source의 파일:줄로 바꾼다(`ReleaseSourceMaps.sourceMap`은 `releases/bundle/read.ts`). 못 풀면 null이고 보내기는 막지 않는다. React fiber에 기대지 않으려고 고른 길이다(architecture "왜 이 모양인가").

영향: source map 파서와 release map 읽기가 annotation 쪽에 하나 더 있다. 화면 여럿 앱은 위에 적은 대로 지금 풀리지 않는다.

고치려면: 지우려면 위 jsx-runtime 이슈의 "위치 잇기를 뺀다"를 택해야 한다(같은 결정이다). 추천: 남긴다. 이유는 architecture에 이미 있다. 단 화면 여럿 버그를 먼저 고친다.

정할 것: 위 jsx-runtime 이슈와 같이 정한다.
