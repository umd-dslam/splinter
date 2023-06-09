import * as vscode from "vscode";
import * as path from "path";
import { ESLint } from "eslint";
import { AnalyzeResult, AnalyzeResultGroup, Selection } from "../model";
import { Analyzer } from "./base";
import {
  EntityMessage,
  JsonMessage,
  MethodMessage,
} from "eslint-plugin-typeorm-analyzer/messages";

export class TypeORMAnalyzer implements Analyzer {
  private rootPath: string;
  private eslint: ESLint;
  private unresolvedMessages: [JsonMessage, Selection][] = [];

  constructor(rootPath: string, tsconfigRootDir: string) {
    this.rootPath = rootPath;
    if (!path.isAbsolute(tsconfigRootDir)) {
      tsconfigRootDir = path.join(rootPath, tsconfigRootDir);
    }
    this.eslint = new ESLint({
      useEslintrc: false,
      resolvePluginsRelativeTo: __dirname + "/../../node_modules",
      overrideConfig: {
        parser: __dirname + "/../../node_modules/@typescript-eslint/parser",
        parserOptions: {
          ecmaVersion: "latest",
          project: "./**/tsconfig.json",
          tsconfigRootDir,
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
            filePath: path.relative(this.rootPath, result.filePath),
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
    let entities = result.getGroup(AnalyzeResultGroup.recognized);
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
    let entities = result.getGroup(AnalyzeResultGroup.recognized);
    for (const [msg, selection] of messages) {
      if (MethodMessage.validate(msg)) {
        const operation = {
          selection,
          name: msg.callee + "." + msg.name,
          type: msg.methodType,
          note: "",
          arguments: msg.attributes.map((attr) => ({
            selection: {
              filePath: selection.filePath,
              fromLine: attr.start_line - 1,
              fromColumn: attr.start_column,
              toLine: attr.end_line - 1,
              toColumn: attr.end_column,
            },
            name: attr.name,
            note: "",
          })),
        };

        // Find a recognized entity
        let found = false;
        for (const calleeType of msg.calleeTypes) {
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
          this.unresolvedMessages.push([msg, selection]);
        }
      }
    }
  }

  async finalize(result: AnalyzeResult) {
    // Last chance to match operations to entities
    let unresolved = this.unresolvedMessages;
    this.unresolvedMessages = [];
    this.collectOperations(unresolved, result);

    // Put the unresolved messages into unknowns
    let unknowns = result.getGroup(AnalyzeResultGroup.unknown);
    for (const [msg, selection] of this.unresolvedMessages) {
      if (MethodMessage.validate(msg)) {
        const calleeType = msg.calleeTypes[0];
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
          name: msg.callee + "." + msg.name,
          type: msg.methodType,
          note: "",
          arguments: msg.attributes.map((attr) => ({
            selection: {
              filePath: selection.filePath,
              fromLine: attr.start_line - 1,
              fromColumn: attr.start_column,
              toLine: attr.end_line - 1,
              toColumn: attr.end_column,
            },
            name: attr.name,
            note: "",
          })),
        });
      }
    }
    this.unresolvedMessages = [];
  }

  getSaveFileName() {
    return "typeorm-analyze-result.json";
  }
}
