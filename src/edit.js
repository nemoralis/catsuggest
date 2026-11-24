const { CATEGORY_PREFIX, MAXLAG_SECONDS, TEMPLATE_NAMESPACE } = require('./constants.js');
const { retryApiCall, fetchFullQuery, getApiBatchSize } = require('./api.js');

async function editPage(api, title, params) {
	return api
		.postWithEditToken(
			Object.assign(
				{
					action: 'edit',
					title,
					tags: 'catsuggest',
					nocreate: true,
					maxlag: MAXLAG_SECONDS,
					format: 'json',
				},
				params
			)
		)
		.catch((code, errResult) => {
			const error = new Error(code);
			Object.assign(error, {
				code,
				result: errResult,
				isApiError: true,
			});
			throw error;
		});
}

/**
 * Whether a members-mode suggestion should use the template edit path.
 *
 * @param {number} namespaceId - Namespace id of the suggested page
 * @return {boolean}
 */
function isTemplateMember(namespaceId) {
	return namespaceId === TEMPLATE_NAMESPACE;
}

/**
 * Whether a template edit landed on a different page (i.e. a /doc page), so the
 * template needs a null edit to refresh its category index.
 *
 * @param {string} title - Template title
 * @param {Object} result - Edit result with addedCount and targetTitle
 * @return {boolean}
 */
function needsTemplateLinkRefresh(title, result) {
	return Boolean(
		result &&
		result.addedCount > 0 &&
		result.targetTitle &&
		result.targetTitle.replace(/_/g, ' ') !== title.replace(/_/g, ' ')
	);
}

async function fetchPageContent(api, title) {
	const pageResp = await retryApiCall(() =>
		api.get({
			action: 'query',
			prop: 'revisions',
			titles: title,
			rvprop: 'content',
			redirects: true,
			format: 'json',
		})
	);

	const pages = pageResp.query && pageResp.query.pages;
	if (!pages) {
		throw new Error('Səhifə məlumatları API-dən alınmadı. Səhifənin mövcud olduğunu yoxlayın.');
	}
	const page = Object.values(pages)[0];
	const content = page.revisions && page.revisions[0] && page.revisions[0]['*'];
	if (content === undefined || content === null) {
		throw new Error(
			'Səhifənin məzmunu tapılmadı. Səhifə silinmiş və ya yaradılmamış ola bilər.'
		);
	}
	return content;
}

/**
 * Fetch a page's wikitext together with its revision id and resolved title.
 * Returns null for a missing page (including a redirect to a missing page).
 *
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {string} title - Page title to fetch
 * @return {Promise<{title: string, content: string, revid: number}|null>}
 */
async function fetchPageContentMeta(api, title) {
	const pageResp = await retryApiCall(() =>
		api.get({
			action: 'query',
			prop: 'revisions',
			titles: title,
			rvprop: 'content|ids',
			redirects: true,
			format: 'json',
		})
	);

	const pages = pageResp.query && pageResp.query.pages;
	if (!pages) {
		throw new Error('Səhifə məlumatları API-dən alınmadı. Səhifənin mövcud olduğunu yoxlayın.');
	}
	const page = Object.values(pages)[0];
	if (!page || page.missing !== undefined) {
		return null;
	}
	const revision = page.revisions && page.revisions[0];
	const content = revision && revision['*'];
	if (content === undefined || content === null) {
		throw new Error(
			'Səhifənin məzmunu tapılmadı. Səhifə silinmiş və ya yaradılmamış ola bilər.'
		);
	}
	return { title: page.title, content, revid: revision.revid };
}

/**
 * Resolve a template's /doc page and check whether the current user can edit
 * it. Redirects are followed by the API, so the returned title is the page
 * that should actually be edited.
 *
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {string} templateTitle - Full template title (e.g. "Şablon:Foo")
 * @return {Promise<{exists: boolean, title: string|null, editable: boolean}>}
 */
