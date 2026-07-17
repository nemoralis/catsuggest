const { MAXLAG_SECONDS } = require('./constants.js');
const { retryApiCall } = require('./api.js');

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
	editPage,
};
