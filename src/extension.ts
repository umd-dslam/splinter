import * as vscode from "vscode";
import { RecognizedProvider } from "./provider/recognized";
import { UnsureProvider } from "./provider/unsure";
import { analyze as analyzeTypeORM } from "./analyzer/typeorm";

export function activate(context: vscode.ExtensionContext) {
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : "";

  Promise.resolve(analyzeTypeORM(rootPath)).then((result) => {
    if (typeof result === "string") {
      console.log(result);
    } else {
      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          "recognized",
          new RecognizedProvider(result.entities)
        )
      );

      context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
          "unsure",
          new UnsureProvider(result.unsure)
        )
      );
    }
  });

  vscode.commands.registerCommand("item.show", (loc: vscode.Location) => {
    vscode.workspace.openTextDocument(loc.uri).then((doc) => {
      vscode.window.showTextDocument(doc).then((editor) => {
        editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
      });
    });
  });
}

export function deactivate() {}
