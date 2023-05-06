import { randomUUID } from "crypto";
import * as vscode from "vscode";

export type Selection = {
  filePath: string;
  fromLine: number;
  fromColumn: number;
  toLine: number;
  toColumn: number;
};

export type Operation = {
  selection: Selection;
  name: string;
  type: "read" | "write" | "other" | "transaction";
  note: string;
};

export type Entity = {
  selection?: Selection;
  name: string;
  operations: Operation[];
  note: string;
  isCustom: boolean;
};

export function isEntity(item: Entity | Operation): item is Entity {
  return (item as Entity).operations !== undefined;
}

export class AnalyzeResult {
  private static _instance: AnalyzeResult;

  private entities: Map<string, Entity>;
  private unknowns: Map<string, Entity>;
  private fileName: string = "analyze-result.json";

  public static getInstance(): AnalyzeResult {
    return this._instance || (this._instance = new this());
  }

  private constructor() {
    this.entities = new Map();
    this.unknowns = new Map();
  }

  getEntities(): Map<string, Entity> {
    return this.entities;
  }

  getUnknowns(): Map<string, Entity> {
    return this.unknowns;
  }

  setFileName(fileName: string) {
    this.fileName = fileName;
  }

  extend(result: AnalyzeResult) {
    for (const item of result.entities) {
      this.entities.set(...item);
    }

    for (const item of result.unknowns) {
      this.unknowns.set(...item);
    }
  }

  clear() {
    this.entities.clear();
    this.unknowns.clear();
  }

  async loadFromStorage(rootPath: string): Promise<boolean> {
    const resultPath = vscode.Uri.joinPath(
      vscode.Uri.file(rootPath),
      ".vscode",
      this.fileName
    );

    try {
      let data = await vscode.workspace.fs.readFile(resultPath);
      let newResult: AnalyzeResult = JSON.parse(data.toString(), reviver);
      this.clear();
      this.extend(newResult);
    } catch (e) {
      return false;
    }
    return true;
  }

  async saveToStorage(rootPath: string) {
    const vscodePath = vscode.Uri.joinPath(
      vscode.Uri.file(rootPath),
      ".vscode"
    );
    const resultPath = vscode.Uri.joinPath(vscodePath, this.fileName);

    await vscode.workspace.fs.createDirectory(vscodePath);
    await vscode.workspace.fs.writeFile(
      resultPath,
      Buffer.from(JSON.stringify(this, replacer))
    );
  }
}

function replacer(key: string, value: any) {
  if (value instanceof Map) {
    return {
      dataType: "Map",
      value: [...value],
    };
  } else {
    return value;
  }
}

function reviver(key: string, value: any) {
  if (typeof value === "object" && value !== null) {
    if (value.dataType === "Map") {
      return new Map(value.value);
    }
  }
  return value;
}

export function groupOperationTypes(
  operations: Operation[],
  result?: { [key: string]: Set<string> }
): { [key: string]: Set<string> } {
  // Result is a map from operation type to a set of ids of operations of that type.
  result = { ...result };

  let addId = (type: string, id: string) => {
    if (result) {
      if (type in result) {
        result[type].add(id);
      } else {
        result[type] = new Set([id]);
      }
    }
  };

  for (const operation of operations) {
    // Check if the pattern "!<operation.type>" exists in the note of the operation.
    if (!operation.note.match(new RegExp(`!${operation.type}`))) {
      const id = randomUUID();
      addId(operation.type, id);
    }
    // Iterate over all tokens with the pattern "@<type>(<id>)" in the note of operations.
    // For each token, add <id> to the set of <type> in the result.
    const matches = operation.note.matchAll(/@(\w+)\((\w+)\)/g);
    for (const match of matches) {
      addId(match[1], match[2]);
    }
  }

  return result;
}