async function resolveTemplateDoc(api, templateTitle) {
	const resp = await retryApiCall(() =>
		api.get({
			action: 'query',
			prop: 'info',
			titles: templateTitle + '/doc',
			intestactions: 'edit',
			intestactionsdetail: 'quick',
			redirects: true,
			format: 'json',
		})
	);

	const pages = resp.query && resp.query.pages;
	if (!pages) {
		throw new Error('Səhifə məlumatları API-dən alınmadı. Səhifənin mövcud olduğunu yoxlayın.');
	}
	const page = Object.values(pages)[0];
	if (!page || page.missing !== undefined) {
		return { exists: false, title: null, editable: false };
	}
	const editActions = page.actions && page.actions.edit;
	return {
		exists: true,
		title: page.title,
		editable: !Array.isArray(editActions) || editActions.length === 0,
	};
}

/**
 * Blank out HTML comments while preserving string length and line breaks.
 *
 * @param {string} content - Wikitext
 * @return {string} Wikitext with comments replaced by spaces
 */
function maskComments(content) {
	return content.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * @param {string} title - Category title with or without a namespace prefix
 * @return {string} Normalized title, always with the local category prefix
 */
function normalizeCategoryTitle(title) {
	const name = String(title)
		.replace(/^\s*(?:Kateqoriya|Category)\s*:\s*/i, '')
		.replace(/_/g, ' ')
		.trim();
	return CATEGORY_PREFIX + name;
}

/**
 * Extract direct category links from wikitext, ignoring links in comments.
 * Sort keys are discarded; only the category title is returned.
 *
 * @param {string} content - Wikitext
 * @return {Set<string>} Normalized category titles
 */
function extractCategoryTitles(content) {
	const titles = new Set();
	if (!content) {
		return titles;
	}
	const source = maskComments(content);
	const re = /\[\[\s*(?:Kateqoriya|Category)\s*:\s*([^\]|]+?)\s*(?:\|[^\]]*?)?\]\]/gi;
	let match;
	while ((match = re.exec(source)) !== null) {
		titles.add(normalizeCategoryTitle(match[1]));
	}
	return titles;
}

/**
 * Find non-nested <tagName>...</tagName> blocks, ignoring tags in comments.
 *
 * @param {string} content - Wikitext
 * @param {string} tagName - Tag name, e.g. 'includeonly'
 * @return {Array<{start: number, end: number, innerStart: number, innerEnd: number}>}
 */
function extractTagBlocks(content, tagName) {
	if (!content) {
		return [];
	}
	const pattern = new RegExp(
		'(<' + tagName + '\\b[^>]*>)([\\s\\S]*?)(<\\/' + tagName + '\\s*>)',
		'gi'
	);
	const source = maskComments(content);
	const blocks = [];
	let match;
	while ((match = pattern.exec(source)) !== null) {
		const innerStart = match.index + match[1].length;
		blocks.push({
			start: match.index,
			end: match.index + match[0].length,
			innerStart,
			innerEnd: innerStart + match[2].length,
		});
	}
	return blocks;
}

/**
 * Categories that affect the template page from a /doc page: category links
 * inside <includeonly> blocks.
 *
 * @param {string} content - /doc wikitext
 * @return {Set<string>}
 */
function extractIncludeonlyCategories(content) {
	const titles = new Set();
	extractTagBlocks(content, 'includeonly').forEach((block) => {
		extractCategoryTitles(content.slice(block.innerStart, block.innerEnd)).forEach((title) =>
			titles.add(title)
		);
	});
	return titles;
}

/**
 * Categories that affect the template page itself: bare links and links in
 * <noinclude> blocks. <includeonly> links affect transcluding pages instead.
 *
 * @param {string} content - Template wikitext
 * @return {Set<string>}
 */
function extractTemplatePageCategories(content) {
	let remaining = content || '';
	const blocks = extractTagBlocks(remaining, 'includeonly');
	for (let i = blocks.length - 1; i >= 0; i--) {
		remaining = remaining.slice(0, blocks[i].start) + remaining.slice(blocks[i].end);
	}
	return extractCategoryTitles(remaining);
}

/**
 * @param {string} content - Wikitext
 * @param {Array<Object>} blocks - Candidate tag blocks
 * @return {Object|null} Last block containing category links, else last block
 */
