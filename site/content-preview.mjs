// Owner-approved direction: the current UX, with new copy and $59/$99 offers.
// This builds a separate, non-transactional review journey. Production routes,
// styles, assets, account billing, live chat answers and legal terms are untouched.
// Exact replacements fail the build when their source changes, rather than
// silently publishing an incomplete rewrite. No browser-side text swapping.
export const PREVIEW_ROOT = '/content-preview/'
export const PREVIEW_SLUGS = Object.freeze(['', 'is-this-ai', 'whats-different', 'when-it-matters', 'how-it-works', 'getting-started', 'meet-the-mob', 'pricing', 'contact', 'login'])
export const previewPath = slug => `${PREVIEW_ROOT}${slug ? `${slug}/` : ''}`
export const previewOutput = slug => `${previewPath(slug).slice(1)}index.html`

const COPY = {
  '': [
    ['SayGday sits in the corner of your website like any chat. Every answer your customers read was written or signed off by the people who run the place. Made in Canberra for Aussie small businesses.', 'Help customers find the answers you’ve approved, in your own words. Made in Canberra for Aussie small businesses.'],
    ['Every answer signed off by a real person', 'Your answers. Your final say.'],
    ['SayGday sits in the corner of your website like any chat. The difference is who’s behind it. Every answer your customers read was written or signed off by the people who run the place, word for word. If there’s no answer yet, it never guesses. It passes the question to you.', 'Help customers find answers while you get on with your business. SayGday uses answers you’ve checked and approved, in your own words. When it can’t find a suitable answer, customers can send you an enquiry instead.'],
    ['<strong>7 days free. Card required to activate.</strong><br>Then $30/month automatically unless you cancel.<br>About $1 a day. Spare change, on purpose.<br>Made in Canberra for Aussie small businesses.', '<strong>Have a week on us.</strong><br>Build and preview free. Verify your website and add a card for 7 free days.<br>Then $59/month automatically unless you cancel. Checkout shows your first billing date.<br>Made in Canberra for Aussie small businesses.'],
    ['That’s one for Sam. Leave your email and he’ll get back to you himself.', 'That’s one for Sam. Send your question and email so he can reply.'],
    ['Goes straight to Sam’s inbox', 'Send an enquiry to Sam’s inbox'],
  ],
  'is-this-ai': [
    ['Sort of, but not the way you think. AI only works behind the scenes, drafting answers from your website. Your customers only ever read the answers you sign off.', 'AI helps prepare the first draft. You check and approve the business answers before customers read them.'],
    ['Is this AI?<br><em>Sort of. But not the way you think.</em>', 'AI helps draft.<br><em>You have the final say.</em>'],
    ['Good customer service needs a real person. So AI only ever works behind the scenes, saving the business time. It never talks to your customers, and the final say is always yours.', 'AI helps prepare suggested questions and answers from your website. You check the details and approve the wording. SayGday then matches customer questions to those answers, rather than generating a new reply each time.'],
    ['AI does the legwork.<br>You have the final say.', 'A helpful first draft.<br>Not the final word.'],
    ['When you sign up, it searches your website and pulls out the questions your customers ask most, with the answers your own pages give. It saves you hours of typing.', 'Start with your website. SayGday drafts likely customer questions and suggested answers from its pages, so you’re not starting with a blank screen.'],
    ['Pick the questions you want, put any answer into your own words, and add your own. Nothing goes live until you sign it off.', 'Check every detail. Change the wording, add what’s missing and approve the answers you want to publish. The final say stays with your business.'],
    ['Customers get you', 'Customers get your wording'],
    ['Your customers never chat with AI. They get the answers you signed off, word for word, and anything new comes straight to you to answer yourself.', 'When a suitable answer is found, customers read your approved wording. Otherwise, they can send an enquiry for your team to answer.'],
    ['Matched, never made up.', 'Different wording. Your approved answer.'],
    ['However they phrase it, typos and all.', 'It can recognise wording variations and common typos.'],
    ['One of the questions you’ve written and signed off. If nothing matches well enough, it doesn’t guess. It offers to pass the question to you.', 'A question your business has already answered. When the match isn’t strong enough, SayGday can suggest related questions or offer an enquiry instead.'],
    ['A direct line to you when there isn’t an answer yet', 'An enquiry option when a customer needs your team'],
    ['A call centre, or a third party in another country', 'A staffed live-chat or emergency response service'],
    ['Will it ever make something up?', 'Does it generate new answers for visitors?'],
    ['No. It can only show answers your business has signed off. If there isn’t one, it says so and offers to pass the question on.', 'No. It matches questions to your approved answers rather than writing new business replies. Matching can still be imperfect, so test the questions customers are likely to ask and keep your answers current.'],
    ['It never pretends to be one. It shows your team’s answers, and anything new goes to a real person: you.', 'SayGday presents your team’s approved answers, not a person typing live. Customers can submit an enquiry when they need a response from your team.'],
    ['Because writing 25 questions and answers from scratch takes hours. AI does the first draft from your own website in minutes, and you do the part that matters: deciding exactly what your customers read.', 'It gives you a starting point instead of a blank page. You still check the facts, choose the wording and decide exactly what your business publishes.'],
  ],
  'whats-different': [
    ['Yes, it’s a chatbot. Just not like the others. SayGday only ever says what you’ve already said, so your customers get the answer you’d give them across the counter.', 'Customer answers you control. Choose the wording, approve it and make it easier for visitors to find.'],
    ['Yes, it’s a chatbot.<br><em>Just not like the others.</em>', 'Your words.<br><em>Not a new reply each time.</em>'],
    ['Most chatbots come up with their own answers on the spot. SayGday only ever says what you’ve already said, so your customers get the same answer you’d give them across the counter.', 'You don’t just choose the information behind an answer. You choose the answer itself. SayGday makes your approved wording easier to find, while keeping the questions that need a person with your team.'],
    ['Think of it as an interactive FAQ.', 'The same questions. One less thing to juggle.'],
    ['It works like the questions and answers on your website, except customers don’t have to go looking. They ask in their own words and get your answer straight back. Anything new comes to you, so the real conversations are still between you and your customer.', 'Opening hours. Delivery. Parking. How to book. The questions matter, but answering them can interrupt your day. Give those answers a place on your website, with an enquiry option for anything that needs your attention.'],
    ['Fewer of the same questions by phone, email and message.', 'A place for routine questions, without being there for every one.'],
    ['Never miss a question: anything new lands in your inbox, with the customer’s email.', 'Submitted enquiries in your dashboard, with email notification when customers leave an email address.'],
    ['They ask in their own words, typos and all. No digging through pages.', 'A place to ask in their own words, instead of searching every page.'],
    ['A real person when they need one: anything new goes straight to you.', 'An option to send your team a question that needs a personal reply.'],
    ['The same answer, every time', 'Approved wording stays put'],
    ['Monday morning or midnight on Sunday, everyone who asks reads the same words. Nothing drifts, and nothing gets reworded.', 'When an answer is matched, customers read the wording you approved. SayGday does not rewrite it for each visitor.'],
    ['Nothing you didn’t say', 'You approve the details'],
    ['It only shows answers you’ve signed off, so it can’t promise a discount, a booking or a refund you never offered.', 'Check the details that matter to your business: prices, policies, service inclusions and how to book. Publish the wording you’re comfortable standing behind.'],
    ['Prices go up and hours change. Edit an answer in your dashboard, and that’s what customers read from then on.', 'Opening hours and offers change. Update and approve your answers in the dashboard so the information stays useful.'],
  ],
  'when-it-matters': [
    ['Some customers come to you anxious. With SayGday, every answer they read was written by someone who knows the job, and they can see who signed it off.', 'Help customers prepare for a visit with practical answers checked by your team, in your own words.'],
    ['Nervous customers<br><em>get a person’s answer.</em>', 'A little reassurance.<br><em>In your own words.</em>'],
    ['Some people come to you anxious. They want to know someone who knows the job is looking after them. With SayGday, every answer they read was written by that someone, and they can see who signed it off.', 'Sometimes the question is about more than opening hours. What should I bring? Is there step-free access? Can someone come with me? Your team can prepare thoughtful, practical answers before a customer visits.'],
    ['Dr Mel’s answer. Not a guess.', 'The clinic’s approach, in its own words.'],
    ['Riverbend Vet wrote this answer once and signed it off. Every worried owner who asks gets these exact words, whether it’s 9am or midnight.', 'In this fictional example, the clinic has approved how it explains a routine visit. SayGday can present those words without generating a different explanation for each visitor.'],
    ['It never guesses', 'There’s an enquiry option'],
    ['If there’s no answer yet, it says so and offers to pass the question on, so they hear from you, not from a guess.', 'When it can’t find a suitable answer, a customer can send a question for your team to follow up. Replies aren’t monitored around the clock.'],
    ['There at 2am', 'Helpful outside opening hours'],
    ['Worries don’t keep business hours. Your answer is there whenever they ask, in your words.', 'Customers can look up approved information after you’ve closed. Urgent questions still need the appropriate phone or emergency service.'],
    ['Examples · made-up businesses', 'Examples · made-up businesses. Routine service information only—not medical advice, diagnosis or emergency support.'],
  ],
  'how-it-works': [
    ['We sit in between, never in place of you. SayGday knows only what you’ve told it, and hands everything else to you.', 'Customers ask. SayGday looks for an approved answer. Questions that need your team can become enquiries.'],
    ['We sit in between.<br><em>Never in place of you.</em>', 'Help with the everyday.<br><em>You handle the personal.</em>'],
    ['Think of SayGday as the friendly front counter on your website. It knows only what you’ve told it, and it hands everything else to you.', 'Customers ask in their own words. SayGday looks for an answer your business has approved. When it can’t find a suitable one, they can send an enquiry instead.'],
    ['Day or night, on your website. “What time do you shut?” and “Are you open late?” find the same answer.', 'Visitors can ask about your business without finding the right page first. SayGday looks for a suitable match among your approved questions and answers.'],
    ['Never writes an answer of its own', 'Doesn’t generate a new business reply'],
    ['New questions arrive in your email with the customer’s address. Reply in your own words, and add the answer so it’s ready next time.', 'Submitted questions appear in your dashboard. When the customer leaves an email address, you can receive an email notification and reply personally. Add a useful answer for future visitors.'],
    ['Here’s how to get started.', 'Start with the questions you answer most.'],
  ],
  'getting-started': [
    ['Set up your assistant in an afternoon, in three easy steps. We do the heavy lifting; you check the answers and add one line to your website.', 'Start with your website, approve your answers, then install and activate SayGday. Prefer help? Ask about Managed.'],
    ['Set up your assistant in an afternoon.<br><em>Three easy steps.</em>', 'Start with your website.<br><em>Make the answers yours.</em>'],
    ['You don’t need to be good with computers. We do the heavy lifting. You check the answers and add one line to your website.', 'Build and preview before you commit. Prepare the answers yourself, or choose Managed for a hand with setup and keeping them useful.'],
    ['A few minutes', 'At your own pace'],
    ['An hour or so, with a cuppa', 'Your final say'],
    ['Sign up with your email and put in your business’s web address. We go through your pages and write down the questions your customers ask most: opening hours, prices, parking, bookings.', 'Sign in with your email and enter your business’s web address. SayGday prepares suggested questions and answers from the pages it can read.'],
    ['Read through the answers we’ve drafted for your business. Change any wording, add your own, and sign off the ones you’re happy with. Nothing goes live until you say so.', 'Check the facts, change the wording and add anything missing. Approve the answers you want customers to read, then try a few questions in the preview.'],
    ['Copy one line into your website, or email it to whoever looks after it for you. Verify your website and confirm your card through Stripe to activate your chat. Your 7 free days start with your confirmed subscription; checkout shows the first billing date.', 'Add the supplied code to a supported website, or send it to your website person. Verify the website and add a card through Stripe to activate 7 free days. Checkout shows your first billing date.'],
    ['An hour or so to check your answers', 'Time to check your answers, and access to add the website code'],
    ['<strong>Need a hand?</strong> James does the first setups himself. He can go through it with you, start to finish.', '<strong>Prefer a hand?</strong> SayGday Managed is $99/month, with setup help and a defined monthly content allowance. <a href="/pricing">See what’s included</a>.'],
    ['Examples from a café’s website. You sign off the ones you’re happy with, and change the rest.', 'Illustrative café answers—not a real customer. Check the details for your own business before approving.'],
  ],
  'meet-the-mob': [
    ['Pick a local for the corner of your website: one of eight Aussie characters, or a plain button.', 'Choose an Aussie character or a simple chat button, then make SayGday feel at home on your website.'],
    ['Your chat button lives in the corner of your website, in front of your customers. So you choose what it looks like: one of the mob, or something plain.', 'A friendly Aussie character or a simple chat button. Choose what suits your business, then make the greeting, colours and answers your own.'],
    ['Nearly every website has the same grey bubble or little robot in the corner, and people have learnt what those mean. Yours is a person behind the counter, so it should look like one of yours.', 'Your website already has its own personality. SayGday should feel at home there, whether you prefer a cheerful local character or something more understated.'],
    ['It says g’day, not “beep”', 'Make the welcome yours'],
    ['A friendly local face says “ask us anything”, not “you’re talking to a robot”. Customers who are wary of chatbots feel the difference.', 'Choose a greeting that sounds like your business. The character is a welcome, not a claim that a person is typing live.'],
    ['A face in the corner is easier to spot than one more grey bubble, so customers know where to ask.', 'Give visitors a clear place to ask. Choose a button that suits your website and check how it looks on a phone.'],
    ['Whoever you pick, the words are still yours, exactly as you signed them off. Change the button any time and nothing else changes.', 'The character doesn’t write the answers. Your approved wording stays the same when you change the button.'],
  ],
  'pricing': [
    ['7 days free. Card required to activate. Then $30/month automatically unless you cancel.', 'SayGday is $59/month. Managed is $99/month with setup and defined content support. Have a week on us with self-managed SayGday.'],
    ['Spare change.<br><em>On purpose.</em>', 'Your answers.<br><em>Your choice of support.</em>'],
    ['$30 a month. About $1 a day. Try SayGday free for 7 days with a card to activate, then billed monthly unless you cancel. Cancel before your first charge to pay nothing.', 'SayGday is $59/month when you manage the answers yourself. Managed is $99/month for a hand with setup and keeping them useful. Both put your business in control of the wording.'],
    ['Why about $1 a day', 'Choose the support you need'],
    ['It shouldn’t cost an arm and a leg.', 'The same software. A different level of help.'],
    ['The cost of living keeps going up, and small businesses feel it first. Rent, power, wages and stock all cost more than they did last year.', 'SayGday gives you the tools to prepare, approve and manage your business’s answers. Product support is included; you look after the content and installation.'],
    ['We didn’t want to be one more big bill on the pile. SayGday is our way of giving something back: a tool that helps you look after your customers, for $30 a month—about $1 a day. Spare change, on purpose.', 'Managed adds hands-on help with the initial setup and a defined monthly content allowance. We agree what’s involved before you pay. Your business still approves every answer.'],
    ['One simple price.', 'SayGday. Look after it yourself.'],
    ['No card needed to build and preview your assistant. Verify your website, then add your card through Stripe to activate your chat. Your 7 free days start when your subscription is confirmed, followed by $30/month automatically unless you cancel.', 'Build and preview without a card. Check your answers, choose your appearance and install the code on one supported website. Activate when you’re ready.'],
    ['A chat button in the corner of your website, with your answers in it', 'Your approved answers, available through your website’s chat'],
    ['Your common questions drafted from your own website, for you to check', 'Suggested questions and answers drafted from your website'],
    ['Questions you haven’t answered yet, sent to your email', 'Submitted enquiries in your dashboard, with email notification when a visitor leaves an email address'],
    ['Any of the mob for your corner, or a plain button', 'Your greeting, colours and choice of character or simple button'],
    ['Help from a real person when you need it', 'Product support while you manage your content and installation'],
    ['Your first 7 days are free. Card required to activate. Then $30/month automatically unless you cancel.', 'Have a week on us. Verify your website and add a card to activate 7 free days. Then $59/month automatically unless you cancel. Checkout shows your first billing date.'],
  ],
  'contact': [
    ['Get in touch with SayGday: ask to join as a business, or send us any question. Made in Canberra.', 'Ask Jay about SayGday, Managed setup or whether your website is a good fit. Made in Canberra by oo.studio.'],
    ['Want SayGday for your business, or got a question? Send us a message.', 'Have a question, need help choosing, or prefer someone to handle the setup? Tell me a little about your business and what you need.'],
    ['I’d like SayGday<small>For my business</small>', 'Managed setup<small>I’d like a hand</small>'],
    ['A question, an idea, anything', 'Product questions or support'],
    ['We use your details only to reply to you. See our <a href="/privacy">privacy page</a>. We reply within one business day, usually sooner.', 'We use your details to respond to your enquiry. See our <a href="/privacy">privacy page</a>. This form is not monitored for urgent requests.'],
    ['We’ll reply to the email address you gave us, within one business day, usually sooner.', 'We’ll reply to the email address you provided.'],
    ['<p class="eyebrow">The business behind SayGday</p>', '<p class="eyebrow">The person behind SayGday</p><p>I’m Jay, the person behind oo.studio in Canberra. I made SayGday for business owners who want to help their customers without handing over control of what their business says.</p>'],
  ],
  'login': [
    ['Sign in to SayGday, or start 7 days free. Card required to activate, then $30/month unless you cancel.', 'Build and preview SayGday without a card. Sign in with an email code, then activate when you’re ready.'],
    ['Pop in your email and we’ll send you a code. New here? We’ll set up your account as we go. No password needed.', 'Enter your email and we’ll send you a sign-in code. New here? Build and preview your SayGday before activating it. No password to remember.'],
    ['Questions it can’t answer come straight to you', 'Customers can submit an enquiry when they need your team'],
  ],
}

