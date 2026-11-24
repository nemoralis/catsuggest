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
			if (this.title.startsWith('Kateqoriya:')) {
				return 14;
			}
			return this.title.startsWith('Şablon:') ? 10 : 0;
		}
	},
	log: { warn: () => {}, debug: () => {} },
};

const {
	walkAncestors,
	buildParentCatsSuggestions,
	buildExistingRemovals,
	buildMembersSuggestions,
	fetchMembersSuggestions,
	fetchParentCatsSuggestions,
	detectTemplateAddedCategories,
} = await import('../src/suggestions.js');
const { MAX_ANCESTOR_NODES_PER_LEVEL } = await import('../src/constants.js');

describe('walkAncestors', () => {
	const silent = { logger: () => {} };

	it('keeps walking through nodes that were prefetched into parentMap', async () => {
		const parentMap = new Map([
			['Kateqoriya:Current', ['Kateqoriya:Prefetched']],
			['Kateqoriya:Prefetched', ['Kateqoriya:Grand']],
			['Kateqoriya:Grand', []],
		]);

		const result = await walkAncestors(['Kateqoriya:Current'], parentMap, {
			fetchParents: async () => {},
			...silent,
		});

		expect(Array.from(result.ancestors).sort()).toEqual([
			'Kateqoriya:Grand',
			'Kateqoriya:Prefetched',
		]);
		expect(result.traversed.has('Kateqoriya:Prefetched')).toBe(true);
		expect(result.traversed.has('Kateqoriya:Grand')).toBe(true);
		expect(result.depth).toBe(2);
	});

	it('stops at maxDepth', async () => {
		const parentMap = new Map([
			['Kateqoriya:A', ['Kateqoriya:B']],
			['Kateqoriya:B', ['Kateqoriya:C']],
			['Kateqoriya:C', ['Kateqoriya:D']],
			['Kateqoriya:D', []],
		]);

		const result = await walkAncestors(['Kateqoriya:A'], parentMap, {
			maxDepth: 2,
			fetchParents: async () => {},
			...silent,
		});

		expect(Array.from(result.ancestors).sort()).toEqual(['Kateqoriya:B', 'Kateqoriya:C']);
		expect(result.ancestors.has('Kateqoriya:D')).toBe(false);
		expect(result.depth).toBe(2);
	});

	it('caps how many nodes are traversed per level', async () => {
		const parentMap = new Map([
			['Kateqoriya:A', ['Kateqoriya:P0', 'Kateqoriya:P1', 'Kateqoriya:P2']],
			['Kateqoriya:P0', []],
			['Kateqoriya:P1', []],
			['Kateqoriya:P2', []],
		]);

		const result = await walkAncestors(['Kateqoriya:A'], parentMap, {
			maxNodesPerLevel: 2,
			fetchParents: async () => {},
			...silent,
		});

		// All parents are ancestors, but only the first two are traversed.
		expect(result.ancestors.has('Kateqoriya:P2')).toBe(true);
		expect(result.traversed.has('Kateqoriya:P2')).toBe(false);
		expect(result.traversed.has('Kateqoriya:P0')).toBe(true);
		expect(result.traversed.has('Kateqoriya:P1')).toBe(true);
		expect(result.truncated).toBe(true);
	});

	it('ignores a self-parent edge', async () => {
		const parentMap = new Map([['Kateqoriya:A', ['Kateqoriya:A']]]);

		const result = await walkAncestors(['Kateqoriya:A'], parentMap, {
			fetchParents: async () => {},
			...silent,
		});

		expect(result.ancestors.size).toBe(0);
		expect(result.traversed.has('Kateqoriya:A')).toBe(true);
	});

	it('terminates on a category-graph cycle', async () => {
		const parentMap = new Map([
			['Kateqoriya:A', ['Kateqoriya:B']],
			['Kateqoriya:B', ['Kateqoriya:A']],
		]);

		const result = await walkAncestors(['Kateqoriya:A'], parentMap, {
			fetchParents: async () => {},
			...silent,
		});

		expect(result.ancestors.has('Kateqoriya:B')).toBe(true);
		expect(result.traversed.has('Kateqoriya:A')).toBe(true);
		expect(result.traversed.has('Kateqoriya:B')).toBe(true);
	});
});

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
		expect(suggestions.every((s) => s.selected)).toBe(true);
		expect(suggestions.every((s) => s.sortKey === '')).toBe(true);
	});

	it('should drop a redirect candidate whose target is already a current category', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('Kateqoriya:Britaniya filosofları (redir)')) {
				return {
					query: {
						redirects: [
							{
								from: 'Kateqoriya:Britaniya filosofları (redir)',
								to: 'Kateqoriya:Britaniya filosofları',
							},
						],
						pages: {
							10: {
								title: 'Kateqoriya:Britaniya filosofları',
								categories: [{ title: 'Kateqoriya:Britaniya şəxsləri' }],
							},
						},
					},
				};
			}
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
			return { query: { pages: {} } };
		});

		const rawResults = [
			{ title: 'Kateqoriya:Britaniya filosofları (redir)', sources: ['en'] },
			{ title: 'Kateqoriya:Şotlandiya filosofları', sources: ['en'] },
		];
		const currentCats = ['Kateqoriya:Britaniya filosofları'];
		const { suggestions } = await buildParentCatsSuggestions(rawResults, currentCats, {
			get: mockGet,
		});
		const titles = suggestions.map((s) => s.title);
		expect(titles).not.toContain('Kateqoriya:Britaniya filosofları (redir)');
		expect(titles).toContain('Kateqoriya:Şotlandiya filosofları');
	});

	it('should suggest a redirect candidate by its resolved target title', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('Kateqoriya:Şotlandiya filosofları (redir)')) {
				return {
					query: {
						redirects: [
							{
								from: 'Kateqoriya:Şotlandiya filosofları (redir)',
								to: 'Kateqoriya:Şotlandiya filosofları',
							},
						],
						pages: {
							10: {
								title: 'Kateqoriya:Şotlandiya filosofları',
								categories: [{ title: 'Kateqoriya:Britaniya filosofları' }],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [
			{ title: 'Kateqoriya:Şotlandiya filosofları (redir)', sources: ['en'] },
		];
		const currentCats = ['Kateqoriya:Ateistlər'];
		const { suggestions } = await buildParentCatsSuggestions(rawResults, currentCats, {
			get: mockGet,
		});
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({
			title: 'Kateqoriya:Şotlandiya filosofları',
			sources: ['en'],
			selected: false,
			azRedirectFrom: 'Kateqoriya:Şotlandiya filosofları (redir)',
			redirectSites: ['az'],
			foreignNames: [{ lang: 'az', name: 'Kateqoriya:Şotlandiya filosofları (redir)' }],
		});
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

		const rawResults = [{ title: 'Kateqoriya:Şotlandiya filosofları', sources: ['en'] }];
		const currentCats = ['Kateqoriya:Britaniya filosofları'];
		const { suggestions } = await buildParentCatsSuggestions(rawResults, currentCats, {
			get: mockGet,
		});
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].removals).toHaveLength(1);
		expect(suggestions[0].removals[0].title).toBe('Kateqoriya:Britaniya filosofları');
		expect(suggestions[0].removals[0].selected).toBe(false);
	});

	it('should request a shared ancestor only once per level', async () => {
		const mockGet = vi.fn(async (params) => {
			if (params.meta === 'userinfo') {
				return { query: { userinfo: { rights: ['apihighlimits'] } } };
			}
			const pages = {};
			for (const title of (params.titles || '').split('|')) {
				pages[title] = {
					title,
					categories:
						title === 'Kateqoriya:A' || title === 'Kateqoriya:B'
							? [{ title: 'Kateqoriya:SharedOne' }, { title: 'Kateqoriya:SharedTwo' }]
							: [],
				};
			}
			return { query: { pages } };
		});

		await buildParentCatsSuggestions([], ['Kateqoriya:A', 'Kateqoriya:B'], { get: mockGet });

		const titleRequests = mockGet.mock.calls.map(([params]) => params.titles).filter(Boolean);
		titleRequests.forEach((titles) => {
			const parts = titles.split('|');
			expect(new Set(parts).size).toBe(parts.length);
		});
		const sharedRequests = titleRequests.filter((titles) =>
			titles.includes('Kateqoriya:SharedOne')
		);
		expect(sharedRequests).toHaveLength(1);
		expect(sharedRequests[0].split('|').sort()).toEqual([
			'Kateqoriya:SharedOne',
			'Kateqoriya:SharedTwo',
		]);
	});

	it('should cap the number of unique nodes fetched per ancestor level', async () => {
		const parents = Array.from(
			{ length: MAX_ANCESTOR_NODES_PER_LEVEL + 1 },
			(_, i) => `Kateqoriya:P${i}`
		);
		const mockGet = vi.fn(async (params) => {
			if (params.meta === 'userinfo') {
				return { query: { userinfo: { rights: ['apihighlimits'] } } };
			}
			const pages = {};
			for (const title of (params.titles || '').split('|')) {
				pages[title] = {
					title,
					categories:
						title === 'Kateqoriya:A'
							? parents.map((parent) => ({ title: parent }))
							: [],
				};
			}
			return { query: { pages } };
		});

		const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			await buildParentCatsSuggestions([], ['Kateqoriya:A'], { get: mockGet });
		} finally {
			consoleLog.mockRestore();
		}

		const requestedTitles = new Set();
		mockGet.mock.calls.forEach(([params]) => {
			if (params.titles) {
				params.titles.split('|').forEach((title) => requestedTitles.add(title));
			}
		});
		expect(requestedTitles.size).toBe(MAX_ANCESTOR_NODES_PER_LEVEL + 1);
		expect(requestedTitles.has(parents[0])).toBe(true);
		expect(requestedTitles.has(parents[parents.length - 1])).toBe(false);
	});

	it('should ignore a category that lists itself as its parent', async () => {
		const mockGet = vi.fn(async (params) => {
			if (params.meta === 'userinfo') {
				return { query: { userinfo: { rights: ['apihighlimits'] } } };
			}
			const pages = {};
			for (const title of (params.titles || '').split('|')) {
				pages[title] = {
					title,
					categories:
						title === 'Kateqoriya:A'
							? [{ title: 'Kateqoriya:A' }, { title: 'Kateqoriya:B' }]
							: [],
				};
			}
			return { query: { pages } };
		});

		const { parentMap } = await buildParentCatsSuggestions([], ['Kateqoriya:A'], {
			get: mockGet,
		});

		expect(parentMap.get('Kateqoriya:A')).toEqual(['Kateqoriya:B']);
	});

	it('should not suggest the current category page itself', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));
		const rawResults = [
			{ title: 'Kateqoriya:Xristian terminologiyası', sources: ['en'] },
			{ title: 'Kateqoriya:Xristianlıq', sources: ['en'] },
		];

		const { suggestions } = await buildParentCatsSuggestions(
			rawResults,
			[],
			{ get: mockGet },
			'Xristian terminologiyası',
			new Set(),
			new Map(),
			new Map(),
			'Kateqoriya:Xristian terminologiyası'
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Kateqoriya:Xristianlıq']);
	});

	it('should still suggest a category matching the current article title', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));
		const rawResults = [{ title: 'Kateqoriya:Xristian terminologiyası', sources: ['en'] }];

		const { suggestions } = await buildParentCatsSuggestions(
			rawResults,
			[],
			{ get: mockGet },
			'Xristian terminologiyası'
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Kateqoriya:Xristian terminologiyası']);
	});

	it('should propagate foreign names from foreignNamesByTitle', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const rawResults = [{ title: 'Kateqoriya:Ekzistensial risk', sources: ['en'] }];
		const foreignNamesByTitle = new Map([
			['Kateqoriya:Ekzistensial risk', [{ lang: 'en', name: 'Category:Redirect parent' }]],
		]);

		const { suggestions } = await buildParentCatsSuggestions(
			rawResults,
			[],
			{ get: mockGet },
			'',
			new Set(),
			new Map(),
			foreignNamesByTitle
		);

		expect(suggestions[0].foreignNames).toEqual([
			{ lang: 'en', name: 'Category:Redirect parent' },
		]);
	});

	it('should allow topical template categories on template pages', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));
		const rawResults = [
			{ title: 'Kateqoriya:Riyazi formatlama şablonları', sources: ['en'] },
			{ title: 'Kateqoriya:Kimya şablonları', sources: ['en'] },
			{
				title: 'Kateqoriya:Şablonlar:TemplateStyles istifadə edən şablonlar',
				sources: ['en'],
			},
			{ title: 'Kateqoriya:Vikipediya şablonları', sources: ['en'] },
			{ title: 'Kateqoriya:Şablonlar', sources: ['en'] },
		];

		const { suggestions } = await buildParentCatsSuggestions(
			rawResults,
			['Kateqoriya:Sənədləşmə səhifəsi lazım olan şablonlar'],
			{ get: mockGet },
			'NumBlk',
			new Set(),
			new Map(),
			new Map(),
			'',
			{ allowTemplateCategories: true }
		);

		const titles = suggestions.map((s) => s.title);
		expect(titles).toContain('Kateqoriya:Riyazi formatlama şablonları');
		expect(titles).toContain('Kateqoriya:Kimya şablonları');
		expect(titles).not.toContain('Kateqoriya:Şablonlar:TemplateStyles istifadə edən şablonlar');
		expect(titles).not.toContain('Kateqoriya:Vikipediya şablonları');
		expect(titles).not.toContain('Kateqoriya:Şablonlar');
	});

	it('should skip keyword exclusion for Wikidata-derived categories only', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const { suggestions } = await buildParentCatsSuggestions(
			[
				{ title: 'Kateqoriya:Yaşayan insanlar', sources: [], isWikidataDerived: true },
				{ title: 'Kateqoriya:Yaşayan insanlar 2', sources: [] },
			],
			[],
			{ get: mockGet },
			'Some article'
		);

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].title).toBe('Kateqoriya:Yaşayan insanlar');
		expect(suggestions[0].isWikidataDerived).toBe(true);
	});

	it('should still exclude template categories without template context', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const { suggestions } = await buildParentCatsSuggestions(
			[{ title: 'Kateqoriya:Riyazi formatlama şablonları', sources: ['en'] }],
			[],
			{ get: mockGet },
			'NumBlk'
		);

		expect(suggestions).toEqual([]);
	});

	it('should allow topical template parents on template category pages', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const { suggestions } = await buildParentCatsSuggestions(
			[
				{ title: 'Kateqoriya:Riyaziyyat şablonları', sources: ['en'] },
				{
					title: 'Kateqoriya:Şablonlar:TemplateStyles istifadə edən şablonlar',
					sources: ['en'],
				},
			],
			[],
			{ get: mockGet },
			'Riyazi formatlama şablonları',
			new Set(),
			new Map(),
			new Map(),
			'Kateqoriya:Riyazi formatlama şablonları',
			{ allowTemplateCategories: true }
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Kateqoriya:Riyaziyyat şablonları']);
	});

	it('should offer redundant template categories as removals in template context', async () => {
		const mockGet = vi.fn(async (params) => {
			if (String(params.titles).includes('Kateqoriya:Riyazi formatlama şablonları')) {
				return {
					query: {
						pages: {
							1: {
								title: 'Kateqoriya:Riyazi formatlama şablonları',
								categories: [{ title: 'Kateqoriya:Riyaziyyat şablonları' }],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const { suggestions } = await buildParentCatsSuggestions(
			[{ title: 'Kateqoriya:Riyazi formatlama şablonları', sources: ['en'] }],
			['Kateqoriya:Riyaziyyat şablonları'],
			{ get: mockGet },
			'Riyazi formatlama şablonları',
			new Set(),
			new Map(),
			new Map(),
			'',
			{ allowTemplateCategories: true }
		);

		expect(suggestions[0].removals.map((r) => r.title)).toContain(
			'Kateqoriya:Riyaziyyat şablonları'
		);
	});

	it('should apply exclusions to the redirect target, not the raw title', async () => {
		const rawExcluded = 'Kateqoriya:2000-ci ildə doğulanlar (köhnə)';
		const rawClean = 'Kateqoriya:Təmiz ad';
		const mockGet = vi.fn(async () => ({
			query: {
				redirects: [
					{ from: rawExcluded, to: 'Kateqoriya:Filosoflar' },
					{ from: rawClean, to: 'Kateqoriya:Kişi' },
				],
				pages: {},
			},
		}));

		const { suggestions } = await buildParentCatsSuggestions(
			[
				{ title: rawExcluded, sources: ['en'] },
				{ title: rawClean, sources: ['en'] },
			],
			[],
			{ get: mockGet }
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Kateqoriya:Filosoflar']);
	});
});

describe('buildExistingRemovals', () => {
	it('should include template categories in redundancy analysis when allowed', async () => {
		const parentMap = new Map();
		parentMap.set('Kateqoriya:Riyazi formatlama şablonları', [
			'Kateqoriya:Riyaziyyat şablonları',
		]);
		parentMap.set('Kateqoriya:Riyaziyyat şablonları', []);
		const api = { get: vi.fn(async () => ({ query: { pages: {} } })) };
		const currentCats = [
			'Kateqoriya:Riyazi formatlama şablonları',
			'Kateqoriya:Riyaziyyat şablonları',
		];
		const options = { allowTemplateCategories: true };

		const allowed = await buildExistingRemovals(
			currentCats,
			api,
			new Set(),
			parentMap,
			'Riyazi formatlama şablonları',
			options
		);
		expect(allowed.map((r) => r.title)).toEqual(['Kateqoriya:Riyaziyyat şablonları']);

		const withoutContext = await buildExistingRemovals(
			currentCats,
			api,
			new Set(),
			parentMap,
			'Riyazi formatlama şablonları'
		);
		expect(withoutContext).toEqual([]);
	});

	it('should use shared parentMap and skip API calls', async () => {
		const mockGet = vi.fn();
		const parentMap = new Map();
		parentMap.set('Kateqoriya:Şotlandiya filosofları', ['Kateqoriya:Britaniya filosofları']);
		parentMap.set('Kateqoriya:Britaniya filosofları', ['Kateqoriya:Britaniya şəxsləri']);

		const removals = await buildExistingRemovals(
			['Kateqoriya:Şotlandiya filosofları', 'Kateqoriya:Britaniya filosofları'],
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
						categories: [{ title: 'Kateqoriya:Janrlarına görə ABŞ filmləri' }],
					},
					2: {
						title: 'Kateqoriya:Janrlarına görə ABŞ filmləri',
						categories: [{ title: 'Kateqoriya:ABŞ filmləri' }],
					},
				},
			},
		}));

		const removals = await buildExistingRemovals(
			['Kateqoriya:ABŞ filmləri', 'Kateqoriya:ABŞ-nin dram filmləri'],
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

	it('should not suggest removing the page own category under a plural form', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				pages: {
					1: {
						title: 'Kateqoriya:Uşaq oyuncaqları',
						categories: [{ title: 'Kateqoriya:Oyuncaqlar' }],
					},
					2: {
						title: 'Kateqoriya:Oyuncaqlar',
						categories: [],
					},
				},
			},
		}));

		const removals = await buildExistingRemovals(
			['Kateqoriya:Oyuncaqlar', 'Kateqoriya:Uşaq oyuncaqları'],
			{ get: mockGet },
			new Set(),
			null,
			'Oyuncaq'
		);
		expect(removals).toHaveLength(0);
	});

	it('should ignore ancestor chains that loop through a category-graph cycle', async () => {
		const parentMap = new Map([
			['Kateqoriya:Fəlsəfə', ['Kateqoriya:Abstraksiya']],
			['Kateqoriya:Alimlər', ['Kateqoriya:Elm']],
			['Kateqoriya:Fəlsəfə tarixi', ['Kateqoriya:Fəlsəfə']],
			['Kateqoriya:Elm', ['Kateqoriya:Bilik']],
			// Cycle: Fəlsəfə -> Abstraksiya -> Anlayışlar -> Bilik -> Təfəkkür -> Fəlsəfə
			['Kateqoriya:Bilik', ['Kateqoriya:Təfəkkür', 'Kateqoriya:Anlayışlar']],
			['Kateqoriya:Təfəkkür', ['Kateqoriya:Fəlsəfə']],
			['Kateqoriya:Abstraksiya', ['Kateqoriya:Anlayışlar']],
			['Kateqoriya:Anlayışlar', ['Kateqoriya:Bilik']],
			// Legit chain (off-page intermediate) unaffected by the cycle
			['Kateqoriya:Antik dövr filosofları', ['Kateqoriya:Antik fəlsəfə']],
			['Kateqoriya:Antik fəlsəfə', ['Kateqoriya:Fəlsəfə']],
		]);
		const mockGet = vi.fn();

		const removals = await buildExistingRemovals(
			[
				'Kateqoriya:Fəlsəfə',
				'Kateqoriya:Alimlər',
				'Kateqoriya:Fəlsəfə tarixi',
				'Kateqoriya:Antik dövr filosofları',
			],
			{ get: mockGet },
			new Set(),
			parentMap
		);

		expect(removals).toHaveLength(1);
		expect(removals[0].title).toBe('Kateqoriya:Fəlsəfə');

		const collect = (nodes) => nodes.flatMap((n) => [n.title, ...collect(n.children || [])]);
		const treeTitles = collect(removals[0].tree);
		expect(treeTitles).toContain('Kateqoriya:Fəlsəfə tarixi');
		expect(treeTitles).toContain('Kateqoriya:Antik dövr filosofları');
		expect(treeTitles).not.toContain('Kateqoriya:Alimlər');
	});

	it("should keep a descendant's tree attached when its closest on-page ancestor is outside the candidate's subtree", async () => {
		const parentMap = new Map([
			// Müsəlman teoloqlar descends from BOTH Din and Fəlsəfə, but its
			// closest on-page ancestor is Din (unrelated to Fəlsəfə).
			['Kateqoriya:Müsəlman teoloqlar', ['Kateqoriya:Dinlərinə görə teoloqlar']],
			['Kateqoriya:Dinlərinə görə teoloqlar', ['Kateqoriya:Din', 'Kateqoriya:Teoloqlar']],
			['Kateqoriya:Teoloqlar', ['Kateqoriya:Dinşünaslıq']],
			['Kateqoriya:Dinşünaslıq', ['Kateqoriya:Fəlsəfə']],
			['Kateqoriya:Din', []],
			['Kateqoriya:Fəlsəfə', []],
		]);
		const mockGet = vi.fn();

		const removals = await buildExistingRemovals(
			['Kateqoriya:Din', 'Kateqoriya:Fəlsəfə', 'Kateqoriya:Müsəlman teoloqlar'],
			{ get: mockGet },
			new Set(),
			parentMap
		);

		const felsefe = removals.find((r) => r.title === 'Kateqoriya:Fəlsəfə');
		expect(felsefe).toBeDefined();
		expect(felsefe.tree).toHaveLength(1);
		expect(felsefe.tree[0].title).toBe('Kateqoriya:Müsəlman teoloqlar');

		const din = removals.find((r) => r.title === 'Kateqoriya:Din');
		expect(din).toBeDefined();
		expect(din.tree[0].title).toBe('Kateqoriya:Müsəlman teoloqlar');
	});

	it('should not hang or build a cyclic tree when two on-page categories are mutual ancestors', async () => {
		// A and B are mutual ancestors (A -> M -> B and B -> N -> A, a category-graph
		// cycle), and both are descendants of C. Without cycle guards the tree builder
		// would attach A under B and B under A, and `toTree` would recurse forever.
		const parentMap = new Map([
			['Kateqoriya:A', ['Kateqoriya:M', 'Kateqoriya:P']],
			['Kateqoriya:M', ['Kateqoriya:B']],
			['Kateqoriya:P', ['Kateqoriya:C']],
			['Kateqoriya:B', ['Kateqoriya:N', 'Kateqoriya:Q']],
			['Kateqoriya:N', ['Kateqoriya:A']],
			['Kateqoriya:Q', ['Kateqoriya:C']],
			['Kateqoriya:C', []],
		]);
		const mockGet = vi.fn();

		const removals = await buildExistingRemovals(
			['Kateqoriya:C', 'Kateqoriya:A', 'Kateqoriya:B'],
			{ get: mockGet },
			new Set(),
			parentMap
		);

		// C is the only viable candidate: A and B are each rejected as descendants
		// of the other (mutual ancestors are unreliable), but both stay under C.
		expect(removals).toHaveLength(1);
		expect(removals[0].title).toBe('Kateqoriya:C');

		const collect = (nodes) => nodes.flatMap((n) => [n.title, ...collect(n.children || [])]);
		const treeTitles = collect(removals[0].tree);
		expect(treeTitles.sort()).toEqual(['Kateqoriya:A', 'Kateqoriya:B']);
	});

	it('should not hang when an on-page category lists itself as a parent', async () => {
		// Real-world shape on Tetraqrammaton: Xristian terminologiyası lists itself
		// and Xristianlıq as parents. The self-edge previously created
		// pred[Xristian terminologiyası] = itself, so reconstructing the chain for
		// the on-page parent Xristianlıq looped forever.
		const child = 'Kateqoriya:Xristian terminologiyası';
		const parent = 'Kateqoriya:Xristianlıq';
		const parentMap = new Map([
			[child, [child, parent]],
			[parent, []],
		]);
		const mockGet = vi.fn();

		const removals = await buildExistingRemovals(
			[child, parent],
			{ get: mockGet },
			new Set(),
			parentMap
		);

		expect(mockGet).not.toHaveBeenCalled();
		expect(removals.map((r) => r.title)).toEqual([parent]);
	});

	it('should not remove a category when its only on-page descendant is a draft category', async () => {
		// "Kateqoriya:Psixologiya qaralamaları" is a draft subcategory of
		// "Kateqoriya:Psixologiya" (matched by the "qaralamalar" keyword). Draft and
		// maintenance categories must never justify removing another category.
		const parentMap = new Map([
			['Kateqoriya:Psixologiya qaralamaları', ['Kateqoriya:Psixologiya']],
			['Kateqoriya:Psixologiya', []],
		]);
		const mockGet = vi.fn();

		const removals = await buildExistingRemovals(
			['Kateqoriya:Psixologiya', 'Kateqoriya:Psixologiya qaralamaları'],
			{ get: mockGet },
			new Set(),
			parentMap
		);

		expect(removals).toHaveLength(0);
		expect(mockGet).not.toHaveBeenCalled();
	});

	it('should still remove a category when a real descendant is on the page alongside a draft', async () => {
		const parentMap = new Map([
			['Kateqoriya:Psixologiya qaralamaları', ['Kateqoriya:Psixologiya']],
			['Kateqoriya:Psixologiya', ['Kateqoriya:Elm']],
			['Kateqoriya:Elm', []],
		]);
		const mockGet = vi.fn();

		const removals = await buildExistingRemovals(
			['Kateqoriya:Elm', 'Kateqoriya:Psixologiya', 'Kateqoriya:Psixologiya qaralamaları'],
			{ get: mockGet },
			new Set(),
			parentMap
		);

		expect(removals).toHaveLength(1);
		expect(removals[0].title).toBe('Kateqoriya:Elm');
		expect(removals[0].tree[0].title).toBe('Kateqoriya:Psixologiya');
	});
});

