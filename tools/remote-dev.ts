// 폰 개발용 명령: 개발 core를 remote로 열고 폰 초대장 글을 찍는다.
// 실행: npm run dev:remote  (먼저 `npm run dev`나 `npm run dev:core`가 떠 있어야 한다)
// 개발 core(.dev-data)를 사람 자격으로 붙어 remote listener를 켜고 폰 초대장을 하나 받아, 폰 앱이 붙여넣을 수 있는
// 초대장 글(QR에 싣는 JSON)을 찍는다. 초대장은 30분, 한 번이다.
// 개발 core의 remote port는 사람의 lophn(기본 7432)과 겹치지 않게 47432로 둔다.
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { cliDial } from "../packages/cli/connection/client/node.ts";
import {
  CONTROL_REQUEST_TIMEOUT_MS,
  controlConnect,
  createRpcClient,
} from "../packages/protocol/client/mod.ts";
import { settingsUpdate } from "../packages/protocol/config/file.ts";
import { rosterInvite } from "../packages/protocol/remote/routes.ts";

const REMOTE_PORT = 47432;
const root = fileURLToPath(new URL("..", import.meta.url));

function fail(message: string): never {
  console.error(`dev:remote: ${message}`);
  process.exit(1);
}

const dial = cliDial({
  dataRoot: join(root, ".dev-data"),
  platform: process.platform,
  xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
});
if (!dial.ok) fail(dial.error.message);
const connected = await controlConnect(
  { dial: dial.value, timeoutMs: CONTROL_REQUEST_TIMEOUT_MS },
  "cli",
);
if (!connected.ok) {
  fail(
    `개발 core에 붙지 못했다(${connected.error.code}). 먼저 \`npm run dev\`나 \`npm run dev:core\`를 띄운다.`,
  );
}
const core = createRpcClient({
  baseUrl: connected.value.api_url,
  token: connected.value.user_token,
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    return {
      status: response.status,
      headers: response.headers,
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  },
});

const updated = await core.call(settingsUpdate, {
  changes: [
    { key: "remote.enabled", action: "set", value: true },
    { key: "remote.port", action: "set", value: REMOTE_PORT },
    // 개발 core는 lophn이 띄운 실제 relay에 붙지 않는다. 폰은 direct로 붙는다.
    { key: "remote.relay", action: "set", value: "" },
  ],
});
if (!updated.ok) fail(`remote를 켜지 못했다: ${updated.error.message}`);
if (updated.value.rejected.length > 0) {
  fail(`remote 설정이 거절됐다: ${JSON.stringify(updated.value.rejected)}`);
}

// listener는 설정 변경을 받고 열린다. 열리기 전에는 roster/invite가 unavailable이다.
let qr: string | undefined;
for (let tries = 0; tries < 50 && qr === undefined; tries += 1) {
  const invited = await core.call(rosterInvite, {
    kind: "phone",
    terminal_input: true,
    lifetime: "short",
  });
  if (invited.ok) {
    qr = JSON.stringify(invited.value.invite);
  } else if (invited.error.code === "unavailable") {
    await sleep(100);
  } else {
    fail(`초대장을 받지 못했다: ${invited.error.message}`);
  }
}
if (qr === undefined) fail("remote listener가 열리지 않는다");

console.log("초대장 글 (폰 앱의 붙여넣기 칸에 넣는다):");
console.log(qr);
console.log(
  "초대장은 30분 안에 폰 하나가 쓴다. 다시 받으려면 이 명령을 다시 띄운다.",
);
