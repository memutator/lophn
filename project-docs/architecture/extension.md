# extension

extension은 lophn 본체와 따로 켜는 기능 묶음이다. 대다수에게 필요 없는 기능(첫 사용자: third-party CLI GUI와 harness host)을 여기에 둔다. 사람이 설정에서 켜고 끄고 지운다. 꺼져 있으면 code를 load하지 않고 아무것도 등록하지 않는다. extension은 shell main 안에서 돌며 `ctx`로만 lophn에 닿고, command·key·agent tool을 manifest로 선언해 내놓을 수 있다. 계약은 boundary `extension-api`, 이를 읽는 registry는 `extension-host`다.

## 문제

- 사람의 PATH와 실행 파일을 써야 하는 기능(harness host, `claude gui` 같은 CLI 화면)은 core에 둘 수 없고, 모두가 필요로 하지도 않는다. 이를 본체 코드에 섞으면 안 쓰는 사람도 그 code를 load하고 그 설정·process를 안게 된다.
- 기능을 끄거나 지울 때 사람의 file과 설정이 같이 지워지면 안 된다. extension이 쓴 file이 무엇인지 알 길이 없으면 "지우기"가 폴더째 지우기가 되거나 아예 못 하게 된다.
- 기능 묶음이 agent에게 tool을 줄 길이 없었다. 사람이 설치하고 켜고 할당한 code를 agent의 진짜 tool로 내놓으면서도, 그 code가 agent의 권한을 넘어 사람 권한을 얻지 않게 해야 한다.

## 목표와 비목표

- 목표: 폴더 하나와 manifest 하나로 기능을 더한다. 사람이 설정으로만 켠다. 꺼져 있는 것은 manifest만 읽힌다. extension이 쓴 file만 지운다. 본체에 들어 있는 것부터 시작하되 뒤에 따로 받는 package로 옮겨도 구조가 바뀌지 않는다.
- 목표: 기여한 command, key, agent tool은 켜진 동안만 있다.
- 비목표: 따로 내려받기. 지금 install은 표시 file만 둔다.
- 비목표: extension을 별도 process나 sandbox에서 돌리기. shell main 안에서 돈다. 사람이 설치하고 켠 code는 믿는다.
- 비목표: 실행 중 tool 등록·해제, 늦게 싣기, extension이 내장 tool을 덮어쓰기, 호출마다 묻는 승인.
- 비목표: 앱이 채울 자리(sidebar panel, tray, 전역 float)를 extension으로 푸는 것. 그것은 앱이 맡고 lophn은 자리와 hook만 둔다(사람).

## 모델

extension 하나는 폴더 하나다. 폴더 이름이 id(`[a-z][a-z0-9-]*`)이고 그 안 `manifest.json`이 `{id, name, description, entry, provides, contributes}`다.

- `entry`: 폴더 안 상대 경로(따로 빌드한 CJS file). 폴더 밖을 가리키지 못한다. `activate(ctx)`와 `deactivate()`를 낸다.
- `provides`: 들어 있는 것의 이름들. 설정 화면에 보인다.
- `contributes`는 없으면 빈 목록이고 셋이다.
  - `commands`: `{name, title}`. command id는 `ext.<extension id>.<name>`이다.
  - `keybindings`: `{command, key: {other, mac?}, context?}`. `command`는 그 id나 내장 command id(harness-gui의 `agent.*`)다. `mac`이 없으면 `other`와 같다. key 글은 한 타나 공백으로 이은 두 타다([keybindings.md](keybindings.md)).
  - `tools`: `{name, description, inputSchema(object), effect(read|write|external)}`. schema는 정적이다. `name`은 `[a-z][a-z0-9_]*`이고 `__`가 없으며 extension 안에서 하나다. model에 보이는 이름은 `ext__<extension id>__<name>`이고 64자를 넘으면 manifest가 `invalid`다.

상태는 목록(IPC `list`)이 보이는 다섯이다.

| 상태 | 뜻 |
|---|---|
| `off` | 꺼져 있다. code를 load하지 않았다 |
| `on` | 켜져 있고 activate가 끝났다 |
| `invalid` | manifest가 JSON이 아니거나 꼴이 틀리거나 id가 폴더 이름과 다르다 |
| `no_setting` | core에 `extensions.<id>.enabled` 선언이 없다 |
| `failed` | entry가 `activate`·`deactivate`를 내지 않거나 `activate`가 던졌다 |

