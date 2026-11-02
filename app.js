/* Fit — plan nutricional. Todo corre en el teléfono; los datos se guardan en localStorage. */
'use strict';

// ---------------- Almacenamiento ----------------
const KEY = 'fit.v1';
const store = {
  load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* sin almacenamiento disponible */ }
  },
};
const FRESH = () => ({ profile: null, menu: null, shop: {}, progress: [], favs: [], ai: null, aiPlan: null, aiRecipes: [], chat: [], menuSource: 'fit' });
let S = Object.assign(FRESH(), store.load());

// ---------------- Utilidades ----------------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = (x) => Math.round(x);
const r5 = (x) => Math.round(x / 5) * 5;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAYS_S = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const todayIdx = () => (new Date().getDay() + 6) % 7;
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function nutr(ings) {
  const t = { k: 0, p: 0, c: 0, f: 0, fi: 0 };
  for (const it of ings) {
    const id = it.id || it[0]; const g = it.g ?? it[1]; const x = FOODS[id]; if (!x) continue;
    const m = g / 100; t.k += x.k * m; t.p += x.p * m; t.c += x.c * m; t.f += x.f * m; t.fi += x.fi * m;
  }
  return t;
}

// ---------------- Cálculos nutricionales ----------------
const JOB = { sentado: 1.25, mixto: 1.4, pie: 1.55, fisico: 1.75 };
// MET netos (MET de la actividad - 1, el reposo ya está en el metabolismo basal)
const CARDIO_MET = { caminar: 2.5, mixto: 4, correr: 7, bici: 5, deporte: 5, nadar: 5 };
const HEALTH = {
  diabetes: 'Diabetes / resistencia a la insulina / SOP', tiroides: 'Tiroides', hta: 'Hipertensión',
  colesterol: 'Colesterol o triglicéridos altos', digestivo: 'Gastritis, reflujo o colon irritable',
  renal: 'Enfermedad renal', embarazo: 'Embarazo o lactancia', tca: 'Trastorno de la conducta alimentaria (actual o pasado)',
};
const GOALS = { grasa: 'Perder grasa', musculo: 'Ganar masa muscular', salud: 'Mejorar salud', rendimiento: 'Rendimiento deportivo', mantener: 'Mantener peso' };

function navyBF(P) {
  const h = +P.height, w = +P.waist, n = +P.neck, hip = +P.hip;
  if (!h || !w || !n) return null;
  let v;
  if (P.sex === 'M') { if (w - n <= 0) return null; v = 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450; }
  else { if (!hip || w + hip - n <= 0) return null; v = 495 / (1.29579 - 0.35004 * Math.log10(w + hip - n) + 0.221 * Math.log10(h)) - 450; }
  return v > 2 && v < 70 ? v : null;
}

const SLOT_SETS = {
  3: [['desayuno', 'Desayuno', 25, 'desayuno'], ['almuerzo', 'Almuerzo', 40, 'principal'], ['cena', 'Cena', 35, 'principal']],
  4: [['desayuno', 'Desayuno', 20, 'desayuno'], ['almuerzo', 'Almuerzo', 35, 'principal'], ['merienda', 'Merienda', 15, 'desayuno'], ['cena', 'Cena', 30, 'principal']],
  5: [['desayuno', 'Desayuno', 20, 'desayuno'], ['colacion', 'Colación', 10, 'colacion'], ['almuerzo', 'Almuerzo', 30, 'principal'], ['merienda', 'Merienda', 15, 'desayuno'], ['cena', 'Cena', 25, 'principal']],
  6: [['desayuno', 'Desayuno', 18, 'desayuno'], ['colacion', 'Colación', 8, 'colacion'], ['almuerzo', 'Almuerzo', 27, 'principal'], ['merienda', 'Merienda', 15, 'desayuno'], ['colacion2', 'Colación tarde', 7, 'colacion'], ['cena', 'Cena', 25, 'principal']],
};

function calc(P) {
  const notes = [];
  const w = +P.weight, h = +P.height, a = +P.age, M = P.sex === 'M';
  const health = P.health || [];
  const bmi = w / (h / 100) ** 2;
  let bf = P.bfKnown ? +P.bfKnown : navyBF(P);
  const bfSrc = P.bfKnown ? 'informado por vos' : bf ? 'estimado (método Marina EE.UU., ±3–4 %)' : null;
  const lbm = bf ? w * (1 - bf / 100) : null;
  const bmr = 10 * w + 6.25 * h - 5 * a + (M ? 5 : -161); // Mifflin-St Jeor
  const katch = lbm ? 370 + 21.6 * lbm : null;
  const pal = JOB[P.job] || 1.25;
  const exWeek = ((+P.strDays || 0) * (+P.strMin || 0) / 60 * 3.5 + (+P.cardDays || 0) * (+P.cardMin || 0) / 60 * (CARDIO_MET[P.cardType] || 4)) * w;
  const exDay = exWeek / 7;
  const tdee = bmr * pal + exDay;

  const goals = P.goals || [];
  let mode = 'maint';
  if (goals.includes('grasa') && goals.includes('musculo')) mode = P.priority === 'grasa' ? 'cut' : P.priority === 'musculo' ? 'bulk' : 'recomp';
  else if (goals.includes('grasa')) mode = 'cut';
  else if (goals.includes('musculo')) mode = 'bulk';
  if (health.includes('embarazo') || health.includes('tca')) mode = 'maint';
  const ADJ = { cut: { lento: -0.1, moderado: -0.17, agresivo: -0.25 }, recomp: { lento: -0.05, moderado: -0.1, agresivo: -0.15 }, bulk: { lento: 0.05, moderado: 0.1, agresivo: 0.15 }, maint: { lento: 0, moderado: 0, agresivo: 0 } };
  const adj = ADJ[mode][P.pace || 'moderado'];
  let kcal = tdee * (1 + adj);
  const floor = Math.max(bmr, M ? 1500 : 1200);
  if (kcal < floor) { kcal = floor; notes.push({ t: 'warn', m: 'El déficit calculado quedaba por debajo de tu metabolismo basal; se fijó un piso para cuidar tu masa muscular y tu energía.' }); }
  kcal = Math.round(kcal / 10) * 10;

  const PROT = { cut: 2.0, recomp: 1.8, bulk: 1.8, maint: 1.6 };
  let pkg = PROT[mode];
  if (goals.includes('rendimiento')) pkg = Math.max(pkg, 1.6);
  const refW = bmi >= 30 ? 25 * (h / 100) ** 2 : w; // con obesidad se usa un peso ajustado
  if (health.includes('renal')) { pkg = 0.8; notes.push({ t: 'warn', m: 'Con enfermedad renal la proteína se limitó a 0,8 g/kg. Este plan debe ajustarlo tu nefrólogo/a o nutricionista.' }); }
  const p = Math.round(pkg * refW);
  const f = Math.round(Math.max((kcal * 0.28) / 9, 0.6 * w));
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  const fib = Math.round((kcal / 1000) * 14);
  const water = Math.round((w * 35 + ((+P.strDays || 0) * (+P.strMin || 0) + (+P.cardDays || 0) * (+P.cardMin || 0)) / 7 * 8) / 100) / 10;

  const MODE_TXT = { cut: 'Pérdida de grasa', recomp: 'Recomposición corporal', bulk: 'Ganancia muscular', maint: 'Mantenimiento' };
  if (mode === 'recomp' && P.experience === 'adv') notes.push({ t: 'info', m: 'Con más de 2 años de entrenamiento la recomposición es lenta. Si en 8–10 semanas no ves cambios, conviene elegir una prioridad (definir o ganar).' });
  if (mode === 'recomp' && P.experience === 'nov') notes.push({ t: 'ok', m: 'Siendo principiante en fuerza estás en la mejor etapa para recomponer: con proteína alta y progresión en el gimnasio se puede ganar músculo con un déficit leve.' });
  if (mode === 'bulk' && bf && bf > (M ? 22 : 32)) notes.push({ t: 'info', m: 'Tu % de grasa estimado es alto para un superávit. Considerá recomposición o definición primero.' });
  if (health.includes('embarazo')) notes.push({ t: 'warn', m: 'En embarazo o lactancia no se aplica déficit. Este plan es solo orientativo: seguí las indicaciones de tu obstetra y nutricionista.' });
  if (health.includes('tca')) notes.push({ t: 'warn', m: 'Con antecedentes de TCA no se recomienda contar calorías sin acompañamiento profesional. El plan queda en mantenimiento y es solo orientativo.' });
  if (health.includes('diabetes')) notes.push({ t: 'warn', m: 'Con diabetes o resistencia a la insulina, priorizá carbohidratos integrales y legumbres, y validá el plan con tu médico/a (sobre todo si usás insulina o hipoglucemiantes).' });
  if (health.includes('hta')) notes.push({ t: 'info', m: 'Hipertensión: limitá fiambres, quesos duros, snacks y caldos en cubo; usá hierbas y limón para condimentar.' });
  if (health.includes('colesterol')) notes.push({ t: 'info', m: 'Colesterol/triglicéridos: priorizá pescado 2 veces por semana, aceite de oliva, frutos secos, avena y legumbres; limitá cortes grasos y embutidos.' });
  if (health.includes('tiroides')) notes.push({ t: 'info', m: 'Tiroides: si tomás levotiroxina, tomala en ayunas y esperá 30–60 min para desayunar (el mate y el café también interfieren).' });
  if (a < 18) notes.push({ t: 'warn', m: 'Las fórmulas están pensadas para adultos. En menores de 18 el plan debe hacerlo un profesional.' });
  const waistR = P.waist ? +P.waist / h : null;
  if (P.waist) {
    const hi = M ? 102 : 88, mid = M ? 94 : 80;
    if (+P.waist >= hi) notes.push({ t: 'warn', m: `Cintura de ${P.waist} cm: riesgo cardiometabólico aumentado (umbral OMS ${hi} cm). Bajar cintura es un buen indicador de progreso.` });
    else if (+P.waist >= mid) notes.push({ t: 'info', m: `Cintura de ${P.waist} cm: por encima del primer umbral de riesgo de la OMS (${mid} cm). Es la medida que más conviene seguir en el tiempo.` });
  }

  let slots = (SLOT_SETS[P.meals] || SLOT_SETS[4]).map(([key, name, pct, type]) => ({
    key, name, pct, type, k: kcal * pct / 100, p: p * pct / 100, c: c * pct / 100, f: f * pct / 100,
  }));
  // Compensación semanal: lo que las comidas especiales exceden se reparte entre las comidas normales
  // (se recortan carbohidratos y grasas, la proteína no se toca), para que el promedio semanal dé el objetivo.
  let excess = 0, regular = 0; const sp = P.specials || {};
  for (let d = 0; d < 7; d++) for (const s of slots) {
    const r = RECIPES.find((x) => x.id === sp[`${d}-${s.key}`]);
    if (r && !r.free) excess += nutr(r.ing).k - s.k; else if (!r) regular += s.k;
  }
  const rawWf = regular ? 1 - excess / regular : 1;
  const wf = clamp(rawWf, 0.88, 1.05);
  if (Math.abs(wf - 1) > 0.005) {
    slots = slots.map((s) => {
      const delta = s.k * (1 - wf); const cf = s.c * 4 + s.f * 9 || 1;
      return { ...s, k: s.k * wf, c: Math.max(0, s.c - (delta * (s.c * 4 / cf)) / 4), f: Math.max(0, s.f - (delta * (s.f * 9 / cf)) / 9) };
    });
    if (wf < 1) notes.push({ t: 'info', m: `Tus comidas especiales del finde suman ≈ ${Math.round(excess)} kcal extra por semana. Para que el promedio semanal dé ${kcal} kcal, las comidas de los demás días tienen porciones un ${Math.round((1 - wf) * 100)} % más chicas (menos carbohidratos y grasas; la proteína no se toca).` });
    if (rawWf < 0.88) notes.push({ t: 'warn', m: 'Las comidas especiales elegidas superan lo que se puede compensar sin quedarte con hambre. Considerá sacar una o elegir porciones más chicas.' });
  }
  return { bmi, bf, bfSrc, lbm, bmr, katch, pal, exDay, tdee, mode, modeTxt: MODE_TXT[mode], adj, kcal, p, c, f, fib, water, pkg, waistR, slots, notes };
}

