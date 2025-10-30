// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {createReadStream, open, stat} from 'fs';
import {createInterface} from 'readline';
import { url } from 'inspector';
import { promisify } from 'util';


const jsonlScheme = 'jsonl';
let lineIndexDict = Object();	// Store current line index of previewed json files
let lineIdxStatusBarItem: vscode.StatusBarItem;

// Cache for storing line positions (byte offsets) in files
// Structure: { filePath: { lineNumber: byteOffset, totalLines: count } }
let linePositionCache: { [filePath: string]: { positions: { [lineNum: number]: number }, totalLines: number, lastModified: number } } = {};

const openAsync = promisify(open);
const statAsync = promisify(stat);


// A custom content provider for jsonl file
class JsonlContentProvider implements vscode.TextDocumentContentProvider {

	onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	onDidChange = this.onDidChangeEmitter.event;

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		let lineIdx = lineIndexDict[uri.path];
		if (lineIdx === undefined) {
			lineIdx=1;
			lineIndexDict[uri.path]=lineIdx;
		}
		const res = await readFileAtLine(uri,lineIdx);
		lineIndexDict[uri.path] = res[1]; // handle when line index invalid
		updateLineIdxStatusBarItem();
		
		const lineFormated = JSON.stringify(JSON.parse(res[0]), null, 2);
		return lineFormated;
	}
};


const jsonlProvider = new JsonlContentProvider();


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(jsonlScheme, jsonlProvider));

	context.subscriptions.push(vscode.commands.registerCommand('json-lines-viewer.preview', openPreviewHandler));
	context.subscriptions.push(vscode.commands.registerCommand('json-lines-viewer.next-line', nextLineHandler));
	context.subscriptions.push(vscode.commands.registerCommand('json-lines-viewer.previous-line', previousLineHandler));
	context.subscriptions.push(vscode.commands.registerCommand('json-lines-viewer.go-to-line',goToLine));

	lineIdxStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100000);
	context.subscriptions.push(lineIdxStatusBarItem);
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateLineIdxStatusBarItem));
	updateLineIdxStatusBarItem();
}

// Build line position cache for a file
// This creates an index of byte positions for efficient seeking
// For very large files, we sample positions to reduce memory usage
async function buildLinePositionCache(filePath: string): Promise<void> {
	const stats = await statAsync(filePath);
	const fileSize = stats.size;
	const lastModified = stats.mtimeMs;
	
	// Check if cache exists and is still valid
	const cachedData = linePositionCache[filePath];
	if (cachedData && cachedData.lastModified === lastModified) {
		return; // Cache is valid
	}
	
	// Initialize cache for this file
	const positions: { [lineNum: number]: number } = {};
	let lineNum = 0;
	let byteOffset = 0;
	
	const fileStream = createReadStream(filePath);
	const rl = createInterface({
		input: fileStream,
		crlfDelay: Infinity
	});
	
	// For large files (>10MB), sample every 100th line to reduce memory usage
	// For smaller files, cache every line position
	const sampleRate = fileSize > 10 * 1024 * 1024 ? 100 : 1;
	
	for await (const line of rl) {
		lineNum++;
		
		// Store position for this line if it's a sample point or first line
		if (lineNum === 1 || lineNum % sampleRate === 0) {
			positions[lineNum] = byteOffset;
		}
		
		// Update byte offset (line length + newline character(s))
		byteOffset += Buffer.byteLength(line, 'utf8') + 1; // +1 for \n
	}
	
	// Store the cache
	linePositionCache[filePath] = {
		positions: positions,
		totalLines: lineNum,
		lastModified: lastModified
	};
}

