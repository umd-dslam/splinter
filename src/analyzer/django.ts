import vscode, { OutputChannel } from "vscode";
import { AnalyzeResult, AnalyzeResultGroup, CDA_TRAN, NON_EQ, NON_TRIVIAL, FULL_SCAN, appendNote } from "../model";
import { Analyzer } from "./base";
import child_process from "child_process";
import tmp from "tmp";
import path from "path";

class Content {
    constructor(public readonly type: string) { }

    toString(): string {
        return JSON.stringify(this);
    }
}

class ModelContent extends Content {
    constructor(public readonly name: string) {
        super('model');
    }

    static validate(content: Content): content is ModelContent {
        return content.type === 'model';
    }
}

class Attribute {
    constructor(
        public readonly name: string,
        public readonly startLine: number,
        public readonly startColumn: number,
        public readonly endLine: number,
        public readonly endColumn: number
    ) { }
}

class MethodContent extends Content {
    constructor(
        public readonly name: string,
        public readonly methodType: 'read' | 'write' | 'other' | 'transaction',
        public readonly object: string,
        public readonly objectTypes: [string],
        public readonly attributes: Attribute[]
    ) {
        super('method');
    }

    static validate(content: Content): content is MethodContent {
        return content.type === 'method';
    }
}

class Message {
    constructor(
        public readonly filePath: string,
        public readonly fromLine: number,
        public readonly toLine: number,
        public readonly fromColumn: number,
        public readonly toColumn: number,
        public readonly content: Content
    ) { }
}

export class DjangoAnalyzer implements Analyzer {
    private proc: child_process.ChildProcess | null;

    constructor(private workspacePath: vscode.Uri, private result: AnalyzeResult) {
        this.proc = null;
    }

    getName(): string {
        return "django";
    }

    async analyze(onMessage: (msg: string) => void, outputChannel: OutputChannel) {
        if (this.proc !== null) {
            vscode.window.showErrorMessage("Analyze process is already running.");
            return false;
        }

        const rootPath = vscode.Uri.joinPath(this.workspacePath,
            vscode.workspace.getConfiguration("splinter").get("rootDir") as string).fsPath;
        const exclude = vscode.workspace.getConfiguration("splinter").get("exclude") as [string];

        // Create a temporary file to store the messages
        const tmpFile = tmp.fileSync({ prefix: "splinter", postfix: "django.json" });
        outputChannel.clear();
        outputChannel.appendLine(`Analyzing Django project at: ${rootPath}`);
        outputChannel.appendLine(`Excluding files: ${exclude.join(", ")}`);
        outputChannel.appendLine(`Message file: ${tmpFile.name}`);

        const args = [
            "-m",
            "splinter",
            rootPath,
            "--output",
            tmpFile.name,
        ];

        for (const ex of exclude) {
            args.push("--exclude-glob");
            args.push(ex);
        }

        this.proc = child_process.spawn("python3", args);

        if (this.proc === null) {
            outputChannel.appendLine("Failed to spawn the analyze process.");
            return false;
        }

        this.proc.stdout?.on("data", (data) => {
            const lines = `${data}`.trimEnd().split("\n");
            onMessage(lines[lines.length - 1]);
        });

        this.proc.stderr?.on("data", (data) => {
            outputChannel.append(`${data}`);
        });

        // Wait for the process to finish
        return await new Promise((resolve: (ret: boolean) => void) => {
            this.proc?.on("close", async (code) => {
                if (code === 0) {
                    const messagesFilePath = vscode.Uri.file(tmpFile.name);
                    const content = await vscode.workspace.fs.readFile(messagesFilePath);
                    const output = JSON.parse(content.toString());
                    this.collectEntities(output.messages);
                    this.collectOperations(output.messages);
                    resolve(true);
                } else {
                    resolve(false);
                }
                this.proc = null;
            });
        });
    }

    private collectEntities(
        messages: Message[],
    ) {
        let entities = this.result.getGroup(AnalyzeResultGroup.recognized);
        if (entities.size === 0) {
            entities.set("django.db.transaction.atomic", {
                selection: undefined,
                name: "[django.db.transaction.atomic]",
                operations: [],
                note: "",
                isCustom: false,
            });
        }

        for (const msg of messages) {
            const content = msg.content;
            if (ModelContent.validate(content)) {
                if (entities.has(content.name)) {
                    vscode.window.showWarningMessage(
                        `Entity ${content.name} is defined multiple times.`
                    );
                    continue;
                }
                entities.set(content.name, {
                    selection: {
                        filePath: path.relative(this.workspacePath.fsPath, msg.filePath),
                        fromLine: msg.fromLine - 1,
                        toLine: msg.toLine - 1,
                        fromColumn: msg.fromColumn,
                        toColumn: msg.toColumn,
                    },
                    name: content.name,
                    operations: [],
                    note: "",
                    isCustom: false,
                });
            }
        }
    }

    cancel() {
        this.proc?.kill();
        this.proc = null;
    }

