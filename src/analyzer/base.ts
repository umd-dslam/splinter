export interface Analyzer {
  analyze: () => Promise<boolean>;
  getSaveFileName: () => string;
}
