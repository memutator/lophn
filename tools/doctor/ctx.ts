// check가 쓰는 fs·net·spawn의 실제 구현. check는 이 함수들을 ctx로 받아 global을 직접 만지지 않는다.
import { spawn as spawnProcess } from "node:child_process";
import {
  chmod as chmodFile,
  lstat,
  mkdir as mkdirDir,
  readdir,
  readFile,
  stat as statFile,
  writeFile,
} from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type {
  Ctx,
  FileStat,
  Fs,
  HttpResult,
  Net,
  Spawn,
  SpawnResult,
} from "./types.ts";

function errorCode(error: unknown): string | undefined {
  return error instanceof Error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function createFs(): Fs {
  return {
    async exists(path) {
      try {
        await lstat(path);
        return true;
      } catch {
        return false;
      }
    },
    async readText(path) {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      }
    },
    async stat(path) {
      try {
        const value = await statFile(path);
        const result: FileStat = {
          mode: value.mode,
          uid: value.uid,
          isDir: value.isDirectory(),
        };
        return result;
      } catch (error) {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      }
    },
    async list(path) {
      try {
        return await readdir(path);
      } catch (error) {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      }
    },
    async copyText(src, dest, mode) {
      await writeFile(dest, await readFile(src), { mode });
      await chmodFile(dest, mode);
    },
    async chmod(path, mode) {
      await chmodFile(path, mode);
    },
    async mkdir(path, mode) {
      await mkdirDir(path, { recursive: true, mode });
      // umask가 mode를 깎으므로 다시 맞춘다.
      await chmodFile(path, mode);
    },
  };
}

function createNet(): Net {
  return {
    probe(port) {
      const { promise, resolve } = Promise.withResolvers<"free" | "busy">();
      const server = createServer();
      server.once("error", () => resolve("busy"));
      server.listen({ host: "127.0.0.1", port }, () => {
        server.close(() => resolve("free"));
      });
      return promise;
    },
    freePort() {
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      const server = createServer();
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0 }, () => {
        const address = server.address();
        const port =
          address !== null && typeof address === "object" ? address.port : 0;
        server.close(() => resolve(port));
      });
      return promise;
    },
    tcp(host, port, timeoutMs) {
      const { promise, resolve } = Promise.withResolvers<
        { ok: true } | { ok: false; message: string }
      >();
      const socket = connect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, message: "timeout" });
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ ok: true });
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        resolve({ ok: false, message: errorCode(error) ?? error.message });
      });
      return promise;
    },
    httpGet(url, opts) {
      const { promise, resolve } = Promise.withResolvers<HttpResult>();
      const target = new URL(url);
      const request =
        target.protocol === "https:" ? https.request : http.request;
      const headers: Record<string, string> = { accept: "application/json" };
      if (opts?.token !== undefined) {
        headers.authorization = `Bearer ${opts.token}`;
      }
      const started = Date.now();
      const req = request(
        {
          host: target.hostname,
          port: target.port === "" ? undefined : Number(target.port),
          path: `${target.pathname}${target.search}`,
          method: "GET",
          headers,
        },
        (res) => {
          const chunks: string[] = [];
          let length = 0;
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            // 응답이 끝없이 커도 진단이 멈추지 않게 앞부분만 남긴다.
            if (length >= 1_000_000) return;
            chunks.push(chunk);
            length += chunk.length;
          });
          res.on("end", () =>
            resolve({
              kind: "response",
              status: res.statusCode ?? 0,
              body: chunks.join(""),
              latencyMs: Date.now() - started,
            }),
          );
        },
      );
      req.setTimeout(opts?.timeoutMs ?? 3000, () =>
        req.destroy(new Error("timeout")),
      );
      req.on("error", (error) =>
        resolve({ kind: "error", message: errorCode(error) ?? error.message }),
      );
      req.end();
      return promise;
    },
  };
}

function createSpawn(): Spawn {
  return (command, args, opts) => {
    const { promise, resolve } = Promise.withResolvers<SpawnResult>();
    const child = spawnProcess(command, args, {
      env: { ...process.env, ...opts?.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure: string | undefined;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => {
      failure = `${opts?.timeoutMs ?? 4000}ms 안에 끝나지 않았다`;
      child.kill("SIGKILL");
    }, opts?.timeoutMs ?? 4000);
    child.once("error", (error) => {
      failure = errorCode(error) ?? error.message;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, error: failure });
    });
    return promise;
  };
}

// electron package는 binary 경로 string을 export한다. 깔려 있지 않으면 null.
function resolveElectron(root: string): string | null {
  try {
    const requireFromRoot = createRequire(
      pathToFileURL(join(root, "package.json")),
    );
    const resolved: unknown = requireFromRoot("electron");
    return typeof resolved === "string" ? resolved : null;
  } catch {
    return null;
  }
}

export function createCtx(
  root: string,
  env: Record<string, string | undefined> = { ...process.env },
): Ctx {
  return {
    root,
    env,
    fs: createFs(),
    net: createNet(),
    spawn: createSpawn(),
    electronPath: resolveElectron(root),
  };
}
