# Changelog

## [0.6.0](https://github.com/brightbar-dev/browser-api-client/compare/browser-api-client-v0.5.0...browser-api-client-v0.6.0) (2026-09-24)


### Features

* ask for a store review once, after real use, with a separate link for problems ([#31](https://github.com/brightbar-dev/browser-api-client/issues/31)) ([fe8d221](https://github.com/brightbar-dev/browser-api-client/commit/fe8d2218ad9789c93415c5e46e1b2afbe5d11aa2))

## [0.5.0](https://github.com/brightbar-dev/browser-api-client/compare/browser-api-client-v0.4.0...browser-api-client-v0.5.0) (2026-09-19)


### Features

* full-tab workspace that never loses work ([#16](https://github.com/brightbar-dev/browser-api-client/issues/16)) ([37bd9f3](https://github.com/brightbar-dev/browser-api-client/commit/37bd9f36baca9e3e66b0a31c8a3e3cbeeb1033f1))
* localizable UI — every app and settings string through _locales/en/messages.json ([#22](https://github.com/brightbar-dev/browser-api-client/issues/22)) ([0ea730c](https://github.com/brightbar-dev/browser-api-client/commit/0ea730c4ad31833c0fce324b56328e014fa3d2a8))
* make every advertised feature real — history, environments, collections, import, export ([#18](https://github.com/brightbar-dev/browser-api-client/issues/18)) ([ffaf601](https://github.com/brightbar-dev/browser-api-client/commit/ffaf60195c9f791f761ec92c7f342a7a69c48199))
* OAuth 2.0, tests and chaining without scripts, collection runner, GraphQL, live SSE ([#19](https://github.com/brightbar-dev/browser-api-client/issues/19)) ([ce929f3](https://github.com/brightbar-dev/browser-api-client/commit/ce929f34c29fb7b0c9636ccfcd5033f342371f4e))
* polish — named network errors, redirect chain and Set-Cookie, keyboard model, first run, contrast ([#20](https://github.com/brightbar-dev/browser-api-client/issues/20)) ([1c3a305](https://github.com/brightbar-dev/browser-api-client/commit/1c3a305fc2f0a4956d7d3b19413e32d0acda4309))


### Bug Fixes

* hold back the identity and webRequest permissions from 0.5.0 ([#28](https://github.com/brightbar-dev/browser-api-client/issues/28)) ([b266f4d](https://github.com/brightbar-dev/browser-api-client/commit/b266f4d401e3e0e3b7aecdcf2981ee82abef8ab0))

## [0.4.0](https://github.com/brightbar-dev/browser-api-client/compare/browser-api-client-v0.3.2...browser-api-client-v0.4.0) (2026-09-15)


### Features

* make every feature free — remove ExtensionPay and all Pro gating ([#14](https://github.com/brightbar-dev/browser-api-client/issues/14)) ([4a624ce](https://github.com/brightbar-dev/browser-api-client/commit/4a624cebc6b4d44d7f046691039507faff42140b))

## [0.3.2](https://github.com/brightbar-dev/browser-api-client/compare/browser-api-client-v0.3.1...browser-api-client-v0.3.2) (2026-09-15)


### Bug Fixes

* drop the retired Tailwind CSS Lookup from the cross-promotion links ([#12](https://github.com/brightbar-dev/browser-api-client/issues/12)) ([b0e30ef](https://github.com/brightbar-dev/browser-api-client/commit/b0e30ef5411c6d622b93919b3cad693699db5fec))

## [0.3.1](https://github.com/brightbar-dev/browser-api-client/compare/browser-api-client-v0.3.0...browser-api-client-v0.3.1) (2026-09-15)


### Bug Fixes

* .claude-repo-policy.json to the schema the hook actually reads ([22ddab6](https://github.com/brightbar-dev/browser-api-client/commit/22ddab6b6564db0cb0ccc77dbf30f16766b976c1))
* restore GitHub Packages auth for @brightbar-dev/wxt-extpay ([260984e](https://github.com/brightbar-dev/browser-api-client/commit/260984e8766cf9b14dcf6960012f5d0468be425a))

## [0.3.0](https://github.com/brightbar-dev/browser-api-client/compare/browser-api-client-v0.2.0...browser-api-client-v0.3.0) (2026-04-24)


### Features

* add 20-locale i18n for CWS listing optimization ([da1544e](https://github.com/brightbar-dev/browser-api-client/commit/da1544ebf7dea240dd64c516b53f77fc90b8c630))
* add collections and Postman import/export ([e7300c1](https://github.com/brightbar-dev/browser-api-client/commit/e7300c1086448d0b892017e0003c6d4308a8809b))
* add cross-promotion links to popup ([3d143b4](https://github.com/brightbar-dev/browser-api-client/commit/3d143b4aeb3b9eb8effc160d6effb787e0c8b623))
* add CWS store screenshots and promo tile ([168ce15](https://github.com/brightbar-dev/browser-api-client/commit/168ce153e4b4a31c5a1c434483340c0242cd7b78))
* add large and marquee promo tiles, update small tile with new icon ([01536fe](https://github.com/brightbar-dev/browser-api-client/commit/01536fec164c8ae04aaf2689a9bbfbf901d20d70))
* add store/cws.json for CWS submission metadata ([548cf8b](https://github.com/brightbar-dev/browser-api-client/commit/548cf8bb66e1b4248f9c706d892adcdbf05912d9))
* enforce pro tier limits for history, environments, and collections ([3644243](https://github.com/brightbar-dev/browser-api-client/commit/3644243ec74429dfb4fc445644eb5f2b4a55867c))
* integrate ExtensionPay for Pro licensing ([a18fe5e](https://github.com/brightbar-dev/browser-api-client/commit/a18fe5eaf1dee8477bd6ef7a584e44e0c54f74c9))
* redesign icon — lightning bolt for fast API requests ([e65f629](https://github.com/brightbar-dev/browser-api-client/commit/e65f62972ceb4a1698a4942b37608af6ef358228))


### Bug Fixes

* ExtPay crash kills background, popup/options init() unhandled rejection ([045c3b2](https://github.com/brightbar-dev/browser-api-client/commit/045c3b279b2283081e84b7f86423ba7326b6a8f0))
* remove GitHub Packages auth — wxt-extpay moving to public npm ([4e606ca](https://github.com/brightbar-dev/browser-api-client/commit/4e606ca877acce6809ac680ca7c70f1ae216d8c1))
* remove unused activeTab permission ([d7a3519](https://github.com/brightbar-dev/browser-api-client/commit/d7a351947e3d9f2ca221e3abc09feaa3d9e9bb71))
* update pricing to $50/yr (round numbers, no .99 patterns) ([c88ec6c](https://github.com/brightbar-dev/browser-api-client/commit/c88ec6cb285c0a0ba92a2783cf357eb638646f72))

## [0.2.0](https://github.com/brightbar-dev/browser-api-client/compare/browser-api-client-v0.1.0...browser-api-client-v0.2.0) (2026-03-06)


### Features

* initial Browser API Client extension scaffold ([8a83cf5](https://github.com/brightbar-dev/browser-api-client/commit/8a83cf5b6f13bf809809fce7de1b7a30fe09807e))


### Bug Fixes

* prevent pre-1.0 feat from jumping to 1.0.0 ([#3](https://github.com/brightbar-dev/browser-api-client/issues/3)) ([312747c](https://github.com/brightbar-dev/browser-api-client/commit/312747cca2179b9f26c2138273c2d21e76473cb9))
* use config file for release-please, add bump-minor-pre-major ([#6](https://github.com/brightbar-dev/browser-api-client/issues/6)) ([dd5b277](https://github.com/brightbar-dev/browser-api-client/commit/dd5b2774f65a577582a90d32983cc0cbc42f80c3))
