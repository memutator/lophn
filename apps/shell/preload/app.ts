import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("lophnApp", {});