각 줄은 이름, 설명, `installed`(표시 file이 있는가), 문제가 있으면 이유를 가지고, 켜진 것은 `contributes`도 싣는다.

흐름은 이렇다.

```
shell main 기동 ─ core ready(연결 session이 바뀔 때마다) ─▶ sync
settings 변경(id가 extensions.*) ───────────────────▶ sync
sync
  ─▶ roots의 <root>/<id>/manifest.json을 읽는다(code는 읽지 않는다)
  ─▶ 판 검사 · 설정 extensions.<id>.enabled 읽기(core settings/list)
  ─▶ 켜졌고 판이 맞으면: 표시 file을 두고 entry를 load → activate(ctx)
  ─▶ 꺼졌으면: 켜져 있던 것만 deactivate()
  ─▶ 판이 맞는 manifest의 tool 전부를 core에 올린다(extension_tools/publish)
Settings › System › Extensions ─ IPC shell:extensions(list|install|remove|run) ─▶ registry
  켜기·끄기는 IPC가 아니라 설정 쓰기(extensions.<id>.enabled) ─▶ settings 변경 ─▶ sync
install ─▶ 표시 file만 둔다(다시 해도 같다)
remove  ─▶ 꺼져 있을 때만 표시 file에 적힌 file과 표시 file, 비게 된 폴더를 지운다
앱 끝 ─▶ 켜진 것을 모두 deactivate()
창 renderer ─ 창을 열 때, extensions.* 설정이 바뀔 때, core ready ─▶ IPC list
  ─▶ contributes.commands마다 `ext.<id>.<name>` command(handler = IPC run)와 Settings 줄
  ─▶ contributes.keybindings 중 내장 command에 거는 것은 bind, context마다 Ctrl+글자 머리를 owns
key·palette가 `ext.<id>.<name>`을 부름 ─ IPC run ─▶ activate 때 건 command handler
```

agent tool은 이렇게 간다.

```
shell main sync ─ extension_tools/publish ─▶ core(메모리에 통째로 보관)
agent(lophn runtime의 ext__<id>__<tool> 또는 harness의 `lophn ext call`)
  ─▶ extension_tools/call (agent 자격)
  ─▶ core: Gate extension_tool 판정(not_assigned | removed | run)
  ─▶ shell이 붙어 있지 않으면 unavailable
  ─▶ 이 호출만 쓰는 agent 자격을 내고 host queue에 tool_call 요청 ─ shell main ─▶ handler ─▶ `/host-link` response {output}
```

## 지키는 것

