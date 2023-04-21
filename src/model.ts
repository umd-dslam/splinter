import { Location } from "vscode";

export class Operation {
  constructor(public loc: Location, public name: string) {}
}

export class Entity {
  constructor(
    public loc: Location,
    public name: string,
    public operations: Operation[]
  ) {}
}

export class Unsure {
  constructor(public loc: Location, public name: string) {}
}

export type AnalyzeResult =
  | {
      entities: Map<string, Entity>;
      unsure: Unsure[];
    }
  | string;
