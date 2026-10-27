import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { errorCode } from "../../base/mod.ts";

const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_COUNT = 5;

// H is fixed nonsecret installation input; filenames never come from a report.
export async function createLogFiles(root: string): Promise<{
  write(bytes: Uint8Array): Promise<void>;
}> {
  if (
    !root.startsWith("/") ||
    root.split("/").some((p) => p === "." || p === "..")
  ) {
    throw new Error("invalid log root");
  }
  const canonical = await realpath(root);
  if (canonical !== root.replace(/\/$/, "")) throw new Error("unsafe log root");
  const directory = `${canonical}/logs`;
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const rootInfo = await lstat(canonical);
  const directoryInfo = await lstat(directory);
  if (
    !rootInfo.isDirectory() || !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink()
  ) {
    throw new Error("unsafe log directory");
  }
  const paths = Array.from(
    { length: LOG_FILE_COUNT },
    (_, i) => `${directory}/platform-${i}.jsonl`,
  );
  async function guard() {
    if (await realpath(canonical) !== canonical) {
      throw new Error("unsafe root");
    }
    const current = await lstat(directory);
    if (
      !current.isDirectory() || current.isSymbolicLink() ||
      current.ino !== directoryInfo.ino || current.dev !== directoryInfo.dev
    ) throw new Error("log directory changed");
    for (const path of paths) {
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
          throw new Error("unsafe log file");
        }
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
  async function remove(path: string) {
    try {
      await rm(path);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  await guard();
  // Repair only the fixed operational files, never ledger or arbitrary contents.
  for (const path of paths) {
    try {
      if ((await lstat(path)).size > LOG_FILE_MAX_BYTES) {
        await remove(path);
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  let writing = false;
  return {
    async write(bytes) {
      if (writing || bytes.length > LOG_FILE_MAX_BYTES) {
        throw new Error("invalid log write");
      }
      writing = true;
      let file: Awaited<ReturnType<typeof open>> | undefined;
      try {
        await guard();
        let size = 0;
        try {
          size = (await lstat(paths[0])).size;
        } catch (error) {
          if (errorCode(error) !== "ENOENT") throw error;
        }
        if (size + bytes.length > LOG_FILE_MAX_BYTES) {
          await remove(paths[LOG_FILE_COUNT - 1]);
          for (let i = LOG_FILE_COUNT - 2; i >= 0; i--) {
            try {
              await rename(paths[i], paths[i + 1]);
            } catch (error) {
              if (errorCode(error) !== "ENOENT") throw error;
            }
          }
        }
        file = await open(
          paths[0],
          constants.O_WRONLY | constants.O_APPEND |
            constants.O_CREAT | constants.O_NOFOLLOW,
          0o600,
        );
        const info = await file.stat();
        if (
          !info.isFile() || info.nlink !== 1 ||
          info.size + bytes.length > LOG_FILE_MAX_BYTES
        ) {
          throw new Error("unsafe log file");
        }
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await file.write(
            bytes,
            offset,
            bytes.length - offset,
          );
          if (
            !Number.isSafeInteger(bytesWritten) || bytesWritten < 1 ||
            bytesWritten > bytes.length - offset
          ) throw new Error("invalid log write count");
          offset += bytesWritten;
        }
      } finally {
        await file?.close();
        writing = false;
      }
    },
  };
}
