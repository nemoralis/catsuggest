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
	ALLOWED_NAMESPACES,
	ANCESTOR_CHECK_DEPTH,
	log,
} = require('./constants.js');
const { fetchFullQuery } = require('./api.js');
const { fetchPageContent } = require('./edit.js');
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

	const pageCategoryName = CATEGORY_PREFIX + currentPageTitle;
	suggestions.forEach((s) => {
		const parents = parentMap.get(s.title) || [];
		parents.forEach((p) => {
			if (currentCatsSet.has(p) && !templateAddedCats.has(p) && p !== pageCategoryName) {
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

	// Compute all transitive descendants (within currentCats) for each category.
	const allDescendants = new Map();
	currentCats.forEach((cat) => {
		const desc = new Set();
		const queue = [...(childMap.get(cat) || [])];
		const visited = new Set([cat]);
		while (queue.length > 0) {
			const node = queue.shift();
			if (visited.has(node)) {
				continue;
			}
			visited.add(node);
			desc.add(node);
			(childMap.get(node) || []).forEach((child) => {
				if (!visited.has(child)) {
					queue.push(child);
				}
			});
		}
		allDescendants.set(cat, desc);
	});

	// candidateMap: a category is removable if it has transitive descendants on the page.
	// .reasons stores only direct children (for display clarity in the UI).
	// The algorithm uses allDescendants to check for surviving descendants.
	const candidateMap = new Map();
	const pageCategoryName = currentPageTitle ? CATEGORY_PREFIX + currentPageTitle : '';
	currentCats.forEach((cat) => {
		if (templateAddedCats.has(cat)) {
			return;
		}
		if (pageCategoryName && cat === pageCategoryName) {
			return;
		}
		const directChildren = childMap.get(cat) || [];
		const descendants = allDescendants.get(cat);
		if (descendants && descendants.size > 0) {
			candidateMap.set(cat, { title: cat, selected: false, reasons: directChildren.slice() });
		}
	});

	// Build the valid removal set upward from empty.
	// A candidate qualifies if at least one of its transitive descendants will survive
	// on the page (i.e., is not itself in the removal set).
	const removalMap = new Map();
	let changed = true;
	while (changed) {
		changed = false;
		for (const [title, entry] of candidateMap) {
			if (removalMap.has(title)) {
				continue;
			}
			const descendants = allDescendants.get(title);
			const hasSurvivingDescendant = descendants
				? [...descendants].some((d) => !removalMap.has(d))
				: false;
			if (hasSurvivingDescendant) {
				removalMap.set(title, entry);
				changed = true;
			}
		}
	}

	log(
		'Existing removals:',
		Array.from(removalMap.values()).map((r) => `${r.title} ← ${r.reasons.join(', ')}`)
	);

	return Array.from(removalMap.values());
}

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
