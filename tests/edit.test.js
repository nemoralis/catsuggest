import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	addParentCategoriesEdit,
	findTitlesAlreadyInCategory,
	formatCategoryLink,
	getEditResultMessage,
	sanitizeSortKey,
} = await import('../src/edit.js');
const { resetApiBatchSizeCache } = await import('../src/api.js');

describe('getEditResultMessage', () => {
	it('reports an add-only edit', () => {
		expect(getEditResultMessage({ addedCount: 2, removedCount: 0 })).toBe(
			'Kateqoriyalar uğurla əlavə edildi!'
		);
	});

	it('reports a remove-only edit', () => {
		expect(getEditResultMessage({ addedCount: 0, removedCount: 1 })).toBe(
			'Kateqoriyalar uğurla silindi!'
		);
	});

	it('reports a mixed edit', () => {
		expect(getEditResultMessage({ addedCount: 1, removedCount: 2 })).toBe(
			'Kateqoriyalar uğurla redaktə edildi!'
		);
	});

	it('reports an aborted edit', () => {
		expect(getEditResultMessage({ addedCount: 1, removedCount: 0, aborted: true })).toBe(
			'Redaktə dayandırıldı.'
		);
	});

	it('uses a neutral fallback when no actions are recorded', () => {
		expect(getEditResultMessage({})).toBe('Dəyişikliklər uğurla tətbiq edildi!');
	});
});

describe('sanitizeSortKey', () => {
	it('trims surrounding whitespace', () => {
		expect(sanitizeSortKey('  Ağaca görə  ')).toBe('Ağaca görə');
	});

	it('removes characters that would break a category wikilink', () => {
		expect(sanitizeSortKey('A|B]]C\nD[E\rF')).toBe('ABCDEF');
	});

	it('returns an empty string for missing or non-string values', () => {
		expect(sanitizeSortKey()).toBe('');
		expect(sanitizeSortKey(null)).toBe('');
		expect(sanitizeSortKey(42)).toBe('');
	});
});

describe('formatCategoryLink', () => {
	it('builds a plain link without a sort key', () => {
		expect(formatCategoryLink({ title: 'Kateqoriya:Foo Bar' })).toBe(
			'[[Kateqoriya:Foo Bar]]'
		);
	});

	it('appends the sort key after the title', () => {
		expect(formatCategoryLink({ title: 'Kateqoriya:Foo_Bar', sortKey: 'Z' })).toBe(
			'[[Kateqoriya:Foo Bar|Z]]'
		);
	});

	it('sanitizes the sort key', () => {
		expect(formatCategoryLink({ title: 'Kateqoriya:Foo', sortKey: ' A|B]] ' })).toBe(
			'[[Kateqoriya:Foo|AB]]'
		);
	});
});

describe('addParentCategoriesEdit', () => {
	function createApi(captured, content = '') {
		return {
			get: vi.fn(async () => ({
				query: { pages: { 1: { revisions: [{ '*': content }] } } },
			})),
			postWithEditToken: vi.fn(async (params) => {
				captured.push(params);
				return {};
			}),
		};
	}

	it('appends category links with the supplied sort keys', async () => {
		const captured = [];
		const api = createApi(captured);

		await addParentCategoriesEdit(
			api,
			'Page A',
			[
				{ title: 'Kateqoriya:Foo', sortKey: 'Z' },
				{ title: 'Kateqoriya:Bar', sortKey: '' },
			],
			[],
			vi.fn()
		);

		expect(captured[0].appendtext).toBe('\n[[Kateqoriya:Foo|Z]]\n[[Kateqoriya:Bar]]');
		expect(captured[0].summary).toBe('[[VP:Q/KT|Kateqoriya təklifçisi]] vasitəsilə +2 kateqoriya');
		expect(captured[0].minor).toBe(false);
	});

	it('uses the full wikitext path when removals are present', async () => {
		const captured = [];
		const api = createApi(captured, '[[Kateqoriya:Old|key]]\ntext');

		await addParentCategoriesEdit(
			api,
			'Page A',
			[{ title: 'Kateqoriya:Foo', sortKey: 'Z' }],
			['Kateqoriya:Old'],
			(s) => s
		);

		expect(captured[0].text).toBe('text\n[[Kateqoriya:Foo|Z]]');
		expect(captured[0].appendtext).toBeUndefined();
		expect(captured[0].summary).toBe(
			'[[VP:Q/KT|Kateqoriya təklifçisi]] vasitəsilə +1 kateqoriya, −1 kateqoriya'
		);
	});
});

describe('findTitlesAlreadyInCategory', () => {
	beforeEach(() => {
		resetApiBatchSizeCache();
	});

	it('detects pages that already contain the category', async () => {
		const api = {
			get: vi.fn(async (params) => {
				if (params.meta === 'userinfo') {
					return { query: { userinfo: { rights: ['apihighlimits'] } } };
				}
				return {
					query: {
						pages: {
							1: {
								title: 'Page A',
								categories: [{ title: 'Kateqoriya:Target' }],
							},
							2: {
								title: 'Page B',
							},
						},
					},
				};
			}),
		};

		const result = await findTitlesAlreadyInCategory(
			api,
			['Page A', 'Page B'],
			'Kateqoriya:Target'
		);

		expect([...result]).toEqual(['Page A']);
		expect(api.get).toHaveBeenCalledWith(
			expect.objectContaining({
				prop: 'categories',
				clcategories: 'Kateqoriya:Target',
			})
		);
	});

	it('maps normalized and redirected titles back to the original suggestion', async () => {
		const api = {
			get: vi.fn(async (params) => {
				if (params.meta === 'userinfo') {
					return { query: { userinfo: { rights: ['apihighlimits'] } } };
				}
				return {
					query: {
						normalized: [{ from: 'Page_A', to: 'Page A' }],
						redirects: [{ from: 'Old name', to: 'Page A' }],
						pages: {
							1: {
								title: 'Page A',
								categories: [{ title: 'Kateqoriya:Target' }],
							},
						},
					},
				};
			}),
		};

		const result = await findTitlesAlreadyInCategory(
			api,
			['Page_A', 'Old_name'],
			'Kateqoriya:Target'
		);

		expect([...result]).toEqual(['Page_A', 'Old_name']);
	});

	it('does not query the API when there are no titles', async () => {
		const api = { get: vi.fn() };

		const result = await findTitlesAlreadyInCategory(api, [], 'Kateqoriya:Target');

		expect(result.size).toBe(0);
		expect(api.get).not.toHaveBeenCalled();
	});
});
