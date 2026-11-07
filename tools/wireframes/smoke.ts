// 실행: npm run wireframes:smoke
// gallery의 모든 page를 offscreen Electron 창에서 하나씩 그려 보고, uncaught error나 console error가 나거나
// root가 비면 실패한다. 한 화면의 render 오류가 창 전체를 비우는 회귀를 빌드 전에 잡는다.
// 같은 파일이 두 역할이다: plain node면 gallery를 임시 폴더에 build하고 Electron으로 자신을 띄우는 입구,
// Electron main이면 그 bundle을 loopback http로 서빙해 page를 도는 본체다(module script라 file://로는 못 연다).
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import process from "node:process";
import { buildGallery } from "./build.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
};
// 비동기로 뜨는 page(lazy chunk, mount 뒤 drive)가 던질 시간을 준다.
const SETTLE_MS = 150;
const MOUNT_MS = 10_000;
const WINDOWS = 6;

async function launch(): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "lophn-wireframes-"));
  try {
    await buildGallery(dir);
    const electron = createRequire(import.meta.url)("electron") as string;
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    const child = spawn(
      electron,
      [
        "--no-sandbox",
        "--disable-gpu",
        "--log-level=3",
        import.meta.filename,
        dir,
      ],
      { stdio: "inherit", env },
    );
    return await new Promise((resolve) => {
      child.on("error", (error) => {
        console.error(error);
        resolve(1);
      });
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function serve(dir: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = normalize(new URL(req.url ?? "/", "http://x").pathname);
    if (path.includes("..")) {
      res.writeHead(403).end();
      return;
    }
    const stream = createReadStream(join(dir, path));
    stream.on("error", () => res.writeHead(404).end());
    stream.on("open", () => {
      res.writeHead(200, {
        "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      });
      stream.pipe(res);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    }),
  );
}

async function run(dir: string): Promise<number> {
  // Electron main 안에서 "electron"은 API다. 정적 import는 package 의존 선언을 요구해서 require로 받는다.
  const { app, BrowserWindow } = createRequire(import.meta.url)(
    "electron",
  ) as typeof import("electron");
  await app.whenReady();
  const { server, origin } = await serve(dir);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 창마다 자기 오류 목록을 갖는다. offscreen 창 하나가 page 하나를 차례로 연다.
  const windows = Array.from({ length: WINDOWS }, () => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    const errors: string[] = [];
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      errors.push(`render process gone: ${details.reason}`);
    });
    const evaluate = <T>(code: string) =>
      win.webContents.executeJavaScript(code) as Promise<T>;
    const open = async (query: string) => {
      errors.length = 0;
      await win.webContents.loadURL(`${origin}/index.html${query}`);
    };
    // root가 찰 때까지 기다린다. 끝내 비면 render 오류로 React가 root를 비운 것이다.
    const mounted = async (): Promise<boolean> => {
      for (const started = Date.now(); Date.now() - started < MOUNT_MS; ) {
        if (
          await evaluate<boolean>(
            `document.getElementById("root")?.childElementCount > 0`,
          )
        )
          return true;
        await sleep(30);
      }
      return false;
    };
    return { win, errors, evaluate, open, mounted };
  });

  const failures: { id: string; reasons: string[] }[] = [];
  let ids: string[] = [];
  try {
    const [first] = windows;
    await first.open("");
    await first.mounted();
    // 목차(Toc)에 모든 page 링크가 있다.
    ids = await first.evaluate<string[]>(
      `[...document.querySelectorAll('nav[aria-label="Pages"] a[href^="#/"]')]
        .map((a) => a.getAttribute("href").slice(2)).filter((id) => id !== "")`,
    );
    if (ids.length === 0) {
      failures.push({
        id: "(index)",
        reasons: ["no page links", ...first.errors],
      });
    }

    const queue = [...ids];
    await Promise.all(
      windows.map(async ({ errors, open, mounted }) => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          await open(`?frame=${encodeURIComponent(id)}`);
          const filled = await mounted();
          await sleep(SETTLE_MS);
          const reasons = [...errors];
          if (!filled) reasons.push("root is empty");
          if (reasons.length > 0) failures.push({ id, reasons });
        }
      }),
    );
  } finally {
    for (const { win } of windows) win.destroy();
    server.close();
    app.quit();
  }

  for (const { id, reasons } of failures) {
    console.error(`FAIL ${id}`);
    for (const reason of reasons) console.error(`  ${reason.split("\n")[0]}`);
  }
  console.log(
    `wireframes smoke: ${ids.length} pages, ${failures.length} failed`,
  );
  return failures.length === 0 ? 0 : 1;
}

// Electron main은 import.meta.main이 비어 있어서 electron 여부로 가른다. Electron은 entry module이 끝나야
// ready를 알리므로 top-level await로 기다리면 멈춘다. promise로 잇는다.
// Chromium 인자가 argv 앞에 섞이므로 build 폴더는 마지막 인자다.
const dir = process.argv.length > 2 ? process.argv.at(-1) : undefined;
(process.versions.electron && dir ? run(dir) : launch()).then((code) =>
  process.exit(code),
);
