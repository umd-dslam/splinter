import vscode from "vscode";
import { AnalyzeResult, AnalyzeResultGroup } from "../model";
import { Analyzer } from "./base";
import child_process from "child_process";
import tmp from "tmp";

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
        public readonly objectType: string,
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

    constructor(private rootPath: string, private result: AnalyzeResult) {
        this.proc = null;
    }

    getName(): string {
        return "django";
    }

    async analyze(onMessage: (msg: string) => void) {
        if (this.proc !== null) {
            vscode.window.showErrorMessage("Analyze process is already running.");
            return false;
        }

        // Create a temporary file to store the messages
        const tmpFile = tmp.fileSync({ prefix: "splinter", postfix: ".json" });
        console.log("Message file: ", tmpFile.name);

        this.proc = child_process.spawn("python3", [
            "-m",
            "splinter",
            this.rootPath,
            "--output",
            tmpFile.name,
        ]);

        if (this.proc === null) {
            console.error("Failed to spawn the analyze process.");
            return false;
        }

        this.proc.stdout?.on("data", (data) => {
            onMessage(`${data}`);
        });

        this.proc.stderr?.on("data", (data) => {
            console.error(`${data}`);
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
            });
        });
    }

    private collectEntities(
        messages: Message[],
    ) {
        let entities = this.result.getGroup(AnalyzeResultGroup.recognized);

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
                        filePath: msg.filePath,
                        fromLine: msg.fromLine,
                        toLine: msg.toLine,
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
        let entities = this.result.getGroup(AnalyzeResultGroup.recognized);
        let unknowns = this.result.getGroup(AnalyzeResultGroup.unknown);

        for (const msg of messages) {
            const content = msg.content;
            const selection = {
                filePath: msg.filePath,
                fromLine: msg.fromLine,
                toLine: msg.toLine,
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
                            filePath: msg.filePath,
                            fromLine: attr.startLine - 1,
                            fromColumn: attr.startColumn,
                            toLine: attr.endLine - 1,
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
                // Parse the entity name in the pattern "django.db.models.manager.Manager[EntityName]"
                var entityName = content.objectType.match(/django.db.models.manager.Manager\[(.*)\]/)?.[1];
                var entity =
                    entityName === undefined ? entityName : entities.get(entityName);
                if (entity !== undefined) {
                    entity.operations.push(operation);
                    found = true;
                    break;
                }

                // Exact match of the entity name. This might cause false positives if
                // a non-entity callee happens to have the same name as an entity.
                if (entities.has(content.objectType)) {
                    entities.get(content.objectType)!.operations.push(operation);
                    found = true;
                    break;
                }

                // Cannot recognize an entity
                if (!found) {
                    if (!unknowns.has(content.objectType)) {
                        unknowns.set(content.objectType, {
                            selection: undefined,
                            name: content.objectType,
                            operations: [],
                            note: "",
                            isCustom: false,
                        });
                    }

                    unknowns.get(content.objectType)!.operations.push({
                        selection,
                        name: content.object + "." + content.name,
                        type: content.methodType,
                        note: "",
                        arguments: content.attributes.map((attr) => ({
                            selection: {
                                filePath: selection.filePath,
                                fromLine: attr.startLine - 1,
                                fromColumn: attr.startColumn,
                                toLine: attr.endLine - 1,
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
}
