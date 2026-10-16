# app-calls-screens

앱 화면 byte를 core가 release의 UI bundle 사본에서 내주는 길을 짓는다. 지금은 shell main이 앱 process의 `/screens` 직접 통로로 가져오는데, 직접 통로가 없어지므로 core의 `app.screen_file` file route가 대신한다(결정 #8).

- 단위: app-calls (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/screens/` (새 폴더)
- 읽을 것:
  - spec: S5 9장("앱 화면 byte(`/screens`)를 내주던 길도 이 통로라 새 길이 필요하다") — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - inventory: 이 task의 줄은 assignment.md에 없다. lead 몫으로 적힌 `I6#23`(앱 화면 byte를 내주는 길을 정한다. `/home/pyosechang/projects/lophn/project-docs/plan/assignment.md`의 lead 절)가 `README.md` 3장 #8로 이미 정해졌으므로 이 task가 짓는다. 보고에 적혀 있다. 문맥으로 `I2.5#28`(shell main의 view 연결)
  - 결정: `/home/pyosechang/projects/lophn/project-docs/plan/README.md` 3장 #8
  - 지금 코드: `packages/core/apps/runtime/entrypoint/screen-files.ts`(content type 표와 경로 규칙), `screens.ts`, `wire.ts`의 `screenAssetPath`(app-calls-process가 지운다. 먼저 읽어 둔다), `packages/shell/main/app-frame/app-protocol.ts`(받는 쪽)
- 계약:
  - 쓰는 것: `core/apps/ports.ts`의 `BundleLocator`(`dir(target)`), `protocol/apps/calls/screen.ts`의 `appScreenFile`·입력 type, `protocol/apps/calls`의 `AppApiTarget`, `protocol/projects/values.ts`의 `relativePathSchema`
  - 내놓는 것: `serveScreenFile(deps, input): Promise<Result<{bytes: Uint8Array; contentType: string}>>`(`core/apps/screens/mod.ts`). `app.screen_file` route에 올리는 일은 app-calls-assembly가 한다. 앱 화면은 이 route로만 byte를 받는다.

## 할 일

1. `serve.ts` — `serveScreenFile`
   - 입력 `{target, screen, path}`. `BundleLocator.dir(target)`이 준 폴더의 `screens/<screen>/<path>` 파일 하나의 byte를 읽어 준다. 쓰기는 없다.
   - 규칙(옛 `screen-files.ts`와 `wire.ts`의 `screenAssetPath`를 옮긴다): `screen`은 빈 값·`..`·구분자를 가질 수 없다. `path`는 상대 경로이고 `\`, `..`, `:`, `//` 시작을 거절한다. 거기에 더해 `realPath`로 풀어 본 결과가 그 screen 폴더 밖이면(bundle 안의 symlink가 밖을 가리키는 경우) `not_found`로 답한다. 다른 screen 폴더, bundle 밖, 폴더, 크기 상한(주입, 기본 8 MiB) 초과는 모두 같은 `not_found`다. 없는 파일과 구별하지 않는다.
   - 파일 시스템 접근은 `deps`로 받는다(`readFile`, `realPath`). 실제 구현은 `adapters.ts`에 둔다.
2. `content-type.ts` — 옛 `screenContentType` 표를 그대로 옮긴다. 모르는 확장자는 `application/octet-stream`.
3. `mod.ts` — `serveScreenFile`, `ScreenFileDeps`, 실제 adapter 생성 함수를 내보낸다.
4. file route 등록 방식
   - file route를 core에 올리는 방식은 wiring의 `Built.fileStreams`(`core-wiring-split.md`의 `Wiring` 약속)와 `core/server`의 file route 처리, `core/projects/file-tracking/coordinator/serving.ts`(`DocumentsChannel`. lead가 공용 위치로 옮기는 중이다)를 본다. 이 task는 위 함수까지 만들고, 등록 모양이 아직 정해지지 않았거나 맞지 않으면 등록은 하지 않고 어떤 모양이 필요한지 보고한다. app-calls-assembly가 이어서 올린다.
5. 위험 test 한 file `serve_test.ts` (임시 폴더에서 bundle 모양을 만들고 표로 돈다)

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/apps/screens/serve_test.ts`): "화면 byte 요청은 그 screen 폴더 안의 파일만 내주고, `..`·절대 경로·밖을 가리키는 symlink·다른 screen·폴더는 모두 거절한다"
- 남지 않음: 해당 없음(새 폴더). 옛 `screen-files.ts`·`screens.ts`는 app-calls-process가 지운다.

## 보고

- 바꾼 file
- 등록할 것: `app.screen_file` file route에 `serveScreenFile`을 올리는 곳(app-calls-assembly), `BundleLocator`의 실제 구현(lead 조립. releases의 bundle 사본과 preview 영역)
- 안 쓰게 된 export: 없음
- 정한 것: 크기 상한 8 MiB, symlink 탈출을 `not_found`로 답한 것
- 계약 바꾸기 요청(wave 3): file route 등록에 필요한 모양이 `appScreenFile` 정의와 맞지 않을 때