function replaceChecked(html, from, to, slug) {
  if (!html.includes(from)) throw new Error(`Content preview ${slug || 'home'}: source copy changed: ${from.slice(0, 90)}`)
  return html.replaceAll(from, to)
}

const TICK = '<svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ticks = items => items.map(item => `<li>${TICK}<span>${item}</span></li>`).join('\n')
const MANAGED = `
    <div class="page__part panel panel--cream" id="managed">
      <p class="eyebrow">A hand with the content</p>
      <h2 class="title gs-title">SayGday Managed. We help look after it.</h2>
      <p class="intro">The same SayGday software, plus help with setup and keeping your answers useful. You keep the final say on everything your business publishes.</p>
      <div class="price-card">
        <div class="price-card__main">
          <div class="price__amount">$99<small>a month</small></div>
          <p>For one business and one supported website. We confirm the setup scope and start date before you pay.</p>
          <a class="btn btn--light" href="/contact" style="justify-self: start">Ask about Managed</a>
        </div>
        <ul class="price-card__list">${ticks([
          'Everything in self-managed SayGday',
          'Initial preparation of up to 20 short questions and answers, for your approval',
          'Standard installation on one supported website and initial checks',
          'Up to 20 minutes of content work each month, shared between reviewing unanswered questions and making small answer updates',
          'Product support, with additional content or technical work quoted separately',
        ])}</ul>
      </div>
      <p class="trial-note">Monthly content time does not roll over. Custom website development, complex integrations and larger content jobs are outside this allowance. The self-managed free week does not include Managed setup work.</p>
    </div>
    <div class="page__part panel">
      <p class="eyebrow">Before you choose</p>
      <h2 class="title gs-title">A few straight answers.</h2>
      <dl class="qa">
        <div><dt>When does my free week start?</dt><dd>Build and preview without a card. Verify your website, then add a card through Stripe to activate 7 free days. $59/month starts automatically afterwards unless you cancel. Checkout shows your first billing date.</dd></div>
        <div><dt>Is the free week included with Managed?</dt><dd>The free week is for self-managed software. Managed includes hands-on work, so we agree its scope, start date and any introductory arrangement before you pay.</dd></div>
        <div><dt>What about existing customers?</dt><dd>These are the proposed offers for new customers. Existing agreed prices, subscriptions and saved trial dates are not changed by this proposal.</dd></div>
        <div><dt>Will it work on my website?</dt><dd>Your website needs to allow the supplied chat code. Some platforms or plans restrict custom code. Ask us to check compatibility before choosing Managed.</dd></div>
        <div><dt>Does this include a website or online shop?</dt><dd>No. These plans are for SayGday on your existing website. Website builds, online shops and payment-system setup are separate oo.studio services.</dd></div>
        <div><dt>What happens when I need more help?</dt><dd>Managed includes the setup and monthly allowance described above. We agree a separate quote before doing work outside that scope.</dd></div>
        <div><dt>What happens when I cancel?</dt><dd>Cancel through Settings → Billing → Manage billing before your first charge to pay nothing for self-managed software. Cancelling during a paid period stops renewal. Removing the chat code alone does not cancel a subscription.</dd></div>
      </dl>
    </div>
`

