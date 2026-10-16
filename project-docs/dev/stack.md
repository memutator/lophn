# 판과 개발 환경

## 판

판은 lockfile(`deno.lock`, shell main의 `package-lock.json`)로 고정한다. 판을 올리는 것은 따로 하는 작업이다.

| 것 | 판 |
|---|---|
| Deno | 2.9.7 |
| zod | 4.6.5 |
| @std/assert | 1.0.19 |
| Electron | 44.5.1 |
| esbuild | 0.28.2 |
| TypeScript | 7.0.2 |
| React, react-dom | 19.3.0 |
| lucide-react | 1.51.0 |
| @codemirror/lang-json, @codemirror/lang-yaml(편집기의 JSON·YAML 하이라이트. markdown 팩과 같은 CodeMirror 6) | 6.0.2, 6.1.3 |

화면 아이콘 자료(wireframe에서 정함, `../tmp/ui-inventory.md` 6.1):

| 것 | 판 | license |
|---|---|---|
| @lobehub/icons-static-svg(harness와 provider의 vendor 아이콘) | 1.95.1 | MIT |
| @iconify-json/catppuccin(파일 종류 아이콘. light는 Latte, dark는 Macchiato 색) | 1.2.17 | MIT |

의존성을 더할 때는 이 표에 이유와 함께 적는다.

## 개발 환경

- `deno task dev`: core, agent runtime, app supervisor, shell을 개발 data root(`.dev-data/`)로 함께 띄운다. 사람의 `~/.lophn`을 건드리지 않는다.
- `deno task dev:mock`: shell을 core 없이 메모리 가짜 data로 띄운다.
- `deno task wireframes`: 화면 wireframe gallery를 정적 bundle(`tools/wireframes/dist/`)로 만든다. 새 화면 모양의 기준이다.
- `tools/fake-provider/`: model provider를 흉내 내는 로컬 HTTP server다. test와 개발은 실제 provider를 부르지 않는다. 실제 provider로 확인할 때만 사람이 정한다.
- `LOPHN_SHELL_HEADLESS=1`: shell을 화면에 띄우지 않는다(창 숨김, offscreen).
- 개발 data는 schema가 바뀌면 지우고 새로 만든다.
