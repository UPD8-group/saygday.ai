// Refresh before each new answer. Only the business identifier is fetched;
// the visitor's question stays in this browser. Concurrent reads share one
// request, but a failed read never falls back to old approved answers.
export function createWidgetReader(load) {
  let pending = null
  return function currentWidget() {
    if (!pending) {
      pending = Promise.resolve().then(load).then(widget => {
        if (!widget || !Array.isArray(widget.faqs)) throw new Error('The current answers aren’t available. Please try again.')
        return widget
      }).finally(() => { pending = null })
    }
    return pending
  }
}

export function currentFaq(widget, id) {
  return widget?.faqs?.find(faq => faq.id === id) || null
}

export function handoffConfirmation(result, address, words) {
  if (result?.notification === 'sent') return address ? words.sent(address) : words.passed
  if (!address) return 'Your question is saved in the team’s SayGday inbox.'
  const saved = `Your question and reply address (${address}) are saved in the team’s SayGday inbox.`
  return result?.notification === 'pending'
    ? `${saved} Their email notification is waiting to send.`
    : `${saved} We couldn’t email the team, so they’ll need to check their inbox here.`
}