describe('fetchMembersSuggestions', () => {
	it('should flag members reached via redirect resolution', async () => {
		const mockGet = vi.fn(async (params) => {
			expect(params.redirects).toBe(true);
			return {
				query: {
					redirects: [
						{ from: 'Our name is Armenian Army', to: 'Armed Forces of Armenia' },
					],
					pages: {
						1: {
							title: 'Armed Forces of Armenia',
							// Redirect member: resolved via its target's langlink and
							// therefore flagged in redirectResolvedCatToSites.
							langlinks: [{ lang: 'az', '*': 'Ermənistan Silahlı Qüvvələri' }],
						},
						2: {
							title: 'Ey Reqîb',
							langlinks: [{ lang: 'az', '*': 'Ey Reqib' }],
						},
					},
				},
			};
		});

		const globalCatToSites = new Map();
		const redirectResolvedCatToSites = new Map();
		await fetchMembersSuggestions(
			{ get: mockGet },
			{ title: 'Category:Patriotic songs', site: 'enwiki' },
			'en',
			globalCatToSites,
			'Q7214468',
			redirectResolvedCatToSites
		);

		const entries = Array.from(globalCatToSites.entries()).map(([t, s]) => [t, Array.from(s)]);
		expect(entries).toEqual([
			['Ermənistan Silahlı Qüvvələri', ['en']],
			['Ey Reqib', ['en']],
		]);
		expect(
			Array.from(redirectResolvedCatToSites.entries()).map(([t, s]) => [t, Array.from(s)])
		).toEqual([['Ermənistan Silahlı Qüvvələri', ['en']]]);
	});

	it('should record redirect names from API redirects', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				redirects: [
					{ from: 'Our name is Armenian Army', to: 'Armed Forces of Armenia' },
					{ from: 'Second redirect', to: 'Armed Forces of Armenia' },
				],
				pages: {
					1: {
						title: 'Armed Forces of Armenia',
						langlinks: [{ lang: 'az', '*': 'Ermənistan Silahlı Qüvvələri' }],
					},
				},
			},
		}));

		const globalCatToSites = new Map();
		const foreignNamesByTitle = new Map();
		await fetchMembersSuggestions(
			{ get: mockGet },
			{ title: 'Category:Patriotic songs', site: 'enwiki' },
			'en',
			globalCatToSites,
			'Q7214468',
			new Map(),
			foreignNamesByTitle
		);

		expect(Array.from(foreignNamesByTitle.entries())).toEqual([
			[
				'Ermənistan Silahlı Qüvvələri',
				[
					{ lang: 'en', name: 'Our name is Armenian Army' },
					{ lang: 'en', name: 'Second redirect' },
				],
			],
		]);
	});

	it('should restore redirect names from cache entries and tolerate legacy formats', async () => {
		global.mw.storage.get = vi.fn((key) => {
			if (key === 'catsuggest-members-cache-2-Q7214468-enwiki') {
				return JSON.stringify([
					{
						t: 'Ermənistan Silahlı Qüvvələri',
						r: true,
						n: ['Our name is Armenian Army'],
					},
					{ t: 'Ey Reqib', r: false },
					'Kateqoriya:Ölkələrinə görə himnlər',
				]);
			}
			return null;
		});
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const globalCatToSites = new Map();
		const redirectResolvedCatToSites = new Map();
		const foreignNamesByTitle = new Map();
		await fetchMembersSuggestions(
			{ get: mockGet },
			{ title: 'Category:Patriotic songs', site: 'enwiki' },
			'en',
			globalCatToSites,
			'Q7214468',
			redirectResolvedCatToSites,
			foreignNamesByTitle
		);

		expect(mockGet).not.toHaveBeenCalled();
		expect(Array.from(redirectResolvedCatToSites.keys())).toEqual([
			'Ermənistan Silahlı Qüvvələri',
		]);
		expect(Array.from(foreignNamesByTitle.entries())).toEqual([
			['Ermənistan Silahlı Qüvvələri', [{ lang: 'en', name: 'Our name is Armenian Army' }]],
		]);
		expect(globalCatToSites.has('Kateqoriya:Ölkələrinə görə himnlər')).toBe(true);
	});

	it('should restore redirect flags from cache entries and ignore legacy bare strings', async () => {
		global.mw.storage.get = vi.fn((key) => {
			if (key === 'catsuggest-members-cache-2-Q7214468-enwiki') {
				return JSON.stringify([
					{ t: 'Ermənistan Silahlı Qüvvələri', r: true },
					{ t: 'Ey Reqib', r: false },
					'Kateqoriya:Ölkələrinə görə himnlər',
				]);
			}
			return null;
		});
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const globalCatToSites = new Map();
		const redirectResolvedCatToSites = new Map();
		await fetchMembersSuggestions(
			{ get: mockGet },
			{ title: 'Category:Patriotic songs', site: 'enwiki' },
			'en',
			globalCatToSites,
			'Q7214468',
			redirectResolvedCatToSites
		);

		expect(mockGet).not.toHaveBeenCalled();
		expect(Array.from(redirectResolvedCatToSites.keys())).toEqual([
			'Ermənistan Silahlı Qüvvələri',
		]);
		expect(globalCatToSites.has('Kateqoriya:Ölkələrinə görə himnlər')).toBe(true);
	});

	it('should record the foreign page title for a non-redirect member', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				pages: {
					1: {
						title: 'Kateqoriya:Existential risk',
						langlinks: [{ lang: 'az', '*': 'Kateqoriya:Ekzistensial risk' }],
					},
				},
			},
		}));

		const globalCatToSites = new Map();
		const foreignNamesByTitle = new Map();
		await fetchMembersSuggestions(
			{ get: mockGet },
			{ title: 'Category:Existential risk', site: 'enwiki' },
			'en',
			globalCatToSites,
			'Q1234',
			new Map(),
			foreignNamesByTitle
		);

		expect(globalCatToSites.get('Kateqoriya:Ekzistensial risk')).toEqual(new Set(['en']));
		expect(foreignNamesByTitle.get('Kateqoriya:Ekzistensial risk')).toEqual([
			{ lang: 'en', name: 'Kateqoriya:Existential risk' },
		]);
	});
});

