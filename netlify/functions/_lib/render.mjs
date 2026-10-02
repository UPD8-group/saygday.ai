// Reading a website the way a visitor's browser shows it. Most small business
// websites send their words in the page itself and never come here. A website
// built in JavaScript sends a nearly empty page and fills it in the browser,
// so the scan opens a page that reads thin in a real (headless) Chromium and
// reads it once its scripts have run (scan.mjs decides when).
//
// The browser is held to the same rules as safe-fetch.mjs: it may only fetch
// public HTTPS addresses on the standard port (every host's DNS answer
// checked, private and special-use addresses refused), the page itself must
// stay on the business's own website, and it never loads images, video,
// audio or fonts. Chromium's own protections stay on: the serverless build's
// flags that switch off web security are removed.
//
// Chromium comes from @sparticuz/chromium-min: the browser itself is too big
// for a Netlify function to carry, so it is downloaded once per warm function
// from the package's release (SAYGDAY_CHROMIUM_PACK overrides the address).
// SAYGDAY_CHROMIUM_PATH points at a local Chromium instead, for development.
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { HttpError, env } from './runtime.mjs'
import { isPublicAddress } from './safe-fetch.mjs'

export const CHROMIUM_PACK = 'https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar'
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 SayGdayWebsiteScan/2.0 (+https://saygday.ai)'
const SKIPPED_TYPES = new Set(['image', 'media', 'font', 'texttrack', 'eventsource', 'websocket', 'manifest', 'ping', 'cspviolationreport', 'prefetch'])
const UNSAFE_FLAGS = new Set(['--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials'])
const MAX_HTML = 600000

const fail = (message, code) => new HttpError(400, message, code)
// The serverless build's flags, less the ones that switch off web security.
export const safeFlags = flags => flags.filter(flag => !UNSAFE_FLAGS.has(flag))

// One request's verdict: only public HTTPS on port 443, never media, and the
// page itself only on the business's own website. Hosts are looked up once.
export function requestPolicy({ origin, lookup = dnsLookup }) {
  const hosts = new Map()
  const publicHost = hostname => {
    if (!hosts.has(hostname)) {
      const bare = hostname.replace(/^\[|\]$/g, '')
      hosts.set(hostname, isIP(bare)
        ? Promise.resolve(isPublicAddress(bare))
        : lookup(hostname, { all: true, verbatim: true }).then(records => records.length > 0 && records.every(record => isPublicAddress(record.address)), () => false))
    }
    return hosts.get(hostname)
  }
  return async ({ url, resourceType, navigation, mainFrame }) => {
    let target
    try { target = new URL(url) } catch { return false }
    if (target.protocol === 'data:' || target.protocol === 'blob:') return !navigation
    if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) return false
    if (SKIPPED_TYPES.has(resourceType)) return false
    if (navigation && (!mainFrame || target.origin !== origin)) return false
    return publicHost(target.hostname)
  }
}

// A browser for one scan: opened on the first page that needs it, closed when
// the scan has read the website.
export function createRenderer({ read = env, lookup = dnsLookup, launch } = {}) {
  let browser = null
  const open = () => (browser ||= (launch || launchChromium)(read))
  return {
    async render(url, { origin, deadline }) {
      const timeout = Math.max(1000, deadline - Date.now())
      const instance = await open()
      const context = await instance.createBrowserContext()
      try {
        const page = await context.newPage()
        page.setDefaultTimeout(timeout)
        await page.setUserAgent(USER_AGENT)
        await page.setRequestInterception(true)
        const allowed = requestPolicy({ origin, lookup })
        page.on('request', request => {
          if (request.isInterceptResolutionHandled()) return
          const navigation = request.isNavigationRequest()
          allowed({ url: request.url(), resourceType: request.resourceType(), navigation, mainFrame: navigation && request.frame() === page.mainFrame() })
            .then(ok => (ok ? request.continue() : request.abort('blockedbyclient')), () => request.abort('blockedbyclient'))
            .catch(() => {})
        })
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
        if (!response) throw fail('We couldn’t read that website. Please try again.', 'WEBSITE_UNAVAILABLE')
        // Scripts fill the page in: wait for the network to settle, but never
        // past this page's share of the time.
        await page.waitForNetworkIdle({ idleTime: 600, timeout: Math.max(500, deadline - Date.now()) }).catch(() => {})
        const finalUrl = page.url()
        if (new URL(finalUrl).origin !== origin) throw fail(`This website redirects to ${new URL(finalUrl).origin}. Save that address and try again.`, 'REDIRECT_ORIGIN_CHANGED')
        const html = await page.content()
        return { html: html.slice(0, MAX_HTML), url: finalUrl }
      } finally {
        await context.close().catch(() => {})
      }
    },
    async close() {
      if (!browser) return
      const opened = browser
      browser = null
      await opened.then(instance => instance.close(), () => {}).catch(() => {})
    },
  }
}

async function launchChromium(read) {
  // The package unpacks the Amazon Linux 2023 libraries Chromium needs when it
  // recognises a Lambda runtime; a Netlify function is one.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.AWS_EXECUTION_ENV) process.env.AWS_LAMBDA_JS_RUNTIME ??= `nodejs${process.versions.node.split('.')[0]}.x`
  const [{ default: puppeteer }, { default: chromium }] = await Promise.all([import('puppeteer-core'), import('@sparticuz/chromium-min')])
  const local = read('SAYGDAY_CHROMIUM_PATH')
  chromium.setGraphicsMode = false
  return puppeteer.launch({
    executablePath: local || await chromium.executablePath(read('SAYGDAY_CHROMIUM_PACK') || CHROMIUM_PACK),
    args: local ? ['--no-sandbox', '--disable-gpu', '--no-first-run'] : safeFlags(chromium.args),
    headless: 'shell',
    defaultViewport: { width: 1280, height: 900 },
  })
}