    private collectOperations(messages: Message[]) {
        const entities = this.result.getGroup(AnalyzeResultGroup.recognized);
        const unknowns = this.result.getGroup(AnalyzeResultGroup.unknown);

        const baseEntityNames: Map<string, string | null> = new Map();
        for (const name of entities.keys()) {
            if (name.startsWith("[")) {
                continue;
            }
            let baseName = name;
            const lastDot = name.lastIndexOf(".");
            if (lastDot !== -1) {
                baseName = name.substring(lastDot + 1);
            }
            if (baseEntityNames.has(baseName)) {
                baseEntityNames.set(baseName, null);
            } else {
                baseEntityNames.set(baseName, name);
            }
        }

        for (const msg of messages) {
            const content = msg.content;
            const filePath = path.relative(this.workspacePath.fsPath, msg.filePath);
            const selection = {
                filePath,
                fromLine: msg.fromLine - 1,
                toLine: msg.toLine - 1,
                fromColumn: msg.fromColumn,
                toColumn: msg.toColumn,
            };
            if (MethodContent.validate(content)) {
                const operation = {
                    selection,
                    name: content.object + "." + content.name,
                    type: content.methodType,
                    note: "",
                    arguments: content.attributes.map((attr) => ({
                        selection: {
                            filePath,
                            fromLine: attr.startLine - 1,
                            toLine: attr.endLine - 1,
                            fromColumn: attr.startColumn,
                            toColumn: attr.endColumn,
                        },
                        name: attr.name,
                        note: "",
                        isCustom: false,
                    })),
                    isCustom: false,
                };

                // Find a recognized entity
                let found = false;
                for (const calleeType of content.objectTypes) {
                    // Parse the entity name in the pattern "django.db.models.manager.Manager[ModelName]"
                    {
                        const entityName = calleeType.match(/django.db.models.manager.Manager\[(.*)\]/)?.[1];
                        if (entityName !== undefined && entities.has(entityName)) {
                            const entity = entities.get(entityName)!;
                            entity.operations.push(operation);
                            found = true;
                            break;
                        }
                    }

                    // Parse the entity name in the pattern "django.db.models.manager.BaseManager[ModelName]"
                    {
                        const entityName = calleeType.match(/django.db.models.manager.BaseManager\[(.*)\]/)?.[1];
                        if (entityName !== undefined && entities.has(entityName)) {
                            const entity = entities.get(entityName)!;
                            entity.operations.push(operation);
                            found = true;
                            break;
                        }
                    }

                    // Parse the entity names in the pattern "django.db.models.query._QuerySet[ModelName, ...]"
                    {
                        const entityNamesStr = calleeType.match(/django.db.models.query._QuerySet\[(.*)\]/)?.[1];
                        const entityNames = entityNamesStr === undefined ? [] : entityNamesStr.split(", ");
                        for (const entityName of entityNames) {
                            const entity = entities.get(entityName);
                            if (entity !== undefined) {
                                entity.operations.push(operation);
                                found = true;
                                break;
                            }
                        }
                        if (found) {
                            break;
                        }
                    }

                    // Match with the unique base name of the entity
                    {
                        const baseEntityName = calleeType.match(/(\w+)Manager$/)?.[1];
                        if (baseEntityName !== undefined && baseEntityNames.has(baseEntityName)) {
                            const entityName = baseEntityNames.get(baseEntityName);
                            if (entityName !== null && entityName !== undefined) {
                                const entity = entities.get(entityName)!;
                                entity.operations.push(operation);
                                found = true;
                                break;
                            }
                        }

                        if (["django.db.models.query._QuerySet[Any, Any]", "django.db.models.manager.Manager[Any]"].includes(calleeType)) {
                            let baseEntityName = content.object;
                            let firstDot = baseEntityName.indexOf(".");
                            if (firstDot !== -1) {
                                baseEntityName = baseEntityName.substring(0, firstDot);
                            }
                            const entityName = baseEntityNames.get(baseEntityName);
                            if (entityName !== undefined && entityName !== null) {
                                const entity = entities.get(entityName)!;
                                entity.operations.push(operation);
                                found = true;
                                break;
                            }
                        }

                        if (calleeType === "FilterSet") {
                            const baseEntityName = content.name.match(/(\w+)Filter$/)?.[1];
                            if (baseEntityName !== undefined && baseEntityNames.has(baseEntityName)) {
                                const entityName = baseEntityNames.get(baseEntityName);
                                if (entityName !== null && entityName !== undefined) {
                                    const entity = entities.get(entityName)!;
                                    entity.operations.push(operation);
                                    found = true;
                                    break;
                                }
                            }
                        }
                    }

                    // Exact match of the entity name. This might cause false positives if
                    // a non-entity callee happens to have the same name as an entity.
                    {
                        if (entities.has(calleeType)) {
                            entities.get(calleeType)!.operations.push(operation);
                            found = true;
                            break;
                        }
                    }
                }


                if (!found) {
                    const calleeType = content.objectTypes[0];
                    if (!unknowns.has(calleeType)) {
                        unknowns.set(calleeType, {
                            selection: undefined,
                            name: calleeType,
                            operations: [],
                            note: "",
                            isCustom: false,
                        });
                    }

                    unknowns.get(calleeType)!.operations.push({
                        selection,
                        name: content.object + "." + content.name,
                        type: content.methodType,
                        note: "",
                        arguments: content.attributes.map((attr) => ({
                            selection: {
                                filePath: selection.filePath,
                                fromLine: attr.startLine - 1,
                                toLine: attr.endLine - 1,
                                fromColumn: attr.startColumn,
                                toColumn: attr.endColumn,
                            },
                            name: attr.name,
                            note: "",
                            isCustom: false,
                        })),
                        isCustom: false,
                    });
                }
            }
        }
    }

