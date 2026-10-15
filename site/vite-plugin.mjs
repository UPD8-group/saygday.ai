// Builds the public website from site/: fills each page's shared parts in
// (site/chrome.mjs) and publishes each page at the top of the site.
// Also emits an isolated, read-only content preview using the same built
// styles/assets. Existing public routes and their checkout offers are unchanged.
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOT_FOUND, PAGES, composePage } from './chrome.mjs'
import { PREVIEW_SLUGS, applyApprovedCopy, makeReviewOnly, previewOutput, reviewScripts } from './content-preview.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ALL = [...PAGES, NOT_FOUND]
export const outputFor = page => (page.slug === '' ? 'index.html' : `${page.slug}.html`)
export const siteInputs = Object.fromEntries(ALL.map(page => [`site-${page.slug || 'home'}`, resolve(here, page.file)]))
const pageForFile = file => (dirname(resolve(file)) === here ? ALL.find(page => page.file === basename(file)) : undefined)

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
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const home = bundle['site/index.html']
        if (!home || home.type !== 'asset' || typeof home.source !== 'string') throw new Error('Content preview requires the built homepage')
        const scripts = reviewScripts(home.source)
        for (const [fileName, asset] of Object.entries(bundle)) {
          if (asset.type !== 'asset' || !fileName.startsWith('site/') || !fileName.endsWith('.html')) continue
          const page = ALL.find(item => `site/${item.file}` === fileName)
          if (!page) continue
          delete bundle[fileName]
          this.emitFile({ type: 'asset', fileName: outputFor(page), source: asset.source })
          if (PREVIEW_SLUGS.includes(page.slug)) {
            const copy = applyApprovedCopy(String(asset.source), page.slug)
            this.emitFile({ type: 'asset', fileName: previewOutput(page.slug), source: makeReviewOnly(copy, { slug: page.slug, scripts }) })
          }
        }
      },
    },
    configureServer(server) { server.middlewares.use(rewrite({ built: false })) },
    configurePreviewServer(server) { server.middlewares.use(rewrite({ built: true })) },
  }
}