1. **extension 하나는 폴더 하나다.** 폴더 이름이 id이고 manifest의 `id`와 같아야 한다. 다르거나 꼴이 틀리면 `invalid`로 보이고 켜지 않는다. `entry`는 폴더 밖을 가리키지 못한다.
2. **extension은 따로 판을 갖지 않는다.** 지금 extension은 본체 안 것뿐이고 제품과 같이 build되므로 제품 판이 곧 그 판이다. manifest에 판 칸이 없고 registry는 판을 보지 않는다.
3. **켜기는 사람이 설정으로만 한다.** 설정 key는 `extensions.<id>.enabled`(boolean, 기본 false)다. core는 manifest를 읽지 못하므로 id마다 선언이 core 설정에 정적으로 한 줄씩 있다(지금 `extensions.harness.enabled`, `extensions.harness-gui.enabled`). 선언이 없는 id는 `no_setting`이고 켜지 않는다. `settings/update`는 user 자격만 쓸 수 있어 agent가 켜지 못한다.
4. **registry는 manifest가 든 폴더 목록(roots)만 읽는다.** 지금 roots는 본체 안 폴더 하나다(개발은 shell main 안 bundled 폴더, packaged는 설치 root의 `extensions/`). 본체 안 extension은 shell main bundle과 따로 extension마다 CJS file 하나로 build되고, packaging은 manifest와 build 결과만 설치 root로 옮긴다. 따로 받는 package가 오면 roots에 `<data>/extensions/`를 더하면 된다. 같은 id가 두 root에 있으면 앞 root의 것이다.
5. **code는 켜진 것만, shell main bundle 밖에서 load한다.** 꺼진 extension은 manifest만 읽힌다. entry가 `activate`·`deactivate`를 내지 않거나 `activate`가 던지면 `failed`이고(던졌으면 `deactivate`를 한 번 부른다) 다른 extension은 그대로 돈다.
6. **extension code는 `ctx`로만 lophn에 닿는다.** `ctx`는 `{core, settings, spawn, acp, clock, ids, files, dataFolder, commands, tools}`다. 본체 안 extension 폴더의 code는 protocol, base, 자기 폴더만 import한다. shell main 내부, 다른 extension, `electron`을 import하면 의존 검사(rule `extension`)가 막는다.
   - `core.call(kind, resource, method, input)`는 core protocol route를 사람 권한으로 부르고, `settings.get(key)`는 선언된 설정 값(기본값 포함, 선언이 없으면 undefined)이다. 둘 다 `Result`다.
   - `spawn`은 구조 type이다. 시작하지 못하면 원인(실행 파일 없음, 권한)이 stderr로 먼저 오고 exit code null로 끝난다. exit는 한 번만 알리고, stdio가 다 닫히기(`close`)를 기다리되 CLI가 띄운 손자가 pipe를 쥐고 있어도 `exit` 뒤 250ms에는 알린다. 죽은 process pipe의 쓰기 오류는 삼켜 앱이 끝나지 않게 한다. env는 shell main의 것 위에 사람의 login shell env(아래 16)와 `lophn` CLI 폴더를 앞에 둔 PATH, `LOPHN_HOME`(그 shell의 data root), 넘긴 것을 이 순서로 덧붙이고, 상위 session 표지(lophn이 다른 coding agent 안에서 떴을 때 물려받은 값)는 지운다. 안 지우면 CLI가 중첩 session이라며 시작하지 않는다. API key 같은 사용자 설정은 지우지 않는다. stdout과 stderr는 따로 오고(줄 단위 JSON이 stderr 글과 엉키지 않게), `end()`가 stdin을 닫는다(stdin 끝을 기다리는 CLI가 있다). process는 자기 process group으로 뜨고 group째 끈다(CLI가 띄운 명령이 CLI가 죽은 뒤에도 남지 않게).
   - `files.write(name, text)`는 `<data>/extensions/<id>/` 안에만 쓴다. 이름은 폴더 안 상대 경로이고 안전하지 않은 이름(`..`, 절대 경로, 표시 file·manifest 이름)은 `invalid_input`이다. `dataFolder(name)`은 `<data>/<name>/`을 만들고 경로를 준다(지우지 않는다).
   - `commands.register(name, handler)`는 main에서 도는 handler를 걸고 푸는 함수를 돌려준다. 없는 handler를 부르면 `not_found`, handler가 던지면 `internal`이다.
   - `tools.handle(name, handler)`는 manifest에 선언한 tool의 처리를 건다. 선언에 없는 이름은 호출되지 않는다. 없는 handler는 `not_found`, 던지면 `internal`이다.
   - `acp.open({terminal, harness, title, handoff})`은 터미널 탭 하나와 이어진 handle(`publish(update)`, `onInput`, `onClose`, `close`)을 준다. 창이 늦게 붙어도 지금까지의 상태를 한 번 받고 이어서 update를 받는다. `acp.onTab({gui, tui, running, sessions, rewindPreview})`은 탭의 GUI·TUI 전환 요청과 modal이 묻는 것을 받을 함수를 걸고 푸는 함수를 돌려준다. 켜진 extension 하나가 건다. 흐름과 꼴은 [harness-gui.md](harness-gui.md).