    supportedAutoAnnotateTags(): string[] {
        return [FULL_SCAN, CDA_TRAN, NON_EQ, NON_TRIVIAL];
    }

    autoAnnotate(tag: string) {
        switch (tag) {
            case FULL_SCAN:
                this.autoAnnotateFullScan();
                break;
            case CDA_TRAN:
                this.autoAnnotateCdaTran();
                break;
            case NON_EQ:
            case NON_TRIVIAL:
                this.autoannotateNonEqNonTrivial(tag);
                break;
            default:
                vscode.window.showErrorMessage(`Unsupported auto-annotate tag: ${tag}`);
        }
    }

    autoAnnotateFullScan() {
        const entities = this.result.getGroup(AnalyzeResultGroup.recognized);
        for (const entity of entities.values()) {
            if (!entity.note.includes(FULL_SCAN)) {
                let hasFullScan = false;
                for (const operation of entity.operations) {
                    if (operation.name.endsWith(".all")) {
                        hasFullScan = true;
                        break;
                    }
                }
                if (hasFullScan) {
                    entity.note = appendNote(entity.note, `${FULL_SCAN}(a)`);
                }
            }
        }
    }

    autoAnnotateCdaTran() {
        const covers = (bigger: string[], smaller: string[]) => {
            if (bigger.length < smaller.length) {
                [bigger, smaller] = [smaller, bigger];
            }
            for (const column of smaller) {
                if (!bigger.includes(column)) {
                    return false;
                }
            }
            return true;
        };

        const entities = this.result.getGroup(AnalyzeResultGroup.recognized);
        for (const entity of entities.values()) {
            if (!entity.note.includes(CDA_TRAN)) {
                // Collect all CDAs on the entity
                const cdas: string[][] = [];
                for (const operation of entity.operations) {
                    const cda: string[] = [];
                    for (const arg of operation.arguments) {
                        const parts = arg.name.split("__");
                        if (0 < parts.length && parts.length <= 2) {
                            cda.push(parts[0]);
                        }
                    }
                    if (cda.length > 0) {
                        cdas.push(cda);
                    }
                }
                // Check if all CDAs are covered by each other
                let cdaTran = false;
                for (let i = 0; i < cdas.length; i++) {
                    for (let j = 0; j < cdas.length; j++) {
                        if (i === j) {
                            continue;
                        }
                        if (!covers(cdas[i], cdas[j])) {
                            cdaTran = true;
                            break;
                        }
                    }
                }
                if (cdaTran) {
                    entity.note = appendNote(entity.note, `${CDA_TRAN}(a)`);
                }
            }
        }
    }

    autoannotateNonEqNonTrivial(tag: string) {
        const entities = this.result.getGroup(AnalyzeResultGroup.recognized);
        for (const entity of entities.values()) {
            for (const operation of entity.operations) {
                if (!operation.note.includes(tag)) {
                    let hasTag = false;
                    for (const arg of operation.arguments) {
                        const parts = arg.name.split("__");
                        const lookup = parts[parts.length - 1];
                        switch (tag) {
                            case NON_EQ:
                                if ([
                                    "contains",
                                    "icontains",
                                    "startswith",
                                    "istartswith",
                                    "endswith",
                                    "iendswith",
                                    "gt",
                                    "gte",
                                    "lt",
                                    "lte",
                                    "range",
                                    "regex",
                                    "iregex",
                                ].includes(lookup)) {
                                    hasTag = true;
                                }
                                break;
                            case NON_TRIVIAL:
                                if ([
                                    "iexact",
                                    "contains",
                                    "icontains",
                                    "startswith",
                                    "istartswith",
                                    "endswith",
                                    "iendswith",
                                    "regex",
                                    "iregex",
                                ].includes(lookup)) {
                                    hasTag = true;
                                }
                                break;
                            default:
                                vscode.window.showErrorMessage(`Unsupported tag: ${tag}`);
                                return;
                        }
                    }
                    if (hasTag) {
                        operation.note = appendNote(operation.note, `${tag}(a)`);
                    }
                }
            }
        }
    }
}
