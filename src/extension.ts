import * as vscode from "vscode";
import { EntityOperationProvider } from "./provider/entity-operation";
import { TypeORMAnalyzer } from "./analyzer/typeorm";
import { AnalyzeResult, Entity, Operation } from "./model";
import { StatisticsProvider } from "./provider/statistics";

const ANALYZE_BATCH = 1;

let analyzeResult: AnalyzeResult = new AnalyzeResult();

export function activate(context: vscode.ExtensionContext) {
  if (!context.storageUri) {
    return;
  }

  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : "";

  const recognizedProvider = new EntityOperationProvider(
    rootPath,
    analyzeResult.getEntities()
  );
  const unknownProvider = new EntityOperationProvider(
    rootPath,
    analyzeResult.getUnknowns()
  );
  const statisticsProvider = new StatisticsProvider(analyzeResult);

  const analyzer = new TypeORMAnalyzer(rootPath);

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: "TypeORM",
    },
    async (progress, cancellation) => {
      // Try to load the result of a previous run from file
      let result = await analyzer.loadResultFromStorage(rootPath);
      if (result !== undefined) {
        analyzeResult.extend(result);
      } else {
        // If the result is not found, start a new analysis
        const files = await vscode.workspace.findFiles(
          "**/*.ts",
          "**/node_modules/**"
        );

        for (let i = 0; i < files.length; i += ANALYZE_BATCH) {
          if (cancellation.isCancellationRequested) {
            analyzeResult.clear();
            return;
          }

          let messageFiles = files
            .slice(i, i + Math.min(5, ANALYZE_BATCH))
            .map((uri) => uri.fsPath)
            .join("\n");

          progress.report({
            increment: (ANALYZE_BATCH / files.length) * 100,
            message: `Analyzing ${files.length} files\n${messageFiles}`,
          });

          await analyzer.analyze(
            files.slice(i, i + ANALYZE_BATCH),
            analyzeResult
          );

          recognizedProvider.refresh();
          unknownProvider.refresh();
          statisticsProvider.refresh();
        }

        await analyzer.finalize(analyzeResult);

        // Save the result to file for future use
        await analyzer.saveResultToStorage(rootPath, analyzeResult);
      }

      recognizedProvider.refresh();
      unknownProvider.refresh();
      statisticsProvider.refresh();
    }
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("statistics", statisticsProvider)
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("recognized", recognizedProvider)
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("unknown", unknownProvider)
  );

  vscode.commands.registerCommand("item.show", (loc: vscode.Location) => {
    vscode.workspace.openTextDocument(loc.uri).then((doc) => {
      vscode.window.showTextDocument(doc).then((editor) => {
        editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(loc.range.start, loc.range.end);
      });
    });
  });

  vscode.commands.registerCommand(
    "item.addNote",
    (item: Entity | Operation) => {
      vscode.window.showInputBox({ value: item.note }).then((note) => {
        if (note !== undefined) {
          item.note = note;
          analyzer.saveResultToStorage(rootPath, analyzeResult);
        }
        recognizedProvider.updateItem(item);
        unknownProvider.updateItem(item);
      });
    }
  );
}

export function deactivate() {}
