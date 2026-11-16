/* Fit — entrenamiento, equivalencias/reemplazos, diario, calculadora y escáner de productos. */
'use strict';

// =====================================================================
// Entrenamiento: carbohidratos según día de entrenamiento o descanso
// =====================================================================
const DEFAULT_TIMES = { desayuno: '08:00', colacion: '10:30', almuerzo: '13:30', merienda: '17:30', colacion2: '19:00', cena: '21:00' };
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const mealTime = (P, key) => (P.mealTimes && P.mealTimes[key]) || DEFAULT_TIMES[key];
const isTrainDay = (P, d) => (P.trainDays || []).includes(d);

function prePost(P, slots) {
  const t = toMin(P.trainTime); if (t == null) return {};
  const dur = Math.max(+P.strMin || 0, 45);
  let pre = null, post = null;
  slots.forEach((s) => {
    const m = toMin(mealTime(P, s.key)); if (m == null) return;
    if (m <= t && t - m <= 240 && (!pre || m > pre.m)) pre = { k: s.key, m };
    if (m >= t + dur - 15 && m - (t + dur) <= 180 && (!post || m < post.m)) post = { k: s.key, m };
  });
  return { pre: pre && pre.k, post: post && post.k };
}

// Metas por comida para un día concreto (0 = lunes). Los días de entrenamiento suman carbohidratos
// (sobre todo antes y después de entrenar) y los de descanso restan lo mismo: el promedio semanal
// de calorías y carbohidratos no cambia, y la proteína y las grasas tampoco.
function daySlots(X, P, d) {
  const slots = X.slots.map((s) => ({ ...s }));
  const td = P.trainDays || []; const nT = td.length, nR = 7 - nT;
  if (!nT) return slots;
  const train = td.includes(d);
  const pp = prePost(P, slots);
  if (train) slots.forEach((s) => { s.train = true; if (s.key === pp.pre) s.pre = true; if (s.key === pp.post) s.post = true; });
  if (!nR) return slots;
  let E = X.c * 0.15;
  if ((E * nT) / nR > X.c * 0.3) E = (X.c * 0.3 * nR) / nT;
  if (train) {
    const tg = [pp.pre, pp.post].filter(Boolean);
    if (tg.length) tg.forEach((k) => { const s = slots.find((x) => x.key === k); const a = E / tg.length; s.c += a; s.k += a * 4; });
    else slots.forEach((s) => { const a = (E * s.pct) / 100; s.c += a; s.k += a * 4; });
  } else {
    const cutT = (E * nT) / nR; const tot = slots.reduce((a, s) => a + s.c, 0) || 1;
    slots.forEach((s) => { const cut = (cutT * s.c) / tot; s.c -= cut; s.k -= cut * 4; });
  }
  return slots;
}
const sumSlots = (sl) => sl.reduce((t, s) => ({ k: t.k + s.k, p: t.p + s.p, c: t.c + s.c, f: t.f + s.f }), { k: 0, p: 0, c: 0, f: 0 });
function trainPill(s) { return s.pre ? '<span class="pill tr">Pre-entreno</span>' : s.post ? '<span class="pill tr">Post-entreno</span>' : ''; }
function trainTip(s) {
  if (s.pre) return 'Antes de entrenar: priorizá carbohidratos y una porción de proteína, con poca grasa y poca fibra para que no te caiga pesado.';
  if (s.post) return 'Después de entrenar: proteína (unos 25–40 g) y carbohidratos para recuperar.';
  return '';
}
function mealTimesHTML(P, n) {
  const sl = SLOT_SETS[n] || SLOT_SETS[4];
  return `<div class="grid2">${sl.map(([key, name]) => `<label>${esc(name)}<input type="time" name="mt_${key}" value="${esc(mealTime(P, key))}"></label>`).join('')}</div>`;
}

// =====================================================================
// Equivalencias y reemplazo de ingredientes
// =====================================================================
function macroOfFood(x) {
  if (x.g === 'veg') return 'g';
  const kp = x.p * 4, kc = x.c * 4, kf = x.f * 9;
  return kp >= kc && kp >= kf ? 'p' : kc >= kf ? 'c' : 'f';
}
// Fuentes "prácticas" de cada macro: el huevo o los quesos cuentan como proteína aunque tengan más grasa.
const isProtSrc = (x) => x.p >= 8 && x.p * 4 >= 0.25 * x.k;
const isCarbSrc = (x) => macroOfFood(x) === 'c' && x.c >= 8 && x.g !== 'veg';
const isFatSrc = (x) => x.f >= 10 && (x.g === 'grasa' || x.f * 9 >= 0.7 * x.k);
const MACRO_TXT = { p: 'proteína', c: 'carbohidratos', f: 'grasa', g: 'peso (verduras)' };

function swapCandidates(macro, fromGroup, fromId) {
  const ex = new Set((S.profile && S.profile.excluded) || []);
  return Object.keys(FOODS).filter((id) => {
    const x = FOODS[id]; if (id === fromId || ex.has(id)) return false;
    if (macro === 'g') return x.g === 'veg';
    if (macro === 'p') return isProtSrc(x);
    if (macro === 'c') return fromGroup === 'fruta' ? x.g === 'fruta' : isCarbSrc(x);
    return isFatSrc(x);
  }).sort((a, b) => FOODS[a].n.localeCompare(FOODS[b].n));
}
function equivGrams(amount, macro, toId) {
  const x = FOODS[toId]; const g = macro === 'g' ? amount : amount / (x[macro] / 100);
  return g < 15 ? Math.max(1, Math.round(g)) : r5(g);
}
function foodLine(id, g) { const x = FOODS[id]; const m = g / 100; return { id, n: x.n, g, k: x.k * m, p: x.p * m, c: x.c * m, f: x.f * m }; }
const sumLines = (ls) => ls.reduce((t, l) => ({ k: t.k + l.k, p: t.p + l.p, c: t.c + l.c, f: t.f + l.f }), { k: 0, p: 0, c: 0, f: 0 });

