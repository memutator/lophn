# mobile-drive-preview-read

폰이 컴퓨터에서 지금 도는 앱 preview의 폰 화면을 알게 한다: `apps/phone_screens`의 출력에 `previews` 칸을 더해, ready인 preview마다 그 preview bundle이 선언한 `phone` 화면과 manifest(`phone.json`), `process_nonce`, `bundle_hash`를 싣는다. 폰은 이것으로 앱 menu의 "Preview from lophn" 줄을 보이고, 화면 file은 이미 있는 `apps/screen_file`(target preview)로, view는 `app_views/open {mode: "preview"}`로 연다. 새 route와 폰 gate의 변경은 없다.

- 단위: drive-core (wave 1)
- 선행: 없음. **`mobile-app`, `mobile-user-apps`, `mobile-widgets` 계획이 main에 land된 뒤에 띄운다**(`apps/phone_screens`와 그 handler는 `mobile-user-apps`의 것이다)
- 소유(이 task만 고친다):
  - `packages/protocol/apps/phone.ts`
  - `packages/core/apps/phone/screens.ts`
  - `packages/core/apps/phone/screens_test.ts`
- 한 줄씩 허락(공유 file. 줄만 고치고 보고의 "넘길 줄"에 적는다): `packages/core/main/daemon/wiring/apps.ts`(`phoneScreensRead`에 넘기는 deps에 preview 관측 함수를 붙이는 만큼), `packages/core/apps/routes.ts`(`phoneScreensRead`가 deps를 넘기는 만큼)
- 읽을 것:
  - 지금 것: `packages/protocol/apps/phone.ts`의 `appPhoneScreens`(출력 `screens`, 그 윗줄 주석), `packages/core/apps/phone/screens.ts`(`readPhoneScreens`, `readManifest`의 bundle 폴더 가드), `packages/core/main/daemon/wiring/apps.ts`의 `apps/phone_screens` 등록과 `running`
  - preview: `packages/protocol/apps/previews.ts`(관측 `process_nonce`, `bundle_hash`, `release`, `ready`), wiring의 `appsControl.previews.current(app)`와 `appsControl.client.previewObserve(app, nonce)`(view module의 `preview(app)` port가 둘을 엮는 본보기: `wiring/apps.ts`의 `createAppViews` 부분), `packages/core/apps/routes.ts`의 `bundleLocatorOf`(target `{mode: "preview", app, process_nonce}`가 그 preview의 bundle 사본을 가리킨다), preview bundle의 선언을 읽는 길(`appToolLookupOf(...).findPreview`가 쓰는 함수. 같은 함수로 화면 목록을 읽는다)
  - 폰이 쓰는 쪽: `packages/protocol/apps/calls/screen.ts`(`apps/screen_file`의 `target`이 `appToolTargetSchema`라 preview를 받는다), `packages/protocol/apps/views.ts`(`app_views/open`의 `mode: "preview"`, `release: null`이면 어떤 preview든)
  - 계획 `README.md`의 "정한 것"(preview만)
- 계약:
  - 쓰는 것: 위 route와 port
  - 내놓는 것: `appPhoneScreens.output`에 칸 하나: `previews: [{app, app_name, icon, release: rel id | null, bundle_hash, process_nonce, screens: [{screen, label, params?, manifest}]}]`. 보관한 앱, preview가 ready가 아닌 앱, preview bundle에 `phone` 화면이 없는 앱은 싣지 않는다. 화면 줄은 `screens`의 같은 칸과 같은 규칙이다(manifest가 없거나 틀린 화면은 뺀다). `previews`는 늘 있다(없으면 빈 배열). `reads`에 이미 `app_runtime`이 있어 preview가 서고 멈출 때 폰이 `StateChanged`로 다시 읽는다(확인만 한다)

## 할 일

1. `phone.ts`: 출력에 `previews`를 더하고 윗줄 주석에 한 문장(지금 도는 preview의 폰 화면. 화면 file은 `apps/screen_file`의 target `{mode: "preview", app, process_nonce}`, view는 `app_views/open`의 `mode: "preview"`).
2. `screens.ts`: `PhoneScreensDeps`에 `preview(app): Promise<{release, bundle_hash, process_nonce} | null>`(ready일 때만)를 더하고, 보관하지 않은 앱마다 preview를 보고 그 preview bundle의 선언에서 `places`가 `["phone"]`인 화면을 고른다. manifest는 `readManifest`를 target을 받게 넓혀 preview bundle 사본의 `screens/<key>/phone.json`을 같은 가드로 읽는다.
3. wiring 한 줄: deps의 `preview`를 view module의 `preview` port와 같은 길(`previews.current` + `previewObserve`)로 채운다.
4. `screens_test.ts`에 아래 위험 test와 정상 경로 하나(release 없는 preview도 실린다)를 더한다. fake `BundleLocator`와 메모리 sql로 만든다.
5. flows catalog: 바뀐 route outcome의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test: "`previews`는 ready인 preview만 싣고, 보관한 앱의 preview와 manifest가 preview bundle 폴더 밖(`..`, 밖을 가리키는 symlink)에서 읽히는 화면을 싣지 않는다"(폰이 받을 bytes의 출처 경계)
- 남지 않음: 없음(더하기뿐).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 출력 예 하나(live 화면 하나와 preview 하나), preview가 서고 멈출 때 `StateChanged{app_runtime}`이 실제로 나가는지 확인한 곳, 넘길 줄.
