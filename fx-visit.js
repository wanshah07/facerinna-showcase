/* One page view, sent once per page load to the FACERINNA visitor collector
   (worker/ in this repo). No cookie, nothing stored in the browser, nothing
   identifying in the body: the path and the page that linked here. The
   collector reads the country, state and city from the connection and keeps
   no IP address. An empty COLLECTOR turns the whole thing off, and a bot or a
   headless browser is dropped on the collector side. Runs after everything
   else and fails silently, so an offline booth never notices it. */
(function () {
  var COLLECTOR = 'https://facerinna-visitors.purple-frog-7517.workers.dev';
  if (!COLLECTOR || /REPLACE_WITH/.test(COLLECTOR)) return;
  if (!/^https:\/\/my\.facerinna\.com$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(location.origin)) return;
  if (navigator.webdriver) return;
  var body = JSON.stringify({ p: location.pathname, r: document.referrer || '' });
  try {
    fetch(COLLECTOR + '/hit', { method: 'POST', body: body, headers: { 'Content-Type': 'application/json' }, keepalive: true, mode: 'cors', credentials: 'omit' })
      .catch(function () {});
  } catch (e) {}
})();
