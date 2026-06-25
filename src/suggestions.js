const {
	BATCH_SIZE_API,
	CATEGORY_PREFIX,
	CURRENT_WIKI,
	CACHE_KEY_FOREIGN_PREFIX,
	CACHE_KEY_MEMBERS_FOREIGN_PREFIX,
	CACHE_TTL_FOREIGN,
	EXCLUDED_TITLE_KEYWORDS,
	EXCLUDED_KEYWORD_ALLOW_PATTERNS,
	ALLOWED_NAMESPACES,
	ANCESTOR_CHECK_DEPTH,
	log,
} = require('./constants.js');
const { fetchFullQuery, retryApiCall } = require('./api.js');
const { qidAzwikiCache, loadQidCache, saveQidCache } = require('./cache.js');

function fetchParentCatsSuggestions(foreignApi, siteData, lang, globalQidSet, qidToSites, qid) {
	const cacheKey = CACHE_KEY_FOREIGN_PREFIX + qid + '-' + siteData.site;
	const cached = mw.storage.get(cacheKey);
	if (cached) {
		try {
			const cachedItems = JSON.parse(cached);
			if (
				Array.isArray(cachedItems) &&
				cachedItems.length > 0 &&
				typeof cachedItems[0] === 'string' &&
				cachedItems[0].startsWith('Q')
			) {
				log('[parentCats]', siteData.site, '→ cache hit:', cachedItems);
				cachedItems.forEach((qidItem) => {
					globalQidSet.add(qidItem);
					if (!qidToSites.has(qidItem)) {
						qidToSites.set(qidItem, new Set());
					}
					qidToSites.get(qidItem).add(lang);
				});
				return;
			}
			mw.storage.remove(cacheKey);
		} catch (_err) {
			mw.log.warn('Foreign cache error:', _err);
			mw.storage.remove(cacheKey);
		}
	}

	log('[parentCats]', siteData.site, '→ fetching from API...');
	return fetchFullQuery(foreignApi, {
		action: 'query',
		generator: 'categories',
		titles: siteData.title,
		gcllimit: 'max',
		gclshow: '!hidden',
		prop: 'pageprops',
		ppprop: 'wikibase_item',
	}).then((catResp) => {
		const pages = catResp.pages || {};
		const catQidsForCache = [];
		Object.values(pages).forEach((p) => {
			if (p.pageprops && p.pageprops.wikibase_item) {
				const qidItem = p.pageprops.wikibase_item;
				globalQidSet.add(qidItem);
				catQidsForCache.push(qidItem);
				if (!qidToSites.has(qidItem)) {
					qidToSites.set(qidItem, new Set());
				}
				qidToSites.get(qidItem).add(lang);
			}
		});
		if (catQidsForCache.length > 0) {
			log('[parentCats]', siteData.site, '→ API result:', catQidsForCache);
			mw.storage.set(cacheKey, JSON.stringify(catQidsForCache), CACHE_TTL_FOREIGN);
		}
	});
}

function fetchMembersSuggestions(foreignApi, siteData, lang, globalQidSet, qidToSites, qid) {
	const cacheKey = CACHE_KEY_MEMBERS_FOREIGN_PREFIX + qid + '-' + siteData.site;
	const cached = mw.storage.get(cacheKey);
	if (cached) {
		try {
			const cachedItems = JSON.parse(cached);
			if (
				Array.isArray(cachedItems) &&
				cachedItems.length > 0 &&
				typeof cachedItems[0] === 'string' &&
				cachedItems[0].startsWith('Q')
			) {
				log('[members]', siteData.site, '→ cache hit:', cachedItems);
				cachedItems.forEach((qidItem) => {
					globalQidSet.add(qidItem);
					if (!qidToSites.has(qidItem)) {
						qidToSites.set(qidItem, new Set());
					}
					qidToSites.get(qidItem).add(lang);
				});
				return;
			}
			mw.storage.remove(cacheKey);
		} catch (_err) {
			mw.log.warn('Members foreign cache error:', _err);
			mw.storage.remove(cacheKey);
		}
	}

	log('[members]', siteData.site, '→ fetching from API...');
	return fetchFullQuery(foreignApi, {
		action: 'query',
		generator: 'categorymembers',
		gcmtitle: siteData.title,
		gcmlimit: 'max',
		gcmtype: 'page|subcat',
		prop: 'pageprops',
		ppprop: 'wikibase_item',
	}).then((memberResp) => {
		const pages = memberResp.pages || {};
		const memberQidsForCache = [];
		Object.values(pages).forEach((p) => {
			if (p.pageprops && p.pageprops.wikibase_item) {
				const qidItem = p.pageprops.wikibase_item;
				globalQidSet.add(qidItem);
				memberQidsForCache.push(qidItem);
				if (!qidToSites.has(qidItem)) {
					qidToSites.set(qidItem, new Set());
				}
				qidToSites.get(qidItem).add(lang);
			}
		});
		if (memberQidsForCache.length > 0) {
			mw.storage.set(cacheKey, JSON.stringify(memberQidsForCache), CACHE_TTL_FOREIGN);
		}
	});
}

