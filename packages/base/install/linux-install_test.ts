import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cliLauncher,
  devCliLauncher,
  linuxInstallLayout,
} from "./linux-install.ts";

// launcher가 Deno로 돌아가면 설치본의 CLI가 뜨지 않는다. Electron의 Node로 CLI entry를 띄우는 것을 고정한다.
test("설치된 CLI launcher는 설치된 Electron binary를 Node로 띄운다", () => {
  const script = cliLauncher(linuxInstallLayout("/opt/lophn"), []);
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.match(script, /ELECTRON_BIN="\$ROOT\/lophn-desktop"/);
  assert.match(
    script,
    /ELECTRON_RUN_AS_NODE=1 exec "\$ELECTRON_BIN" \\\n {2}"\$PLATFORM\/packages\/coding-agent\/cli\/main\.ts" "\$@"/,
  );
  assert.doesNotMatch(script, /deno run|DENO_BIN|DENO_DIR/);
});

test("개발 CLI launcher는 저장소의 Electron binary를 Node로 띄운다", () => {
  const script = devCliLauncher(
    {
      electron: "/repo/node_modules/electron/dist/electron",
      platform: "/repo",
    },
    [],
  );
  assert.match(
    script,
    /ELECTRON_BIN="\/repo\/node_modules\/electron\/dist\/electron"/,
  );
  assert.match(script, /PLATFORM="\/repo"/);
  assert.match(script, /ELECTRON_RUN_AS_NODE=1 exec "\$ELECTRON_BIN"/);
});
