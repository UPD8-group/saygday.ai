// SayGday's own chat, on saygday.ai (owner, 3 October 2026: "we now need to
// put a say g'day icon for us in the bottom right-hand corner… put all the
// questions, more than 20, we'll really pack this thing out… use the G'day
// icon… put a pulse around it so somebody knows that it's there").
//
// SayGday is set up as a business like any other, owned by the owner's own
// account, so its answers live in his dashboard and he can change them there
// like any business would. This file is where they started:
// scripts/own-chat-sql.mjs turns it into the SQL that loaded them, and never
// overwrites an answer that is already there.
//
// Every fact here is one the public website already states (the price, the 14
// free days, the three setup steps, the privacy page's suppliers), so the
// chat and the pages never disagree. test/own-chat.test.mjs holds the two to
// each other, and asks the chat about a hundred questions the way visitors
// type them.
export const OWN_CHAT = Object.freeze({
  slug: 'saygday',
  name: 'SayGday',
  website: 'https://saygday.ai',
  // The G'day plain button, the one on the Meet the mob page.
  character: 'gday',
  // Every answer is signed off by James, in handwriting, like the front page's example.
  signedBy: 'James',
  greeting: 'G’day! This is SayGday’s own chat, and it works just like yours would: every answer here is ours, word for word. Tap a question or type your own.',
})

