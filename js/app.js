/* ==========================================================================
   Celience Adapt · prototype logic
   - content (texts, colours, positions, products) comes from data/content.json
   - styles and which screen is visible live in css/style.css (data-screen on .app)
   - this file: navigation, the dots' motion, and building the dynamic lists
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     Constants
     ---------------------------------------------------------------------- */

  const W = 390;
  const H = 844;
  const R = 20;                                   // dot radius

  // where the greeting and the dashboard panel sit for each layout
  const HELLO_TOP = { home: 384, dashboard: 128, map: 60 };
  const PANEL_TOP = { home: 860, dashboard: 268, map: 860 };

  // the Add an event menu unfolds upwards from the button row
  const MENU_TOP = 780;
  const MENU_STEP = 39;

  // dots drifting: home & dashboard / map (gentler)
  const DRIFT = { force: 9, spring: 0.5, max: 16 };
  const MAP_DRIFT = { force: 3, spring: 0.9, max: 5 };

  // loader: pile ↔ logo, then the dots spread to screen 1
  const LOADER = { scale: 5, cycle: 1.8, end: 2.9 };
  const ENTER_DELAY = [0, 0.18, 0.3, 0.12, 0.42, 0.24, 0.36, 0.06];

  const SCREEN_TITLE = {
    map: 'MAP', travel: 'TRAVELLING', protocol: 'PROTOCOL', product: 'PROTOCOL',
    basket: 'BASKET', safety: 'SAFETY', order: 'ORDER'
  };

  /* ------------------------------------------------------------------------
     Helpers
     ---------------------------------------------------------------------- */

  const $ = (id) => document.getElementById(id);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const joinAnd = (a) => (a.length < 2 ? a[0] || '' : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // one pending timer for the scripted moments (next question, auto-return…)
  let timer = null;
  function later(ms, fn) { clearTimeout(timer); timer = setTimeout(fn, ms); }

  /* ------------------------------------------------------------------------
     State
     ---------------------------------------------------------------------- */

  let C = null;                                   // content.json
  const app = $('app');

  const state = {
    screen: 'loading',
    quiz: null, qi: 0, answers: {},               // current cluster quiz
    results: {}, done: {},                        // finished quizzes
    travelStep: 0, travelAnswers: {}, travelDone: false, tripAnswers: {},
    menuOpen: false,
    basket: [], inBasket: false,
    safety: {},
    openRows: {},
    product: null
  };

  const sim = {
    now: 0,
    loaded: false,
    spreadAt: null,
    hello: { v: HELLO_TOP.home, tw: null },
    panel: { v: PANEL_TOP.home, tw: null },
    dots: [],
    clumps: {},
    tripSeen: false
  };

  const layoutOf = (screen) =>
    screen === 'dashboard' ? 'dashboard' : screen === 'loading' || screen === 'home' ? 'home' : 'map';

  /* ------------------------------------------------------------------------
     Navigation
     ---------------------------------------------------------------------- */

  function show(screen, patch) {
    Object.assign(state, patch || {}, { screen: screen });
    render();
  }

  // the three "living" screens move the greeting, the panel and the dots
  function goTo(screen) {
    show(screen, { menuOpen: false });
    const layout = layoutOf(screen);
    tween(sim.hello, HELLO_TOP[layout], 0.7);
    tween(sim.panel, PANEL_TOP[layout], screen === 'dashboard' ? 1.1 : 0.7);
    sim.dots.forEach((p) => { p.hx = undefined; p.hy = undefined; });

    if (screen === 'home') { enterAll(0.1); return; }
    if (screen === 'dashboard') {
      // the dots stay put and get pushed up by the rising panel
      sim.dots.forEach((p) => { p.mode = 'free'; p.vx = 0; p.vy = 0; });
      return;
    }
    sim.dots.forEach((p, i) => {
      Object.assign(p, { mode: 'tween', ease: 'inout', fx: p.x, fy: p.y, t0: sim.now + i * 0.035, dur: 0.75 });
    });
  }

  // tap anywhere on the first screens
  function next() {
    if (!sim.loaded) { sim.loaded = true; spreadAll(); return; }   // skip the loader
    if (state.screen === 'home') goTo('dashboard');
    else if (state.screen === 'dashboard') goTo('map');
  }

  function back() {
    switch (state.screen) {
      case 'safety': show('basket'); break;
      case 'product': goTo('dashboard'); break;
      case 'map': goTo('dashboard'); break;
      default: clearTimeout(timer); show('map');
    }
  }

  /* ------------------------------------------------------------------------
     Cluster quizzes
     ---------------------------------------------------------------------- */

  function openQuiz(id) {
    clearTimeout(timer);
    show('quiz', { quiz: id, qi: 0, answers: {}, menuOpen: false });
  }

  function pickAnswer(k) {
    const quiz = C.quizzes[state.quiz];
    const qi = state.qi;
    const answers = Object.assign({}, state.answers, { [qi]: k });
    state.answers = answers;
    renderQuiz();

    if (qi < quiz.length - 1) {
      later(450, () => fadeTo($('quizBody'), () => { state.qi = qi + 1; renderQuiz(); }));
    } else {
      // last answer: the cluster is done (its dot fills) and we return to the map
      const id = state.quiz;
      later(600, () => show('map', {
        done: Object.assign({}, state.done, { [id]: true }),
        results: Object.assign({}, state.results, { [id]: answers })
      }));
    }
  }

  function fadeTo(node, change) {
    node.classList.add('is-fading');
    later(230, () => { change(); node.classList.remove('is-fading'); });
  }

  /* ------------------------------------------------------------------------
     Travelling event
     ---------------------------------------------------------------------- */

  function openTravel() {
    show('travel', { menuOpen: false, travelStep: 0, travelAnswers: {} });
  }

  function travelNext() {
    fadeTo($('travelBody'), () => {
      state.travelStep += 1;
      renderTravel();
      if (state.travelStep === 3) {
        // summary: 2 s to read, then back to the map
        state.travelDone = true;
        state.tripAnswers = state.travelAnswers;
        later(2000, () => show('map'));
      }
    });
  }

  function pickTravel(k) {
    state.travelAnswers = Object.assign({}, state.travelAnswers, { [state.travelStep]: k });
    renderTravel();
    later(450, travelNext);
  }

  /* ------------------------------------------------------------------------
     Protocol: answers → highlighted topics → products
     ---------------------------------------------------------------------- */

  function buildProtocol() {
    const cards = [];
    const topics = [];
    const areas = [];

    Object.keys(C.protocolRules).forEach((cluster) => {
      const result = state.results[cluster];
      if (!result) return;
      areas.push(cluster);
      C.protocolRules[cluster].forEach((rule) => {
        if (rule.answers.indexOf(result[rule.question]) > -1) topics.push(rule.topic);
      });
    });

    if (topics.length) {
      cards.push(Object.assign({ id: 'recovery' }, C.products.recovery, {
        reason: 'Your answers on ' + joinAnd(areas) + ' highlight ' + joinAnd(topics) +
                '. This matches what you declared, it is not a diagnosis.'
      }));
    }

    if (state.travelDone) {
      const pick = state.tripAnswers[1];
      const options = C.events.travel.questions[0].options;
      const priority = pick !== undefined ? options[pick].toLowerCase() : 'your travel';
      cards.push(Object.assign({ id: 'flight' }, C.products.flight, {
        reason: 'You declared a trip Zurich (ZRH) → Singapour (SIN) on November 17 and want to prioritize ' +
                priority + '. Flight Reset organises the key moments of your journey.'
      }));
    }

    cards.push(Object.assign({ id: 'micro' }, C.products.micro));
    return cards;
  }

  function openRoutine(productId, reason) {
    tween(sim.panel, PANEL_TOP.map, 0.6);
    show('product', { product: Object.assign({ id: productId }, C.products[productId], { reason: reason }), openRows: {} });
  }

  function addToBasket() {
    if (state.inBasket) return;
    const items = buildProtocol().map((c) => ({ name: c.name, color: c.color, description: c.description }));
    Object.assign(state, { inBasket: true, basket: items });
    render();
    later(2000, () => show('map'));               // "added" for 2 s, then the map
  }

  function pickSafety(k) {
    const s = C.safety;
    if (k === s.confirmIndex) {
      // demo path: "None of the above" confirms the order, then the dashboard after 2 s
      state.safety = { [k]: true };
      renderSafety();
      later(350, () => {
        show('order', { basket: [], inBasket: false });
        later(2000, () => goTo('dashboard'));
      });
      return;
    }
    const n = Object.assign({}, state.safety);
    delete n[s.confirmIndex];
    n[k] = !n[k];
    state.safety = n;
    renderSafety();
  }

  /* ------------------------------------------------------------------------
     Motion
     ---------------------------------------------------------------------- */

  function tween(o, to, dur) { o.tw = { from: o.v, to: to, t0: sim.now, dur: dur }; }

  function stepTween(o) {
    if (!o.tw) return;
    const k = clamp((sim.now - o.tw.t0) / o.tw.dur, 0, 1);
    o.v = o.tw.from + (o.tw.to - o.tw.from) * ease(k);
    if (k >= 1) o.tw = null;
  }

  function home(i, layout) { return C.clusters[i].pos[layout]; }

  // loader: a pile in the centre that bursts into the logo and gathers again
  function clump(c) {
    if (!sim.clumps[c]) {
      sim.clumps[c] = C.loader.logo.map(() => {
        const a = Math.random() * Math.PI * 2;
        const r = 4 + Math.random() * 20;
        return [W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r];
      });
    }
    return sim.clumps[c];
  }

  function loaderPos(i) {
    const spot = C.loader.spotOf[C.clusters[i].id];
    const g = C.loader.logo[spot];
    const ring = [W / 2 + (g[0] - 19) * LOADER.scale, H / 2 + (g[1] - 16.5) * LOADER.scale];
    const t = Math.max(0, sim.now - spot * 0.025);
    const c = Math.floor(t / LOADER.cycle);
    const u = t - c * LOADER.cycle;
    const a = clump(c)[spot];
    const b = clump(c + 1)[spot];
    let e;
    if (u < 0.65) { e = ease(u / 0.65); return [a[0] + (ring[0] - a[0]) * e, a[1] + (ring[1] - a[1]) * e]; }
    if (u < 1.15) return ring;
    e = ease((u - 1.15) / 0.65);
    return [ring[0] + (b[0] - ring[0]) * e, ring[1] + (b[1] - ring[1]) * e];
  }

  // loader done: the same dots spread out to their screen-1 spots
  function spreadAll() {
    sim.spreadAt = sim.now;
    show('home');
    sim.dots.forEach((p, i) => {
      Object.assign(p, { mode: 'tween', ease: 'inout', fx: p.x, fy: p.y, t0: sim.now + i * 0.04, dur: 1.2 });
    });
  }

  // back to screen 1: each dot flies in from the side it is closest to
  function enterAll(delay) {
    sim.dots = C.clusters.map((cl, i) => {
      const [hx, hy] = cl.pos.home;
      const a = Math.atan2(hy - H / 2, hx - W / 2) + (Math.random() - 0.5) * 0.8;
      const sx = hx + Math.cos(a) * 520;
      const sy = hy + Math.sin(a) * 520;
      return {
        x: sx, y: sy, vx: 0, vy: 0, fx: sx, fy: sy,
        mode: 'tween', ease: 'out', t0: sim.now + delay + ENTER_DELAY[i], dur: 1.4,
        th: Math.random() * Math.PI * 2
      };
    });
  }

  // walls, and on the dashboard the panel is a solid floor
  function collide(p) {
    if (p.x < R) { p.x = R; if (p.vx < 0) p.vx = -p.vx; }
    if (p.x > W - R) { p.x = W - R; if (p.vx > 0) p.vx = -p.vx; }
    if (p.y < R) { p.y = R; if (p.vy < 0) p.vy = -p.vy; }
    if (p.y > H - R) { p.y = H - R; if (p.vy > 0) p.vy = -p.vy; }
    if (state.screen === 'dashboard' && p.y + R > sim.panel.v) {
      p.y = sim.panel.v - R;
      if (p.vy > 0) p.vy = -p.vy;
    }
  }

  // dots are solid: they bump into each other instead of overlapping
  function separate() {
    const ds = sim.dots;
    const D = 2 * R;
    const movable = (p) => p.mode !== 'tween' && p.mode !== 'load';
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < ds.length; i++) {
        for (let j = i + 1; j < ds.length; j++) {
          const a = ds[i];
          const b = ds[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= D) continue;
          const am = movable(a);
          const bm = movable(b);
          if (!am && !bm) continue;
          const nx = d < 0.001 ? 1 : dx / d;
          const ny = d < 0.001 ? 0 : dy / d;
          const over = D - d;
          const wa = am ? (bm ? 0.5 : 1) : 0;
          const wb = bm ? (am ? 0.5 : 1) : 0;
          a.x -= nx * over * wa; a.y -= ny * over * wa;
          b.x += nx * over * wb; b.y += ny * over * wb;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;   // equal-mass bounce
          if (rel < 0) {
            if (am) { a.vx += rel * nx; a.vy += rel * ny; }
            if (bm) { b.vx -= rel * nx; b.vy -= rel * ny; }
          }
          if (am) collide(a);
          if (bm) collide(b);
        }
      }
    }
  }

  function simulate(dt) {
    sim.now += dt;
    if (!sim.loaded && sim.now >= LOADER.end) { sim.loaded = true; spreadAll(); }

    const layout = layoutOf(state.screen);
    stepTween(sim.hello);
    const panelWasMoving = !!sim.panel.tw;
    stepTween(sim.panel);

    // panel settled on the dashboard: the dots keep drifting where it left them
    if (layout === 'dashboard' && panelWasMoving && !sim.panel.tw) {
      sim.dots.forEach((p) => { p.mode = 'drift'; p.hx = p.x; p.hy = p.y; });
    }

    const drift = layout === 'map' ? MAP_DRIFT : DRIFT;

    sim.dots.forEach((p, i) => {
      const target = p.hx !== undefined ? [p.hx, p.hy] : home(i, layout);

      if (p.mode === 'load') {
        const lp = loaderPos(i);
        p.x = lp[0]; p.y = lp[1];
      } else if (p.mode === 'free') {
        // float in place while the panel pushes them
        p.th += (Math.random() - 0.5) * 3 * dt;
        p.vx = p.vx * (1 - 2 * dt) + Math.cos(p.th) * DRIFT.force * dt;
        p.vy = p.vy * (1 - 2 * dt) + Math.sin(p.th) * DRIFT.force * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        collide(p);
      } else if (p.mode === 'tween') {
        const k = clamp((sim.now - p.t0) / p.dur, 0, 1);
        const e = p.ease === 'out' ? easeOut(k) : ease(k);
        p.x = p.fx + (target[0] - p.fx) * e;
        p.y = p.fy + (target[1] - p.fy) * e;
        if (k >= 1) { p.mode = 'drift'; p.vx = 0; p.vy = 0; }
      } else {
        // slow, never-still drift around the home spot
        p.th += (Math.random() - 0.5) * 3 * dt;
        p.vx += (Math.cos(p.th) * drift.force + (target[0] - p.x) * drift.spring) * dt;
        p.vy += (Math.sin(p.th) * drift.force + (target[1] - p.y) * drift.spring) * dt;
        const s = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (s > drift.max) { p.vx *= drift.max / s; p.vy *= drift.max / s; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        collide(p);
      }
    });

    separate();
  }

  /* ------------------------------------------------------------------------
     Per-frame drawing (positions only)
     ---------------------------------------------------------------------- */

  const dotNodes = [];

  function draw() {
    sim.dots.forEach((p, i) => {
      dotNodes[i].style.transform = 'translate(' + (p.x - R).toFixed(2) + 'px,' + (p.y - R).toFixed(2) + 'px)';
    });
    $('hello').style.top = sim.hello.v.toFixed(2) + 'px';
    $('panel').style.top = sim.panel.v.toFixed(2) + 'px';

    // text and header appear once the dots have finished spreading
    const introDone = sim.loaded && sim.spreadAt !== null && sim.now > sim.spreadAt + 1.4;
    app.classList.toggle('is-intro-done', introDone);

    // the travelling card arrives the first time the panel settles after the event was added
    if (state.travelDone && state.screen === 'dashboard' && !sim.panel.tw) sim.tripSeen = true;
    $('tripCard').classList.toggle('is-shown', state.travelDone && sim.tripSeen);
  }

  function loop() {
    let last = null;
    function frame(t) {
      if (last === null) last = t;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      simulate(dt);
      draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------------
     Rendering (on state changes)
     ---------------------------------------------------------------------- */

  function render() {
    app.dataset.screen = state.screen;
    app.classList.toggle('menu-open', state.menuOpen);
    app.classList.toggle('has-basket', state.basket.length > 0);

    // header: title + logo kept optically centred
    const layout = layoutOf(state.screen);
    const title = state.screen === 'quiz' ? clusterById(state.quiz).label : SCREEN_TITLE[state.screen] || '';
    $('title').textContent = title;
    $('brand').style.left = (layout === 'map' ? Math.round(W / 2 - (48 + title.length * 10) / 2) : 176) + 'px';
    $('badgeCount').textContent = state.basket.length;
    $('badge').setAttribute('aria-label', 'Basket, ' + state.basket.length + ' items');

    // dots: outline until their quiz is answered
    C.clusters.forEach((cl, i) => {
      dotNodes[i].classList.toggle('is-todo', cl.todo && sim.loaded && !state.done[cl.id]);
    });

    // event menu
    $('addEvent').setAttribute('aria-expanded', String(state.menuOpen));
    const items = $('eventMenu').children;
    for (let i = 0; i < items.length; i++) {
      const k = items.length - i;                 // distance from the button row
      items[i].style.top = (state.menuOpen ? MENU_TOP - MENU_STEP * k : MENU_TOP) + 'px';
      items[i].style.setProperty('--delay', (state.menuOpen ? (k - 1) * 50 : (items.length - k) * 30) + 'ms');
    }

    if (state.screen === 'quiz') renderQuiz();
    if (state.screen === 'travel') renderTravel();
    if (state.screen === 'protocol' || state.screen === 'product') renderProducts();
    if (state.screen === 'basket') renderBasket();
    if (state.screen === 'safety') renderSafety();

    const add = $('addToBasket');
    add.textContent = state.inBasket ? 'ADDED TO BASKET' : 'ADD TO BASKET';
    add.classList.toggle('is-done', state.inBasket);
  }

  function clusterById(id) { return C.clusters.find((c) => c.id === id); }

  function progress(node, total, current, color, track) {
    node.textContent = '';
    for (let n = 0; n < total; n++) {
      const seg = el('span', 'progress__segment' + (n <= current ? ' is-done' : ''));
      node.appendChild(seg);
    }
    node.style.setProperty('--progress-color', color);
    node.style.setProperty('--track-color', track);
  }

  function options(container, list, selected, onPick) {
    container.textContent = '';
    container.classList.toggle('has-answer', selected !== undefined);
    list.forEach((text, k) => {
      const b = el('button', 'option' + (selected === k ? ' is-selected' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(selected === k));
      b.append(el('span', 'option__dot'), el('span', 'option__text', text));
      b.addEventListener('click', () => onPick(k));
      container.appendChild(b);
    });
  }

  function renderQuiz() {
    const cl = clusterById(state.quiz);
    const quiz = C.quizzes[state.quiz];
    const q = quiz[state.qi];
    const screen = $('quiz');
    screen.style.setProperty('--card', cl.color);
    progress($('quizProgress'), quiz.length, state.qi, cl.color, '#D6D6D6');
    $('quizQuestionText').textContent = q.question;
    $('quizHint').textContent = q.hint || '';
    options($('quizOptions'), q.options, state.answers[state.qi], pickAnswer);
  }

  function renderTravel() {
    const t = C.events.travel;
    const step = state.travelStep;
    const body = $('travelBody');
    progress($('travelProgress'), 3, Math.min(step, 2), 'var(--violet-strong)', 'var(--track)');
    body.textContent = '';

    if (step === 0) {
      body.appendChild(questionCard(t.title));
      const fields = el('div', 'card card--fields');
      t.fields.forEach((f) => {
        const field = el('div', 'field');
        field.append(el('span', 'field__label', f.label), el('div', 'field__value', f.value));
        fields.appendChild(field);
      });
      body.appendChild(fields);
      const cont = el('button', 'outline-button outline-button--inline', 'CONTINUE');
      cont.type = 'button';
      cont.addEventListener('click', travelNext);
      body.appendChild(cont);
    } else if (step <= 2) {
      const q = t.questions[step - 1];
      body.appendChild(questionCard(q.question));
      const list = el('div', 'card card--options');
      options(list, q.options, state.travelAnswers[step], pickTravel);
      body.appendChild(list);
    } else {
      body.appendChild(questionCard(t.summary.title));
      const summary = el('div', 'card card--summary');
      const trip = el('div', 'summary-row');
      trip.append(el('span', 'summary-row__name', t.summary.trip.name), el('span', 'summary-row__detail', t.summary.trip.detail));
      summary.appendChild(trip);
      t.summary.universes.forEach((u) => summary.appendChild(el('div', 'summary-row', u)));
      body.appendChild(summary);
    }
  }

  function questionCard(text) {
    const card = el('div', 'card card--question');
    card.appendChild(el('p', 'card__question', text));
    return card;
  }

  function renderProducts() {
    const list = $('protocolList');
    const cards = state.screen === 'product' ? [state.product] : buildProtocol();
    list.textContent = '';

    cards.forEach((c) => {
      const card = el('article', 'product');
      card.style.setProperty('--card', c.color);
      card.append(el('h2', 'product__name', c.name), el('p', 'product__text', c.description));
      if (c.reason) card.appendChild(el('p', 'product__text', c.reason));

      const rows = el('div', 'product__rows');
      [['science', 'What the science says', c.science], ['precautions', 'Precautions', c.precautions]].forEach(([key, label, text]) => {
        const id = c.id + ':' + key;
        const open = !!state.openRows[id];
        const row = el('div', 'accordion' + (open ? ' is-open' : ''));
        const toggle = el('button', 'accordion__toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.append(el('span', '', label), el('span', 'accordion__dot'));
        toggle.addEventListener('click', () => {
          state.openRows = Object.assign({}, state.openRows, { [id]: !open });
          renderProducts();
        });
        row.append(toggle, el('p', 'accordion__body', text));
        rows.appendChild(row);
      });
      card.appendChild(rows);
      list.appendChild(card);
    });
  }

  function renderBasket() {
    const list = $('basketList');
    list.textContent = '';
    state.basket.forEach((item) => {
      const card = el('article', 'product product--compact');
      card.style.setProperty('--card', item.color);
      card.append(el('h2', 'product__name', item.name), el('p', 'product__text', item.description));
      list.appendChild(card);
    });
  }

  function renderSafety() {
    $('safetyTitle').textContent = C.safety.title;
    const list = $('safetyOptions');
    list.textContent = '';
    list.classList.add('card--checklist');
    C.safety.options.forEach((text, k) => {
      const on = !!state.safety[k];
      const b = el('button', 'option' + (on ? ' is-selected' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      b.append(el('span', 'option__dot'), el('span', 'option__text', text));
      b.addEventListener('click', () => pickSafety(k));
      list.appendChild(b);
    });
  }

  /* ------------------------------------------------------------------------
     Build the static parts from content.json
     ---------------------------------------------------------------------- */

  function build() {
    $('helloName').textContent = C.user.firstName;
    $('orderText').textContent = C.safety.confirmation;

    // dots
    const dots = $('dots');
    C.clusters.forEach((cl, i) => {
      const b = el('button', 'dot' + (C.quizzes[cl.id] ? ' is-quiz' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', cl.label);
      b.style.setProperty('--c', cl.color);
      b.style.setProperty('--label-delay', 350 + i * 40 + 'ms');
      b.append(el('span', 'dot__circle'), el('span', 'dot__label', cl.label));
      if (C.quizzes[cl.id]) b.addEventListener('click', () => openQuiz(cl.id));
      dots.appendChild(b);
      dotNodes.push(b);
    });
    sim.dots = C.clusters.map(() => ({ x: W / 2, y: H / 2, vx: 0, vy: 0, mode: 'load', th: Math.random() * Math.PI * 2 }));

    // dashboard routines
    const routines = $('routines');
    C.routines.forEach((r) => {
      const b = el('button', 'routine', r.label);
      b.type = 'button';
      b.style.setProperty('--card', r.color);
      b.style.setProperty('--count', r.countColor);
      b.appendChild(el('span', 'routine__count', String(r.count)));
      b.addEventListener('click', () => openRoutine(r.product, r.reason));
      routines.appendChild(b);
    });
    const trip = $('tripCard');
    const tc = C.events.travel.dashboardCard;
    trip.textContent = tc.label;
    trip.style.setProperty('--card', '#FEFDCC');
    trip.style.setProperty('--count', '#D2D2A8');
    trip.appendChild(el('span', 'routine__count', String(tc.count)));
    trip.addEventListener('click', () => openRoutine('flight', C.tripRoutineReason));

    // add an event menu
    const menu = $('eventMenu');
    C.events.menu.forEach((item) => {
      const b = el('button', 'event-menu__item', item.label);
      b.type = 'button';
      b.style.width = item.width + 'px';
      b.addEventListener('click', () => {
        if (item.opens === 'travel') openTravel();
        else { state.menuOpen = false; render(); }
      });
      menu.appendChild(b);
    });

    // controls
    $('back').addEventListener('click', back);
    $('logo').addEventListener('click', () => { if (state.screen === 'dashboard') goTo('home'); });
    $('badge').addEventListener('click', () => show('basket', { menuOpen: false }));
    $('accessProtocol').addEventListener('click', () => show('protocol', { menuOpen: false, openRows: {} }));
    $('addEvent').addEventListener('click', () => { state.menuOpen = !state.menuOpen; render(); });
    $('addToBasket').addEventListener('click', addToBasket);
    $('buy').addEventListener('click', () => show('safety', { safety: {} }));

    // tap anywhere on the loader, screen 1 and the dashboard
    app.addEventListener('click', (e) => {
      if (!['loading', 'home', 'dashboard'].includes(state.screen)) return;
      if (e.target.closest('button')) return;
      next();
    });
  }

  /* ------------------------------------------------------------------------
     Fit the 390 × 844 frame to the window
     ---------------------------------------------------------------------- */

  function fit() {
    const s = Math.min(1, window.innerWidth / W, window.innerHeight / H);
    app.style.transform = s < 1 ? 'scale(' + s + ')' : '';
  }

  /* ------------------------------------------------------------------------
     Start
     ---------------------------------------------------------------------- */

  fit();
  window.addEventListener('resize', fit);

  fetch('data/content.json')
    .then((r) => r.json())
    .then((content) => {
      C = content;
      build();
      render();
      loop();
    })
    .catch(() => { $('loadError').hidden = false; });
})();