7. **끄면 그 extension이 건 것을 모두 버린다.** deactivate나 켜기 실패 때 registry가 그 extension의 command·tool handler를 모두 버린다. 다시 켜면 같은 load cache의 module에 `activate`가 다시 불린다.
8. **extension이 띄운 process는 extension이 끈다. 그래도 앱이 끝날 때는 살아 있는 것을 shell이 끈다.** registry는 `ctx.spawn`으로 띄운 process를 따라가지 않고 `deactivate`에서 끄게 한다. 비동기 `stop`이 끝나기 전에 앱이 끝나도 CLI가 남지 않게, spawner가 아는 살아 있는 process의 group 전체에 앱이 끝날 때 동기로 SIGTERM을 보낸다. 앱이 이미 끝난 뒤라 SIGKILL 유예는 돌지 않으므로 SIGTERM을 무시하는 CLI는 남는다.
9. **지우기는 extension이 쓴 file만 지운다.** `<data>/extensions/<id>/.lophn-extension`(JSON `{files[]}`)이 표시 file이다. 켤 때 먼저 두고, `files.write`가 쓰기 전에 그 이름을 더한다(쓰다 멈춰도 다음에 우리 file로 알아본다). `remove(id)`는 켜져 있거나 설정이 켜져 있으면 `conflict`이고, 아니면 적힌 file과 표시 file만 지운 뒤 비게 된 폴더만 치운다(recursive가 아니다). 사람이 그 폴더에 넣은 file과 다른 설정은 남는다. id 꼴이 틀리면 `invalid_input`이다. install에서 그런 extension이 없으면 `not_found`다.
10. **설정을 읽지 못하면 켜진 것을 끄지 않는다.** core가 잠시 불안정해도 extension이 꺼졌다 켜지지 않는다. `sync`, `install`, `remove`는 차례로 돈다.
11. **기여한 command와 key는 켜진 동안만 있다.** IPC `list`가 켜진 extension에만 `contributes`를 싣고, 창 renderer가 다시 읽을 때 앞에 올린 것을 모두 푼 뒤 새로 올린다. 사람이 Settings › Keyboard에서 바꾼 키는 extension을 꺼도 저장에 남는다("없는 command" 줄).
12. **사람은 Settings › System › Extensions에서 다룬다**(pane id `extension-packages`). 줄마다 이름, 설명, 판, 상태(설치 안 됨 · 꺼짐 · 켜짐 · 판 다름 · 문제와 이유)다. 설치는 표시 file만 둔다. 켜기 단추는 설치되고 설정이 선언된 것에만 있고, 켜기·끄기는 IPC가 아니라 설정 쓰기다. 지우기는 확인 dialog를 거치고, 켜져 있으면 먼저 끄라고 보인다. IPC는 desktop 창 본문만 부르고 `list`는 먼저 `sync`해 방금 바꾼 켜기가 보인다. Settings › General은 `extensions.*` 설정을 보이지 않는다. Settings › Agents의 `tools` pane(문구 "Extensions")은 lophn agent의 skill·MCP라 이것과 다르다.
13. **extension tool의 목록은 shell main이 올리고 core는 메모리에만 둔다.** `sync`가 끝날 때마다와 core에 다시 붙을 때마다 판이 맞는 manifest의 tool 전부(켜짐과 상관없이)를 `extension_tools/publish`로 통째로 보낸다. core가 다시 뜨면 비어 있고 shell이 다시 올린다. 올리지 못해도 `sync`는 실패하지 않고, core가 `unavailable`이면 연결이 있는 동안 다음 확인에서 다시 올린다. `extension_tools/catalog`는 `extensions.<id>.enabled`가 켜진 것만 낸다.
14. **extension tool은 할당한 agent에게만, Gate 한 곳에서 판정한다.** 사람만 쓰는 정의 칸 `extensions`(extension id 목록)로 할당한 agent에게 그 extension의 tool 전부가 `ext__<id>__<tool>`로 실린다([agent-definition.md](agent-definition.md)). 판정은 tool 정의가 아니라 호출 route(`extension_tools/call`) 한 곳의 Gate `extension_tool`이 한다([approval.md](approval.md)): 할당에 없으면 `not_assigned`, 켜진 extension의 catalog에 tool이 없으면(꺼짐, 목록에서 빠짐) `removed`, 아니면 `run`이다. 판정이 `run`이 아니면 `forbidden`이다. 묻지 않고 결과를 untrusted로 감싸지 않는다(할당이 곧 허락이다). 이름 꼴이 아니면 `not_found`이고, session과 turn에 묶인 agent 자격이 아니면 `forbidden`이다.
15. **extension tool 호출은 host queue를 거치고, handler는 agent 자격으로 core를 부른다.** shell이 붙어 있지 않으면 `unavailable`이다. 붙어 있으면 core가 이 호출만 쓰는 agent 자격(그 workspace 종류의 `lophn` 명령 route가 상한, process `extension`)을 내고 host queue에 `tool_call`을 넣어 기다린다. `tool_call`은 workspace를 가리지 않고 아무 shell main이 가져가며 한 번만 빌려 준다. 기다리는 동안 shell이 떨어지면 `unavailable`이고 끝나면 자격을 거둔다. handler는 `(input, {session, workspace, core})`를 받아 content(글, 이미지)를 돌려주고, 그 `core`는 사람 권한인 `ctx.core`가 아니라 그 호출 session의 agent 자격이다. 모양이 틀린 결과는 호출을 끝내지 못하게 두지 않고 `internal`로 바꾼다. harness agent는 같은 route를 `lophn ext call <ext__…> --input '<json>'`로 부른다.
16. **사람의 login shell env는 spawner가 한 곳에서 갖는다.** 데스크톱 메뉴나 autostart로 뜬 앱의 env에는 사람의 shell 설정(nvm의 PATH, rc file의 API key)이 없다. spawner가 login shell로 env를 한 번 읽어 두고(최대 5초) 모든 `ctx.spawn`에 `process.env` < login env < 넘긴 env 순으로 얹는다. extension 켜기(`sync`)와 GUI 열기는 그 읽기가 끝나기를 기다려 headless harness와 GUI가 같은 PATH를 얻는다. 못 읽었으면 다음에 env가 필요할 때 다시 읽고, 읽은 것은 계속 쓴다(실패를 영영 기억하지 않는다). 느린 rc file이면 extension이 최대 5초 늦게 뜬다(앱 시작은 막지 않는다). Windows는 login shell이 없다.