function fitLine(i, swTo, idx) {
  const o = foodLine(i.id, i.g);
  const macro = ['p', 'c', 'f'].includes(i.role) ? i.role : macroOfFood(FOODS[i.id]);
  Object.assign(o, { macro, group: FOODS[i.id].g, idx, amount: macro === 'g' ? i.g : o[macro], origId: i.id });
  if (!swTo || !FOODS[swTo]) return o;
  return Object.assign(foodLine(swTo, equivGrams(o.amount, macro, swTo)), { macro, group: FOODS[i.id].g, idx, amount: o.amount, swappedFrom: o.n });
}
function aiLine(i, swTo, idx) {
  const o = { n: String(i.nombre || ''), g: +i.gramos || 0, k: +i.kcal || 0, p: +i.proteinas || 0, c: +i.carbohidratos || 0, f: +i.grasas || 0, medida: i.medida_casera, idx };
  const kp = o.p * 4, kc = o.c * 4, kf = o.f * 9;
  o.macro = o.g > 0 && (o.k / o.g) * 100 < 45 && kc >= kp ? 'g' : kp >= kc && kp >= kf ? 'p' : kc >= kf ? 'c' : 'f';
  o.group = o.macro === 'g' ? 'veg' : null;
  o.amount = o.macro === 'g' ? o.g : o[o.macro];
  if (!swTo || !FOODS[swTo] || !o.amount) return o;
  return Object.assign(foodLine(swTo, equivGrams(o.amount, o.macro, swTo)), { macro: o.macro, group: o.group, idx, amount: o.amount, swappedFrom: o.n });
}
function ctxKey(d, key, src) { return src === 'ia' ? `ia${S.aiPlan.created}|${d}|${key}` : `${S.menu.created}|${d}|${key}`; }
function fitLines(r, slot, ctx) { const sw = (ctx && S.swaps[ctx]) || {}; return scaleRecipe(r, slot).map((i, idx) => fitLine(i, sw[idx], idx)); }
function aiLines(m, ctx) { const sw = (ctx && S.swaps[ctx]) || {}; return (m.ingredientes || []).map((i, idx) => aiLine(i, sw[idx], idx)); }

// =====================================================================
// Modal de receta con reemplazos
// =====================================================================
let MOD = null;

function openRecipe(id, slotKey, day) {
  const P = S.profile; const X = calc(P); const r = R(id); if (!r) return;
  const dd = day == null ? todayIdx() : day; const slots = daySlots(X, P, dd);
  const candidates = slots.filter((s) => s.type === r.type || (r.type === 'especial' && s.type === 'principal'));
  const slot = slots.find((s) => s.key === slotKey) || candidates[0] || slots[0];
  const ctx = day != null && S.menuSource !== 'ia' && S.menu.days[day] && S.menu.days[day][slot.key] === id ? ctxKey(day, slot.key, 'fit') : null;
  MOD = { kind: 'fit', r, slots, candidates, slot, ctx, ctxSlot: slot.key, day: dd, temp: {}, open: null };
  drawMod(); $('#modal').showModal();
}
function openAIMeal(m, ctx) { MOD = { kind: 'ia', m, ctx, temp: {}, open: null }; drawMod(); $('#modal').showModal(); }

function modCtx() { return MOD.kind === 'fit' && MOD.slot.key !== MOD.ctxSlot ? null : MOD.ctx; }
function modSwaps() { const c = modCtx(); return c ? (S.swaps[c] || {}) : MOD.temp; }
function modLines() {
  const sw = modSwaps();
  if (MOD.kind === 'fit') return scaleRecipe(MOD.r, MOD.slot).map((i, idx) => fitLine(i, sw[idx], idx));
  return (MOD.m.ingredientes || []).map((i, idx) => aiLine(i, sw[idx], idx));
}

function linesHTML(lines, canSwap) {
  return `<ul class="opts">${lines.map((l) => {
    const hh = l.id ? household(l.id, l.g) : (l.medida ? esc(l.medida) : '');
    let sub = '';
    if (canSwap && MOD.open === l.idx) {
      const cands = swapCandidates(l.macro, l.group, l.id || null);
      sub = `<div class="swaplist"><p class="hint">Equivalentes en ${MACRO_TXT[l.macro]} a ${l.macro === 'g' ? Math.round(l.amount) + ' g' : (Math.round(l.amount * 10) / 10).toString().replace('.', ',') + ' g de ' + MACRO_TXT[l.macro]}:</p>
        ${l.swappedFrom ? '<button class="chip" data-x="swapreset" data-idx="' + l.idx + '">↺ Volver al original</button>' : ''}
        <ul class="opts">${cands.map((id) => { const g = equivGrams(l.amount, l.macro, id); const n = foodLine(id, g); const dk = Math.round(n.k - l.k);
          return `<li class="pick" data-x="swapto" data-idx="${l.idx}" data-to="${id}"><span>${esc(FOODS[id].n)}</span><b>${g} g</b><small>${household(id, g) ? household(id, g) + ' · ' : ''}${Math.round(n.k)} kcal (${dk >= 0 ? '+' : ''}${dk}) · P ${Math.round(n.p)} · C ${Math.round(n.c)} · G ${Math.round(n.f)}</small></li>`; }).join('')}</ul></div>`;
    }
    return `<li><span>${esc(l.n)}${l.swappedFrom ? ` <small class="sw">en vez de ${esc(l.swappedFrom)}</small>` : ''}</span><b>${Math.round(l.g)} g</b>
      <small>${hh ? hh + ' · ' : ''}${Math.round(l.k)} kcal · P ${Math.round(l.p)} · C ${Math.round(l.c)} · G ${Math.round(l.f)}</small>
      ${canSwap && l.amount ? `<button class="swapbtn" data-x="swapopen" data-idx="${l.idx}">${MOD.open === l.idx ? 'Cerrar' : '⇄ Reemplazar'}</button>` : ''}${sub}</li>`;
  }).join('')}</ul>`;
}