// ---------------- Recetas: filtrado y escalado ----------------
function recipeAllowed(r, P, slotType) {
  const ex = new Set(P.excluded || []);
  if (r.ing.some(([id]) => ex.has(id))) return false;
  if (slotType === 'desayuno' || slotType === 'colacion') {
    if (P.breakfast === 'salado' && !r.tags.includes('salado')) return false;
    if (P.breakfast === 'dulce' && !r.tags.includes('dulce')) return false;
  }
  return true;
}

function roundG(id, g, role) {
  const x = FOODS[id];
  if (role === 'x' || role === 'v') return g < 15 ? Math.max(1, Math.round(g)) : r5(g);
  if (x.u && x.u[1] >= 30 && ['huevo', 'clara', 'pan_frances'].includes(id)) return Math.max(x.u[1], Math.round(g / x.u[1]) * x.u[1]);
  if (x.u && x.u[1] >= 20 && x.u[1] < 30) return Math.max(x.u[1] / 2, Math.round(g / (x.u[1] / 2)) * (x.u[1] / 2));
  if (g < 15) return Math.max(1, Math.round(g));
  return r5(g);
}

function scaleRecipe(r, T) {
  if (r.fixed || !T) return r.ing.map(([id, g, role]) => ({ id, g, role }));
  const sub = (role) => nutr(r.ing.filter((i) => i[2] === role));
  const N = { p: sub('p'), c: sub('c'), f: sub('f'), x: nutr(r.ing.filter((i) => !'pcf'.includes(i[2]))) };
  const s = { p: 1, c: 1, f: 1 };
  for (let it = 0; it < 25; it++) {
    if (N.p.p > 0) s.p = clamp((T.p - N.x.p - s.c * N.c.p - s.f * N.f.p) / N.p.p, 0.4, 3);
    if (N.c.c > 0) s.c = clamp((T.c - N.x.c - s.p * N.p.c - s.f * N.f.c) / N.c.c, 0.3, 3);
    if (N.f.f > 0) s.f = clamp((T.f - N.x.f - s.p * N.p.f - s.c * N.c.f) / N.f.f, 0.25, 3);
  }
  const build = () => r.ing.map(([id, g, role]) => ({ id, g: roundG(id, g * (s[role] ?? 1), role), role }));
  // Al redondear (huevos enteros, rebanadas) las calorías se desvían: se corrige con carbohidratos y luego grasa.
  let out = build();
  for (const role of ['c', 'f', 'c']) {
    const n = nutr(out); const diff = T.k - n.k;
    if (Math.abs(diff) < T.k * 0.03) break;
    const rk = nutr(out.filter((i) => i.role === role)).k;
    if (rk > 0) { s[role] = clamp(s[role] * (1 + diff / rk), role === 'f' ? 0.25 : 0.3, 3); out = build(); }
  }
  return out;
}

function household(id, g) {
  const x = FOODS[id];
  const parts = [];
  if (x.u) {
    const n = g / x.u[1];
    const nr = n >= 3 ? Math.round(n) : Math.round(n * 2) / 2;
    if (nr > 0) parts.push(`≈ ${String(nr).replace('.', ',')} ${x.u[0]}${nr > 1 && !x.u[0].includes('(') && !x.u[0].includes(' ') ? (/[aeiou]$/.test(x.u[0]) ? 's' : 'es') : ''}`);
  }
  if (x.ck) parts.push(`≈ ${r5(g * x.ck)} g cocido`);
  return parts.join(' · ');
}

// ---------------- Menú semanal ----------------
function slotsOf(P) { return calc(P).slots; }

function poolFor(P, type) {
  let pool = RECIPES.filter((r) => r.type === type && recipeAllowed(r, P, type));
  if (!pool.length) pool = RECIPES.filter((r) => r.type === type); // sin opciones: no dejar vacío
  const favs = pool.filter((r) => S.favs.includes(r.id));
  return pool.concat(favs).map((r) => r.id);
}

