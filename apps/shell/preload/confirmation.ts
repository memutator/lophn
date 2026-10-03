import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("lophnConfirmation", {});
