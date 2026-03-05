export {};

declare global {
  type LogEntry = { level: string; message: string; ts: string };

  type PipelinePayload = {
    inputType: "musicxml" | "pdf";
    musicxmlText?: string;
    pdfPath?: string;
    prompt?: string;
    settings?: Record<string, any>;
    savePath?: string | null;
  };

  interface Window {
    musicEngine: {
      getLogs: () => Promise<LogEntry[]>;
      onLog: (cb: (entry: LogEntry) => void) => () => void;
      analyze: (payload: PipelinePayload) => Promise<{ runId: string; satbJsonPath: string }>;
      generate: (payload: PipelinePayload) => Promise<{ runId: string; rhythmJsonPath: string }>;
      exportMusicXml: (payload: PipelinePayload) => Promise<{
        runId: string;
        outputXmlPath: string;
        copyPath: string | null;
      }>;
      chooseExportPath: () => Promise<string | null>;
      openOutputFolder: (folderPath: string) => Promise<void>;
      openOutputFile: (filePath: string) => Promise<void>;
    };
  }
}
