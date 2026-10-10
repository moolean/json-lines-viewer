import { createReadStream, promises as fs } from 'fs';

export interface LineResult {
	text: string;
	line: number;
	totalLines?: number;
}

interface FileIndex {
	size: number;
	modified: number;
	anchors: Array<{ line: number; offset: number }>;
	totalLines?: number;
}

/** Index raw bytes lazily so CRLF and multibyte UTF-8 keep exact offsets. */
export class FileLineReader {
	private readonly indices = new Map<string, FileIndex>();
	private readonly pending = new Map<string, Promise<void>>();

	read(filePath: string, requestedLine: number): Promise<LineResult> {
		const previous = this.pending.get(filePath) || Promise.resolve();
		const result = previous.then(() => this.readIndexed(filePath, requestedLine));
		const completed = result.then(() => undefined, () => undefined);
		this.pending.set(filePath, completed);
		void completed.then(() => {
			if (this.pending.get(filePath) === completed) {
				this.pending.delete(filePath);
			}
		});
		return result;
	}

	clear(filePath: string): void {
		this.indices.delete(filePath);
	}

	private async readIndexed(filePath: string, requestedLine: number): Promise<LineResult> {
		const stats = await fs.stat(filePath);
		if (!stats.isFile()) {
			throw new Error('The selected resource is not a file.');
		}
		let index = this.indices.get(filePath);
		if (!index || index.size !== stats.size || index.modified !== stats.mtimeMs) {
			index = { size: stats.size, modified: stats.mtimeMs, anchors: [{ line: 1, offset: 0 }] };
			if (this.indices.size >= 16) {
				this.indices.delete(this.indices.keys().next().value);
			}
			this.indices.set(filePath, index);
		}
		if (stats.size === 0) {
			index.totalLines = 0;
			return { text: '', line: 0, totalLines: 0 };
		}
		let target = Math.max(1, Math.floor(requestedLine));
		if (!Number.isSafeInteger(target)) {
			throw new Error('Enter a positive whole line number.');
		}
		if (index.totalLines !== undefined) {
			target = Math.min(target, index.totalLines);
		}
		let low = 0;
		let high = index.anchors.length - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (index.anchors[middle].line <= target) {
				low = middle;
			} else {
				high = middle - 1;
			}
		}
		const anchor = index.anchors[low];
		let currentLine = anchor.line;
		let offset = anchor.offset;
		let parts: Buffer[] = [];
		let previousText = '';
		const stream = createReadStream(filePath, { start: offset, highWaterMark: 64 * 1024 });
		const closed = new Promise<void>(resolve => { stream.once('close', resolve); });
		try {
			for await (const chunk of stream) {
				const buffer = chunk as Buffer;
				let start = 0;
				let end = buffer.indexOf(10, start);
				while (end !== -1) {
					parts.push(buffer.slice(start, end));
					previousText = this.decode(parts);
					parts = [];
					const nextOffset = offset + end + 1;
					if (nextOffset === stats.size) {
						index.totalLines = currentLine;
					}
					if (currentLine === target) {
						return { text: previousText, line: currentLine, totalLines: index.totalLines };
					}
					currentLine++;
					if ((currentLine - 1) % 100 === 0 && nextOffset < stats.size &&
						currentLine > index.anchors[index.anchors.length - 1].line) {
						index.anchors.push({ line: currentLine, offset: nextOffset });
					}
					start = end + 1;
					end = buffer.indexOf(10, start);
				}
				if (start < buffer.length) {
					parts.push(buffer.slice(start));
				}
				offset += buffer.length;
			}
			if (parts.length > 0) {
				previousText = this.decode(parts);
			} else {
				currentLine--;
			}
			index.totalLines = currentLine;
			return { text: previousText, line: currentLine, totalLines: currentLine };
		} finally {
			stream.destroy();
			await closed;
		}
	}

	private decode(parts: Buffer[]): string {
		return Buffer.concat(parts).toString('utf8').replace(/\r$/, '');
	}
}

export function formatLine(result: LineResult): string {
	if (result.line === 0) {
		return '// This JSON Lines file is empty.';
	}
	const text = result.text.replace(/^\uFEFF/, '');
	if (text.trim() === '') {
		return `// Line ${result.line} is blank. Use Next Line to continue.`;
	}
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `// Invalid JSON at line ${result.line}: ${message.replace(/[\r\n]+/g, ' ')}\n${text}`;
	}
}

export function parseLineNumber(value: string): number | undefined {
	if (!/^[1-9]\d*$/.test(value.trim())) {
		return undefined;
	}
	const number = Number(value.trim());
	return Number.isSafeInteger(number) ? number : undefined;
}
