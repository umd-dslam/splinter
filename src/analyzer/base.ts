export interface Analyzer {
  analyze: (onMessage: (msg: string) => void) => Promise<boolean>;
  cancel: () => void;
  getName: () => string;
}