function genMenu(P, seed = Date.now() % 1e9) {
  const rnd = rng(seed);
  const slots = slotsOf(P);
  const decks = {}; const pos = {};
  const draw = (type, avoid) => {
    if (!decks[type] || pos[type] >= decks[type].length) { decks[type] = shuffle(poolFor(P, type), rnd); pos[type] = 0; }
    let id = decks[type][pos[type]++];
    if (id === avoid && decks[type].length > 1) { id = decks[type][pos[type] % decks[type].length]; pos[type]++; }
    return id;
  };
  const days = [];
  let last = {};
  for (let d = 0; d < 7; d++) {
    const day = {};
    for (const s of slots) {
      const sp = (P.specials || {})[`${d}-${s.key}`];
      if (sp) { day[s.key] = sp; continue; }
      if (s.key === 'almuerzo' && P.vianda && d > 0) {
        const prev = days[d - 1].cena; const pr = RECIPES.find((r) => r.id === prev);
        if (pr && pr.type === 'principal') { day[s.key] = prev; continue; }
      }
      day[s.key] = draw(s.type, last[s.type]);
      last[s.type] = day[s.key];
    }
    days.push(day);
  }
  return { seed, slotKeys: slots.map((s) => s.key).join(','), days, created: Date.now() };
}

function ensureMenu() {
  const P = S.profile; if (!P) return;
  const keys = slotsOf(P).map((s) => s.key).join(',');
  if (!S.menu || S.menu.slotKeys !== keys) { S.menu = genMenu(P); S.shop = {}; store.save(); }
}

const R = (id) => RECIPES.find((r) => r.id === id);

function mealNutr(rid, slot) {
  const r = R(rid); if (!r) return null;
  if (r.free) return { k: slot.k, p: slot.p, c: slot.c, f: slot.f, free: true };
  return nutr(scaleRecipe(r, slot));
}

// ---------------- Render general ----------------
let TAB = 'plan';
let menuDay = todayIdx();
let recFilter = 'todas';
let recSearch = '';
let deferredInstall = null;

function render() {
  const view = $('#view');
  const nav = $('#nav');
  if (!S.profile) { nav.hidden = true; $('#btnProfile').hidden = true; view.innerHTML = viewProfile(true); bindProfile(true); return; }
  nav.hidden = false; $('#btnProfile').hidden = false;
  ensureMenu();
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === TAB));
  const V = { plan: viewPlan, menu: viewMenu, recetas: viewRecipes, compras: viewShop, progreso: viewProgress, chat: viewChat, perfil: () => viewProfile(false) };
  view.innerHTML = (V[TAB] || viewPlan)();
  if (TAB === 'perfil') bindProfile(false);
  if (render.last !== TAB) window.scrollTo(0, 0);
  render.last = TAB;
}

function macroBar(p, c, f) {
  const kp = p * 4, kc = c * 4, kf = f * 9, t = kp + kc + kf || 1;
  return `<div class="mbar" role="img" aria-label="Distribución de macronutrientes">
    <span class="mb-p" style="width:${(kp / t) * 100}%"></span><span class="mb-c" style="width:${(kc / t) * 100}%"></span><span class="mb-f" style="width:${(kf / t) * 100}%"></span></div>`;
}
const pctK = (g, kpg, k) => r0((g * kpg / k) * 100);

// ---------------- Vista: Plan ----------------
const VEG_REF = { k: 28, p: 1.4, c: 5.5, f: 0.2 };
const PLATE_PROT = ['pollo_pechuga', 'carne_magra', 'cerdo_lomo', 'merluza', 'atun', 'huevo'];
const PLATE_CARB = ['arroz', 'fideos', 'papa', 'batata', 'lentejas', 'quinoa', 'polenta', 'pan_frances'];
const PLATE_FAT = ['aceite', 'palta', 'nueces'];

function plate(slot, P) {
  const ex = new Set(P.excluded || []);
  const vegG = slot.pct >= 20 ? 250 : 150;
  const vp = VEG_REF.p * vegG / 100, vc = VEG_REF.c * vegG / 100, vf = VEG_REF.f * vegG / 100;
  const C = Math.max(0, slot.c - vc);
  const Pn = Math.max(0, slot.p - vp - 0.1 * C);
  const F = Math.max(0, slot.f - vf - 0.15 * Pn - 0.02 * C);
  const pick = (ids, need, macro) => ids.filter((id) => !ex.has(id)).map((id) => {
    const x = FOODS[id]; const g = need / (x[macro] / 100);
    return { id, g: g < 15 ? Math.round(g) : r5(g) };
  });
  const prot = pick(PLATE_PROT, Pn, 'p');
  const carb = pick(PLATE_CARB, C, 'c');
  const fat = pick(PLATE_FAT, F, 'f');
  // pesos de referencia del plato (cocido): pollo y arroz/papa
  const protCooked = r5(Pn / 0.225 * 0.75);
  const carbCooked = r5((C / 0.79 * 2.8 + C / 0.175) / 2);
  const fatG = Math.round(F);
  const total = vegG + protCooked + carbCooked + fatG;
  return { vegG, C, Pn, F, prot, carb, fat, protCooked, carbCooked, fatG, total };
}

function plateSVG() {
  // plato de Harvard: 1/2 verduras, 1/4 proteína, 1/4 carbohidratos
  return `<svg viewBox="0 0 120 120" class="plate" aria-hidden="true">
    <circle cx="60" cy="60" r="58" class="pl-rim"/>
    <path d="M60 60 L60 8 A52 52 0 0 0 60 112 Z" class="pl-v"/>
    <path d="M60 60 L60 8 A52 52 0 0 1 112 60 Z" class="pl-p"/>
    <path d="M60 60 L112 60 A52 52 0 0 1 60 112 Z" class="pl-c"/>
    <text x="33" y="63" class="pl-t">Verduras</text><text x="84" y="40" class="pl-t">Proteína</text><text x="84" y="86" class="pl-t">Carbos</text>
  </svg>`;
}

function exchanges(slot) {
  const h = (x) => String(Math.round(x * 2) / 2).replace('.', ',');
  return `<div class="xch"><span><b>${h(slot.p / 20)}</b> porc. proteína</span><span><b>${h(slot.c / 30)}</b> porc. carbos</span><span><b>${h(slot.f / 10)}</b> porc. grasa</span></div>`;
}

