import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

suite('JSON Lines preview commands', function () {
	this.timeout(15000);
	let directory: string;
	setup(async () => {
		await vscode.extensions.getExtension('lehoanganh298.json-lines-viewer')?.activate();
		const root = path.resolve(__dirname, '../../../.vscode-test/fixtures');
		await fs.mkdir(root, { recursive: true });
		directory = await fs.mkdtemp(path.join(root, 'extension-'));
	});
	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		const root = path.resolve(__dirname, '../../../.vscode-test/fixtures');
		assert.ok(directory.startsWith(root + path.sep));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
	});

	async function source(content: string, name = '中文 # 100% (preview).jsonl'): Promise<vscode.TextDocument> {
		const file = path.join(directory, name);
		await fs.writeFile(file, content, 'utf8');
		return vscode.workspace.openTextDocument(vscode.Uri.file(file));
	}

	function preview(): vscode.TextEditor {
		const editor = vscode.window.activeTextEditor;
		assert.ok(editor);
		assert.strictEqual(editor.document.uri.scheme, 'jsonl');
		return editor;
	}

	async function waitForContent(predicate: (text: string) => boolean): Promise<void> {
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			if (predicate(preview().document.getText())) { return; }
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		assert.fail(`Preview did not update: ${preview().document.getText()}`);
	}

	test('offers open JSON Lines files when the active editor is unrelated', async () => {
		await source('{"picked":true}', 'pick-me.jsonl');
		const unrelated = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'unrelated' });
		await vscode.window.showTextDocument(unrelated);
		const opened = vscode.commands.executeCommand('json-lines-viewer.preview');
		await new Promise(resolve => setTimeout(resolve, 200));
		await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		await opened;
		assert.strictEqual(JSON.parse(preview().document.getText()).picked, true);
		await vscode.window.showTextDocument(unrelated);
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	test('recognizes .jsonl even when its language is JSON and starts at the cursor', async () => {
		const document = await vscode.languages.setTextDocumentLanguage(await source('{"line":1}\r\n{"line":2}\r\n'), 'json');
		const editor = await vscode.window.showTextDocument(document);
		editor.selection = new vscode.Selection(1, 0, 1, 0);
		await vscode.commands.executeCommand('json-lines-viewer.preview');
		assert.strictEqual(JSON.parse(preview().document.getText()).line, 2);
	});

	test('repeated preview command reuses the preview and navigation still works', async () => {
		await vscode.commands.executeCommand('json-lines-viewer.preview', (await source('{"line":1}\n{"line":2}')).uri);
		const uri = preview().document.uri.toString();
		await new Promise(resolve => setTimeout(resolve, 150));
		await vscode.commands.executeCommand('json-lines-viewer.preview');
		assert.strictEqual(preview().document.uri.toString(), uri);
		await vscode.commands.executeCommand('json-lines-viewer.next-line');
		await waitForContent(text => text.includes('"line": 2'));
		await vscode.commands.executeCommand('json-lines-viewer.previous-line');
		await waitForContent(text => text.includes('"line": 1'));
	});

	test('recognizes uppercase .NDJSON with Plain Text mode', async () => {
		const document = await vscode.languages.setTextDocumentLanguage(await source('{"ok":true}', 'sample.NDJSON'), 'plaintext');
		await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('json-lines-viewer.preview');
		assert.strictEqual(JSON.parse(preview().document.getText()).ok, true);
	});

	test('invalid and blank lines keep navigation available', async () => {
		await vscode.commands.executeCommand('json-lines-viewer.preview', (await source('{bad}\n\n{"ok":true}')).uri);
		assert.match(preview().document.getText(), /Invalid JSON at line 1/);
		await vscode.commands.executeCommand('json-lines-viewer.next-line');
		await waitForContent(text => text.includes('Line 2 is blank'));
		await vscode.commands.executeCommand('json-lines-viewer.next-line');
		await waitForContent(text => text.includes('"ok": true'));
	});

	test('supports untitled buffers and automatically previews unsaved edits', async () => {
		const document = await vscode.workspace.openTextDocument({ language: 'jsonl', content: '{"value":1}' });
		const editor = await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('json-lines-viewer.preview');
		assert.strictEqual(JSON.parse(preview().document.getText()).value, 1);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, 0, document.lineAt(0).text.length), '{"value":2}');
		await vscode.workspace.applyEdit(edit);
		await waitForContent(text => text.includes('"value": 2'));
		await vscode.window.showTextDocument(editor.document);
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	test('previews dirty local files instead of the saved disk content', async () => {
		const document = await source('{"saved":true}');
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, 0, document.lineAt(0).text.length), '{"unsaved":true}');
		await vscode.workspace.applyEdit(edit);
		await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('json-lines-viewer.preview');
		assert.strictEqual(JSON.parse(preview().document.getText()).unsaved, true);
		assert.strictEqual(await fs.readFile(document.uri.fsPath, 'utf8'), '{"saved":true}');
		await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	test('refresh detects an externally appended line', async () => {
		const document = await source('{"line":1}\n');
		await vscode.commands.executeCommand('json-lines-viewer.preview', document.uri);
		await fs.appendFile(document.uri.fsPath, '{"line":2}\n');
		await vscode.commands.executeCommand('json-lines-viewer.refresh');
		await vscode.commands.executeCommand('json-lines-viewer.next-line');
		await waitForContent(text => text.includes('"line": 2'));
	});

	test('preserves remote provider authority and encoded path characters', async () => {
		const uri = vscode.Uri.from({ scheme: 'jsonl-test-remote', authority: 'test-host', path: '/中文 # 100%?.jsonl' });
		const provider = vscode.workspace.registerTextDocumentContentProvider(uri.scheme, {
			provideTextDocumentContent(request) {
				assert.strictEqual(request.toString(), uri.toString());
				return '{"remote":true}';
			}
		});
		try {
			await vscode.commands.executeCommand('json-lines-viewer.preview', uri);
			assert.strictEqual(JSON.parse(preview().document.getText()).remote, true);
		} finally { provider.dispose(); }
	});

	test('reports inaccessible files in the preview and recovers on refresh', async () => {
		const uri = vscode.Uri.file(path.join(directory, 'missing.jsonl'));
		await vscode.commands.executeCommand('json-lines-viewer.preview', uri);
		assert.match(preview().document.getText(), /Cannot read the source file/);
		await fs.writeFile(uri.fsPath, '{"recovered":true}');
		await vscode.commands.executeCommand('json-lines-viewer.refresh');
		await waitForContent(text => text.includes('"recovered": true'));
	});

	test('empty files show a readable hint', async () => {
		await vscode.commands.executeCommand('json-lines-viewer.preview', (await source('')).uri);
		assert.match(preview().document.getText(), /empty/);
	});
});
