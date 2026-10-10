import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import { FileLineReader, formatLine, parseLineNumber } from '../../lineReader';

suite('Indexed JSON Lines reader', () => {
	let directory: string;
	let reader: FileLineReader;
	setup(async () => {
		const root = path.resolve(__dirname, '../../../.vscode-test/fixtures');
		await fs.mkdir(root, { recursive: true });
		directory = await fs.mkdtemp(path.join(root, 'reader-'));
		reader = new FileLineReader();
	});
	teardown(async () => {
		const root = path.resolve(__dirname, '../../../.vscode-test/fixtures');
		assert.ok(directory.startsWith(root + path.sep));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
	});

	async function fixture(content: string): Promise<string> {
		const file = path.join(directory, '中文 # 100% (preview).jsonl');
		await fs.writeFile(file, content, 'utf8');
		return file;
	}

	for (const newline of ['\n', '\r\n']) {
		for (const finalNewline of [false, true]) {
			test(`random access with ${JSON.stringify(newline)}, final newline ${finalNewline}`, async () => {
				const records = Array.from({ length: 350 }, (_, number) => JSON.stringify({ number, text: '中文🙂' }));
				const file = await fixture(records.join(newline) + (finalNewline ? newline : ''));
				for (const line of [250, 101, 1, 350, 349, 10000, 201, 99]) {
					const selected = Math.min(line, records.length);
					const result = await reader.read(file, line);
					assert.strictEqual(result.line, selected);
					assert.strictEqual(result.text, records[selected - 1]);
				}
			});
		}
	}

	test('cached random access across many stream chunks', async () => {
		const records = Array.from({ length: 10000 }, (_, number) =>
			JSON.stringify({ number, text: '中文🙂'.repeat(number % 30 + 1) }));
		const file = await fixture(records.join('\r\n'));
		for (const line of [9001, 4501, 10000, 2001, 99999]) {
			const selected = Math.min(line, records.length);
			assert.strictEqual((await reader.read(file, line)).text, records[selected - 1]);
		}
	});

	test('UTF-8 record spanning multiple 64KB chunks', async () => {
		const record = JSON.stringify({ text: '中文🙂'.repeat(30000) });
		const file = await fixture(`${record}\r\n{"second":true}`);
		assert.strictEqual((await reader.read(file, 1)).text, record);
		assert.strictEqual((await reader.read(file, 2)).text, '{"second":true}');
	});

	test('preserves internal blank lines and trailing blank record', async () => {
		const file = await fixture('{"first":1}\r\n\r\n{"third":3}\r\n\r\n');
		assert.strictEqual((await reader.read(file, 2)).text, '');
		const result = await reader.read(file, 100);
		assert.strictEqual(result.line, 4);
		assert.strictEqual(result.totalLines, 4);
		assert.strictEqual(result.text, '');
	});

	test('handles empty file and clamps before the first line', async () => {
		const file = await fixture('');
		assert.deepStrictEqual(await reader.read(file, 1), { text: '', line: 0, totalLines: 0 });
		await fs.writeFile(file, '{"first":1}\n');
		assert.strictEqual((await reader.read(file, -10)).line, 1);
	});

	test('invalidates cached positions after append and replacement', async () => {
		const file = await fixture('{"first":1}\n');
		await reader.read(file, 100);
		await fs.appendFile(file, '{"second":2}\r\n');
		assert.strictEqual((await reader.read(file, 2)).text, '{"second":2}');
		await fs.writeFile(file, '{"replacement":true}');
		assert.strictEqual((await reader.read(file, 2)).text, '{"replacement":true}');
	});

	test('concurrent jumps keep the cache coherent', async () => {
		const records = Array.from({ length: 500 }, (_, number) => String(number));
		const file = await fixture(records.join('\n'));
		const lines = [401, 201, 499, 1, 301];
		const results = await Promise.all(lines.map(line => reader.read(file, line)));
		results.forEach((result, index) => assert.strictEqual(result.text, records[lines[index] - 1]));
	});

	test('recovers after file read error', async () => {
		const file = path.join(directory, 'missing.jsonl');
		await assert.rejects(reader.read(file, 1));
		await fs.writeFile(file, '{"ok":true}');
		assert.strictEqual((await reader.read(file, 1)).text, '{"ok":true}');
	});

	test('formats BOM, primitives, blank and invalid records without throwing', () => {
		assert.strictEqual(formatLine({ text: '\uFEFF{"ok":true}', line: 1 }), '{\n  "ok": true\n}');
		assert.strictEqual(formatLine({ text: 'null', line: 2 }), 'null');
		assert.match(formatLine({ text: '', line: 0 }), /empty/);
		assert.match(formatLine({ text: ' ', line: 3 }), /Line 3 is blank/);
		assert.match(formatLine({ text: '{invalid}', line: 4 }), /Invalid JSON at line 4/);
	});

	test('line numbers reject partial, decimal, negative and unsafe values', () => {
		for (const value of ['', '0', '-1', '2abc', '1.5', '1e3', '9007199254740992']) {
			assert.strictEqual(parseLineNumber(value), undefined, value);
		}
		assert.strictEqual(parseLineNumber(' 123 '), 123);
	});
});
