<template>
	<teleport to="#catsuggest-btn-container" v-if="showButtonTarget">
		<cdx-button
			size="medium"
			:action="devMode ? 'destructive' : 'progressive'"
			:disabled="!qid"
			@click="toggleDialog"
		>
			{{ isCatPage ? 'Təkliflər' : 'Kateqoriya təklifləri' }}
		</cdx-button>
	</teleport>

	<cdx-dialog
		v-model:open="dialogShown"
		:title="mode === 'members' ? 'Məqalə və altkateqoriya təklifləri' : 'Kateqoriya təklifləri'"
		:use-close-button="true"
		close-button-label="Bağla"
		@update:open="handleClose"
	>
		<template #default>
			<div v-if="status === 'idle' || status === 'loading' || status === 'results'">
				<div v-if="isCatPage" class="catsuggest-tabs">
					<cdx-tabs v-model:active="mode">
						<cdx-tab
							name="members"
							label="Məqalə və altkateqoriya"
							:disabled="isExcludedCategory || !isAuthorized"
						/>
						<cdx-tab name="parentCats" label="Kateqoriya" />
					</cdx-tabs>
					<cdx-message v-if="isExcludedCategory" type="warning" style="margin-top: 8px">
						Bu kateqoriya üçün məqalə və altkateqoriya təklifləri deaktiv edilib.
					</cdx-message>
					<cdx-message v-else-if="!isAuthorized" type="warning" style="margin-top: 8px">
						Məqalə və altkateqoriya bölməsindən istifadə yalnız müraciət əsasında
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
						Keşlənmiş məlumatlar köhnəlmiş ola bilər və eyni səhifələrə təkrar
						kateqoriya əlavə etməyinizə səbəb ola bilər. Zəhmət olmasa, "Davam et"
						düyməsinə klikləməmişdən əvvəl ən azı 1 dəqiqə gözləyin.
					</cdx-message>
					<cdx-button
						style="margin-top: 16px"
						action="progressive"
						@click="alreadyProcessed = false"
						>Davam et</cdx-button
					>
				</div>

				<template v-else>
					<p v-if="mode === 'parentCats'">
						Digər dillərdəki məqalələrə əlavə edilmiş kateqoriyalar əsasında təkliflər.
					</p>
					<p v-else>
						Digər dillərdəki eyni kateqoriyanın üzvləri əsasında bu kateqoriyaya əlavə
						edilə biləcək məqalələr və altkateqoriyalar.
					</p>

					<div
						v-if="
							sitelinks.length > 0 &&
							(status === 'idle' || status === 'loading' || status === 'results')
						"
						class="catsuggest-site-section"
					>
						<div class="catsuggest-header">
							<p class="catsuggest-header__label">Dilləri seçin:</p>
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

						<div v-if="langTab === 'large'" :class="gridClass">
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

						<div v-if="langTab === 'small'" :class="gridClass">
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
							:type="selectedSites.length === sitelinks.length ? 'warning' : 'info'"
							class="catsuggest-lang-warning"
						>
							{{ selectedSites.length }} dil seçilib. Axtarışın təxminən
							{{ estimatedTime }} saniyə çəkəcəyi gözlənilir.
						</cdx-message>
					</div>

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
									<li v-for="site in selectedSites" :key="site">
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
											>Məqalələr ({{ suggestedPages.length }})</template
										>
										<div
											v-for="item in suggestedPages"
											:key="item.title"
											class="catsuggest-suggestion"
										>
											<cdx-checkbox v-model="item.selected">
												<a
													:href="getPageUrl(item.title)"
													target="_blank"
													class="catsuggest-suggestion__link"
													@click.stop
													>{{ item.title }}</a
												>
												<span
													v-if="item.sources && item.sources.length"
													class="catsuggest-suggestion__sources"
												>
													[{{ item.sources.join(', ') }}]
												</span>
											</cdx-checkbox>
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
											<cdx-checkbox v-model="item.selected">
												<a
													:href="getPageUrl(item.title)"
													target="_blank"
													class="catsuggest-suggestion__link"
													@click.stop
													>{{ item.title }}</a
												>
												<span
													v-if="item.sources && item.sources.length"
													class="catsuggest-suggestion__sources"
												>
													[{{ item.sources.join(', ') }}]
												</span>
											</cdx-checkbox>
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
										<cdx-checkbox v-model="cat.selected">
											<a
												:href="getPageUrl(cat.title)"
												target="_blank"
												class="catsuggest-suggestion__link"
												@click.stop
												>{{ cat.title }}</a
											>
											<span
												v-if="cat.sources && cat.sources.length"
												class="catsuggest-suggestion__sources"
											>
												[{{ cat.sources.join(', ') }}]
											</span>
										</cdx-checkbox>
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
															>{{ rem.title }}</a
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
													>{{ rem.title }}</a
												></s
											>
											<template #description
												>Səbəb: {{ rem.reasons.join(', ') }}</template
											>
										</cdx-checkbox>
									</div>
								</cdx-accordion>
							</div>
						</div>
						<div ref="resultsSentinel" style="height: 1px"></div>
					</div>
				</template>
			</div>

			<div v-else-if="status === 'editing'" class="catsuggest-progress">
				<cdx-progress-bar aria-label="Redaktə edilir" />
				<p v-if="mode === 'parentCats'" style="margin-top: 12px">
					Kateqoriyalar əlavə edilir
				</p>
				<p v-else style="margin-top: 12px">
					{{ currentProcessingTitle }} ({{ processedCount }}/{{ totalProcessingCount }})
				</p>
			</div>

			<div v-else-if="status === 'success'" class="catsuggest-success">
				<p class="catsuggest-success__text">Kateqoriyalar uğurla əlavə edildi!</p>
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
				<div class="catsuggest-footer__help">
					<a
						:href="getPageUrl('Vikipediya:Qadcetlər/Kateqoriya təklifçisi')"
						target="_blank"
						class="catsuggest-suggestion__link"
						>Qadcet haqqında</a
					>
				</div>
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
						>{{ selectedCount > 0 ? 'Təsdiq et' : 'Sil' }}</cdx-button
					>
				</div>
			</div>
		</template>
	</cdx-dialog>

	<cdx-dialog
		v-model:open="confirmDialogShown"
		title="Redaktəni təsdiqləyin"
		:use-close-button="true"
		close-button-label="Bağla"
	>
		<template #default>
			<p>
				Siz <strong>{{ selectedCount }} məqaləyə</strong> kateqoriya əlavə etmək üzrəsiniz.
			</p>
			<p style="margin-top: 8px">Bütün təklifləri yoxlamısınız?</p>
		</template>
		<template #footer>
			<div class="catsuggest-footer">
				<div class="catsuggest-footer__actions">
					<cdx-button size="medium" @click="confirmDialogShown = false"
						>İmtina</cdx-button
					>
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
	CURRENT_WIKI,
	FETCH_CONCURRENCY,
	SLEEP_BETWEEN_BATCHES_MS,
	DEBOUNCE_MS,
	CONFIRM_BATCH_THRESHOLD,
	EXCLUDED_SITES,
	EXCLUDED_PARENT_QIDS,
	LARGE_WIKI_SITES,
	CACHE_KEY_USER_LANGS,
	CACHE_KEY_TREE_PREFIX,
	CACHE_TTL_TREE,
	MAX_DEPTH1_SUBCATS,
	MAX_DEPTH2_SUBCATS,
	DEPTH2_BATCH_SIZE,
	log,
	debounce,
	escapeRegex,
} = require('./constants.js');
const {
	sleep,
	retryApiCall,
	getErrorMessage,
	fetchFullQuery,
	createForeignApi,
} = require('./api.js');
const {
	loadSiteMetadata,
	isPageProcessed,
	markPageAsProcessed,
	isCatPageExcluded,
} = require('./cache.js');
const {
	fetchParentCatsSuggestions,
	fetchMembersSuggestions,
	resolveQidsToAzwiki,
	buildParentCatsSuggestions,
	buildExistingRemovals,
	buildMembersSuggestions,
	detectUncategorizedTemplates,
} = require('./suggestions.js');
const { addParentCategoriesEdit, addCategoryToMembersEdit } = require('./edit.js');