async function resolveQidsToAzwiki(globalQidSet, qidToSites, signal, wikidataApi) {
	loadQidCache();
	const uncachedQids = [];
	const results = [];

	globalQidSet.forEach((qid) => {
		if (qidAzwikiCache.has(qid)) {
			const title = qidAzwikiCache.get(qid);
			if (title) {
				results.push({
					qid,
					title,
					sources: Array.from(qidToSites.get(qid) || []),
				});
			}
		} else {
			uncachedQids.push(qid);
		}
	});

	if (uncachedQids.length > 0) {
		const resolvePromises = [];
		for (let i = 0; i < uncachedQids.length; i += BATCH_SIZE_API) {
			if (signal && signal.aborted) {
				throw new DOMException('Aborted', 'AbortError');
			}
			const batch = uncachedQids.slice(i, i + BATCH_SIZE_API);
			resolvePromises.push(
				retryApiCall(() =>
					wikidataApi.get({
						action: 'wbgetentities',
						ids: batch.join('|'),
						props: 'sitelinks',
						sitefilter: CURRENT_WIKI,
						format: 'json',
					})
				)
			);
		}

		const resolveResults = await Promise.all(resolvePromises);
		resolveResults.forEach((wdResp) => {
			if (!wdResp.entities) {
				return;
			}
			Object.entries(wdResp.entities).forEach(([qid, ent]) => {
				if (ent.sitelinks && ent.sitelinks[CURRENT_WIKI]) {
					const title = ent.sitelinks[CURRENT_WIKI].title;
					qidAzwikiCache.set(qid, title);
					results.push({
						qid,
						title,
						sources: Array.from(qidToSites.get(qid) || []),
					});
				} else {
					qidAzwikiCache.set(qid, null);
				}
			});
		});
	}

	log(
		'QID resolution complete →',
		results.map((r) => r.title)
	);
	saveQidCache();

	return results;
}

async function buildParentCatsSuggestions(rawResults, currentCats, api) {
	const currentCatsSet = new Set(currentCats);
	const suggestionTitles = rawResults.map((r) => r.title);

	const parentMap = new Map();

	const fetchParentsForTitles = async (titles) => {
		const toFetch = titles.filter((t) => !parentMap.has(t));
		if (toFetch.length === 0) {
			return;
		}

		const batchPromises = [];
		for (let i = 0; i < toFetch.length; i += BATCH_SIZE_API) {
			const batch = toFetch.slice(i, i + BATCH_SIZE_API);
			batchPromises.push(
				fetchFullQuery(api, {
					action: 'query',
					titles: batch.join('|'),
					prop: 'categories',
					cllimit: 'max',
				})
			);
		}

		const queryResults = await Promise.all(batchPromises);
		queryResults.forEach((res) => {
			const pages = res.pages || {};
			Object.values(pages).forEach((p) => {
				const cats = p.categories ? p.categories.map((c) => c.title) : [];
				parentMap.set(p.title, cats);
			});
		});

		toFetch.forEach((t) => {
			if (!parentMap.has(t)) {
				parentMap.set(t, []);
			}
		});
	};

	log(
		'buildParentCatsSuggestions | raw candidates:',
		rawResults.map((r) => r.title),
		'| current cats:',
		currentCats
	);

	await fetchParentsForTitles(suggestionTitles);

	let currentLevel = currentCats.slice();
	const allAncestors = new Set();

	for (let depth = 0; depth < ANCESTOR_CHECK_DEPTH; depth++) {
		log('Ancestor walk depth', depth, '| checking', currentLevel.length, 'nodes');
		await fetchParentsForTitles(currentLevel);

		const nextLevel = [];
		currentLevel.forEach((title) => {
			const parents = parentMap.get(title) || [];
			parents.forEach((p) => {
				allAncestors.add(p);
				if (!parentMap.has(p)) {
					nextLevel.push(p);
				}
			});
		});

		if (nextLevel.length === 0) {
			break;
		}
		currentLevel = nextLevel;
	}

	log('Ancestors of current cats:', Array.from(allAncestors));
	const seenTitles = new Set();
	const suggestions = rawResults
		.filter((r) => {
			if (
				EXCLUDED_TITLE_KEYWORDS.some((kw) => r.title.includes(kw)) &&
				!EXCLUDED_KEYWORD_ALLOW_PATTERNS.some((pattern) => pattern.test(r.title))
			) {
				return false;
			}
			const alreadyOnPage = currentCatsSet.has(r.title);
			const isAncestor = allAncestors.has(r.title);
			if (!alreadyOnPage && !isAncestor && !seenTitles.has(r.title)) {
				seenTitles.add(r.title);
				return true;
			}
			log(
				'Filtered out:',
				r.title,
				'| alreadyOnPage:',
				alreadyOnPage,
				'| isAncestor:',
				isAncestor
			);
			return false;
		})
		.map((r) => ({
			title: r.title,
			selected: true,
			sources: r.sources,
			removals: [],
		}));
	log(
		'Final suggestions:',
		suggestions.map((s) => s.title)
	);

	suggestions.forEach((s) => {
		const parents = parentMap.get(s.title) || [];
		parents.forEach((p) => {
			if (currentCatsSet.has(p)) {
				s.removals.push({ title: p, selected: true });
			}
		});
	});
	log(
		'Removals:',
		suggestions
			.filter((s) => s.removals.length > 0)
			.map((s) => `${s.title} → ${s.removals.map((r) => r.title).join(', ')}`)
	);

	return suggestions;
}

