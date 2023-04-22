import * as vscode from "vscode";
import { EntityOperationProvider } from "./provider/entity-operation";
import { analyze as analyzeTypeORM } from "./analyzer/typeorm";
import {
  AnalyzeResult,
  deserializeAnalyzeResult,
  serializeAnalyzeResult,
} from "./model";
import path = require("path");
import { StatisticsProvider } from "./provider/statistics";

async function loadResultFromStorage(rootPath: string) {
  const vscodePath = vscode.Uri.joinPath(vscode.Uri.file(rootPath), ".vscode");
  const resultPath = vscode.Uri.joinPath(
    vscodePath,
    "typeorm-analyze-result.json"
  );

  return vscode.workspace.fs.readFile(resultPath).then(
    (data) => {
      return deserializeAnalyzeResult(data.toString());
    },
    (err) => {
      console.log("No result file found: ", resultPath.path);
    }
  );
}

export function activate(context: vscode.ExtensionContext) {
  if (!context.storageUri) {
    return;
  }

  const rootPath =
    vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : "";

  const vscodePath = vscode.Uri.joinPath(vscode.Uri.file(rootPath), ".vscode");
  const resultPath = vscode.Uri.joinPath(
    vscodePath,
    "typeorm-analyze-result.json"
  );

  let promisedResult = (async () => {
    let result = await loadResultFromStorage(rootPath);
    if (result === undefined) {
      result = await analyzeTypeORM(rootPath);

      console.log("Writing result to file: ", resultPath.path);
      await vscode.workspace.fs.createDirectory(vscodePath);
      await vscode.workspace.fs.writeFile(
        resultPath,
        Buffer.from(serializeAnalyzeResult(result))
      );
    }
    return result;
  })();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "statistics",
      new StatisticsProvider(
        rootPath,
        promisedResult
      )
    )
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "recognized",
      new EntityOperationProvider(
        rootPath,
        promisedResult.then((result) => result.entities)
      )
    )
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "unknown",
      new EntityOperationProvider(
        rootPath,
        promisedResult.then((result) => result.unknowns)
      )
    )
  );

  vscode.commands.registerCommand("item.show", (loc: vscode.Location) => {
    vscode.workspace.openTextDocument(loc.uri).then((doc) => {
      vscode.window.showTextDocument(doc).then((editor) => {
        editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(loc.range.start, loc.range.end);
      });
    });
  });
}

export function deactivate() { }
