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

const {
	buildParentCatsSuggestions,
	buildExistingRemovals,
	buildMembersSuggestions,
	fetchMembersSuggestions,
	fetchParentCatsSuggestions,
} = await import('../src/suggestions.js');

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
	});

	it('should drop a redirect candidate whose target is already a current category', async () => {
		const mockGet = vi.fn(async (params) => {
			const titles = params.titles || '';
			if (titles.includes('Kateqoriya:Britaniya filosofları (redir)')) {
				return {
					query: {
						redirects: [
							{ from: 'Kateqoriya:Britaniya filosofları (redir)', to: 'Kateqoriya:Britaniya filosofları' },
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
							{ from: 'Kateqoriya:Şotlandiya filosofları (redir)', to: 'Kateqoriya:Şotlandiya filosofları' },
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

		const rawResults = [{ title: 'Kateqoriya:Şotlandiya filosofları (redir)', sources: ['en'] }];
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
});

describe('buildExistingRemovals', () => {
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
								categories: [{ title: 'Kateqoriya:Azərbaycanın Milli Qəhrəmanları' }],
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
								categories: [{ title: 'Kateqoriya:Azərbaycanın Milli Qəhrəmanları' }],
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
		const redirectResolvedCatToSites = new Map([
			['İlqar İsmayılov (hərbçi)', new Set(['ru'])],
		]);
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
});
