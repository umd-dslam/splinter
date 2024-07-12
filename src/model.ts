import { randomUUID } from "crypto";
import vscode from "vscode";
import path from "path";
import fs from "fs";
import assert from "assert";

export type Entity = {
  selection?: Selection;
  name: string;
  operations: Operation[];
  note: string;
  isCustom: boolean;
};

export function entityIncludes(entity: Entity, filters: string[]): boolean {
  if (filters.length === 0) {
    return true;
  }
  return filters.some((filter) => {
    const regex = toRegExp(filter);
    if (regex) {
      return regex.test(entity.name) || regex.test(entity.note) || regex.test(entity.selection?.filePath || "");
    } else {
      const filterLower = filter.toLowerCase();
      return entity.name.toLowerCase().includes(filterLower) ||
        entity.note.toLowerCase().includes(filterLower) ||
        (entity.selection?.filePath || "").toLowerCase().includes(filterLower);
    }
  });
}

export type Operation = {
  selection?: Selection;
  name: string;
  arguments: Argument[];
  type: "read" | "write" | "other" | "transaction";
  note: string;
  isCustom: boolean;
};

export function operationIncludes(operation: Operation, filters: string[]): boolean {
  if (filters.length === 0) {
    return true;
  }
  return filters.some((filter) => {
    // Special syntax ?noarg(filter) where filter is applied to the operation if it has no arguments. 
    const matchNoArg = filter.match(/^\?noarg(\((.+)\))?$/);
    if (matchNoArg) {
      if (operation.arguments.length > 0) {
        return false;
      }
      if (matchNoArg[2]) {
        filter = matchNoArg[2];
      } else {
        return true;
      }
    }

    const regex = toRegExp(filter);
    if (regex) {
      return regex.test(operation.name) || regex.test(operation.note) ||
        operation.arguments.some((arg) => regex.test(arg.name) ||
          regex.test(arg.note) || regex.test(arg.selection?.filePath || ""));
    } else {
      const filterLower = filter.toLowerCase();
      return operation.name.toLowerCase().includes(filterLower) ||
        operation.note.toLowerCase().includes(filterLower) ||
        operation.type.toLowerCase().includes(filterLower) ||
        (operation.selection?.filePath || "").toLowerCase().includes(filterLower) ||
        operation.arguments.some((arg) =>
          arg.name.toLowerCase().includes(filterLower) ||
          arg.note.toLowerCase().includes(filterLower)
        );
    }
  });
}

export type Argument = {
  selection?: Selection;
  name: string;
  note: string;
  isCustom: boolean;
};

export type Selection = {
  filePath: string;
  fromLine: number;
  fromColumn: number;
  toLine: number;
  toColumn: number;
};

export function compareSelection(a: Selection | undefined, b: Selection | undefined): number {
  if (a === undefined) {
    return -1;
  }
  if (b === undefined) {
    return 1;
  }
  if (a.filePath < b.filePath) {
    return -1;
  }
  if (a.filePath > b.filePath) {
    return 1;
  }
  if (a.fromLine < b.fromLine) {
    return -1;
  }
  if (a.fromLine > b.fromLine) {
    return 1;
  }
  if (a.fromColumn < b.fromColumn) {
    return -1;
  }
  if (a.fromColumn > b.fromColumn) {
    return 1;
  }
  return 0;
}

export enum AnalyzeResultGroup {
  recognized = "Recognized",
  unknown = "Unknown",
}

type Repository = {
  url: string;
  hash: string;
};

// A singleton class that stores the result of the analysis.
export class AnalyzeResult {
  private static _instance: AnalyzeResult;

  private resultPath: string | undefined;
  private repository?: Repository;
  private group: Map<string, Map<string, Entity>>;
  private refreshFn: () => void = () => { };

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

  setRepository(repository?: Repository) {
    this.repository = repository;
  }

  getRepository(): Repository | undefined {
    return this.repository;
  }

  setResultPath(path: string) {
    this.resultPath = path;
  }

  clear() {
    for (const value of this.group.values()) {
      value.clear();
    }
  }

  async loadFromStorage(): Promise<boolean> {
    assert(this.resultPath !== undefined, "Result path is not set");
    if (!fs.existsSync(this.resultPath)) {
      return false;
    }
    const currentResultPath = this.resultPath;
    const resultPath = vscode.Uri.file(currentResultPath);
    const data = await vscode.workspace.fs.readFile(resultPath);
    const newResult: AnalyzeResult = JSON.parse(data.toString(), reviver);
    Object.assign(this, newResult);
    this.setResultPath(currentResultPath);
    this.refreshFn();
    return true;
  }

