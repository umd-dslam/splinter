export interface Analyzer {
  analyze: (onMessage: (msg: string) => void) => Promise<boolean>;
  getSaveFileName: () => string;
}
