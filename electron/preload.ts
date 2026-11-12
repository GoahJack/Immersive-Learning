import { contextBridge, ipcRenderer } from "electron";
import type { Command, Snapshot, StudyAPI } from "../shared/types";
const api: StudyAPI = {
  snapshot: () => ipcRenderer.invoke("study:snapshot"),
  command: (command: Command) => ipcRenderer.invoke("study:command", command),
  pickFile: () => ipcRenderer.invoke("study:pick-file"),
  onFinish(listener) {
    ipcRenderer.on("study:finish", listener);
    return () => ipcRenderer.removeListener("study:finish", listener);
  },
  onUpdateSettings(listener) {
    ipcRenderer.on("study:update-settings", listener);
    return () => ipcRenderer.removeListener("study:update-settings", listener);
  },
  subscribe(listener) {
    const handler = (_event: unknown, snapshot: Snapshot) => listener(snapshot);
    ipcRenderer.on("study:state", handler);
    return () => ipcRenderer.removeListener("study:state", handler);
  },
};
contextBridge.exposeInMainWorld("study", api);