function selectTagBlock(content, blocks) {
	let selected = null;
	blocks.forEach((block) => {
		if (extractCategoryTitles(content.slice(block.innerStart, block.innerEnd)).size > 0) {
			selected = block;
		}
	});
	return selected || blocks[blocks.length - 1] || null;
}

/**
 * Start index of a trailing run of stub templates in a tag block's inner text.
 * Comments are masked so a stub mentioned in markup is not treated as one.
 *
 * @param {string} inner - Tag block content
 * @return {number} Index at which new content should be inserted
 */
function findTrailingStubStart(inner) {
	const pattern = /\{\{[^{}|]*-qaralama\b[^{}|]*(?:\|[^{}]*)?\}\}/gi;
	const source = maskComments(inner);
	const matches = [];
	let match;
	while ((match = pattern.exec(source)) !== null) {
		matches.push(match);
	}

	let point = inner.length;
	let after = inner.length;
	for (let i = matches.length - 1; i >= 0; i--) {
		const candidate = matches[i];
		if (!/^\s*$/.test(source.slice(candidate.index + candidate[0].length, after))) {
			break;
		}
		point = candidate.index;
		after = candidate.index;
	}
	return point;
}

/**
 * Insert category links into a tag block, or append a new block at the end.
 *
 * @param {string} content - Original wikitext
 * @param {string} tagName - 'includeonly' or 'noinclude'
 * @param {Array<Object>} items - Links with title and sortKey
 * @return {string} Updated wikitext
 */
function insertCategoriesIntoTagBlock(content, tagName, items) {
	const links = items.map(formatCategoryLink);
	const block = selectTagBlock(content, extractTagBlocks(content, tagName));
	if (!block) {
		const trimmed = content.replace(/\s+$/, '');
		return (
			trimmed +
			(trimmed ? '\n' : '') +
			'<' +
			tagName +
			'>\n' +
			links.join('\n') +
			'\n</' +
			tagName +
			'>\n'
		);
	}
	const inner = content.slice(block.innerStart, block.innerEnd);
	const insertionPoint = findTrailingStubStart(inner);
	const before = inner.slice(0, insertionPoint);
	const separator = before.length === 0 || !/\n[ \t]*$/.test(before) ? '\n' : '';
	const insertion = separator + links.join('\n') + '\n';
	return (
		content.slice(0, block.innerStart + insertionPoint) +
		insertion +
		content.slice(block.innerStart + insertionPoint)
	);
}

/**
 * Choose the success header for a completed edit batch.
 *
 * @param {Object} result
 * @param {number} [result.addedCount]
 * @param {number} [result.removedCount]
 * @param {boolean} [result.aborted]
 * @return {string}
 */
function getEditResultMessage({ addedCount = 0, removedCount = 0, aborted = false } = {}) {
	if (aborted) {
		return 'Redaktə dayandırıldı.';
	}
	if (addedCount > 0 && removedCount > 0) {
		return 'Kateqoriyalar uğurla redaktə edildi!';
	}
	if (removedCount > 0) {
		return 'Kateqoriyalar uğurla silindi!';
	}
	if (addedCount > 0) {
		return 'Kateqoriyalar uğurla əlavə edildi!';
	}
	return 'Dəyişikliklər uğurla tətbiq edildi!';
}

/**
 * Find which pages already contain the given category.
 *
 * Uses the API's category filter so a stale suggestion is skipped instead of
 * appending a duplicate category link. Normalized and redirected titles are
 * mapped back to the original input title.
 *
 * @param {{ get: Function }} api - MediaWiki API object
 * @param {string[]} titles - Page titles to check
 * @param {string} categoryTitle - Full category title (e.g. "Kateqoriya:Foo")
 * @return {Promise<Set<string>>} Input titles that already contain the category
 */
