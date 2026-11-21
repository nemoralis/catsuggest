<template>
	<teleport to="#catsuggest-btn-container" v-if="showButtonTarget">
		<cdx-button
			size="medium"
			:action="devMode ? 'destructive' : 'progressive'"
			:disabled="!qid || !pageEditable"
			@click="toggleDialog"
		>
			{{ isCatPage ? 'Təkliflər' : 'Kateqoriya təklifləri' }}
		</cdx-button>
	</teleport>

	<cdx-dialog
		class="catsuggest-main-dialog"
		:open="dialogShown"
		:title="dialogTitle"
		:use-close-button="true"
		close-button-label="Bağla"
		@update:open="onDialogOpenChange"
	>
		<template #default>
			<div v-if="status === 'idle' || status === 'loading' || status === 'results'">
				<div v-if="isCatPage" class="catsuggest-tabs">
					<cdx-tabs v-model:active="mode">
						<cdx-tab
							name="members"
							:label="membersTabLabel"
							:disabled="isExcludedCategory || !isAuthorized"
						/>
						<cdx-tab name="parentCats" label="Kateqoriya" />
					</cdx-tabs>
					<cdx-message v-if="isExcludedCategory" type="warning" style="margin-top: 8px">
						Bu kateqoriya üçün {{ membersDisabledLabel }} təklifləri deaktiv edilib.
					</cdx-message>
					<cdx-message v-else-if="!isAuthorized" type="warning" style="margin-top: 8px">
						{{ membersTabLabel }} bölməsindən istifadə yalnız müraciət əsasında
						fəaliyyət göstərir. Zəhmət olmasa,
						<a
							:href="
								getPageUrl('Vikipediya:Qadcetlər/Kateqoriya_təklifçisi/Müraciətlər')
							"
							target="_blank"
							>müraciətlər səhifəsində</a
						>
						müraciət edin.
					</cdx-message>
				</div>

				<div v-if="alreadyProcessed && mode === 'members'" style="padding: 24px 0">
					<cdx-message type="warning">
						<strong>Bu kateqoriya artıq işlənib.</strong><br />
						Siz bu kateqoriyada təklif axtarış edib nəticələri əlavə etmisiniz.
					</cdx-message>
					<cdx-button
						style="margin-top: 16px"
						action="progressive"
						@click="continueAfterProcessed"
						>Davam et</cdx-button
					>
				</div>

				<template v-else>
					<p v-if="mode === 'parentCats'">
						Digər dillərdəki {{ parentCatsIntroNoun }} əlavə edilmiş kateqoriyalar
						əsasında təkliflər.
					</p>
					<p v-else>
						Digər dillərdəki eyni kateqoriyanın üzvləri əsasında bu kateqoriyaya əlavə
						edilə biləcək {{ membersIntroNoun }}.
					</p>

					<cdx-accordion
						v-if="
							sitelinks.length > 0 &&
							(status === 'idle' || status === 'loading' || status === 'results')
						"
						v-model="langsAccordionOpen"
						separation="outline"
						:action-icon="icons.reload"
						action-button-label="Təklifləri al"
						@action-button-click="onAccordionFetch"
						class="catsuggest-lang-accordion"
					>
						<template #title>Təklif alınacaq dillər</template>
						<template #description>{{ selectedLanguagesText }} seçilib.</template>
						<div class="catsuggest-site-section">
							<div class="catsuggest-header">
								<p class="catsuggest-header__label">Dilləri seç:</p>
								<cdx-toggle-switch v-model="allSelected" :disabled="loading">
									Bütün dilləri seç ({{ filteredSitelinks.length }})
								</cdx-toggle-switch>
							</div>

							<cdx-tabs
								v-model:active="langTab"
								style="margin-top: 12px; margin-bottom: 12px"
							>
								<cdx-tab
									name="large"
									:label="largeTabLabel"
									:disabled="loading || largeSitelinks.length === 0"
								/>
								<cdx-tab
									name="small"
									:label="smallTabLabel"
									:disabled="loading || smallSitelinks.length === 0"
								/>
							</cdx-tabs>

							<cdx-message
								v-if="hasSmallLangSelected"
								type="warning"
								style="margin-bottom: 8px"
							>
								Diqqət! Digər vikilərdən üst kateqoriyaların əlavə edilməsi riski
								yüksəkdir. Nəticələri diqqətlə yoxlayın.
							</cdx-message>

							<div v-if="showSearch" class="catsuggest-search">
								<cdx-text-input
									:start-icon="icons.search"
									:model-value="siteFilter"
									@update:model-value="
										(val) => {
											siteFilter = val;
											onSiteFilterInput(val);
										}
									"
									placeholder="Dillərdə axtar..."
									aria-label="Dillərdə axtar"
									:clearable="true"
								/>
							</div>

							<div :class="gridClass">
								<div
									v-if="filteredSitelinks.length === 0"
									style="
										color: var(--color-subtle, #72777d);
										font-size: 14px;
										padding: 8px 0;
										grid-column: 1 / -1;
									"
								>
									Heç bir dil tapılmadı.
								</div>
								<div v-for="site in filteredSitelinks" :key="site.site">
									<cdx-checkbox
										v-model="selectedSites"
										:inputValue="site.site"
										:disabled="loading"
									>
										{{ site.name }} ({{ site.lang }})
									</cdx-checkbox>
								</div>
							</div>

							<div style="margin-top: 8px">
								<cdx-checkbox v-model="rememberLangs">
									Bu dilləri mənim üçün yadda saxla
								</cdx-checkbox>
							</div>
							<cdx-message
								v-if="selectedSites.length > 4"
								:type="
									selectedSites.length === sitelinks.length ? 'warning' : 'info'
								"
								class="catsuggest-lang-warning"
							>
								{{ selectedSites.length }} dil seçilib. Axtarışın təxminən
								{{ estimatedTime }} saniyə çəkəcəyi gözlənilir.
							</cdx-message>
						</div>
					</cdx-accordion>

					<cdx-message
						v-if="languageSelectionChanged"
						type="warning"
						class="catsuggest-lang-changed-warning"
					>
						Dillər dəyişildi. Təkliflərin yenilənməsi üçün "Təklifləri al" düyməsinə
						klikləyin.
					</cdx-message>

					<div v-if="status === 'loading'">
						<cdx-progress-bar aria-label="Yüklənir" />
						<p class="catsuggest-loading">
							Təkliflər axtarılır<span class="catsuggest-dots"></span>
						</p>
					</div>

					<cdx-message
						v-else-if="error"
						type="error"
						:inline="true"
						style="margin-top: 8px; margin-bottom: 8px"
					>
						{{ error }}
					</cdx-message>

					<div v-if="status === 'results'">
						<div v-if="suggestions.length > 0">
							<p>Seçilmiş dillər əsasında aşağıdakı təkliflər təqdim olunur:</p>
							<cdx-message
								type="notice"
								:inline="true"
								class="catsuggest-sources-info"
								style="margin: 12px 0"
							>
								<strong>Təkliflərin alındığı səhifələr: </strong>
								<ul class="catsuggest-sources-list">
									<li v-for="site in appliedSites" :key="site">
										<a
											:href="getForeignPageUrl(site, getSiteTitle(site))"
											target="_blank"
											class="catsuggest-suggestion__link"
											>[{{ getSiteLang(site) }}] {{ getSiteTitle(site) }}</a
										>
									</li>
								</ul>
							</cdx-message>
						</div>
						<div class="catsuggest-results">
							<template v-if="mode === 'members'">
								<div v-if="suggestedPages.length > 0">
									<cdx-accordion :open="true" separation="minimal">
										<template #title
											>{{ membersAccordionLabel }} ({{
												suggestedPages.length
											}})</template
										>
										<div
											v-for="item in suggestedPages"
											:key="item.title"
											class="catsuggest-suggestion"
										>
											<div class="catsuggest-suggestion__row">
												<cdx-checkbox v-model="item.selected">
													<a
														:href="getPageUrl(item.title)"
														target="_blank"
														class="catsuggest-suggestion__link"
														@click.stop
														>{{ item.title }}</a
													>
												</cdx-checkbox>
												<span
													v-if="item.sources && item.sources.length"
													class="catsuggest-suggestion__sources"
													v-tooltip:bottom="suggestionTooltip(item)"
												>
													<cdx-info-chip
														:icon="icons.language"
														:status="sourcesStatus(item)"
													>
														{{ item.sources.join(', ') }}
													</cdx-info-chip>
												</span>
											</div>
										</div>
									</cdx-accordion>
								</div>
								<div v-if="suggestedSubcats.length > 0">
									<cdx-accordion :open="true" separation="minimal">
										<template #title
											>Altkateqoriyalar ({{
												suggestedSubcats.length
											}})</template
										>
										<div
											v-for="item in suggestedSubcats"
											:key="item.title"
											class="catsuggest-suggestion"
										>
											<div class="catsuggest-suggestion__row">
												<cdx-checkbox v-model="item.selected">
													<a
														:href="getPageUrl(item.title)"
														target="_blank"
														class="catsuggest-suggestion__link"
														@click.stop
														>{{ item.title }}</a
													>
												</cdx-checkbox>
												<span
													v-if="item.sources && item.sources.length"
													class="catsuggest-suggestion__sources"
													v-tooltip:bottom="suggestionTooltip(item)"
												>
													<cdx-info-chip
														:icon="icons.language"
														:status="sourcesStatus(item)"
													>
														{{ item.sources.join(', ') }}
													</cdx-info-chip>
												</span>
											</div>
										</div>
									</cdx-accordion>
								</div>
							</template>
							<template v-else>
								<cdx-accordion
									v-if="suggestions.length > 0"
									:open="true"
									separation="minimal"
								>
									<template #title
										>Kateqoriya təklifləri ({{ suggestions.length }})</template
									>
									<div
										v-for="cat in suggestions"
										:key="cat.title"
										class="catsuggest-suggestion"
									>
										<div class="catsuggest-suggestion__row">
											<cdx-checkbox v-model="cat.selected">
												<a
													:href="getPageUrl(cat.title)"
													target="_blank"
													class="catsuggest-suggestion__link"
													@click.stop
													>{{ displayCategoryTitle(cat.title) }}</a
												>
											</cdx-checkbox>
											<cdx-button
												class="catsuggest-suggestion__sortkey"
												:class="{
													'catsuggest-suggestion__sortkey--set':
														cat.sortKey,
												}"
												weight="quiet"
												aria-label="Sıralama açarı təyin et"
												@click="toggleSortKeyPopover(cat, $event)"
											>
												<cdx-icon :icon="icons.key" />
											</cdx-button>
											<span
												v-if="cat.isWikidataDerived"
												class="catsuggest-suggestion__sources"
												v-tooltip:bottom="'Bu təklif Vikidatadan gəlir.'"
											>
												<cdx-icon
													:icon="icons.wikidata"
													aria-label="Vikidata"
												/>
											</span>
											<span
												v-else-if="cat.sources && cat.sources.length"
												class="catsuggest-suggestion__sources"
												v-tooltip:bottom="suggestionTooltip(cat)"
											>
												<cdx-info-chip
													:icon="icons.language"
													:status="sourcesStatus(cat)"
												>
													{{ cat.sources.join(', ') }}
												</cdx-info-chip>
											</span>
										</div>
										<div
											v-if="cat.removals && cat.removals.length > 0"
											style="margin: 4px 0 8px 28px"
										>
											<div
												v-for="rem in cat.removals"
												:key="rem.title"
												style="margin-bottom: 2px"
											>
												<cdx-checkbox v-model="rem.selected" status="error">
													<s
														><a
															:href="getPageUrl(rem.title)"
															target="_blank"
															class="catsuggest-suggestion__link"
															>{{
																displayCategoryTitle(rem.title)
															}}</a
														></s
													>
													<template #description
														>Üst kateqoriya — silinəcək</template
													>
												</cdx-checkbox>
											</div>
										</div>
									</div>
								</cdx-accordion>
							</template>
							<div v-if="existingRemovals.length > 0" style="margin-top: 8px">
								<cdx-accordion :open="true" separation="minimal">
									<template #title
										>Mövcud kateqoriyalara əsaslanan silinmələr ({{
											existingRemovals.length
										}})</template
									>
									<div
										v-for="rem in existingRemovals"
										:key="rem.title"
										style="margin-bottom: 2px"
									>
										<cdx-checkbox v-model="rem.selected" status="error">
											<s
												><a
													:href="getPageUrl(rem.title)"
													target="_blank"
													class="catsuggest-suggestion__link"
													>{{ displayCategoryTitle(rem.title) }}</a
												></s
											>
											<template #description>
												<ul
													class="catsuggest-removal-reasons"
													:class="{
														'catsuggest-removal-reasons--single':
															rem.flatTree.length <= 1,
													}"
												>
													<li
														v-for="node in rem.flatTree"
														:key="node.title"
														:class="{
															'catsuggest-removal-reason--child':
																node.depth > 0,
														}"
														:style="{
															paddingLeft: node.depth * 24 + 4 + 'px',
														}"
													>
														<span v-if="node.depth > 0">{{
															node.isLast ? '└─ ' : '├─ '
														}}</span>
														<a
															:href="getPageUrl(node.title)"
															target="_blank"
															class="catsuggest-suggestion__link"
															>{{
																displayCategoryTitle(node.title)
															}}</a
														>
													</li>
												</ul>
											</template>
										</cdx-checkbox>
									</div>
								</cdx-accordion>
							</div>
						</div>
						<cdx-popover
							v-if="sortKeyPopoverOpen && sortKeyPopoverAnchor"
							v-model:open="sortKeyPopoverOpen"
							:anchor="sortKeyPopoverAnchor"
							:render-in-place="true"
							placement="top"
							title="Sıralama açarı"
							:use-close-button="true"
							:primary-action="{ label: 'Yadda saxla', actionType: 'progressive' }"
							:default-action="{ label: 'Ləğv et' }"
							@primary="saveSortKey"
							@default="cancelSortKey"
							@click="onSortKeyTitleClick"
							class="catsuggest-sortkey-popover"
						>
							<p>Sıralama açarı kateqoriya daxilində səhifənin yerini təyin edir.</p>
							<cdx-text-input
								v-if="activeSortKeySuggestion"
								v-model="sortKeyDraft"
								:start-icon="icons.sortVertical"
								placeholder="Sıralama açarı"
								:clearable="true"
								@keyup.enter="saveSortKey"
							/>
							<cdx-checkbox
								v-if="activeSortKeySuggestion"
								v-model="applySortKeyToAll"
								class="catsuggest-sortkey-apply-all"
							>
								Bütün təkliflərə tətbiq et
							</cdx-checkbox>
						</cdx-popover>
						<div ref="resultsSentinel" style="height: 1px"></div>
					</div>
				</template>
			</div>

			<div v-else-if="status === 'editing'" class="catsuggest-progress">
				<cdx-progress-bar aria-label="Redaktə edilir" />
				<p v-if="mode === 'parentCats'" style="margin-top: 12px">
					{{ parentCatsProgressText }}
				</p>
				<p v-else style="margin-top: 12px">
					{{ currentProcessingTitle }} ({{ processedCount }}/{{ totalProcessingCount }})
				</p>
			</div>

			<div v-else-if="status === 'success'" class="catsuggest-success">
				<p class="catsuggest-success__text">
					{{ editResultMessage }}
				</p>
				<cdx-message v-if="editAborted" type="warning" style="margin-top: 16px">
					{{ processedCount }} səhifəyə kateqoriya əlavə edildi, qalan səhifələr redaktə
					edilmədi.
				</cdx-message>
				<cdx-message v-if="editFailures.length > 0" type="error" style="margin-top: 16px">
					<p class="catsuggest-failures__title">
						Aşağıdakı səhifələr redaktə edilə bilmədi:
					</p>
					<ul class="catsuggest-failures__list">
						<li v-for="f in editFailures" :key="f.title">
							<a
								:href="getPageUrl(f.title)"
								target="_blank"
								class="catsuggest-suggestion__link"
								>{{ f.title }}</a
							>
							— {{ f.error }}
						</li>
					</ul>
				</cdx-message>
				<p class="catsuggest-success__hint" style="margin-top: 16px">
					Dəyişiklikləri görmək üçün bu pəncərəni bağlayın.
				</p>
			</div>
		</template>
		<template #footer>
			<div class="catsuggest-footer">
				<p class="cdx-dialog__footer__text">
					Qadcetlə edəcəyiniz redaktələrə görə siz məsuliyyət daşıyırsınız.
				</p>
				<div class="catsuggest-footer__actions">
					<cdx-button size="medium" @click="handleClose">{{
						status === 'success' ? 'Bağla' : 'İmtina'
					}}</cdx-button>
					<cdx-button
						v-if="
							(status === 'idle' || status === 'results') &&
							!(alreadyProcessed && mode === 'members')
						"
						size="medium"
						action="progressive"
						weight="normal"
						:disabled="!canFetch"
						@click="fetchSuggestions"
						>Təklifləri al</cdx-button
					>
					<cdx-button
						v-if="
							status === 'results' &&
							(suggestions.length > 0 || existingRemovals.length > 0)
						"
						size="medium"
						:action="selectedCount > 0 ? 'progressive' : 'destructive'"
						weight="primary"
						:disabled="(selectedCount === 0 && !hasRemovals) || !hasScrolledResults"
						@click="handleApplyClick"
						>{{ selectedCount > 0 || isTemplatePage ? 'Təsdiq et' : 'Sil' }}</cdx-button
					>
				</div>
			</div>
		</template>
	</cdx-dialog>

	<cdx-dialog
		:open="modal === 'cancelEdit'"
		title="Redaktəni dayandırın?"
		:use-close-button="true"
		close-button-label="Bağla"
		@update:open="onModalOpenChange('cancelEdit', $event)"
	>
		<template #default>
			<p>Redaktə davam edir. Cari əməliyyat tamamlandıqdan sonra dayandırılacaq.</p>
			<p v-if="processedCount > 0" style="margin-top: 8px">
				{{ processedCount }} səhifə artıq redaktə edilib.
			</p>
		</template>
		<template #footer>
			<div class="catsuggest-footer">
				<div class="catsuggest-footer__actions">
					<cdx-button size="medium" @click="modal = null">Davam et</cdx-button>
					<cdx-button
						size="medium"
						action="destructive"
						weight="primary"
						@click="confirmCancelEdit"
						>Dayandır</cdx-button
					>
				</div>
			</div>
		</template>
	</cdx-dialog>

	<cdx-dialog
		:open="modal === 'confirm'"
		title="Redaktəni təsdiqləyin"
		:use-close-button="true"
		close-button-label="Bağla"
		@update:open="onModalOpenChange('confirm', $event)"
	>
		<template #default>
			<p>
				Siz <strong>{{ selectedCount }} {{ confirmTargetNoun }}</strong> kateqoriya əlavə
				etmək üzrəsiniz.
			</p>
			<p style="margin-top: 8px">Bütün təklifləri yoxlamısınız?</p>
		</template>
		<template #footer>
			<div class="catsuggest-footer">
				<div class="catsuggest-footer__actions">
					<cdx-button size="medium" @click="modal = null">İmtina</cdx-button>
					<cdx-button
						size="medium"
						action="progressive"
						weight="primary"
						@click="confirmAndApply"
						>Bəli, əlavə et</cdx-button
					>
				</div>
			</div>
		</template>
	</cdx-dialog>
