import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageGet = vi.fn(() => null);
const storageSet = vi.fn();
const storageRemove = vi.fn();

global.mw = {
	storage: {
		get: storageGet,
		set: storageSet,
		remove: storageRemove,
	},
	log: {
		warn: vi.fn(),
	},
};

const { fetchWikidataDerivedCategories } = await import('../src/wikidata-categories.js');

function entity(id, claims = {}, sitelinks = {}) {
	return { id, claims, sitelinks };
}

function valueSnak(value) {
	return {
		snaktype: 'value',
		datavalue: { type: 'wikibase-entityid', value: { id: value } },
	};
}

function statement(value, options = {}) {
	const result = { mainsnak: valueSnak(value), rank: options.rank || 'normal' };
	if (options.qualifiers) {
		result.qualifiers = options.qualifiers;
	}
	return result;
}

function categoryItem(id, title) {
	return entity(id, {}, { azwiki: { title } });
}

function createApi(entities) {
	return {
		get: vi.fn(async (params) => {
			const result = {};
			String(params.ids)
				.split('|')
				.forEach((id) => {
					if (entities[id]) {
						result[id] = entities[id];
					}
				});
			return { entities: result };
		}),
	};
}

describe('fetchWikidataDerivedCategories', () => {
	beforeEach(() => {
		storageGet.mockReset();
		storageGet.mockReturnValue(null);
		storageSet.mockClear();
		storageRemove.mockClear();
	});

	it('returns nothing without a QID', async () => {
		expect(await fetchWikidataDerivedCategories(createApi({}), '')).toEqual([]);
	});

	it('uses P6365 qualifiers on P463 membership statements', async () => {
		const api = createApi({
			Q1: entity('Q1', {
				P463: [
					statement('Q2', {
						qualifiers: { P6365: [valueSnak('Q3')] },
					}),
				],
			}),
			Q3: categoryItem('Q3', 'Kateqoriya:Üzvlər'),
		});

		expect(await fetchWikidataDerivedCategories(api, 'Q1')).toEqual([
			'Kateqoriya:Üzvlər',
		]);
	});

	it('uses P6365 claims on the membership target item', async () => {
		const api = createApi({
			Q1: entity('Q1', { P463: [statement('Q2')] }),
			Q2: entity('Q2', { P6365: [statement('Q3')] }),
			Q3: categoryItem('Q3', 'Kateqoriya:Üzvlər'),
		});

		expect(await fetchWikidataDerivedCategories(api, 'Q1')).toEqual([
			'Kateqoriya:Üzvlər',
		]);
	});

	it('follows P39 → P2354 → P910 to a category', async () => {
		const api = createApi({
			Q1: entity('Q1', { P39: [statement('QPOS')] }),
			QPOS: entity('QPOS', { P2354: [statement('QLIST')] }),
			QLIST: entity('QLIST', { P910: [statement('QCAT')] }),
			QCAT: categoryItem('QCAT', 'Kateqoriya:Nazirlər'),
		});

		expect(await fetchWikidataDerivedCategories(api, 'Q1')).toEqual([
			'Kateqoriya:Nazirlər',
		]);
	});

	it('accepts a list item whose own sitelink is a category', async () => {
		const api = createApi({
			Q1: entity('Q1', { P39: [statement('QPOS')] }),
			QPOS: entity('QPOS', { P2354: [statement('QLIST')] }),
			QLIST: categoryItem('QLIST', 'Kateqoriya:Nazirlər'),
		});

		expect(await fetchWikidataDerivedCategories(api, 'Q1')).toEqual([
			'Kateqoriya:Nazirlər',
		]);
	});

	it('skips deprecated statements and non-category sitelinks', async () => {
		const api = createApi({
			Q1: entity('Q1', {
				P463: [
					statement('QOLD', { rank: 'deprecated', qualifiers: { P6365: [valueSnak('QOLD_CAT')] } }),
					statement('Q2', { rank: 'preferred', qualifiers: { P6365: [valueSnak('Q3')] } }),
				],
			}),
			QOLD_CAT: categoryItem('QOLD_CAT', 'Kateqoriya:Köhnə'),
			Q3: entity('Q3', {}, { azwiki: { title: 'Məqalə' } }),
		});

		expect(await fetchWikidataDerivedCategories(api, 'Q1')).toEqual([]);
	});

	it('deduplicates titles and caches the result', async () => {
		const api = createApi({
			Q1: entity('Q1', {
				P463: [
					statement('Q2', { qualifiers: { P6365: [valueSnak('Q3')] } }),
					statement('Q2', { qualifiers: { P6365: [valueSnak('Q4')] } }),
				],
			}),
			Q3: categoryItem('Q3', 'Kateqoriya:Üzvlər'),
			Q4: categoryItem('Q4', 'Kateqoriya:Üzvlər'),
		});

		expect(await fetchWikidataDerivedCategories(api, 'Q1')).toEqual([
			'Kateqoriya:Üzvlər',
		]);
		expect(storageSet).toHaveBeenCalledWith(
			'catsuggest-wikidata-categories-Q1',
			JSON.stringify(['Kateqoriya:Üzvlər']),
			86400
		);
	});

	it('uses cached titles without calling the API', async () => {
		storageGet.mockReturnValue(JSON.stringify(['Kateqoriya:Önbellek']));
		const api = createApi({});

		expect(await fetchWikidataDerivedCategories(api, 'Q1')).toEqual([
			'Kateqoriya:Önbellek',
		]);
		expect(api.get).not.toHaveBeenCalled();
	});
});
