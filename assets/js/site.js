/* Site-wide behaviour: theme toggle, scroll reveal, visibility helper, sentence fallback, publications filter. No dependencies. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    /[?&]motion=reduce/.test(window.location.search);

  /* ---- Theme toggle: auto -> explicit light/dark, persisted ---- */
  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function currentIsDark() {
    var t = root.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return systemDark();
  }
  var toggles = document.querySelectorAll('[data-theme-toggle]');
  function announce() {
    var dark = currentIsDark();
    toggles.forEach(function (btn) { btn.setAttribute('aria-checked', dark ? 'true' : 'false'); });
    document.dispatchEvent(new CustomEvent('themechange', { detail: { dark: dark } }));
  }
  function setTheme(next) {
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { }
    announce();
  }
  toggles.forEach(function (btn) {
    btn.addEventListener('click', function () { setTheme(currentIsDark() ? 'light' : 'dark'); });
  });
  if (window.matchMedia) {
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { if (root.getAttribute('data-theme') === 'auto') announce(); };
    /* Safari before 14 only has the deprecated addListener. */
    if (scheme.addEventListener) scheme.addEventListener('change', onScheme); else if (scheme.addListener) scheme.addListener(onScheme);
  }
  /* Debug hook for screenshots: ?theme=light|dark forces a theme without persisting it. */
  var forced = (window.location.search.match(/[?&]theme=(light|dark)/) || [])[1];
  if (forced) root.setAttribute('data-theme', forced);
  /* Debug hook for full-page screenshots: ?shot=1 removes viewport-relative heights and sticky positioning. */
  if (/[?&]shot=1/.test(window.location.search)) root.classList.add('shot');
  window.siteTheme = { isDark: currentIsDark };
  window.siteMotion = { reduce: reduce };
  /* Initial aria-checked (the markup says false); the figure modules load after this script, so nothing hears
     the themechange this dispatches. */
  announce();

  /* ---- Scroll reveal: adds .is-in once when an element enters the viewport ---- */
  var targets = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-in'); io.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ---- Helper shared by the canvas modules: run a loop only while visible and the tab is shown ---- */
  window.whenVisible = function (el, onVisible, onHidden) {
    var inView = false, running = false;
    function update() {
      var should = inView && !document.hidden;
      if (should && !running) { running = true; onVisible(); }
      else if (!should && running) { running = false; onHidden(); }
    }
    if (!('IntersectionObserver' in window)) { inView = true; update(); return; }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { inView = e.isIntersecting; });
      update();
    }, { threshold: 0.05 });
    obs.observe(el);
    document.addEventListener('visibilitychange', update);
  };

  /* ---- The one sentence: word-by-word reveal fallback where scroll-driven animations are unsupported ---- */
  var words = document.querySelectorAll('.sentence .w');
  if (words.length) {
    var supportsView = window.CSS && CSS.supports && CSS.supports('animation-timeline: view()');
    if (reduce) {
      words.forEach(function (w) { w.classList.add('lit'); });
    } else if (!supportsView && 'IntersectionObserver' in window) {
      var wio = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add('lit'); wio.unobserve(entry.target); }
        });
      }, { rootMargin: '-42% 0px -42% 0px', threshold: 0 });
      words.forEach(function (w) { wio.observe(w); });
    } else if (!supportsView) {
      words.forEach(function (w) { w.classList.add('lit'); });
    }
  }

  /* ---- Publications filter (native radio group; the value of a radio is a publication type or "first") ---- */
  var filter = document.getElementById('pub-filter');
  if (filter) {
    var entries = Array.prototype.slice.call(document.querySelectorAll('.pub-entry'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('.pub-group'));
    var empty = document.querySelector('.pub-empty');
    var count = document.getElementById('pub-count');
    /* live: the count is a live region, so the initial pass (page load) does not write it. */
    var apply = function (live) {
      var checked = filter.querySelector('input:checked');
      var mode = checked ? checked.value : 'all';
      var shown = 0;
      entries.forEach(function (li) {
        var ok = mode === 'all' || (mode === 'first' ? li.dataset.first === 'true' : li.dataset.type === mode);
        li.hidden = !ok;
        if (ok) shown++;
      });
      groups.forEach(function (g) {
        g.hidden = !g.querySelector('.pub-entry:not([hidden])');
      });
      if (empty) empty.hidden = shown > 0;
      /* The sentence comes from the page language (data-count-template on the fieldset). */
      if (count && live) count.textContent = (filter.dataset.countTemplate || '{n} / {total}').replace('{n}', shown).replace('{total}', entries.length);
    };
    filter.addEventListener('change', function () { apply(true); });
    apply(false);
  }
})();
