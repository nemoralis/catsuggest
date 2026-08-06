import { describe, it, expect, vi } from 'vitest';

const { fetchFullQuery } = await import('../src/api.js');

describe('fetchFullQuery', () => {
	it('merges langlinks returned in continuation batches', async () => {
		const api = {
			get: vi
				.fn()
				.mockResolvedValueOnce({
					continue: { llcontinue: '20|az', continue: '||' },
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Category:2002 births',
								langlinks: [{ lang: 'az', '*': 'Kateqoriya:2002-ci ildə doğulanlar' }],
							},
							2: { pageid: 2, title: 'Category:2026 FIFA World Cup players' },
						},
					},
				})
				.mockResolvedValueOnce({
					query: {
						pages: {
							2: {
								pageid: 2,
								title: 'Category:2026 FIFA World Cup players',
								langlinks: [
									{ lang: 'az', '*': 'Kateqoriya:2026 FİFA Dünya Kuboku oyunçuları' },
								],
							},
						},
					},
				}),
		};

		const result = await fetchFullQuery(api, {
			action: 'query',
			generator: 'categories',
			prop: 'langlinks',
			lllang: 'az',
		});

		expect(api.get).toHaveBeenCalledTimes(2);
		expect(result.pages['2'].langlinks).toEqual([
			{ lang: 'az', '*': 'Kateqoriya:2026 FİFA Dünya Kuboku oyunçuları' },
		]);
		expect(result.pages['1'].langlinks).toEqual([
			{ lang: 'az', '*': 'Kateqoriya:2002-ci ildə doğulanlar' },
		]);
	});

	it('does not duplicate langlinks when a page reappears in a continuation batch', async () => {
		const api = {
			get: vi
				.fn()
				.mockResolvedValueOnce({
					continue: { llcontinue: '2|en', continue: '||' },
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Category:Example',
								langlinks: [{ lang: 'en', '*': 'Category:Example' }],
							},
						},
					},
				})
				.mockResolvedValueOnce({
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Category:Example',
								langlinks: [{ lang: 'en', '*': 'Category:Example' }],
							},
						},
					},
				}),
		};

		const result = await fetchFullQuery(api, {
			action: 'query',
			generator: 'categories',
			prop: 'langlinks',
		});

		expect(result.pages['1'].langlinks).toEqual([{ lang: 'en', '*': 'Category:Example' }]);
	});

	it('keeps appending categories that span multiple batches', async () => {
		const api = {
			get: vi
				.fn()
				.mockResolvedValueOnce({
					continue: { clcontinue: '1|Category:B', continue: '||' },
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Page',
								categories: [{ title: 'Category:A' }],
							},
						},
					},
				})
				.mockResolvedValueOnce({
					query: {
						pages: {
							1: {
								pageid: 1,
								title: 'Page',
								categories: [{ title: 'Category:B' }],
							},
						},
					},
				}),
		};

		const result = await fetchFullQuery(api, {
			action: 'query',
			prop: 'categories',
		});

		expect(result.pages['1'].categories.map((c) => c.title)).toEqual(['Category:A', 'Category:B']);
	});
});
