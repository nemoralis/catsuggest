const { MAXLAG_SECONDS } = require('./constants.js');
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

	if (titlesToRemove.length > 0) {
		let content = await fetchPageContent(api, pageTitle);

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
			content += '\n' + titlesToAdd.map((t) => `[[${t.replace(/_/g, ' ')}]]`).join('\n');
		}

		params.text = content;
	} else {
		params.appendtext = '\n' + titlesToAdd.map((t) => `[[${t.replace(/_/g, ' ')}]]`).join('\n');
		params.redirect = true;
	}

	await editPage(api, pageTitle, params);
}

async function addCategoryToMembersEdit(api, itemTitle, categoryTag, editGroupSuffix, pageName) {
	await editPage(api, itemTitle, {
		appendtext: categoryTag,
		minor: true,
		summary: `[[VP:Q/KT|Kateqoriya təklifçisi]] vasitəsilə +[[${pageName.replace(/_/g, ' ')}]]${editGroupSuffix}`,
		redirect: true,
	});
}

module.exports = {
	addParentCategoriesEdit,
	addCategoryToMembersEdit,
	fetchPageContent,
	findTitlesAlreadyInCategory,
	getEditResultMessage,
	editPage,
};
