# CatSuggest — Kateqoriya təklifçisi

A gadget for azwiki that suggests categories to add to pages, based on interwiki sitelinks and Wikidata.

## Usage

See https://az.wikipedia.org/wiki/Vikipediya:Qadcetlər/Kateqoriya_təklifçisi

## Source

https://gitlab.com/nemoralis/catsuggest

## Contributing

* `npm install` to install dependencies
* `npm run lint` to run linting tests
* `npm run build` to build the compiled bundle to `dist/catsuggest.js`

While developing, you can load the compiled JavaScript served from your local machine.
To do this, add the following to your [common.js](https://az.wikipedia.org/wiki/Special:MyPage/common.js):

```js
mw.loader.load( 'http://localhost:5500/catsuggest.css', 'text/css' );
mw.loader.load( 'http://localhost:5500/dist/catsuggest.js' );
```

The CSS is in the project root, and the compiled JS is in `dist/`.

Then start the development server:

```sh
npm run serve
```

By default the server runs on port 5500. To use a different port:

```sh
node bin/server.js 5501
```

## Deployment

You must have `interface-admin` rights to deploy.
Visit https://az.wikipedia.org/wiki/Special:BotPasswords to obtain credentials,
then copy `credentials.json.dist` to `credentials.json` and fill in the details:

```json
{
   "username": "YourUsername@botsuffic",
   "password": "your-bot-password"
}
```

Make sure the dist files are up to date:

```sh
npm run build
```

To deploy, run:

```sh
npm run deploy "[edit summary]"
```

The edit summary is prefixed with the version and git SHA, e.g. `v1.0.0 at abcd1234: [edit summary]`.

If no edit summary is provided, the latest commit message is used.
