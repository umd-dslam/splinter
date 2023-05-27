import { randomUUID } from "crypto";
import * as vscode from "vscode";

export type Entity = {
  selection?: Selection;
  name: string;
  operations: Operation[];
  note: string;
  isCustom: boolean;
};

export type Operation = {
  selection?: Selection;
  name: string;
  arguments: Argument[];
  type: "read" | "write" | "other" | "transaction";
  note: string;
};

export type Argument = {
  selection?: Selection;
  name: string;
  note: string;
};

export type Selection = {
  filePath: string;
  fromLine: number;
  fromColumn: number;
  toLine: number;
  toColumn: number;
};

export enum AnalyzeResultGroup {
  recognized = "Recognized",
  unknown = "Unknown",
}

export class AnalyzeResult {
  private static _instance: AnalyzeResult;

  private group: Map<string, Map<string, Entity>>;
  private fileName: string = "analyze-result.json";
  private refreshFn: () => void = () => {};

  public static getInstance(): AnalyzeResult {
    return this._instance || (this._instance = new this());
  }

  private constructor() {
    this.group = new Map([
      [AnalyzeResultGroup.recognized, new Map<string, Entity>()],
      [AnalyzeResultGroup.unknown, new Map<string, Entity>()],
    ]);
  }

  getGroup(group: AnalyzeResultGroup): Map<string, Entity> {
    return this.group.get(group)!;
  }

  setFileName(fileName: string) {
    this.fileName = fileName;
  }

  extend(result: AnalyzeResult) {
    for (const [groupId, value] of result.group) {
      for (const item of value) {
        this.group.get(groupId)!.set(...item);
      }
    }
  }

  clear() {
    for (const value of this.group.values()) {
      value.clear();
    }
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
      this.refreshFn();
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

    this.refreshFn();
  }

  setRefreshFn(fn: () => void) {
    this.refreshFn = fn;
  }

  refreshViews() {
    this.refreshFn();
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

  let addId = (type: string, id?: string) => {
    if (result) {
      if (!id) {
        id = randomUUID();
      }
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
      addId(operation.type);
    }
    // Iterate over all tokens with the pattern "@<type>(<id>)" in the note of operations.
    // For each token, add <id> to the set of <type> in the result.
    const matches = operation.note.matchAll(/@(\w+)(\(\w+\))?/g);
    for (const match of matches) {
      let id = match[2]?.slice(1, -1);
      addId(match[1], id);
    }
  }

  return result;
}