function viewPlan() {
  const P = S.profile; const X = calc(P);
  const k = X.kcal;
  const notes = X.notes.map((n) => `<div class="note ${n.t}">${esc(n.m)}</div>`).join('');
  const slotsHTML = X.slots.map((s) => {
    let body = '';
    if (s.type === 'principal') {
      const pl = plate(s, P);
      const li = (arr) => arr.map((o) => `<li><span>${esc(FOODS[o.id].n)}</span><b>${o.g} g</b>${household(o.id, o.g) ? `<small>${household(o.id, o.g)}</small>` : ''}</li>`).join('');
      const pw = (g) => r0((g / pl.total) * 100);
      body = `<div class="platewrap">${plateSVG()}
        <table class="ptab"><tr><th>Grupo</th><th>Peso</th><th>% plato</th></tr>
          <tr><td><i class="dot v"></i>Verduras</td><td>${pl.vegG} g</td><td>${pw(pl.vegG)} %</td></tr>
          <tr><td><i class="dot p"></i>Proteína (cocida)</td><td>≈ ${pl.protCooked} g</td><td>${pw(pl.protCooked)} %</td></tr>
          <tr><td><i class="dot c"></i>Carbos (cocidos)</td><td>≈ ${pl.carbCooked} g</td><td>${pw(pl.carbCooked)} %</td></tr>
          <tr><td><i class="dot f"></i>Grasa agregada</td><td>${pl.fatG} g</td><td>${pw(pl.fatG)} %</td></tr>
          <tr class="tot"><td>Plato total</td><td>≈ ${pl.total} g</td><td>100 %</td></tr></table></div>
        <p class="hint">Elegí <b>una</b> opción de cada grupo (pesos en crudo). Verduras: mezclá las que quieras hasta ${pl.vegG} g (≈ medio plato).</p>
        <details><summary>Proteína: ${r0(pl.Pn)} g → opciones</summary><ul class="opts">${li(pl.prot)}</ul></details>
        <details><summary>Carbohidratos: ${r0(pl.C)} g → opciones</summary><ul class="opts">${li(pl.carb)}</ul></details>
        <details><summary>Grasa: ${r0(pl.F)} g → opciones</summary><ul class="opts">${li(pl.fat)}</ul></details>`;
    } else {
      const ideas = RECIPES.filter((r) => r.type === s.type && recipeAllowed(r, P, s.type)).slice(0, 3);
      body = `${exchanges(s)}<p class="hint">Ideas: ${ideas.map((r) => `<a href="#" data-recipe="${r.id}" data-slot="${s.key}">${esc(r.n)}</a>`).join(' · ')}</p>`;
    }
    return `<section class="card meal">
      <header><h3>${esc(s.name)}</h3><span class="pill">${s.pct} %</span></header>
      <div class="mrow"><b>${r0(s.k)} kcal</b><span class="p">P ${r0(s.p)} g</span><span class="c">C ${r0(s.c)} g</span><span class="f">G ${r0(s.f)} g</span></div>
      ${body}</section>`;
  }).join('');

  return `
  <section class="card hero">
    <p class="eyebrow">${esc(X.modeTxt)}${P.name ? ' · ' + esc(P.name) : ''}</p>
    <div class="big">${k.toLocaleString('es-AR')}<small> kcal/día</small></div>
    ${macroBar(X.p, X.c, X.f)}
    <div class="macros">
      <div class="p"><b>${X.p} g</b><span>Proteínas<br>${pctK(X.p, 4, k)} % kcal</span></div>
      <div class="c"><b>${X.c} g</b><span>Carbos<br>${pctK(X.c, 4, k)} % kcal</span></div>
      <div class="f"><b>${X.f} g</b><span>Grasas<br>${pctK(X.f, 9, k)} % kcal</span></div>
    </div>
    <div class="minis"><span>Fibra ≥ ${X.fib} g</span><span>Agua ≈ ${String(X.water).replace('.', ',')} L</span><span>Proteína ${String(X.pkg).replace('.', ',')} g/kg</span></div>
  </section>
  ${aiPlanCard()}
  ${notes}
  <details class="card">
    <summary>¿De dónde salen estos números?</summary>
    <table class="kv">
      <tr><td>Metabolismo basal (Mifflin-St Jeor)</td><td>${r0(X.bmr)} kcal</td></tr>
      ${X.katch ? `<tr><td>Metabolismo basal (Katch-McArdle, referencia)</td><td>${r0(X.katch)} kcal</td></tr>` : ''}
      <tr><td>Actividad diaria (factor ${String(X.pal).replace('.', ',')})</td><td>+${r0(X.bmr * (X.pal - 1))} kcal</td></tr>
      <tr><td>Entrenamiento (promedio por día)</td><td>+${r0(X.exDay)} kcal</td></tr>
      <tr><td><b>Gasto total estimado</b></td><td><b>${r0(X.tdee)} kcal</b></td></tr>
      <tr><td>Ajuste por objetivo</td><td>${X.adj > 0 ? '+' : ''}${r0(X.adj * 100)} %</td></tr>
      <tr><td>IMC</td><td>${X.bmi.toFixed(1).replace('.', ',')}</td></tr>
      ${X.bf ? `<tr><td>% grasa ${esc(X.bfSrc)}</td><td>${X.bf.toFixed(1).replace('.', ',')} %</td></tr><tr><td>Masa magra</td><td>${X.lbm.toFixed(1).replace('.', ',')} kg</td></tr>` : ''}
      ${X.waistR ? `<tr><td>Cintura / altura (ideal &lt; 0,5)</td><td>${X.waistR.toFixed(2).replace('.', ',')}</td></tr>` : ''}
    </table>
    <p class="hint">Las fórmulas estiman; el gasto real puede variar ±10 %. Pesate 2–3 veces por semana en ayunas y mirá el promedio: si en 3–4 semanas no se mueve en la dirección buscada, ajustá ±100–150 kcal.</p>
  </details>
  <h2 class="sec">Tus comidas</h2>
  ${slotsHTML}
  <h2 class="sec">Intercambios</h2>
  ${viewExchanges(P)}
  <p class="disclaimer">Fit es una herramienta orientativa basada en fórmulas y guías generales. No reemplaza la consulta con un/a nutricionista o médico/a.</p>`;
}

function viewExchanges(P) {
  const ex = new Set(P.excluded || []);
  const defs = [
    ['Proteína', '1 porción = 20 g de proteína', ['prot', 'lact', 'leg'], 'p', 20],
    ['Carbohidratos', '1 porción = 30 g de carbohidratos', ['carb', 'leg'], 'c', 30],
    ['Frutas', '1 porción = 15 g de carbohidratos', ['fruta'], 'c', 15],
    ['Grasas', '1 porción = 10 g de grasa', ['grasa'], 'f', 10],
  ];
  return defs.map(([t, d, groups, m, amt]) => {
    const rows = Object.entries(FOODS).filter(([id, x]) => groups.includes(x.g) && x[m] > 0 && !ex.has(id))
      .filter(([, x]) => !(m === 'p' && x.p < 8)) // fuentes de proteína reales
      .map(([id, x]) => { const g = amt / (x[m] / 100); const gg = g < 15 ? Math.round(g) : r5(g); return `<li><span>${esc(x.n)}</span><b>${gg} g</b>${household(id, gg) ? `<small>${household(id, gg)}</small>` : ''}</li>`; }).join('');
    return `<details class="card"><summary>${t} <small>· ${d}</small></summary><ul class="opts">${rows}</ul></details>`;
  }).join('') + `<p class="hint">Verduras: libres. Apuntá a 400 g o más por día, de colores variados.</p>`;
}

// ---------------- Vista: Menú semanal ----------------
function viewMenu() {
  if (S.aiPlan && S.menuSource === 'ia') return viewMenuAI();
  const P = S.profile; const X = calc(P); const M = S.menu;
  const day = M.days[menuDay];
  let tot = { k: 0, p: 0, c: 0, f: 0 }; let hasFree = false;
  const cards = X.slots.map((s) => {
    const rid = day[s.key]; const r = R(rid); if (!r) return '';
    const n = mealNutr(rid, s); if (n.free) hasFree = true;
    tot.k += n.k; tot.p += n.p; tot.c += n.c; tot.f += n.f;
    const linkedNext = P.vianda && s.key === 'cena' && menuDay < 6 && M.days[menuDay + 1].almuerzo === rid && r.type === 'principal';
    const linkedPrev = P.vianda && s.key === 'almuerzo' && menuDay > 0 && M.days[menuDay - 1].cena === rid && r.type === 'principal';
    return `<section class="card meal">
      <header><h3>${esc(s.name)}</h3>${r.type === 'especial' ? '<span class="pill sp">Especial</span>' : ''}${linkedPrev ? '<span class="pill">Vianda de anoche</span>' : ''}</header>
      <p class="rname"><a href="#" data-recipe="${r.id}" data-slot="${s.key}">${esc(r.n)}</a></p>
      ${linkedNext ? '<p class="hint">Cociná el doble: la otra mitad es la vianda de mañana.</p>' : ''}
      ${n.free ? `<p class="hint">${esc(r.tip)}</p>` : `<div class="mrow"><b>${r0(n.k)} kcal</b><span class="p">P ${r0(n.p)}</span><span class="c">C ${r0(n.c)}</span><span class="f">G ${r0(n.f)}</span></div>`}
      ${r.type === 'especial' ? '' : `<div class="actions"><button class="ghost" data-reroll="${s.key}">Cambiar</button></div>`}
    </section>`;
  }).join('');
  // promedio semanal
  let wk = 0; let free = 0;
  M.days.forEach((d) => X.slots.forEach((s) => { const n = mealNutr(d[s.key], s); if (n) { wk += n.k; if (n.free) free++; } }));
  const avg = wk / 7; const diff = avg - X.kcal;
  return `${aiMenuToggle()}
  <div class="days">${DAYS_S.map((d, i) => `<button class="${i === menuDay ? 'on' : ''}" data-day="${i}">${d}</button>`).join('')}</div>
  <h2 class="sec">${DAYS[menuDay]}</h2>
  ${cards}
  <section class="card">
    <div class="mrow"><b>Total del día: ${r0(tot.k)} kcal</b><span class="p">P ${r0(tot.p)}</span><span class="c">C ${r0(tot.c)}</span><span class="f">G ${r0(tot.f)}</span></div>
    <p class="hint">Objetivo: ${X.kcal} kcal · ${X.p} g de proteína.${hasFree ? ' La comida libre se cuenta con el valor de esa comida del plan.' : ''}</p>
    <p class="hint">Promedio semanal: <b>${r0(avg)} kcal/día</b> (${diff >= 0 ? '+' : ''}${r0(diff)} respecto del objetivo)${free ? `. Incluye ${free} comida(s) libre(s) contada(s) como una comida normal: si se te van mucho, se nota en el promedio.` : '.'}</p>
  </section>
  <div class="actions center"><button data-newmenu>Generar otro menú semanal</button></div>`;
}

