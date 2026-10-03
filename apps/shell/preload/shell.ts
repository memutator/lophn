import { contextBridge } from "electron";

import { shellApi } from "./shell-api.ts";

contextBridge.exposeInMainWorld("lophnShell", shellApi);
