import * as vscode from 'vscode';
import { FileLineReader, formatLine, LineResult, parseLineNumber } from './lineReader';

const previewScheme = 'jsonl';
const supportedPath = /\.(jsonl|jl|ndjson)$/i;

interface Preview {
	source: vscode.Uri;
	uri: vscode.Uri;
	line: number;
	totalLines?: number;
	revision: number;
}

export function activate(context: vscode.ExtensionContext): void {
	const previews = new Map<string, Preview>();
	const reader = new FileLineReader();
	const changes = new vscode.EventEmitter<vscode.Uri>();
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100000);
	status.command = 'json-lines-viewer.go-to-line';
	context.subscriptions.push(status, changes);

	function currentPreview(): Preview | undefined {
		const editor = vscode.window.activeTextEditor;
		return editor ? previews.get(editor.document.uri.toString()) : undefined;
	}

	function updateStatus(): void {
		const preview = currentPreview();
		if (!preview) {
			status.hide();
			return;
		}
		const total = preview.totalLines === undefined ? '' : ` / ${preview.totalLines}`;
		status.text = `JSONL at line: ${preview.line}${total}`;
		status.tooltip = 'Click to jump to a physical line in the source file';
		status.show();
	}

	async function readSource(preview: Preview, line: number): Promise<LineResult> {
		const openDocument = vscode.workspace.textDocuments.find(document =>
			document.uri.toString() === preview.source.toString());
		// Saved local files keep byte indexing, including files too large for the editor.
		if (preview.source.scheme === 'file' && !openDocument?.isDirty) {
			return reader.read(preview.source.fsPath, line);
		}
		// VS Code handles remote providers and unsaved changes with the original source URI.
		const document = openDocument || await vscode.workspace.openTextDocument(preview.source);
		let total = document.lineCount;
		if (total === 1 && document.lineAt(0).text === '') {
			return { text: '', line: 0, totalLines: 0 };
		}
		if (total > 1 && document.lineAt(total - 1).text === '') {
			total--;
		}
		const selected = Math.max(1, Math.min(line, total));
		return { text: document.lineAt(selected - 1).text, line: selected, totalLines: total };
	}

	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(previewScheme, {
		onDidChange: changes.event,
		async provideTextDocumentContent(uri): Promise<string> {
			const preview = previews.get(uri.toString());
			if (!preview) {
				return '// Reopen this preview from its source JSON Lines file.';
			}
			// Rapid navigation must not be overwritten by an older asynchronous read.
			while (true) {
				const revision = preview.revision;
				try {
					const result = await readSource(preview, preview.line);
					if (revision !== preview.revision) { continue; }
					preview.line = result.line;
					preview.totalLines = result.totalLines;
					updateStatus();
					return formatLine(result);
				} catch (error) {
					if (revision !== preview.revision) { continue; }
					const message = error instanceof Error ? error.message : String(error);
					return `// Cannot read the source file: ${message.replace(/[\r\n]+/g, ' ')}\n// Fix the file access and run JSONL Refresh Preview.`;
				}
			}
		}
	}));

	function isSource(document: vscode.TextDocument): boolean {
		return document.uri.scheme !== previewScheme &&
			(supportedPath.test(document.uri.path) || document.languageId === 'jsonl');
	}

	async function pickSource(): Promise<vscode.Uri | undefined> {
		const documents = vscode.workspace.textDocuments.filter(isSource);
		if (documents.length > 0) {
			const items = documents.map(document => ({
				label: document.uri.path.split('/').pop() || document.uri.toString(),
				description: vscode.workspace.asRelativePath(document.uri),
				uri: document.uri
			}));
			const browse = { label: 'Browse for a JSON Lines file...', description: '', uri: undefined };
			const selected = await vscode.window.showQuickPick([...items, browse], {
				placeHolder: 'Choose a JSON Lines file to preview'
			});
			if (!selected) { return undefined; }
			if (selected.uri) { return selected.uri; }
		}
		const selected = await vscode.window.showOpenDialog({
			canSelectMany: false,
			canSelectFolders: false,
			openLabel: 'Open JSON Lines Preview',
			// Dialog filter names are user-facing labels.
			// eslint-disable-next-line @typescript-eslint/naming-convention
			filters: { 'JSON Lines': ['jsonl', 'jl', 'ndjson'], 'All files': ['*'] }
		});
		return selected?.[0];
	}

	async function openPreview(arg?: vscode.Uri): Promise<void> {
		try {
			const active = vscode.window.activeTextEditor;
			const existing = arg ? previews.get(arg.toString()) : currentPreview();
			if (existing) {
				await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(existing.uri));
				return;
			}
			let source = arg;
			if (!source && active && isSource(active.document)) { source = active.document.uri; }
			if (!source) { source = await pickSource(); }
			if (!source) { return; }
			const key = source.toString();
			let preview = Array.from(previews.values()).find(item => item.source.toString() === key);
			const line = active?.document.uri.toString() === key ? active.selection.active.line + 1 : 1;
			if (!preview) {
				// Keep the complete URI, including remote authority and literal #, % and ?.
				const uri = vscode.Uri.from({ scheme: previewScheme, path: `${source.path} (preview)`, query: key });
				preview = { source, uri, line, revision: 0 };
				previews.set(uri.toString(), preview);
			} else {
				preview.line = line;
				preview.revision++;
				changes.fire(preview.uri);
			}
			const document = await vscode.workspace.openTextDocument(preview.uri);
			await vscode.languages.setTextDocumentLanguage(document, 'jsonc');
			await vscode.window.showTextDocument(document, { preview: false });
			updateStatus();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Unable to open JSON Lines preview: ${message}`);
		}
	}

	function navigate(line: number): void {
		const preview = currentPreview();
		if (!preview) { return; }
		preview.line = Math.max(1, line);
		preview.revision++;
		changes.fire(preview.uri);
		updateStatus();
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('json-lines-viewer.preview', openPreview),
		vscode.commands.registerCommand('json-lines-viewer.next-line', () => {
			const preview = currentPreview();
			if (preview) { navigate(preview.line + 1); }
		}),
		vscode.commands.registerCommand('json-lines-viewer.previous-line', () => {
			const preview = currentPreview();
			if (preview) { navigate(preview.line - 1); }
		}),
		vscode.commands.registerCommand('json-lines-viewer.go-to-line', async () => {
			const preview = currentPreview();
			if (!preview) { return; }
			const value = await vscode.window.showInputBox({
				prompt: 'Enter a physical line number to preview',
				value: String(Math.max(1, preview.line)),
				validateInput: input => parseLineNumber(input) === undefined ? 'Enter a positive whole line number.' : undefined
			});
			if (value !== undefined) {
				const line = parseLineNumber(value);
				if (line !== undefined && currentPreview() === preview) { navigate(line); }
			}
		}),
		vscode.commands.registerCommand('json-lines-viewer.refresh', () => {
			const preview = currentPreview();
			if (preview) {
				reader.clear(preview.source.fsPath);
				preview.totalLines = undefined;
				navigate(preview.line);
			}
		}),
		vscode.window.onDidChangeActiveTextEditor(updateStatus),
		vscode.workspace.onDidChangeTextDocument(event => {
			for (const preview of previews.values()) {
				if (preview.source.toString() === event.document.uri.toString()) {
					preview.totalLines = undefined;
					preview.revision++;
					changes.fire(preview.uri);
				}
			}
		}),
		vscode.workspace.onDidSaveTextDocument(document => {
			reader.clear(document.uri.fsPath);
			for (const preview of previews.values()) {
				if (preview.source.toString() === document.uri.toString()) {
					preview.totalLines = undefined;
					preview.revision++;
					changes.fire(preview.uri);
				}
			}
		}),
		vscode.workspace.onDidCloseTextDocument(document => {
			const preview = previews.get(document.uri.toString());
			if (preview) {
				// Changing the preview language closes and immediately reopens the same URI.
				setTimeout(() => {
					if (!vscode.workspace.textDocuments.some(item => item.uri.toString() === document.uri.toString()) &&
						previews.get(document.uri.toString()) === preview) {
						reader.clear(preview.source.fsPath);
						previews.delete(document.uri.toString());
					}
				}, 100);
			}
		})
	);
	updateStatus();
}