// ---------------- Vista: Recetas ----------------
function viewRecipes() {
  const P = S.profile;
  const F = { todas: 'Todas', desayuno: 'Desayuno / merienda', colacion: 'Colación', principal: 'Almuerzo / cena', especial: 'Especiales', fav: '★ Favoritas' };
  if (aiReady() || (S.aiRecipes || []).length) F.ia = '✨ Mis recetas IA';
  const q = recSearch.trim().toLowerCase();
  const list = RECIPES.filter((r) => (recFilter === 'todas' || (recFilter === 'fav' ? S.favs.includes(r.id) : r.type === recFilter)))
    .filter((r) => r.type === 'especial' || recipeAllowed(r, P, r.type))
    .filter((r) => !q || r.n.toLowerCase().includes(q) || r.ing.some(([id]) => FOODS[id].n.toLowerCase().includes(q)));
  const X = calc(P);
  const slotFor = (r) => X.slots.find((s) => s.type === r.type) || X.slots.find((s) => s.key === 'cena');
  const chips = `<div class="chips scroll">${Object.entries(F).map(([k, v]) => `<button class="chip ${recFilter === k ? 'on' : ''}" data-rf="${k}">${v}</button>`).join('')}</div>`;
  if (recFilter === 'ia') return `${aiFridgeCard()}${chips}${aiSavedRecipes()}`;
  return `${aiFridgeCard()}
  <input class="search" type="search" placeholder="Buscar receta o ingrediente…" value="${esc(recSearch)}" data-search>
  <div class="chips scroll">${Object.entries(F).map(([k, v]) => `<button class="chip ${recFilter === k ? 'on' : ''}" data-rf="${k}">${v}</button>`).join('')}</div>
  ${list.length ? list.map((r) => {
    const s = slotFor(r); const n = r.free ? null : nutr(scaleRecipe(r, s));
    return `<section class="card rec">
      <div class="rhead"><a href="#" data-recipe="${r.id}" data-slot="${s.key}">${esc(r.n)}</a>
      <button class="star ${S.favs.includes(r.id) ? 'on' : ''}" data-fav="${r.id}" aria-label="Favorita">★</button></div>
      <div class="mrow">${n ? `<b>${r0(n.k)} kcal</b><span class="p">P ${r0(n.p)}</span><span class="c">C ${r0(n.c)}</span><span class="f">G ${r0(n.f)}</span>` : ''}${r.time ? `<span class="muted">${r.time} min</span>` : ''}</div>
      ${!r.fixed ? `<p class="hint">Porción calculada para tu ${s.name.toLowerCase()}.</p>` : ''}
    </section>`;
  }).join('') : '<p class="hint center">No hay recetas para ese filtro.</p>'}`;
}

function openRecipe(id, slotKey) {
  const P = S.profile; const X = calc(P); const r = R(id); if (!r) return;
  const candidates = X.slots.filter((s) => s.type === r.type || (r.type === 'especial' && s.type === 'principal'));
  let slot = X.slots.find((s) => s.key === slotKey) || candidates[0] || X.slots[0];
  const draw = () => {
    const ings = scaleRecipe(r, slot); const n = nutr(ings);
    $('#modalBody').innerHTML = `
      <h2>${esc(r.n)}</h2>
      ${!r.fixed && candidates.length > 1 ? `<div class="chips">${candidates.map((s) => `<button class="chip ${s.key === slot.key ? 'on' : ''}" data-mslot="${s.key}">Para ${esc(s.name.toLowerCase())}</button>`).join('')}</div>` : ''}
      ${r.free ? '' : `<div class="mrow"><b>${r0(n.k)} kcal</b><span class="p">P ${r0(n.p)} g</span><span class="c">C ${r0(n.c)} g</span><span class="f">G ${r0(n.f)} g</span>${r.time ? `<span class="muted">${r.time} min</span>` : ''}</div>`}
      ${r.fixed && !r.free ? `<p class="hint">Porción fija. Tu ${esc(slot.name.toLowerCase())} del plan es de ${r0(slot.k)} kcal.</p>` : ''}
      ${ings.length ? `<h3>Ingredientes <small>(1 porción, pesos en crudo)</small></h3>
      <ul class="opts">${ings.map((i) => `<li><span>${esc(FOODS[i.id].n)}</span><b>${i.g} g</b>${household(i.id, i.g) ? `<small>${household(i.id, i.g)}</small>` : ''}</li>`).join('')}</ul>` : ''}
      <h3>Preparación</h3><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${r.tip ? `<div class="note info">${esc(r.tip)}</div>` : ''}
      <p class="hint">Sal, especias, ajo, limón, vinagre, hierbas, café, té y mate amargo: libres.</p>`;
  };
  draw();
  $('#modalBody').onclick = (e) => { const b = e.target.closest('[data-mslot]'); if (b) { slot = X.slots.find((s) => s.key === b.dataset.mslot); draw(); } };
  $('#modal').showModal();
}

// ---------------- Vista: Compras ----------------
function viewShop() {
  if (S.aiPlan && S.menuSource === 'ia') return viewShopAI();
  const P = S.profile; const X = calc(P); const M = S.menu;
  const tot = {};
  M.days.forEach((d) => X.slots.forEach((s) => {
    const r = R(d[s.key]); if (!r || r.free) return;
    const linked = P.vianda && s.key === 'almuerzo' && r.type === 'principal' && M.days.indexOf(d) > 0 && M.days[M.days.indexOf(d) - 1].cena === r.id;
    scaleRecipe(r, s).forEach((i) => { tot[i.id] = (tot[i.id] || 0) + i.g; });
    void linked; // la vianda también se compra: es una porción más
  }));
  const byG = {};
  Object.entries(tot).forEach(([id, g]) => { const gr = FOODS[id].g; (byG[gr] = byG[gr] || []).push([id, g]); });
  const fmt = (id, g) => {
    const x = FOODS[id];
    if (x.u && x.u[1] >= 30 && ['huevo', 'clara', 'banana', 'manzana', 'naranja', 'pera', 'durazno', 'tomate', 'papa', 'batata', 'cebolla', 'morron', 'zapallito', 'zanahoria', 'kiwi', 'mandarina', 'pan_frances'].includes(id)) {
      return `${Math.ceil(g / x.u[1])} u <small>(${g >= 1000 ? (g / 1000).toFixed(1).replace('.', ',') + ' kg' : r5(g) + ' g'})</small>`;
    }
    if (id === 'aceite') return `${Math.ceil(g / 13.5)} cdas <small>(${Math.ceil(g)} ml aprox.)</small>`;
    const gg = Math.ceil(g / 10) * 10;
    return gg >= 1000 ? `${(gg / 1000).toFixed(2).replace('.', ',')} kg` : `${gg} g`;
  };
  const key = `${M.created}`;
  const checked = S.shop[key] || {};
  const html = Object.keys(GROUPS).filter((g) => byG[g]).map((g) => `<section class="card"><h3>${GROUPS[g]}</h3><ul class="shop">
    ${byG[g].sort((a, b) => FOODS[a[0]].n.localeCompare(FOODS[b[0]].n)).map(([id, gr]) => `<li><label><input type="checkbox" data-shop="${id}" ${checked[id] ? 'checked' : ''}><span>${esc(FOODS[id].n)}</span><b>${fmt(id, gr)}</b></label></li>`).join('')}
  </ul></section>`).join('');
  const nSpecial = M.days.reduce((a, d) => a + X.slots.filter((s) => R(d[s.key])?.free).length, 0);
  return `${aiMenuToggle()}<h2 class="sec">Lista de compras de la semana</h2>
  <p class="hint">Calculada para el menú actual (1 persona, pesos en crudo).${nSpecial ? ` No incluye las ${nSpecial} comida(s) libre(s).` : ''} Si cambiás el menú, la lista se actualiza.</p>
  ${html}
  <div class="actions center"><button class="ghost" data-shopclear>Desmarcar todo</button><button data-shopshare>Compartir lista</button></div>`;
}

