// The phone copy of every photo on the website. Each page opens on a photo
// (public/site/*.webp, 1400–2000 px wide, 30–240 KB), and a phone was
// downloading the whole thing to show a 390 px wide slice of it (the owner,
// 4 October 2026: "the images are loading way too slow… compress them all so
// they load faster on mobile"). This writes <name>-phone.webp beside each one,
// 1100 px wide at a lower quality, which is what a phone up to 600 px wide
// gets (src/site/site.css reads --photo-phone there). The originals are the
// source and are never rewritten, so running this again changes nothing.
//
//   node scripts/site-photos.mjs          writes every phone copy that is
//                                         missing or older than its original
//   node scripts/site-photos.mjs --force  rewrites them all
import { readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export const PHONE_WIDTH = 1100
export const PHONE_QUALITY = 60
export const PHONE_SUFFIX = '-phone'

const here = dirname(fileURLToPath(import.meta.url))
export const PHOTOS = resolve(here, '../public/site')

export const isPhoneCopy = file => file.endsWith(`${PHONE_SUFFIX}.webp`)
export const phoneCopyOf = file => file.replace(/\.webp$/, `${PHONE_SUFFIX}.webp`)

export async function phoneCopy(source) {
  return sharp(source).resize({ width: PHONE_WIDTH, withoutEnlargement: true }).webp({ quality: PHONE_QUALITY, effort: 6, smartSubsample: true }).toBuffer()
}

async function newerThan(file, than) {
  try { return (await stat(file)).mtimeMs >= (await stat(than)).mtimeMs } catch { return false }
}

export async function run({ force = false, log = console.log } = {}) {
  const files = (await readdir(PHOTOS)).filter(file => file.endsWith('.webp') && !isPhoneCopy(file)).sort()
  const written = []
  for (const file of files) {
    const source = resolve(PHOTOS, file)
    const target = resolve(PHOTOS, phoneCopyOf(file))
    if (!force && await newerThan(target, source)) continue
    const out = await phoneCopy(source)
    await writeFile(target, out)
    written.push(file)
    log(`${phoneCopyOf(file).padEnd(40)} ${String(Math.round((await stat(source)).size / 1024)).padStart(4)} KB → ${String(Math.round(out.length / 1024)).padStart(4)} KB`)
  }
  log(written.length ? `${written.length} phone ${written.length === 1 ? 'copy' : 'copies'} written to public/site` : 'every phone copy is up to date')
  return written
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run({ force: process.argv.includes('--force') })
}
