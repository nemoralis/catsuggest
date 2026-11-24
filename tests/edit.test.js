import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	addParentCategoriesEdit,
	addTemplateCategoriesEdit,
	refreshTemplateLinks,
	isTemplateMember,
	needsTemplateLinkRefresh,
	findTitlesAlreadyInCategory,
	formatCategoryLink,
	getEditResultMessage,
	sanitizeSortKey,
	extractCategoryTitles,
	extractIncludeonlyCategories,
	extractTemplatePageCategories,
	insertCategoriesIntoTagBlock,
	resolveTemplateDoc,
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
				query: { pages: { 1: { title: 'Page A', revisions: [{ revid: 42, '*': content }] } } },
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
		expect(captured[0].redirect).toBe(true);
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
		expect(captured[0].redirect).toBeUndefined();
		expect(captured[0].title).toBe('Page A');
		expect(captured[0].baserevid).toBe(42);
		expect(captured[0].summary).toBe(
			'[[VP:Q/KT|Kateqoriya təklifçisi]] vasitəsilə +1 kateqoriya, −1 kateqoriya'
		);
	});

	it('does not post a removal edit when the page is missing', async () => {
		const captured = [];
		const api = createApi(captured);
		api.get.mockResolvedValueOnce({
			query: { pages: { '-1': { title: 'Page A', missing: '' } } },
		});

		await expect(
			addParentCategoriesEdit(api, 'Page A', [], ['Kateqoriya:Old'], vi.fn())
		).rejects.toThrow('Səhifənin məzmunu tapılmadı');
		expect(captured).toHaveLength(0);
	});

	it('edits the resolved target when a removal page is a redirect', async () => {
		const captured = [];
		const api = createApi(captured, '[[Kateqoriya:Old]]\ntext');
		api.get.mockResolvedValueOnce({
			query: {
				redirects: [{ from: 'Page A', to: 'Page B' }],
				pages: {
					2: {
						title: 'Page B',
						revisions: [{ revid: 42, '*': '[[Kateqoriya:Old]]\ntext' }],
					},
				},
			},
		});

		await addParentCategoriesEdit(api, 'Page A', [], ['Kateqoriya:Old'], (s) => s);

		expect(captured[0].title).toBe('Page B');
		expect(captured[0].redirect).toBeUndefined();
		expect(captured[0].text).toBe('text');
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

describe('template category helpers', () => {
	it('extracts category titles and separates template-page from includeonly categories', () => {
		const content = [
			'[[Kateqoriya:Bare]]',
			'<noinclude>[[Kateqoriya:InNo|key]]</noinclude>',
			'<includeonly>[[Kateqoriya:InInclude]]</includeonly>',
			'<!-- [[Kateqoriya:Commented]] -->',
		].join('\n');

		expect([...extractCategoryTitles(content)]).toEqual([
			'Kateqoriya:Bare',
			'Kateqoriya:InNo',
			'Kateqoriya:InInclude',
		]);
		expect([...extractIncludeonlyCategories(content)]).toEqual(['Kateqoriya:InInclude']);
		expect([...extractTemplatePageCategories(content)]).toEqual([
			'Kateqoriya:Bare',
			'Kateqoriya:InNo',
		]);
	});

	it('uses the last block with categories, otherwise the last block', () => {
		const withCategories =
			'<includeonly>[[Kateqoriya:A]]</includeonly>\n<includeonly>[[Kateqoriya:B]]</includeonly>';
		expect(
			insertCategoriesIntoTagBlock(withCategories, 'includeonly', [
				{ title: 'Kateqoriya:C' },
			])
		).toBe(
			'<includeonly>[[Kateqoriya:A]]</includeonly>\n' +
				'<includeonly>[[Kateqoriya:B]]\n[[Kateqoriya:C]]\n</includeonly>'
		);

		const withoutCategories = '<includeonly>one</includeonly>\n<includeonly>two</includeonly>';
		expect(
			insertCategoriesIntoTagBlock(withoutCategories, 'includeonly', [
				{ title: 'Kateqoriya:C' },
			])
		).toBe('<includeonly>one</includeonly>\n<includeonly>two\n[[Kateqoriya:C]]\n</includeonly>');
	});

	it('appends a new block when none exists, ignoring tags in comments', () => {
		const content = '<!-- <noinclude>[[Kateqoriya:Old]]</noinclude> -->\nTemplate text\n';
		expect(
			insertCategoriesIntoTagBlock(content, 'noinclude', [{ title: 'Kateqoriya:New' }])
		).toBe(
			'<!-- <noinclude>[[Kateqoriya:Old]]</noinclude> -->\nTemplate text\n' +
				'<noinclude>\n[[Kateqoriya:New]]\n</noinclude>\n'
		);
	});

	it('inserts new categories before a trailing draft template', () => {
		const content = '<includeonly>text\n{{Foo-qaralama}}\n</includeonly>';
		expect(
			insertCategoriesIntoTagBlock(content, 'includeonly', [{ title: 'Kateqoriya:New' }])
		).toBe('<includeonly>text\n[[Kateqoriya:New]]\n{{Foo-qaralama}}\n</includeonly>');
	});

	it('ignores draft templates inside comments when choosing the insertion point', () => {
		const content = '<includeonly>text\n<!-- {{Foo-qaralama}} -->\n</includeonly>';
		expect(
			insertCategoriesIntoTagBlock(content, 'includeonly', [{ title: 'Kateqoriya:New' }])
		).toBe(
			'<includeonly>text\n<!-- {{Foo-qaralama}} -->\n[[Kateqoriya:New]]\n</includeonly>'
		);
	});

	it('does not treat stub templates as drafts', () => {
		const content = '<includeonly>text\n{{Foo-stub}}\n</includeonly>';
		expect(
			insertCategoriesIntoTagBlock(content, 'includeonly', [{ title: 'Kateqoriya:New' }])
		).toBe('<includeonly>text\n{{Foo-stub}}\n[[Kateqoriya:New]]\n</includeonly>');
	});
});

describe('resolveTemplateDoc', () => {
	it('reports an editable doc at the redirected target title', async () => {
		const api = {
			get: vi.fn(async () => ({
				query: {
					pages: {
						1: {
							pageid: 1,
							title: 'Şablon:Foo/doc2',
							actions: { edit: [] },
						},
					},
				},
			})),
		};

		const doc = await resolveTemplateDoc(api, 'Şablon:Foo');

		expect(doc).toEqual({ exists: true, title: 'Şablon:Foo/doc2', editable: true });
		expect(api.get).toHaveBeenCalledWith(
			expect.objectContaining({
				prop: 'info',
				titles: 'Şablon:Foo/doc',
				intestactions: 'edit',
				intestactionsdetail: 'quick',
			})
		);
	});

	it('reports a missing doc and a protected doc', async () => {
		const missingApi = {
			get: vi.fn(async () => ({
				query: { pages: { '-1': { title: 'Şablon:Foo/doc', missing: '' } } },
			})),
		};
		expect(await resolveTemplateDoc(missingApi, 'Şablon:Foo')).toEqual({
			exists: false,
			title: null,
			editable: false,
		});

		const protectedApi = {
			get: vi.fn(async () => ({
				query: {
					pages: {
						1: {
							pageid: 1,
							title: 'Şablon:Foo/doc',
							actions: { edit: [{ code: 'protectedpage' }] },
						},
					},
				},
			})),
		};
		expect(await resolveTemplateDoc(protectedApi, 'Şablon:Foo')).toEqual({
			exists: true,
			title: 'Şablon:Foo/doc',
			editable: false,
		});
	});
});

describe('addTemplateCategoriesEdit', () => {
	function createApi({ doc, docTitle = 'Şablon:Foo/doc', template }) {
		const captured = [];
		const api = {
			get: vi.fn(async (params) => {
				const isDoc = String(params.titles).includes('/doc');
				const page = isDoc ? doc : template;
				if (!page) {
					return { query: { pages: { '-1': { title: params.titles, missing: '' } } } };
				}
				return {
					query: {
						pages: {
							1: {
								title: isDoc ? docTitle : 'Şablon:Foo',
								revisions: [{ revid: 42, '*': page.content }],
							},
						},
					},
				};
			}),
			postWithEditToken: vi.fn(async (params) => {
				captured.push(params);
				return {};
			}),
		};
		return { api, captured };
	}

	it('adds categories to an existing includeonly block in /doc', async () => {
		const { api, captured } = createApi({
			doc: { content: 'Doc text\n<includeonly>\n[[Kateqoriya:Old]]\n</includeonly>\n' },
			template: { content: 'Template text' },
		});

		const result = await addTemplateCategoriesEdit(api, 'Şablon:Foo', [
			{ title: 'Kateqoriya:A', sortKey: 'X' },
			{ title: 'Kateqoriya:B', sortKey: '' },
		]);

		expect(result).toEqual({ addedCount: 2, targetTitle: 'Şablon:Foo/doc' });
		expect(captured[0].title).toBe('Şablon:Foo/doc');
		expect(captured[0].text).toContain('[[Kateqoriya:Old]]\n[[Kateqoriya:A|X]]\n[[Kateqoriya:B]]');
		expect(captured[0].baserevid).toBe(42);
		expect(captured[0].minor).toBe(false);
		expect(captured[0].summary).toBe(
			'[[VP:Q/KT|Kateqoriya təklifçisi]] vasitəsilə +2 kateqoriya'
		);
	});

	it('skips categories already present in either location without editing', async () => {
		const { api, captured } = createApi({
			doc: { content: '<includeonly>[[Kateqoriya:A]]</includeonly>' },
			template: { content: '' },
		});

		const result = await addTemplateCategoriesEdit(
			api,
			'Şablon:Foo',
			[{ title: 'Kateqoriya:A' }, { title: 'Kateqoriya:B' }],
			['Kateqoriya:B']
		);

		expect(result).toEqual({ addedCount: 0, targetTitle: null });
		expect(captured).toHaveLength(0);
	});

	it('edits the resolved target when /doc is a redirect', async () => {
		const { api, captured } = createApi({
			doc: { content: '<includeonly>[[Kateqoriya:Old]]</includeonly>' },
			docTitle: 'Şablon:Foo/doc2',
			template: { content: '' },
		});

		const result = await addTemplateCategoriesEdit(api, 'Şablon:Foo', [
			{ title: 'Kateqoriya:New' },
		]);

		expect(result.targetTitle).toBe('Şablon:Foo/doc2');
		expect(captured[0].title).toBe('Şablon:Foo/doc2');
	});

	it('uses the template noinclude when /doc does not exist', async () => {
		const { api, captured } = createApi({
			doc: null,
			template: { content: 'Template text\n<noinclude>\n[[Kateqoriya:Old]]\n</noinclude>\n' },
		});

		const result = await addTemplateCategoriesEdit(api, 'Şablon:Foo', [
			{ title: 'Kateqoriya:New' },
		]);

		expect(captured[0].title).toBe('Şablon:Foo');
		expect(captured[0].text).toContain(
			'[[Kateqoriya:Old]]\n[[Kateqoriya:New]]\n</noinclude>'
		);
		expect(captured[0].minor).toBe(true);
		expect(result.addedCount).toBe(1);
	});

	it('appends a noinclude block when /doc and noinclude are both missing', async () => {
		const { api, captured } = createApi({
			doc: null,
			template: { content: 'Template text\n' },
		});

		await addTemplateCategoriesEdit(api, 'Şablon:Foo', [{ title: 'Kateqoriya:New' }]);

		expect(captured[0].text).toBe(
			'Template text\n<noinclude>\n[[Kateqoriya:New]]\n</noinclude>\n'
		);
	});

	it('does not duplicate a bare category already on the template', async () => {
		const { api, captured } = createApi({
			doc: null,
			template: { content: '[[Kateqoriya:Present]]\nTemplate text' },
		});

		const result = await addTemplateCategoriesEdit(api, 'Şablon:Foo', [
			{ title: 'Kateqoriya:Present' },
			{ title: 'Kateqoriya:New' },
		]);

		expect(result.addedCount).toBe(1);
		expect(captured[0].text).toContain('[[Kateqoriya:New]]');
		expect(captured[0].text.match(/\[\[Kateqoriya:Present\]\]/g)).toHaveLength(1);
	});
});

describe('member edit planning', () => {
	it('detects template members by namespace id', () => {
		expect(isTemplateMember(10)).toBe(true);
		expect(isTemplateMember(0)).toBe(false);
		expect(isTemplateMember(14)).toBe(false);
	});

	it('needs a link refresh only when the edit landed on a /doc target', () => {
		expect(
			needsTemplateLinkRefresh('Şablon:Foo', {
				addedCount: 1,
				targetTitle: 'Şablon:Foo/doc',
			})
		).toBe(true);
		expect(
			needsTemplateLinkRefresh('Şablon:Foo', {
				addedCount: 1,
				targetTitle: 'Şablon:Foo',
			})
		).toBe(false);
		expect(
			needsTemplateLinkRefresh('Şablon:Foo', {
				addedCount: 0,
				targetTitle: 'Şablon:Foo/doc',
			})
		).toBe(false);
		expect(needsTemplateLinkRefresh('Şablon:Foo', { addedCount: 1 })).toBe(false);
	});

	it('ignores underscore differences between the template and edit target', () => {
		expect(
			needsTemplateLinkRefresh('Şablon:Some_template', {
				addedCount: 1,
				targetTitle: 'Şablon:Some template/doc',
			})
		).toBe(true);
	});
});

describe('refreshTemplateLinks', () => {
	function createApi(content = 'Template wikitext', revid = 42) {
		const captured = [];
		return {
			api: {
				get: vi.fn(async () => ({
					query: {
						pages: { 1: { title: 'Şablon:Foo', revisions: [{ revid, '*': content }] } },
					},
				})),
				postWithEditToken: vi.fn(async (params) => {
					captured.push(params);
					return { edit: { result: 'Success', nochange: '' } };
				}),
			},
			captured,
		};
	}

	it('re-saves the template with unchanged content and its revision id', async () => {
		const { api, captured } = createApi('Template wikitext\n<noinclude>Foo</noinclude>');

		expect(await refreshTemplateLinks(api, 'Şablon:Foo')).toBe(true);
		expect(captured[0].title).toBe('Şablon:Foo');
		expect(captured[0].text).toBe('Template wikitext\n<noinclude>Foo</noinclude>');
		expect(captured[0].baserevid).toBe(42);
		expect(captured[0].minor).toBe(true);
	});

	it('treats an API no-change response as success', async () => {
		const { api } = createApi();

		await expect(refreshTemplateLinks(api, 'Şablon:Foo')).resolves.toBe(true);
	});

	it('does nothing when the template page is missing', async () => {
		const { api, captured } = createApi();
		api.get.mockResolvedValueOnce({
			query: { pages: { '-1': { title: 'Şablon:Foo', missing: '' } } },
		});

		expect(await refreshTemplateLinks(api, 'Şablon:Foo')).toBe(false);
		expect(captured).toHaveLength(0);
	});
});
