import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findTitlesAlreadyInCategory, getEditResultMessage } = await import('../src/edit.js');
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
