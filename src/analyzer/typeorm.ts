import vscode, { OutputChannel } from "vscode";
import { AnalyzeResult, AnalyzeResultGroup } from "../model";
import { Analyzer } from "./base";
import {
  EntityMessage,
  MethodMessage,
  Output,
  Message,
} from "@ctring/splinter-eslint";
import child_process from "child_process";
import tmp from "tmp";

export class TypeORMAnalyzer implements Analyzer {
  private proc: child_process.ChildProcess | null;

  constructor(private workspacePath: vscode.Uri, private result: AnalyzeResult, private outputChannel: OutputChannel) {
    this.proc = null;
  }

  getName() {
    return "type-orm";
  }

  async analyze(onMessage: (msg: string) => void) {
    if (this.proc !== null) {
      vscode.window.showErrorMessage("Analyze process is already running.");
      return false;
    }

    const rootPath = vscode.Uri.joinPath(this.workspacePath,
      vscode.workspace.getConfiguration("splinter").get("rootDir") as string).fsPath;
    const batchSize = vscode.workspace.getConfiguration("splinter").get("batchSize") as number;

    // Create a temporary file to store the messages
    const tmpFile = tmp.fileSync({ prefix: "splinter", postfix: ".json" });
    this.outputChannel.clear();
    this.outputChannel.appendLine(`Analyzing the project at ${rootPath}`);
    this.outputChannel.appendLine(`Batch size: ${batchSize}`);
    this.outputChannel.appendLine(`Message file: ${tmpFile.name}`);

    this.proc = child_process.spawn("npx", [
      "@ctring/splinter-eslint",
      rootPath,
      "--output",
      tmpFile.name,
      "--batch",
      `${batchSize}`
    ], {
      cwd: rootPath,
    });

    if (this.proc === null) {
      console.error("Failed to spawn the analyze process.");
      return false;
    }

    this.proc.stdout?.on("data", (data) => {
      onMessage(`${data}`);
    });

    this.proc.stderr?.on("data", (data) => {
      this.outputChannel.append(`${data}`);
    });

    // Wait for the process to finish
    return await new Promise((resolve: (ret: boolean) => void) => {
      this.proc?.on("close", async (code) => {
        if (code === 0) {
          const messagesFilePath = vscode.Uri.file(tmpFile.name);
          const content = await vscode.workspace.fs.readFile(messagesFilePath);
          const output: Output = JSON.parse(content.toString());
          this.collectEntities(output.messages);
          this.collectOperations(output.messages);
          resolve(true);
        } else {
          resolve(false);
        }
        this.proc = null;
      });
    });
  }

  private collectEntities(
    messages: Message[],
  ) {
    let entities = this.result.getGroup(AnalyzeResultGroup.recognized);
    if (entities.size === 0) {
      // Special entity for Entity Manager API (https://typeorm.io/entity-manager-api)
      entities.set("[EntityManager]", {
        selection: undefined,
        name: "[EntityManager]",
        operations: [],
        note: "",
        isCustom: false,
      });
      // Special entity for QueryRunner
      entities.set("[QueryRunner]", {
        selection: undefined,
        name: "[QueryRunner]",
        operations: [],
        note: "",
        isCustom: false,
      });
      // Special entity for Connection
      entities.set("[Connection]", {
        selection: undefined,
        name: "[Connection]",
        operations: [],
        note: "",
        isCustom: false,
      });
      // Special entity for DataSource
      entities.set("[DataSource]", {
        selection: undefined,
        name: "[DataSource]",
        operations: [],
        note: "",
        isCustom: false,
      });
    }

    for (const msg of messages) {
      const content = msg.content;
      if (EntityMessage.validate(content)) {
        if (entities.has(content.name)) {
          vscode.window.showWarningMessage(
            `Entity ${content.name} is defined multiple times.`
          );
          continue;
        }
        entities.set(content.name, {
          selection: {
            filePath: msg.filePath,
            fromLine: msg.fromLine,
            toLine: msg.toLine,
            fromColumn: msg.fromColumn,
            toColumn: msg.toColumn,
          },
          name: content.name,
          operations: [],
          note: "",
          isCustom: false,
        });
      }
    }
  }