export function applyApprovedCopy(html, slug) {
  if (typeof html !== 'string' || !PREVIEW_SLUGS.includes(slug)) throw new TypeError('A supported public page and HTML string are required')
  let out = html
  for (const [from, to] of COPY[slug] || []) out = replaceChecked(out, from, to, slug)
  // Shared navigation/trial text is emitted by chrome.mjs, not the page source.
  for (const [from, to] of [
    ['7 days free. Card required. Then $30/month.', '$59 self-managed. $99 with hands-on support.'],
    ['7 days free. Card required to activate. Then $30/month automatically unless you cancel.', 'Have a week on us. Card required to activate 7 free days. Then $59/month automatically unless you cancel.'],
    ['Try 7 days free', 'Build my SayGday'],
    ['Start your free 7 days', 'Build my SayGday'],
    ['Set up your business in an afternoon.', 'Start with your website. Approve your answers.'],
    ['It looks like a chatbot. Here’s how it isn’t one.', 'Customer answers you control.'],
    ['Nervous customers get a person’s answer.', 'Practical reassurance in your team’s words.'],
    ['Sort of. But not the way you think.', 'AI helps draft. You have the final say.'],
    ['$30', '$59'],
  ]) out = out.replaceAll(from, to)
  if (slug === 'pricing') {
    const end = /\n  <\/div>\n<\/main>/
    if (!end.test(out)) throw new Error('Pricing preview: expected existing content wrapper')
    out = out.replace(end, `${MANAGED}\n  </div>\n</main>`)
  }
  return out
}