// Read a file content at specified line index using cached positions
// If line index <=0, return first line
// If line index exceed file's line count, return last line
// Input: 	- file's uri
// 			- line index
// Output: 	- line's content
// 			- returned line index
async function readFileAtLine(uri: vscode.Uri, lineIdx: number): Promise<[string,number]> {
	if (lineIdx<=0) {
		lineIdx = 1;
	}

	const filePath = uri.path.replace('(preview)','').trimEnd();
	
	// Build or update cache if needed
	await buildLinePositionCache(filePath);
	
	const cachedData = linePositionCache[filePath];
	if (!cachedData) {
		// Fallback to old method if cache building failed
		return readFileAtLineOld(filePath, lineIdx);
	}
	
	// Adjust lineIdx if it exceeds total lines
	if (lineIdx > cachedData.totalLines) {
		lineIdx = cachedData.totalLines;
	}
	
	// Find the closest cached position before or at the target line
	let startPosition = 0;
	let startLine = 1;
	
	const cachedPositions = cachedData.positions;
	for (const [cachedLineStr, position] of Object.entries(cachedPositions)) {
		const cachedLine = parseInt(cachedLineStr);
		if (cachedLine <= lineIdx && cachedLine >= startLine) {
			startLine = cachedLine;
			startPosition = position;
		}
	}
	
	// If we have an exact match in cache, start from there
	// Otherwise, start from the closest position and read forward
	const fileStream = createReadStream(filePath, { start: startPosition });
	const rl = createInterface({
		input: fileStream,
		crlfDelay: Infinity
	});
	
	let currentLine = startLine;
	let line = '';
	
	for await (line of rl) {
		if (currentLine === lineIdx) {
			rl.close();
			fileStream.destroy();
			return [line, currentLine];
		}
		currentLine++;
	}
	
	// Return last line if we've read to the end
	return [line, currentLine - 1];
}

// Fallback method: old implementation for reading file line by line
async function readFileAtLineOld(filePath: string, lineIdx: number): Promise<[string,number]> {
	const fileStream = createReadStream(filePath);
  
	const rl = createInterface({
	  input: fileStream,
	  crlfDelay: Infinity
	});
  
	let idx = 0;
	let line='';
	for await (line of rl) {
		idx+=1;
		if (idx === lineIdx) {
			rl.close();
			fileStream.destroy();
			return [line, idx];
		}
  	}
	return [line, idx];
}


const openPreviewHandler = async (arg: any) => {
	let uri = arg;
	if (!(uri instanceof vscode.Uri)) {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor && activeEditor.document.languageId === 'jsonl') {
			uri = activeEditor.document.uri;
		} else {
			vscode.window.showInformationMessage("Open a JSON Lines file (.jsonl) first to show a preview.");
			return;
		}
	}
	
	// Change uri-scheme to "jsonl"
	let uriPath = "";
	if (uri._fsPath !== undefined && uri._fsPath !== null) {
		uriPath = uri._fsPath;
	}
	else {
		uriPath = uri.path;
	}
	const jsonlUri = vscode.Uri.parse('jsonl:' + uriPath + ' (preview)');
	
	const document = await vscode.workspace.openTextDocument(jsonlUri);
	await vscode.window.showTextDocument(document);
	
	await vscode.languages.setTextDocumentLanguage(document, "json");
};


const nextLineHandler = async () => {
	if (!vscode.window.activeTextEditor) {
		return; // no editor
	}
	const { document } = vscode.window.activeTextEditor;
	if (document.uri.scheme !== jsonlScheme) {
		return; // not my scheme
	}
	lineIndexDict[document.uri.path]+=1;
	jsonlProvider.onDidChangeEmitter.fire(document.uri);
};


const previousLineHandler = async () => {
	if (!vscode.window.activeTextEditor) {
		return; // no editor
	}
	const { document } = vscode.window.activeTextEditor;
	if (document.uri.scheme !== jsonlScheme) {
		return; // not my scheme
	}
	lineIndexDict[document.uri.path]-=1;

	jsonlProvider.onDidChangeEmitter.fire(document.uri);
};


const goToLine = async () => {
	if (!vscode.window.activeTextEditor) {
		return; // no editor
	}
	const { document } = vscode.window.activeTextEditor;
	if (document.uri.scheme !== jsonlScheme) {
		return; // not my scheme
	}

	let lineIdx = null;
	while (lineIdx === null || isNaN(lineIdx)){
		let lineIdxStr = await vscode.window.showInputBox(
			{ prompt: 'Type a line number to preview Json object at that line.' });
		if (lineIdxStr === undefined) {
			break;
		}

		lineIdx = parseInt(lineIdxStr);
	}
	if (lineIdx !== null){
		lineIndexDict[document.uri.path] = lineIdx;
		jsonlProvider.onDidChangeEmitter.fire(document.uri);
	}
};


function updateLineIdxStatusBarItem(): void {
	if (!vscode.window.activeTextEditor) {
		lineIdxStatusBarItem.hide(); // no editor
		return;
	}
	const { document } = vscode.window.activeTextEditor;
	if (document.uri.scheme !== jsonlScheme) {
		lineIdxStatusBarItem.hide();
		return; 
	}
	lineIdxStatusBarItem.text = `JSONL at line: ${lineIndexDict[document.uri.path]}`;
	lineIdxStatusBarItem.show();
}


// this method is called when your extension is deactivated
export function deactivate() {}