function shopText() {
  return [...document.querySelectorAll('.shop li')].filter((li) => !li.querySelector('input').checked)
    .map((li) => `• ${li.querySelector('span').textContent}: ${li.querySelector('b').textContent}`).join('\n');
}

// ---------------- Vista: Progreso ----------------
function viewProgress() {
  const P = S.profile;
  const list = S.progress.slice().sort((a, b) => a.date.localeCompare(b.date));
  const withBF = list.map((e) => ({ ...e, bf: navyBF({ ...P, waist: e.waist, neck: e.neck, hip: e.hip }) }));
  const first = withBF[0], last = withBF[withBF.length - 1];
  const delta = (k, u) => first && last && first !== last && first[k] != null && last[k] != null ? `<span class="${last[k] - first[k] <= 0 ? 'down' : 'up'}">${last[k] - first[k] > 0 ? '+' : ''}${(last[k] - first[k]).toFixed(1).replace('.', ',')} ${u}</span>` : '—';
  return `
  <section class="card">
    <h3>Nuevo registro</h3>
    <form id="progForm" class="grid2">
      <label>Fecha<input type="date" name="date" value="${todayISO()}" required></label>
      <label>Peso (kg)<input type="number" step="0.1" name="weight" inputmode="decimal" required></label>
      <label>Cintura (cm)<input type="number" step="0.5" name="waist" inputmode="decimal"></label>
      <label>Cuello (cm)<input type="number" step="0.5" name="neck" inputmode="decimal"></label>
      ${P.sex === 'F' ? '<label>Cadera (cm)<input type="number" step="0.5" name="hip" inputmode="decimal"></label>' : ''}
      <button type="submit" class="span2">Guardar</button>
    </form>
    <p class="hint">Medite siempre en las mismas condiciones: en ayunas, después de ir al baño. El peso fluctúa 1–2 kg día a día; mirá la tendencia.</p>
  </section>
  ${list.length ? `
  <section class="card"><h3>Cambios desde el inicio</h3>
    <div class="minis big3"><span>Peso<br>${delta('weight', 'kg')}</span><span>Cintura<br>${delta('waist', 'cm')}</span><span>% grasa<br>${delta('bf', '%')}</span></div>
  </section>
  <section class="card"><h3>Peso (kg)</h3>${chart(withBF, 'weight')}</section>
  ${withBF.filter((e) => e.waist).length > 1 ? `<section class="card"><h3>Cintura (cm)</h3>${chart(withBF, 'waist')}</section>` : ''}
  ${withBF.filter((e) => e.bf).length > 1 ? `<section class="card"><h3>% grasa estimado</h3>${chart(withBF, 'bf')}</section>` : ''}
  <section class="card"><h3>Historial</h3>
    <table class="hist"><tr><th>Fecha</th><th>Peso</th><th>Cint.</th><th>% gr.</th><th></th></tr>
    ${withBF.slice().reverse().map((e) => `<tr><td>${e.date.split('-').reverse().slice(0, 2).join('/')}</td><td>${e.weight ?? '—'}</td><td>${e.waist ?? '—'}</td><td>${e.bf ? e.bf.toFixed(1) : '—'}</td><td><button class="x" data-delprog="${e.date}" aria-label="Borrar">×</button></td></tr>`).join('')}
    </table>
    <div class="actions center"><button class="ghost" data-useprog>Actualizar mi plan con el último registro</button></div>
  </section>` : '<p class="hint center">Todavía no hay registros.</p>'}`;
}

