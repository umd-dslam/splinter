import { ESLint } from "eslint";
import * as path from "path";
import { Entity } from "../model";
import { Location, Range, Uri } from "vscode";

const eslint = new ESLint({
  useEslintrc: false,
  resolvePluginsRelativeTo: __dirname + "/../../node_modules",
  overrideConfig: {
    parser: __dirname + "/../../node_modules/@typescript-eslint/parser",
    parserOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
    plugins: ["typeorm-analyzer"],
    /* eslint-disable @typescript-eslint/naming-convention */
    rules: {
      "typeorm-analyzer/find-schema": "warn",
    },
  },
});

export async function analyze(rootPath: string) {
  const lintResults = await eslint.lintFiles(path.join(rootPath, "/**/*.ts"));
  // Loop over lint results and extract the entities
  const results: Entity[] = [];
  for (const result of lintResults) {
    const filePath = result.filePath;
    for (const message of result.messages) {
      if (!message.ruleId || !message.ruleId.startsWith("typeorm-analyzer")) {
        continue;
      }
      const json = JSON.parse(message.message);
      if (json.type === "entity") {
        const location = new Location(
          Uri.file(filePath),
          new Range(message.line, 0, message.line, 0)
        );
        results.push(new Entity(location, json.name));
      }
    }
  }

  return results;
}
