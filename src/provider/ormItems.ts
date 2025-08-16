import vscode from "vscode";
import {
  AnalyzeResult,
  AnalyzeResultGroup,
  Entity,
  Operation,
  Argument,
  groupOperationTypes,
  entityIncludes,
  operationIncludes,
  MovedItemLocator,
  moveOperations,
  moveArguments,
  compareSelection,
} from "../model";
import path from "path";
import pluralize from "pluralize";

export type ORMItem = {
  type: "entity" | "operation" | "argument";
  inner: Entity | Operation | Argument;
  parent?: ORMItem;
  idInParent: number;
  resultGroup: AnalyzeResultGroup;
};

type DragAndDropDataType = {
  resultGroup: AnalyzeResultGroup;
  itemType: "operation" | "argument";
  items: MovedItemLocator[];
};

function computeCDA(item: ORMItem): number | null {
  if (item.type !== "entity") {
    return null;
  }
  let entity = item.inner as Entity;
  let cda: Set<string> = new Set();
  for (const operation of entity.operations) {
    if (operation.arguments.length > 0) {
      cda.add(
        operation.arguments
          .map((arg) => arg.name)
          .sort()
          .join(",")
      );
    }
  }
  return cda.size;
}

const DRAG_DROP_MIME_TYPE = "application/vnd.code.tree.entity-operation";