// In the order the dashboard lists them. `featured` ones show as buttons when
// the chat opens (at most six).
export const OWN_ANSWERS = Object.freeze([
  {
    featured: true,
    question: 'What is SayGday?',
    answer: 'SayGday is a chat button for your business’s website. Your customers ask a question in their own words, and it shows them the answer you’ve written or signed off, word for word. If there isn’t an answer yet, it never guesses: it offers to send the question to you. It’s made in Canberra for Aussie small businesses.',
    variants: ['What does SayGday do?', 'Tell me about SayGday', 'What is SayGday all about?', 'What do you do?', 'What do you guys do?', 'What is this?'],
  },
  {
    featured: true,
    question: 'Is this AI?',
    answer: 'Sort of, but not the way you think. AI only works behind the scenes: when you sign up, it reads your website and drafts questions and answers for you to check. It never talks to your customers. They only ever see the answers you’ve signed off, word for word. This chat works the same way: every answer here was written by us.',
    variants: ['Are you AI?', 'Does it use AI?', 'Is it artificial intelligence?', 'Are you a bot?', 'Are you a robot?', 'Is this a chatbot?', 'Does it use ChatGPT?', 'Am I talking to a real person?', 'Is this a real person?', 'Is this automated?'],
  },
  {
    featured: true,
    question: 'How much does it cost?',
    answer: 'SayGday is A$30 a month. That’s about a dollar a day, and we priced it that way on purpose. Your first 14 days are free, there’s no lock-in contract, and you don’t need a card to start.',
    variants: ['Price', 'Pricing', 'How much is it?', 'What does it cost?', 'What’s the monthly fee?', 'What do you charge?', 'How much per month?', 'How much is SayGday a month?', 'Is it expensive?', 'How do I pay?', 'Cost'],
  },
  {
    featured: true,
    question: 'How do I get started?',
    answer: 'Press Try it free and sign up with your email. Then it’s three easy steps: put in your business’s web address and we draft the questions your customers ask most; check the answers and sign off the ones you’re happy with; then add one line to your website. Your chat button appears in the corner, ready for your customers.',
    variants: ['How do I sign up?', 'How do I join?', 'How do I start?', 'Can I sign up?', 'Create an account', 'Register', 'I want to sign up', 'Get started', 'I want SayGday for my business'],
  },
  {
    featured: true,
    question: 'What happens if the chat can’t answer a question?',
    answer: 'It says so, and offers to send the question to you. Your customer can leave their email, and the question arrives in your inbox with their address, so you just reply in your own words. If they’d rather not leave an email, it still shows in your dashboard under Customers asked. Then add an answer, and it’s ready for the next person who asks.',
    variants: ['What if it doesn’t know the answer?', 'What if there’s no answer?', 'Where do unanswered questions go?', 'What happens to questions it can’t answer?', 'How do customers’ questions reach me?', 'Do I get an email when a customer asks something?', 'Can I reply to my customers?', 'Will I be notified of new questions?'],
  },
  {
    featured: true,
    question: 'Can James set it up for me?',
    answer: 'Yes. James does the first setups himself. He can go through it with you, start to finish. Send us a message from our contact page, or type your question here and leave your email.',
    variants: ['Can you set it up for me?', 'How do I set it up?', 'Can someone help me set it up?', 'Will you do it for me?', 'Can James help me?', 'I need help setting up', 'Do you offer setup help?', 'Can you do the setup?'],
  },
  {
    question: 'How does SayGday work?',
    answer: 'Your customer asks a question in their own words, any time of day. SayGday finds the answer you’ve signed off and shows it exactly as you wrote it. If there’s no answer yet, it offers to pass the question to you, and it arrives in your email with the customer’s address so you can reply yourself.',
    variants: ['How does the chat work?', 'Explain how it works', 'What happens when a customer asks a question?', 'How does it find the answer?'],
  },
  {
    question: 'How is SayGday different from other chatbots?',
    answer: 'Most chatbots come up with their own answers on the spot, and can be wrong while sounding sure. SayGday only ever says what you’ve already said, so your customers get the same answer you’d give them across the counter. When it doesn’t know, it says so and passes the question to you.',
    variants: ['What’s different about SayGday?', 'Why not just use ChatGPT?', 'How is this different from a normal chatbot?', 'How is it different from ChatGPT?', 'Why is SayGday better?', 'What makes you different?', 'Why choose SayGday?'],
  },
  {
    question: 'Will it ever make something up?',
    answer: 'No. It can only show answers your business has signed off. If there isn’t one, it says so and offers to pass the question on. It never writes an answer of its own.',
    variants: ['Does it make up answers?', 'Can it give wrong answers?', 'What if it gets it wrong?', 'Can it hallucinate?', 'Will it invent answers?', 'Can it say something I didn’t approve?'],
  },
  {
    question: 'Does it learn from my customers’ chats?',
    answer: 'No. It only changes when you change it. Add, edit or remove answers any time from your dashboard.',
    variants: ['Does it learn?', 'Does it train on my customers?', 'Does it get smarter over time?', 'Does it learn from conversations?'],
  },
  {
    question: 'Will customers think they’re talking to a person?',
    answer: 'It never pretends to be one. It shows your team’s answers, and anything new goes to a real person: you.',
    variants: ['Does it pretend to be human?', 'Will my customers know it’s a chat?', 'Does it pretend to be me?'],
  },
  {
    question: 'Why use AI at all?',
    answer: 'Because writing 25 questions and answers from scratch takes hours. AI does the first draft from your own website in minutes, and you do the part that matters: deciding exactly what your customers read.',
    variants: ['What is the AI used for?', 'Why do you use AI?', 'Where does the AI come in?', 'What does the AI actually do?'],
  },
  {
    question: 'Is there a free trial?',
    answer: 'Yes. Your first 14 days are free, and you don’t need a card to start. Your free period starts when we first verify that you own your website. After that, choose whether to subscribe for A$30 a month.',
    variants: ['Can I try it for free?', 'Is SayGday free?', 'Free trial', 'How long is the free trial?', 'Can I try before I buy?', 'What happens after the free days?', 'Do I need a credit card to start?', 'Do I need a card to sign up?'],
  },
  {
    question: 'Is there a lock-in contract?',
    answer: 'No. There’s no lock-in contract. Cancel your subscription through Settings → Billing → Manage billing in your dashboard. Your chat stays available until the end of the current paid period. Removing the chat code alone does not cancel payments. We’ll give you at least 30 days’ notice by email before any price change.',
    variants: ['Can I cancel any time?', 'How do I cancel?', 'Is there a minimum term?', 'Do I have to sign a contract?', 'Am I locked in?', 'Can I stop any time?'],
  },
  {
    question: 'What’s included in the price?',
    answer: 'Everything, for one simple price of A$30 a month: a chat button in the corner of your website with your answers in it, your common questions drafted from your own website for you to check, questions you haven’t answered yet sent to your email, any of the mob or a plain button, and help from a real person when you need it.',
    variants: ['What do I get?', 'Are there hidden fees?', 'Are there any extra costs?', 'What does the price include?'],
  },
  {
    question: 'Why is it so cheap?',
    answer: 'Because the cost of living keeps going up, and small businesses feel it first. We didn’t want to be one more big bill on the pile, so SayGday is about a dollar a day: our way of giving something back.',
    variants: ['Why only $30?', 'Why a dollar a day?', 'How is it so affordable?', 'Why is it cheap?'],
  },
  {
    question: 'How long does it take to set up?',
    answer: 'About an afternoon. A few minutes to tell us your website, an hour or so (with a cuppa) to check your answers, and a few minutes to add it to your website.',
    variants: ['How long does setup take?', 'How quick is it to set up?', 'How much time does it take?', 'How fast can I be up and running?'],
  },
  {
    question: 'Do I need to be good with computers?',
    answer: 'Not at all. We do the heavy lifting. You check the answers and add one line to your website, or email that line to whoever looks after your website for you. And James does the first setups himself, so he can go through it with you.',
    variants: ['I’m not technical', 'Is it hard to set up?', 'Is it easy to use?', 'I’m not good with computers', 'Do I need technical skills?', 'Do I need a web developer?'],
  },
  {
    question: 'What do I need to get started?',
    answer: 'Just three things: your business’s web address, an email address to sign in with (and for your customers’ questions to come to), and an hour or so to check your answers.',
    variants: ['What do I need?', 'What do I need to sign up?', 'What are the requirements?'],
  },
  {
    question: 'Do I need a website to use SayGday?',
    answer: 'Yes. SayGday is a chat button for your website, so you’ll need one where you can add a line of code. We also read your website to draft your first questions and answers.',
    variants: ['Do I need a website?', 'I don’t have a website', 'Can I use it without a website?', 'Does it work on Facebook?', 'Can I use it on Facebook?', 'Can I use it on Instagram?'],
  },
  {
    question: 'How do I sign in?',
    answer: 'With your email address. Put it in on the Log in page and we email you a sign-in code. Type the code in and you’re in. There’s no password to remember.',
    variants: ['How do I log in?', 'Login', 'Where do I sign in?', 'Where do I log in?', 'Do I need a password?', 'Sign in'],
  },
  {
    question: 'I didn’t get my sign-in code',
    answer: 'It can take a minute to arrive. Check your junk or spam folder, and make sure your email address is spelt right. Still nothing? Send us a message from our contact page and we’ll sort it out.',
    variants: ['My code didn’t arrive', 'Where’s my code?', 'Where is my sign-in code?', 'The sign-in code isn’t working', 'I can’t log in', 'I didn’t get the email', 'The code didn’t come through', 'Code not arriving'],
  },
  {
    question: 'How do you write my questions and answers?',
    answer: 'When you sign up, we read the public pages of your website, the same words any visitor can see. AI drafts 20 to 25 of the questions your customers ask most, with the answers your own pages give. Then you check every one. Nothing goes live until you sign it off.',
    variants: ['Where do the answers come from?', 'Who writes the answers?', 'How do you come up with my questions?', 'Do you scan my website?', 'Do you scan my site?', 'How does the website scan work?', 'Do I have to write all the answers myself?'],
  },
  {
    question: 'How many questions and answers can I have?',
    answer: 'We draft 20 to 25 from your website to start. You can add your own any time, up to 200, and choose up to six to show as buttons when the chat opens.',
    variants: ['How many questions do I get?', 'Is there a limit on questions?', 'How many answers can I add?', 'Is there a maximum?'],
  },
  {
    question: 'Can I change my answers?',
    answer: 'Yes, any time. Edit the wording, add your own questions, or remove any you don’t want, all from your dashboard. Your chat only ever shows the answers you’ve approved.',
    variants: ['Can I edit the answers?', 'How do I update an answer?', 'Can I add my own questions?', 'Can I delete a question?', 'Can I write my own answers?', 'How do I add a new question?'],
  },
  {
    question: 'What if I change my website?',
    answer: 'Scan it again from Settings in your dashboard. We read it again and add new questions for you to check. Your approved answers and the ones you’ve written stay exactly as they are.',
    variants: ['Can I scan my website again?', 'I updated my website', 'Rescan my website', 'My website has changed'],
  },
  {
    question: 'What do you read on my website?',
    answer: 'Only the public pages, the same words any visitor can see, and only when you ask us to. We don’t need your website’s password or anything private.',
    variants: ['Do you read private pages?', 'Which pages do you scan?', 'Do you need access to my website?', 'Do you need my website password?', 'Do I need to give you my website login?'],
  },
  {
    question: 'Can I choose which questions show first?',
    answer: 'Yes. Tap Show first on up to six of your answers in your dashboard, and they appear as buttons when the chat opens, so customers can tap instead of typing.',
    variants: ['How do I feature a question?', 'Can I pick the starter questions?', 'Which questions show when the chat opens?', 'Can I pin a question?'],
  },
  {
    question: 'Can I try my chat before it goes live?',
    answer: 'Yes. Your dashboard has a preview of your chat button, and a Try a question box: type a question the way a customer might and see exactly what your chat would do.',
    variants: ['Can I test it?', 'Is there a preview?', 'Can I see what customers will see?', 'How do I test my answers?'],
  },
  {
    question: 'Can I see a demo?',
    answer: 'You’re using one! This chat is SayGday on our own website, with our own answers, working exactly the way yours would. To see yours, press Try it free: your first 14 days are free.',
    variants: ['Is there a demo?', 'Show me an example', 'Can I see it in action?', 'Can I see an example?'],
  },
  {
    question: 'Do customers have to type the question exactly?',
    answer: 'No. They ask in their own words, typos and all. “What time do u shut on sat?” finds the answer to “What are your opening hours?”. If nothing matches well enough, it doesn’t guess. It shows the closest questions, or offers to pass the question to you.',
    variants: ['What if they spell it wrong?', 'What if customers spell it wrong?', 'Does it understand typos?', 'What if customers ask differently?', 'How does it match questions?', 'Does it understand different wording?'],
  },
  {
    question: 'How do I add it to my website?',
    answer: 'Copy the one line of code from the Chat button page in your dashboard and paste it into your website, just before </body> or wherever your site lets you add custom code to every page. Publish, and the button appears in the bottom-right corner. Not your thing? Email the line to whoever looks after your website.',
    variants: ['How do I install it?', 'Where do I paste the code?', 'Where do I put the code?', 'How do I put it on my website?', 'Embed code', 'How do I add the chat button?', 'Installation'],
  },
  {
    question: 'Does it work with Wix, WordPress, Squarespace or Shopify?',
    answer: 'Yes. It works on any website that lets you add a line of code. Your dashboard has step-by-step instructions for Wix, Squarespace, WordPress and Shopify, and for any other website. Squarespace only allows added code on its Business plan or higher.',
    variants: ['Does it work on Wix?', 'Does it work with WordPress?', 'Does it work with Squarespace?', 'Does it work with Shopify?', 'Squarespace', 'Shopify', 'Will it work on my website?', 'Which website builders does it work with?'],
  },
  {
    question: 'Why do I have to prove I own my website?',
    answer: 'So nobody can put your business’s chat on a website that isn’t yours. Before your chat goes live, we check the website is yours: we look for your chat button on its home page, or for a record you add to your domain’s settings. Until then, your chat stays hidden.',
    variants: ['Website verification', 'How do I verify my website?', 'Why do I need to verify my website?', 'Why do you check my website?', 'DNS record', 'TXT record', 'Do I need to verify my domain?'],
  },
  {
    question: 'My chat button isn’t showing. What do I do?',
    answer: 'First, check the line of code is on your website and that you’ve published the change. Then open the Chat button page in your dashboard and press Check my website: your chat switches on once we find your button on your home page. If your website turns us away, add the record shown there to your domain’s settings instead. Still stuck? Send us a message from our contact page.',
    variants: ['The button isn’t showing', 'My chat isn’t working', 'I can’t see the chat button', 'Why isn’t my chat live yet?', 'The chat button doesn’t appear', 'It’s not working'],
  },
  {
    question: 'Will it slow down my website?',
    answer: 'No. It’s one small script that loads after your page does, and the chat window only loads when someone taps the button. It runs in its own window, so nothing on your page can change it, and it can’t touch your page.',
    variants: ['Does it slow my site down?', 'Will it affect my website speed?', 'Will it break my website?', 'Is it safe to add to my website?'],
  },
  {
    question: 'Does it work on phones?',
    answer: 'Yes. The button sits in the bottom-right corner on phones, tablets and computers. On a phone, the chat opens full screen so it’s easy to read and type.',
    variants: ['Does it work on mobile?', 'Is it mobile friendly?', 'Does it work on mobile phones?', 'Does it work on iPhone?', 'Does it work on tablets?'],
  },
  {
    question: 'Can I choose what the button looks like?',
    answer: 'Yes. Pick one of the mob, eight Aussie locals, or one of twelve plain buttons for something quieter. You can change it any time from the Chat button page, and nothing else changes.',
    variants: ['Can I change the button?', 'What does the button look like?', 'Can I customise the chat button?', 'Button design', 'Can I change the icon?', 'Plain buttons'],
  },
  {
    question: 'Who are the mob?',
    answer: 'Eight Aussie locals for the corner of your website: Skippy the kangaroo, Quigley the quokka, Eddie the echidna, Kiki the kookaburra, Kip the koala, Penny the platypus, Sully the sugar glider and Wally the wombat. Each one gives your corner a friendly face.',
    variants: ['Meet the mob', 'What characters are there?', 'Which animals can I choose?', 'Tell me about the characters', 'Skippy the kangaroo', 'Wally the wombat'],
  },
  {
    question: 'Can I change the greeting?',
    answer: 'Yes. On the Chat button page in your dashboard, type the greeting you’d like. It’s the first thing customers read when they open the chat.',
    variants: ['Can I change the welcome message?', 'Can I edit the first message?', 'Custom greeting'],
  },
  {
    question: 'What do you do with my information?',
    answer: 'Only what we need to run your chat button. We never sell your information, or your customers’. What a customer types into the chat stays on their own device, unless they choose to send their question to you. Our privacy page has all the details.',
    variants: ['Do you sell my data?', 'Privacy', 'Is my data safe?', 'What about my customers’ privacy?', 'Do you keep what customers type?', 'Is it private?', 'Privacy policy'],
  },
  {
    question: 'Where is my data stored?',
    answer: 'Our database is with Supabase, in Sydney. Netlify runs our website and servers, Resend sends our emails, and Anthropic drafts answers from your public website text: those three are in the United States. Each of them handles information only to provide their service to us.',
    variants: ['Is my data stored in Australia?', 'Is my data kept in Australia?', 'Where are your servers?', 'Who do you share my data with?', 'Which companies do you use?'],
  },
  {
    question: 'Is my information used to train AI?',
    answer: 'No. To draft your answers, we send the public text of your website to Anthropic, and under Anthropic’s commercial terms it isn’t used to train their models. Your customers’ chats never go to AI at all.',
    variants: ['Do you train AI on my data?', 'Does Anthropic use my data?', 'Is my data used for AI training?'],
  },
  {
    question: 'Does the chat use cookies?',
    answer: 'No. The chat button on your website doesn’t use cookies, and we don’t use advertising or tracking tools.',
    variants: ['Cookies', 'Do you track my customers?', 'Do you use tracking?'],
  },
  {
    question: 'Can I see which answers customers read?',
    answer: 'Yes. Your dashboard counts how many times each answer is opened, so you can see what customers want to know most. It counts opens, never who opened them.',
    variants: ['Do you have statistics?', 'Can I see stats?', 'Can I see analytics?', 'How many people used my chat?', 'Reports', 'Which questions are most popular?'],
  },
  {
    question: 'Is someone watching the chat around the clock?',
    answer: 'No. The chat shows your answers any time of day, but it isn’t watched by a person around the clock. New questions arrive in your email for you to answer when you can. If your business handles emergencies, put your emergency phone number in your answers.',
    variants: ['Is it monitored 24/7?', 'Do I have to watch the chat?', 'What about emergencies?', 'Do I need to reply straight away?', 'Is it live chat?'],
  },
  {
    question: 'Can customers book or pay through the chat?',
    answer: 'Not by itself. SayGday shows your answers and passes on new questions. If customers book or pay on your website or by phone, put that in your answer so they know exactly where to go.',
    variants: ['Can it take bookings?', 'Can customers make a booking?', 'Can customers pay through the chat?', 'Can it take orders?', 'Can it take reservations?'],
  },
  {
    question: 'Can I turn the chat off?',
    answer: 'Yes. Take the line of code off your website and the button disappears. Removing the code does not cancel payments: manage or cancel your subscription in Settings → Billing. To close your account altogether, send us a message from our contact page: we delete your business, your answers and your customers’ questions within 30 days.',
    variants: ['How do I remove the chat?', 'Can I pause it?', 'How do I turn it off?', 'Can I hide the button?', 'How do I close my account?', 'Delete my account'],
  },
  {
    question: 'Can I use it on more than one website?',
    answer: 'Each SayGday account looks after one business and its website. If you run more than one, send us a message from our contact page and we’ll help you set them up.',
    variants: ['Multiple websites', 'I have two websites', 'I have two businesses', 'More than one business', 'Can I add another website?', 'Multiple locations'],
  },
  {
    question: 'What kinds of businesses is it for?',
    answer: 'Any small business that gets asked the same questions again and again: cafés, vets, accountants, dentists, law firms and more. If your customers have questions before they visit, book or buy, SayGday answers them in your words.',
    variants: ['Is it right for my business?', 'Is it good for my business?', 'Will it work for my business?', 'What businesses use SayGday?', 'Is it good for cafes?', 'Is it good for a café?', 'Does it suit cafes?', 'Is it good for tradies?'],
  },
  {
    question: 'Is SayGday only for Australian businesses?',
    answer: 'We made it for Aussie small businesses, and the price is in Australian dollars. If you’re somewhere else and keen to try it, send us a message from our contact page.',
    variants: ['Does it work outside Australia?', 'Does it work in New Zealand?', 'Can I use it in New Zealand?', 'Is it available overseas?', 'International businesses'],
  },
  {
    question: 'Who’s behind SayGday?',
    answer: 'G’day, I’m James. I’ve spent the last 30 years working in customer service, across education, airlines, hospitality, media and transport. I make SayGday here in Canberra: I build it and do the first setups myself. Luna and Stormi handle quality control and welcomes.',
    variants: ['Who are you?', 'Who made SayGday?', 'Who is James?', 'Who owns SayGday?', 'Who runs SayGday?', 'Who built this?', 'Tell me about yourselves'],
  },
  {
    question: 'Who are Luna and Stormi?',
    answer: 'James’s two dogs. They handle quality control and welcomes, and you’ll find them grinning on our story page.',
    variants: ['Who is Luna?', 'Who is Stormi?', 'Are Luna and Stormi dogs?'],
  },
  {
    question: 'Where are you based?',
    answer: 'Canberra. SayGday is made here for Aussie small businesses. You’ll find us at Civic Quarter 1, 68 Northbourne Ave, Canberra ACT 2600. Our ABN is 37 702 004 608.',
    variants: ['Where are you?', 'Where are you located?', 'What’s your address?', 'Are you Australian?', 'Are you an Australian company?', 'Are you a real company?', 'What is your ABN?', 'Are you in Canberra?'],
  },
  {
    question: 'Why is it called SayGday?',
    answer: 'Because it should feel like a friendly local saying g’day, not a robot saying beep. Every answer comes from a real person at the business, the way it would across the counter.',
    variants: ['What does SayGday mean?', 'Where does the name come from?', 'Why the name?'],
  },
  {
    question: 'How do I contact you?',
    answer: 'Send us a message from our contact page and we’ll reply within one business day, usually sooner. Or type your question here and leave your email, and it comes straight to us.',
    variants: ['Contact', 'Can I talk to someone?', 'Can I speak to someone?', 'Talk to a person', 'Can I speak to a real person?', 'What’s your email address?', 'What’s your phone number?', 'How do I get in touch?', 'How quickly do you reply?', 'I need help', 'Support', 'Customer service'],
  },
  {
    question: 'When are you open?',
    answer: 'Good one to test us with! SayGday lives online, so this chat never shuts. If you send us a message, we reply within one business day, usually sooner.',
    variants: ['Opening hours', 'What are your opening hours?', 'What time do you shut on Sat?', 'What time do you close?', 'Are you open on weekends?', 'Business hours'],
  },
].map(Object.freeze))

