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
  const HELLO_TOP = { home: 384, dashboard: 202, map: 60 };
  const PANEL_TOP = { home: 860, dashboard: 430, map: 860 };

  // the Add an event menu unfolds upwards from the button row
  const MENU_TOP = 780;
  const MENU_STEP = 39;

  // dots drifting: home & dashboard / map (gentler)
  const DRIFT = { force: 9, spring: 0.5, max: 16 };
  const MAP_DRIFT = { force: 3, spring: 0.9, max: 5 };

  // dashboard (profile): dots fall onto the panel and line up flat on it
  // g = gravity (px/s²), slide = pull toward its slot, friction = sideways damping,
  // rest = below this speed (px/s) a dot on the panel stops bouncing, margin = row side margin,
  // hop = upward kick (px/s) when the bar touches a dot → small bounce (~15 px, then ~5 px)
  const GRAVITY = { g: 1600, slide: 18, friction: 6, rest: 60, margin: 22, hop: 220 };

  // loader: pile ↔ logo, then the dots spread to screen 1
  // cycle = one full breath (ring → cluster → ring); twist = minimum swirl per dot (rad)
  // loops = how many times the breath plays (logo → mix → logo); every breath ends on the original logo
  // duration = length of ONE breath incl. stagger + hold (s); hold = pause on the logo before the spread
  const LOADER = { scale: 5, duration: 2, stagger: 0.03, twist: 0.6, loops: 2, hold: 0.3 };
  LOADER.cycle = LOADER.duration - LOADER.hold - 7 * LOADER.stagger;
  // intro: before the breath, the dots fly in from outside the screen and settle into the logo
  // intro = seconds until the logo is assembled; introFar = start distance from centre (px);
  // introWander = how far (px) each dot floats off its straight path, like a firefly
  LOADER.introOn = false;                 // TEMP: firefly intro disabled — set to true to bring it back
  LOADER.intro = LOADER.introOn ? 1.2 : 0;
  LOADER.introFar = 560;
  LOADER.introWander = 45;
  LOADER.end = LOADER.intro + LOADER.loops * LOADER.cycle + 7 * LOADER.stagger + LOADER.hold;
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
  const easeSoft = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);   // quart in-out: longer, softer start and landing
  const easeOut = (t) => 1 - Math.pow(1 - t, 4);
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
    travelStep: 0, travelDone: false,
    menuOpen: false,
    basket: [], inBasket: false,
    owned: {},                                    // products bought (ordered), by id
    safety: {},
    openRows: {},
    product: null
  };

  let tripPie = null;

  const sim = {
    now: 0,
    loaded: false,
    spreadAt: null,
    hello: { v: HELLO_TOP.home, tw: null },
    panel: { v: PANEL_TOP.home, tw: null },
    bump: { o: 0, v: 0 },            // panel recoil when dots land on it (px offset + speed)
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
      pies.forEach((p) => { if (p !== tripPie || sim.tripSeen) emptyPie(p, PIE.delay); });
      // gravity: the dots fall onto the rising panel and settle side by side, all flat on it.
      // Each one gets a slot on the panel, in the left-to-right order they already have.
      const order = sim.dots.map((_, i) => i).sort((a, b) => sim.dots[a].x - sim.dots[b].x);
      const n = sim.dots.length;
      const x0 = GRAVITY.margin + R;
      const step = (W - 2 * x0) / (n - 1);
      order.forEach((i, rank) => {
        const p = sim.dots[i];
        p.mode = 'grav';
        p.onBar = false;
        p.sx = x0 + rank * step;
        p.vx *= 0.3; p.vy = Math.min(p.vy, 0) * 0.3;
      });
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
      case 'map':
        // the circles' labels fade out first, then the dots move on
        app.classList.add('labels-out');
        later(240, () => { goTo('dashboard'); app.classList.remove('labels-out'); });
        break;
      case 'quiz': clearTimeout(timer); leaveQuiz(state.quiz, null); break;
      case 'cluster': clearTimeout(timer); leaveCluster(state.cluster); break;
      default: clearTimeout(timer); show('map');
    }
  }

  /* ------------------------------------------------------------------------
     Cluster quizzes
     ---------------------------------------------------------------------- */

  // the map dot and the quiz circle are the same circle: it flies in, and flies back out
  const QUIZ_FLY = 0.9;                              // seconds, map ↔ quiz circle
  const quizDot = (id) => C.clusters.findIndex((c) => c.id === id);

  // centre of the quiz circle in app coordinates (layout only, ignores the screen's slide-in)
  function orbCenter() {
    const q = $('quiz');
    const d = $('quizOrb');
    return [q.offsetLeft + d.offsetLeft + d.offsetWidth / 2, q.offsetTop + d.offsetTop + d.offsetHeight / 2];
  }

  // to = fixed point, or a function giving a moving target (followed every frame)
  function flyDot(i, to, dur) {
    const p = sim.dots[i];
    const follow = typeof to === 'function' ? to : null;
    const pt = follow ? follow() : to;
    Object.assign(p, { mode: 'tween', ease: 'soft', fx: p.x, fy: p.y, t0: sim.now, dur: dur || QUIZ_FLY,
                       hx: pt ? pt[0] : undefined, hy: pt ? pt[1] : undefined, follow: follow });
  }

  // where the quiz circle really is (its place + its current float / sway)
  const orbNow = () => { const [x, y] = orbCenter(); return [x + orb.pos[0], y + orb.pos[1]]; };

  // map dot ↔ quiz circle hand-over in the same frame: no cross-fade, no double, no gap
  function swap(node, showDot) {
    node.style.transition = 'none';
    node.classList.toggle('is-traveling', showDot);
    $('quiz').classList.toggle('is-orb-hidden', showDot);
    void node.offsetWidth;                         // apply now, then give the transition back
    node.style.transition = '';
  }

  /* Quiz choreography
     IN : the circle flies alone to the centre of the screen → the questions appear one by one
          (top → bottom) while the circle glides to its place between them → the quiz circle takes over.
     OUT: the questions leave (bottom → top) → the circle glides back to the centre →
          completed: it fills with its colour there (fill, pop, ripple) → the other dots come back →
          it flies home. Back without finishing: same, without the colour. */
  const QUIZ_STAGE = { settle: 0.6, outBefore: 380, centre: 0.5, colourHold: 1000, homeAfter: 250 };
  const screenCentre = () => [W / 2, H / 2];

  function openQuiz(id) {
    clearTimeout(timer);
    show('quiz', { quiz: id, qi: 0, answers: {}, menuOpen: false });
    const i = quizDot(id);
    const node = dotNodes[i];
    const still = () => state.screen === 'quiz' && state.quiz === id;
    $('quiz').classList.remove('is-revealed');
    $('quiz').classList.add('is-orb-hidden');
    node.classList.add('is-traveling');              // stays visible over the quiz while it moves
    flyDot(i, screenCentre());                       // 1. alone, to the centre
    setTimeout(() => {
      if (!still()) return;
      $('quiz').classList.add('is-revealed');        // 2. the questions appear…
      flyDot(i, orbNow, QUIZ_STAGE.settle);          //    …while the circle settles onto the quiz circle
      setTimeout(() => {
        if (!still()) return;
        swap(node, false);                           // 3. hand over to the animated quiz circle
        sim.dots[i].follow = null;                   //    (the hidden dot stops tracking it)
      }, QUIZ_STAGE.settle * 1000);
    }, QUIZ_FLY * 1000);
  }

  function leaveQuiz(id, answers) {
    const i = quizDot(id);
    const node = dotNodes[i];
    const p = sim.dots[i];
    $('quiz').classList.remove('is-revealed');      // 1. the questions leave
    setTimeout(() => {
      [p.x, p.y] = orbNow();                         // the dot takes over exactly where the quiz circle is
      swap(node, true);
      flyDot(i, screenCentre(), QUIZ_STAGE.centre); // 2. back to the centre
      const toMap = () => {                          // 4. the others come back, then it flies home
        show('map', answers ? { results: Object.assign({}, state.results, { [id]: answers }) } : {});
        setTimeout(() => {
          flyDot(i, null);
          setTimeout(() => node.classList.remove('is-traveling'), QUIZ_FLY * 1000);
        }, QUIZ_STAGE.homeAfter);
      };
      setTimeout(() => {
        if (answers) {                               // 3. completed: its colour comes in, in the centre
          celebrate(i, id);
          setTimeout(toMap, QUIZ_STAGE.colourHold);
        } else {
          toMap();
        }
      }, QUIZ_STAGE.centre * 1000);
    }, QUIZ_STAGE.outBefore);
  }

  /* ------------------------------------------------------------------------
     Cluster detail: tap a filled dot → it flies to the centre and becomes
     "MY DATA", the related content appears around it
     ---------------------------------------------------------------------- */

  // positions in the 390 × 844 frame (MY DATA = screen centre)
  const CLUSTER_SPOTS = [[84, 331], [269, 301], [103, 537], [276, 589]];

  function canOpenCluster(id) {
    const cl = clusterById(id);
    return !cl.todo || !!state.done[id];
  }

  function buildCluster(id) {
    const cl = clusterById(id);
    const d = (C.clusterDetail && C.clusterDetail[id]) || {};
    const view = $('clusterView');
    view.textContent = '';
    const node = (label, x, y, cls, k) => {
      const n = el('div', 'cnode ' + cls);
      n.style.left = x + 'px';
      n.style.top = y + 'px';
      n.style.setProperty('--o', k);
      n.append(el('span', 'cnode__label', label), el('span', 'cnode__circle'));
      view.appendChild(n);
    };
    node(C.clusterLabels.myData, W / 2, H / 2, 'cnode--mine', 0);
    view.style.setProperty('--c', cl.color);
    // the related topic takes the top-right spot, articles the others (as on the reference)
    const order = [C.clusterLabels.articles, d.related || C.clusterLabels.articles, C.clusterLabels.articles, C.clusterLabels.articles];
    CLUSTER_SPOTS.forEach(([x, y], k) => node(order[k], x, y, '', k + 1));
  }

  function openCluster(id) {
    clearTimeout(timer);
    buildCluster(id);
    show('cluster', { cluster: id, menuOpen: false });
    const i = quizDot(id);
    const node = dotNodes[i];
    const view = $('clusterView');
    view.classList.remove('is-revealed');
    node.classList.add('is-traveling');
    flyDot(i, screenCentre());
    later(QUIZ_FLY * 1000, () => {
      if (state.screen !== 'cluster' || state.cluster !== id) return;
      view.classList.add('is-revealed');            // MY DATA sits exactly where the dot landed
      setTimeout(() => node.classList.remove('is-traveling'), 300);
    });
  }

  function leaveCluster(id) {
    const i = quizDot(id);
    const node = dotNodes[i];
    const p = sim.dots[i];
    [p.x, p.y] = screenCentre();
    node.classList.add('is-traveling');
    $('clusterView').classList.remove('is-revealed');
    later(350, () => {
      show('map');
      flyDot(i, null);
      setTimeout(() => node.classList.remove('is-traveling'), QUIZ_FLY * 1000);
    });
  }

  // success: the outline fills from the centre, the dot pops and sends out a ripple
  function celebrate(i, id) {
    const node = dotNodes[i];
    node.classList.add('is-success');
    setTimeout(() => { state.done = Object.assign({}, state.done, { [id]: true }); render(); }, 650);
    setTimeout(() => node.classList.remove('is-success'), 1150);
  }

  // choosing an answer only selects it (it can still be changed); Next moves on
  function pickAnswer(k) {
    state.answers = Object.assign({}, state.answers, { [state.qi]: k });
    renderQuiz();
  }

  function nextQuestion() {
    const quiz = C.quizzes[state.quiz];
    const qi = state.qi;
    const answers = state.answers;
    if (answers[qi] === undefined) return;
    $('quizNext').disabled = true;            // no double taps during the transition

    if (qi < quiz.length - 1) {
      fadeTo($('quizBody'), () => { state.qi = qi + 1; renderQuiz(); });
    } else {
      // last answer: the cluster is done (its dot fills) and we return to the map
      const id = state.quiz;
      later(250, () => leaveQuiz(id, answers));
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
    show('travel', { menuOpen: false, travelStep: 0 });
  }

  function travelNext() {
    fadeTo($('travelBody'), () => {
      state.travelStep += 1;
      renderTravel();
      if (state.travelStep === 1) {
        // summary: 2 s to read, then back to the map
        state.travelDone = true;
        later(2000, () => show('map'));
      }
    });
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
      cards.push(Object.assign({ id: 'flight' }, C.products.flight, {
        reason: 'You declared a trip Zurich (ZRH) → Singapour (SIN) on November 17. Flight Reset organises the key moments of your journey.'
      }));
    }

    cards.push(Object.assign({ id: 'micro' }, C.products.micro));
    return cards;
  }

  // opened from a dashboard card: the product page takes that card's colour
  function openRoutine(productId, reason, color) {
    tween(sim.panel, PANEL_TOP.map, 0.6);
    const product = Object.assign({ id: productId }, C.products[productId], { reason: reason });
    if (color) product.color = color;
    show('product', { product: product, openRows: {} });
  }

  function addToBasket() {
    if (state.inBasket) return;
    const items = buildProtocol().map((c) => ({ id: c.id, name: c.name, color: c.color, description: c.description }));
    Object.assign(state, { inBasket: true, basket: items });
    render();
    later(2000, () => show('map'));               // "added" for 2 s, then the map
  }

  // several answers possible; "None of the above" excludes the others. Next confirms.
  function pickSafety(k) {
    const s = C.safety;
    let n = Object.assign({}, state.safety);
    if (k === s.confirmIndex) n = n[k] ? {} : { [k]: true };
    else { delete n[s.confirmIndex]; n[k] = !n[k]; if (!n[k]) delete n[k]; }
    state.safety = n;
    renderSafety();
  }

  function openSafety() {
    show('safety', { safety: {} });
    $('safety').classList.remove('is-revealed');
    setTimeout(() => { if (state.screen === 'safety') $('safety').classList.add('is-revealed'); }, 150);
  }

  function confirmSafety() {
    if (!Object.keys(state.safety).length) return;
    $('safetyNext').disabled = true;
    $('safety').classList.remove('is-revealed');      // the pieces leave, then the order is confirmed
    // what was in the basket is now owned (e.g. Flight Reset → its card appears on the dashboard)
    const owned = Object.assign({}, state.owned);
    state.basket.forEach((item) => { if (item.id) owned[item.id] = true; });
    state.owned = owned;
    later(450, () => {
      show('order', { basket: [], inBasket: false });
      later(2000, () => goTo('dashboard'));
    });
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

  // screen 1: scatter the dots at random (new layout on every page load).
  // They stay inside the screen, below the header, never overlap,
  // and keep clear of the "Hello, name" text in the middle.
  const SCATTER = { gap: 14, top: 120, bottom: 20, side: 16, hello: { x0: 70, x1: 320, y0: 360, y1: 470 } };
  function scatterHome() {
    const minD = 2 * R + SCATTER.gap;
    const placed = [];
    C.clusters.forEach((cl) => {
      let p;
      for (let tries = 0; tries < 2000; tries++) {
        p = [
          SCATTER.side + R + Math.random() * (W - 2 * (SCATTER.side + R)),
          SCATTER.top + R + Math.random() * (H - SCATTER.top - SCATTER.bottom - 2 * R)
        ];
        const h = SCATTER.hello;
        const onText = p[0] > h.x0 - R && p[0] < h.x1 + R && p[1] > h.y0 - R && p[1] < h.y1 + R;
        if (!onText && placed.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= minD)) break;
      }
      placed.push(p);
      cl.pos.home = p;
    });
  }

  // loader: the logo ring breathes in — the dots spiral into a loose, overlapping
  // cluster that drifts a little — then unfurls back into the ring.
  // Each cycle gets its own random cluster shape (swapped while on the ring, so no jump)
  // and its own seating: perm[i] = the ring spot dot i starts that cycle from.
  // Every new cycle reshuffles the seating, so the dots come out mixed.
  function clump(c) {
    if (!sim.clumps[c]) {
      // every breath starts and ends on the original logo (the dots mix inside the cluster)
      const perm = C.clusters.map((cl) => C.loader.spotOf[cl.id]);
      const d = Math.random() * Math.PI * 2;
      sim.clumps[c] = {
        perm,
        drift: [Math.cos(d) * R * 0.7, Math.sin(d) * R * 0.7],   // where the whole cluster wanders
        dots: C.loader.logo.map(() => ({
          r: 0.28 + (Math.random() - 0.5) * 0.25,                // radius as a share of the ring radius
          a: (Math.random() - 0.5) * 0.9,                          // angular jitter (rad)
          ph: Math.random() * Math.PI * 2
        }))
      };
    }
    return sim.clumps[c];
  }

  // a ring spot in polar coordinates around the screen centre
  function ringPolar(spot) {
    const g = C.loader.logo[spot];
    const rx = (g[0] - 19) * LOADER.scale;
    const ry = (g[1] - 16.5) * LOADER.scale;
    return [Math.sqrt(rx * rx + ry * ry), Math.atan2(ry, rx)];
  }

  // intro: dot i drifts in from off-screen like a firefly — no spinning, just a soft,
  // wandering float (layered slow sines) that calms down as it lands on its seat,
  // exactly when its breath begins (staggered departures, eased arrival = no hard stop)
  function introPos(i) {
    if (!sim.fly) sim.fly = [];
    if (!sim.fly[i]) {
      const rnd = (a, b) => a + Math.random() * (b - a);
      sim.fly[i] = {
        off: rnd(-0.8, 0.8),                                  // start a bit to the side of the seat direction
        f1: rnd(1.6, 2.6), f2: rnd(3.2, 4.6), f3: rnd(0.9, 1.4),
        p1: rnd(0, 6.28), p2: rnd(0, 6.28), p3: rnd(0, 6.28)
      };
    }
    const fl = sim.fly[i];
    const arrive = LOADER.intro + i * LOADER.stagger;
    const leave = ENTER_DELAY[i] * 0.8;
    const k = clamp((sim.now - leave) / (arrive - leave), 0, 1);
    const e = 1 - Math.pow(1 - k, 3);                          // gentle entrance, soft landing

    const [rS, aS] = ringPolar(clump(0).perm[i]);
    const seat = [W / 2 + Math.cos(aS) * rS, H / 2 + Math.sin(aS) * rS];
    const a0 = aS + fl.off;
    const start = [W / 2 + Math.cos(a0) * LOADER.introFar, H / 2 + Math.sin(a0) * LOADER.introFar];

    // straight base path + firefly wander, sideways and a little along the path
    const bx = start[0] + (seat[0] - start[0]) * e;
    const by = start[1] + (seat[1] - start[1]) * e;
    const dx = seat[0] - start[0];
    const dy = seat[1] - start[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const t = sim.now;
    const side = Math.sin(t * fl.f1 + fl.p1) * 0.65 + Math.sin(t * fl.f2 + fl.p2) * 0.35;
    const along = Math.sin(t * fl.f3 + fl.p3) * 0.4;
    const fade = Math.pow(1 - e, 1.5) * LOADER.introWander;   // calms to 0 on arrival
    return [
      bx + (nx * side + (dx / len) * along) * fade,
      by + (ny * side + (dy / len) * along) * fade
    ];
  }

  function loaderPos(i) {
    if (LOADER.introOn && sim.now < LOADER.intro + i * LOADER.stagger) return introPos(i);
    // after the last breath the dot rests on its seat (the logo holds)
    const t = clamp(sim.now - LOADER.intro - i * LOADER.stagger, 0, LOADER.loops * LOADER.cycle - 1e-6);
    const c = Math.floor(t / LOADER.cycle);
    const u = (t - c * LOADER.cycle) / LOADER.cycle;
    const k = clump(c);
    const cd = k.dots[i];

    // leave from this cycle's seat, land on next cycle's seat
    const [rA, aA] = ringPolar(k.perm[i]);
    const [rB, aB] = ringPolar(clump(c + 1).perm[i]);
    // every dot swirls the SAME way (never backwards), turns at least `twist` rad,
    // and lands exactly on its next seat → no jump between cycles
    const TAU = Math.PI * 2;
    let dA = ((aB - aA) % TAU + TAU) % TAU;
    if (dA < LOADER.twist) dA += TAU;

    // ONE continuous gesture: the swirl never stops — slowest on the ring,
    // fastest while the dots pass through the centre. The centre is not a keyframe.
    // angular progress (Hermite): ~0.4 on the ring between breaths, fastest at the centre,
    // but it starts from rest on the first breath and settles to rest on the last one
    const v0 = c === 0 ? 0 : 0.4;
    const v1 = c === LOADER.loops - 1 ? 0 : 0.4;
    const s = v0 * (u * u * u - 2 * u * u + u) + (3 * u * u - 2 * u * u * u) + v1 * (u * u * u - u * u);
    const m = 0.5 - 0.5 * Math.cos(TAU * u);             // how gathered, smooth across cycles (no bounce)

    const ringR = rA + (rB - rA) * (u * u * (3 - 2 * u));
    const r = ringR * (1 - (1 - cd.r) * m);
    const a = aA + dA * s + (cd.a + 0.35 * Math.sin(TAU * u + cd.ph)) * m;

    return [
      W / 2 + Math.cos(a) * r + k.drift[0] * m * m,
      H / 2 + Math.sin(a) * r + k.drift[1] * m * m
    ];
  }

  // loader done: the same dots spread out to their screen-1 spots
  function spreadAll() {
    sim.spreadAt = sim.now;
    show('home');
    sim.dots.forEach((p, i) => {
      Object.assign(p, { mode: 'tween', ease: 'soft', fx: p.x, fy: p.y, t0: sim.now + i * 0.04, dur: 1.5 });
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

  // heading turns smoothly (layered slow sines) so paths curve in soft loops
  function steer(p, dt) {
    if (p.ph === undefined) p.ph = Math.random() * 100;
    const t = sim.now;
    p.th += (0.9 * Math.sin(t * 0.31 + p.ph) + 0.6 * Math.sin(t * 0.53 + p.ph * 1.7)) * dt;
  }

  // ease speed back under the cap instead of clipping it
  function softCap(p, max, dt) {
    const s = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (s <= max) return;
    const k = 1 - (1 - max / s) * Math.min(1, 4 * dt);
    p.vx *= k; p.vy *= k;
  }

  // the panel gives a little under each dot that lands on it, then springs back (slight overshoot)
  // kick = dip speed per landing (px/s), k = spring stiffness, damp = damping, max = deepest dip (px)
  const PANEL_BUMP = { kick: 120, k: 420, damp: 16, max: 8 };
  function panelTop() { return sim.panel.v + sim.bump.o; }
  function bumpPanel(strength) { sim.bump.v += PANEL_BUMP.kick * strength; }
  function stepBump(dt) {
    const b = sim.bump;
    b.v += (-PANEL_BUMP.k * b.o - PANEL_BUMP.damp * b.v) * dt;
    b.o = clamp(b.o + b.v * dt, -PANEL_BUMP.max, PANEL_BUMP.max);
  }

  // walls, and on the dashboard the panel is a solid floor (soft bounces)
  const BOUNCE = 0.6;
  function collide(p) {
    if (p.x < R) { p.x = R; if (p.vx < 0) p.vx = -p.vx * BOUNCE; }
    if (p.x > W - R) { p.x = W - R; if (p.vx > 0) p.vx = -p.vx * BOUNCE; }
    if (p.y < R) { p.y = R; if (p.vy < 0) p.vy = -p.vy * BOUNCE; }
    if (p.y > H - R) { p.y = H - R; if (p.vy > 0) p.vy = -p.vy * BOUNCE; }
    if (state.screen === 'dashboard' && p.y + R > panelTop()) {
      p.y = panelTop() - R;
      if (p.vy > 0) p.vy = -p.vy * BOUNCE;
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
          const rel = 0.8 * ((b.vx - a.vx) * nx + (b.vy - a.vy) * ny);   // soft equal-mass bounce
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
    stepBump(dt);

    // panel settled on the dashboard: the dots keep drifting where it left them
    // (dots under gravity stay resting on the panel)
    if (layout === 'dashboard' && panelWasMoving && !sim.panel.tw) {
      sim.dots.forEach((p) => { if (p.mode !== 'grav') { p.mode = 'drift'; p.hx = p.x; p.hy = p.y; } });
    }

    const drift = layout === 'map' ? MAP_DRIFT : DRIFT;

    sim.dots.forEach((p, i) => {
      if (p.follow) [p.hx, p.hy] = p.follow();       // moving target (e.g. the quiz circle)
      const target = p.hx !== undefined ? [p.hx, p.hy] : home(i, layout);

      if (p.mode === 'load') {
        const lp = loaderPos(i);
        p.x = lp[0]; p.y = lp[1];
      } else if (p.mode === 'grav') {
        // fall, bounce softly on the panel, and slide sideways into the slot → one flat row
        p.vx += (p.sx - p.x) * GRAVITY.slide * dt;
        p.vx *= 1 - GRAVITY.friction * dt;
        p.x += p.vx * dt;
        const floor = panelTop() - R;
        if (!p.onBar) {
          // falling freely until the bar reaches it (or it lands on the bar)
          p.vy += GRAVITY.g * dt;
          p.y += p.vy * dt;
          if (p.y >= floor) {
            // contact: a small hop measured from the bar (not thrown by the bar's speed)
            p.onBar = true;
            p.h = 0;
            p.hv = GRAVITY.hop * (0.75 + Math.random() * 0.5);
            bumpPanel(1);                            // the panel gives under the impact
          }
        } else {
          // height above the bar: hop, fall back, bounce smaller, rest — riding the bar
          p.h = Math.max(0, floor - p.y);          // picks up any nudge from neighbours
          p.hv -= GRAVITY.g * dt;
          p.h += p.hv * dt;
          if (p.h <= 0) {
            p.h = 0;
            if (p.hv < -GRAVITY.rest) bumpPanel(-p.hv / GRAVITY.hop * 0.6);   // smaller landings, smaller dips
            p.hv = -p.hv * BOUNCE;
            if (p.hv < GRAVITY.rest) p.hv = 0;      // at rest: no micro-bounce
          }
          p.y = floor - p.h;
          p.vy = 0;
        }
        collide(p);
      } else if (p.mode === 'free') {
        // float in place while the panel pushes them
        steer(p, dt);
        p.vx = p.vx * (1 - 2 * dt) + Math.cos(p.th) * DRIFT.force * dt;
        p.vy = p.vy * (1 - 2 * dt) + Math.sin(p.th) * DRIFT.force * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        collide(p);
      } else if (p.mode === 'tween') {
        const k = clamp((sim.now - p.t0) / p.dur, 0, 1);
        const e = p.ease === 'out' ? easeOut(k) : p.ease === 'soft' ? easeSoft(k) : ease(k);
        p.x = p.fx + (target[0] - p.fx) * e;
        p.y = p.fy + (target[1] - p.fy) * e;
        if (k >= 1) { p.mode = 'drift'; p.vx = 0; p.vy = 0; }
      } else {
        // slow, never-still drift around the home spot
        steer(p, dt);
        p.vx += (Math.cos(p.th) * drift.force + (target[0] - p.x) * drift.spring) * dt;
        p.vy += (Math.sin(p.th) * drift.force + (target[1] - p.y) * drift.spring) * dt;
        p.vx *= 1 - 0.4 * dt; p.vy *= 1 - 0.4 * dt;   // light damping: no sudden pulls
        softCap(p, drift.max, dt);
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

  /* Quiz circle: mirrors the chosen answer as a 6 s loop — awake (floats) ↔ asleep (rests in the centre).
     The float itself never restarts: it is one continuous drift whose size is scaled by an
     "awake level" (0 = resting in the centre, 1 = full float). That level always glides toward its
     target through a soft critically-damped spring, and the drift tempo / softness also ease between
     answers — so falling asleep, waking up, changing the answer or the question never snap.
     Per answer ("motion" in content.json, null = the circle settles and stays still):
       awake    [min, max] s of floating per loop (at least minAwake)
       wake     true = rests first and floats at the END of the loop (waking up); default = floats first
       speed    drift tempo (higher = livelier)          — number or [min, max] re-rolled every loop
       soft     how quickly it wakes / settles (higher = quicker, still eased) — number or [min, max]
       hesitate 0..1, the float falters: half wakes, sinks back, picks up again — number or [min, max]
     Stress answers use a variable cycle instead of the 6 s loop:
       calm     [min, max] s resting in the centre, then
       burst    [min, max] s of quick, nervous movement — both re-rolled every cycle
       jitter   0..1 extra high-frequency shake during the burst
       size     0..1 share of the float area used (default 1)
     "Switching off" answers swing back and forth, then try to recentre:
       swing      [min, max] s of going left ↔ right (sometimes up ↔ down)
       period     s between two turns of the swing
       difficulty 0..1 how hard the recentring is: 0 = direct (eased), higher = it overshoots,
                  wobbles and drifts back out a few times before it settles
       rest       [min, max] s resting in the centre before the next swing
     The swing runs on its own spring that sits in the centre when unused, added to the float —
     switching between answers never snaps. */
  // defaults: loop = full cycle (s), minAwake = shortest float (s), amp = float size (px),
  // soft / speed = used when the answer does not set its own
  const ORB = { loop: 6, minAwake: 1.5, amp: 60, soft: 2, speed: 0.45 };
  // the circle is never perfectly still: a tiny, slow sway is always added on top
  // (resting, asleep, no answer, "rather not answer"). amp = px, speed = tempo
  const ORB_IDLE = { amp: 5, speed: 0.35 };
  const orb = { key: null, motion: null, t0: 0, awake: 0, level: 0, lv: 0, prev: null, pos: [0, 0],
                clock: 0, speed: ORB.speed, soft: ORB.soft, jitter: 0, size: 1, calm: 0, burst: 0,
                goal: { speed: ORB.speed, soft: ORB.soft, hesitate: 0, jitter: 0, size: 1 },
                ph: [0, 1, 2, 3, 4].map(() => Math.random() * Math.PI * 2),
                sw: { x: 0, y: 0, vx: 0, vy: 0 }, swing: 0, diff: 0, rest: 0, period: 0.7, swAmp: 0.55,
                seq: [], relapses: [] };

  const roll = (v, d) => (v === undefined ? d : Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v);

  function orbNewLoop(t0) {
    const m = orb.motion;
    orb.t0 = t0;
    orb.awake = clamp(roll(m.awake, ORB.minAwake), ORB.minAwake, ORB.loop);
    orb.calm = roll(m.calm, 0);
    orb.burst = roll(m.burst, 0);
    if (m.swing) {
      orb.swing = roll(m.swing, 2);
      orb.diff = clamp(roll(m.difficulty, 0), 0, 1);
      orb.rest = roll(m.rest, 1);
      orb.period = roll(m.period, 0.7);
      orb.swAmp = roll(m.size, 0.55);
      orb.recentre = 0.9 + 2.6 * orb.diff;           // the harder, the longer it takes
      orb.seq = [];
      // relapses: while recentring it drifts back out, a little less each time
      const n = Math.round(3 * orb.diff);
      orb.relapses = Array.from({ length: n }, (_, j) => {
        const a = Math.random() * Math.PI * 2;
        const r = 0.55 - 0.12 * j;
        return { t: ((j + 0.5) / (n + 0.5)) * orb.recentre * 0.75, dur: 0.4 + 0.2 * orb.diff,
                 x: Math.cos(a) * r, y: Math.sin(a) * r };
      });
    }
    orb.goal = { speed: roll(m.speed, ORB.speed), soft: roll(m.soft, ORB.soft), hesitate: roll(m.hesitate, 0),
                 jitter: roll(m.jitter, 0), size: roll(m.size, 1) };
  }

  // set from renderQuiz: a new answer / question only changes the targets, the motion carries on
  function orbFor(motion, key) {
    if (key === orb.key) return;
    orb.key = key;
    orb.motion = motion || null;
    if (orb.motion) orbNewLoop(sim.now);
    else orb.goal = { speed: orb.goal.speed, soft: ORB.soft, hesitate: 0, jitter: 0, size: orb.goal.size };
  }

  // the drift: layered sines on its own clock (advanced by the eased tempo → never jumps)
  // jitter adds a fast, nervous layer on top (stress)
  function orbDrift(c) {
    const p = orb.ph;
    const j = orb.jitter;
    return [
      0.6 * Math.sin(c * 2.1 + p[0]) + 0.4 * Math.sin(c * 3.3 + p[1]) +
        j * (0.35 * Math.sin(c * 7.3 + p[2]) + 0.25 * Math.sin(c * 11.9 + p[3])),
      0.6 * Math.sin(c * 1.7 + p[2]) + 0.4 * Math.sin(c * 2.9 + p[3]) +
        j * (0.35 * Math.sin(c * 8.1 + p[0]) + 0.25 * Math.sin(c * 12.7 + p[1]))
    ];
  }

  function drawOrb() {
    const dt = orb.prev === null ? 0 : Math.min(0.05, sim.now - orb.prev);
    orb.prev = sim.now;

    // tempo and softness glide toward this loop's values (no sudden change of pace;
    // quicker for stress answers so the shake can pick up fast — still eased)
    const stress = !!(orb.motion && orb.motion.calm);
    const swinging = !!(orb.motion && orb.motion.swing);
    const g = Math.min(1, dt * (stress ? 6 : 1.2));
    orb.speed += (orb.goal.speed - orb.speed) * g;
    orb.soft += (orb.goal.soft - orb.soft) * g;
    orb.jitter += (orb.goal.jitter - orb.jitter) * g;
    orb.size += (orb.goal.size - orb.size) * g;
    orb.clock += orb.speed * dt;

    let target = 0;                                            // asleep / no answer / stop
    if (orb.motion) {
      const cycle = () => (swinging ? orb.swing + orb.recentre + orb.rest
        : stress ? orb.calm + orb.burst : ORB.loop);
      while (sim.now - orb.t0 >= cycle()) orbNewLoop(orb.t0 + cycle());
      const t = sim.now - orb.t0;
      const awake = swinging ? false                           // swing: handled by its own spring
        : stress ? t >= orb.calm                               // stress: calm, then a burst
        : orb.motion.wake ? t >= ORB.loop - orb.awake : t < orb.awake;
      if (awake) {
        // hesitation: the wish to float wavers slowly (smoothed by the spring below → no jolts)
        const hz = orb.goal.hesitate;
        const waver = 0.5 + 0.5 * Math.sin(sim.now * 1.4 + orb.ph[4]);
        target = 1 - hz * 0.75 * waver;
      }
    }
    // critically-damped spring: starts gently, arrives gently, no overshoot
    const w = orb.soft;
    orb.lv += (w * w * (target - orb.level) - 2 * w * orb.lv) * dt;
    orb.level = clamp(orb.level + orb.lv * dt, 0, 1);

    // swing spring: target = the current side while swinging, the centre otherwise
    let sx = 0;
    let sy = 0;
    let sw = 4;                                               // stiffness
    let sz = 1;                                               // damping ratio (1 = no overshoot)
    if (swinging) {
      const t = sim.now - orb.t0;
      const A = ORB.amp * orb.swAmp;
      if (t < orb.swing) {
        const k = Math.floor(t / orb.period);
        for (let n = orb.seq.length; n <= k; n++) {
          const prev = orb.seq[n - 1];
          if (n % 2 === 1 && prev) {
            orb.seq.push([-prev[0], -prev[1]]);               // back to the opposite side
          } else {
            const side = Math.random() < 0.5 ? 1 : -1;
            const across = (Math.random() - 0.5) * 0.4;
            orb.seq.push(Math.random() < 0.7 ? [side, across] : [across, side]);   // mostly left ↔ right
          }
        }
        [sx, sy] = [orb.seq[k][0] * A, orb.seq[k][1] * A];
        sw = 7;
      } else {
        // recentring: easy = direct and eased; hard = softer, overshoots, drifts back out
        const tr = t - orb.swing;
        const rel = orb.relapses.find((r) => tr >= r.t && tr < r.t + r.dur);
        if (rel) { sx = rel.x * A; sy = rel.y * A; }
        sw = 4.5 - 1.8 * orb.diff;
        sz = 1 - 0.6 * orb.diff;
      }
    }
    const S = orb.sw;
    S.vx += (sw * sw * (sx - S.x) - 2 * sz * sw * S.vx) * dt;
    S.vy += (sw * sw * (sy - S.y) - 2 * sz * sw * S.vy) * dt;
    S.x += S.vx * dt; S.y += S.vy * dt;

    const [dx, dy] = orbDrift(orb.clock);
    const k = ORB.amp * orb.size * orb.level;
    // idle sway: its own slow clock, so it stays calm whatever the answer's tempo
    const ic = sim.now * ORB_IDLE.speed;
    const ix = ORB_IDLE.amp * (0.7 * Math.sin(ic * 1.3 + orb.ph[1]) + 0.3 * Math.sin(ic * 2.3 + orb.ph[3]));
    const iy = ORB_IDLE.amp * (0.7 * Math.sin(ic * 1.1 + orb.ph[0]) + 0.3 * Math.sin(ic * 1.9 + orb.ph[2]));
    const x = dx * k + S.x + ix;
    const y = dy * k + S.y + iy;
    orb.pos = [x, y];
    $('quizOrb').style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)';
  }

  function draw() {
    if (state.screen === 'quiz') drawOrb();
    sim.dots.forEach((p, i) => {
      dotNodes[i].style.transform = 'translate(' + (p.x - R).toFixed(2) + 'px,' + (p.y - R).toFixed(2) + 'px)';
      // colour comes in right after the loader ends, as the dots start to spread
      if (!p.lit && sim.loaded) {
        p.lit = true;
        dotNodes[i].classList.add('is-lit');
      }
    });
    $('hello').style.top = sim.hello.v.toFixed(2) + 'px';
    $('panel').style.top = panelTop().toFixed(2) + 'px';

    // text and header appear once the dots have finished spreading
    const introDone = sim.loaded && sim.spreadAt !== null && sim.now > sim.spreadAt + 1.7;
    app.classList.toggle('is-intro-done', introDone);

    // the Flight Reset card is a notification: it only arrives once Flight Reset has been bought,
    // the first time the dashboard panel settles after the order
    const tripOwned = !!state.owned.flight;
    if (tripOwned && state.screen === 'dashboard' && !sim.panel.tw) sim.tripSeen = true;
    const tripCard = $('tripCard');
    const shown = tripOwned && sim.tripSeen;
    if (shown && !tripCard.classList.contains('is-shown')) emptyPie(tripPie, 0.4);
    tripCard.classList.toggle('is-shown', shown);
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
    const title = state.screen === 'quiz' ? clusterById(state.quiz).label
                : state.screen === 'cluster' ? clusterById(state.cluster).label
                : SCREEN_TITLE[state.screen] || '';
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
      // opening: nearest first; closing: the exact reverse (farthest first), same rhythm
      items[i].style.setProperty('--delay', (state.menuOpen ? (k - 1) * 50 : (items.length - k) * 50) + 'ms');
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

  // the segments are kept between renders so a newly reached step can fill in (animated in CSS)
  function progress(node, total, current, color, track) {
    if (node.children.length !== total) {
      node.textContent = '';
      for (let n = 0; n < total; n++) node.appendChild(el('span', 'progress__segment'));
    }
    Array.from(node.children).forEach((seg, n) => seg.classList.toggle('is-done', n <= current));
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
    const answer = state.answers[state.qi];
    options($('quizOptions'), q.options, answer, pickAnswer);
    orbFor(answer !== undefined && q.motion ? q.motion[answer] : null, state.quiz + '/' + state.qi + '/' + answer);
    const next = $('quizNext');
    // staging order for the reveal (top → bottom, --i) and the exit (bottom → top, --o)
    const stage = [$('quizProgress'), $('quizQuestion')].concat(Array.from($('quizOptions').children), [next]);
    stage.forEach((n, k) => {
      n.classList.add('q-stage');
      n.style.setProperty('--i', k);
      n.style.setProperty('--o', stage.length - 1 - k);
    });
    next.disabled = state.answers[state.qi] === undefined;
    next.textContent = state.qi < quiz.length - 1 ? 'Next' : 'Done';
  }

  function renderTravel() {
    const t = C.events.travel;
    const step = state.travelStep;
    const body = $('travelBody');
    progress($('travelProgress'), 2, Math.min(step, 1), 'var(--violet-strong)', 'var(--track)');
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

  // remaining time as a pie (camembert): the coloured slice is what is left of the routine.
  // It empties clockwise from full down to its value each time the dashboard appears.
  const PIE = { dur: 1.4, delay: 0.5 };
  const pies = [];

  // dashboard cards: black time pies, with the days left written next to them (e.g. "24d")
  const PIE_COLOR = '#000000';
  const daysLeft = (n) => el('span', 'routine__days', n + 'd');
  // optional product photo, bottom left, cropped by the card's edges (set "image" in content.json)
  function productImage(src) {
    const img = el('img', 'routine__img');
    img.src = src;
    img.alt = '';
    img.onerror = () => img.remove();              // missing file: the card simply has no photo
    return img;
  }

  function timePie(left, total, color) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('class', 'routine__pie');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('cx', 18); track.setAttribute('cy', 18); track.setAttribute('r', 18);
    track.setAttribute('class', 'routine__pie-track');
    const slice = document.createElementNS(NS, 'path');
    slice.style.fill = color;
    svg.append(track, slice);
    const pie = { slice: slice, value: clamp(left / total, 0, 1) };
    drawPie(pie, pie.value);
    pies.push(pie);
    return { svg: svg, pie: pie };
  }

  function drawPie(pie, f) {
    if (f >= 0.999) { pie.slice.setAttribute('d', 'M18 0 A18 18 0 1 1 17.99 0 Z'); return; }
    if (f <= 0) { pie.slice.setAttribute('d', ''); return; }
    const a = f * 2 * Math.PI;
    const x = 18 + 18 * Math.sin(a), y = 18 - 18 * Math.cos(a);
    pie.slice.setAttribute('d', 'M18 18 L18 0 A18 18 0 ' + (f > 0.5 ? 1 : 0) + ' 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Z');
  }

  function emptyPie(pie, delay) {
    const t0 = performance.now() + delay * 1000;
    pie.run = t0;
    drawPie(pie, 1);
    const step = (t) => {
      if (pie.run !== t0) return;                  // a newer animation took over
      const k = clamp((t - t0) / (PIE.dur * 1000), 0, 1);
      drawPie(pie, 1 - (1 - pie.value) * easeOut(k));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderProducts() {
    const list = $('protocolList');
    const cards = state.screen === 'product' ? [state.product] : buildProtocol();
    list.textContent = '';

    cards.forEach((c) => {
      const card = el('article', 'product');
      card.style.setProperty('--card', c.color);
      card.append(el('h2', 'product__name', c.name), el('p', 'product__text', c.description));
      if (c.reason && state.screen === 'product') card.appendChild(el('p', 'product__text', c.reason));

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
    C.safety.options.forEach((text, k) => {
      const on = !!state.safety[k];
      const b = el('button', 'option' + (on ? ' is-selected' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      b.append(el('span', 'option__dot'), el('span', 'option__text', text));
      b.addEventListener('click', () => pickSafety(k));
      list.appendChild(b);
    });
    const next = $('safetyNext');
    const screen = $('safety');
    const stage = [screen.querySelector('.progress'), screen.querySelector('.card--question')]
      .concat(Array.from(list.children), [next]);
    stage.forEach((n, k) => {
      n.classList.add('q-stage');
      n.style.setProperty('--i', k);
      n.style.setProperty('--o', stage.length - 1 - k);
    });
    next.disabled = Object.keys(state.safety).length === 0;
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
      b.addEventListener('click', () => {
        if (state.screen !== 'map') return;
        if (canOpenCluster(cl.id)) openCluster(cl.id);
        else if (C.quizzes[cl.id]) openQuiz(cl.id);
      });
      dots.appendChild(b);
      dotNodes.push(b);
    });
    scatterHome();
    sim.dots = C.clusters.map(() => ({ x: W / 2, y: H / 2, vx: 0, vy: 0, mode: 'load', th: Math.random() * Math.PI * 2 }));

    // dashboard routines
    const routines = $('routines');
    C.routines.forEach((r) => {
      const b = el('button', 'routine', C.products[r.product].name);   // same name as the page it opens
      b.type = 'button';
      b.style.setProperty('--card', clusterById(r.cluster).color);   // same colour as its circle
      if (r.image) b.appendChild(productImage(r.image));
      b.append(timePie(r.count, r.total, PIE_COLOR).svg, daysLeft(r.count));
      b.addEventListener('click', () => openRoutine(r.product, r.reason, clusterById(r.cluster).color));
      routines.appendChild(b);
    });
    // the trip card fills the last free slot (bottom right) once the trip is added
    const trip = el('button', 'routine routine--trip');
    trip.type = 'button';
    trip.id = 'tripCard';
    routines.appendChild(trip);
    const tc = C.events.travel.dashboardCard;
    trip.textContent = C.products.flight.name;                         // same name as the page it opens
    trip.style.setProperty('--card', clusterById(tc.cluster).color);
    const tp = timePie(tc.count, tc.total, PIE_COLOR);
    if (tc.image) trip.appendChild(productImage(tc.image));
    trip.append(tp.svg, daysLeft(tc.count));
    tripPie = tp.pie;
    trip.addEventListener('click', () => openRoutine('flight', C.tripRoutineReason, clusterById(tc.cluster).color));

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
    $('quizNext').addEventListener('click', nextQuestion);
    $('logo').addEventListener('click', () => { if (state.screen === 'dashboard') goTo('home'); });
    $('badge').addEventListener('click', () => show('basket', { menuOpen: false }));
    $('accessProtocol').addEventListener('click', () => show('protocol', { menuOpen: false, openRows: {} }));
    $('addEvent').addEventListener('click', () => { state.menuOpen = !state.menuOpen; render(); });
    $('addToBasket').addEventListener('click', addToBasket);
    $('buy').addEventListener('click', openSafety);
    $('safetyNext').addEventListener('click', confirmSafety);

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

  // desktop: shrink the 390 × 844 screen only if the window is too small (grey page around it).
  // mobile: scale it up or down to fill the phone (the space left around it is the app background).
  const MOBILE = window.matchMedia('(max-width: 600px), (pointer: coarse) and (max-width: 1024px)');
  function fit() {
    const fill = Math.min(window.innerWidth / W, window.innerHeight / H);
    const s = MOBILE.matches ? fill : Math.min(1, fill);
    app.style.transform = s !== 1 ? 'scale(' + s + ')' : '';
  }
  MOBILE.addEventListener('change', fit);

  /* ------------------------------------------------------------------------
     Start
     ---------------------------------------------------------------------- */

  fit();
  window.addEventListener('resize', fit);

  fetch('data/content.json')
    .then((r) => r.json())
    .then((content) => {
      C = content;
      // a product linked to a cluster ("cluster" in content.json) wears that circle's colour everywhere
      Object.values(C.products).forEach((pr) => {
        const cl = pr.cluster && C.clusters.find((c) => c.id === pr.cluster);
        if (cl) pr.color = cl.color;
      });
      build();
      render();
      loop();
    })
    .catch(() => { $('loadError').hidden = false; });
})();