// Reuse the homepage's built scripts so the exact menu, theme and mobile
// Learn more behaviour stays. Never load the login entry or production widget.
export function reviewScripts(homeHtml) {
  if (typeof homeHtml !== 'string') throw new TypeError('Built homepage HTML is required')
  return (homeHtml.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [])
    .filter(tag => !/widget\.js|data-business|application\/ld\+json/i.test(tag)).join('\n')
}

export function makeReviewOnly(html, { slug, scripts = '' } = {}) {
  if (!PREVIEW_SLUGS.includes(slug)) throw new TypeError('Unsupported preview page')
  let out = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*rel=["'](?:canonical|modulepreload)["'][^>]*>/gi, '')
    .replace(/<meta\b[^>]*name=["']robots["'][^>]*>/gi, '')
    .replace('</head>', `<meta name="robots" content="noindex, nofollow, noarchive">\n${scripts}\n</head>`)
  // A disabled, static form retains the existing classes and field layout.
  // It cannot post even with JavaScript disabled and Netlify will not register it.
  out = out.replace(/<form\b([^>]*)>/gi, (_tag, attrs) => {
    const classes = attrs.match(/\bclass=("[^"]*"|'[^']*')/i)?.[1] || '""'
    return `<div class=${classes} role="group" aria-label="Read-only content preview">`
  }).replace(/<\/form>/gi, '</div>')
    .replace(/<(input|textarea|select)\b([^>]*)>/gi, (_tag, name, attrs) => `<${name}${attrs.replace(/\sdisabled(?:=["'][^"']*["'])?/gi, '')} disabled>`)
    .replace(/<button\b([^>]*\btype=["']submit["'][^>]*)>/gi, (_tag, attrs) => `<button${attrs} disabled>`)
    .replace('We’ll email you a code. That’s it.', 'Preview only. Account creation and sign-in are disabled here.')
    .replace('This form is not monitored for urgent requests.', 'Preview only: this form does not send messages.')
  out = out.replace(/href=("|')([^"']+)\1/g, (attribute, quote, href) => {
    if (!href.startsWith('/') || href.startsWith('//')) return attribute
    const match = href.match(/^([^?#]*)(.*)$/)
    const clean = match[1].replace(/\/+$/, '')
    const target = PREVIEW_SLUGS.find(item => (item ? `/${item}` : '') === clean)
    // Legal links remain the current legal pages, not rewritten agreements.
    return target === undefined ? attribute : `href=${quote}${previewPath(target)}${match[2]}${quote}`
  })
  const oldCta = `<a class="bar__cta" href="${previewPath('login')}">7 days free</a>`
  out = out.replace(oldCta, `<a class="bar__cta" href="${previewPath('pricing')}">Copy preview</a>`)
  out = out.replace('<div class="foot__top">', '<p class="trial-note">Content preview only. Proposed new-customer pricing; existing agreements are unchanged. Sign-in, payment, enquiries and the production chat are not active in this preview.</p>\n    <div class="foot__top">')
  return out
}
