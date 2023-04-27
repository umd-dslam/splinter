import { AnalyzeResult } from "../model";
import * as vscode from "vscode";

export interface Analyzer {
  analyze: (filePath: vscode.Uri[], result: AnalyzeResult) => Promise<void>;
  finalize: (result: AnalyzeResult) => Promise<void>;
  getSaveFileName: () => string;
}