## 경계와 계약

- `extension-api`(protocol): manifest, `activate(ctx)`·`deactivate()`, `ctx`. spi다.
- `extension-host`: shell main의 registry. manifest를 읽고, 켜진 것만 load·activate하고, 표시 file로 지운다.
- 설정 key: `extensions.<id>.enabled`(core 선언).
- IPC `shell:extensions`: `list` · `install` · `remove` · `run(command)`. desktop 창 본문만 부르고 main이 다시 검사한다. 오류는 공통 일곱 코드다.
- core route: `extension_tools/publish`(user), `extension_tools/catalog`(user, machine), `extension_tools/call`(agent). host queue 요청 `tool_call`과 응답 `/host-link`의 `response`.
- Gate 입력 `extension_tool {extension, tool}`과 결과 `run | not_assigned | removed`.
- CLI: `lophn ext call <ext__id__tool> --input '<json>'`.
- 저장: `<data>/extensions/<id>/.lophn-extension`(JSON `{files[]}`)과 `ctx.files`로 쓴 file. 에이전트 정의 칸 `extensions`.
- command id `ext.<extension id>.<name>`, tool 이름 `ext__<extension id>__<tool>`. 앱 slug `ext`는 예약돼 있다.

## 결정

- **본체 .deb 안에 넣어 두고 켜는 것부터, 뒤에 따로 받는 package로.** 그 전환이 구조를 고치지 않게 셋을 지금 지킨다: 따로 빌드한 file을 경로로 load, registry는 폴더 목록만 읽음, `ctx`로만 닿음(의존 검사). 버린 안: 처음부터 따로 받는 package. 아직 내려받는 길이 없다. (사람, 2026-11-04)
- **기능 묶음은 본체와 따로 켜는 extension이다.** (사람, 2026-11-04)
- **shell main에 둔다.** 첫 사용자(harness host, third-party CLI GUI)가 사람의 PATH와 실행 파일을 쓴다. core는 그것을 모른다([coding-agent.md](coding-agent.md)). core에는 protocol route로만 붙는다.
- **설정 선언이 id마다 정적이다.** 설정은 core가 선언한 key만 받는다. 동적 key를 열기보다 extension마다 한 줄을 더하는 쪽이 단순하다. 따로 받는 package가 오면 다시 본다. 선언이 없는 id는 켜지 않는다. Settings › General은 `extensions.*`를 보이지 않는다. (agent)
- **`ctx.files`가 있다.** "extension이 쓴 file만 지운다"를 지키려면 무엇을 썼는지 registry가 알아야 한다. 쓰는 길을 하나로 두어 표시 file에 적는다(공유 skill 사본의 `.lophn-shared`와 같은 꼴, [coding-agent.md](coding-agent.md)). (agent)
- **판은 글자가 같아야 켠다.** (agent)
- **pane id는 `extension-packages`다.** Settings › Agents의 `tools` pane(lophn agent의 skill·MCP, 문구 "Extensions")과 다르다. (agent)
- **command가 단위이고 key는 command id에 붙는다.** extension은 command를 올리고 기본 key를 내서, Settings에서 바꾸기·충돌 검사·palette 실행을 같이 쓴다. command id는 이름공간 `ext.<id>.<name>`이다. manifest `contributes`로 내고 main에서 도는 handler가 필요하면 `ctx.commands.register`로 건다. manifest는 제품 판과 같은 판이라 schema를 바로 바꾼다. 없는 id의 사용자 설정은 extension을 꺼도 버리지 않는다. (사람이 "keyboard manager에 extension 키 등록"을 말했고 2026-11-08, 세부는 agent)
- **agent의 tool도 manifest로 선언하고 진짜 tool로 싣는다.** model의 `tools[]`에 schema와 함께 들어간다. (사람, 2026-11-08)
- **tool schema는 manifest에 정적으로 선언한다. 실행 중 등록은 없다.** 정의 hash·`tools_changed` notice·session에 고정되는 목록 규칙이 그대로 맞고, 설정 화면이 code를 load하지 않고 tool을 보인다. (agent)
- **할당한 agent에게만 싣고, 단위는 extension 하나(그 tool 전부)다.** 칸은 사람만 쓴다(`apps`, `mcp_servers`와 같다). `tools[]`는 workspace 종류마다 작은 고정 집합이고 넓히는 길은 할당 하나다. (agent)
- **할당이 곧 허락이다.** 실행 때 묻지 않는다. 사람이 설치하고 켜고 할당한 code는 MCP처럼 믿는다. (agent)
- **handler가 core를 부를 때는 사람 권한이 아니라 그 호출 session의 agent 자격을 쓴다.** agent가 tool 하나로 사람 권한을 얻지 않게 한다. harness turn 자격과 같은 선례다. (agent)
- **처음부터 다 싣는다. 늦게 싣기는 하지 않는다.** tool이 많은 extension의 비용은 사람이 할당으로 조절한다(MCP와 같다). (agent)
- **model 이름은 `ext__<extension id>__<tool name>`이다.** provider 이름 규칙(64자)에 맞고 내장(`_` 하나)·MCP(`mcp__`)와 겹치지 않는다. `__`를 막아 id와 tool을 가른다. (agent)
- **tool 호출은 core의 host queue를 거친다.** host queue는 harness queue를 일반화하지 않고 같은 꼴로 새로 둔다. harness queue는 session마다 turn 입력을 담아 요청 종류를 실을 자리가 없다. (사람이 확인)
- **shell main이 tool 목록을 core에 올리고 core는 메모리에만 둔다.** core가 manifest를 읽지 못한다. (사람이 확인)
- **Gate 판정은 tool 정의가 아니라 호출 route 한 곳에서 한다.** lophn runtime과 harness CLI가 같은 길을 거친다. (agent)
- **browser use는 extension tool이 아니라 CLI + skill로 갔다.** lophn agent, harness agent, 터미널의 coding agent가 같은 구현을 쓰게 하려는 것이다. (사람)

- 본체 안 extension의 manifest에서 판을 지우고 제품 판과의 비교(`incompatible`, build 검사)도 지웠다. 이유: 판은 root `package.json` 하나인데 PATCH를 올리는 도구는 manifest를 모르니 판이 두 번(0.23.9, 0.23.57) 뒤처졌고, 그때마다 harness agent와 터미널 GUI가 말없이 멈추거나 `npm run dev`·packaging이 build에서 멈췄다. 같이 build되는 extension에는 판 비교가 지키는 것이 없다. 따로 받는 package가 오면 그때 그 package의 판과 지원 범위를 정한다. 버린 안: 도구가 PATCH 때 manifest 판도 올리기(같은 값을 두 곳에 두는 일이 남는다). (agent, 2026-11-15)

## 열린 것

- 따로 내려받기와 `<data>/extensions/` root는 아직 없다. 설치는 표시 file만 둔다. 따로 받는 package가 오면 설정 선언을 다시 본다.
- extension tool의 실제 사용자는 아직 없다. 남길지는 사람이 정한다(test extension fixture로만 확인했다. "쓰일지 모를 확장 지점을 미리 만들지 않는다"와 어긋나지만 사람이 명시해 만들었다).
