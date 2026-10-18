# sm-mcp-settings-path

일반 설정 통로(`SettingsSource`)에서 화면이 부르지 않는 MCP·skill 폴더 함수와, 그것만 쓰는 type·구현·fake를 지운다. MCP server를 더하는 길은 Tools and skills 탭(`AgentsSettingsSource`) 하나만 남긴다.

- 단위: sm-mcp (wave 3)
- 선행: sm-envelope-helper
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/source.ts`
  - `packages/shell/renderer/desktop/settings/core-source.ts`
  - `packages/shell/renderer/desktop/settings/extension-settings.ts`
  - `packages/shell/renderer/desktop/settings/testdata/fake-settings.ts`
  - `packages/shell/renderer/desktop/dev-mock/admin.ts`
- 읽을 것:
  - issue: `project-docs/issues/shell.md`의 "일반 설정 통로의 MCP 함수를 화면이 부르지 않는다"(정한 것: 지운다)
  - 남는 쪽: `desktop/settings/agents/core-source.ts`(`readExtensions`, `createServer`가 `extension-settings.ts`의 `readExtensionSettings`·`applySetting`·`authStates`·`secretStates`·`secretOf`를 쓴다)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`(boundary `shell`)
- 계약:
  - 쓰는 것: 없음(지우기만 한다)
  - 내놓는 것: `SettingsSource`는 `watch`, `declared`, `update` 셋만 남는다. General 탭(`general/general-panel.tsx`)과 `use-reload.ts`가 이 셋만 쓴다.

## 할 일

1. `source.ts`에서 `SettingsSource`의 `settings`, `addSkillFolder`, `addServer`, `enterServerCredential`, `beginSignIn`, `finishSignIn`, `cancelSignIn`을 지운다. 그것만 쓰는 type `SettingsView`, `ServerRow`, `NewServer`, `ServerSignIn`, `ServerPlace`를 지운다.
2. `source.ts`의 `ServerAuth`, `ServerSignInState`, `ServerSignInReason`은 `extension-settings.ts`(그리고 `agents/core-source.ts`)가 쓰므로 둔다. `WindowOutcome`, `SourceResult`, `AuthWay`, `ProviderRow` 등 Providers 통로가 같이 쓰는 모양도 둔다. 파일 머리 주석에서 "skill 폴더·도구 server"를 뺀다.
3. `core-source.ts`: `coreSettingsSource`에서 위 함수 일곱과 그것만 쓰는 `cancel`, `signInOf`, `INVALID`, `SettingsDeps`(deps 인자 `openSecret`·`picker`·`openLink`·`random`), 쓰지 않게 된 import를 지운다. `watch`, `declared`, `update`만 남는다. `entry.tsx`는 `coreSettingsSource(core)`로 부르니 호출 쪽은 그대로다.
4. `extension-settings.ts`: 머리 주석의 "일반 설정 통로(core-source.ts)와 Agents 통로가 같이 쓴다"를 Agents 통로 하나로 고친다. 이 file의 export는 `agents/core-source.ts`가 모두 쓰는지 grep으로 본다. 안 쓰는 export가 생기면 지운다.
5. `testdata/fake-settings.ts`: `fakeSettings`에서 위 일곱 함수의 가짜, 그것만 쓰던 option(`settings`, `settingsFail`, `windowCode`, `pickedFolder`, `applyCode`, `signIn`)과 상태(`states`, `cancelWait`, `opened`), `server()` helper를 지운다. `declared()`, `SAMPLE_DECLARED`, `watch`·`declared`·`update`의 가짜는 둔다.
6. `dev-mock/admin.ts`의 `mockSettings`에서 `settings:`(folders, servers)와 `server` import를 지운다. `tools/wireframes/pages/screens/settings-frame.tsx`는 `fakeSettings().source`만 부르니 고칠 것이 없다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- 위험 test: 없음(잃는 기능이 없는 죽은 코드를 지우는 일이다).
- 남지 않음: `grep -rnE "\b(beginSignIn|finishSignIn|cancelSignIn|enterServerCredential|addSkillFolder|SettingsView|ServerRow|NewServer|ServerSignIn|ServerPlace|rawServers)\b" packages tools tests --include=*.ts --include=*.tsx --exclude-dir=dist --exclude-dir=node_modules`가 0줄이다. (`HarnessSettingsView`, `AgentsSettingsView`, `ServerSignInState`는 단어 경계가 달라 걸리지 않는다.)
- `deno task wireframes`가 되고, gallery의 Settings 쪽 page가 그려진다(`fakeSettings`를 쓴다).

## 보고

- 바꾼 file, 통과한 check
- 안 쓰게 된 export: 남이 쓰던 것은 지우지 않는다. 있으면 적는다.
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"