function drawMod() {
  const lines = modLines(); const n = sumLines(lines); const saved = !!modCtx();
  const note = saved ? '<p class="hint">Los reemplazos que elijas quedan guardados para esta comida del menú y se reflejan en el diario y en la lista de compras.</p>'
    : '<p class="hint">Reemplazos de vista previa: para que queden guardados, abrí la receta desde el Menú.</p>';
  if (MOD.kind === 'fit') {
    const r = MOD.r;
    $('#modalBody').innerHTML = `<h2>${esc(r.n)}</h2>
      ${!r.fixed && MOD.candidates.length > 1 ? `<div class="chips">${MOD.candidates.map((s) => `<button class="chip ${s.key === MOD.slot.key ? 'on' : ''}" data-x="mslot" data-k="${s.key}">Para ${esc(s.name.toLowerCase())}</button>`).join('')}</div>` : ''}
      ${r.free ? '' : `<div class="mrow"><b>${r0(n.k)} kcal</b><span class="p">P ${r0(n.p)} g</span><span class="c">C ${r0(n.c)} g</span><span class="f">G ${r0(n.f)} g</span>${r.time ? `<span class="muted">${r.time} min</span>` : ''}</div>`}
      ${r.fixed && !r.free ? `<p class="hint">Porción fija. Tu ${esc(MOD.slot.name.toLowerCase())} del plan es de ${r0(MOD.slot.k)} kcal.</p>` : ''}
      ${lines.length ? `<h3>Ingredientes <small>(1 porción, pesos en crudo)</small></h3>${linesHTML(lines, true)}${note}` : ''}
      <h3>Preparación</h3><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${r.tip ? `<div class="note info">${esc(r.tip)}</div>` : ''}
      <p class="hint">Sal, especias, ajo, limón, vinagre, hierbas, café, té y mate amargo: libres.</p>`;
  } else {
    const m = MOD.m;
    $('#modalBody').innerHTML = `<h2>${esc(m.nombre)}</h2>
      ${lines.length ? `<div class="mrow"><b>${Math.round(n.k)} kcal</b><span class="p">P ${Math.round(n.p)} g</span><span class="c">C ${Math.round(n.c)} g</span><span class="f">G ${Math.round(n.f)} g</span>${m.tiempo_min ? `<span class="muted">${m.tiempo_min} min</span>` : ''}</div>
      <h3>Ingredientes <small>(1 porción, pesos en crudo)</small></h3>${linesHTML(lines, true)}${note}` : ''}
      <h3>Preparación</h3><ol class="steps">${(m.preparacion || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${m.consejo ? `<div class="note info">${esc(m.consejo)}</div>` : ''}
      <p class="hint">Receta generada por IA: revisá que los ingredientes te sirvan. Los valores nutricionales son aproximados.</p>`;
  }
}

function setSwap(idx, to) {
  const c = modCtx();
  if (c) { S.swaps[c] = S.swaps[c] || {}; if (to) S.swaps[c][idx] = to; else delete S.swaps[c][idx]; store.save(); }
  else if (to) MOD.temp[idx] = to; else delete MOD.temp[idx];
  MOD.open = null; drawMod(); render();
}

// =====================================================================
// Diario
// =====================================================================
let diaDate = null; // se inicializa al abrir el diario
function dateIdx(iso) { const [y, m, d] = iso.split('-').map(Number); return (new Date(y, m - 1, d).getDay() + 6) % 7; }
function shiftDate(iso, n) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
const logOf = (iso) => (S.log[iso] = S.log[iso] || { done: {}, items: [] });

function planMealsFor(d, slots) {
  return slots.map((s) => {
    if (S.aiPlan && S.menuSource === 'ia') {
      const day = S.aiPlan.dias[d]; const m = day && day.comidas.find((x) => x.comida === s.key);
      if (!m) return { s, name: '—', n: null };
      const free = !m.ingredientes || !m.ingredientes.length;
      return { s, name: m.nombre, n: free ? { k: s.k, p: s.p, c: s.c, f: s.f } : sumLines(aiLines(m, ctxKey(d, s.key, 'ia'))), free };
    }
    const rid = S.menu.days[d][s.key]; const r = R(rid);
    if (!r) return { s, name: '—', n: null };
    return { s, name: r.n, rid, n: mealNutr(rid, s, ctxKey(d, s.key, 'fit')), free: !!r.free };
  });
}

function pbar(label, v, t, cls, unit) {
  const pct = t ? (v / t) * 100 : 0;
  return `<div class="pb"><div class="pbh"><span>${label}</span><b>${Math.round(v)} / ${Math.round(t)} ${unit}</b></div>
    <div class="pbar ${cls} ${pct > 110 ? 'over' : ''}"><span style="width:${Math.min(100, pct)}%"></span></div></div>`;
}

