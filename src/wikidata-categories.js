const { CATEGORY_PREFIX } = require('./constants.js');
const { retryApiCall } = require('./api.js');

const CACHE_KEY_PREFIX = 'catsuggest-wikidata-categories-';
const CACHE_TTL = 86400;
const MAX_IDS_PER_PROPERTY = 10;

/**
 * Entity ids from a property's statements, skipping deprecated ranks and
 * preferring preferred ranks.
 *
 * @param {Object} entity - Wikidata entity
 * @param {string} property - Property id (e.g. 'P39')
 * @return {string[]}
 */
function getClaimIds(entity, property) {
	const statements = (entity.claims && entity.claims[property]) || [];
	const ranked = statements
		.filter((statement) => statement.rank !== 'deprecated')
		.sort((a, b) => (b.rank === 'preferred' ? 1 : 0) - (a.rank === 'preferred' ? 1 : 0));
	const ids = [];
	ranked.forEach((statement) => {
		const snak = statement.mainsnak;
		if (
			snak &&
			snak.snaktype === 'value' &&
			snak.datavalue &&
			snak.datavalue.type === 'wikibase-entityid' &&
			snak.datavalue.value &&
			snak.datavalue.value.id
		) {
			ids.push(snak.datavalue.value.id);
		}
	});
	return ids.slice(0, MAX_IDS_PER_PROPERTY);
}

/**
 * Entity ids from a qualifier on a property's statements.
 *
 * @param {Object} entity - Wikidata entity
 * @param {string} property - Statement property id (e.g. 'P463')
 * @param {string} qualifier - Qualifier property id (e.g. 'P6365')
 * @return {string[]}
 */
function getQualifierIds(entity, property, qualifier) {
	const statements = (entity.claims && entity.claims[property]) || [];
	const ids = [];
	statements.forEach((statement) => {
		if (statement.rank === 'deprecated') {
			return;
		}
		const snaks = (statement.qualifiers && statement.qualifiers[qualifier]) || [];
		snaks.forEach((snak) => {
			if (
				snak.snaktype === 'value' &&
				snak.datavalue &&
				snak.datavalue.type === 'wikibase-entityid' &&
				snak.datavalue.value &&
				snak.datavalue.value.id
			) {
				ids.push(snak.datavalue.value.id);
			}
		});
	});
	return ids.slice(0, MAX_IDS_PER_PROPERTY);
}

/**
 * Fetch a set of entities by id, resolved through redirects.
 *
 * @param {{get: Function}} wikidataApi - Wikidata API object
 * @param {string[]} ids - Entity ids
 * @return {Promise<Map<string, Object>>}
 */
async function fetchEntities(wikidataApi, ids) {
	const uniqueIds = [...new Set(ids.filter(Boolean))];
	const result = new Map();
	for (let i = 0; i < uniqueIds.length; i += 50) {
		const batch = uniqueIds.slice(i, i + 50);
		const resp = await retryApiCall(() =>
			wikidataApi.get({
				action: 'wbgetentities',
				ids: batch.join('|'),
				props: 'claims|sitelinks',
				redirects: 'yes',
				format: 'json',
			})
		);
		Object.values(resp.entities || {}).forEach((entity) => {
			if (entity && entity.id) {
				result.set(entity.id, entity);
			}
		});
	}
	return result;
}

/**
 * The azwiki category title for an entity, if its sitelink is in ns14.
 *
 * @param {Object} entity - Wikidata entity
 * @return {string|null}
 */
function azwikiCategoryTitle(entity) {
	const sitelink = entity && entity.sitelinks && entity.sitelinks.azwiki;
	if (!sitelink || !sitelink.title) {
		return null;
	}
	const title = sitelink.title.replace(/_/g, ' ');
	return title.startsWith(CATEGORY_PREFIX) ? title : null;
}

/**
 * Derive azwiki categories from a page's Wikidata statements:
 * P463 (member of) → P6365 (member category), and P39 (position held) →
 * P2354 (has list) → P910 (topic's main category).
 *
 * @param {{get: Function}} wikidataApi - Wikidata API object
 * @param {string} qid - Page's Wikidata item id
 * @return {Promise<string[]>} Category titles
 */
async function fetchWikidataDerivedCategories(wikidataApi, qid) {
	if (!qid) {
		return [];
	}

	const cacheKey = CACHE_KEY_PREFIX + qid;
	const cached = mw.storage.get(cacheKey);
	if (cached) {
		try {
			const entries = JSON.parse(cached);
			if (Array.isArray(entries)) {
				return entries;
			}
		} catch (_err) {
			mw.storage.remove(cacheKey);
		}
	}

	try {
		const pageEntities = await fetchEntities(wikidataApi, [qid]);
		const pageEntity = pageEntities.get(qid) || Object.values(pageEntities)[0];
		if (!pageEntity) {
			return [];
		}

		const membershipIds = getClaimIds(pageEntity, 'P463');
		const memberCategoryIds = getQualifierIds(pageEntity, 'P463', 'P6365');
		const positionIds = getClaimIds(pageEntity, 'P39');

		const membershipEntities = await fetchEntities(wikidataApi, membershipIds);
		membershipIds.forEach((id) => {
			const entity = membershipEntities.get(id);
			if (entity) {
				getClaimIds(entity, 'P6365').forEach((catId) => memberCategoryIds.push(catId));
			}
		});

		const positionEntities = await fetchEntities(wikidataApi, positionIds);
		const listIds = [];
		positionIds.forEach((id) => {
			const entity = positionEntities.get(id);
			if (entity) {
				getClaimIds(entity, 'P2354').forEach((listId) => listIds.push(listId));
			}
		});

		const listEntities = await fetchEntities(wikidataApi, listIds);
		const categoryIds = memberCategoryIds.slice();
		const titles = [];
		listIds.forEach((id) => {
			const entity = listEntities.get(id);
			if (!entity) {
				return;
			}
			const direct = azwikiCategoryTitle(entity);
			if (direct) {
				titles.push(direct);
			}
			getClaimIds(entity, 'P910').forEach((catId) => categoryIds.push(catId));
		});

		const categoryEntities = await fetchEntities(wikidataApi, categoryIds);
		categoryIds.forEach((id) => {
			const entity = categoryEntities.get(id);
			const title = azwikiCategoryTitle(entity);
			if (title) {
				titles.push(title);
			}
		});

		const uniqueTitles = [...new Set(titles)];
		mw.storage.set(cacheKey, JSON.stringify(uniqueTitles), CACHE_TTL);
		return uniqueTitles;
	} catch (err) {
		mw.log.warn('CatSuggest Wikidata category error:', err);
		return [];
	}
}

module.exports = {
	fetchWikidataDerivedCategories,
};