  async saveToStorage() {
    assert(this.resultPath !== undefined, "Result path is not set");
    const resultPath = vscode.Uri.file(this.resultPath);
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
  } else if (value instanceof Set) {
    return {
      dataType: "Set",
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
    } else if (value.dataType === "Set") {
      return new Set(value.value);
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

export type MovedItemLocator = {
  name: string;
  parentName: string; // this field is for display only and not used for locating the item
  filePath: string | undefined;
  fromLine: number | undefined;
  toLine: number | undefined;
  fromColumn: number | undefined;
  toColumn: number | undefined;
};

export function moveOperations(srcGroup: Map<string, Entity>, targetEntity: Entity, operations: MovedItemLocator[]) {
  const deletedItems: [number, Entity][] = [];
  for (const movedOperation of operations) {
    // Find the operation
    let srcEntity = undefined;
    let operation = undefined;
    let operationIndex = undefined;
    for (const entity of srcGroup.values()) {
      for (const [index, op] of entity.operations.entries()) {
        if (op.name === movedOperation.name &&
          op.selection?.filePath === movedOperation.filePath &&
          op.selection?.fromLine === movedOperation.fromLine &&
          op.selection?.fromColumn === movedOperation.fromColumn &&
          op.selection?.toLine === movedOperation.toLine &&
          op.selection?.toColumn === movedOperation.toColumn) {
          srcEntity = entity;
          operation = op;
          operationIndex = index;
          break;
        }
      }
    }

    // Skip if the operation is not found or the source entity is the same as the target entity
    if (!srcEntity || srcEntity === targetEntity) {
      continue;
    }

    // Push the operation to the target entity
    targetEntity.operations.push(operation!);
    // Save the index and source entity for deletion later
    deletedItems.push([operationIndex!, srcEntity]);
  }

  // Sort by index in descending order before deleting to avoid index shift
  for (const [index, entity] of deletedItems.sort(([a], [b]) => b - a)) {
    entity.operations.splice(index, 1);
  }
}

export function moveArguments(srcGroup: Map<string, Entity>, targetOperation: Operation, args: MovedItemLocator[]) {
  const deletedItems: [number, Operation][] = [];
  for (const movedArg of args) {
    // Find the argument
    let srcEntity = undefined;
    let srcOperation = undefined;
    let arg = undefined;
    let argIndex = undefined;
    for (const entity of srcGroup.values()) {
      for (const operation of entity.operations) {
        for (const [index, a] of operation.arguments.entries()) {
          if (a.name === movedArg.name &&
            a.selection?.filePath === movedArg.filePath &&
            a.selection?.fromLine === movedArg.fromLine &&
            a.selection?.fromColumn === movedArg.fromColumn &&
            a.selection?.toLine === movedArg.toLine &&
            a.selection?.toColumn === movedArg.toColumn) {
            srcEntity = entity;
            srcOperation = operation;
            arg = a;
            argIndex = index;
            break;
          }
        }
      }
    }

    // Skip if the argument is not found or the source operation is the same as the target operation
    if (!srcEntity || srcOperation === targetOperation) {
      continue;
    }

    // Push the argument to the target operation
    targetOperation.arguments.push(arg!);
    // Save the index and source operation for deletion later
    deletedItems.push([argIndex!, srcOperation!]);
  }

  // Sort by index in descending order before deleting to avoid index shift
  for (const [index, operation] of deletedItems.sort(([a], [b]) => b - a)) {
    operation.arguments.splice(index, 1);
  }
}

export const FULL_SCAN = "full-scan";
export const CDA_TRAN = "cda-tran";
export const NON_TRIVIAL = "non-trivial";
export const NON_EQ = "non-eq";
const CDA_DEP = "cda-dep";
const ONESHOT_EASY = "1shot-easy";
const ONESHOT_HARD = "1shot-hard";
const MSHOT = "mshot";
const PHANTOM = "phantom";

export const TAGS = [
  CDA_TRAN,
  CDA_DEP,
  ONESHOT_EASY,
  ONESHOT_HARD,
  MSHOT,
  NON_EQ,
  NON_TRIVIAL,
  FULL_SCAN,
  PHANTOM,
];

export function countTags(entities: Entity[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const entity of entities) {
    for (const operation of entity.operations) {
      for (const tag of TAGS) {
        if (operation.note.includes(tag)) {
          result.set(tag, (result.get(tag) || 0) + 1);
        }
      }
    }
  }
  return result;
}

export function getCurrentSelection(workspacePath: vscode.Uri): Selection | undefined {
  const activeTextEditor = vscode.window.activeTextEditor;
  let selection: Selection | undefined;
  if (activeTextEditor) {
    let filePath = path.relative(workspacePath.fsPath, activeTextEditor.document.uri.path);
    let editorSelection = activeTextEditor.selection;
    selection = {
      filePath,
      fromLine: editorSelection.start.line,
      fromColumn: editorSelection.start.character,
      toLine: editorSelection.end.line,
      toColumn: editorSelection.end.character,
    };
  }
  return selection;
}

export function appendNote(note: string, more: string): string {
  if (!note) {
    return more;
  }
  return note + " " + more;
}

function toRegExp(filter: string): RegExp | undefined {
  const match = filter.match(/^\/(.+)\/([gimsuy]*)$/);
  if (match) {
    const pattern = match[1];
    const modifier = match[2];
    return new RegExp(pattern, modifier);
  }
}