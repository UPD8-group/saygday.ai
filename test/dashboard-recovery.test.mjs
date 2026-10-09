import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

test('dashboard offers recovery when answers fail after a business has loaded', async () => {
  const require = createRequire(import.meta.url)
  const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('vite/package.json'))] }))
  const result = await build({
    stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {createMemoryRouter, RouterProvider} from 'react-router-dom'; import {Layout} from './src/app/Dashboard.jsx'; export function render() { const router = createMemoryRouter([{path:'*',element:React.createElement(Layout)}],{initialEntries:['/app/setup/answers']}); try { return renderToStaticMarkup(React.createElement(RouterProvider,{router})); } finally { router.dispose(); } }`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
    bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'dashboard-fixture-data', setup(build) {
      build.onResolve({filter:/auth\.jsx$/}, () => ({path:'auth',namespace:'audit'}))
      build.onLoad({filter:/.*/,namespace:'audit'}, () => ({contents:'export const useAuth = () => ({ signOut: async () => {} })',loader:'js'}))
      build.onLoad({filter:/Dashboard\.jsx$/}, async ({path}) => ({
        contents: (await readFile(path,'utf8')).replace('export const useDash = () => useContext(Dash)', 'export const useDash = () => globalThis.__auditDash'),
        loader:'jsx',resolveDir:dirname(path),
      }))
    }}],
  })
  const module = {exports:{}}
  vm.runInThisContext('(function(require,module,exports){'+result.outputFiles[0].text+'\n})',{filename:'dashboard-recovery.cjs'})(require,module,module.exports)
  globalThis.__auditDash = {
    loading:false,error:'Your answers could not be loaded. Try again.',email:'owner@example.test',
    business:{id:'audit',slug:'audit',name:'Audit Café',website:'https://example.test',character:'bubble'},
    businesses:[],scan:{status:'done'},faqs:null,billing:{state:'card_required'},
    appearanceSave:{current:null},reload:async()=>{},choose:async()=>{},
  }
  try {
    const html=module.exports.render()
    assert.match(html,/role="alert"/)
    assert.match(html,/Your answers could not be loaded\. Try again\./)
    assert.match(html,/<span>Try again<\/span><\/button>/)
    assert.doesNotMatch(html,/Loading your answers/)
  } finally {delete globalThis.__auditDash}
})
