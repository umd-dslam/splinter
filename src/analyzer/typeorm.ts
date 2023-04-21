import { ESLint } from "eslint";
import * as path from "path";
import { AnalyzeResult, Entity, Operation, Unsure } from "../model";
import { Location, Range, Uri } from "vscode";
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
  const messages: [JsonMessage, Location][] = [];
  for (const result of lintResults) {
    for (const message of result.messages) {
      if (!message.ruleId || !message.ruleId.startsWith("typeorm-analyzer")) {
        continue;
      }

      let parsed: JsonMessage = JSON.parse(message.message);
      let location = new Location(
        Uri.file(result.filePath),
        new Range(message.line, 0, message.line, 0)
      );
      messages.push([parsed, location]);
    }
  }

  // Collect all entities.
  let entities: Map<string, Entity> = new Map();
  for (const [msg, loc] of messages) {
    if (EntityMessage.validate(msg)) {
      entities.set(msg.name, new Entity(loc, msg.name, []));
    }
  }

  // Collect all operations per entity. If an operation cannot be matched to an
  // entity, it is added to the unsure list.
  const unsure = [];
  for (const [msg, loc] of messages) {
    if (MethodMessage.validate(msg)) {
      let found = false;
      for (const calleeType of msg.callee) {
        // Parse the entity name in the pattern "Repository<EntityName>"
        let entityName = calleeType.match(/Repository<(.*)>/)?.[1];
        let entity =
          entityName === undefined ? entityName : entities.get(entityName);

        if (entity !== undefined) {
          entity.operations.push(new Operation(loc, msg.name));
          found = true;
          break;
        }
      }

      if (!found) {
        unsure.push(new Unsure(loc, msg.callee[1] + "." + msg.name));
      }
    }
  }

  return {
    entities: entities,
    unsure: unsure,
  };
}
