/* eslint-disable no-shadow */
import { describe, it, expect, vi, beforeEach } from 'vitest';

global.mw = {
	config: { get: () => null },
	storage: { get: () => null, set: () => {}, remove: () => {} },
	Title: class {
		constructor(t) {
			this.title = t;
		}
		getNamespaceId() {
			return this.title.startsWith('Kateqoriya:') ? 14 : 0;
		}
	},
	log: { warn: () => {}, debug: () => {} },
};

const { buildParentCatsSuggestions, buildExistingRemovals, buildMembersSuggestions } = await import(
	'../src/suggestions.js'
);

describe('buildParentCatsSuggestions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should filter out ancestors and already present categories', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('Kateqoriya:Şotlandiya filosofları')) {
				return {
					query: {
						pages: {
							1: {
								title: 'Kateqoriya:Şotlandiya filosofları',
								categories: [
									{ title: 'Kateqoriya:Britaniya filosofları' },
									{ title: 'Kateqoriya:Şotlandiya şəxsləri' },
								],
							},
							2: {
								title: 'Kateqoriya:Britaniya filosofları',
								categories: [{ title: 'Kateqoriya:Britaniya şəxsləri' }],
							},
						},
					},
				};
			}
			if (titles.includes('Kateqoriya:Britaniya filosofları')) {
				return {
					query: {
						pages: {
							3: {
								title: 'Kateqoriya:Britaniya filosofları',
								categories: [{ title: 'Kateqoriya:Britaniya şəxsləri' }],
							},
						},
					},
				};
			}
			if (titles.includes('Kateqoriya:Şotlandiya şəxsləri')) {
				return {
					query: {
						pages: {
							4: {
								title: 'Kateqoriya:Şotlandiya şəxsləri',
								categories: [{ title: 'Kateqoriya:Şotlandiya' }],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [
			{ title: 'Kateqoriya:Şotlandiya filosofları', sources: ['en'] },
			{ title: 'Kateqoriya:Britaniya filosofları', sources: ['en'] },
			{ title: 'Kateqoriya:Ateistlər', sources: ['fr'] },
		];
		const currentCats = ['Kateqoriya:Ateistlər'];
		const { suggestions } = await buildParentCatsSuggestions(rawResults, currentCats, {
			get: mockGet,
		});
		const titles = suggestions.map((s) => s.title);
		expect(titles).toContain('Kateqoriya:Şotlandiya filosofları');
		expect(titles).not.toContain('Kateqoriya:Britaniya filosofları');
		expect(titles).not.toContain('Kateqoriya:Ateistlər');
	});

	it('should filter out suggestion that is a parent of another suggestion', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('Kateqoriya:Şotlandiya filosofları')) {
				return {
					query: {
						pages: {
							1: {
								title: 'Kateqoriya:Şotlandiya filosofları',
								categories: [{ title: 'Kateqoriya:Britaniya filosofları' }],
							},
						},
					},
				};
			}
			if (titles.includes('Kateqoriya:Britaniya filosofları')) {
				return {
					query: {
						pages: {
							2: {
								title: 'Kateqoriya:Britaniya filosofları',
								categories: [],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [
			{ title: 'Kateqoriya:Şotlandiya filosofları', sources: ['en'] },
			{ title: 'Kateqoriya:Britaniya filosofları', sources: ['en'] },
		];
		const currentCats = ['Kateqoriya:Ateistlər'];
		const { suggestions } = await buildParentCatsSuggestions(rawResults, currentCats, {
			get: mockGet,
		});
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].title).toBe('Kateqoriya:Şotlandiya filosofları');
	});

	it('should attach removals for parents already on the page', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('Kateqoriya:Şotlandiya filosofları')) {
				return {
					query: {
						pages: {
							1: {
								title: 'Kateqoriya:Şotlandiya filosofları',
								categories: [{ title: 'Kateqoriya:Britaniya filosofları' }],
							},
						},
					},
				};
			}
			if (titles.includes('Kateqoriya:Britaniya filosofları')) {
				return {
					query: {
						pages: {
							2: {
								title: 'Kateqoriya:Britaniya filosofları',
								categories: [],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [
			{ title: 'Kateqoriya:Şotlandiya filosofları', sources: ['en'] },
		];
		const currentCats = ['Kateqoriya:Britaniya filosofları'];
		const { suggestions } = await buildParentCatsSuggestions(rawResults, currentCats, {
			get: mockGet,
		});
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].removals).toHaveLength(1);
		expect(suggestions[0].removals[0].title).toBe('Kateqoriya:Britaniya filosofları');
		expect(suggestions[0].removals[0].selected).toBe(false);
	});
});

describe('buildExistingRemovals', () => {
	it('should use shared parentMap and skip API calls', async () => {
		const mockGet = vi.fn();
		const parentMap = new Map();
		parentMap.set('Kateqoriya:Şotlandiya filosofları', [
			'Kateqoriya:Britaniya filosofları',
		]);
		parentMap.set('Kateqoriya:Britaniya filosofları', [
			'Kateqoriya:Britaniya şəxsləri',
		]);

		const removals = await buildExistingRemovals(
			[
				'Kateqoriya:Şotlandiya filosofları',
				'Kateqoriya:Britaniya filosofları',
			],
			{ get: mockGet },
			new Set(),
			parentMap
		);
		expect(removals).toHaveLength(1);
		expect(removals[0].title).toBe('Kateqoriya:Britaniya filosofları');
		expect(mockGet).not.toHaveBeenCalled();
	});

	it('should detect parent-child overlap among existing categories', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				pages: {
					1: {
						title: 'Kateqoriya:Şotlandiya filosofları',
						categories: [{ title: 'Kateqoriya:Britaniya filosofları' }],
					},
					2: {
						title: 'Kateqoriya:Britaniya filosofları',
						categories: [{ title: 'Kateqoriya:Britaniya şəxsləri' }],
					},
				},
			},
		}));

		const removals = await buildExistingRemovals(
			['Kateqoriya:Şotlandiya filosofları', 'Kateqoriya:Britaniya filosofları'],
			{ get: mockGet }
		);
		expect(removals).toHaveLength(1);
		expect(removals[0].title).toBe('Kateqoriya:Britaniya filosofları');
		expect(removals[0].selected).toBe(false);
		expect(removals[0].tree[0].title).toBe('Kateqoriya:Şotlandiya filosofları');
		expect(removals[0].tree[0].children).toEqual([]);
	});

	it('should detect indirect grandparent-grandchild via ancestor walk', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				pages: {
					1: {
						title: 'Kateqoriya:ABŞ-nin dram filmləri',
						categories: [
							{ title: 'Kateqoriya:Janrlarına görə ABŞ filmləri' },
						],
					},
					2: {
						title: 'Kateqoriya:Janrlarına görə ABŞ filmləri',
						categories: [{ title: 'Kateqoriya:ABŞ filmləri' }],
					},
				},
			},
		}));

		const removals = await buildExistingRemovals(
			[
				'Kateqoriya:ABŞ filmləri',
				'Kateqoriya:ABŞ-nin dram filmləri',
			],
			{ get: mockGet }
		);
		expect(removals).toHaveLength(1);
		expect(removals[0].title).toBe('Kateqoriya:ABŞ filmləri');
		expect(removals[0].tree[0].title).toBe('Kateqoriya:ABŞ-nin dram filmləri');
		expect(removals[0].tree[0].children).toEqual([]);
	});

	it('should handle categories with no overlaps', async () => {
		const mockGet = vi.fn(async () => ({
			query: { pages: {} },
		}));

		const removals = await buildExistingRemovals(
			['Kateqoriya:Ateistlər', 'Kateqoriya:Şotlandiya filosofları'],
			{ get: mockGet }
		);
		expect(removals).toHaveLength(0);
	});
});

