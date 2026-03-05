import type { JobRequest, JobResult, LogEntry, MusicXmlFile, Settings } from "../../shared/ipcTypes";

export type { JobRequest, JobResult, LogEntry, MusicXmlFile, Settings };

declare global {
  interface Window {
    api: {
      selectMusicXmlFile: () => Promise<MusicXmlFile | null>;
      runGenerateJob: (payload: JobRequest) => Promise<JobResult>;
      openFile: (path: string) => Promise<void>;
      getServerStatus: () => Promise<{ ready: boolean; baseUrl: string }>;
      onServerReady: (cb: (baseUrl: string) => void) => () => void;
      onLog: (cb: (entry: LogEntry) => void) => () => void;
    };
  }
}

export {};