async function findTitlesAlreadyInCategory(api, titles, categoryTitle) {
	const uniqueTitles = [...new Set(titles)];
	if (uniqueTitles.length === 0 || !categoryTitle) {
		return new Set();
	}

	const normalizedCategory = categoryTitle.replace(/_/g, ' ');
	const batchSize = await getApiBatchSize(api);
	const pagesWithCategory = new Set();
	const titleMap = new Map();

	for (let i = 0; i < uniqueTitles.length; i += batchSize) {
		const batch = uniqueTitles.slice(i, i + batchSize);
		const result = await fetchFullQuery(api, {
			action: 'query',
			titles: batch.join('|'),
			prop: 'categories',
			clcategories: normalizedCategory,
			cllimit: 'max',
		});

		(result.normalized || []).forEach((item) =>
			titleMap.set(item.from.replace(/_/g, ' '), item.to.replace(/_/g, ' '))
		);
		(result.redirects || []).forEach((item) =>
			titleMap.set(item.from.replace(/_/g, ' '), item.to.replace(/_/g, ' '))
		);

		Object.values(result.pages || {}).forEach((page) => {
			if (!page.title) {
				return;
			}
			const hasCategory = (page.categories || []).some(
				(category) => category.title.replace(/_/g, ' ') === normalizedCategory
			);
			if (hasCategory) {
				pagesWithCategory.add(page.title.replace(/_/g, ' '));
			}
		});
	}

	const alreadyInCategory = new Set();
	uniqueTitles.forEach((title) => {
		let resolvedTitle = title.replace(/_/g, ' ');
		const visited = new Set();
		while (titleMap.has(resolvedTitle) && !visited.has(resolvedTitle)) {
			visited.add(resolvedTitle);
			resolvedTitle = titleMap.get(resolvedTitle).replace(/_/g, ' ');
		}
		if (pagesWithCategory.has(resolvedTitle)) {
			alreadyInCategory.add(title);
		}
	});

	return alreadyInCategory;
}

/**
 * Normalize a user-supplied category sort key before putting it in a wikilink.
 * Removes characters that would break the link syntax or the wikitext line.
 *
 * @param {string} [value]
 * @return {string}
 */
function sanitizeSortKey(value) {
	if (typeof value !== 'string') {
		return '';
	}
	return value.replace(/[\r\n|[\]]/g, '').trim();
}

/**
 * Build the wikitext for a category link, optionally with a sort key.
 *
 * @param {{ title: string, sortKey?: string }} item
 * @return {string}
 */
function formatCategoryLink({ title, sortKey }) {
	const normalizedTitle = title.replace(/_/g, ' ');
	const key = sanitizeSortKey(sortKey);
	return key ? `[[${normalizedTitle}|${key}]]` : `[[${normalizedTitle}]]`;
}

async function addParentCategoriesEdit(api, pageTitle, titlesToAdd, titlesToRemove, escapeRegex) {
	const summaryParts = [];
	if (titlesToAdd.length > 0) {
		summaryParts.push('+' + titlesToAdd.length + ' kateqoriya');
	}
	if (titlesToRemove.length > 0) {
		summaryParts.push('−' + titlesToRemove.length + ' kateqoriya');
	}
	const summary = '[[VP:Q/KT|Kateqoriya təklifçisi]] vasitəsilə ' + summaryParts.join(', ');

	const params = {
		summary,
		minor: titlesToAdd.length < 2,
	};
	let editTitle = pageTitle;

	if (titlesToRemove.length > 0) {
		const page = await fetchPageContentMeta(api, pageTitle);
		if (!page) {
			throw new Error(
				'Səhifənin məzmunu tapılmadı. Səhifə silinmiş və ya yaradılmamış ola bilər.'
			);
		}
		let content = page.content;

		titlesToRemove.forEach((t) => {
			const catName = t.replace(/^(?:Kateqoriya|Category):/i, '');
			const regex = new RegExp(
				'\\[\\[(?:Kateqoriya|Category)\\s*:\\s*' +
					escapeRegex(catName) +
					'(?:\\|.*?)?\\]\\]\\s*\\n?',
				'gi'
			);
			content = content.replace(regex, '');
		});

		if (titlesToAdd.length > 0) {
			content += '\n' + titlesToAdd.map(formatCategoryLink).join('\n');
		}

		params.text = content;
		params.baserevid = page.revid;
		editTitle = page.title;
	} else {
		params.appendtext = '\n' + titlesToAdd.map(formatCategoryLink).join('\n');
		params.redirect = true;
	}

	await editPage(api, editTitle, params);
}