describe('buildMembersSuggestions', () => {
	it('should filter out parent categories of the current page', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('Kateqoriya:Ekzistensial risk')) {
				return {
					query: {
						pages: {
							1: {
								title: 'Kateqoriya:Ekzistensial risk',
								categories: [],
							},
						},
					},
				};
			}
			if (titles.includes('Kateqoriya:İnsan nəslinin kəsilməsi')) {
				return {
					query: {
						pages: {
							2: {
								title: 'Kateqoriya:İnsan nəslinin kəsilməsi',
								categories: [
									{ title: 'Kateqoriya:Ekzistensial risk' },
								],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [
			{ title: 'Kateqoriya:Ekzistensial risk', sources: ['en'] },
			{ title: 'Kateqoriya:İnsan nəslinin kəsilməsi', sources: ['en'] },
		];
		const localData = {
			members: new Set(),
			subcats: new Set(),
		};
		const currentPageCats = new Set(['Kateqoriya:Ekzistensial risk']);

		const suggestions = await buildMembersSuggestions(
			rawResults,
			localData,
			{ get: mockGet },
			currentPageCats
		);
		const titles = suggestions.map((s) => s.title);
		expect(titles).not.toContain('Kateqoriya:Ekzistensial risk');
		expect(titles).toContain('Kateqoriya:İnsan nəslinin kəsilməsi');
	});
});
