import * as vscode from "vscode";
import * as path from "path";
import { EntityOperationProvider } from "./provider/entity-operation";
import { TypeORMAnalyzer } from "./analyzer/typeorm";
import {
  AnalyzeResult,
  Entity,
  Operation,
  deserializeAnalyzeResult,
  isEntity,
  serializeAnalyzeResult,
} from "./model";
import { StatisticsProvider } from "./provider/statistics";
import { Analyzer } from "./analyzer/base";
import { Refreshable } from "./provider/refreshable";

let analyzeResult: AnalyzeResult = new AnalyzeResult();

async function loadResultFromStorage(rootPath: string, fileName: string) {
  const vscodePath = vscode.Uri.joinPath(vscode.Uri.file(rootPath), ".vscode");
  const resultPath = vscode.Uri.joinPath(vscodePath, fileName);

  return vscode.workspace.fs.readFile(resultPath).then(
    (data) => {
      return deserializeAnalyzeResult(data.toString());
    },
    (_) => {
      console.log("No result file found: ", resultPath.path);
    }
  );
}

async function saveResultToStorage(
  rootPath: string,
  fileName: string,
  result: AnalyzeResult
) {
  const vscodePath = vscode.Uri.joinPath(vscode.Uri.file(rootPath), ".vscode");
  const resultPath = vscode.Uri.joinPath(vscodePath, fileName);

  await vscode.workspace.fs.createDirectory(vscodePath);
  await vscode.workspace.fs.writeFile(
    resultPath,
    Buffer.from(serializeAnalyzeResult(result))
  );
}

function runAnalyzer(
  analyzer: Analyzer,
  rootPath: string,
  providers: Refreshable[]
) {
  const config = vscode.workspace.getConfiguration("clue");
  const refreshProviders = () => {
    for (const provider of providers) {
      provider.refresh();
    }
  };

  refreshProviders();

  const batchSize = config.get("analyzeBatchSize") as number;

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `Analyzing TypeORM in batches of ${batchSize} files`,
    },
    async (progress, cancellation) => {
      // Try to load the result of a previous run from file
      let result = await loadResultFromStorage(
        rootPath,
        analyzer.getSaveFileName()
      );

      if (result !== undefined) {
        // If the result is found, use it
        analyzeResult.extend(result);
      } else {
        // If the result is not found, start a new analysis
        const files = await vscode.workspace.findFiles(
          config.get("includeFiles")!.toString(),
          config.get("excludeFiles")!.toString()
        );

        for (let i = 0; i < files.length; i += batchSize) {
          if (cancellation.isCancellationRequested) {
            break;
          }

          // Update the progress message
          const pathSample = files
            .slice(i, i + batchSize)
            .map((f) => path.relative(rootPath, f.path))
            .join(", ");
          progress.report({
            increment: (batchSize / files.length) * 100,
            message: `[${i + 1}/${files.length}] ${pathSample}`,
          });

          // Do the analysis
          await analyzer.analyze(files.slice(i, i + batchSize), analyzeResult);

          refreshProviders();
        }

        // Finalize any unresolved entities
        await analyzer.finalize(analyzeResult);

        // Save the result to file for future use
        await saveResultToStorage(
          rootPath,
          analyzer.getSaveFileName(),
          analyzeResult
        );
      }

      refreshProviders();
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

  const statisticsProvider = new StatisticsProvider(analyzeResult);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("statistics", statisticsProvider)
  );

  const recognizedProvider = new EntityOperationProvider(
    rootPath,
    analyzeResult.getEntities()
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("recognized", recognizedProvider)
  );

  const unknownProvider = new EntityOperationProvider(
    rootPath,
    analyzeResult.getUnknowns()
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("unknown", unknownProvider)
  );

  const analyzer = new TypeORMAnalyzer(rootPath);

  // Run the initial analysis
  runAnalyzer(analyzer, rootPath, [
    recognizedProvider,
    unknownProvider,
    statisticsProvider,
  ]);

  vscode.commands.registerCommand("clue.reanalyze", async () => {
    const vscodePath = vscode.Uri.joinPath(
      vscode.Uri.file(rootPath),
      ".vscode"
    );
    const resultPath = vscode.Uri.joinPath(
      vscodePath,
      analyzer.getSaveFileName()
    );

    await vscode.workspace.fs.delete(resultPath);

    analyzeResult.clear();

    runAnalyzer(analyzer, rootPath, [
      recognizedProvider,
      unknownProvider,
      statisticsProvider,
    ]);
  });

  vscode.commands.registerCommand("clue.newEntity", () => {
    vscode.window
      .showInputBox({
        placeHolder: "Enter the name of the entity to add",
      })
      .then((name) => {
        if (name === undefined) {
          return;
        }

        if (analyzeResult.getEntities().has(name)) {
          vscode.window.showErrorMessage(
            `Entity ${name} already exists in the list of recognized entities`
          );
          return;
        }

        analyzeResult.getEntities().set(name, {
          selection: undefined,
          name,
          operations: [],
          note: "",
          isCustom: true,
        });

        saveResultToStorage(
          rootPath,
          analyzer.getSaveFileName(),
          analyzeResult
        ).then(() => {
          statisticsProvider.refresh();
          recognizedProvider.refresh();
          unknownProvider.refresh();
        });
      });
  });

  vscode.commands.registerCommand("clue.item.show", (loc: vscode.Location) => {
    vscode.workspace.openTextDocument(loc.uri).then((doc) => {
      vscode.window.showTextDocument(doc).then((editor) => {
        editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(loc.range.start, loc.range.end);
      });
    });
  });

  vscode.commands.registerCommand(
    "clue.item.addNote",
    (item: Entity | Operation) => {
      vscode.window.showInputBox({ value: item.note }).then((note) => {
        if (note === undefined) {
          return;
        }
        item.note = note;
        saveResultToStorage(
          rootPath,
          analyzer.getSaveFileName(),
          analyzeResult
        ).then(() => {
          recognizedProvider.refresh();
          unknownProvider.refresh();
        });
      });
    }
  );

  vscode.commands.registerCommand("clue.item.remove", (item: Entity) => {
    analyzeResult.removeEntity(item);
    saveResultToStorage(
      rootPath,
      analyzer.getSaveFileName(),
      analyzeResult
    ).then(() => {
      statisticsProvider.refresh();
      recognizedProvider.refresh();
      unknownProvider.refresh();
    });
  });
}

export function deactivate() {}
