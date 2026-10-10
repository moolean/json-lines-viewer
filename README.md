# JSON Lines Viewer

This fork of [lehoanganh298/json-lines-viewer](https://github.com/lehoanganh298/json-lines-viewer)
previews one physical JSON Lines record at a time in a read-only editor.

## 安装和使用 / Install and use

这是 moolean 维护的本地改进版，不是原作者的 Marketplace 更新。
安装包沿用原扩展 ID，因此安装后会替换原来的 JSON Lines Viewer，不会产生两个冲突的预览命令。

1. 在 VSCode 扩展页的 `...` 菜单中选择 **Install from VSIX...**，安装构建好的 `.vsix` 文件。
2. 执行 **Developer: Reload Window**。
3. 打开 `.jsonl` / `.jl` / `.ndjson` 文件，执行 **Open JSON Lines Preview**。
   语言模式即使是 JSON 或 Plain Text 也可以打开；预览从光标所在行开始。
4. 使用预览页右上角的上一行、下一行、跳转和刷新按钮；点击状态栏行号也可以跳转。

运行命令时没有选中 JSON Lines 文件，会出现文件选择界面。
在预览页重复运行打开命令会保留当前预览，不再出现“先打开 .jsonl 文件”的提示。
空行、空文件、非法 JSON 和读取失败会在预览里显示说明，仍可继续翻页。

The `.vsix` uses the original extension ID to replace the installed version locally.
It is maintained by moolean and is not an official Marketplace release.

## Features
To open the preview, do one of the following:
- Right-click a Jsonl file, choose `Open JSON Lines Preview`
- Open a Jsonl file, click the `Open JSON Lines Preview` icon in the editor title bar
- Open a Jsonl file, run command `Open JSON Lines Preview`

File recognition accepts `.jsonl`, `.jl` and `.ndjson` (case-insensitive), independent
of the source editor's language mode. If the active editor is unrelated, the command
offers open JSON Lines documents or a file browser. An untitled document in JSON Lines
mode also works. Running the command inside a preview reuses that preview.

Move to different lines:
- Click the `JSONL Next Line`, `JSONL Previous Line` or `JSONL Go to Line` icon in the editor title bar, or run the corresponding command.
- Click the status bar line number to jump; only positive whole line numbers are accepted.
- Run `JSONL Refresh Preview` after external file changes. Source edits and saves refresh automatically.
- Blank and invalid records retain their physical line numbers and show a readable explanation.

### Large File Support
Saved local UTF-8 files use a lazy, sparse byte-position index:
- The first preview reads only as far as the selected line, without indexing the whole file first.
- Raw byte offsets handle LF, CRLF, Chinese text and emoji correctly.
- Every 100th visited line is indexed; cached positions are found by binary search.
- A first jump beyond the indexed region scans forward; later jumps reuse the index.
- File size and modification time changes invalidate cached positions. Streams close after each read.
- Unsaved buffers and remote/custom file providers use VSCode's document API. Those sources
  need to fit in a VSCode text document; the local disk reader does not have that requirement.

Windows paths, spaces, `#`, `%` and literal `(preview)` in names are preserved using
the original source URI instead of rebuilding a path from the preview title.

## Development

```sh
npm ci
npm run test:unit
npm test
npx @vscode/vsce package --no-dependencies --skip-license
```

`npm test` runs the tests in an isolated VSCode profile. To reuse an installed VSCode
binary, set `JSONL_TEST_VSCODE` to its executable path; otherwise the test runner
downloads its own VSCode installation.

![JSON Lines Viewer](./resources/json-lines-viewer.png "Text to show on mouseover")
<!-- ## Requirements -->



<!-- ## Extension Settings -->


<!-- This extension contributes the following settings:

* `myExtension.enable`: enable/disable this extension
* `myExtension.thing`: set to `blah` to do something -->

<!-- ## Known Issues -->



## Release Notes

### 0.0.6
- Recognize file extensions even under JSON or Plain Text mode; reuse existing previews.
- Offer file selection when the active editor is unrelated; start at the source cursor.
- Preserve local and remote URIs and preview unsaved edits.
- Correct CRLF byte offsets and lazily build sparse indices.
- Show readable errors and add refresh, clickable line status and strict jump validation.
- Replace the placeholder test with reader and actual VSCode command regression tests.

### 0.0.5
Add support for large files with minimal memory overhead
- Implement intelligent line position caching
- Support files of any size without loading entire file into memory
- Use sampling strategy for files > 10MB to reduce memory usage
- Enable instant navigation to any line

### 0.0.1
Initial release

### 0.0.2
Update Readme and instructions

### 0.0.3
Fix path error in Windows

### 0.0.4
Fix path error in Linux
