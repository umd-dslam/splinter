import { ESLint } from "eslint";
import * as path from "path";
import { AnalyzeResult, Entity, Selection } from "../model";
import {
  EntityMessage,
  JsonMessage,
  MethodMessage,
} from "eslint-plugin-typeorm-analyzer/messages";

function getESLint(rootPath: string) {
  return new ESLint({
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
        "typeorm-analyzer/find-repository-api": "warn",
      },
    },
  });
}

export async function analyze(rootPath: string): Promise<AnalyzeResult> {
  const eslint = getESLint(rootPath);

  console.log("Linting files...");
  const lintResults = await eslint.lintFiles(path.join(rootPath, "/**/*.ts"));

  // Collect all messages from the typeorm-analyzer plugin.
  const messages: [JsonMessage, Selection][] = [];
  for (const result of lintResults) {
    for (const message of result.messages) {
      if (!message.ruleId || !message.ruleId.startsWith("typeorm-analyzer")) {
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

  // Collect all entities.
  let entities: Map<string, Entity> = new Map();
  for (const [msg, selection] of messages) {
    if (EntityMessage.validate(msg)) {
      entities.set(msg.name, {
        selection,
        name: msg.name,
        operations: [],
      });
    }
  }

  // Collect all operations per entity. If an operation cannot be matched to an
  // entity, it is added to the unsure list.
  const unknowns: Map<string, Entity> = new Map();
  for (const [msg, selection] of messages) {
    if (MethodMessage.validate(msg)) {
      const operation = {
        selection,
        name: msg.name,
        type: msg.methodType,
      };

      // Find a recognized entity
      let found = false;
      for (const calleeType of msg.callee) {
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
        const callee = msg.callee[0];
        if (!unknowns.has(callee)) {
          unknowns.set(callee, {
            selection,
            name: callee,
            operations: [],
          });
        }
        unknowns.get(callee)!.operations.push(operation);
      }
    }
  }

  return {
    entities,
    unknowns,
  };
}
