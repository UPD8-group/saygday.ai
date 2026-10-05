// Builds the public website from site/: fills each page's shared parts in
// (site/chrome.mjs) and publishes each page at the top of the site
// (site/pricing.html as /pricing.html), which Netlify serves at /pricing with
// no redirect. The dashboard is app.html, served
// at /app; the admin page is admin.html, at /admin; the chat window is chat.html.
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOT_FOUND, PAGES, composePage } from './chrome.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ALL = [...PAGES, NOT_FOUND]

// Where each page is published. A folder per page (pricing/index.html) would
// make Netlify answer /pricing with a redirect to /pricing/ first.
export const outputFor = page => (page.slug === '' ? 'index.html' : `${page.slug}.html`)

export const siteInputs = Object.fromEntries(ALL.map(page => [`site-${page.slug || 'home'}`, resolve(here, page.file)]))

const pageForFile = file => (dirname(resolve(file)) === here ? ALL.find(page => page.file === basename(file)) : undefined)

// The same addresses Netlify serves, for `vite` and `vite preview`.
function rewrite({ built }) {
  return (req, _res, next) => {
    const [path, query = ''] = req.url.split('?')
    const tail = query ? `?${query}` : ''
    const clean = path.replace(/\/+$/, '') || '/'
    if (clean === '/app' || clean.startsWith('/app/')) req.url = `/app.html${tail}`
    else if (clean === '/admin' || clean.startsWith('/admin/')) req.url = `/admin.html${tail}`
    else {
      const page = PAGES.find(item => `/${item.slug}` === clean || (item.slug === '' && clean === '/'))
      if (page) req.url = `/${built ? outputFor(page) : `site/${page.file}`}${tail}`
    }
    next()
  }
}

export function sitePages() {
  return {
    name: 'saygday-site-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const page = pageForFile(context.filename)
        return page ? composePage(html, page.slug) : html
      },
    },
    // Vite writes the pages out in its own last step, so this runs after it.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const [fileName, asset] of Object.entries(bundle)) {
          if (asset.type !== 'asset' || !fileName.startsWith('site/') || !fileName.endsWith('.html')) continue
          const page = ALL.find(item => `site/${item.file}` === fileName)
          if (!page) continue
          delete bundle[fileName]
          this.emitFile({ type: 'asset', fileName: outputFor(page), source: asset.source })
        }
      },
    },
    configureServer(server) { server.middlewares.use(rewrite({ built: false })) },
    configurePreviewServer(server) { server.middlewares.use(rewrite({ built: true })) },
  }
}