function chart(data, key) {
  const pts = data.filter((e) => e[key] != null && !isNaN(e[key]));
  if (pts.length < 2) return '<p class="hint">Cargá al menos dos registros para ver el gráfico.</p>';
  const W = 320, H = 140, pad = 28;
  const t0 = new Date(pts[0].date).getTime(), t1 = new Date(pts[pts.length - 1].date).getTime() || t0 + 1;
  const vs = pts.map((p) => +p[key]); let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const x = (p) => pad + ((new Date(p.date).getTime() - t0) / Math.max(1, t1 - t0)) * (W - pad - 8);
  const y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (H - 30);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(+p[key]).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Gráfico de ${key}">
    <line x1="${pad}" y1="${y(hi)}" x2="${W - 8}" y2="${y(hi)}" class="grid"/><line x1="${pad}" y1="${y(lo)}" x2="${W - 8}" y2="${y(lo)}" class="grid"/>
    <text x="2" y="${y(hi) + 4}" class="ax">${hi.toFixed(1)}</text><text x="2" y="${y(lo) + 4}" class="ax">${lo.toFixed(1)}</text>
    <path d="${path}" class="line"/>
    ${pts.map((p) => `<circle cx="${x(p).toFixed(1)}" cy="${y(+p[key]).toFixed(1)}" r="3" class="pt"/>`).join('')}
    <text x="${pad}" y="${H - 4}" class="ax">${pts[0].date.split('-').reverse().slice(0, 2).join('/')}</text>
    <text x="${W - 8}" y="${H - 4}" class="ax" text-anchor="end">${pts[pts.length - 1].date.split('-').reverse().slice(0, 2).join('/')}</text>
  </svg>`;
}

// ---------------- Vista: Perfil / cuestionario ----------------
const SPECIAL_SLOTS = [['4-cena', 'Viernes cena'], ['5-almuerzo', 'Sábado almuerzo'], ['5-cena', 'Sábado cena'], ['6-almuerzo', 'Domingo almuerzo'], ['6-cena', 'Domingo cena']];

function viewProfile(first) {
  const P = S.profile || { sex: 'F', job: 'sentado', strDays: 3, strMin: 60, cardDays: 1, cardMin: 45, cardType: 'mixto', experience: 'nov', goals: [], priority: 'recomp', pace: 'moderado', meals: 4, breakfast: 'ambos', excluded: [], health: [], specials: {}, vianda: false };
  const opt = (name, val, txt, cur) => `<option value="${val}" ${String(cur) === String(val) ? 'selected' : ''}>${txt}</option>`;
  const chk = (name, val, txt, arr, type = 'checkbox') => `<label class="chip"><input type="${type}" name="${name}" value="${val}" ${(type === 'radio' ? String(arr) === String(val) : (arr || []).includes(val)) ? 'checked' : ''}><span>${txt}</span></label>`;
  const specials = RECIPES.filter((r) => r.type === 'especial');
  const foodsByG = Object.keys(GROUPS).map((g) => `<p class="glabel">${GROUPS[g]}</p><div class="chips wrap">${Object.entries(FOODS).filter(([, x]) => x.g === g).map(([id, x]) => chk('excluded', id, esc(x.n), P.excluded)).join('')}</div>`).join('');
  return `
  ${first ? `<section class="card hero intro"><div class="logo">Fit</div><p>Tu plan nutricional con comida de acá. Completá el cuestionario (2–3 minutos) y Fit calcula tus calorías, macros, porciones, menú semanal y lista de compras.</p></section>` : '<h2 class="sec">Mi perfil</h2>'}
  <form id="pform">
    <section class="card"><h3>1 · Datos personales</h3>
      <div class="grid2">
        <label class="span2">Nombre (opcional)<input name="name" value="${esc(P.name || '')}" autocomplete="given-name"></label>
        <label>Sexo biológico<select name="sex">${opt('sex', 'F', 'Femenino', P.sex)}${opt('sex', 'M', 'Masculino', P.sex)}</select></label>
        <label>Edad<input type="number" name="age" min="14" max="100" value="${P.age || ''}" required inputmode="numeric"></label>
        <label>Altura (cm)<input type="number" name="height" min="120" max="230" value="${P.height || ''}" required inputmode="numeric"></label>
        <label>Peso (kg)<input type="number" step="0.1" name="weight" min="30" max="300" value="${P.weight || ''}" required inputmode="decimal"></label>
      </div>
    </section>
    <section class="card"><h3>2 · Medidas <small>(opcional, mejora el cálculo)</small></h3>
      <div class="grid2">
        <label>Cintura (cm)<input type="number" step="0.5" name="waist" value="${P.waist || ''}" inputmode="decimal"></label>
        <label>Cuello (cm)<input type="number" step="0.5" name="neck" value="${P.neck || ''}" inputmode="decimal"></label>
        <label>Cadera (cm)<input type="number" step="0.5" name="hip" value="${P.hip || ''}" inputmode="decimal"></label>
        <label>% grasa medido<input type="number" step="0.1" name="bfKnown" value="${P.bfKnown || ''}" placeholder="si tenés" inputmode="decimal"></label>
      </div>
      <p class="hint">Cintura a la altura del ombligo, cuello debajo de la nuez, cadera en la parte más ancha. Si tenés % de grasa de una bioimpedancia o DEXA, cargalo y se usa ese.</p>
    </section>
    <section class="card"><h3>3 · Actividad</h3>
      <div class="grid2">
        <label class="span2">Trabajo / día a día<select name="job">${opt('', 'sentado', 'Sentado casi todo el día', P.job)}${opt('', 'mixto', 'Mixto (sentado y de pie)', P.job)}${opt('', 'pie', 'De pie / caminando', P.job)}${opt('', 'fisico', 'Trabajo físico pesado', P.job)}</select></label>
        <label>Días de fuerza / semana<input type="number" name="strDays" min="0" max="7" value="${P.strDays ?? 0}" inputmode="numeric"></label>
        <label>Minutos por sesión<input type="number" name="strMin" min="0" max="240" value="${P.strMin ?? 0}" inputmode="numeric"></label>
        <label>Días de cardio / deporte<input type="number" name="cardDays" min="0" max="14" value="${P.cardDays ?? 0}" inputmode="numeric"></label>
        <label>Minutos por sesión<input type="number" name="cardMin" min="0" max="300" value="${P.cardMin ?? 0}" inputmode="numeric"></label>
        <label class="span2">Tipo de cardio / deporte<select name="cardType">${opt('', 'caminar', 'Caminata', P.cardType)}${opt('', 'mixto', 'Caminar/trotar', P.cardType)}${opt('', 'correr', 'Correr', P.cardType)}${opt('', 'bici', 'Bici / spinning', P.cardType)}${opt('', 'nadar', 'Natación', P.cardType)}${opt('', 'deporte', 'Fútbol, pádel, tenis, etc.', P.cardType)}</select></label>
        <label class="span2">Experiencia en fuerza<select name="experience">${opt('', 'nov', 'Menos de 6 meses', P.experience)}${opt('', 'int', '6 meses a 2 años', P.experience)}${opt('', 'adv', 'Más de 2 años', P.experience)}</select></label>
      </div>
    </section>
    <section class="card"><h3>4 · Objetivos <small>(podés elegir varios)</small></h3>
      <div class="chips wrap">${Object.entries(GOALS).map(([k, v]) => chk('goals', k, v, P.goals)).join('')}</div>
      <p class="glabel">Si elegiste perder grasa y ganar músculo, ¿prioridad?</p>
      <div class="chips wrap">${chk('priority', 'grasa', 'Primero perder grasa', P.priority, 'radio')}${chk('priority', 'recomp', 'Recomposición (ambas)', P.priority, 'radio')}${chk('priority', 'musculo', 'Primero ganar músculo', P.priority, 'radio')}</div>
      <p class="glabel">Ritmo</p>
      <div class="chips wrap">${chk('pace', 'lento', 'Lento', P.pace, 'radio')}${chk('pace', 'moderado', 'Moderado (recomendado)', P.pace, 'radio')}${chk('pace', 'agresivo', 'Agresivo', P.pace, 'radio')}</div>
    </section>
    <section class="card"><h3>5 · Salud</h3>
      <div class="chips wrap">${Object.entries(HEALTH).map(([k, v]) => chk('health', k, v, P.health)).join('')}</div>
      <p class="hint">Si tenés alguna de estas condiciones, Fit te va a mostrar avisos, pero el plan tiene que validarlo un profesional.</p>
    </section>
    <section class="card"><h3>6 · Rutina</h3>
      <div class="grid2">
        <label>Comidas por día<select name="meals">${[3, 4, 5, 6].map((n) => opt('', n, n, P.meals)).join('')}</select></label>
        <label>Desayuno y merienda<select name="breakfast">${opt('', 'salado', 'Salado', P.breakfast)}${opt('', 'dulce', 'Dulce', P.breakfast)}${opt('', 'ambos', 'Ambos', P.breakfast)}</select></label>
      </div>
      <label class="chip solo"><input type="checkbox" name="vianda" ${P.vianda ? 'checked' : ''}><span>Llevo vianda: la cena de hoy es el almuerzo de mañana</span></label>
    </section>
    <section class="card"><h3>7 · Comidas especiales del finde</h3>
      <p class="hint">Las comidas que no querés resignar se incluyen en el menú en lugar de prohibirlas.</p>
      <div class="grid2">${SPECIAL_SLOTS.map(([k, l]) => `<label>${l}<select name="sp_${k}"><option value="">— Plan normal —</option>${specials.map((r) => opt('', r.id, r.n.split('(')[0].split(':')[0].trim(), (P.specials || {})[k])).join('')}</select></label>`).join('')}</div>
    </section>
    <section class="card"><h3>8 · Alimentos que NO comés</h3>
      <p class="hint">Tocá los que quieras excluir; no van a aparecer en recetas, menú ni intercambios.</p>
      ${foodsByG}
    </section>
    <section class="card"><h3>9 · Contame más <small>(opcional)</small></h3>
      <p class="hint">Escribilo como te salga. Lo usa la IA para personalizar tu plan, si la activás.</p>
      ${[['likes', 'Comidas que te gustan', 'Ej.: milanesas, pastas, pollo al horno…'], ['dislikes', 'Lo que no te gusta o no comés', 'Ej.: yogur, hígado…'], ['sacred', 'Comidas que no querés resignar', 'Ej.: pizza del viernes, asado del domingo'], ['schedule', 'Tus horarios', 'Ej.: me levanto 6:50, desayuno 8:15, almuerzo 14:15, gimnasio 16:20, ceno 21, duermo 23'], ['typical', 'Qué comés hoy en un día típico', 'Desayuno, almuerzo, merienda, cena, picoteos, bebidas…'], ['city', 'Ciudad / provincia', 'Ej.: Córdoba'], ['notes', 'Otras aclaraciones', 'Lo que quieras que se tenga en cuenta']].map(([k, l, ph]) => `<label class="span2" style="margin-top:8px">${l}<textarea name="${k}" rows="2" placeholder="${ph}">${esc(P[k] || '')}</textarea></label>`).join('')}
      <label style="margin-top:8px">Presupuesto<select name="budget">${opt('', '', '—', P.budget || '')}${opt('', 'ajustado', 'Ajustado', P.budget)}${opt('', 'medio', 'Medio', P.budget)}${opt('', 'holgado', 'Sin problema', P.budget)}</select></label>
    </section>
    <div class="sticky"><button type="submit">${first ? 'Calcular mi plan' : 'Guardar y recalcular'}</button></div>
  </form>
  ${first ? '' : `
  ${aiSettingsCard()}
  <section class="card"><h3>Datos y app</h3>
    <div class="actions">
      ${deferredInstall ? '<button data-install>Instalar Fit</button>' : ''}
      <button class="ghost" data-share>Compartir Fit</button>
      <button class="ghost" data-export>Exportar backup</button>
      <label class="btn ghost">Importar backup<input type="file" accept="application/json" data-import hidden></label>
      <button class="ghost danger" data-reset>Borrar todos mis datos</button>
    </div>
    <p class="hint">Tus datos se guardan solo en este teléfono, no se envían a ningún servidor. Exportá un backup si vas a cambiar de celular o borrar el navegador.</p>
  </section>
  <section class="card"><h3>Cómo calcula Fit</h3>
    <p class="hint">Metabolismo basal: Mifflin-St Jeor. % de grasa: método de la Marina de EE.UU. (cintura, cuello y cadera) o el valor que cargues. Proteína: 1,6–2,0 g/kg según el objetivo, dentro del rango que recomienda la International Society of Sports Nutrition (ISSN). Grasas: alrededor del 28 % de las calorías (mínimo 0,6 g/kg). Carbohidratos: el resto. Valores de alimentos: USDA FoodData Central y tablas argentinas; son aproximados.</p>
    <p class="disclaimer">Fit es orientativa y no reemplaza la consulta con profesionales de la salud.</p>
  </section>`}`;
}

function bindProfile(first) {
  const f = $('#pform');
  f.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const num = (k) => (fd.get(k) === '' || fd.get(k) == null ? null : +fd.get(k));
    const specials = {};
    SPECIAL_SLOTS.forEach(([k]) => { const v = fd.get('sp_' + k); if (v) specials[k] = v; });
    const P = {
      name: (fd.get('name') || '').trim(), sex: fd.get('sex'), age: num('age'), height: num('height'), weight: num('weight'),
      waist: num('waist'), neck: num('neck'), hip: num('hip'), bfKnown: num('bfKnown'),
      job: fd.get('job'), strDays: num('strDays') || 0, strMin: num('strMin') || 0, cardDays: num('cardDays') || 0, cardMin: num('cardMin') || 0,
      cardType: fd.get('cardType'), experience: fd.get('experience'),
      goals: fd.getAll('goals'), priority: fd.get('priority') || 'recomp', pace: fd.get('pace') || 'moderado',
      health: fd.getAll('health'), meals: num('meals') || 4, breakfast: fd.get('breakfast'), vianda: fd.get('vianda') === 'on',
      specials, excluded: fd.getAll('excluded'),
      likes: (fd.get('likes') || '').trim(), dislikes: (fd.get('dislikes') || '').trim(), sacred: (fd.get('sacred') || '').trim(),
      schedule: (fd.get('schedule') || '').trim(), typical: (fd.get('typical') || '').trim(), city: (fd.get('city') || '').trim(),
      notes: (fd.get('notes') || '').trim(), budget: fd.get('budget') || '',
      aiAnswers: (S.profile && S.profile.aiAnswers) || [],
    };
    if (!P.goals.length) P.goals = ['mantener'];
    const old = S.profile;
    S.profile = P;
    const menuRelevant = !old || JSON.stringify([old.meals, old.breakfast, old.vianda, old.specials, old.excluded]) !== JSON.stringify([P.meals, P.breakfast, P.vianda, P.specials, P.excluded]);
    if (menuRelevant) { S.menu = genMenu(P); S.shop = {}; }
    if (first || !S.progress.length) S.progress.push({ date: todayISO(), weight: P.weight, waist: P.waist, neck: P.neck, hip: P.hip });
    store.save();
    TAB = 'plan'; render(); toast(first ? '¡Plan listo!' : 'Perfil guardado');
  };
}

// ---------------- Eventos globales ----------------
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a, [data-recipe]'); if (!t) return;
  const d = t.dataset;
  if (d.ai != null) { e.preventDefault(); aiAction(t); return; }
  if (t.id === 'busyCancel') { if (aiAbort) aiAbort.abort(); return; }
  if (d.tab) { TAB = d.tab; render(); return; }
  if (t.id === 'btnProfile') { TAB = 'perfil'; render(); return; }
  if (d.recipe) { e.preventDefault(); openRecipe(d.recipe, d.slot); return; }
  if (d.day != null) { menuDay = +d.day; render(); return; }
  if (d.reroll) {
    const P = S.profile; const s = calc(P).slots.find((x) => x.key === d.reroll);
    const cur = S.menu.days[menuDay][s.key];
    const pool = poolFor(P, s.type).filter((id) => id !== cur);
    if (!pool.length) return;
    const nid = pool[Math.floor(Math.random() * pool.length)];
    S.menu.days[menuDay][s.key] = nid;
    if (P.vianda && s.key === 'cena' && menuDay < 6 && S.menu.days[menuDay + 1].almuerzo === cur) S.menu.days[menuDay + 1].almuerzo = nid;
    if (P.vianda && s.key === 'almuerzo' && menuDay > 0 && S.menu.days[menuDay - 1].cena === cur) S.menu.days[menuDay - 1].cena = nid;
    store.save(); render(); return;
  }
  if (d.newmenu != null) { S.menu = genMenu(S.profile); S.shop = {}; store.save(); render(); toast('Menú nuevo generado'); return; }
  if (d.rf) { recFilter = d.rf; render(); return; }
  if (d.fav) {
    const i = S.favs.indexOf(d.fav); i >= 0 ? S.favs.splice(i, 1) : S.favs.push(d.fav); store.save();
    t.classList.toggle('on'); toast(i >= 0 ? 'Quitada de favoritas' : 'Favorita: aparecerá más seguido en el menú'); return;
  }
  if (d.shopclear != null) { S.shop = {}; store.save(); render(); return; }
  if (d.shopshare != null) {
    const txt = 'Lista de compras (Fit)\n' + shopText();
    try { if (navigator.share) await navigator.share({ text: txt }); else { await navigator.clipboard.writeText(txt); toast('Lista copiada'); } } catch (_) { /* cancelado */ }
    return;
  }
  if (d.delprog) { S.progress = S.progress.filter((p) => p.date !== d.delprog); store.save(); render(); return; }
  if (d.useprog != null) {
    const last = S.progress.slice().sort((a, b) => a.date.localeCompare(b.date)).pop(); if (!last) return;
    Object.assign(S.profile, { weight: last.weight, ...(last.waist ? { waist: last.waist } : {}), ...(last.neck ? { neck: last.neck } : {}), ...(last.hip ? { hip: last.hip } : {}) });
    store.save(); TAB = 'plan'; render(); toast('Plan actualizado'); return;
  }
  if (d.install != null && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; return; }
  if (d.share != null) {
    const url = location.href.split('#')[0];
    try { if (navigator.share) await navigator.share({ title: 'Fit', text: 'Plan nutricional con comida argentina', url }); else { await navigator.clipboard.writeText(url); toast('Link copiado'); } } catch (_) { /* cancelado */ }
    return;
  }
  if (d.export != null) {
    const copy = Object.assign({}, S, { ai: null }); const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fit-backup-${todayISO()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return;
  }
  if (d.reset != null) {
    if (confirm('¿Borrar perfil, menú y progreso de este teléfono? No se puede deshacer.')) { S = FRESH(); store.save(); render(); }
    return;
  }
  if (t.id === 'modalClose') { $('#modal').close(); }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.shop) { const k = `${S.menu.created}`; S.shop[k] = S.shop[k] || {}; S.shop[k][t.dataset.shop] = t.checked; store.save(); }
  if (t.dataset.import != null && t.files[0]) {
    t.files[0].text().then((txt) => {
      try { const d = JSON.parse(txt); if (!d || typeof d !== 'object' || !('profile' in d)) throw 0; const keep = S.ai; S = Object.assign(FRESH(), d, { ai: keep }); store.save(); TAB = 'plan'; render(); toast('Backup importado'); }
      catch (_) { toast('El archivo no es un backup válido'); }
    });
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'progForm') return;
  e.preventDefault();
  const fd = new FormData(e.target); const num = (k) => (fd.get(k) ? +fd.get(k) : null);
  const entry = { date: fd.get('date'), weight: num('weight'), waist: num('waist'), neck: num('neck'), hip: num('hip') };
  S.progress = S.progress.filter((p) => p.date !== entry.date).concat(entry);
  store.save(); render(); toast('Registro guardado');
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.search != null) {
    recSearch = e.target.value; const pos = e.target.selectionStart; render();
    const s = $('[data-search]'); s.focus(); s.setSelectionRange(pos, pos);
  }
});

$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.close(); });

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (TAB === 'perfil') render(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
