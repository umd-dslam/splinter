import { OutputChannel } from "vscode";

export interface Analyzer {
  analyze: (onMessage: (msg: string) => void, outputChannel: OutputChannel) => Promise<boolean>;
  cancel: () => void;
  getName: () => string;
}
