import { describe, it, expect, vi, afterEach } from 'vitest';

// constants.js doesn't depend on mw globals, so no setup needed
const {
	escapeRegex,
	debounce,
	generateBatchId,
	REMOVAL_EXCLUDED_KEYWORDS,
	isSameCategoryIgnoringPlural,
} = await import('../src/constants.js');

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

describe('REMOVAL_EXCLUDED_KEYWORDS', () => {
	it('should load keywords from config', () => {
		expect(REMOVAL_EXCLUDED_KEYWORDS).toContain('ilin filmləri');
	});

	it('should match year-based category titles by keyword', () => {
		const isExcluded = (title) => REMOVAL_EXCLUDED_KEYWORDS.some((kw) => title.includes(kw));
		expect(isExcluded('Kateqoriya:2004-cü ilin filmləri')).toBe(true);
		expect(isExcluded('Kateqoriya:2023-cü ilin filmləri')).toBe(true);
		expect(isExcluded('Kateqoriya:ABŞ filmləri')).toBe(false);
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

describe('isSameCategoryIgnoringPlural', () => {
	it('should treat identical titles as equal', () => {
		expect(isSameCategoryIgnoringPlural('Kateqoriya:Oyuncaq', 'Kateqoriya:Oyuncaq')).toBe(true);
	});

	it('should treat singular and plural forms as equal', () => {
		expect(isSameCategoryIgnoringPlural('Kateqoriya:Oyuncaq', 'Kateqoriya:Oyuncaqlar')).toBe(
			true
		);
		expect(isSameCategoryIgnoringPlural('Kateqoriya:Oyuncaqlar', 'Kateqoriya:Oyuncaq')).toBe(
			true
		);
		expect(isSameCategoryIgnoringPlural('Kateqoriya:Mühəndis', 'Kateqoriya:Mühəndislər')).toBe(
			true
		);
	});

	it('should return false for unrelated titles', () => {
		expect(isSameCategoryIgnoringPlural('Kateqoriya:Oyuncaq', 'Kateqoriya:Filosoflar')).toBe(
			false
		);
		expect(isSameCategoryIgnoringPlural('Kateqoriya:Oyuncaqlar', 'Kateqoriya:Oyuncular')).toBe(
			false
		);
	});
});
