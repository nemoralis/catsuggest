/* eslint-disable no-console */
const esbuild = require( 'esbuild' );
const fs = require( 'fs' );
const path = require( 'path' );
const { parse, compileTemplate } = require( '@vue/compiler-sfc' );

function externalizeJsonPlugin() {
	return {
		name: 'external-json',
		// eslint-disable-next-line no-shadow
		setup( build ) {
			build.onResolve( { filter: /catsuggest-check\.json$/ }, ( args ) => ({ path: args.path, external: true }) );
		}
	};
}

function vueSfcPlugin() {
	return {
		name: 'vue-sfc',
		// eslint-disable-next-line no-shadow
		setup( build ) {
			build.onResolve( { filter: /\.vue$/ }, ( args ) => ({
					path: path.resolve( args.resolveDir, args.path ),
					namespace: 'vue-sfc'
				}) );

			build.onResolve( { filter: /\.js$/, namespace: 'vue-sfc' }, ( args ) => ({
					path: path.resolve( args.resolveDir, args.path ),
					namespace: 'file'
				}) );

			build.onLoad( { filter: /.*/, namespace: 'vue-sfc' }, ( args ) => {
				const source = fs.readFileSync( args.path, 'utf8' );
				const filename = path.basename( args.path );
				const { descriptor } = parse( source, { filename } );

				let scriptContent = '';
				if ( descriptor.script ) {
					scriptContent = descriptor.script.content;
				}

				let templateCode = '';
				if ( descriptor.template ) {
					const result = compileTemplate( {
						source: descriptor.template.content,
						filename: args.path,
						id: 'vue-sfc-' + filename,
						scoped: false,
						slotted: false
					} );
					templateCode = result.code;
				}

				templateCode = templateCode.replace(
					/import\s*\{([^}]*)\}\s*from\s*["']vue["']\s*/g,
					( _match, names ) => names.split( ',' ).map( ( part ) => {
							part = part.trim();
							const parts = part.split( /\s+as\s+/ );
							const orig = parts[ 0 ].trim();
							const alias = parts.length > 1 ? parts[ 1 ].trim() : parts[ 0 ].trim();
							return 'var ' + alias + ' = Vue.' + orig + ';\n';
						} ).join( '' )
				);

				templateCode = templateCode.replace( /export\s+function\s+render\s*/g, 'function render ' );

				const componentDef = scriptContent.replace(
					/export\s+default\s*/,
					'var __sfc_main = '
				).replace( /;?\s*$/, '' ) + ';';

				const componentName = '"' + filename.replace( /\.vue$/, '' ) + '"';

				const combined = [
					'module.exports = function( Vue, codex ) {',
					templateCode,
					componentDef,
					'__sfc_main.name = ' + componentName + ';',
					'__sfc_main.components = {',
					"  'cdx-button': codex.CdxButton,",
					"  'cdx-dialog': codex.CdxDialog,",
					"  'cdx-progress-bar': codex.CdxProgressBar,",
					"  'cdx-icon': codex.CdxIcon,",
					"  'cdx-checkbox': codex.CdxCheckbox,",
					"  'cdx-message': codex.CdxMessage,",
					"  'cdx-text-input': codex.CdxTextInput,",
					"  'cdx-toggle-switch': codex.CdxToggleSwitch,",
					"  'cdx-tabs': codex.CdxTabs,",
					"  'cdx-tab': codex.CdxTab,",
					"  'cdx-progress-indicator': codex.CdxProgressIndicator,",
					"  'cdx-accordion': codex.CdxAccordion",
					'};',
					'__sfc_main.render = render;',
					'return __sfc_main;',
					'};'
				].join( '\n' );

				return { contents: combined, loader: 'js', resolveDir: path.dirname( args.path ) };
			} );
		}
	};
}

async function build() {
	await esbuild.build( {
		entryPoints: [ 'src/index.js' ],
		bundle: true,
		format: 'cjs',
		platform: 'browser',
		target: 'es2017',
		outfile: 'dist/catsuggest.js',
		external: [ 'vue', '@wikimedia/codex', 'mediawiki.ForeignApi', 'mediawiki.util', 'mediawiki.storage', 'mediawiki.Title' ],
		plugins: [ externalizeJsonPlugin(), vueSfcPlugin() ],
		minify: true,
		banner: {
			js: `/*!
 * CatSuggest — Kateqoriya təklifçisi
 * Ətraflı: https://w.wiki/Qf9x
 * Mənbə kodu: https://gitlab.wikimedia.org/nmw03/catsuggest
 * 
 * Bu fayl birbaşa redaktə üçün nəzərdə tutulmayıb, dəyişikliklərinizi Gitlaba göndərin.
 */`
		}
	} );
	const size = ( fs.statSync( 'dist/catsuggest.js' ).size / 1024 ).toFixed( 1 );
	console.log( `Build complete: dist/catsuggest.js (${ size }KB)` );
}

build().catch( ( err ) => {
	console.error( 'Build failed:', err );
	// eslint-disable-next-line no-undef
	process.exit( 1 );
} );
