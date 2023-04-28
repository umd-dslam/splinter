import * as vscode from "vscode";
import { ESLint } from "eslint";
import { AnalyzeResult, Selection } from "../model";
import { Analyzer } from "./base";
import {
  EntityMessage,
  JsonMessage,
  MethodMessage,
} from "eslint-plugin-typeorm-analyzer/messages";

export class TypeORMAnalyzer implements Analyzer {
  private eslint: ESLint;
  private unresolvedMessages: [JsonMessage, Selection][] = [];

  constructor(rootPath: string) {
    this.eslint = new ESLint({
      useEslintrc: false,
      resolvePluginsRelativeTo: __dirname + "/../../node_modules",
      overrideConfig: {
        parser: __dirname + "/../../node_modules/@typescript-eslint/parser",
        parserOptions: {
          sourceType: "module",
          ecmaVersion: "latest",
          project: "tsconfig.json",
          tsconfigRootDir: rootPath,
        },
        plugins: ["typeorm-analyzer"],
        /* eslint-disable @typescript-eslint/naming-convention */
        rules: {
          "typeorm-analyzer/find-schema": "warn",
          "typeorm-analyzer/find-api": "warn",
        },
      },
    });
  }

  async analyze(files: vscode.Uri[], result: AnalyzeResult) {
    const messages: [JsonMessage, Selection][] = [];
    const texts = await Promise.all(files.map(vscode.workspace.fs.readFile));
    const texts_files = texts.map<[string, vscode.Uri]>((text, index) => [
      text.toString(),
      files[index],
    ]);

    for (const [text, file] of texts_files) {
      const lintResults = await this.eslint.lintText(text.toString(), {
        filePath: file.fsPath,
      });
      for (const result of lintResults) {
        for (const message of result.messages) {
          if (
            !message.ruleId ||
            !message.ruleId.startsWith("typeorm-analyzer")
          ) {
            continue;
          }

          let parsed: JsonMessage = JSON.parse(message.message);
          let selection = {
            filePath: result.filePath,
            fromLine: message.line - 1,
            fromColumn: message.column - 1,
            toLine: (message.endLine || message.line) - 1,
            toColumn: (message.endColumn || message.column) - 1,
          };
          messages.push([parsed, selection]);
        }
      }
    }

    this.collectEntities(messages, result);
    this.collectOperations(messages, result);
  }

  private collectEntities(
    messages: [JsonMessage, Selection][],
    result: AnalyzeResult
  ) {
    let entities = result.getEntities();
    if (entities.size === 0) {
      // Special entity for the Entity Manager API (https://typeorm.io/entity-manager-api)
      entities.set("[EntityManager]", {
        selection: undefined,
        name: "[EntityManager]",
        operations: [],
        note: "",
        isCustom: false,
      });
      // Special entity for the QueryRunner
      entities.set("[QueryRunner]", {
        selection: undefined,
        name: "[QueryRunner]",
        operations: [],
        note: "",
        isCustom: false,
      });
      // Special entity for the Connection
      entities.set("[Connection]", {
        selection: undefined,
        name: "[Connection]",
        operations: [],
        note: "",
        isCustom: false,
      });
    }

    for (const [msg, selection] of messages) {
      if (EntityMessage.validate(msg)) {
        if (entities.has(msg.name)) {
          vscode.window.showErrorMessage(
            `Entity ${msg.name} is defined multiple times.`
          );
          continue;
        }
        entities.set(msg.name, {
          selection,
          name: msg.name,
          operations: [],
          note: "",
          isCustom: false,
        });
      }
    }
  }

  private collectOperations(
    messages: [JsonMessage, Selection][],
    result: AnalyzeResult
  ) {
    let entities = result.getEntities();
    for (const [msg, selection] of messages) {
      if (MethodMessage.validate(msg)) {
        const operation = {
          selection,
          name: msg.name,
          type: msg.methodType,
          note: "",
        };

        // Find a recognized entity
        let found = false;
        for (const calleeType of msg.callee) {
          // Special case for the Entity Manager API
          if (calleeType === "EntityManager") {
            entities.get("[EntityManager]")!.operations.push(operation);
            found = true;
            break;
          }
          // Special entity for the QueryRunner
          if (calleeType === "QueryRunner") {
            entities.get("[QueryRunner]")!.operations.push(operation);
            found = true;
            break;
          }
          // Special entity for the Connection
          if (calleeType === "Connection") {
            entities.get("[Connection]")!.operations.push(operation);
            found = true;
            break;
          }

          // Parse the entity name in the pattern "Repository<EntityName>"
          let entityName = calleeType.match(/Repository<(.*)>/)?.[1];
          let entity =
            entityName === undefined ? entityName : entities.get(entityName);

          if (entity !== undefined) {
            entity.operations.push(operation);
            found = true;
            break;
          }
        }

        // Cannot recognize an entity
        if (!found) {
          this.unresolvedMessages.push([msg, selection]);
        }
      }
    }
  }

  async finalize(result: AnalyzeResult) {
    let unknowns = result.getUnknowns();
    for (const [msg, selection] of this.unresolvedMessages) {
      if (MethodMessage.validate(msg)) {
        const callee = msg.callee[0];
        if (!unknowns.has(callee)) {
          unknowns.set(callee, {
            selection: undefined,
            name: callee,
            operations: [],
            note: "",
            isCustom: false,
          });
        }

        unknowns.get(callee)!.operations.push({
          selection,
          name: msg.name,
          type: msg.methodType,
          note: "",
        });
      }
    }
  }

  getSaveFileName() {
    return "typeorm-analyze-result.json";
  }
}
