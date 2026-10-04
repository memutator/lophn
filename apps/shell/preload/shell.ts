import { contextBridge, ipcRenderer } from "electron";

import { createShellApi } from "./shell-api.ts";

const location =
  (globalThis as unknown as { location: { host: string } }).location;
const role = location.host === "overlay" ? "overlay" : "shell";
contextBridge.exposeInMainWorld(
  "lophnShell",
  createShellApi(ipcRenderer, role),
);