</template>

<script>
const {
	CATEGORY_NAMESPACE,
	CATEGORY_PREFIX,
	TEMPLATE_NAMESPACE,
	CURRENT_WIKI,
	FETCH_CONCURRENCY,
	SLEEP_BETWEEN_BATCHES_MS,
	DEBOUNCE_MS,
	CONFIRM_BATCH_THRESHOLD,
	EXCLUDED_SITES,
	LARGE_WIKI_SITES,
	CACHE_KEY_USER_LANGS_LEGACY,
	getUserLangsKey,
	CACHE_KEY_TREE_PREFIX,
	CACHE_TTL_TREE,
	MAX_DEPTH1_SUBCATS,
	MAX_DEPTH2_SUBCATS,
	DEPTH2_BATCH_SIZE,
	ENABLE_EDIT_GROUP_LINKS,
	isTopicalTemplateCategory,
	log,
	debounce,
	escapeRegex,
	generateBatchId,
} = require('./constants.js');
const {
	sleep,
	settleAll,
	retryApiCall,
	getErrorMessage,
	fetchFullQuery,
	createForeignApi,
} = require('./api.js');
const { fetchWikidataDerivedCategories } = require('./wikidata-categories.js');
const {
	loadSiteMetadata,
	isPageProcessed,
	markPageAsProcessed,
	clearMembersCache,
	isCatPageExcluded,
} = require('./cache.js');
const {
	fetchParentCatsSuggestions,
	fetchMembersSuggestions,
	buildParentCatsSuggestions,
	buildMembersSuggestions,
	buildExistingRemovals,
	detectTemplateAddedCategories,
} = require('./suggestions.js');
const {
	addParentCategoriesEdit,
	addTemplateCategoriesEdit,
	refreshTemplateLinks,
	isTemplateMember,
	needsTemplateLinkRefresh,
	addCategoryToMembersEdit,
	findTitlesAlreadyInCategory,
	getEditResultMessage,
	sanitizeSortKey,
	resolveTemplateDoc,
	fetchPageContentMeta,
	extractIncludeonlyCategories,
	extractTemplatePageCategories,
} = require('./edit.js');
const {
	createWorkflowState,
	isRequestCurrent,
	workflowReducer,
	getWorkflowStatus,
	isWorkflowLoading,
	getBatchOutcome,
} = require('./workflow.js');
const { createAsyncCache } = require('./async-cache.js');
const {
	cdxIconLanguage,
	cdxIconSearch,
	cdxIconKey,
	cdxIconReload,
	cdxIconSortVertical,
	cdxIconLogoWikidata,
} = require('./icons.json');