const currentPageId = mw.config.get('wgArticleId');

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

		return {
			dialogShown: false,
			loading: false,
			suggestions: [],
			qid: mw.config.get('wgWikibaseItemId'),
			status: 'idle',
			selectedSuggestions: [],
			error: null,
			sitelinks: [],
			modeSelectedSites: {
				members: [],
				parentCats: [],
			},
			siteFilter: '',
			debouncedSiteFilter: '',
			mode: isCatPage && !isPageExcluded && this.isAuthorized ? 'members' : 'parentCats',
			isCatPage,
			localStateCache: {},
			currentProcessingTitle: '',
			processedCount: 0,
			totalProcessingCount: 0,
			editFailures: [],
			showButtonTarget: false,
			rememberLangs: false,
			hasScrolledResults: false,
			confirmDialogShown: false,
			alreadyProcessed: isCatPage && isPageProcessed(currentPageId),
			langTab: 'large',
			fetchAbortController: null,
			existingRemovals: [],
			UncategorizedPages: new Set(),
		};
	},
	computed: {
		canFetch() {
			return this.selectedSites.length > 0 && !this.loading;
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
			const sleepTime = (batches - 1) * 0.5;
			const networkTime = batches * 0.3 + 0.8;
			return Math.ceil(sleepTime + networkTime);
		},
		sitelinksBySite() {
			const map = new Map();
			this.sitelinks.forEach((s) => map.set(s.site, s));
			return map;
		},
	},
	methods: {
		toggleDialog() {
			this.dialogShown = !this.dialogShown;
			if (this.dialogShown) {
				if (this.sitelinks.length === 0) {
					this.initGadget();
				}
			}
		},

		async initGadget() {
			if (!this.qid) {
				this.error =
					'Bu səhifə Vikidataya qoşulmayıb. Zəhmət olmasa, əvvəlcə səhifəni Vikidata elementinə qoşun.';
				return;
			}

			this.loading = true;
			this.status = 'loading';
			try {
				const wdResp = await retryApiCall(() =>
					this.wikidataApi.get({
						action: 'wbgetentities',
						ids: this.qid,
						props: 'sitelinks',
						format: 'json',
					})
				);

				const entity = wdResp.entities[this.qid];
				if (!entity || !entity.sitelinks) {
					this.error =
						'Bu səhifənin interviki keçidləri mövcud deyil. Səhifənin Vikidata elementinə digər dillərdəki səhifələr əlavə edilməyib.';
					this.status = 'idle';
					return;
				}

				const { langMap, interwikiMap } = await loadSiteMetadata(this.api);

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
					this.error =
						'Seçdiyiniz dillərin heç birində bu səhifənin qarşılığı tapılmadı. Ola bilər ki, bu səhifə yalnız Azərbaycanca Vikipediyada mövcuddur.';
					this.status = 'idle';
					return;
				}

				const cachedUserLangs = mw.storage.get(CACHE_KEY_USER_LANGS);
				let initialLangs = [];

				if (cachedUserLangs) {
					try {
						const parsed = JSON.parse(cachedUserLangs);
						if (Array.isArray(parsed) && parsed.length > 0) {
							initialLangs = parsed.filter((site) =>
								this.sitelinks.some((s) => s.site === site)
							);
						}
					} catch (_err) {
						mw.log.warn('User langs parse error:', _err);
						mw.storage.remove(CACHE_KEY_USER_LANGS);
					}
				}

				if (initialLangs.length === 0) {
					initialLangs = Array.from(LARGE_WIKI_SITES).filter((site) =>
						this.sitelinks.some((s) => s.site === site)
					);
				}

				if (initialLangs.length > 0) {
					this.modeSelectedSites.members = initialLangs.slice();
					this.modeSelectedSites.parentCats = initialLangs.slice();
				}

				this.status = 'idle';
			} catch (_err) {
				mw.log.warn('CatSuggest init error:', _err);
				const errMsg = getErrorMessage(_err);
				this.error =
					'Digər vikilərin siyahısı alınarkən xəta baş verdi. İnternet bağlantınızı yoxlayın və yenidən cəhd edin. Xəta: ' +
					errMsg;
				this.status = 'idle';
			} finally {
				this.loading = false;
			}
		},

		async fetchLocalState() {
			const mode = this.mode;
			const cacheKey = mode + '-' + currentPageId;

			if (this.localStateCache[cacheKey]) {
				return this.localStateCache[cacheKey];
			}

			const promise = this.fetchLocalStateImpl(mode, mw.config.get('wgPageName'));
			this.localStateCache[cacheKey] = promise;
			return promise;
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
							cmtype: 'page|subcat',
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
							cmtype: 'page|subcat',
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
			if (currentCats) {
				return currentCats.map((c) => CATEGORY_PREFIX + c.replace(/_/g, ' '));
			}

			const pageName = mw.config.get('wgPageName');
			const result = await fetchFullQuery(this.api, {
				action: 'query',
				titles: pageName,
				prop: 'categories',
				cllimit: 'max',
			});
			const pageData = result.pages && Object.values(result.pages)[0];
			return pageData && pageData.categories ? pageData.categories.map((c) => c.title) : [];
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

			this.loading = true;
			this.status = 'loading';
			this.suggestions = [];
			this.existingRemovals = [];
			this.UncategorizedPages = new Set();
			this.error = null;
			this.editFailures = [];

			const globalQidSet = new Set();
			const qidToSites = new Map();

			try {
				const sitesToProcess = this.selectedSites.slice();
				const localStatePromise = this.fetchLocalState();

				if (this.rememberLangs) {
					mw.storage.set(
						CACHE_KEY_USER_LANGS,
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

					if (this.mode === 'parentCats') {
						await fetchParentCatsSuggestions(
							foreignApi,
							siteData,
							lang,
							globalQidSet,
							qidToSites,
							this.qid
						);
					} else {
						await fetchMembersSuggestions(
							foreignApi,
							siteData,
							lang,
							globalQidSet,
							qidToSites,
							this.qid
						);
					}
				};

				for (let i = 0; i < sitesToProcess.length; i += FETCH_CONCURRENCY) {
					if (signal.aborted) {
						throw new DOMException('Aborted', 'AbortError');
					}
					const batch = sitesToProcess.slice(i, i + FETCH_CONCURRENCY);
					await Promise.all(batch.map((site) => processLanguage(site)));
					if (i + FETCH_CONCURRENCY < sitesToProcess.length) {
						await sleep(SLEEP_BETWEEN_BATCHES_MS);
					}
				}

				if (signal.aborted) {
					throw new DOMException('Aborted', 'AbortError');
				}

				const localData = await localStatePromise;

				if (globalQidSet.size === 0) {
					this.error =
						this.mode === 'parentCats'
							? 'Seçilmiş dillərdə kateqoriya tapılmadı. Daha çox dil seçməyə və ya başqa dilləri sınamağa cəhd edin.'
							: 'Seçilmiş dillərdə bu kateqoriyanın üzvü tapılmadı. Kateqoriyanın daha populyar dillərdə mövcud olduğunu yoxlayın.';
					this.status = 'idle';
					return;
				}

				if (this.mode === 'parentCats') {
					EXCLUDED_PARENT_QIDS.forEach((qid) => globalQidSet.delete(qid));
				}

				const resolvedResults = await resolveQidsToAzwiki(
					globalQidSet,
					qidToSites,
					signal,
					this.wikidataApi
				);

				if (resolvedResults.length === 0) {
					this.error =
						'Müqayisə edilən vikilərdəki kateqoriyaların heç biri Azərbaycanca Vikipediyada mövcud deyil. Ya seçilmiş dillərdəki kateqoriyalar burada yaradılmayıb, ya da səhifənin adı fərqlidir.';
					this.status = 'idle';
					return;
				}

				if (this.mode === 'parentCats') {
					this.suggestions = await buildParentCatsSuggestions(
						resolvedResults,
						localData,
						this.api
					);
				} else {
					this.suggestions = await buildMembersSuggestions(
						resolvedResults,
						localData,
						this.api
					);
				}

				if (this.mode === 'parentCats') {
					this.existingRemovals = await buildExistingRemovals(localData, this.api);
				}

				this.UncategorizedPages = await detectUncategorizedTemplates(
					this.mode === 'parentCats'
						? [mw.config.get('wgPageName')]
						: this.suggestions.map((s) => s.title),
					this.api
				);

				this.suggestions.sort((a, b) =>
					a.title
						.replace(/^(Kateqoriya|Category):/i, '')
						.localeCompare(b.title.replace(/^(Kateqoriya|Category):/i, ''))
				);

				if (this.suggestions.length === 0) {
					this.error = 'Yeni təklif tapılmadı.';
				}

				this.pruneInactiveSites();

				this.status = 'results';
			} catch (_err) {
				if (_err.name === 'AbortError') {
					return;
				}
				mw.log.warn('Xəta:', _err);
				this.error = 'Xəta baş verdi: ' + getErrorMessage(_err);
				this.status = 'idle';
			} finally {
				this.loading = false;
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
			if (this.mode === 'members') {
				await this.addCategoryToArticles();
			} else {
				await this.addParentCategories();
			}
		},

		async addParentCategories() {
			const titlesToAdd = this.suggestions.filter((s) => s.selected).map((s) => s.title);
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
			const titlesToRemove = Array.from(removalSet);
			const pageTitle = mw.config.get('wgPageName');
			const hasUncategorized = this.UncategorizedPages.has(
				pageTitle.replace(/_/g, ' ')
			);
			if (titlesToAdd.length === 0 && titlesToRemove.length === 0 && !hasUncategorized) {
				return;
			}

			this.status = 'editing';
			this.loading = true;
			this.editFailures = [];
			this.totalProcessingCount = 1;
			this.processedCount = 0;
			this.currentProcessingTitle = pageTitle;

			try {
				await addParentCategoriesEdit(
					this.api,
					pageTitle,
					titlesToAdd,
					titlesToRemove,
					escapeRegex,
					hasUncategorized
				);

				if (!this.dialogShown) {
					return;
				}

				this.processedCount = 1;
				this.status = 'success';
			} catch (_err) {
				mw.log.warn('CatSuggest edit error:', _err);
				this.error =
					'Kateqoriyaları əlavə edərkən xəta baş verdi: ' + getErrorMessage(_err);
				this.status = 'results';
			} finally {
				this.loading = false;
			}
		},

		async addCategoryToArticles() {
			const selectedItems = this.suggestions.filter((s) => s.selected);
			if (selectedItems.length === 0) {
				return;
			}

			const editGroupSuffix =
				selectedItems.length >= 8
					? ' ([[:toolforge:editgroups-azwiki/b/CS/' +
						this.generateBatchId() +
						'|detallar]])'
					: '';

			this.status = 'editing';
			this.loading = true;
			this.editFailures = [];
			this.totalProcessingCount = selectedItems.length;
			this.processedCount = 0;

			try {
				const categoryTag = '\n[[' + mw.config.get('wgPageName').replace(/_/g, ' ') + ']]';
				const pageName = mw.config.get('wgPageName');

				for (const item of selectedItems) {
					this.currentProcessingTitle = item.title;
					try {
						await addCategoryToMembersEdit(
							this.api,
							item.title,
							categoryTag,
							editGroupSuffix,
							pageName,
							this.UncategorizedPages.has(item.title)
						);
						this.processedCount++;
						if (!this.dialogShown) {
							return;
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

				this.status =
					this.editFailures.length === selectedItems.length ? 'results' : 'success';

				if (this.status === 'success') {
					markPageAsProcessed(currentPageId);
				}

				if (this.editFailures.length === selectedItems.length) {
					this.error = 'Bütün redaktələr uğursuz oldu.';
				}
			} catch (_err) {
				mw.log.warn('Batch edit error:', _err);
				this.error = 'Məqalələri redaktə edərkən xəta baş verdi: ' + getErrorMessage(_err);
				this.status = 'results';
			} finally {
				this.loading = false;
			}
		},

		generateBatchId() {
			return (
				Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10)
			);
		},

		getPageUrl(title) {
			return mw.util.getUrl(title);
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
			if (this.status === 'success') {
				location.reload();
			} else {
				if (this.fetchAbortController) {
					this.fetchAbortController.abort();
					this.fetchAbortController = null;
				}
				this.dialogShown = false;
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
				this.confirmDialogShown = true;
			} else {
				this.applyChanges();
			}
		},

		confirmAndApply() {
			this.confirmDialogShown = false;
			this.applyChanges();
		},

		onSiteFilterInput: debounce(function (val) {
			this.debouncedSiteFilter = val;
		}, DEBOUNCE_MS),
	},
	watch: {
		mode() {
			this.suggestions = [];
			this.status = 'idle';
			this.error = null;
			this.editFailures = [];
			this.hasScrolledResults = false;
		},
		status(newVal) {
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
	mounted() {
		const catLinks = document.getElementById('catlinks');
		if (catLinks) {
			const btnContainer = document.createElement('div');
			btnContainer.id = 'catsuggest-btn-container';
			catLinks.parentNode.insertBefore(btnContainer, catLinks.nextSibling);
			this.showButtonTarget = true;
		}
	},
};
</script>
