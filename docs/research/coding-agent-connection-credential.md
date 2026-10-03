---
type: research
concerns: [coding-agent/connection]
---
# coding agent 통로의 connection credential

## 질문

MCP server·CLI가 설정 파일에 token을 쓰지 않고 credential을 받으려면 OS keychain을 어떤 service·account로 열고, 자식 프로세스에 어떻게 넘기며, 회수를 어디서 확인하나. 같은 keychain을 쓰는 harness의 원격 MCP OAuth 항목과 이름이 겹치지 않게 구별하는 규칙도 필요하다.

조사일 2026-10-04. `[확인]`은 그 revision 코드, `[문서]`는 공식 문서, `[미확인]`은 이번 조사에서 못 본 것이다.

## 프로젝트별

### Codex (`3a69ec3ef8fb`)

- [확인] keychain crate는 `keyring` 3.6이다. workspace는 `default-features = false`이고, rmcp-client가 OS별로 `apple-native`, `linux-native-async-persistent`(async-secret-service + keyutils), `windows-native`, 테스트용 `sync-secret-service`를 켠다. 래퍼는 `codex-rs/keyring-store/src/lib.rs`의 `KeyringStore`(`load`·`save`·`delete`)와 `DefaultKeyringStore`다. `Entry::new(service, account)` 뒤 `get_password`·`set_password`·`delete_credential`이고, `NoEntry`만 부재로 본다.
- [확인] CLI auth mode `AuthCredentialsStoreMode`의 기본은 `File`이다(`codex-rs/config/src/types.rs:116`). `Keyring`은 없으면 실패, `Auto`는 keyring 후 `CODEX_HOME/auth.json`, `Ephemeral`은 프로세스 메모리만. MCP OAuth mode `OAuthCredentialsStoreMode`의 기본은 `Auto`다(`types.rs:128`). 주석은 keyring 실패 때 file로 내리고, client가 한 번 고른 store를 수명 동안 pin해서 refresh가 다른 store로 넘어가지 않게 한다고 적는다. `resolved_store.rs:229`의 `resolve_oauth_tokens_from_store_policy`가 그 순서다. `Auto`에서 keyring이 `Ok(None)`이면 file을 읽고, backend unavailable도 file로 내린다. 주석(242)은 프로세스가 달라도 keyring 가용성이 다르면 Auto가 다른 store로 resolve될 수 있다고 적는다.
- [확인] backend `AuthKeyringBackendKind`의 기본은 Windows만 `Secrets`, 그 외 `Direct`다(`types.rs:155`). `Direct`는 JSON 원문을 keyring에 넣고, `Secrets`는 로컬 암호화 파일에 payload를 두고 파일 키만 keyring에 둔다.
- [확인] CLI auth의 service는 `"Codex Auth"`, account는 `cli|<codex_home canonical path sha256 앞 16자>`다(`codex-rs/login/src/auth/storage.rs:243`, `compute_store_key`). Secrets backend의 파일 키 account는 `secrets|<같은 16자>`이고 gateway OAuth만 `|gateway-oauth`를 붙인다(`codex-rs/secrets/src/lib.rs:184`). MCP OAuth service는 `"Codex MCP Credentials"`, secret 이름은 `MCP_OAUTH_<server_name+url sha256 hex 앞 32자>`다(`codex-rs/rmcp-client/src/oauth.rs:100`, `compute_secret_name` 1090). file fallback은 `CODEX_HOME/.credentials.json`(`oauth.rs:17`, `FALLBACK_FILENAME` 857). CLI auth file은 `0o600`(`storage.rs:225`).
- [확인] 오류 분류는 `codex-rs/keyring-store/src/error_kind.rs`다. macOS security-framework 코드 `-25291`은 `NotConnected`, `-25292`·`-25293`은 `PermissionDenied`. Linux `secret_service::Error::Locked`는 `WouldBlock`, `Unavailable`은 `NotConnected`. Windows `1312`(`ERROR_NO_SUCH_LOGON_SESSION`)은 `NotConnected`, `5`는 `PermissionDenied`. 주석은 `NoStorageAccess`만으로 잠김을 단정하지 않는다고 적는다.
- [확인] stdio MCP 자식 env는 whitelist다. `codex-rs/rmcp-client/src/utils.rs:163`의 `DEFAULT_ENV_VARS`는 `HOME`, `LOGNAME`, `PATH`, `SHELL`, `USER`, `__CF_USER_TEXT_ENCODING`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`, `TZ`뿐이다. config의 `env_vars`와 `env` override를 더한 뒤 `is_non_inheritable_env_var`로 뺀다. 빼는 이름은 `CODEX_EXEC_SERVER_NOISE_AUTH_TOKEN`, `NODE_REPL_AUTH_TOKEN`, `CODEX_GUARDIAN_DECISIONS_API_KEY`, `OPENAI_FEDERATION_RULE_ID`, `OPENAI_IDENTITY_TOKEN_FILE`, `OPENAI_WORKLOAD_IDENTITY_CONTEXT`다(`codex-rs/protocol/src/shell_environment.rs:14`). `LOPHN_*`는 이 목록에 없어 config `env_vars`에 이름을 적으면 전달된다. 원격 stdio는 이 기본 목록을 상속하지 않고 config가 적은 이름만 넘긴다(`utils.rs:61`).
- [확인] MCP client 이름은 `codex-mcp-client`, version은 crate version, title은 `Codex`다(`codex-rs/codex-mcp/src/rmcp_client.rs:1122`).

### Gemini CLI (`fb972b2f87fe`)

- [확인] MCP OAuth storage는 `@github/keytar`를 동적 import한다(`packages/core/src/services/keychainService.ts:174`). service 기본값은 `gemini-cli-oauth`다(`packages/core/src/mcp/token-storage/index.ts:12`). account는 sanitize한 MCP server 이름이고, secret은 `__secret__<key>` prefix다(`keychainTypes.ts:38`). `findCredentials(service)`로 그 service의 항목을 전부 읽는다.
- [확인] native가 없거나 probe가 실패하면 항상 `FileKeychain`으로 내려간다(`keychainService.ts:134`). 강제 전환은 `GEMINI_FORCE_FILE_STORAGE=true`다. WSL(`WSL_DISTRO_NAME`·`WSLENV`·`WSL_INTEROP`)은 native를 건너뛴다. macOS는 `security default-keychain`을 spawn해 경로가 있고 파일이 있을 때만 native를 쓴다. 기능 probe는 무작위 account로 set·get·delete를 하고 2초 timeout이다(193). 실패·timeout은 예외 없이 file로 간다.
- [확인] file fallback은 `~/<GEMINI_DIR>/gemini-credentials.json`, mode `0o600`이다(`packages/core/src/services/fileKeychain.ts:116`). 키는 `scryptSync('gemini-cli-oauth', hostname-username-gemini-cli, 32)`라 비밀번호가 없고, 같은 사용자·호스트면 복호된다. AES-256-GCM이다. `HybridTokenStorage`는 프로세스 수명 동안 한 backend만 고른다.
- [확인] stdio MCP env는 부모 env를 `sanitizeEnvironment`로 거른 뒤 `GEMINI_CLI=1`을 덮어쓴다(`packages/core/src/tools/mcp-client.ts:2350`). config `env`의 값은 변수 확장 후 합친다. client 이름은 `gemini-cli-mcp-client`다(1847).

### gh (`6fc1c29d54`, cli)

- [확인] `internal/keyring/keyring.go`가 `github.com/zalando/go-keyring` v0.2.8을 감싸고, Get·Set·Delete에 60초 timeout을 둔다. timeout은 `TimeoutError`이고 값을 돌려주지 않는다. `go.mod`이 `github.com/godbus/dbus/v5`를 당기므로 Linux는 D-Bus Secret Service다.
- [확인] service는 `gh:<hostname>`, user는 계정 이름 또는 활성 token용 빈 문자열이다(`internal/config/config.go:577`). 조회 순서는 env·config(`ghauth.TokenFromEnvOrConfig`) 다음 keyring이다(261). 사용자별 항목이 없으면 빈 user의 옛 항목으로 내려간다(270). keyring 실패를 평문 파일로 대체하는 분기는 없다. env token이 있으면 keyring을 읽지 않는다.

### Paseo (`0d05584d044f`)

- [확인] keychain을 쓰지 않는다. daemon 비밀번호는 bcrypt hash(cost 12)만 저장하고(`packages/server/src/server/auth.ts:6`), HTTP·WebSocket은 `Authorization: Bearer` 또는 `Sec-WebSocket-Protocol`의 `paseo.bearer.<token>`을 bcrypt compare한다. 비밀번호가 없으면 bearer 검사가 통과다(`isBearerTokenValidAsync` 24, `!input.password`면 true).
- [확인] `/mcp/agents`는 전역 bearer middleware를 우회한다(`SELF_AUTHENTICATING_ROUTES`, `auth.ts:115`). daemon 기동마다 `randomUUID()` 하나를 `agentMcpAuthToken`으로 만들고(`bootstrap.ts:655`), 로컬 agent config의 MCP server `headers.Authorization`에 `Bearer <uuid>`로 넣는다(`runtime-mcp-config.ts:51`). URL은 `<base>/mcp/agents?callerAgentId=<id>`다. 비교는 길이 확인 후 `timingSafeEqual`이고, 불일치면 daemon 비밀번호 bearer를 한 번 더 본다(136). token은 원격 client에 보내지 않는다고 주석이 적지만 디스크의 agent config에는 평문으로 남는다. daemon 재시작마다 바뀌므로 살아 있던 연결은 다음 요청에서 거절된다.
- [확인] 별도 local credential은 `paseoHome/local-credential` 파일이다. `randomBytes(32)` base64url, 임시 파일 mode `0o600` 후 rename(`local-credential.ts:12`). `/api/status`만 읽고, `paseo.pid`의 listen 주소와 요청 target이 같을 때만 유효하다.

### Orca (`fd030c404074`)

- [확인] CLI가 앱 runtime에 붙는 credential은 keychain이 아니라 `orca-runtime.json`의 `authToken`이다. runtime이 `randomBytes(24).toString('hex')`로 만들고(`src/main/runtime/runtime-rpc/runtime-rpc-state.ts:51`) metadata 파일에 쓴다. CLI는 userData 경로의 그 파일을 읽어 unix socket 또는 named pipe로 첫 frame에 `authToken`을 넣는다(`src/cli/runtime/transport.ts:199`). 서버는 `request.authToken !== this.authToken`이면 거절한다(`runtime-rpc-request-admission.ts:131`). 비교는 일반 문자열 비교다. metadata 경로는 macOS `~/Library/Application Support/orca`, Windows `%APPDATA%/orca`, Linux `$XDG_CONFIG_HOME/orca`이고 `ORCA_USER_DATA_PATH`가 덮어쓴다(`metadata.ts:42`).
- [확인] 같은 사용자면 metadata 파일을 읽을 수 있어 token이 파일 권한에만 의존한다. socket 연결이 `EPERM`·`EACCES`면 `runtime_access_denied`로 보고, sandbox가 막은 것이지 token 문제가 아니라고 구분한다(`runtime-access-denied.ts`).
- [확인] Orca의 keychain 사용은 browser cookie 복호용이다. macOS는 `security find-generic-password -s <service> -a <account> -w`(secret이 stdout), Linux는 `secret-tool lookup service <s> account <a>`(secret이 stdout), Windows는 PowerShell DPAPI를 stdin base64로 받는다(`src/main/browser/browser-cookie-key.ts:48`, 76, 132). argv에 secret을 넣지는 않는다. 이건 connection credential 경로가 아니다.

### OpenCode (`907b3bc518fa`)

- [확인] MCP OAuth는 keychain이 아니라 `mcp-auth.json`이다(`packages/opencode/src/mcp/auth.ts:37`, `Global.Path.data`). client 이름은 `opencode`, version은 `InstallationVersion`이다(`packages/opencode/src/mcp/index.ts:76`). stdio env는 `process.env` 전체 상속 뒤 `mcp.environment`를 덮어쓴다(352). env whitelist는 없다.

### Claude Code (본체 소스 없음)

- [문서] MCP server 설정·stdio·http 구분은 [Claude Code MCP 문서](https://code.claude.com/docs/en/mcp)에 있다. `initialize`의 `clientInfo.name` 값은 그 문서에 없다. [미확인] 이번 조사에서 코드로 확인하지 못했다. changelog는 LSP initialize의 `clientInfo`만 언급한다.
- [문서] `CLAUDECODE` 환경 변수는 Claude Code가 중첩 세션을 감지하기 위해 자기 프로세스에 둔다. MCP 자식에 넘기는 env whitelist가 있는지는 [미확인]이다.

### Hermes (`343500b3547e`), Pi (`83692682f095`), OpenClaw (`37efa0b4a644`)

- [확인] Hermes의 Codex app-server client 이름 기본은 `hermes`다(`agent/transports/codex_app_server.py:166`). Pi의 MCP client 이름은 `pi`다(`packages/coding-agent/src/extensions/mcp/runtime.ts:373`). OpenClaw node host MCP client 이름은 `openclaw-node-host`다(`src/node-host/mcp.ts:274`). 세 제품의 connection credential keychain은 이번 조사에서 찾지 못했다. [미확인]

## 비교

| 항목 | Codex | Gemini CLI | gh | Paseo | Orca | OpenCode |
|---|---|---|---|---|---|---|
| keychain library | `keyring` 3.6 (apple-native, linux-native-async-persistent, windows-native) | `@github/keytar` 동적 import | `zalando/go-keyring` v0.2.8, D-Bus | 없음 | 없음(cookie 복호만 `security`·`secret-tool`·PowerShell DPAPI) | 없음 |
| service | CLI `"Codex Auth"`, MCP `"Codex MCP Credentials"` | `gemini-cli-oauth` | `gh:<hostname>` | 해당 없음 | 해당 없음 | 해당 없음 |
| account | `cli\|<home hash 16>`, MCP secret `MCP_OAUTH_<hash 32>` | sanitize한 server 이름, secret은 `__secret__` | 계정 이름, 활성 token은 빈 user | `randomUUID()` 하나, daemon 수명 | `randomBytes(24)` hex, runtime 수명 | `mcp-auth.json` |
| file fallback | CLI 기본 `File`. MCP `Auto`가 기본이고 keyring 실패 시 `CODEX_HOME/.credentials.json` | native 실패·WSL·2초 timeout·`GEMINI_FORCE_FILE_STORAGE`면 `gemini-credentials.json` (scrypt, 비밀번호 없음, `0o600`) | 없음. env가 우선 | `local-credential` `0o600`, bcrypt hash | `orca-runtime.json` 평문 `authToken` | `mcp-auth.json` 평문 |
| 자식 전달 | stdio env whitelist 12개 + config `env_vars`. secret env 6개 제거 | 부모 env sanitize 후 `GEMINI_CLI=1` | 프로세스 내부 | agent config `headers.Authorization` 평문 | socket 첫 frame의 `authToken` | `process.env` 전체 상속 |
| 회수 적용 | store pin은 프로세스 수명. 항목 삭제는 다음 load에서 `NoEntry` | 다음 `getPassword` | 다음 `ActiveToken` | daemon 재시작으로 token 교체. 살아 있는 요청은 매 요청 비교 | metadata 재기록 후 다음 frame 비교. 일반 `!==` | 파일 삭제 후 다음 읽기 |
| MCP client 이름 | `codex-mcp-client` | `gemini-cli-mcp-client` | 해당 없음 | 해당 없음 | 해당 없음 | `opencode` |

## lophn에 가져올 것과 버릴 것

가져올 것.

- Codex의 service·account 분리. service는 제품 고정 문자열, account는 connection id에서 유도한 짧은 안정 키. lophn은 `"lophn"` service와 `coding-agent/<cac id>` account로 Codex·Gemini·gh 항목과 충돌하지 않는다. `findCredentials`로 service 전체를 읽는 Gemini 패턴은 쓰지 않고, 아는 account 하나만 읽는다.
- Codex `error_kind.rs`의 OS 오류 코드 대응. 잠김·daemon 없음·권한 거절을 한 `unavailable`로 뭉개지 않고 loader가 구별할 코드로 남긴다. Linux Secret Service `Locked`와 `Unavailable`은 다른 실패다.
- Codex stdio env whitelist. lophn MCP에는 `--allow-env`로 이미 적은 이름만 주고, harness config `env`에는 token을 넣지 않는다(architecture 2.3의 4).
- Paseo의 매 요청 `timingSafeEqual`과 Orca의 연결 시점 1회 검사를 구분. lophn 회수는 매 core 요청에서 hash 검증이므로(connection R8, identity R7) token을 프로세스 메모리에 오래 둬도 회수 효력은 core가 만든다. loader는 시작 때 한 번 꺼내면 된다.
- gh의 keyring 호출 timeout. headless Linux에서 Secret Service가 없으면 D-Bus 호출이 멈춘다. Gemini는 2초 probe, gh는 60초, Orca `secret-tool`은 5초다.

버릴 것.

- Codex MCP `Auto`와 Gemini `FileKeychain`. 둘 다 keyring이 없으면 디스크에 원문 또는 복호 가능한 암호문을 남긴다. Gemini scrypt 비밀번호는 상수 `gemini-cli-oauth`라 같은 사용자면 평문과 같다. lophn은 잠김·누락을 `unavailable`로 두고 fallback이 없다(secrets R8, connection R17).
- Paseo의 config `headers.Authorization`과 Orca의 `orca-runtime.json` 평문 token. 설정·metadata 파일에 원문을 두는 방식이라 connection R17과 반대다. Paseo는 비밀번호 미설정 시 bearer 검사를 통과시키는데, lophn은 자격 없는 loopback을 인증하지 않는다(identity R11).
- OpenCode의 `process.env` 전체 상속과 `mcp-auth.json`.
- argv로 secret을 넘기는 CLI. Orca도 `-w`로 stdout에만 받고 stdin DPAPI를 쓴다. `security add-generic-password -w <secret>`처럼 argv에 원문을 넣는 형태는 쓰지 않는다.

## requirements와 다른 점

connection#R17, identity#R15, secrets#R12가 정한 trusted loader의 구체가 코드 조사와 어긋나거나 아직 값이 없는 부분이다.

connection#R1. loader가 FFI 없이 keychain을 열려면 자식 프로세스(`security`, `secret-tool`, PowerShell)가 필요하고, architecture 2.2는 MCP·CLI에 `--allow-run`을 주지 않는다. 조사한 library는 전부 프로세스 안 native binding이다(`keyring` 3.6, `@github/keytar`, `zalando/go-keyring`). CLI 호출 구현은 Orca cookie 복호뿐이다. loader를 MCP 프로세스 밖에 두지 않으면 R17과 2.2가 동시에 성립하지 않는다.

connection#R2. Linux에서 Secret Service가 없으면 Gemini는 2초 뒤 file로 가고 Codex `Auto`도 file로 간다. lophn은 fallback이 없으므로 loader는 timeout 뒤 `unavailable`을 반환해야 한다. Gemini probe timeout 2초, gh keyring timeout 60초, Orca `secret-tool` 5초가 후보 값이고, 요구는 숫자를 정하지 않았다.

connection#R3. Codex는 backend 오류를 `std::io::ErrorKind`로 나누고 `NoStorageAccess`만으로 잠김을 단정하지 않는다. lophn 요구는 잠김과 누락을 둘 다 `unavailable`로 둔다(R17, secrets R8). 진단에서 잠김과 부재를 구별하려면 loader 오류 코드가 따로 필요하다. 요구는 그 코드를 정하지 않았다.

connection#R4. 회수 즉시 거절은 core의 매 요청 hash 검증으로 가능하다. Codex·Gemini·Orca는 프로세스 메모리의 token을 교체하지 않고 다음 저장소 읽기에서야 부재를 본다. MCP가 장시간 살아 있어도 lophn은 core가 거절하므로 loader가 credential을 다시 읽을 필요가 없다. 이 경계가 architecture 2.3에는 없고, "keychain 정리는 회수를 대신하지 않는다"는 문장만 있다.

connection#R5. label 순서는 `--label`, 제품 env, `clientInfo.name`이다. 코드로 본 client 이름은 `codex-mcp-client`, `gemini-cli-mcp-client`, `opencode`, `pi`, `openclaw-node-host`, Hermes의 `hermes`다. Claude Code `clientInfo.name`은 [미확인]이다. Codex가 MCP 자식에 넘기는 env whitelist에 `LOPHN_AGENT_LABEL`이 없으므로 Codex에서는 config `env_vars`에 그 이름을 적지 않으면 제품 env label을 받을 수 없다. Gemini는 `GEMINI_CLI=1`을 항상 넣는다. 권한은 credential로만 정하므로 label이 빠져도 동작은 한다.

connection#R6. 원격 MCP OAuth와 같은 keychain을 쓸 때 Codex service `"Codex Auth"`·`"Codex MCP Credentials"`, Gemini `gemini-cli-oauth`, gh `gh:<hostname>`과 겹치지 않으려면 lophn service는 `lophn`이어야 한다. account에 connection id를 넣으면 한 사용자의 여러 연결과도 구별된다. Codex `find`가 아니라 account 단건 조회만 쓰면 다른 제품 항목을 열거하지 않는다.

## platform keychain loader에 줄 것

- service `lophn`, account `coding-agent/<cac id>`. 다른 제품 service와 겹치지 않고, MCP는 자기 connection account 하나만 읽는다.
- loader는 MCP·CLI의 부모가 되거나 그 프로세스보다 먼저 실행되는 쪽이다. Deno에 `--allow-run`·`--allow-ffi`를 주지 않으려면 keychain 접근을 MCP 안에 두지 않는다.
- 자식 CLI를 쓸 때는 secret을 argv에 넣지 않는다. macOS `security -w`는 stdout, Linux `secret-tool lookup`은 stdout, Windows는 Orca처럼 PowerShell DPAPI를 stdin으로 받는 형태가 조사에서 본 유일한 CLI 구현이다. store(쓰기)의 CLI 형태는 이번 조사에서 보지 못했다.
- 잠김·Secret Service 없음·timeout은 서로 다른 loader 오류로 올리고, 셋 다 평문 파일 없이 `unavailable`이다. timeout은 Gemini 2초와 gh 60초 사이다.
- 회수 확인은 loader가 아니라 core의 매 요청 hash다. loader는 시작 때 한 번 꺼내 process-local로 넘기고, 살아 있는 MCP의 메모리 token을 회수 시점에 지우지 않아도 된다.
