# platform-install

Linux 설치 묶음의 launcher(`packages/base/install/linux-install.ts`)를 새 coding 연결에 맞춘다. 사람이 쓰는 `lophn` CLI wrapper의 Deno 권한을 "core loopback과 읽기 위주"로 줄이고, 없어지는 `lophn-credential` helper와 `lophn-mcp` launcher를 걷고, 더는 쓰지 않는 secret-tool 의존과 URL scheme 등록을 설치 묶음에서 뺀다.

- 단위: platform (wave 3)
- 선행: coding-agent-cli (CLI가 token을 환경 변수 `LOPHN_CODING_TOKEN`에서 받고 `launch.ts`의 권한 계획이 줄어든 뒤의 모양을 wrapper가 따라야 한다. `mcp-server`가 지워진 뒤여야 `mcpLauncher`를 지울 수 있다), platform-runtime(`core/install-and-update/credential-*.ts`를 지운다)
- 소유(이 task만 고친다):
  - `packages/base/install/linux-install.ts`
  - `packages/base/install/` 안의 나머지(`instance-lock.ts`는 고치지 않는다)
  - `tools/package-linux.ts`, `tools/verify-linux-install.ts`의 이 file의 이름을 부르는 줄(추가 소유, lead 승인 2026-10-16: lead 소유 `tools/`. 이름만 따라 고친다)
- 읽을 것:
  - spec: S6 3·4장(CLI 명령과 token) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `I2.6#3` (`../assignment.md`의 platform 줄. `cli/launch.ts`·`launch-entry.ts` 쪽은 coding-agent-cli가 한다)
    - 같이 볼 줄(다른 단위 몫): `I1.11#13`(`base/install/linux-install.ts`의 launcher 이름 `lophn-mcp`·`lophn-credential`은 06이 맡는다고 적혀 있다. 그 file이 platform 소유라 이 task가 고친다), `I1.6#8`(coding token의 keychain 보관·전달. 배정은 remove-platform이지만 설치 binary `lophn-credential`은 이 file이라 이 task가 platform 몫을 한다)
  - 결정: `../README.md` 3장 #66·67(coding token은 환경 변수 `LOPHN_CODING_TOKEN`, `lophn hook`), #69(CLI 명령)
  - 지금 코드: `packages/base/install/linux-install.ts`(280줄: `LinuxInstallLayout.credentialHelper`, `LINUX_LAUNCHERS.mcp`, `CREDENTIAL_HELPER_COMPILE_FLAGS`, `launcherHead`, `cliLauncher`, `mcpLauncher`, `LINUX_DEPENDS`, `desktopEntry`), `packages/coding-agent/cli/launch.ts`(coding-agent-cli가 줄인 권한 계획), `tools/package-linux.ts`
- 계약:
  - 쓰는 것: coding-agent-cli가 낸 CLI 권한 계획의 flag 목록(`launch.ts`)
  - 내놓는 것: 없음(순수 값. build 도구와 설치 검사가 이 값을 쓴다)

## 할 일

1. **CLI wrapper 권한** `cliLauncher` — `I2.6#3`
   - 계획 단계(`launch-entry.ts`를 부르는 `$ROOT/deno run`)의 `--allow-run="$ROOT/lophn-credential"`을 없앤다(helper가 없어진다).
   - 본 실행의 `--allow-run`에서 `$ROOT/lophn-credential`을 뺀다. 남기는 실행은 coding-agent-cli의 `launch.ts`가 계획하는 것만이다(설치 Deno, `lophn-desktop`).
   - `WRITE="$H/integrations,$H/run/<lock>"`에서 `$H/integrations`을 뺀다. 쓰기는 instance lock 파일만 남기고, `harness install` 같은 명령이 더하는 쓰기 경로는 `launch.ts`의 권한 계획이 이 실행에만 더한다(coding-agent-cli의 보고에 적힌 대로). 읽기의 `$H/integrations`도 coding-agent-cli의 보고에 있는지 확인하고 없으면 뺀다.
   - `CLI_ENV`의 환경 이름을 coding-agent의 `CLI_ENV_NAMES`와 같게 맞춘다: `LOPHN_CONNECTION`, `LOPHN_APP`을 빼고 `LOPHN_CODING_TOKEN`을 넣는다(coding-agent-cli의 결과를 따른다).
   - 주석을 바뀐 권한에 맞춰 다시 쓴다(코드가 말하는 "무엇"은 줄이고 "왜"만 남긴다).
