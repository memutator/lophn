# annotation (닫음)

## annotation command 넷과 ref 표, 24시간 sweep, 1시간 유예

```yaml
kind: defect
modules: [packages/core/apps]
closed: kept
guard: 없음
```

지금: `AnnotationPersist/Discard/AddRefs/Sweep` command 넷(`core/apps/annotations/commands.ts`), `annotation_batches`·`annotations`·`annotation_refs` 표, 하루 한 번 sweep(`retention.ts`), 방금 보낸 묶음의 1시간 유예(`SWEEP_GRACE_MS`)가 있다. `annotations.send`는 memory route라 ledger를 못 써서 사람 자격으로 command를 다시 낸다. session 메시지와 ticket이 `addRef`/`removeRefs`로 ref를 붙이고 뗀다.

영향: annotation 하나를 남기고 지우는 데 command, 표, ref, sweep, 유예가 모두 걸려 있다. ticket과 session 메시지 쪽 코드도 ref를 관리해야 한다.

고치려면:
- annotation을 메시지 본문에만 남기고 표·sweep을 없앤다. ticket 근거가 annotation을 직접 가리키지 않으니 coding agent가 `ticket show`로 screenshot 경로를 받는 길(`AnnotationLookup`)이 사라지거나 ticket이 값을 복사해 가져야 한다(큼).
- 남긴다. ticket 근거를 값으로 풀어 주는 일에는 표가 필요하다.
- 추천: 남긴다. 줄이려면 먼저 coding agent가 annotation을 받는 길을 정한다.

닫음: 남긴다. coding agent가 `ticket show`로 annotation과 screenshot 경로를 받는 길이 이 표를 쓴다.

## 겹친 화면 요소에서 가장 안쪽 component 하나만 간다

```yaml
kind: bug
modules: [packages/shell/preload, packages/protocol, packages/core/apps]
closed: fixed
guard: 없음
```

지금: `shell/preload/annotate/pick.ts`의 `targetAt`이 찍힌 곳에서 `closest("[data-lophn-component]")`로 가장 가까운 SDK component 하나를 고르고, `component`에 그 이름 하나만 싣는다. 화면의 한 점에는 `List > Card > Button`처럼 여러 겹이 있는데 사람이 어느 겹을 뜻했는지는 코드로 알 수 없다.

영향: "카드 간격이 이상해"를 찍어도 `Button`이 가서 App Engineer를 엉뚱한 component로 이끈다.

고치려면: 찍은 곳에서 위로 올라가며 `data-lophn-component`가 붙은 component를 모두 모아 `List > Card > Button "저장"` 꼴로 보낸다. 어느 겹인지는 App Engineer가 메모와 screenshot으로 고른다. preload의 pick과 protocol의 annotation 칸 하나, 메시지 문구(`core/apps/annotations/message.ts`)를 고친다(작음).

정한 것: component 겹을 보낸다. 계산된 style(색, font)과 text 선택 annotation은 넣지 않는다.

닫음: shell `pick.ts`의 `componentChainOf`가 고른 요소에서 위로 만나는 SDK component 이름을 바깥 → 안쪽으로 ` > `로 이어(안쪽 8개, 이름 60자) `component`에 싣는다. 칸 이름과 type은 그대로다.

## source 위치 잇기를 지운다

```yaml
kind: defect
modules: [packages/core/apps, packages/shell/preload, packages/protocol]
closed: fixed
guard: 없음
```

지금: 앱 build 때 `core/apps/releases/ui-build/app-build.ts`의 `atRuntime`이 앱 `src/`의 `react/jsx-runtime`을 바꿔치기해 jsx 호출마다 `new Error().stack`으로 bundle 위치를 읽고 component에 `data-lophn-at`을 싣는다(DOM 요소도 stack을 만들고 버린다, production build에도 들어간다). 앱 template의 `scripts/build-ui.ts`에 같은 코드가 복사돼 있다. 보낼 때 `core/apps/annotations/source.ts`의 `resolveAll`이 release의 `app.js.map`을 읽어 VLQ를 직접 풀어 파일:줄로 바꾼다. 화면이 둘 이상인 앱은 `ui-build/build.ts`가 합친 map에 `mappings`를 담지 않아 늘 null이다.

영향: 렌더마다 stack 비용, source map 파서, 복사된 template 코드, 화면 여럿 bug를 지고 있다. 그런데 화면 요소가 겹쳐 있어 이 줄 번호는 사람이 뜻한 component가 아니라 우연히 맨 안쪽에 있던 SDK component를 쓴 줄이다. 앱이 직접 만든 component는 위치가 안 남고 list 항목은 모두 같은 줄이다.

고치려면: `atRuntime`과 template의 같은 코드, `data-lophn-at`, preload의 `bundlePositionOf`, `annotations/source.ts`와 `ReleaseSourceMaps`, annotation의 source 칸, 화면 여럿 map 처리를 지운다. App Engineer와 coding agent는 component 겹, 요소 글자, 화면 이름, screenshot으로 코드를 검색해 찾는다. 지운 뒤 `architecture/annotation.md`를 고친다.

정한 것: 지운다. ChatGPT 데스크톱 앱의 browser comment도 source 위치를 쓰지 않고 screenshot, selector, 요소 글자를 같이 보내 model이 다시 찾게 한다.

닫음: `atRuntime`(core `app-build.ts`와 앱 template `build-ui.ts`), `bundle_position`, `source.ts`(`resolveAll`), `ReleaseSourceMaps`, protocol의 `source`, 표의 `source_file`·`source_line`·`bundle_position`, 메시지의 `Source` 줄을 지웠다. `app.js.map`은 problems가 쓰므로 남겼다.