export class ORMItemProvider
  implements
  vscode.TreeDataProvider<ORMItem>,
  vscode.TreeDragAndDropController<ORMItem> {

  private filters: string[] = [];
  private isFlat: boolean = false;

  constructor(
    private workspacePath: vscode.Uri,
    private resultGroup: AnalyzeResultGroup
  ) { }

  getTreeItem(item: ORMItem): vscode.TreeItem {
    let relativePath = item.inner.selection
      ? path.relative(this.workspacePath.fsPath, item.inner.selection.filePath)
      : "";
    let treeItem = new vscode.TreeItem(item.inner.name);

    let description: string[] = [];
    let tooltip: string[] = [relativePath];
    let contextValue: string[] = [];

    if (item.inner.selection) {
      description.push(`line: ${item.inner.selection.fromLine + 1}`);
    }

    if (item.type === "entity") {
      let inner = item.inner as Entity;
      // Determine tree state
      treeItem.collapsibleState =
        inner.operations.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None;
      // Compute description
      description.push(
        ...Object.entries(groupOperationTypes(inner.operations))
          .map(([type, ids]) => [type, ids.size])
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([type, count]) => `${type}: ${count}`)
      );
      description.push(`cda: ${computeCDA(item)}`);
      // Select icon
      treeItem.iconPath = new vscode.ThemeIcon("table");
      // Add context values
      contextValue.push("entity");
    } else if (item.type === "operation") {
      let inner = item.inner as Operation;

      // Determine tree state
      treeItem.collapsibleState =
        inner.arguments.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
      // Compute description
      description.push(inner.type);
      // Select icon
      treeItem.iconPath = new vscode.ThemeIcon("symbol-method");
      // Add context value
      contextValue.push("operation");
    } else if (item.type === "argument") {
      // Determine tree state
      treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
      // Select icon
      treeItem.iconPath = new vscode.ThemeIcon("symbol-variable");
      // Add context value
      contextValue.push("argument");
    }

    if (item.inner.isCustom) {
      contextValue.push("custom");
    }

    if (item.inner.note) {
      description.push(`note: ${item.inner.note}`);
      tooltip.push(item.inner.note);
      contextValue.push("hasNote");
    }

    treeItem.description = description.join(" | ");
    treeItem.tooltip = tooltip.join("\n");
    treeItem.contextValue = contextValue.join(" ");

    if (item.inner.selection) {
      treeItem.command = {
        command: "splinter.item.show",
        title: "Show",
        arguments: [
          new vscode.Location(
            vscode.Uri.joinPath(
              this.workspacePath,
              item.inner.selection.filePath
            ),
            new vscode.Range(
              item.inner.selection.fromLine,
              item.inner.selection.fromColumn,
              item.inner.selection.toLine,
              item.inner.selection.toColumn
            )
          ),
        ],
      };
    }

    return treeItem;
  }

  async getChildren(item?: ORMItem): Promise<ORMItem[]> {
    const getFilteredOperations = (entity: Entity) => {
      let curEntityPassedFilters = entityIncludes(entity, this.filters);
      let items: ORMItem[] = entity.operations
        .map((operation, index) => {
          return {
            "operation": operation,
            "index": index
          };
        })
        .filter(indexedOp => curEntityPassedFilters || operationIncludes(indexedOp["operation"], this.filters))
        .sort((a, b) => compareSelection(a["operation"].selection, b["operation"].selection))
        .map(indexedOp => ({
          type: "operation",
          inner: indexedOp["operation"],
          parent: item,
          idInParent: indexedOp["index"],
          resultGroup: this.resultGroup,
        }));
      return items
    }

    if (item) {
      if (item.type === "entity") {
        return getFilteredOperations(item.inner as Entity);
      } else if (item.type === "operation") {
        let inner = item.inner as Operation;
        return inner.arguments
          .sort((a, b) => compareSelection(a.selection, b.selection))
          .map((argument, index) => ({
            type: "argument",
            inner: argument,
            parent: item,
            idInParent: index,
            resultGroup: this.resultGroup,
          }));
      }
      return [];
    }

    var entities = AnalyzeResult.getInstance().getGroup(this.resultGroup);
    if (this.filters.length > 0) {
      entities = new Map(
        Array.from(entities.entries()).filter(
          ([_, entity]) =>
            entityIncludes(entity, this.filters) ||
            entity.operations.some(operation => operationIncludes(operation, this.filters))
        )
      );
    }

    if (this.isFlat) {
      return Array.from(entities.values())
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .flatMap((entity) => getFilteredOperations(entity));
    } else {
      return Array.from(entities.values())
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .map((entity) => ({
          type: "entity",
          inner: entity,
          idInParent: -1,
          resultGroup: this.resultGroup,
        }));
    }
  }

  getParent(element: ORMItem): vscode.ProviderResult<ORMItem> {
    return element.parent;
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    ORMItem | undefined | null | void
  > = new vscode.EventEmitter<ORMItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ORMItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  updateItem(item: ORMItem): void {
    this._onDidChangeTreeData.fire(item);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(null);
  }

  dropMimeTypes = [DRAG_DROP_MIME_TYPE];
  dragMimeTypes = [DRAG_DROP_MIME_TYPE];

  async handleDrag(
    items: ORMItem[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    let itemType: "operation" | "argument" = "operation";
    for (const item of items) {
      if (item.type === "operation" || item.type === "argument") {
        itemType = item.type;
        break;
      }
    }

    const data: DragAndDropDataType = {
      resultGroup: this.resultGroup,
      itemType: itemType,
      items: items
        // Only allow operations or arguments to be dragged
        .filter((item) => item.type === itemType)
        .map((item) => ({
          name: item.inner.name,
          parentName: item.parent?.inner.name || "<root>",
          filePath: item.inner.selection?.filePath,
          fromLine: item.inner.selection?.fromLine,
          fromColumn: item.inner.selection?.fromColumn,
          toLine: item.inner.selection?.toLine,
          toColumn: item.inner.selection?.toColumn,
        })),
    };

    const transferItem = new vscode.DataTransferItem(JSON.stringify(data));
    dataTransfer.set(DRAG_DROP_MIME_TYPE, transferItem);
  }

  async handleDrop(
    target: ORMItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    let data = '';
    // Use `forEach` instead of get because the map in `dataTransfer` has more than one value
    // for the corresponding MIME type for some reason and one of the value is an empty string.
    // The `forEach` will loop over all values instead of just taking the first one like in
    // the case of `get`, so we use it here as a workaround.
    dataTransfer.forEach((item, mimeType) => {
      if (mimeType === DRAG_DROP_MIME_TYPE && item.value.length > 0) {
        data = item.value;
      }
    });

    if (!data || !target) {
      return;
    }

    let parsed = JSON.parse(data) as DragAndDropDataType;
    if (parsed.items.length === 0) {
      return;
    }

    if (parsed.itemType === "operation" && target.type !== "entity") {
      return;
    }

    if (parsed.itemType === "argument" && target.type !== "operation") {
      return;
    }

    // Show confirmation dialog
    let items = parsed.items;
    let detail = items
      .map((item) => `${item.name} [${item.parentName}]`)
      .join("\n");
    let confirm = await vscode.window.showInformationMessage(
      `Move ${pluralize("operations", items.length, true)} to ${target.inner.name
      }?`,
      { modal: true, detail },
      "Move"
    );

    // Cancel if user didn't confirm
    if (confirm !== "Move") {
      return;
    }

    let analyzeResult = AnalyzeResult.getInstance();
    let srcGroup = analyzeResult.getGroup(parsed.resultGroup);
    if (parsed.itemType === "operation") {
      moveOperations(srcGroup, target.inner as Entity, items);
    } else {
      moveArguments(srcGroup, target.inner as Operation, items);
    }

    await analyzeResult.saveToStorage();
  }

  setFilters(filters: string[]): void {
    this.filters = filters;
  }

  getFilters(): string[] {
    return this.filters;
  }

  clearFilters(): void {
    this.filters = [];
  }

  setIsFlat(isFlat: boolean): void {
    this.isFlat = isFlat;
  }
}
