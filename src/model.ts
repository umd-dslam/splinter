import { Location } from "vscode";

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
};

export class AnalyzeResult {
  private entities: Map<string, Entity>;
  private unknowns: Map<string, Entity>;

  constructor() {
    this.entities = new Map();
    this.unknowns = new Map();
  }

  getEntities(): Map<string, Entity> {
    return this.entities;
  }

  getUnknowns(): Map<string, Entity> {
    return this.unknowns;
  }

  extend(result: AnalyzeResult) {
    for (const item of result.entities) {
      this.entities.set(...item);
    }

    for (const item of result.unknowns) {
      this.unknowns.set(...item);
    }
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

export function serializeAnalyzeResult(result: AnalyzeResult): string {
  return JSON.stringify(result, replacer);
}

export function deserializeAnalyzeResult(
  result: string
): AnalyzeResult | undefined {
  try {
    return JSON.parse(result, reviver);
  } catch (e) {
    return undefined;
  }
}

export function countOperationTypes(
  operations: Operation[],
  start?: { [key: string]: number }
): { [key: string]: number } {
  if (start === undefined) {
    start = {};
  }

  return operations.reduce((acc, operation) => {
    acc[operation.type] = acc[operation.type] ? acc[operation.type] + 1 : 1;
    return acc;
  }, start);
}
