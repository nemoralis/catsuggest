const { ALLOWED_NAMESPACES, DEV_MODE, log } = require( './constants.js' );
const { createLocalApi, createWikidataApi } = require( './api.js' );

const enabledUsers = DEV_MODE ? [] : require( './catsuggest-check.json' ).enabledusers;

mw.loader
	.using( [
		'vue',
		'@wikimedia/codex',
		'mediawiki.ForeignApi',
		'mediawiki.util',
		'mediawiki.storage',
		'mediawiki.Title'
	] )
	.then( ( mwRequire ) => {
		const Vue = mwRequire( 'vue' );
		const codex = mwRequire( '@wikimedia/codex' );
		const { createMwApp } = Vue;

		if ( !ALLOWED_NAMESPACES.includes( mw.config.get( 'wgNamespaceNumber' ) ) ) {
			return;
		}
		if ( mw.config.get( 'wgAction' ) !== 'view' ) {
			return;
		}
		if ( mw.config.get( 'wgIsRedirect' ) === true ) {
			return;
		}

		const currentUser = mw.config.get( 'wgUserName' );
		if ( !currentUser ) {
			return;
		}

		const api = createLocalApi();
		const wikidataApi = createWikidataApi();

		const userGroups = mw.config.get( 'wgUserGroups' ) || [];
		const isAuthorized = DEV_MODE || userGroups.includes( 'sysop' ) ||
			userGroups.includes( 'interface-admin' ) ||
			( Array.isArray( enabledUsers ) && enabledUsers.includes( currentUser ) );

		log( 'User:', currentUser, '| Authorized:', isAuthorized, '| Groups:', userGroups );
		if ( DEV_MODE ) {
			mw.log.warn( '[CatSuggest] Dev mode active' );
		}
		const createAppComponent = require( './App.vue' );
		const App = createAppComponent( Vue, codex );

		const app = createMwApp( App, { isAuthorized, api, wikidataApi, devMode: DEV_MODE } );

		const container = document.createElement( 'div' );
		document.body.appendChild( container );
		app.mount( container );
	} );
