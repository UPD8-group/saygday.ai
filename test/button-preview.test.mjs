import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

test('appearance offers open colour choices and grouped icons; real chat stays in final approval', async () => {
  // Bundle the real React view with only the dashboard data source replaced.
  const require = createRequire(import.meta.url)
  const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('vite/package.json'))] }))
  const result = await build({
    stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {StaticRouter} from 'react-router-dom'; import ChatButton from './src/app/ChatButton.jsx'; export const render = (props = {}) => renderToStaticMarkup(React.createElement(StaticRouter, {location:'/app/setup/preview'}, React.createElement(ChatButton, props)));`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
    bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
    plugins: [{ name: 'dashboard-data', setup(build) {
      build.onResolve({ filter: /Dashboard\.jsx$/ }, () => ({ path: 'dashboard', namespace: 'test' }))
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const useDash = () => globalThis.__colourPreviewDash', loader: 'js' }))
    } }],
  })
  const module = { exports: {} }
  vm.runInThisContext('(function(require, module, exports) {' + result.outputFiles[0].text + '\n})', { filename: 'colour-preview.cjs' })(require, module, module.exports)
  const { render } = module.exports
  globalThis.location = { origin: 'https://saygday.ai' }
  globalThis.__colourPreviewDash = { business: { slug: 'test-cafe', name: 'Test Cafe', character: 'plus', greeting: 'Hello', buttonColour: '#ffcc00' }, faqs: [] }
  try {
    const appearance = render({ stage: 'appearance' })
    assert.doesNotMatch(appearance, /Preview: what customers see|preview__launcher|chat__foot|type="color"|Simple button colour|Or keep it simple/)
    assert.match(appearance, /Classic Chat &amp; Greetings/)
    assert.match(appearance, /Symbols &amp; Shapes/)
    assert.match(appearance, /Waving hand|Information|Lifebuoy/)
    assert.match(appearance, /aria-label="Colour choices"/)
    assert.match(appearance, /aria-label="Colour hue"/)
    assert.match(appearance, /value="#FFCC00"/)
    assert.equal((appearance.match(/background:#ffcc00;color:#000000/g) || []).length, 16, 'fifteen icon choices and the selected-button sample')
    const customerPreview = render({ stage: 'preview' })
    assert.match(customerPreview, /class="preview__launcher" style="background:#ffcc00;color:#000000"/)
    assert.match(customerPreview, /<footer class="chat__foot">Made in Australia by <a href="https:\/\/saygday.ai" target="_blank" rel="noopener">SayGday.ai<\/a><\/footer>/)
    globalThis.__colourPreviewDash.business.character = 'wally'
    const animal = render()
    assert.match(animal, /The Mob keeps its original artwork/)
    assert.doesNotMatch(animal, /class="preview__launcher"/)
    assert.match(animal, /src="\/characters\/wally.webp"/)
    const final = render({ stage: 'preview' })
    assert.match(final, /Your chosen icon:/)
    assert.match(final, /wally.webp/)
    assert.match(final, /Questions for Test Cafe/)
    assert.match(final, /Change appearance/)
    assert.match(final, /Edit answers/)
    assert.doesNotMatch(final, /radiogroup|type="color"|Save changes/, 'the final approval screen presents saved choices rather than another setup form')
    assert.match(final, /aria-expanded="true"/, 'the customer can try the real chat, not a screenshot')
  } finally { delete globalThis.location; delete globalThis.__colourPreviewDash }
})