async function buildExistingRemovals(currentCats, api) {
	const currentCatsSet = new Set(currentCats);
	const parentMap = new Map();

	const toFetch = currentCats.filter((t) => !parentMap.has(t));
	const batchPromises = [];
	for (let i = 0; i < toFetch.length; i += BATCH_SIZE_API) {
		const batch = toFetch.slice(i, i + BATCH_SIZE_API);
		batchPromises.push(
			fetchFullQuery(api, {
				action: 'query',
				titles: batch.join('|'),
				prop: 'categories',
				cllimit: 'max',
			})
		);
	}
	const queryResults = await Promise.all(batchPromises);
	queryResults.forEach((res) => {
		const pages = res.pages || {};
		Object.values(pages).forEach((p) => {
			const cats = p.categories ? p.categories.map((c) => c.title) : [];
			parentMap.set(p.title, cats);
		});
	});
	toFetch.forEach((t) => {
		if (!parentMap.has(t)) parentMap.set(t, []);
	});

	const removalMap = new Map();
	currentCats.forEach((cat) => {
		const parents = parentMap.get(cat) || [];
		parents.forEach((p) => {
			if (currentCatsSet.has(p)) {
				const existing = removalMap.get(p);
				if (existing) {
					if (!existing.reasons.includes(cat)) existing.reasons.push(cat);
				} else {
					removalMap.set(p, { title: p, selected: true, reasons: [cat] });
				}
			}
		});
	});

	log(
		'Existing removals:',
		Array.from(removalMap.values()).map((r) => `${r.title} ← ${r.reasons.join(', ')}`)
	);

	return Array.from(removalMap.values());
}

async function buildMembersSuggestions(rawResults, localData, api) {
	const { members: currentMembersSet, subcats: currentSubcatsSet } = localData;
	const suggestionTitles = rawResults.map((r) => r.title);
	const allPagesCats = new Map();

	const catFetchPromises = [];
	for (let i = 0; i < suggestionTitles.length; i += BATCH_SIZE_API) {
		const batch = suggestionTitles.slice(i, i + BATCH_SIZE_API);
		catFetchPromises.push(
			fetchFullQuery(api, {
				action: 'query',
				titles: batch.join('|'),
				prop: 'categories',
				cllimit: 'max',
			})
		);
	}

	const catFetchResults = await Promise.all(catFetchPromises);
	catFetchResults.forEach((res) => {
		const pages = res.pages || {};
		Object.values(pages).forEach((p) => {
			if (p.categories) {
				allPagesCats.set(
					p.title,
					p.categories.map((c) => c.title)
				);
			}
		});
	});

	const seenTitles = new Set();
	const suggestions = rawResults
		.filter((item) => {
			const ns = new mw.Title(item.title).getNamespaceId();
			if (!ALLOWED_NAMESPACES.includes(ns)) {
				return false;
			}

			if (
				EXCLUDED_TITLE_KEYWORDS.some((kw) => item.title.includes(kw)) &&
				!EXCLUDED_KEYWORD_ALLOW_PATTERNS.some((pattern) => pattern.test(item.title))
			) {
				return false;
			}
			if (currentMembersSet.has(item.title) || seenTitles.has(item.title)) {
				return false;
			}
			seenTitles.add(item.title);
			const itemCats = allPagesCats.get(item.title) || [];
			return !itemCats.some((c) => currentSubcatsSet.has(c));
		})
		.map((item) => ({
			title: item.title,
			selected: true,
			sources: item.sources,
			isCategory: item.title.startsWith(CATEGORY_PREFIX),
		}));

	return suggestions;
}

module.exports = {
	fetchParentCatsSuggestions,
	fetchMembersSuggestions,
	resolveQidsToAzwiki,
	buildParentCatsSuggestions,
	buildExistingRemovals,
	buildMembersSuggestions,
};
