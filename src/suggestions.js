const {
	BATCH_SIZE_API,
	CATEGORY_PREFIX,
	CURRENT_WIKI,
	CACHE_KEY_FOREIGN_PREFIX,
	CACHE_KEY_MEMBERS_FOREIGN_PREFIX,
	CACHE_TTL_FOREIGN,
	EXCLUDED_TITLE_KEYWORDS,
	EXCLUDED_KEYWORD_ALLOW_PATTERNS,
	EXCLUDED_TITLES,
	REMOVAL_EXCLUDED_KEYWORDS,
	ALLOWED_NAMESPACES,
	ANCESTOR_CHECK_DEPTH,
	log,
} = require('./constants.js');
const { fetchFullQuery } = require('./api.js');
const { fetchPageContent } = require('./edit.js');
/**
 * Fetch parent categories of a page from a foreign wiki via langlinks.
 * Results are cached in mw.storage and added to globalCatToSites map.
 *
 * @param {Object} foreignApi
 * @param {Object} siteData
 * @param {string} lang
 * @param {Map} globalCatToSites
 * @param {string} qid
 * @return {Promise|undefined}
 */
function fetchParentCatsSuggestions(foreignApi, siteData, lang, globalCatToSites, qid) {
	const cacheKey = CACHE_KEY_FOREIGN_PREFIX + qid + '-' + siteData.site;
	const cached = mw.storage.get(cacheKey);
	if (cached) {
		try {
			const cachedItems = JSON.parse(cached);
			if (Array.isArray(cachedItems)) {
				log('[parentCats]', siteData.site, '→ cache hit:', cachedItems);
				cachedItems.forEach((catTitle) => {
					if (!globalCatToSites.has(catTitle)) {
						globalCatToSites.set(catTitle, new Set());
					}
					globalCatToSites.get(catTitle).add(lang);
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
		prop: 'langlinks',
		lllang: CURRENT_WIKI.replace('wiki', ''),
	}).then((catResp) => {
		const pages = catResp.pages || {};
		const azwikiCatsForCache = [];
		Object.values(pages).forEach((p) => {
			if (p.langlinks && p.langlinks.length > 0) {
				const azwikiTitle = p.langlinks[0]['*'];
				azwikiCatsForCache.push(azwikiTitle);
				if (!globalCatToSites.has(azwikiTitle)) {
					globalCatToSites.set(azwikiTitle, new Set());
				}
				globalCatToSites.get(azwikiTitle).add(lang);
			}
		});
		if (azwikiCatsForCache.length > 0) {
			log('[parentCats]', siteData.site, '→ API result:', azwikiCatsForCache);
			mw.storage.set(cacheKey, JSON.stringify(azwikiCatsForCache), CACHE_TTL_FOREIGN);
		}
	});
}

/**
 * Fetch category members (pages + subcats) of a page from a foreign wiki via langlinks.
 * Results are cached in mw.storage and added to globalCatToSites map.
 *
 * @param {Object} foreignApi
 * @param {Object} siteData
 * @param {string} lang
 * @param {Map} globalCatToSites
 * @param {string} qid
 * @return {Promise|undefined}
 */
function fetchMembersSuggestions(foreignApi, siteData, lang, globalCatToSites, qid) {
	const cacheKey = CACHE_KEY_MEMBERS_FOREIGN_PREFIX + qid + '-' + siteData.site;
	const cached = mw.storage.get(cacheKey);
	if (cached) {
		try {
			const cachedItems = JSON.parse(cached);
			if (Array.isArray(cachedItems)) {
				log('[members]', siteData.site, '→ cache hit:', cachedItems);
				cachedItems.forEach((catTitle) => {
					if (!globalCatToSites.has(catTitle)) {
						globalCatToSites.set(catTitle, new Set());
					}
					globalCatToSites.get(catTitle).add(lang);
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
		prop: 'langlinks',
		lllang: CURRENT_WIKI.replace('wiki', ''),
	}).then((memberResp) => {
		const pages = memberResp.pages || {};
		const azwikiCatsForCache = [];
		Object.values(pages).forEach((p) => {
			if (p.langlinks && p.langlinks.length > 0) {
				const azwikiTitle = p.langlinks[0]['*'];
				azwikiCatsForCache.push(azwikiTitle);
				if (!globalCatToSites.has(azwikiTitle)) {
					globalCatToSites.set(azwikiTitle, new Set());
				}
				globalCatToSites.get(azwikiTitle).add(lang);
			}
		});
		if (azwikiCatsForCache.length > 0) {
			mw.storage.set(cacheKey, JSON.stringify(azwikiCatsForCache), CACHE_TTL_FOREIGN);
		}
	});
}

/**
 * @param {Array<{title: string, sources: string[]}>} rawResults - Candidate suggestions from foreign wikis
 * @param {string[]} currentCats - Categories already on the page
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {string} currentPageTitle - Title of the current page (no prefix)
 * @param {Set<string>} templateAddedCats - Categories added via templates (excluded from removals)
 * @return {Promise<{suggestions: Array, parentMap: Map}>}
 */
async function buildParentCatsSuggestions(
	rawResults,
	currentCats,
	api,
	currentPageTitle,
	templateAddedCats = new Set()
) {
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

	// Returns true if `currentPageTitle` is an ancestor of `title` — meaning
	// the suggestion is a subcategory (descendant) of the current page.
	// Adding a child as a parent would create a cycle.
	const isDescendantOfCurrentPage = (title) => {
		if (!currentPageTitle) {
			return false;
		}
		const normalizedCurrent = currentPageTitle.replace(/_/g, ' ');
		const visited = new Set();
		const queue = [title];
		while (queue.length > 0) {
			const node = queue.shift();
			if (visited.has(node)) {
				continue;
			}
			visited.add(node);
			const parents = parentMap.get(node) || [];
			for (const p of parents) {
				if (p === normalizedCurrent || p.replace(/_/g, ' ') === normalizedCurrent) {
					return true;
				}
				if (!visited.has(p)) {
					queue.push(p);
				}
			}
		}
		return false;
	};

	const seenTitles = new Set();
	let suggestions = rawResults
		.filter((r) => {
			if (EXCLUDED_TITLES.has(r.title)) {
				return false;
			}
			if (
				EXCLUDED_TITLE_KEYWORDS.some((kw) => r.title.includes(kw)) &&
				!EXCLUDED_KEYWORD_ALLOW_PATTERNS.some((pattern) => pattern.test(r.title))
			) {
				return false;
			}
			const alreadyOnPage = currentCatsSet.has(r.title);
			const isAncestor = allAncestors.has(r.title);
			const isDescendant = isDescendantOfCurrentPage(r.title);
			if (!alreadyOnPage && !isAncestor && !isDescendant && !seenTitles.has(r.title)) {
				seenTitles.add(r.title);
				return true;
			}
			log(
				'Filtered out:',
				r.title,
				'| alreadyOnPage:',
				alreadyOnPage,
				'| isAncestor:',
				isAncestor,
				'| isDescendant:',
				isDescendant
			);
			return false;
		})
		.map((r) => ({
			title: r.title,
			selected: true,
			sources: r.sources,
			removals: [],
		}));

	// Filter out suggestions that are a (direct) parent of another suggestion
	const suggestionSet = new Set(suggestions.map((s) => s.title));
	const parentOfAnother = new Set();
	suggestions.forEach((s) => {
		const parents = parentMap.get(s.title) || [];
		parents.forEach((p) => {
			if (suggestionSet.has(p)) {
				parentOfAnother.add(p);
			}
		});
	});
	const filtered = suggestions.filter((s) => !parentOfAnother.has(s.title));
	log('Removed due to parent in suggestions:', Array.from(parentOfAnother));
	suggestions = filtered;

	log(
		'Final suggestions:',
		suggestions.map((s) => s.title)
	);

	const isRemovalExcluded = (title) => REMOVAL_EXCLUDED_KEYWORDS.some((kw) => title.includes(kw));

	const pageCategoryName = CATEGORY_PREFIX + currentPageTitle;
	suggestions.forEach((s) => {
		const parents = parentMap.get(s.title) || [];
		parents.forEach((p) => {
			if (
				currentCatsSet.has(p) &&
				!templateAddedCats.has(p) &&
				p !== pageCategoryName &&
				!isRemovalExcluded(p)
			) {
				s.removals.push({ title: p, selected: false });
			}
		});
	});
	log(
		'Removals:',
		suggestions
			.filter((s) => s.removals.length > 0)
			.map((s) => `${s.title} → ${s.removals.map((r) => r.title).join(', ')}`)
	);

	return { suggestions, parentMap };
}

/**
 * Detect categories on the page that are redundant because they have
 * descendant categories (direct or transitive) also on the page.
 * Only the highest-level redundant categories are returned.
 *
 * @param {string[]} currentCats - Categories on the page
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {Set<string>} templateAddedCats - Categories added via templates (excluded)
 * @param {Map<string, string[]>} [sharedParentMap] - Pre-fetched parent map to reuse
 * @param {string} currentPageTitle - Current page title (no prefix)
 * @return {Promise<Array<{title: string, selected: boolean, reasons: string[]}>>}
 */
async function buildExistingRemovals(
	currentCats,
	api,
	templateAddedCats = new Set(),
	sharedParentMap = null,
	currentPageTitle = ''
) {
	const currentCatsSet = new Set(currentCats);
	const parentMap = sharedParentMap || new Map();

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

	// Build a reverse map: category → its direct children that are also on the page.
	const childMap = new Map();
	currentCats.forEach((cat) => childMap.set(cat, []));
	currentCats.forEach((cat) => {
		const parents = parentMap.get(cat) || [];
		parents.forEach((p) => {
			if (currentCatsSet.has(p)) {
				childMap.get(p).push(cat);
			}
		});
	});

	// Walk up the ancestor chain (up to ANCESTOR_CHECK_DEPTH) for each category to find
	// all on-page ancestors. This detects transitive parent-child relationships even when
	// intermediate categories are not on the page (e.g., grandparent without parent on page).
	const descendantMap = new Map();
	currentCats.forEach((cat) => descendantMap.set(cat, new Set()));

	currentCats.forEach((cat) => {
		const visited = new Set([cat]);
		const queue = [...(parentMap.get(cat) || [])];
		const depths = queue.map(() => 0);
		while (queue.length > 0) {
			const node = queue.shift();
			const nodeDepth = depths.shift();
			if (visited.has(node)) {
				continue;
			}
			visited.add(node);
			if (currentCatsSet.has(node) && node !== cat) {
				descendantMap.get(node).add(cat);
			}
			if (nodeDepth < ANCESTOR_CHECK_DEPTH) {
				const parents = parentMap.get(node) || [];
				parents.forEach((p) => {
					if (!visited.has(p)) {
						queue.push(p);
						depths.push(nodeDepth + 1);
					}
				});
			}
		}
	});

	// Walk up from a node through parentMap to find the closest on-page category
	// (or the candidate itself) — handles missing intermediate categories.
	// Depth-limited by ANCESTOR_CHECK_DEPTH and memoized to avoid redundant BFS.
	const findTreeParentCache = new Map();
	const findTreeParent = (node, candidate) => {
		const cacheKey = node + '\0' + candidate;
		if (findTreeParentCache.has(cacheKey)) {
			return findTreeParentCache.get(cacheKey);
		}
		const visited = new Set();
		const queue = [...(parentMap.get(node) || [])];
		const depths = queue.map(() => 0);
		let result = null;
		while (queue.length > 0) {
			const p = queue.shift();
			const pDepth = depths.shift();
			if (visited.has(p)) {
				continue;
			}
			visited.add(p);
			if (p === candidate || currentCatsSet.has(p)) {
				result = p;
				break;
			}
			if (pDepth < ANCESTOR_CHECK_DEPTH) {
				const grandparents = parentMap.get(p) || [];
				for (const gp of grandparents) {
					if (!visited.has(gp)) {
						queue.push(gp);
						depths.push(pDepth + 1);
					}
				}
			}
		}
		findTreeParentCache.set(cacheKey, result);
		return result;
	};

	// Build a tree using path-finding through parentMap.
	const buildDescendantTree = (ancestorTitle, descendantSet) => {
		const treeMap = new Map();
		treeMap.set(ancestorTitle, []);
		descendantSet.forEach((d) => {
			const parentInTree = findTreeParent(d, ancestorTitle);
			if (parentInTree && !treeMap.has(parentInTree)) {
				treeMap.set(parentInTree, []);
			}
			if (parentInTree) {
				treeMap.get(parentInTree).push(d);
			}
		});
		const toTree = (title) => ({
			title,
			children: (treeMap.get(title) || []).sort().map(toTree),
		});
		return toTree(ancestorTitle).children;
	};

	const isRemovalExcluded = (title) => REMOVAL_EXCLUDED_KEYWORDS.some((kw) => title.includes(kw));

	const candidateMap = new Map();
	const pageCategoryName = currentPageTitle ? CATEGORY_PREFIX + currentPageTitle : '';
	currentCats.forEach((cat) => {
		if (templateAddedCats.has(cat)) {
			return;
		}
		if (pageCategoryName && cat === pageCategoryName) {
			return;
		}
		if (isRemovalExcluded(cat)) {
			return;
		}
		const descendants = descendantMap.get(cat);
		if (descendants && descendants.size > 0) {
			candidateMap.set(cat, {
				title: cat,
				selected: false,
				tree: buildDescendantTree(cat, descendants),
			});
		}
	});

	// Build the valid removal set in a single pass: sort candidates by descendant
	// count ascending (leaves first) and iterate once. This replaces the O(N²)
	// convergence loop — a candidate qualifies if at least one of its transitive
	// descendants will survive on the page (i.e., is not itself in the removal set).
	const removalMap = new Map();
	const sortedCandidates = Array.from(candidateMap.entries()).sort(
		(a, b) =>
			(descendantMap.get(a[0]) || { size: 0 }).size -
			(descendantMap.get(b[0]) || { size: 0 }).size
	);
	for (const [title, entry] of sortedCandidates) {
		const descendants = descendantMap.get(title);
		const hasSurvivingDescendant = descendants
			? [...descendants].some((d) => !removalMap.has(d))
			: false;
		if (hasSurvivingDescendant) {
			removalMap.set(title, entry);
		}
	}

	log(
		'Existing removals:',
		Array.from(removalMap.values()).map(
			(r) => `${r.title} ← ${r.tree.map((t) => t.title).join(', ')}`
		)
	);

	return Array.from(removalMap.values());
}

/**
 * @param {Array<{title: string, sources: string[]}>} rawResults - Candidate suggestions from foreign wikis
 * @param {{ members: Set<string>, subcats: Set<string> }} localData - Current page members/subcats
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {Set<string>} currentPageCats - Categories the current page belongs to (to filter out parents)
 * @return {Promise<Array<{title: string, selected: boolean, sources: string[], isCategory: boolean}>>}
 */
async function buildMembersSuggestions(rawResults, localData, api, currentPageCats = new Set()) {
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
			if (EXCLUDED_TITLES.has(item.title)) {
				return false;
			}
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
			if (currentPageCats.has(item.title)) {
				log('Filtered out parent of current page:', item.title);
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

/**
 * Compare wikitext [[Category:...]] links against API-reported categories
 * to determine which ones were added by templates (present in API but not in raw wikitext).
 *
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {string} pageTitle - Current page title
 * @param {string[]} currentCats - Categories reported by the API/wgCategories
 * @return {Promise<Set<string>>}
 */
async function detectTemplateAddedCategories(api, pageTitle, currentCats) {
	let content;
	try {
		content = await fetchPageContent(api, pageTitle);
	} catch (e) {
		return new Set();
	}

	// Parse direct [[Category:...]] / [[Kateqoriya:...]] from wikitext
	const directCats = new Set();
	const catRe = /\[\[\s*(?:Kateqoriya|Category)\s*:\s*([^\]|]+?)\s*(?:\|[^\]]*?)?\]\]/gi;
	let match;
	while ((match = catRe.exec(content)) !== null) {
		directCats.add(CATEGORY_PREFIX + match[1].trim());
	}

	// Template-added = currentCats (from API/wgCategories) minus directCats (from wikitext)
	const templateAdded = new Set();
	for (const c of currentCats) {
		if (!directCats.has(c)) {
			templateAdded.add(c);
		}
	}

	log('Template-added categories:', Array.from(templateAdded));

	return templateAdded;
}

module.exports = {
	fetchParentCatsSuggestions,
	fetchMembersSuggestions,
	buildParentCatsSuggestions,
	buildExistingRemovals,
	buildMembersSuggestions,
	detectTemplateAddedCategories,
};