function viewDiario() {
  if (!diaDate) diaDate = todayISO();
  const P = S.profile; const X = calc(P); const d = dateIdx(diaDate); const slots = daySlots(X, P, d); const T = sumSlots(slots);
  const L = S.log[diaDate] || { done: {}, items: [] };
  const meals = planMealsFor(d, slots);
  const eaten = { k: 0, p: 0, c: 0, f: 0 };
  Object.values(L.done).forEach((n) => { eaten.k += n.k; eaten.p += n.p; eaten.c += n.c; eaten.f += n.f; });
  L.items.forEach((n) => { eaten.k += n.k; eaten.p += n.p; eaten.c += n.c; eaten.f += n.f; });
  const isToday = diaDate === todayISO();
  const [y, mo, da] = diaDate.split('-');
  const left = T.k - eaten.k, leftP = T.p - eaten.p;
  return `
  <div class="datebar"><button class="ghost" data-x="dprev" aria-label="Día anterior">‹</button>
    <div><b>${isToday ? 'Hoy' : DAYS[d]}</b> <span class="muted">${da}/${mo}/${y}</span>${isTrainDay(P, d) ? ' <span class="pill tr">Entrenamiento</span>' : ''}</div>
    <button class="ghost" data-x="dnext" aria-label="Día siguiente">›</button></div>
  ${isToday ? '' : '<div class="actions center"><button class="ghost" data-x="dtoday">Ir a hoy</button></div>'}
  <section class="card">
    ${pbar('Calorías', eaten.k, T.k, 'k', 'kcal')}${pbar('Proteínas', eaten.p, T.p, 'p', 'g')}${pbar('Carbohidratos', eaten.c, T.c, 'c', 'g')}${pbar('Grasas', eaten.f, T.f, 'f', 'g')}
    <p class="hint">${left >= 0 ? `Te quedan <b>${Math.round(left)} kcal</b>` : `Te pasaste <b>${Math.round(-left)} kcal</b>`}${leftP > 0 ? ` y <b>${Math.round(leftP)} g de proteína</b>.` : ' y ya cubriste la proteína.'}</p>
  </section>
  <h2 class="sec">Comidas del plan</h2>
  <section class="card"><ul class="checks">${meals.map(({ s, name, n, free }) => `<li><label><input type="checkbox" data-done="${s.key}" ${L.done[s.key] ? 'checked' : ''} ${n ? '' : 'disabled'}>
    <span><small class="muted">${esc(s.name)}${trainPill(s) ? ' · ' + (s.pre ? 'pre-entreno' : 'post-entreno') : ''}</small><br>${esc(name)}</span><b>${n ? Math.round(n.k) + ' kcal' : ''}</b></label>${free ? '<small class="muted">Comida libre: se cuenta con el valor de esa comida del plan. Si sabés lo que comiste, cargalo abajo en vez de tildarla.</small>' : ''}</li>`).join('')}</ul>
  <p class="hint">Tildá lo que comiste. Si cambiaste un ingrediente, hacelo desde el Menú antes de tildar para que sume bien.</p></section>
  <h2 class="sec">Otros alimentos</h2>
  <section class="card">
    ${L.items.length ? `<ul class="opts">${L.items.map((it, i) => `<li><span>${esc(it.n)}</span><b>${Math.round(it.k)} kcal <button class="x" data-x="delitem" data-i="${i}" aria-label="Borrar">×</button></b><small>${it.g ? Math.round(it.g) + ' g · ' : ''}P ${Math.round(it.p)} · C ${Math.round(it.c)} · G ${Math.round(it.f)}</small></li>`).join('')}</ul>` : '<p class="hint">Nada cargado fuera del plan.</p>'}
    <div class="actions"><button data-x="addfood">+ Alimento</button><button class="ghost" data-x="scan">Escanear producto</button><button class="ghost" data-x="quick">Carga rápida</button></div>
  </section>`;
}

let ADD = null;
function foodSearchHTML(q) {
  const qq = q.trim().toLowerCase();
  const ids = Object.keys(FOODS).filter((id) => !qq || FOODS[id].n.toLowerCase().includes(qq)).sort((a, b) => FOODS[a].n.localeCompare(FOODS[b].n)).slice(0, 40);
  return ids.map((id) => `<li class="pick" data-x="pickfood" data-id="${id}"><span>${esc(FOODS[id].n)}</span><b>${Math.round(FOODS[id].k)} kcal</b><small>por 100 g · ${GROUPS[FOODS[id].g] || ''}</small></li>`).join('') || '<li><span class="muted">Sin resultados. Probá escanear el producto o usar la carga rápida.</span></li>';
}
function openAddFood() {
  ADD = null;
  $('#modalBody').innerHTML = `<h2>Agregar alimento</h2>
    <input id="fsearch" type="search" placeholder="Buscar alimento…" autocomplete="off">
    <ul class="opts" id="fres">${foodSearchHTML('')}</ul>`;
  $('#modal').showModal(); setTimeout(() => $('#fsearch') && $('#fsearch').focus(), 50);
}
function gramsForm(food, def, onAddLabel) {
  return `<div class="card inset"><b>${esc(food.n)}</b>
    <p class="hint">Por 100 g: ${Math.round(food.k)} kcal · P ${food.p} · C ${food.c} · G ${food.f}</p>
    <label>Cantidad (g)<input type="number" id="fgrams" inputmode="decimal" value="${def}"></label>
    <p class="hint" id="fprev"></p>
    <div class="actions"><button data-x="addfoodok">${onAddLabel}</button></div></div>`;
}
function updatePrev() {
  const g = +($('#fgrams') || {}).value || 0; const x = ADD && ADD.food; if (!x || !$('#fprev')) return;
  const m = g / 100; $('#fprev').innerHTML = `${g} g = <b>${Math.round(x.k * m)} kcal</b> · P ${Math.round(x.p * m)} · C ${Math.round(x.c * m)} · G ${Math.round(x.f * m)}${ADD.id && FOODS[ADD.id] && household(ADD.id, g) ? ' · ' + household(ADD.id, g) : ''}`;
}
function addItem(item) { const L = logOf(diaDate); L.items.push(item); store.save(); }

