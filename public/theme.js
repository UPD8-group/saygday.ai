// Day or night, remembered (owner, 4 October 2026). Every page loads this
// before its stylesheet so a reader who chose night never sees a flash of
// day. Day is the default; only the button in the bar (src/site/site.js)
// changes the choice, and it lives in this browser alone.
(function () {
  try {
    if (localStorage.getItem('saygday-theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
  } catch (error) {}
})()
