import { ESLint } from "eslint";
import * as path from "path";
import { Entity } from "../model/entity";

const eslint = new ESLint({
  useEslintrc: false,
  resolvePluginsRelativeTo: __dirname + "/../node_modules",
  overrideConfig: {
    parser: __dirname + "/../node_modules/@typescript-eslint/parser",
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
    for (const message of result.messages) {
      const json = JSON.parse(message.message);
      if (json.type === "entity") {
        results.push(new Entity(json.name));
      }
    }
  }

  return results;
}