describe('fetchParentCatsSuggestions', () => {
	it('should flag parent categories reached via redirect resolution', async () => {
		const mockGet = vi.fn(async (params) => {
			expect(params.redirects).toBe(true);
			return {
				query: {
					redirects: [
						{ from: 'Category:Redirect parent', to: 'Category:Patriotic music' },
					],
					pages: {
						1: {
							title: 'Category:Patriotic music',
							langlinks: [{ lang: 'az', '*': 'Kateqoriya:Vətənpərvər musiqisi' }],
						},
						2: {
							title: 'Category:Plain parent',
							langlinks: [{ lang: 'az', '*': 'Kateqoriya:Sadə valideyn' }],
						},
					},
				},
			};
		});

		const globalCatToSites = new Map();
		const redirectResolvedCatToSites = new Map();
		await fetchParentCatsSuggestions(
			{ get: mockGet },
			{ title: 'Category:Patriotic songs', site: 'enwiki' },
			'en',
			globalCatToSites,
			'Q7214468',
			redirectResolvedCatToSites
		);

		const entries = Array.from(globalCatToSites.entries()).map(([t, s]) => [t, Array.from(s)]);
		expect(entries).toEqual([
			['Kateqoriya:Vətənpərvər musiqisi', ['en']],
			['Kateqoriya:Sadə valideyn', ['en']],
		]);
		expect(Array.from(redirectResolvedCatToSites.keys())).toEqual([
			'Kateqoriya:Vətənpərvər musiqisi',
		]);
	});

	it('should record redirect names from API redirects', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				redirects: [{ from: 'Category:Redirect parent', to: 'Category:Patriotic music' }],
				pages: {
					1: {
						title: 'Category:Patriotic music',
						langlinks: [{ lang: 'az', '*': 'Kateqoriya:Vətənpərvər musiqisi' }],
					},
				},
			},
		}));

		const globalCatToSites = new Map();
		const foreignNamesByTitle = new Map();
		await fetchParentCatsSuggestions(
			{ get: mockGet },
			{ title: 'Category:Patriotic songs', site: 'enwiki' },
			'en',
			globalCatToSites,
			'Q7214468',
			new Map(),
			foreignNamesByTitle
		);

		expect(Array.from(foreignNamesByTitle.entries())).toEqual([
			['Kateqoriya:Vətənpərvər musiqisi', [{ lang: 'en', name: 'Category:Redirect parent' }]],
		]);
	});
});