2. **지울 것** — `I1.11#13`(launcher 이름)
   - `mcpLauncher`, `LINUX_LAUNCHERS.mcp`, `LinuxInstallLayout.credentialHelper`와 `linuxInstallLayout`의 값, `credentialLoaderIdentity`, `CREDENTIAL_HELPER_COMPILE_FLAGS`, `launcherHead`의 `LOPHN_HOME` 주석 중 helper 이야기.
   - 쓰는 곳은 `tools/package-linux.ts`(helper compile, mcp launcher 파일), `tools/verify-linux-install.ts`, `core/main/daemon/` 쪽의 `codingLoaders`다. `core`와 `tools` 쪽 쓰는 곳은 소유 밖이므로 지우기 전에 `grep -rn "credentialHelper\|credentialLoaderIdentity\|mcpLauncher\|CREDENTIAL_HELPER_COMPILE_FLAGS\|LINUX_LAUNCHERS.mcp" packages tools`를 하고, 소유 밖에 남은 곳은 export를 남겨 보고한다.
3. **설치 의존과 URL scheme**
   - `LINUX_DEPENDS`에서 `libsecret-tools`(secret-tool binary)를 뺀다. `libsecret-1-0`은 Electron이 쓰므로 남긴다.
   - `desktopEntry`의 `MimeType=x-scheme-handler/lophn;`를 뺀다(platform-desktop이 `lophn://` 링크와 URL scheme 등록을 걷는다). `Exec=… %U`의 `%U`는 `--open-app` 인자에 영향이 없는지 보고 필요 없으면 `%U`를 뺀다.
4. `tools/package-linux.ts`·`tools/verify-linux-install.ts`가 위에서 지운 이름을 부르면 그 줄을 이름만 따라 고친다(helper compile 단계와 mcp launcher 파일 쓰기 단계를 걷는다). 그 밖의 도구 로직은 건드리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "lophn-credential\|lophn-mcp\|libsecret-tools\|x-scheme-handler/lophn" packages/base tools`가 0줄이다(소유 밖에 남긴 export는 보고에 적고 그 줄은 예외다).

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 위 2번에서 소유 밖 쓰는 곳 때문에 남긴 것
- 정한 것: 문서에 답이 없어 정한 것(`$H/integrations` 읽기·쓰기를 뺀 근거, `%U` 처리)
- 걱정: `harness install`이 쓰는 경로가 많아지면 wrapper 권한이 다시 넓어진다. coding-agent-cli가 그 명령만 권한을 올리는 방식을 택했는지 확인이 필요하다

- (lead가 더함, coding-agent-cli가 넘긴 것) `packages/base/install/linux-install.ts`가 아직 `mcp-server/main.ts`를 가리킨다(`mcpLauncher`). lophn-credential helper의 `--allow-run`도 남았다. 둘 다 걷는다. `CLI_ENV`와 launcher 권한을 새 `CLI_ENV_NAMES`(LOPHN_HOME, LOPHN_CODING_TOKEN, LOPHN_DAEMON_URL, HOME, DENO_DIR, PATH)에 맞춘다. 고정 `--allow-run`은 필요 없고, launcher가 launch-entry를 부르는 조건은 `harness`만 남는다. `tools/package-linux.ts`의 mcp-server·credential 항목도 걷는다.
- (lead가 더함, agent-definition-roles가 넘긴 것) 안내 md가 text module(`roles/guides.ts`)이 되어, `linux-install.ts`의 `guides` 복사 경로와 shell `supervise.ts`의 `guides/` 경로가 필요 없다. 걷는다.
- (lead가 더함) coding-agent-cli가 lophn-credential helper를 걷었다. `core/main/daemon/main.ts`의 credential socket(`serveCredentialSocket`)이 아직 필요한지 보고, 필요 없으면 걷는다(추가 소유, lead 승인: 그 줄).
- (lead가 더함, coding-agent-harness가 넘긴 것) `linux-install.ts`의 bash launcher에 `$H/integrations` 읽기·쓰기 줄이 남았다. CLI가 더 쓰지 않으니 걷는다.
