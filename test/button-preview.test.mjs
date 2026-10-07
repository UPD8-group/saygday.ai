import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

test('dashboard renders the saved colour in its picker, all simple swatches and preview; animals stay fixed', async () => {
  // Bundle the real React view with only the dashboard data source replaced.
  const require = createRequire(import.meta.url)
  const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('vite/package.json'))] }))
  const result = await build({
    stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import ChatButton from './src/app/ChatButton.jsx'; export const render = () => renderToStaticMarkup(React.createElement(ChatButton));`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
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
    const simple = render()
    assert.match(simple, /<footer class="chat__foot">Made in Australia by <a href="https:\/\/saygday.ai" target="_blank" rel="noopener">SayGday.ai<\/a><\/footer>/)
    assert.match(simple, /type="color"[^>]*value="#ffcc00"/)
    assert.match(simple, /class="preview__launcher" style="background:#ffcc00;color:#000000"/)
    assert.equal((simple.match(/background:#ffcc00;color:#000000/g) || []).length, 14, 'twelve swatches, chat avatar and launcher')
    globalThis.__colourPreviewDash.business.character = 'wally'
    const animal = render()
    assert.doesNotMatch(animal, /type="color"/)
    assert.match(animal, /Animal character colours are fixed/)
    assert.match(animal, /class="preview__launcher"(?! style=)/)
    assert.match(animal, /src="\/characters\/wally.webp"/)
  } finally { delete globalThis.location; delete globalThis.__colourPreviewDash }
})
