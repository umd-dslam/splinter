# Splinter

This extension finds and categorizes the ORM operations in a codebase as described in the paper [Are Database System Researchers Making Correct Assumptions about Transaction Workloads?](https://dl.acm.org/doi/10.1145/3725268).

It currently supports the following ORMs:

- [TypeORM](https://github.com/umd-dslam/splinter-eslint)
- [Django ORM](https://github.com/umd-dslam/splinter-mypy)

The results are displayed in a sidebar named "Splinter" in Visual Studio Code, where you can visually see the categorized ORM operations of the target repository. The resulting data is stored in a JSON file under the `.vscode` directory of the target repository.

This extension is designed such that you can support additional ORMs by implementing the `Analyzer` interface under the `src/analyzer` directory, and modify the code under the `Set up the analyzer and views` section in `src/extension.ts` to register the new analyzer. See the existing TypeORM and Django ORM analyzer for examples.

## Getting Started

Install the dependencies

```
npm install
```

Install `vsce` to package the extension

```
npm install @vscode/vsce
```

Build the extension

```
npx vsce package
```

The extension will be packaged into a `.vsix` file, which can be installed in VS Code by right clicking on the file and selecting "Install Extension VSIX".

For a TypeScript project, you can now open the project in VS Code and the extension will automatically analyze the ORM operations in the code and display them in the "Splinter" sidebar.

For a Python project, you need to first install the Python package, following the instructions in https://github.com/umd-dslam/splinter-mypy, before opening the project in VS Code.