describe('buildMembersSuggestions', () => {
	it('should not suggest the current category as a member of itself', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));
		const rawResults = [
			{ title: 'Kateqoriya:Xristian terminologiyası', sources: ['en'] },
			{ title: 'Kateqoriya:Xristianlıq', sources: ['en'] },
		];
		const localData = {
			members: new Set(),
			subcats: new Set(),
		};

		const suggestions = await buildMembersSuggestions(
			rawResults,
			localData,
			{ get: mockGet },
			new Set(),
			new Map(),
			new Map(),
			'Kateqoriya:Xristian terminologiyası'
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Kateqoriya:Xristianlıq']);
	});

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
								categories: [{ title: 'Kateqoriya:Ekzistensial risk' }],
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

	it('should drop a redirect candidate whose target is already a member', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('İlqar İsmayılov (hərbçi)')) {
				return {
					query: {
						redirects: [{ from: 'İlqar İsmayılov (hərbçi)', to: 'İlqar İsmayılov' }],
						pages: {
							11: {
								title: 'İlqar İsmayılov',
								categories: [
									{ title: 'Kateqoriya:Azərbaycanın Milli Qəhrəmanları' },
								],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [{ title: 'İlqar İsmayılov (hərbçi)', sources: ['ru'] }];
		const localData = {
			members: new Set(['İlqar İsmayılov']),
			subcats: new Set(),
		};

		const suggestions = await buildMembersSuggestions(rawResults, localData, { get: mockGet });
		expect(suggestions).toEqual([]);
	});

	it('should offer a redirect candidate resolved to its target title when not a member', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('İlqar İsmayılov (hərbçi)')) {
				return {
					query: {
						redirects: [{ from: 'İlqar İsmayılov (hərbçi)', to: 'İlqar İsmayılov' }],
						pages: {
							11: {
								title: 'İlqar İsmayılov',
								categories: [{ title: 'Kateqoriya:Azərbaycan xanəndələri' }],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [{ title: 'İlqar İsmayılov (hərbçi)', sources: ['ru'] }];
		const localData = {
			members: new Set(),
			subcats: new Set(['Kateqoriya:Azərbaycanın Milli Qəhrəmanları']),
		};

		const suggestions = await buildMembersSuggestions(rawResults, localData, { get: mockGet });
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({
			title: 'İlqar İsmayılov',
			sources: ['ru'],
			selected: false,
			azRedirectFrom: 'İlqar İsmayılov (hərbçi)',
			redirectSites: ['az'],
			foreignNames: [{ lang: 'az', name: 'İlqar İsmayılov (hərbçi)' }],
		});
	});

	it('should drop a redirect candidate whose target is inside a current subcategory', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('İlqar İsmayılov (hərbçi)')) {
				return {
					query: {
						redirects: [{ from: 'İlqar İsmayılov (hərbçi)', to: 'İlqar İsmayılov' }],
						pages: {
							11: {
								title: 'İlqar İsmayılov',
								categories: [
									{ title: 'Kateqoriya:Azərbaycanın Milli Qəhrəmanları' },
								],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [{ title: 'İlqar İsmayılov (hərbçi)', sources: ['ru'] }];
		const localData = {
			members: new Set(),
			subcats: new Set(['Kateqoriya:Azərbaycanın Milli Qəhrəmanları']),
		};

		const suggestions = await buildMembersSuggestions(rawResults, localData, { get: mockGet });
		expect(suggestions).toEqual([]);
	});

	it('should not attach az provenance for a non-redirect candidate', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('İlqar İsmayılov')) {
				return {
					query: {
						pages: {
							11: {
								title: 'İlqar İsmayılov',
								categories: [{ title: 'Kateqoriya:Azərbaycan xanəndələri' }],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [{ title: 'İlqar İsmayılov', sources: ['ru'] }];
		const localData = {
			members: new Set(),
			subcats: new Set(),
		};

		const suggestions = await buildMembersSuggestions(rawResults, localData, { get: mockGet });
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].azRedirectFrom).toBeUndefined();
		expect(suggestions[0].selected).toBe(true);
		expect(suggestions[0].redirectSites).toEqual([]);
		expect(suggestions[0].foreignNames).toEqual([]);
	});

	it('should attach foreign names and stay selected for a plain candidate', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('İlqar İsmayılov')) {
				return {
					query: {
						pages: {
							11: {
								title: 'İlqar İsmayılov',
								categories: [{ title: 'Kateqoriya:Azərbaycan xanəndələri' }],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [{ title: 'İlqar İsmayılov', sources: ['ru'] }];
		const localData = {
			members: new Set(),
			subcats: new Set(),
		};
		const foreignNamesByTitle = new Map([
			['İlqar İsmayılov', [{ lang: 'ru', name: 'Исмаилов, Ильгар Сади оглы' }]],
		]);

		const suggestions = await buildMembersSuggestions(
			rawResults,
			localData,
			{ get: mockGet },
			new Set(),
			new Map(),
			foreignNamesByTitle
		);
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].foreignNames).toEqual([
			{ lang: 'ru', name: 'Исмаилов, Ильгар Сади оглы' },
		]);
		expect(suggestions[0].selected).toBe(true);
		expect(suggestions[0].redirectSites).toEqual([]);
	});

	it('should merge foreign and azwiki redirect provenance', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('İlqar İsmayılov (hərbçi)')) {
				return {
					query: {
						redirects: [{ from: 'İlqar İsmayılov (hərbçi)', to: 'İlqar İsmayılov' }],
						pages: {
							11: {
								title: 'İlqar İsmayılov',
								categories: [{ title: 'Kateqoriya:Azərbaycan xanəndələri' }],
							},
						},
					},
				};
			}
			return { query: { pages: {} } };
		});

		const rawResults = [{ title: 'İlqar İsmayılov (hərbçi)', sources: ['ru'] }];
		const localData = {
			members: new Set(),
			subcats: new Set(),
		};
		const redirectResolvedCatToSites = new Map([['İlqar İsmayılov (hərbçi)', new Set(['ru'])]]);
		const foreignNamesByTitle = new Map([
			['İlqar İsmayılov (hərbçi)', [{ lang: 'ru', name: 'Исмаилов, Ильгар Сади оглы' }]],
		]);

		const suggestions = await buildMembersSuggestions(
			rawResults,
			localData,
			{ get: mockGet },
			new Set(),
			redirectResolvedCatToSites,
			foreignNamesByTitle
		);
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].azRedirectFrom).toBe('İlqar İsmayılov (hərbçi)');
		expect(suggestions[0].selected).toBe(false);
		expect(suggestions[0].redirectSites).toEqual(['ru', 'az']);
		expect(suggestions[0].foreignNames).toEqual([
			{ lang: 'ru', name: 'Исмаилов, Ильгар Сади оглы' },
			{ lang: 'az', name: 'İlqar İsmayılov (hərbçi)' },
		]);
	});

	it('should propagate redirectSites from redirectResolvedCatToSites', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const rawResults = [{ title: 'Kateqoriya:Ekzistensial risk', sources: ['en', 'ru'] }];
		const redirectResolvedCatToSites = new Map([
			['Kateqoriya:Ekzistensial risk', new Set(['en'])],
		]);

		const suggestions = await buildMembersSuggestions(
			rawResults,
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet },
			new Set(),
			redirectResolvedCatToSites
		);

		expect(suggestions[0].redirectSites).toEqual(['en']);
		expect(suggestions[0].selected).toBe(false);
	});

	it('should propagate foreign names from foreignNamesByTitle', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const rawResults = [{ title: 'Kateqoriya:Ekzistensial risk', sources: ['en', 'ru'] }];
		const foreignNamesByTitle = new Map([
			[
				'Kateqoriya:Ekzistensial risk',
				[
					{ lang: 'en', name: 'Redirect member' },
					{ lang: 'ru', name: 'Redirect üzvü' },
				],
			],
		]);

		const suggestions = await buildMembersSuggestions(
			rawResults,
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet },
			new Set(),
			new Map(),
			foreignNamesByTitle
		);

		expect(suggestions[0].foreignNames).toEqual([
			{ lang: 'en', name: 'Redirect member' },
			{ lang: 'ru', name: 'Redirect üzvü' },
		]);
		expect(suggestions[0].selected).toBe(true);
	});

	it('should keep pages the current user can edit', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				pages: {
					1: { title: 'Məqalə A', actions: { edit: [] } },
				},
			},
		}));

		const suggestions = await buildMembersSuggestions(
			[{ title: 'Məqalə A', sources: ['en'] }],
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet }
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Məqalə A']);
		expect(suggestions[0].selected).toBe(true);
	});

	it('should filter out pages the current user cannot edit', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				pages: {
					1: {
						title: 'Qorunmuş səhifə',
						actions: { edit: [{ code: 'protectedpage' }] },
					},
					2: { title: 'Məqalə B', actions: { edit: [] } },
				},
			},
		}));

		const suggestions = await buildMembersSuggestions(
			[
				{ title: 'Qorunmuş səhifə', sources: ['en'] },
				{ title: 'Məqalə B', sources: ['en'] },
			],
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet }
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Məqalə B']);
	});

	it('should treat missing editability results as editable', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				pages: {
					1: { title: 'Məqalə C' },
				},
			},
		}));

		const suggestions = await buildMembersSuggestions(
			[{ title: 'Məqalə C', sources: ['en'] }],
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet }
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Məqalə C']);
	});

	it('should request editability in the members categories query', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		await buildMembersSuggestions(
			[{ title: 'Məqalə D', sources: ['en'] }],
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet }
		);

		const categoryCall = mockGet.mock.calls.find(
			([params]) => params.titles && params.titles.includes('Məqalə D')
		);
		expect(categoryCall[0]).toEqual(
			expect.objectContaining({
				prop: 'categories|info',
				intestactions: 'edit',
				intestactionsdetail: 'quick',
			})
		);
	});

	it('should not suggest templates as category members outside template categories', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const suggestions = await buildMembersSuggestions(
			[{ title: 'Şablon:Foo', sources: ['en'] }],
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet },
			new Set()
		);

		expect(suggestions).toEqual([]);
	});

	it('should suggest templates as category members on template categories', async () => {
		const mockGet = vi.fn(async () => ({ query: { pages: {} } }));

		const suggestions = await buildMembersSuggestions(
			[{ title: 'Şablon:Foo', sources: ['en'] }],
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet },
			new Set(),
			new Map(),
			new Map(),
			'',
			{ isTemplateCategoryPage: true }
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Şablon:Foo']);
	});

	it('should use the /doc editability for template members when /doc exists', async () => {
		const mockGet = vi.fn(async (params) => {
			if (String(params.titles).includes('/doc')) {
				return {
					query: {
						pages: {
							1: { title: 'Şablon:Foo/doc', actions: { edit: ['protected'] } },
						},
					},
				};
			}
			return {
				query: {
					pages: { 1: { title: 'Şablon:Foo', actions: { edit: [] } } },
				},
			};
		});

		const suggestions = await buildMembersSuggestions(
			[{ title: 'Şablon:Foo', sources: ['en'] }],
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet },
			new Set(),
			new Map(),
			new Map(),
			'',
			{ isTemplateCategoryPage: true }
		);

		expect(suggestions).toEqual([]);
	});

	it('should accept a template with an editable /doc even if the template is protected', async () => {
		const mockGet = vi.fn(async (params) => {
			if (String(params.titles).includes('/doc')) {
				return {
					query: {
						pages: {
							1: { title: 'Şablon:Foo/doc', actions: { edit: [] } },
						},
					},
				};
			}
			return {
				query: {
					pages: { 1: { title: 'Şablon:Foo', actions: { edit: ['protected'] } } },
				},
			};
		});

		const suggestions = await buildMembersSuggestions(
			[{ title: 'Şablon:Foo', sources: ['en'] }],
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet },
			new Set(),
			new Map(),
			new Map(),
			'',
			{ isTemplateCategoryPage: true }
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Şablon:Foo']);
	});

	it('should apply exclusions to the redirect target, not the raw title', async () => {
		const raw = 'Yaşayan insanlar (köhnə ad)';
		const mockGet = vi.fn(async (params) => {
			if (params.meta === 'userinfo') {
				return { query: { userinfo: { rights: ['apihighlimits'] } } };
			}
			return {
				query: {
					redirects: [{ from: raw, to: 'Məqalə A' }],
					pages: {},
				},
			};
		});

		const suggestions = await buildMembersSuggestions(
			[{ title: raw, sources: ['en'] }],
			{ members: new Set(), subcats: new Set() },
			{ get: mockGet }
		);

		expect(suggestions.map((s) => s.title)).toEqual(['Məqalə A']);
	});
});

describe('detectTemplateAddedCategories', () => {
	it('ignores category links inside comments', async () => {
		const mockGet = vi.fn(async () => ({
			query: {
				pages: {
					1: { revisions: [{ '*': '<!-- [[Kateqoriya:FromTemplate]] -->\nText' }] },
				},
			},
		}));

		const cats = await detectTemplateAddedCategories(
			{ get: mockGet },
			'Page A',
			['Kateqoriya:FromTemplate']
		);

		expect([...cats]).toEqual(['Kateqoriya:FromTemplate']);
	});
});