/**
 * Add categories to a template page, using /doc's <includeonly> when /doc
 * exists and the template's own <noinclude> otherwise.
 *
 * @param {{ get: Function, postWithEditToken: Function }} api - MediaWiki API object
 * @param {string} templateTitle - Full template title (e.g. "Şablon:Foo")
 * @param {Array<Object>} itemsToAdd - Category links with title and sortKey
 * @param {string[]} [existingCategories] - Categories already on the page
 * @return {Promise<{addedCount: number, targetTitle: string|null}>}
 */
async function addTemplateCategoriesEdit(api, templateTitle, itemsToAdd, existingCategories = []) {
	const existing = new Set();
	existingCategories.forEach((title) => existing.add(normalizeCategoryTitle(title)));

	const doc = await fetchPageContentMeta(api, templateTitle + '/doc');
	let targetTitle;
	let content;
	let revid;
	let tagName;

	if (doc) {
		targetTitle = doc.title;
		content = doc.content;
		revid = doc.revid;
		tagName = 'includeonly';
		extractIncludeonlyCategories(content).forEach((title) => existing.add(title));
	} else {
		const template = await fetchPageContentMeta(api, templateTitle);
		if (!template) {
			throw new Error(
				'Səhifənin məzmunu tapılmadı. Səhifə silinmiş və ya yaradılmamış ola bilər.'
			);
		}
		targetTitle = template.title;
		content = template.content;
		revid = template.revid;
		tagName = 'noinclude';
		extractTemplatePageCategories(content).forEach((title) => existing.add(title));
	}

	const newItems = itemsToAdd.filter((item) => {
		const title = normalizeCategoryTitle(item.title);
		if (existing.has(title)) {
			return false;
		}
		existing.add(title);
		return true;
	});

	if (newItems.length === 0) {
		return { addedCount: 0, targetTitle: null };
	}

	await editPage(api, targetTitle, {
		text: insertCategoriesIntoTagBlock(content, tagName, newItems),
		baserevid: revid,
		minor: newItems.length < 2,
		summary: '[[VP:Q/KT|Kateqoriya təklifçisi]] vasitəsilə +' + newItems.length + ' kateqoriya',
	});

	return { addedCount: newItems.length, targetTitle };
}

/**
 * Refresh a template page's derived data with a null edit.
 *
 * Editing a /doc page updates that page's category links, but not the category
 * links of the templates that transclude it. Re-saving the template with
 * identical wikitext creates no revision, but makes MediaWiki rebuild its link
 * tables so the new categories show up in category listings immediately.
 *
 * @param {{ get: Function, postWithEditToken: Function }} api - MediaWiki API object
 * @param {string} templateTitle - Full template title (e.g. "Şablon:Foo")
 * @return {Promise<boolean>} Whether a refresh was performed
 */
async function refreshTemplateLinks(api, templateTitle) {
	const template = await fetchPageContentMeta(api, templateTitle);
	if (!template) {
		return false;
	}

	await editPage(api, template.title, {
		text: template.content,
		baserevid: template.revid,
		minor: true,
		summary: 'Kateqoriya indeksini yeniləmək üçün texniki redaktə',
	});
	return true;
}

async function addCategoryToMembersEdit(api, itemTitle, categoryTag, pageName) {
	await editPage(api, itemTitle, {
		appendtext: categoryTag,
		minor: true,
		summary: `[[VP:Q/KT|Kateqoriya təklifçisi]] vasitəsilə +[[${pageName.replace(/_/g, ' ')}]]`,
		redirect: true,
	});
}

module.exports = {
	addParentCategoriesEdit,
	addTemplateCategoriesEdit,
	refreshTemplateLinks,
	isTemplateMember,
	needsTemplateLinkRefresh,
	addCategoryToMembersEdit,
	fetchPageContent,
	fetchPageContentMeta,
	findTitlesAlreadyInCategory,
	getEditResultMessage,
	sanitizeSortKey,
	formatCategoryLink,
	editPage,
	resolveTemplateDoc,
	extractCategoryTitles,
	extractIncludeonlyCategories,
	extractTemplatePageCategories,
	insertCategoriesIntoTagBlock,
};