const currentPageId = mw.config.get('wgArticleId');

function abortError() {
	const error = new Error('Aborted');
	error.name = 'AbortError';
	return error;
}

export default {
	name: 'CatSuggestApp',
	props: {
		isAuthorized: Boolean,
		api: Object,
		wikidataApi: Object,
		devMode: Boolean,
	},
	data() {
		const isCatPage = mw.config.get('wgNamespaceNumber') === CATEGORY_NAMESPACE;
		const isPageExcluded = isCatPage && isCatPageExcluded(mw.config.get('wgPageName'));
		const isTemplatePage =
			mw.config.get('wgNamespaceNumber') === TEMPLATE_NAMESPACE &&
			!mw.config.get('wgTitle').includes('/');
		const isTemplateCategoryPage =
			isCatPage && isTopicalTemplateCategory(mw.config.get('wgPageName').replace(/_/g, ' '));

		return {
			dialogShown: false,
			suggestions: [],
			qid: mw.config.get('wgWikibaseItemId'),
			isTemplatePage,
			isTemplateCategoryPage,
			templateTargetResolved: !isTemplatePage,
			templateTargetEditable: false,
			selectedSuggestions: [],
			workflow: createWorkflowState(),
			workflowRequestSeq: 0,
			modal: null,
			icons: {
				language: cdxIconLanguage,
				search: cdxIconSearch,
				key: cdxIconKey,
				reload: cdxIconReload,
				sortVertical: cdxIconSortVertical,
				wikidata: cdxIconLogoWikidata,
			},
			sortKeyPopoverOpen: false,
			sortKeyPopoverAnchor: null,
			activeSortKeySuggestion: null,
			sortKeyDraft: '',
			applySortKeyToAll: false,
			sitelinks: [],
			modeSelectedSites: {
				members: [],
				parentCats: [],
			},
			siteFilter: '',
			debouncedSiteFilter: '',
			mode: isCatPage && !isPageExcluded && this.isAuthorized ? 'members' : 'parentCats',
			isCatPage,
			currentProcessingTitle: '',
			processedCount: 0,
			totalProcessingCount: 0,
			lastEditAddedCount: 0,
			lastEditRemovedCount: 0,
			currentEditAction: 'add',
			editFailures: [],
			showButtonTarget: false,
			rememberLangs: false,
			hasScrolledResults: false,
			editAborted: false,
			alreadyProcessed: isCatPage && isPageProcessed(currentPageId),
			langTab: 'large',
			langsAccordionOpen: true,
			fetchAbortController: null,
			existingRemovals: [],
			appliedSites: [],
		};
	},
	computed: {
		dialogTitle() {
			if (this.mode !== 'members') {
				return 'Kateqoriya təklifləri';
			}
			return this.isTemplateCategoryPage
				? 'Şablon təklifləri'
				: 'Məqalə və altkateqoriya təklifləri';
		},
		membersTabLabel() {
			return this.isTemplateCategoryPage
				? 'Şablon və altkateqoriya'
				: 'Məqalə və altkateqoriya';
		},
		membersAccordionLabel() {
			return this.isTemplateCategoryPage ? 'Şablonlar' : 'Məqalələr';
		},
		membersDisabledLabel() {
			return this.isTemplateCategoryPage
				? 'şablon və altkateqoriya'
				: 'məqalə və altkateqoriya';
		},
		membersEditErrorLabel() {
			return this.isTemplateCategoryPage ? 'Şablonları' : 'Məqalələri';
		},
		parentCatsIntroNoun() {
			return this.isTemplateCategoryPage ? 'səhifələrə' : 'məqalələrə';
		},
		membersIntroNoun() {
			return this.isTemplateCategoryPage
				? 'şablonlar və altkateqoriyalar'
				: 'məqalələr və altkateqoriyalar';
		},
		confirmTargetNoun() {
			return this.isTemplateCategoryPage ? 'şablona' : 'məqaləyə';
		},
		status() {
			return getWorkflowStatus(this.workflow);
		},
		loading() {
			return isWorkflowLoading(this.workflow);
		},
		error: {
			get() {
				return this.workflow.error;
			},
			set(value) {
				this.dispatchWorkflow({ type: 'SET_ERROR', error: value });
			},
		},
		canFetch() {
			return this.selectedSites.length > 0 && !this.loading;
		},
		pageEditable() {
			if (!this.isTemplatePage) {
				return mw.config.get('wgIsProbablyEditable') !== false;
			}
			return this.templateTargetResolved && this.templateTargetEditable;
		},
		allSelected: {
			get() {
				if (this.filteredSitelinks.length === 0) {
					return false;
				}
				return this.filteredSitelinks.every((s) => this.selectedSites.includes(s.site));
			},
			set(value) {
				const filteredSet = new Set(this.filteredSitelinks.map((s) => s.site));
				if (value) {
					const current = new Set(this.selectedSites);
					filteredSet.forEach((s) => current.add(s));
					this.selectedSites = Array.from(current);
				} else {
					this.selectedSites = this.selectedSites.filter((s) => !filteredSet.has(s));
				}
			},
		},
		isExcludedCategory() {
			const isCatPage = mw.config.get('wgNamespaceNumber') === CATEGORY_NAMESPACE;
			return isCatPage && isCatPageExcluded(mw.config.get('wgPageName'));
		},
		showSearch() {
			return this.sitelinks.length > 10;
		},
		largeSitelinks() {
			return this.sitelinks.filter((s) => LARGE_WIKI_SITES.has(s.site));
		},
		smallSitelinks() {
			return this.sitelinks.filter((s) => !LARGE_WIKI_SITES.has(s.site));
		},
		hasSmallLangSelected() {
			return this.selectedSites.some((site) => !LARGE_WIKI_SITES.has(site));
		},
		filteredSitelinks() {
			const tabLinks = this.langTab === 'large' ? this.largeSitelinks : this.smallSitelinks;
			if (!this.debouncedSiteFilter) {
				return tabLinks;
			}
			const filter = this.debouncedSiteFilter.toLowerCase();
			return tabLinks.filter(
				(s) =>
					s.name.toLowerCase().includes(filter) || s.lang.toLowerCase().includes(filter)
			);
		},
		selectedSites: {
			get() {
				return this.modeSelectedSites[this.mode];
			},
			set(value) {
				this.modeSelectedSites[this.mode] = value;
			},
		},
		gridClass() {
			const count = this.sitelinks.length;
			const columns = Math.max(2, Math.min(3, Math.ceil(count / 10)));
			return 'catsuggest-grid catsuggest-grid--cols-' + columns;
		},
		languageSelectionChanged() {
			if (this.status !== 'results' || this.appliedSites.length === 0) {
				return false;
			}
			const selected = [...this.selectedSites].sort();
			const applied = [...this.appliedSites].sort();
			return (
				selected.length !== applied.length ||
				selected.some((site, index) => site !== applied[index])
			);
		},
		selectedLanguagesText() {
			const names = this.selectedSites
				.map((site) => {
					const link = this.sitelinksBySite.get(site);
					return link ? link.name || link.lang : site;
				})
				.filter(Boolean);
			if (names.length === 0) {
				return 'Heç bir dil';
			}
			if (names.length === 1) {
				return names[0];
			}
			if (names.length <= 3) {
				return names.slice(0, -1).join(', ') + ' və ' + names[names.length - 1];
			}
			return names.slice(0, 3).join(', ') + ' və ' + (names.length - 3) + ' digər';
		},
		largeTabLabel() {
			return 'Əsas vikilər (' + this.largeSitelinks.length + ')';
		},
		smallTabLabel() {
			return 'Digər vikilər (' + this.smallSitelinks.length + ')';
		},
		suggestedPages() {
			return this.suggestions.filter((s) => !s.isCategory);
		},
		selectedCount() {
			return this.suggestions.filter((s) => s.selected).length;
		},
		editResultMessage() {
			return getEditResultMessage({
				addedCount: this.lastEditAddedCount,
				removedCount: this.lastEditRemovedCount,
				aborted: this.editAborted,
			});
		},
		parentCatsProgressText() {
			if (this.currentEditAction === 'remove') {
				return 'Kateqoriyalar silinir';
			}
			if (this.currentEditAction === 'mixed') {
				return 'Kateqoriyalar redaktə edilir';
			}
			return 'Kateqoriyalar əlavə edilir';
		},
		selectedRemovalCount() {
			const seen = new Set();
			this.suggestions.forEach((s) => {
				(s.removals || []).forEach((r) => {
					if (r.selected) {
						seen.add(r.title);
					}
				});
			});
			return seen.size;
		},
		hasRemovals() {
			return this.existingRemovals.some((r) => r.selected);
		},
		suggestedSubcats() {
			return this.suggestions.filter((s) => s.isCategory);
		},
		estimatedTime() {
			const count = this.selectedSites.length;
			if (count === 0) {
				return 0;
			}
			const batches = Math.ceil(count / FETCH_CONCURRENCY);
			const sleepTime = (batches - 1) * (SLEEP_BETWEEN_BATCHES_MS / 1000);
			const networkTime = batches * 0.6;
			const baseOverhead = 2.0;
			return Math.ceil(sleepTime + networkTime + baseOverhead);
		},
		sitelinksBySite() {
			const map = new Map();
			this.sitelinks.forEach((s) => map.set(s.site, s));
			return map;
		},
	},
	methods: {
		dispatchWorkflow(action) {
			this.workflow = workflowReducer(this.workflow, action);
		},

		beginWorkflowRequest(type) {
			const request = {
				requestId: ++this.workflowRequestSeq,
				mode: this.mode,
			};
			this.dispatchWorkflow({
				type,
				requestId: request.requestId,
				mode: request.mode,
			});
			return request;
		},

		isCurrentRequest(request) {
			return isRequestCurrent(this.workflow, request);
		},

		async resolveTemplateTarget() {
			const fallback = mw.config.get('wgIsProbablyEditable') !== false;
			try {
				const doc = await resolveTemplateDoc(this.api, mw.config.get('wgPageName'));
				this.templateTargetEditable = doc.exists ? doc.editable : fallback;
			} catch (err) {
				mw.log.warn('[CatSuggest] Could not resolve template edit target:', err);
				this.templateTargetEditable = fallback;
			} finally {
				this.templateTargetResolved = true;
			}
		},

		toggleDialog() {
			if (this.dialogShown) {
				this.handleClose();
				return;
			}
			this.dialogShown = true;
			if (this.sitelinks.length === 0) {
				this.initGadget();
			}
		},

		onDialogOpenChange(open) {
			if (open) {
				this.dialogShown = true;
			} else {
				this.handleClose();
			}
		},

		async initGadget() {
			if (this.workflow.phase === 'initializing') {
				return;
			}
			if (!this.qid) {
				this.error =
					'Bu səhifə Vikidataya qoşulmayıb. Zəhmət olmasa, əvvəlcə səhifəni Vikidata elementinə qoşun.';
				return;
			}

			const request = this.beginWorkflowRequest('INIT_START');
			try {
				const wdResp = await retryApiCall(() =>
					this.wikidataApi.get({
						action: 'wbgetentities',
						ids: this.qid,
						props: 'sitelinks',
						redirects: 'yes',
						format: 'json',
					})
				);

				if (!this.isCurrentRequest(request)) {
					return;
				}

				const entity = wdResp.entities[this.qid];
				if (!entity || !entity.sitelinks) {
					this.dispatchWorkflow({
						type: 'INIT_COMPLETE',
						requestId: request.requestId,
						mode: request.mode,
						error: 'Bu səhifənin interviki keçidləri mövcud deyil. Səhifənin Vikidata elementinə digər dillərdəki səhifələr əlavə edilməyib.',
					});
					return;
				}

				const { langMap, interwikiMap } = await loadSiteMetadata(this.api);

				if (!this.isCurrentRequest(request)) {
					return;
				}

				this.sitelinks = Object.values(entity.sitelinks)
					.filter(
						(s) =>
							s.site.endsWith('wiki') &&
							s.site !== CURRENT_WIKI &&
							!EXCLUDED_SITES.has(s.site)
					)
					.map((s) => {
						const langCode = s.site.replace(/wiki$/, '').replace(/_/g, '-');

						let apiHost = langCode + '.wikipedia.org';
						if (interwikiMap[langCode]) {
							try {
								apiHost = new URL(interwikiMap[langCode]).hostname;
							} catch (_err) {
								mw.log.warn('URL parse error:', _err);
							}
						}

						const displayLang = apiHost.split('.')[0];

						return {
							site: s.site,
							title: s.title,
							lang: displayLang,
							apiHost,
							name: langMap[displayLang] || langMap[langCode] || displayLang,
						};
					});

				this.sitelinks.sort((a, b) => a.lang.localeCompare(b.lang));

				if (this.sitelinks.length === 0) {
					this.dispatchWorkflow({
						type: 'INIT_COMPLETE',
						requestId: request.requestId,
						mode: request.mode,
						error: 'Seçdiyiniz dillərin heç birində bu səhifənin qarşılığı tapılmadı. Ola bilər ki, bu səhifə yalnız Azərbaycanca Vikipediyada mövcuddur.',
					});
					return;
				}

				const legacyLangEntry = mw.storage.get(CACHE_KEY_USER_LANGS_LEGACY);

				const parseStoredLangs = (raw) => {
					if (!raw) {
						return null;
					}
					try {
						const parsed = JSON.parse(raw);
						if (Array.isArray(parsed) && parsed.length > 0) {
							return parsed.filter((site) =>
								this.sitelinks.some((s) => s.site === site)
							);
						}
					} catch (_err) {
						mw.log.warn('User langs parse error:', _err);
					}
					return null;
				};

				const defaultLangs = Array.from(LARGE_WIKI_SITES).filter((site) =>
					this.sitelinks.some((s) => s.site === site)
				);

				const resolveInitialLangs = (mode, legacyValue) => {
					const ownKey = getUserLangsKey(mode);
					const own = mw.storage.get(ownKey);
					if (own) {
						const parsed = parseStoredLangs(own);
						if (parsed) {
							return parsed;
						}
						mw.storage.remove(ownKey);
					}
					if (legacyValue) {
						return parseStoredLangs(legacyValue);
					}
					return defaultLangs.slice();
				};

				this.modeSelectedSites.members = resolveInitialLangs('members', legacyLangEntry);
				this.modeSelectedSites.parentCats = resolveInitialLangs(
					'parentCats',
					legacyLangEntry
				);

				if (legacyLangEntry) {
					mw.storage.remove(CACHE_KEY_USER_LANGS_LEGACY);
				}

				this.dispatchWorkflow({
					type: 'INIT_COMPLETE',
					requestId: request.requestId,
					mode: request.mode,
					error: null,
				});
			} catch (_err) {
				if (!this.isCurrentRequest(request)) {
					return;
				}
				mw.log.warn('CatSuggest init error:', _err);
				const errMsg = getErrorMessage(_err);
				this.dispatchWorkflow({
					type: 'INIT_COMPLETE',
					requestId: request.requestId,
					mode: request.mode,
					error:
						'Digər vikilərin siyahısı alınarkən xəta baş verdi. İnternet bağlantınızı yoxlayın və yenidən cəhd edin. Xəta: ' +
						errMsg,
				});
			}
		},

		invalidateMembersState() {
			clearMembersCache(currentPageId);
			if (this._localStateCache) {
				this._localStateCache.invalidate('members-' + currentPageId);
			}
		},

		continueAfterProcessed() {
			this.invalidateMembersState();
			this.alreadyProcessed = false;
		},

		fetchLocalState() {
			const mode = this.mode;
			const cacheKey = mode + '-' + currentPageId;

			return this._localStateCache.get(cacheKey, () =>
				this.fetchLocalStateImpl(mode, mw.config.get('wgPageName'))
			);
		},

		async fetchLocalStateImpl(mode, pageName) {
			if (mode === 'members') {
				return this.fetchMembersState(pageName);
			}
			return this.fetchParentCatsState();
		},

		async fetchMembersState(pageName) {
			const cacheKey = CACHE_KEY_TREE_PREFIX + currentPageId;
			const cached = mw.storage.get(cacheKey);
			if (cached) {
				try {
					const data = JSON.parse(cached);
					if (data && data.members && data.subcats) {
						return {
							members: new Set(data.members),
							subcats: new Set(data.subcats),
						};
					}
				} catch (_err) {
					mw.log.warn('Tree parse error:', _err);
					mw.storage.remove(cacheKey);
				}
			}

			const cmResp = await fetchFullQuery(this.api, {
				action: 'query',
				list: 'categorymembers',
				cmtitle: pageName,
				cmtype: 'page|subcat',
				cmlimit: 'max',
			});
			const allCm = cmResp.categorymembers || [];

			const memberSet = new Set();
			const subcatSet = new Set();
			const depth1Subcats = [];

			allCm.forEach((m) => {
				memberSet.add(m.title);
				if (m.ns === CATEGORY_NAMESPACE) {
					subcatSet.add(m.title);
					depth1Subcats.push(m.title);
				}
			});

			// Deeper levels only need subcategory *names* for dedup: a suggestion that
			// lives inside any subcategory is already filtered by its parent categories
			// (buildMembersSuggestions), so enumerating the member *pages* of each
			// subcategory would fetch thousands of titles for no benefit. Fetching
			// `cmtype: 'subcat'` keeps the tree walk small and fast even for large
			// categories while discovering the same deeper subcategory names.
			//
			// The direct members of the root category (pages + subcats) above still
			// populate memberSet, so plain root members remain excluded as expected.
			const depth2Subcats = [];
			const subcatsToProcess = depth1Subcats.slice(0, MAX_DEPTH1_SUBCATS);
			for (let i = 0; i < subcatsToProcess.length; i += DEPTH2_BATCH_SIZE) {
				const batch = subcatsToProcess.slice(i, i + DEPTH2_BATCH_SIZE);
				const depth2Results = await Promise.all(
					batch.map((cat) =>
						fetchFullQuery(this.api, {
							action: 'query',
							list: 'categorymembers',
							cmtitle: cat,
							cmtype: 'subcat',
							cmlimit: 'max',
						})
					)
				);
				depth2Results.forEach((res) => {
					const members = res.categorymembers || [];
					members.forEach((m) => {
						memberSet.add(m.title);
						if (m.ns === CATEGORY_NAMESPACE) {
							subcatSet.add(m.title);
							depth2Subcats.push(m.title);
						}
					});
				});
			}

			const depth2SubcatsToProcess = depth2Subcats.slice(0, MAX_DEPTH2_SUBCATS);
			for (let i = 0; i < depth2SubcatsToProcess.length; i += DEPTH2_BATCH_SIZE) {
				const batch = depth2SubcatsToProcess.slice(i, i + DEPTH2_BATCH_SIZE);
				const depth3Results = await Promise.all(
					batch.map((cat) =>
						fetchFullQuery(this.api, {
							action: 'query',
							list: 'categorymembers',
							cmtitle: cat,
							cmtype: 'subcat',
							cmlimit: 'max',
						})
					)
				);
				depth3Results.forEach((res) => {
					const members = res.categorymembers || [];
					members.forEach((m) => {
						memberSet.add(m.title);
						if (m.ns === CATEGORY_NAMESPACE) {
							subcatSet.add(m.title);
						}
					});
				});
			}

			mw.storage.set(
				cacheKey,
				JSON.stringify({
					members: Array.from(memberSet),
					subcats: Array.from(subcatSet),
				}),
				CACHE_TTL_TREE
			);

			return { members: memberSet, subcats: subcatSet };
		},

		async fetchParentCatsState() {
			const currentCats = mw.config.get('wgCategories');
			let baseCats;
			if (currentCats) {
				baseCats = currentCats.map((c) => CATEGORY_PREFIX + c.replace(/_/g, ' '));
			} else {
				const pageName = mw.config.get('wgPageName');
				const result = await fetchFullQuery(this.api, {
					action: 'query',
					titles: pageName,
					prop: 'categories',
					cllimit: 'max',
				});
				const pageData = result.pages && Object.values(result.pages)[0];
				baseCats =
					pageData && pageData.categories ? pageData.categories.map((c) => c.title) : [];
			}

			if (!this.isTemplatePage) {
				return baseCats;
			}

			// Template categories can come from the template's own <noinclude>
			// and from /doc's <includeonly>. The API list may not include the
			// latter when /doc is not transcluded, so read both explicitly.
			const cats = new Set(baseCats);
			try {
				const pageName = mw.config.get('wgPageName');
				const [templatePage, docPage] = await Promise.all([
					fetchPageContentMeta(this.api, pageName),
					fetchPageContentMeta(this.api, pageName + '/doc'),
				]);
				if (templatePage) {
					extractTemplatePageCategories(templatePage.content).forEach((c) => cats.add(c));
				}
				if (docPage) {
					extractIncludeonlyCategories(docPage.content).forEach((c) => cats.add(c));
				}
			} catch (err) {
				mw.log.warn('[CatSuggest] Could not read template category state:', err);
			}
			return Array.from(cats);
		},

		onAccordionFetch() {
			if (this.canFetch) {
				this.fetchSuggestions();
			}
		},

		async fetchSuggestions() {
			if (this.selectedSites.length === 0) {
				return;
			}

			log('fetchSuggestions start | mode:', this.mode, '| sites:', this.selectedSites);

			if (this.fetchAbortController) {
				this.fetchAbortController.abort();
			}
			this.fetchAbortController = new AbortController();
			const signal = this.fetchAbortController.signal;
			const request = this.beginWorkflowRequest('FETCH_START');
			const mode = request.mode;

			this.suggestions = [];
			this.existingRemovals = [];
			this.editFailures = [];
			this.appliedSites = [];
			this.editAborted = false;
			this.lastEditAddedCount = 0;
			this.lastEditRemovedCount = 0;
			this.currentEditAction = 'add';
			this.modal = null;

			const globalCatToSites = new Map();
			const redirectResolvedCatToSites = new Map();
			const foreignNamesByTitle = new Map();
			const currentPageTitle = mw.config.get('wgTitle').replace(/_/g, ' ');
			const currentCategoryTitle = this.isCatPage ? CATEGORY_PREFIX + currentPageTitle : '';

			try {
				const sitesToProcess = this.selectedSites.slice();
				const localStatePromise = this.fetchLocalState();
				const wikidataCategoriesPromise =
					mode === 'parentCats'
						? fetchWikidataDerivedCategories(this.wikidataApi, this.qid)
						: Promise.resolve([]);

				if (this.rememberLangs) {
					mw.storage.set(
						getUserLangsKey(mode),
						JSON.stringify(this.selectedSites),
						31536000
					);
				}

				const processLanguage = async (site) => {
					if (signal.aborted) {
						return;
					}
					const siteData = this.sitelinksBySite.get(site);
					if (!siteData) {
						return;
					}
					const lang = siteData.lang;
					const foreignApi = createForeignApi(siteData.apiHost);

					if (mode === 'parentCats') {
						await fetchParentCatsSuggestions(
							foreignApi,
							siteData,
							lang,
							globalCatToSites,
							this.qid,
							redirectResolvedCatToSites,
							foreignNamesByTitle
						);
					} else {
						await fetchMembersSuggestions(
							foreignApi,
							siteData,
							lang,
							globalCatToSites,
							this.qid,
							redirectResolvedCatToSites,
							foreignNamesByTitle
						);
					}
				};

				let failedSiteCount = 0;
				for (let i = 0; i < sitesToProcess.length; i += FETCH_CONCURRENCY) {
					if (signal.aborted) {
						throw abortError();
					}
					const batch = sitesToProcess.slice(i, i + FETCH_CONCURRENCY);
					const batchResults = await settleAll(
						batch.map((site) => processLanguage(site))
					);
					if (signal.aborted) {
						throw abortError();
					}
					for (const result of batchResults) {
						if (result.status === 'rejected') {
							failedSiteCount++;
							mw.log.warn('CatSuggest site fetch error:', result.reason);
						}
					}
					if (i + FETCH_CONCURRENCY < sitesToProcess.length) {
						await sleep(SLEEP_BETWEEN_BATCHES_MS);
					}
				}

				if (signal.aborted) {
					throw abortError();
				}

				if (failedSiteCount === sitesToProcess.length) {
					this.dispatchWorkflow({
						type: 'FETCH_FAIL',
						requestId: request.requestId,
						mode,
						error: 'Seçilmiş dillərdən heç birindən məlumat alına bilmədi. İnternet bağlantınızı yoxlayın və yenidən cəhd edin.',
					});
					return;
				}

				const localData = await localStatePromise;
				if (!this.isCurrentRequest(request)) {
					return;
				}

				const wikidataTitles = await wikidataCategoriesPromise;
				if (!this.isCurrentRequest(request)) {
					return;
				}

				if (globalCatToSites.size === 0 && wikidataTitles.length === 0) {
					this.dispatchWorkflow({
						type: 'FETCH_FAIL',
						requestId: request.requestId,
						mode,
						error:
							mode === 'parentCats'
								? 'Seçilmiş dillərdə kateqoriya tapılmadı. Daha çox dil seçməyə və ya başqa dilləri sınamağa cəhd edin.'
								: 'Seçilmiş dillərdə bu kateqoriyanın üzvü tapılmadı. Kateqoriyanın daha populyar dillərdə mövcud olduğunu yoxlayın.',
					});
					return;
				}

				const resolvedResults = Array.from(globalCatToSites.entries()).map(
					([title, sitesSet]) => ({
						title,
						sources: Array.from(sitesSet),
						redirectSites: Array.from(redirectResolvedCatToSites.get(title) || []),
					})
				);
				const seenResolvedTitles = new Set(resolvedResults.map((r) => r.title));
				wikidataTitles.forEach((title) => {
					if (seenResolvedTitles.has(title)) {
						return;
					}
					seenResolvedTitles.add(title);
					resolvedResults.push({ title, sources: [], isWikidataDerived: true });
				});

				if (resolvedResults.length === 0) {
					this.dispatchWorkflow({
						type: 'FETCH_FAIL',
						requestId: request.requestId,
						mode,
						error: 'Müqayisə edilən vikilərdəki kateqoriyaların heç biri Azərbaycanca Vikipediyada mövcud deyil. Ya seçilmiş dillərdəki kateqoriyalar burada yaradılmayıb, ya da səhifənin adı fərqlidir.',
					});
					return;
				}

				let suggestions;
				let existingRemovals = [];
				if (mode === 'parentCats') {
					const templateAddedCats = this.isTemplatePage
						? new Set()
						: await detectTemplateAddedCategories(
								this.api,
								mw.config.get('wgPageName').replace(/_/g, ' '),
								localData
							);
					if (!this.isCurrentRequest(request)) {
						return;
					}

					const built = await buildParentCatsSuggestions(
						resolvedResults,
						localData,
						this.api,
						currentPageTitle,
						templateAddedCats,
						redirectResolvedCatToSites,
						foreignNamesByTitle,
						currentCategoryTitle,
						{
							allowTemplateCategories:
								this.isTemplatePage || this.isTemplateCategoryPage,
						}
					);
					if (!this.isCurrentRequest(request)) {
						return;
					}
					suggestions = built.suggestions;

					if (this.isTemplatePage) {
						// Templates only support category additions; removals
						// would have to edit a second page in the general case.
						suggestions.forEach((s) => {
							s.removals = [];
						});
						existingRemovals = [];
					} else {
						existingRemovals = await buildExistingRemovals(
							localData,
							this.api,
							templateAddedCats,
							built.parentMap,
							currentPageTitle,
							{
								allowTemplateCategories:
									this.isTemplatePage || this.isTemplateCategoryPage,
							}
						);
						if (!this.isCurrentRequest(request)) {
							return;
						}
						existingRemovals.forEach(
							(rem) => (rem.flatTree = this.flattenTree(rem.tree, 0))
						);
					}
				} else {
					const currentPageCats = await this.fetchParentCatsState();
					if (!this.isCurrentRequest(request)) {
						return;
					}
					suggestions = await buildMembersSuggestions(
						resolvedResults,
						localData,
						this.api,
						new Set(currentPageCats),
						redirectResolvedCatToSites,
						foreignNamesByTitle,
						currentCategoryTitle,
						{ isTemplateCategoryPage: this.isTemplateCategoryPage }
					);
					if (!this.isCurrentRequest(request)) {
						return;
					}
				}

				suggestions.sort((a, b) =>
					a.title
						.replace(/^(Kateqoriya|Category):/i, '')
						.localeCompare(b.title.replace(/^(Kateqoriya|Category):/i, ''))
				);

				this.closeSortKeyPopover();
				this.suggestions = suggestions;
				this.existingRemovals = existingRemovals;

				let completionError = null;
				if (suggestions.length === 0) {
					completionError = 'Yeni təklif tapılmadı.';
				} else {
					// Only prune languages that produced no results. On an empty
					// result keep the user's selection so they can adjust it.
					this.pruneInactiveSites();
					this.appliedSites = this.selectedSites.slice();
				}

				this.langsAccordionOpen = false;
				this.dispatchWorkflow({
					type: 'FETCH_COMPLETE',
					requestId: request.requestId,
					mode,
					error: completionError,
				});
			} catch (_err) {
				if (_err.name === 'AbortError') {
					return;
				}
				if (!this.isCurrentRequest(request)) {
					return;
				}
				mw.log.warn('Xəta:', _err);
				this.dispatchWorkflow({
					type: 'FETCH_FAIL',
					requestId: request.requestId,
					mode,
					error: 'Xəta baş verdi: ' + getErrorMessage(_err),
				});
			} finally {
				if (this.fetchAbortController && this.fetchAbortController.signal === signal) {
					this.fetchAbortController = null;
				}
			}
		},

		pruneInactiveSites() {
			const activeLangs = new Set();
			this.suggestions.forEach((s) => s.sources.forEach((l) => activeLangs.add(l)));
			this.modeSelectedSites[this.mode] = this.modeSelectedSites[this.mode].filter((site) => {
				const sl = this.sitelinksBySite.get(site);
				return sl && activeLangs.has(sl.lang);
			});
		},

		async applyChanges() {
			this.closeSortKeyPopover();
			if (this.mode === 'members') {
				await this.addCategoryToArticles();
			} else {
				await this.addParentCategories();
			}
		},

		handleBeforeUnload(event) {
			if (this.status !== 'editing') {
				return;
			}
			event.preventDefault();
			event.returnValue = '';
		},

		async addParentCategories() {
			const currentPageTitle = mw.config.get('wgTitle').replace(/_/g, ' ');
			const currentCategoryTitle = this.isCatPage ? CATEGORY_PREFIX + currentPageTitle : '';
			const titlesToAdd = this.suggestions
				.filter((s) => s.selected && s.title !== currentCategoryTitle)
				.map((s) => ({ title: s.title, sortKey: sanitizeSortKey(s.sortKey) }));
			const removalSet = new Set();
			this.suggestions.forEach((s) => {
				(s.removals || []).forEach((r) => {
					if (r.selected) {
						removalSet.add(r.title);
					}
				});
			});
			this.existingRemovals.forEach((r) => {
				if (r.selected) {
					removalSet.add(r.title);
				}
			});
			const titlesToRemove = this.isTemplatePage ? [] : Array.from(removalSet);
			if (titlesToAdd.length === 0 && titlesToRemove.length === 0) {
				return;
			}

			this.currentEditAction =
				titlesToAdd.length > 0 && titlesToRemove.length > 0
					? 'mixed'
					: titlesToRemove.length > 0
						? 'remove'
						: 'add';
			this.lastEditAddedCount = 0;
			this.lastEditRemovedCount = 0;

			const pageTitle = mw.config.get('wgPageName');
			this.dispatchWorkflow({ type: 'APPLY_START' });
			this.editFailures = [];
			this.editAborted = false;
			this.totalProcessingCount = 1;
			this.processedCount = 0;
			this.currentProcessingTitle = pageTitle;

			try {
				let addedCount;
				if (this.isTemplatePage) {
					const result = await addTemplateCategoriesEdit(
						this.api,
						pageTitle,
						titlesToAdd,
						await this.fetchParentCatsState()
					);
					addedCount = result.addedCount;
					// Categories added via /doc do not refresh the transcluding
					// template's link tables, so re-save it unchanged.
					if (needsTemplateLinkRefresh(pageTitle, result)) {
						try {
							await refreshTemplateLinks(this.api, pageTitle);
						} catch (refreshErr) {
							// The category edit succeeded; a stale category
							// listing must not be reported as a failed edit.
							mw.log.warn('CatSuggest link refresh error:', refreshErr);
						}
					}
				} else {
					await addParentCategoriesEdit(
						this.api,
						pageTitle,
						titlesToAdd,
						titlesToRemove,
						escapeRegex
					);
					addedCount = titlesToAdd.length;
				}

				// The edit request cannot be cancelled once sent; it always runs to
				// completion, so a stop request made meanwhile is moot.
				this.editAborted = false;
				this.processedCount = 1;
				this.lastEditAddedCount = addedCount;
				this.lastEditRemovedCount = titlesToRemove.length;
				this.dispatchWorkflow({ type: 'APPLY_COMPLETE' });
			} catch (_err) {
				mw.log.warn('CatSuggest edit error:', _err);
				this.dispatchWorkflow({
					type: 'APPLY_FAIL',
					error:
						'Kateqoriyaları redaktə edərkən xəta baş verdi: ' + getErrorMessage(_err),
				});
			}
		},

		async addCategoryToArticles() {
			const selectedItems = this.suggestions.filter((s) => s.selected);
			if (selectedItems.length === 0) {
				return;
			}

			this.dispatchWorkflow({ type: 'APPLY_START' });
			this.editFailures = [];
			this.editAborted = false;
			this.lastEditAddedCount = 0;
			this.lastEditRemovedCount = 0;
			this.currentEditAction = 'add';
			this.totalProcessingCount = selectedItems.length;
			this.processedCount = 0;
			this.currentProcessingTitle = 'Mövcud kateqoriyalar yoxlanılır...';

			try {
				const pageName = mw.config.get('wgPageName');
				const normalizedPageName = pageName.replace(/_/g, ' ');
				const categoryTag = '\n[[' + normalizedPageName + ']]';

				// A resumed or stale suggestion may already contain the category.
				// Check in batches before appending so interruptions cannot create
				// duplicate category links.
				let alreadyInCategory;
				try {
					alreadyInCategory = await findTitlesAlreadyInCategory(
						this.api,
						selectedItems.map((item) => item.title),
						normalizedPageName
					);
				} catch (_err) {
					mw.log.warn('Category precheck error:', _err);
					this.dispatchWorkflow({
						type: 'APPLY_FAIL',
						error:
							'Mövcud kateqoriyaları yoxlayarkən xəta baş verdi: ' +
							getErrorMessage(_err),
					});
					return;
				}

				let itemsToEdit = selectedItems;
				if (alreadyInCategory.size > 0) {
					this.suggestions = this.suggestions.filter(
						(s) => !alreadyInCategory.has(s.title)
					);
					itemsToEdit = selectedItems.filter(
						(item) => !alreadyInCategory.has(item.title)
					);
				}

				if (itemsToEdit.length === 0) {
					this.invalidateMembersState();
					this.dispatchWorkflow({
						type: 'APPLY_FAIL',
						error: 'Seçilmiş səhifələrdə bu kateqoriya artıq mövcuddur.',
					});
					return;
				}

				const editGroupSuffix =
					ENABLE_EDIT_GROUP_LINKS && itemsToEdit.length >= 8
						? ' ([[:toolforge:editgroups-azwiki/b/CS/' +
							generateBatchId() +
							'|detallar]])'
						: '';

				this.totalProcessingCount = itemsToEdit.length;
				// Clear the pre-edit member list before the first edit. If the
				// browser is closed mid-batch, the next fetch still reflects the
				// pages that were edited.
				this.invalidateMembersState();

				for (const item of itemsToEdit) {
					if (this.editAborted) {
						break;
					}
					this.currentProcessingTitle = item.title;
					try {
						const namespaceId = new mw.Title(item.title).getNamespaceId();
						if (isTemplateMember(namespaceId)) {
							const result = await addTemplateCategoriesEdit(this.api, item.title, [
								{ title: normalizedPageName },
							]);
							// A /doc edit does not refresh the template's category
							// index; the null edit is best-effort.
							if (needsTemplateLinkRefresh(item.title, result)) {
								try {
									await refreshTemplateLinks(this.api, item.title);
								} catch (refreshErr) {
									mw.log.warn(
										'CatSuggest template link refresh error:',
										refreshErr
									);
								}
							}
						} else {
							await addCategoryToMembersEdit(
								this.api,
								item.title,
								categoryTag,
								editGroupSuffix,
								pageName
							);
						}
						this.processedCount++;
						if (this.editAborted) {
							break;
						}
						await sleep(300);
					} catch (_err) {
						mw.log.warn('Error editing ' + item.title + ':', _err);
						this.editFailures.push({
							title: item.title,
							error: getErrorMessage(_err),
						});
					}
				}

				this.lastEditAddedCount = this.processedCount;

				const outcome = getBatchOutcome({
					total: itemsToEdit.length,
					succeeded: this.processedCount,
					failed: this.editFailures.length,
					aborted: this.editAborted,
				});
				this.editAborted = outcome.aborted;
				if (outcome.markProcessed) {
					markPageAsProcessed(currentPageId);
				}
				this.dispatchWorkflow(
					outcome.phase === 'success'
						? { type: 'APPLY_COMPLETE' }
						: { type: 'APPLY_FAIL', error: outcome.error }
				);
			} catch (_err) {
				mw.log.warn('Batch edit error:', _err);
				this.dispatchWorkflow({
					type: 'APPLY_FAIL',
					error:
						this.membersEditErrorLabel +
						' redaktə edərkən xəta baş verdi: ' +
						getErrorMessage(_err),
				});
			}
		},

		getPageUrl(title) {
			return mw.util.getUrl(title);
		},

		openGadgetHelp() {
			window.open(
				this.getPageUrl('Vikipediya:Qadcetlər/Kateqoriya təklifçisi'),
				'_blank',
				'noopener'
			);
		},

		// Codex renders the dialog title itself, so attach the help link to it
		// as a real <a> after the dialog is mounted. This keeps the native close
		// button while putting "?" right next to the label.
		syncDialogHelpLink() {
			const dialog = document.querySelector('.catsuggest-main-dialog');
			if (!dialog) {
				return;
			}
			const title = dialog.querySelector('.cdx-dialog__header__title');
			if (!title) {
				return;
			}
			const previous = title.querySelector('.catsuggest-dialog-help');
			if (previous) {
				previous.remove();
			}
			const link = document.createElement('a');
			link.className = 'catsuggest-dialog-help';
			link.href = this.getPageUrl('Vikipediya:Qadcetlər/Kateqoriya təklifçisi');
			link.target = '_blank';
			link.rel = 'noopener';
			link.title = 'Qadcet haqqında';
			link.setAttribute('aria-label', 'Qadcet haqqında');
			link.textContent = '?';
			title.appendChild(link);
		},

		displayCategoryTitle(title) {
			return String(title).replace(/^(?:Kateqoriya|Category):/i, '');
		},

		onSortKeyTitleClick(event) {
			if (event.target.classList.contains('cdx-popover__header__title')) {
				window.open(
					this.getPageUrl('mw:Special:MyLanguage/Help:Categories'),
					'_blank',
					'noopener'
				);
			}
		},

		toggleSortKeyPopover(cat, event) {
			if (this.sortKeyPopoverOpen && this.activeSortKeySuggestion === cat) {
				this.closeSortKeyPopover();
				return;
			}
			this.activeSortKeySuggestion = cat;
			this.sortKeyDraft = cat.sortKey || '';
			this.applySortKeyToAll = false;
			this.sortKeyPopoverAnchor = event.currentTarget;
			this.sortKeyPopoverOpen = true;
		},

		saveSortKey() {
			if (!this.activeSortKeySuggestion) {
				return;
			}
			const sortKey = sanitizeSortKey(this.sortKeyDraft);
			if (this.applySortKeyToAll) {
				this.suggestions.forEach((suggestion) => {
					suggestion.sortKey = sortKey;
				});
			} else {
				this.activeSortKeySuggestion.sortKey = sortKey;
			}
			this.closeSortKeyPopover();
		},

		cancelSortKey() {
			this.closeSortKeyPopover();
		},

		closeSortKeyPopover() {
			this.sortKeyPopoverOpen = false;
			this.activeSortKeySuggestion = null;
			this.sortKeyPopoverAnchor = null;
			this.sortKeyDraft = '';
			this.applySortKeyToAll = false;
		},

		sourcesStatus(item) {
			return item.azRedirectFrom ||
				(item.redirectSites || []).some((lang) => item.sources.includes(lang))
				? 'warning'
				: 'progressive';
		},

		suggestionTooltip(item) {
			const pairs = item.foreignNames || [];
			if (pairs.length === 0) {
				return null;
			}
			const byLang = new Map();
			pairs.forEach((p) => {
				if (!byLang.has(p.lang)) {
					byLang.set(p.lang, []);
				}
				byLang.get(p.lang).push(p.name);
			});
			const isRedirect = item.redirectSites.length > 0 || Boolean(item.azRedirectFrom);
			return (
				(isRedirect ? 'Y\u00f6nl\u0259ndirm\u0259y\u0259 g\u00f6r\u0259:\n' : '') +
				Array.from(byLang, ([lang, names]) => lang + ' \u2192 ' + names.join(', ')).join(
					'\n'
				)
			);
		},

		getForeignPageUrl(site, title) {
			const sl = this.sitelinksBySite.get(site);
			const host = sl
				? sl.apiHost
				: site.replace(/wiki$/, '').replace(/_/g, '-') + '.wikipedia.org';
			return 'https://' + host + '/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
		},

		getSiteLang(site) {
			const sl = this.sitelinksBySite.get(site);
			return sl ? sl.lang : site;
		},

		getSiteTitle(site) {
			const sl = this.sitelinksBySite.get(site);
			return sl ? sl.title : '';
		},

		handleClose() {
			if (this.status === 'editing') {
				this.modal = 'cancelEdit';
				return;
			}
			if (this.status === 'success') {
				location.reload();
				return;
			}
			this.modal = null;
			this.closeSortKeyPopover();
			if (this.fetchAbortController) {
				this.fetchAbortController.abort();
				this.fetchAbortController = null;
			}
			if (this.status === 'loading') {
				this.dispatchWorkflow({
					type: 'CANCEL',
					requestId: this.workflow.requestId,
				});
			}
			this.dialogShown = false;
		},

		confirmCancelEdit() {
			this.modal = null;
			if (this.status === 'editing') {
				this.editAborted = true;
			}
		},

		onModalOpenChange(expected, open) {
			if (!open && this.modal === expected) {
				this.modal = null;
			}
		},

		setupScrollObserver() {
			if (this._scrollObserver) {
				this._scrollObserver.disconnect();
			}
			const sentinel = this.$refs.resultsSentinel;
			if (!sentinel) {
				this.hasScrolledResults = true;
				return;
			}
			const rect = sentinel.getBoundingClientRect();
			if (rect.top < window.innerHeight) {
				this.hasScrolledResults = true;
				return;
			}
			this._scrollObserver = new IntersectionObserver(
				(entries) => {
					if (entries[0].isIntersecting) {
						this.hasScrolledResults = true;
						this._scrollObserver.disconnect();
					}
				},
				{ threshold: 0 }
			);
			this._scrollObserver.observe(sentinel);
		},

		handleApplyClick() {
			if (this.mode === 'members' && this.selectedCount >= CONFIRM_BATCH_THRESHOLD) {
				this.modal = 'confirm';
			} else {
				this.applyChanges();
			}
		},

		confirmAndApply() {
			this.modal = null;
			this.applyChanges();
		},

		flattenTree(tree, depth = 0, ancestorIsLast = []) {
			let flat = [];
			tree.forEach((node, index) => {
				const isLast = index === tree.length - 1;
				flat.push({
					title: node.title,
					depth,
					isLast,
					ancestorIsLast,
				});
				flat = flat.concat(
					this.flattenTree(node.children, depth + 1, [...ancestorIsLast, isLast])
				);
			});
			return flat;
		},

		onSiteFilterInput: debounce(function (val) {
			this.debouncedSiteFilter = val;
		}, DEBOUNCE_MS),
	},
	watch: {
		dialogShown(open) {
			if (open) {
				this.$nextTick(() => this.syncDialogHelpLink());
			}
		},
		dialogTitle() {
			this.$nextTick(() => this.syncDialogHelpLink());
		},
		mode() {
			if (this.fetchAbortController) {
				this.fetchAbortController.abort();
				this.fetchAbortController = null;
			}
			// Invalidate an in-flight fetch so its late response cannot write
			// into the newly selected tab. Initialization is mode-independent:
			// letting it finish keeps the shared language list available.
			if (this.workflow.phase !== 'initializing' && this.workflow.phase !== 'applying') {
				this.dispatchWorkflow({ type: 'RESET' });
			}
			this.suggestions = [];
			this.existingRemovals = [];
			this.editFailures = [];
			this.editAborted = false;
			this.lastEditAddedCount = 0;
			this.lastEditRemovedCount = 0;
			this.currentEditAction = 'add';
			this.modal = null;
			this.hasScrolledResults = false;
			this.appliedSites = [];
			this.langsAccordionOpen = true;
		},
		status(newVal) {
			if (newVal !== 'editing' && this.modal === 'cancelEdit') {
				this.modal = null;
			}
			if (newVal === 'results') {
				this.hasScrolledResults = false;
				this.$nextTick(() => this.setupScrollObserver());
			}
		},
		sitelinks() {
			if (
				this.langTab === 'large' &&
				this.largeSitelinks.length === 0 &&
				this.smallSitelinks.length > 0
			) {
				this.langTab = 'small';
			}
		},
	},
	created() {
		// Kept off the reactive data object: the cache is an implementation
		// detail and its promises must not be proxied by Vue.
		this._localStateCache = createAsyncCache();
	},
	mounted() {
		const catLinks = document.getElementById('catlinks');
		if (catLinks) {
			const btnContainer = document.createElement('div');
			btnContainer.id = 'catsuggest-btn-container';
			catLinks.parentNode.insertBefore(btnContainer, catLinks.nextSibling);
			this.showButtonTarget = true;
		}
		if (this.isTemplatePage) {
			this.resolveTemplateTarget();
		}
		window.addEventListener('beforeunload', this.handleBeforeUnload);
	},

	beforeUnmount() {
		window.removeEventListener('beforeunload', this.handleBeforeUnload);
	},
};
</script>
