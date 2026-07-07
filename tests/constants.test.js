import { describe, it, expect, vi, afterEach } from 'vitest';

// constants.js doesn't depend on mw globals, so no setup needed
const { escapeRegex, debounce, generateBatchId } = await import(
	'../src/constants.js'
);

describe('escapeRegex', () => {
	it('should escape special regex characters', () => {
		expect(escapeRegex('.')).toBe('\\.');
		expect(escapeRegex('*')).toBe('\\*');
		expect(escapeRegex('+')).toBe('\\+');
		expect(escapeRegex('?')).toBe('\\?');
		expect(escapeRegex('^')).toBe('\\^');
		expect(escapeRegex('$')).toBe('\\$');
		expect(escapeRegex('{')).toBe('\\{');
		expect(escapeRegex('}')).toBe('\\}');
		expect(escapeRegex('(')).toBe('\\(');
		expect(escapeRegex(')')).toBe('\\)');
		expect(escapeRegex('|')).toBe('\\|');
		expect(escapeRegex('[')).toBe('\\[');
		expect(escapeRegex(']')).toBe('\\]');
		expect(escapeRegex('\\')).toBe('\\\\');
	});

	it('should handle strings with multiple special characters', () => {
		expect(escapeRegex('hello.world+test*')).toBe('hello\\.world\\+test\\*');
	});

	it('should return plain strings unchanged', () => {
		expect(escapeRegex('Kateqoriya:Filosoflar')).toBe('Kateqoriya:Filosoflar');
		expect(escapeRegex('12345')).toBe('12345');
		expect(escapeRegex('')).toBe('');
	});
});

describe('debounce', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('should delay function execution', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(50);
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(50);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should only call the last invocation', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced('first');
		debounced('second');
		debounced('third');

		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith('third');
	});

	it('should reset timer on repeated calls', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		vi.advanceTimersByTime(90);
		debounced(); // reset timer
		vi.advanceTimersByTime(90);
		expect(fn).not.toHaveBeenCalled(); // timer was reset

		vi.advanceTimersByTime(10);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should maintain "this" context', () => {
		vi.useFakeTimers();
		const received = [];
		function fn() {
			received.push(this);
		}
		const obj = {};
		const debounced = debounce(fn, 100);

		debounced.call(obj);
		vi.advanceTimersByTime(100);
		expect(received[0]).toBe(obj);
	});
});

describe('generateBatchId', () => {
	it('should return a 16-character hex string', () => {
		const id = generateBatchId();
		expect(id).toMatch(/^[0-9a-f]{16}$/);
	});

	it('should return different values on each call', () => {
		const id1 = generateBatchId();
		const id2 = generateBatchId();
		expect(id1).not.toBe(id2);
	});
});
