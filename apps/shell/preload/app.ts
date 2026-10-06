import { contextBridge, ipcRenderer } from "electron";

import { createAppApi, installViewErrors } from "./app-api.ts";

const transport = {
  invoke: (channel: string, input: unknown) =>
    ipcRenderer.invoke(channel, input),
  send: (channel: string, input: unknown) => ipcRenderer.send(channel, input),
};

contextBridge.exposeInMainWorld("lophnApp", createAppApi(transport));
installViewErrors(
  globalThis as unknown as Parameters<
    typeof installViewErrors
  >[0],
  transport,
  () => Date.now(),
);