  cancel() {
    this.proc?.kill();
    this.proc = null;
  }

  private collectOperations(messages: Message[]) {
    let entities = this.result.getGroup(AnalyzeResultGroup.recognized);
    let unknowns = this.result.getGroup(AnalyzeResultGroup.unknown);

    for (const msg of messages) {
      const content = msg.content;
      const selection = {
        filePath: msg.filePath,
        fromLine: msg.fromLine,
        toLine: msg.toLine,
        fromColumn: msg.fromColumn,
        toColumn: msg.toColumn,
      };
      if (MethodMessage.validate(content)) {
        const operation = {
          selection,
          name: content.object + "." + content.name,
          type: content.methodType,
          note: "",
          arguments: content.attributes.map((attr) => ({
            selection: {
              filePath: msg.filePath,
              fromLine: attr.start_line - 1,
              fromColumn: attr.start_column,
              toLine: attr.end_line - 1,
              toColumn: attr.end_column,
            },
            name: attr.name,
            note: "",
            isCustom: false,
          })),
          isCustom: false,
        };

        // Find a recognized entity
        let found = false;
        for (const calleeType of content.objectTypes) {
          // Special case for Entity Manager API
          if (calleeType === "EntityManager") {
            entities.get("[EntityManager]")!.operations.push(operation);
            found = true;
            break;
          }
          // Special entity for QueryRunner
          if (calleeType === "QueryRunner") {
            entities.get("[QueryRunner]")!.operations.push(operation);
            found = true;
            break;
          }
          // Special entity for Connection
          if (calleeType === "Connection") {
            entities.get("[Connection]")!.operations.push(operation);
            found = true;
            break;
          }
          // Special entity for DataSource
          if (calleeType === "DataSource") {
            entities.get("[DataSource]")!.operations.push(operation);
            found = true;
            break;
          }

          // Parse the entity name in the pattern "Repository<EntityName>"
          var entityName = calleeType.match(/Repository<(.*)>/)?.[1];
          var entity =
            entityName === undefined ? entityName : entities.get(entityName);
          if (entity !== undefined) {
            entity.operations.push(operation);
            found = true;
            break;
          }

          // Parse the entity name in the pattern "SelectQueryBuilder<EntityName>"
          entityName = calleeType.match(/SelectQueryBuilder<(.*)>/)?.[1];
          entity =
            entityName === undefined ? entityName : entities.get(entityName);
          if (entity !== undefined) {
            entity.operations.push(operation);
            found = true;
            break;
          }

          // Exact match of the entity name. This might cause false positives if
          // a non-entity callee happens to have the same name as an entity.
          if (entities.has(calleeType)) {
            entities.get(calleeType)!.operations.push(operation);
            found = true;
            break;
          }
        }

        // Cannot recognize an entity
        if (!found) {
          const calleeType = content.objectTypes[0];
          if (!unknowns.has(calleeType)) {
            unknowns.set(calleeType, {
              selection: undefined,
              name: calleeType,
              operations: [],
              note: "",
              isCustom: false,
            });
          }

          unknowns.get(calleeType)!.operations.push({
            selection,
            name: content.object + "." + content.name,
            type: content.methodType,
            note: "",
            arguments: content.attributes.map((attr) => ({
              selection: {
                filePath: selection.filePath,
                fromLine: attr.start_line - 1,
                fromColumn: attr.start_column,
                toLine: attr.end_line - 1,
                toColumn: attr.end_column,
              },
              name: attr.name,
              note: "",
              isCustom: false,
            })),
            isCustom: false,
          });
        }
      }
    }
  }

  autoAnnotate(tag: string) { }
  supportedAutoAnnotateTags() {
    return [];
  }
}