function openQuick() {
  $('#modalBody').innerHTML = `<h2>Carga rápida</h2><p class="hint">Para algo que no está en la lista (por ejemplo, una comida afuera). Si no sabés los macros, poné solo las calorías.</p>
    <form id="quickForm" class="grid2"><label class="span2">Qué comiste<input name="n" required></label>
    <label>Calorías<input name="k" type="number" inputmode="decimal" required></label><label>Proteínas (g)<input name="p" type="number" inputmode="decimal"></label>
    <label>Carbohidratos (g)<input name="c" type="number" inputmode="decimal"></label><label>Grasas (g)<input name="f" type="number" inputmode="decimal"></label>
    <button type="submit" class="span2">Agregar</button></form>`;
  $('#modal').showModal();
}

// =====================================================================
// Escáner de código de barras + Open Food Facts
// =====================================================================
let scanStream = null, scanTimer = null, SCAN = null;
function stopScan() {
  if (scanTimer) clearTimeout(scanTimer); scanTimer = null;
  if (scanStream) scanStream.getTracks().forEach((t) => t.stop()); scanStream = null;
}
async function openScan(forDiary) {
  SCAN = { forDiary, food: null };
  const can = 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  $('#modalBody').innerHTML = `<h2>Escanear producto</h2>
    ${can ? '<video id="scanVideo" class="scanvid" playsinline muted></video>' : ''}
    <p class="hint" id="scanMsg">${can ? 'Apuntá la cámara al código de barras del envase.' : 'Tu navegador no permite leer códigos con la cámara (funciona en Chrome para Android). Escribí los números del código.'}</p>
    <div class="grid2"><label>Código de barras<input id="scanCode" inputmode="numeric" placeholder="779…"></label><button data-x="scanlookup" style="align-self:end">Buscar</button></div>
    <div id="scanRes"></div>
    <p class="hint">Datos de <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a>, una base abierta cargada por usuarios: muchos productos argentinos no están o tienen datos incompletos. Revisá contra la etiqueta.</p>`;
  $('#modal').showModal();
  if (!can) return;
  try {
    let formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
    if (BarcodeDetector.getSupportedFormats) { const sup = await BarcodeDetector.getSupportedFormats(); formats = formats.filter((f) => sup.includes(f)); }
    const det = new BarcodeDetector({ formats });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const v = $('#scanVideo'); if (!v) { stopScan(); return; }
    v.srcObject = scanStream; await v.play();
    const tick = async () => {
      if (!scanStream) return;
      try { const codes = await det.detect(v); if (codes.length) { const code = codes[0].rawValue; stopScan(); $('#scanCode').value = code; lookupProduct(code); return; } } catch (_) { /* cuadro no listo */ }
      scanTimer = setTimeout(tick, 250);
    };
    tick();
  } catch (e) {
    stopScan(); const m = $('#scanMsg'); if (m) m.textContent = 'No se pudo abrir la cámara (¿diste permiso?). Podés escribir el código a mano.';
  }
}
function groupGuess(f) { const kp = f.p * 4, kc = f.c * 4, kf = f.f * 9; return kp >= kc && kp >= kf ? 'prot' : kc >= kf ? 'carb' : 'grasa'; }
async function lookupProduct(code) {
  code = String(code || '').replace(/\D/g, '');
  const box = $('#scanRes'); if (!box) return;
  if (code.length < 8) { box.innerHTML = '<div class="note warn">El código tiene que tener al menos 8 números.</div>'; return; }
  box.innerHTML = '<p class="hint">Buscando…</p>';
  const local = S.customFoods && S.customFoods['off_' + code];
  if (local) { showProduct(local, 'off_' + code, null); return; }
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,product_name_es,brands,quantity,serving_size,serving_quantity,nutriments`);
    const data = await res.json();
    const pr = data && data.status === 1 && data.product;
    if (!pr) { box.innerHTML = `<div class="note warn">El producto ${esc(code)} no está en Open Food Facts.</div>${manualFoodForm('', code)}`; return; }
    const nt = pr.nutriments || {};
    const num = (v) => (v === undefined || v === null || v === '' || isNaN(+v) ? null : +v);
    let k = num(nt['energy-kcal_100g']); if (k == null && num(nt.energy_100g) != null) k = num(nt.energy_100g) / 4.184;
    const p = num(nt.proteins_100g), c = num(nt.carbohydrates_100g), f = num(nt.fat_100g), fi = num(nt.fiber_100g) || 0;
    const name = [pr.product_name_es || pr.product_name || 'Producto ' + code, pr.brands ? `(${String(pr.brands).split(',')[0].trim()})` : ''].join(' ').trim();
    if (k == null || p == null || c == null || f == null) { box.innerHTML = `<div class="note warn">Encontré "${esc(name)}" pero sin información nutricional completa. Cargala desde la etiqueta:</div>${manualFoodForm(name, code, { k, p, c, f })}`; return; }
    const food = { n: name, g: 'prot', k: Math.round(k), p: Math.round(p * 10) / 10, c: Math.round(c * 10) / 10, f: Math.round(f * 10) / 10, fi, t: ['producto'], code };
    food.g = groupGuess(food);
    showProduct(food, 'off_' + code, num(pr.serving_quantity));
  } catch (e) {
    box.innerHTML = `<div class="note warn">No pude consultar Open Food Facts (¿sin internet?). Podés cargar el producto desde la etiqueta.</div>${manualFoodForm('', code)}`;
  }
}
function showProduct(food, id, serving) {
  SCAN.food = food; SCAN.id = id; ADD = { food, id: FOODS[id] ? id : null };
  $('#scanRes').innerHTML = `${gramsForm(food, serving || 100, 'Agregar al diario')}
    <div class="actions">${FOODS[id] ? '<span class="muted">Ya está en tus alimentos.</span>' : '<button class="ghost" data-x="scansave">Guardar en mis alimentos</button>'}</div>
    <p class="hint">Si lo guardás, aparece en la calculadora, en los reemplazos de ingredientes y en la búsqueda del diario.</p>`;
  updatePrev();
}
function manualFoodForm(name, code, v = {}) {
  const val = (x) => (x == null ? '' : Math.round(x * 10) / 10);
  return `<form id="manualFood" class="grid2" data-code="${esc(code || '')}"><label class="span2">Nombre<input name="n" value="${esc(name)}" required></label>
    <p class="hint span2">Valores cada 100 g, de la tabla nutricional del envase:</p>
    <label>Calorías<input name="k" type="number" step="0.1" inputmode="decimal" value="${val(v.k)}" required></label><label>Proteínas (g)<input name="p" type="number" step="0.1" inputmode="decimal" value="${val(v.p)}" required></label>
    <label>Carbohidratos (g)<input name="c" type="number" step="0.1" inputmode="decimal" value="${val(v.c)}" required></label><label>Grasas (g)<input name="f" type="number" step="0.1" inputmode="decimal" value="${val(v.f)}" required></label>
    <button type="submit" class="span2">Guardar en mis alimentos</button></form>`;
}
function saveCustomFood(id, food) { S.customFoods = S.customFoods || {}; S.customFoods[id] = food; FOODS[id] = food; store.save(); }

// =====================================================================
// Calculadora
// =====================================================================
let calcFood = 'carne_magra', calcG = 150, calcType = null, calcSlot = 'almuerzo', calcMacro = 'p', calcNeed = null;

function foodSelect(id, sel) {
  return `<select id="${id}">${Object.keys(GROUPS).map((g) => { const ids = Object.keys(FOODS).filter((k) => FOODS[k].g === g).sort((a, b) => FOODS[a].n.localeCompare(FOODS[b].n)); return ids.length ? `<optgroup label="${GROUPS[g]}">${ids.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(FOODS[k].n)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select>`;
}
function convResHTML() {
  const x = FOODS[calcFood]; if (!x) return '';
  const macro = isProtSrc(x) ? 'p' : macroOfFood(x); const g = +calcG || 0; const base = foodLine(calcFood, g); const amount = macro === 'g' ? g : base[macro];
  const cands = swapCandidates(macro, x.g, calcFood);
  return `<p class="hint">${g} g de ${esc(x.n)} aportan <b>${Math.round(base.k)} kcal</b> · P ${Math.round(base.p)} · C ${Math.round(base.c)} · G ${Math.round(base.f)}. Se compara por <b>${MACRO_TXT[macro]}</b>${macro === 'g' ? '' : ` (${(Math.round(amount * 10) / 10).toString().replace('.', ',')} g)`}:</p>
    <ul class="opts">${cands.map((id) => { const gg = equivGrams(amount, macro, id); const n = foodLine(id, gg); const dk = Math.round(n.k - base.k);
      return `<li><span>${esc(FOODS[id].n)}</span><b>${gg} g</b><small>${household(id, gg) ? household(id, gg) + ' · ' : ''}${Math.round(n.k)} kcal (${dk >= 0 ? '+' : ''}${dk}) · P ${Math.round(n.p)} · C ${Math.round(n.c)} · G ${Math.round(n.f)}</small></li>`; }).join('')}</ul>`;
}
function calcSlots() {
  const P = S.profile; const X = calc(P); const td = P.trainDays || [];
  let d = todayIdx();
  if (calcType === 'train' && td.length) d = td.includes(d) ? d : td[0];
  if (calcType === 'rest' && td.length < 7) d = !td.includes(d) ? d : [0, 1, 2, 3, 4, 5, 6].find((i) => !td.includes(i));
  return daySlots(X, P, d);
}
function needTarget() {
  const s = calcSlots().find((x) => x.key === calcSlot) || calcSlots()[0];
  if (s.type === 'principal') { const pl = plate(s, S.profile); return { p: pl.Pn, c: pl.C, f: pl.F, s, plate: true }; }
  return { p: s.p, c: s.c, f: s.f, s, plate: false };
}
function needResHTML() {
  const T = needTarget(); const amt = calcNeed != null ? calcNeed : T[calcMacro];
  const ex = new Set(S.profile.excluded || []);
  const ids = Object.keys(FOODS).filter((id) => {
    const x = FOODS[id]; if (ex.has(id) || x[calcMacro] <= 0) return false;
    if (calcMacro === 'p') return isProtSrc(x);
    if (calcMacro === 'c') return isCarbSrc(x);
    return isFatSrc(x);
  }).sort((a, b) => FOODS[a].n.localeCompare(FOODS[b].n));
  return `<ul class="opts">${ids.map((id) => { const g = equivGrams(amt, calcMacro, id); const n = foodLine(id, g);
    return `<li><span>${esc(FOODS[id].n)}</span><b>${g} g</b><small>${household(id, g) ? household(id, g) + ' · ' : ''}${Math.round(n.k)} kcal · también aporta ${calcMacro !== 'p' ? 'P ' + Math.round(n.p) + ' g ' : ''}${calcMacro !== 'c' ? 'C ' + Math.round(n.c) + ' g ' : ''}${calcMacro !== 'f' ? 'G ' + Math.round(n.f) + ' g' : ''}</small></li>`; }).join('')}</ul>`;
}
function viewCalc() {
  const P = S.profile; const td = P.trainDays || [];
  if (!calcType) calcType = isTrainDay(P, todayIdx()) ? 'train' : 'rest';
  const slots = calcSlots(); if (!slots.some((s) => s.key === calcSlot)) calcSlot = slots[0].key;
  if (!FOODS[calcFood]) calcFood = 'carne_magra';
  const T = needTarget(); const val = calcNeed != null ? calcNeed : Math.round(T[calcMacro]);
  return `<h2 class="sec">Calculadora</h2>
  <section class="card"><h3>¿Cuánto puedo comer?</h3>
    <p class="hint">Elegí la comida y el grupo: te dice cuántos gramos de cada alimento cubren esa parte de tu plan (pesos en crudo). Elegí <b>uno</b> por grupo.</p>
    ${td.length && td.length < 7 ? `<div class="seg"><button class="${calcType === 'train' ? 'on' : ''}" data-x="ctype" data-v="train">Día de entrenamiento</button><button class="${calcType === 'rest' ? 'on' : ''}" data-x="ctype" data-v="rest">Día de descanso</button></div>` : ''}
    <div class="chips wrap">${slots.map((s) => `<button class="chip ${s.key === calcSlot ? 'on' : ''}" data-x="cslot" data-k="${s.key}">${esc(s.name)}</button>`).join('')}</div>
    <div class="chips">${[['p', 'Proteínas'], ['c', 'Carbohidratos'], ['f', 'Grasas']].map(([k, l]) => `<button class="chip ${k === calcMacro ? 'on' : ''}" data-x="cmacro" data-k="${k}">${l}</button>`).join('')}</div>
    <label style="margin-top:10px">Gramos de ${MACRO_TXT[calcMacro]} a cubrir<input type="number" id="cneed" inputmode="decimal" value="${val}"></label>
    <p class="hint">${T.plate ? `En almuerzo y cena ya se descuenta lo que aportan ~${T.s.pct >= 20 ? 250 : 150} g de verduras y, para la proteína, lo que suman los carbohidratos del plato.` : 'Objetivo completo de esa comida.'}${calcNeed != null ? ' <a href="#" data-x="cneedreset">Volver al valor del plan</a>' : ''}</p>
    <div id="needRes">${needResHTML()}</div>
  </section>
  <section class="card"><h3>Convertir un alimento en otro</h3>
    <p class="hint">Ej.: 150 g de carne → ¿cuánto pollo es lo mismo en proteína?</p>
    <div class="grid2"><label>Cantidad (g)<input type="number" id="cg" inputmode="decimal" value="${calcG}"></label><label>Alimento${foodSelect('cfood', calcFood)}</label></div>
    <div id="convRes">${convResHTML()}</div>
  </section>`;
}

// =====================================================================
// Más
// =====================================================================
function viewMas() {
  const mine = Object.entries(S.customFoods || {});
  const tile = (tab, ico, t, d, x) => `<button class="tile" ${x ? `data-x="${x}"` : `data-tab="${tab}"`}><span class="ico">${ico}</span><b>${t}</b><small>${d}</small></button>`;
  return `<h2 class="sec">Más</h2>
  <div class="tiles">
    ${tile('calc', '⚖️', 'Calculadora', 'Gramos por grupo y equivalencias')}
    ${tile('recetas', '🍽️', 'Recetas', 'Buscar y marcar favoritas')}
    ${tile('chat', '💬', 'Chat IA', 'Consultas a tu nutri IA')}
    ${tile('', '📷', 'Escanear', 'Código de barras de un producto', 'scan')}
    ${tile('perfil', '👤', 'Perfil', 'Datos, objetivos, entrenamiento')}
  </div>
  <section class="card"><h3>Mis alimentos</h3>
    ${mine.length ? `<ul class="opts">${mine.map(([id, x]) => `<li><span>${esc(x.n)}</span><b>${Math.round(x.k)} kcal <button class="x" data-x="delfood" data-id="${esc(id)}" aria-label="Borrar">×</button></b><small>por 100 g · P ${x.p} · C ${x.c} · G ${x.f}</small></li>`).join('')}</ul>` : '<p class="hint">Los productos que escanees o cargues a mano aparecen acá.</p>'}
    <div class="actions"><button class="ghost" data-x="scan">Escanear producto</button><button class="ghost" data-x="newfood">Cargar a mano</button></div>
  </section>`;
}

// =====================================================================
// Eventos
// =====================================================================
function xAction(t) {
  const a = t.dataset.x; const d = t.dataset;
  if (a === 'swapopen') { MOD.open = MOD.open === +d.idx ? null : +d.idx; drawMod(); return; }
  if (a === 'swapto') { setSwap(+d.idx, d.to); toast('Ingrediente reemplazado'); return; }
  if (a === 'swapreset') { setSwap(+d.idx, null); return; }
  if (a === 'mslot') { MOD.slot = MOD.slots.find((s) => s.key === d.k); MOD.open = null; drawMod(); return; }
  if (a === 'dprev') { diaDate = shiftDate(diaDate, -1); render(); return; }
  if (a === 'dnext') { diaDate = shiftDate(diaDate, 1); render(); return; }
  if (a === 'dtoday') { diaDate = todayISO(); render(); return; }
  if (a === 'delitem') { logOf(diaDate).items.splice(+d.i, 1); store.save(); render(); return; }
  if (a === 'addfood') { openAddFood(); return; }
  if (a === 'pickfood') { const food = FOODS[d.id]; ADD = { food, id: d.id }; $('#fres').innerHTML = ''; $('#fsearch').insertAdjacentHTML('afterend', gramsForm(food, food.u && food.u[1] >= 20 ? food.u[1] : 100, 'Agregar al diario')); $('#fsearch').remove(); updatePrev(); return; }
  if (a === 'addfoodok') {
    const g = +($('#fgrams') || {}).value || 0; if (!g || !ADD) { toast('Poné la cantidad'); return; }
    const x = ADD.food; const m = g / 100;
    addItem({ n: x.n, g, k: x.k * m, p: x.p * m, c: x.c * m, f: x.f * m, id: ADD.id || null });
    stopScan(); $('#modal').close(); TAB = 'diario'; render(); toast('Agregado al diario'); return;
  }
  if (a === 'quick') { openQuick(); return; }
  if (a === 'scan') { openScan(TAB === 'diario'); return; }
  if (a === 'scanlookup') { stopScan(); lookupProduct(($('#scanCode') || {}).value); return; }
  if (a === 'scansave') { saveCustomFood(SCAN.id, SCAN.food); ADD.id = SCAN.id; toast('Guardado en tus alimentos'); showProduct(SCAN.food, SCAN.id, +($('#fgrams') || {}).value || 100); render(); return; }
  if (a === 'newfood') { SCAN = { forDiary: false }; $('#modalBody').innerHTML = `<h2>Cargar alimento</h2><div id="scanRes">${manualFoodForm('', '')}</div>`; $('#modal').showModal(); return; }
  if (a === 'delfood') { if (confirm('¿Borrar este alimento de tu lista?')) { delete S.customFoods[d.id]; delete FOODS[d.id]; store.save(); render(); } return; }
  if (a === 'ctype') { calcType = d.v; calcNeed = null; render(); return; }
  if (a === 'cslot') { calcSlot = d.k; calcNeed = null; render(); return; }
  if (a === 'cmacro') { calcMacro = d.k; calcNeed = null; render(); return; }
  if (a === 'cneedreset') { calcNeed = null; render(); return; }
  if (a === 'ptype') { planType = d.v; render(); return; }
  if (a === 'seenupd') { S.seenVersion = APP_VERSION; store.save(); if (d.go) TAB = d.go; render(); return; }
  if (a === 'discarddraft') { if (confirm('¿Descartar lo que no guardaste?')) { draft.clear(); render(); } }
}

document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'fsearch') $('#fres').innerHTML = foodSearchHTML(e.target.value);
  if (id === 'fgrams') updatePrev();
  if (id === 'cg') { calcG = +e.target.value || 0; $('#convRes').innerHTML = convResHTML(); }
  if (id === 'cneed') { calcNeed = e.target.value === '' ? null : +e.target.value; $('#needRes').innerHTML = needResHTML(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'cfood') { calcFood = t.value; $('#convRes').innerHTML = convResHTML(); }
  if (t.dataset && t.dataset.done) {
    const L = logOf(diaDate); const P = S.profile; const d = dateIdx(diaDate);
    const it = planMealsFor(d, daySlots(calc(P), P, d)).find((x) => x.s.key === t.dataset.done);
    if (t.checked && it && it.n) L.done[t.dataset.done] = { name: it.name, k: it.n.k, p: it.n.p, c: it.n.c, f: it.n.f }; else delete L.done[t.dataset.done];
    store.save(); render();
  }
  if (t.name && t.name.startsWith('sp_') && t.closest('#pform')) { const box = document.querySelector(`.spc[data-for="${t.name.slice(3)}"]`); if (box) { box.hidden = t.value !== 'custom'; if (t.value === 'custom') box.querySelector('input').focus(); } }
  if (t.name === 'meals' && t.closest('#pform')) { const box = $('#mealTimes'); if (box) box.innerHTML = mealTimesHTML(S.profile || {}, +t.value); }
});
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.id === 'quickForm') {
    e.preventDefault(); const fd = new FormData(f); const n = (k) => +(fd.get(k) || 0);
    addItem({ n: fd.get('n').trim(), g: 0, k: n('k'), p: n('p'), c: n('c'), f: n('f') });
    $('#modal').close(); render(); toast('Agregado al diario');
  }
  if (f.id === 'manualFood') {
    e.preventDefault(); const fd = new FormData(f); const n = (k) => +(fd.get(k) || 0);
    const code = f.dataset.code; const id = code ? 'off_' + code : 'my_' + Date.now();
    const food = { n: fd.get('n').trim(), g: 'prot', k: n('k'), p: n('p'), c: n('c'), f: n('f'), fi: 0, t: ['producto'], code: code || null };
    food.g = groupGuess(food); saveCustomFood(id, food); toast('Guardado en tus alimentos');
    if (SCAN && SCAN.forDiary !== undefined && $('#scanRes')) { SCAN.food = food; SCAN.id = id; showProduct(food, id, 100); }
    render();
  }
});
document.getElementById('modal').addEventListener('close', () => { stopScan(); MOD = null; });
