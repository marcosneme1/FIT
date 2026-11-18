/* Fit — funciones con IA (Google Gemini). Opcional: cada usuario usa su propia clave de API.
   Las calorías y macros los calculan las fórmulas de app.js; Gemini arma el contenido
   (preguntas de seguimiento, plan explicado, menú, recetas y chat) respetando esos objetivos. */
'use strict';

const GEM_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const aiReady = () => !!(S.ai && S.ai.key && S.ai.model);
let aiAbort = null;

// ---------------- Cliente de la API ----------------
// Pedido a la API con límite de tiempo. Distingue: error de Google (con código), tiempo agotado y "no llegó respuesta".
async function gemFetch(path, body, signal, key = S.ai && S.ai.key, ms = 90000) {
  const ctl = new AbortController(); let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let res, data;
  try {
    res = await fetch(`${GEM_BASE}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'x-goog-api-key': key }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    if (timedOut) { const err = new Error(`Gemini tardó más de ${Math.round(ms / 1000)} segundos en responder.`); err.status = 'timeout'; err.raw = 'timeout'; throw err; }
    if (signal && signal.aborted) throw new DOMException('Cancelado', 'AbortError');
    const err = new Error('No llegó respuesta de Gemini: la conexión se cortó o Google cerró el pedido sin responder.'); err.status = 'network'; err.raw = String((e && e.message) || e); throw err;
  } finally {
    clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort);
  }
  if (!res.ok) {
    const msg = (data.error && data.error.message) || res.statusText || 'Error desconocido';
    const err = new Error(friendlyError(res.status, msg)); err.status = res.status; err.raw = msg; throw err;
  }
  return data;
}

function friendlyError(status, msg) {
  if (status === 400 && /api key|API_KEY/i.test(msg)) return 'La clave de API no es válida. Revisala en Perfil → Inteligencia artificial.';
  if (status === 403) return 'La clave no tiene permiso para usar Gemini (403). Generá una nueva en aistudio.google.com/apikey.';
  if (status === 404) return 'El modelo elegido no está disponible. Elegí otro en Perfil → Inteligencia artificial.';
  if (status === 429) return 'Se alcanzó el límite de uso de tu clave (429). Esperá un minuto y probá de nuevo.';
  if (status >= 500) return `Gemini no respondió (error ${status}${/overload|unavailable|high demand/i.test(msg) ? ': modelo saturado' : ''}). Probá de nuevo en unos minutos o elegí otro modelo en Más → Perfil → Inteligencia artificial. Detalle: ${String(msg).slice(0, 160)}`;
  return msg;
}

async function listModels(key) {
  let models = []; let token = '';
  do {
    const d = await gemFetch(`models?pageSize=100${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, null, undefined, key);
    models = models.concat(d.models || []); token = d.nextPageToken || '';
  } while (token);
  return models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name)
      && !/(embed|image|tts|audio|live|aqa|robotics|computer-use|native)/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name.replace(/^models\//, '') }));
}

function pickDefaultModel(list) {
  const std = list.filter((m) => modelInfo(m.id) && modelInfo(m.id).fam === 'flash');
  if (std.length) list = std;
  const ver = (id) => { const m = id.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  const score = (id) => ver(id) * 10 + (/flash/.test(id) ? 3 : 0) - (/lite/.test(id) ? 2 : 0) - (/(preview|exp)/.test(id) ? 5 : 0) - (/-\d{3}$/.test(id) ? 0.5 : 0) - (/latest/.test(id) ? 0.2 : 0);
  return list.slice().sort((a, b) => score(b.id) - score(a.id))[0]?.id || null;
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Cancelado', 'AbortError')); }, { once: true });
});
function rankedModels() {
  const ver = (id) => { const m = id.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  const score = (id) => ver(id) * 10 + (/flash/.test(id) ? 3 : 0) - (/lite/.test(id) ? 2 : 0) - (/(preview|exp)/.test(id) ? 5 : 0) - (/pro/.test(id) ? 4 : 0);
  return (S.ai.models || []).map((m) => m.id).sort((a, b) => score(b) - score(a));
}
// Llama a Gemini con reintentos: si el modelo está saturado (5xx) reintenta, y si sigue fallando
// (o no existe, o se agotó su cupo) prueba con otros modelos de la lista.
const modelVer = (id) => { const m = String(id).match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
// Nombres "estándar" de modelos (ej.: gemini-2.5-flash, gemini-3.8-flash-lite, gemini-2.0-flash-001).
// Los experimentales o con nombre clave (ej.: gemini-4-argon, *-preview) no se usan como alternativa automática.
function modelInfo(id) {
  const m = String(id).match(/^gemini-(\d+(?:\.\d+)?)-(flash|pro)(-lite)?(?:-(\d{3}|latest))?$/);
  return m ? { v: parseFloat(m[1]), fam: m[2], lite: !!m[3] } : null;
}
function stdModels() {
  return (S.ai.models || []).map((m) => m.id).map((id) => ({ id, i: modelInfo(id) })).filter((x) => x.i);
}
// Orden de modelos a probar: el elegido, el Flash-Lite más nuevo (más liviano y, en general, con más capacidad),
// el Flash de una generación anterior y otro Flash-Lite anterior.
function fallbackOrder() {
  const cur = S.ai.model; const cv = modelVer(cur); const out = [cur];
  const all = stdModels().filter((x) => x.id !== cur && x.i.fam === 'flash');
  const byV = (a, b) => b.i.v - a.i.v;
  const lites = all.filter((x) => x.i.lite).sort(byV);
  const older = all.filter((x) => !x.i.lite && x.i.v < cv).sort(byV);
  [lites[0], older[0], lites.find((x) => x.i.v < cv && x !== lites[0]), older[1]].forEach((x) => { if (x && !out.includes(x.id)) out.push(x.id); });
  return out.slice(0, 4);
}
// Pedido mínimo a un modelo para ver si responde.
async function pingModel(m, signal, ms = 25000) {
  const t0 = Date.now();
  try {
    const d = await gemFetch(`models/${m}:generateContent`, { contents: userMsg('Respondé solamente: OK') }, signal, S.ai.key, ms);
    const cand = d.candidates && d.candidates[0];
    const txt = ((cand && cand.content && cand.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    return { m, ok: !!txt, code: 200, ms: Date.now() - t0, det: txt ? txt.slice(0, 40) : `sin texto (${(cand && cand.finishReason) || '—'})` };
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return { m, ok: false, code: e.status, ms: Date.now() - t0, det: String(e.raw || e.message).slice(0, 160) };
  }
}
const isTransient = (e) => e.status === 'timeout' || e.status === 'network' || e.status >= 500;
// Misma consulta pero sin esquema estricto: el formato se pide por escrito (algunos modelos fallan con esquemas).
function noSchemaBody(body) {
  const sch = body.generationConfig && body.generationConfig.responseSchema; if (!sch) return body;
  const b2 = JSON.parse(JSON.stringify(body)); delete b2.generationConfig.responseSchema;
  b2.contents = b2.contents.concat([{ role: 'user', parts: [{ text: 'Respondé SOLO con JSON válido (sin texto extra ni ```), siguiendo exactamente esta estructura (JSON Schema): ' + JSON.stringify(sch) }] }]);
  return b2;
}
async function gemCall(body, signal) {
  const order = fallbackOrder();
  let lastErr;
  for (const model of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const d = await gemFetch(`models/${model}:generateContent`, attempt ? noSchemaBody(body) : body, signal);
        if (model !== S.ai.model) { const prev = S.ai.model; S.ai.model = model; store.save(); toast(`${prev} no respondía: se usó ${model}`); }
        return d;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        const hasSchema = !!(body.generationConfig && body.generationConfig.responseSchema);
        if (attempt < 1 && ((typeof e.status === 'number' && e.status >= 500) || (hasSchema && e.status === 400 && /schema/i.test(e.raw || '')))) { busyMsg(hasSchema ? 'Reintentando con un pedido más simple…' : 'Gemini no respondió bien, reintentando…'); await sleep(2000, signal); continue; }
        if (isTransient(e) || e.status === 404 || e.status === 429) { busyMsg(`${model} falló: probando con otro modelo…`); break; }
        throw e;
      }
    }
  }
  throw lastErr;
}

async function gemGenerate({ system, contents, schema, temperature = 0.7, signal }) {
  const body = { contents, generationConfig: { temperature } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (schema) { body.generationConfig.responseMimeType = 'application/json'; body.generationConfig.responseSchema = schema; }
  let d;
  d = await gemCall(body, signal);
  const cand = d.candidates && d.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text) {
    const why = (cand && cand.finishReason) || (d.promptFeedback && d.promptFeedback.blockReason) || 'sin motivo';
    throw new Error(`Gemini no devolvió respuesta (${why}). Probá de nuevo.`);
  }
  if (!schema) return text;
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
    return JSON.parse(clean.slice(a, b + 1));
  } catch (_) {
    throw new Error(cand && cand.finishReason === 'MAX_TOKENS' ? 'La respuesta de la IA vino cortada (demasiado larga). Probá de nuevo o elegí otro modelo.' : 'La IA devolvió un formato inválido. Probá de nuevo.');
  }
}
const userMsg = (text) => [{ role: 'user', parts: [{ text }] }];

// ---------------- Contexto y prompts ----------------
const AI_SYSTEM = `Sos licenciado/a en Nutrición en Argentina, con especialización en nutrición deportiva y composición corporal.
Hablás en español rioplatense con voseo, claro, concreto y sin adular.
Usás comidas, cortes, productos y nombres de Argentina (por ejemplo: nalga, peceto, cuadrada, vacío, merluza, zapallito, zapallo, choclo, chauchas, polenta, milanesa, tarta, tortilla, guiso, mate) que se consiguen en supermercados y verdulerías comunes.
Reglas:
1) Respetá SIEMPRE los objetivos numéricos que te paso (calorías y macros); no los recalcules ni los cambies.
2) Nunca uses alimentos excluidos ni comidas que la persona dijo que no come.
3) Los gramos de los ingredientes son en crudo o tal cual se compran.
4) Los valores nutricionales por ingrediente tienen que salir de tablas de composición (USDA, ARGENFOODS). Si dudás, usá un valor típico conservador. No inventes productos ni marcas.
5) No diagnostiques ni indiques medicación. Si hay condiciones de salud, recordá que el plan debe validarlo un profesional.
6) Porciones realistas y recetas prácticas para cocinar en casa.`;

function aiProfileText() {
  const P = S.profile; const X = calc(P);
  const ex = (P.excluded || []).map((id) => FOODS[id] && FOODS[id].n).filter(Boolean);
  const sp = Object.entries(P.specials || {}).map(([k, id]) => { const [d, slot] = k.split('-'); const r = id === 'custom' ? customSpecial(k, P) : RECIPES.find((x) => x.id === id); return `${DAYS[+d]} ${slot}: ${r ? r.n + (r.custom && r.kcal ? ` (≈ ${r.kcal} kcal)` : '') : id}`; });
  const lines = [
    'PERFIL',
    `- Sexo: ${P.sex === 'M' ? 'masculino' : 'femenino'}; edad ${P.age}; altura ${P.height} cm; peso ${P.weight} kg`,
    `- Medidas: cintura ${P.waist || '—'} cm, cuello ${P.neck || '—'} cm, cadera ${P.hip || '—'} cm; % grasa ${X.bf ? X.bf.toFixed(1) + ' % (' + X.bfSrc + ')' : 'sin dato'}; IMC ${X.bmi.toFixed(1)}`,
    `- Trabajo: ${{ sentado: 'sentado casi todo el día', mixto: 'mixto', pie: 'de pie', fisico: 'físico pesado' }[P.job]}`,
    `- Entrenamiento: fuerza ${P.strDays} días x ${P.strMin} min; cardio/deporte (${P.cardType}) ${P.cardDays} días x ${P.cardMin} min; experiencia en fuerza: ${{ nov: 'menos de 6 meses', int: '6 meses a 2 años', adv: 'más de 2 años' }[P.experience]}`,
    `- Objetivos: ${(P.goals || []).map((g) => GOALS[g]).join(', ')}; modo calculado: ${X.modeTxt}; ritmo ${P.pace}`,
    `- Salud: ${(P.health || []).length ? P.health.map((h) => HEALTH[h]).join(', ') : 'sin condiciones informadas'}`,
    `- Comidas por día: ${P.meals}; desayuno/merienda: ${P.breakfast}; lleva vianda: ${P.vianda ? 'sí (la cena de un día es el almuerzo del siguiente)' : 'no'}`,
    `- Alimentos excluidos: ${ex.length ? ex.join(', ') : 'ninguno'}`,
  ];
  const free = [['likes', 'Le gusta'], ['dislikes', 'No le gusta / no come'], ['sacred', 'Comidas que no quiere resignar'], ['schedule', 'Horarios'], ['typical', 'Lo que come hoy en un día típico'], ['city', 'Ciudad/provincia'], ['budget', 'Presupuesto'], ['notes', 'Otras aclaraciones']];
  free.forEach(([k, l]) => { if (P[k]) lines.push(`- ${l}: ${P[k]}`); });
  if (sp.length) lines.push(`- Comidas especiales fijas: ${sp.join('; ')}`);
  if (P.aiAnswers && P.aiAnswers.length) {
    lines.push('', 'RESPUESTAS A PREGUNTAS DE SEGUIMIENTO');
    P.aiAnswers.forEach((qa) => { if (qa.a) lines.push(`- ${qa.q} → ${qa.a}`); });
  }
  lines.push('', 'OBJETIVOS CALCULADOS (no los cambies)',
    `- Promedio diario: ${X.kcal} kcal; proteínas ${X.p} g; carbohidratos ${X.c} g; grasas ${X.f} g; fibra ≥ ${X.fib} g; agua ≈ ${X.water} L`,
    `- Gasto estimado ${Math.round(X.tdee)} kcal; ajuste ${Math.round(X.adj * 100)} %`,
  );
  const fmt = (sl) => sl.map((s) => `  · ${s.key} (${s.name}, ${mealTime(P, s.key)}${s.pre ? ', pre-entreno' : s.post ? ', post-entreno' : ''}): ${Math.round(s.k)} kcal, P ${Math.round(s.p)} g, C ${Math.round(s.c)} g, G ${Math.round(s.f)} g`);
  const td = P.trainDays || [];
  if (td.length && td.length < 7) {
    const rest = [0, 1, 2, 3, 4, 5, 6].find((i) => !td.includes(i));
    lines.push(`- Entrena: ${td.map((i) => DAYS[i]).join(', ')}${P.trainTime ? ' a las ' + P.trainTime : ''}. Esos días llevan más carbohidratos (sobre todo antes y después de entrenar) y los de descanso menos; proteína y grasas iguales. Las metas ya compensan las comidas especiales.`,
      '- Objetivo por comida en DÍA DE ENTRENAMIENTO:', ...fmt(daySlots(X, P, td[0])),
      '- Objetivo por comida en DÍA DE DESCANSO:', ...fmt(daySlots(X, P, rest)));
  } else {
    lines.push('- Objetivo por comida (ya compensan las comidas especiales):', ...fmt(daySlots(X, P, 0)));
  }
  return lines.join('\n');
}

const S_STR = { type: 'STRING' };
const S_ING = {
  type: 'OBJECT',
  properties: { nombre: S_STR, gramos: { type: 'NUMBER' }, medida_casera: S_STR, kcal: { type: 'NUMBER' }, proteinas: { type: 'NUMBER' }, carbohidratos: { type: 'NUMBER' }, grasas: { type: 'NUMBER' } },
  required: ['nombre', 'gramos', 'kcal', 'proteinas', 'carbohidratos', 'grasas'],
};
const mealSchema = (keys) => ({
  type: 'OBJECT',
  properties: {
    comida: keys ? { type: 'STRING', enum: keys } : S_STR, nombre: S_STR, tiempo_min: { type: 'INTEGER' },
    ingredientes: { type: 'ARRAY', items: S_ING }, preparacion: { type: 'ARRAY', items: S_STR }, consejo: S_STR,
  },
  required: ['comida', 'nombre', 'ingredientes', 'preparacion'],
});

function mealTotals(m) {
  return (m.ingredientes || []).reduce((t, i) => ({ k: t.k + (+i.kcal || 0), p: t.p + (+i.proteinas || 0), c: t.c + (+i.carbohidratos || 0), f: t.f + (+i.grasas || 0) }), { k: 0, p: 0, c: 0, f: 0 });
}

// ---------------- Flujos ----------------
function busy(msg) {
  aiAbort = new AbortController();
  $('#busyMsg').textContent = msg; $('#busy').hidden = false;
  return aiAbort.signal;
}
function busyMsg(msg) { $('#busyMsg').textContent = msg; }
function idle() { $('#busy').hidden = true; aiAbort = null; }
function aiFail(e) {
  idle();
  if (e && e.name === 'AbortError') { toast('Cancelado'); return; }
  alert('No se pudo completar: ' + (e && e.message ? e.message : e) + '\n\nPara ver el detalle: Más → Perfil → Inteligencia artificial → Probar conexión.');
}

async function aiConnect() {
  const key = ($('#aiKey') || {}).value?.trim();
  if (!key) { toast('Pegá tu clave de API'); return; }
  busy('Conectando con Gemini…');
  try {
    const models = await listModels(key);
    if (!models.length) throw new Error('La clave funciona pero no se encontraron modelos de texto disponibles.');
    S.ai = { key, models, model: (S.ai && models.some((m) => m.id === S.ai.model)) ? S.ai.model : pickDefaultModel(models) };
    store.save();
    // Elegir un modelo que esté respondiendo ahora (los más nuevos suelen estar saturados).
    let chosen = null;
    for (const m of fallbackOrder()) { busyMsg(`Probando ${m}…`); const r = await pingModel(m, aiAbort && aiAbort.signal, 20000); if (r.ok) { chosen = m; break; } }
    if (chosen) S.ai.model = chosen;
    store.save(); idle(); render();
    toast(chosen ? `Gemini conectado (${chosen})` : 'Clave válida, pero ningún modelo respondió ahora. Probá más tarde con "Probar conexión".');
  } catch (e) { aiFail(e); }
}

// Paso 1: preguntas de seguimiento
async function aiStart() {
  const signal = busy('La IA está revisando tu perfil…');
  try {
    const r = await gemGenerate({
      system: AI_SYSTEM, signal, temperature: 0.5,
      schema: { type: 'OBJECT', properties: { preguntas: { type: 'ARRAY', items: S_STR } }, required: ['preguntas'] },
      contents: userMsg(`${aiProfileText()}

Antes de armar el plan, revisá el perfil como en una primera consulta. Hacé entre 3 y 6 preguntas de seguimiento que te falten para personalizar el plan (por ejemplo: horarios de comidas y entrenamiento, qué come hoy, cómo cocina, presupuesto, comidas que extraña, digestión, hambre/ansiedad). No preguntes lo que ya está respondido. Preguntas cortas, de a una por ítem.`),
    });
    idle();
    const qs = (r.preguntas || []).slice(0, 6);
    const prev = Object.fromEntries((S.profile.aiAnswers || []).map((x) => [x.q, x.a]));
    $('#modalBody').innerHTML = `<h2>Unas preguntas más</h2>
      <p class="hint">Respondé las que quieras: cuanto más contás, más personalizado sale el plan.</p>
      <form id="aiQForm">${qs.map((q, i) => `<label class="qa">${esc(q)}<textarea name="q${i}" rows="2" data-q="${esc(q)}">${esc(prev[q] || '')}</textarea></label>`).join('')}
      <div class="actions"><button type="submit">Armar mi plan con IA</button></div></form>`;
    $('#aiQForm').onsubmit = (e) => {
      e.preventDefault();
      S.profile.aiAnswers = [...e.target.querySelectorAll('textarea')].map((t) => ({ q: t.dataset.q, a: t.value.trim() }));
      store.save(); $('#modal').close(); aiBuildPlan();
    };
    $('#modal').showModal();
  } catch (e) { aiFail(e); }
}

// Paso 2: plan explicado + menú semanal
async function aiBuildPlan() {
  const P = S.profile; const X = calc(P); const keys = X.slots.map((s) => s.key);
  const signal = busy('Armando tu plan con IA (puede tardar 1–2 minutos)…');
  const ctx = aiProfileText();
  const daySchema = { type: 'OBJECT', properties: { dias: { type: 'ARRAY', items: { type: 'OBJECT', properties: { dia: S_STR, comidas: { type: 'ARRAY', items: mealSchema(keys) } }, required: ['dia', 'comidas'] } } }, required: ['dias'] };
  const daysPrompt = (names, extra) => `${ctx}

Armá el menú para estos días: ${names.join(', ')}.
- Cada día lleva una receta por comida, con estas claves y en este orden: ${keys.join(', ')}.
- Cada comida tiene que quedar cerca (±10 %) de su objetivo de kcal y macros${(P.trainDays || []).length && P.trainDays.length < 7 ? ` (usá los objetivos de DÍA DE ENTRENAMIENTO para ${P.trainDays.map((i) => DAYS[i]).join(', ')} y los de DÍA DE DESCANSO para el resto)` : ''}.
${P.vianda ? '- Vianda: el almuerzo de cada día es la misma receta que la cena del día anterior, con la porción del almuerzo (salvo que esa cena sea una comida especial).\n' : ''}- Comidas especiales fijas: incluilas con ese plato y una porción razonable (no hace falta que cumplan el objetivo; ya está compensado). Si es "Comida libre", poné nombre "Comida libre", ingredientes vacíos y un consejo en preparación.
- Variá las proteínas (vaca, pollo, cerdo, pescado, huevo, legumbres) y las cocciones. No repitas un mismo plato principal más de 2 veces en la semana, salvo las viandas.
- Preparación: de 2 a 5 pasos cortos. Medida casera: por ejemplo "1 unidad", "2 cucharadas", "1 taza".
${extra || ''}`;
  try {
    const summaryP = gemGenerate({
      system: AI_SYSTEM, signal, temperature: 0.6,
      schema: { type: 'OBJECT', properties: { resumen: S_STR, consejos: { type: 'ARRAY', items: S_STR }, alertas: { type: 'ARRAY', items: S_STR } }, required: ['resumen', 'consejos'] },
      contents: userMsg(`${ctx}

Escribí la explicación de su plan como en una devolución de consulta:
- resumen: 2 a 4 párrafos. Contá qué objetivo tiene, por qué esas calorías y macros, cómo repartir las comidas en sus horarios (incluido el entrenamiento), cómo manejar las comidas del finde y qué medir para seguir el progreso.
- consejos: 5 a 8 consejos prácticos y concretos para su caso.
- alertas: solo si hay algo de salud o de riesgo para señalar (puede ir vacío).`),
    });
    const a = await gemGenerate({ system: AI_SYSTEM, signal, schema: daySchema, contents: userMsg(daysPrompt(DAYS.slice(0, 4))) });
    busyMsg('Ya casi: armando viernes a domingo…');
    const used = (a.dias || []).flatMap((d) => (d.comidas || []).map((m) => m.nombre));
    const lastDinner = (a.dias || [])[3] && (a.dias[3].comidas || []).find((m) => m.comida === 'cena');
    const b = await gemGenerate({
      system: AI_SYSTEM, signal, schema: daySchema,
      contents: userMsg(daysPrompt(DAYS.slice(4), `- Platos ya usados de lunes a jueves (variá respecto de estos): ${used.join('; ')}.${lastDinner && P.vianda ? `\n- La cena del jueves fue "${lastDinner.nombre}": el almuerzo del viernes es esa misma receta.` : ''}`)),
    });
    const sum = await summaryP;
    const dias = (a.dias || []).slice(0, 4).concat((b.dias || []).slice(0, 3)).map((d, i) => ({ dia: DAYS[i], comidas: (d.comidas || []).filter((m) => keys.includes(m.comida)) }));
    if (dias.length < 7) throw new Error('La IA devolvió un menú incompleto. Probá de nuevo.');
    S.aiPlan = { created: Date.now(), model: S.ai.model, resumen: sum.resumen || '', consejos: sum.consejos || [], alertas: sum.alertas || [], dias, keys: keys.join(',') };
    S.menuSource = 'ia'; S.shop = {};
    store.save(); idle(); TAB = 'plan'; render(); toast('¡Plan con IA listo!');
  } catch (e) { aiFail(e); }
}

async function aiRemeal(d, key) {
  const P = S.profile; const X = calc(P); const slot = daySlots(X, P, d).find((s) => s.key === key); const day = S.aiPlan.dias[d];
  const cur = day.comidas.find((m) => m.comida === key);
  const signal = busy('Buscando otra opción…');
  try {
    const m = await gemGenerate({
      system: AI_SYSTEM, signal, temperature: 0.9, schema: mealSchema([key]),
      contents: userMsg(`${aiProfileText()}

Proponé UNA receta distinta para el ${slot.name.toLowerCase()} del ${DAYS[d]} (clave "${key}"). Objetivo: ${Math.round(slot.k)} kcal, P ${Math.round(slot.p)} g, C ${Math.round(slot.c)} g, G ${Math.round(slot.f)} g (±10 %).${cur ? ` Tiene que ser distinta de "${cur.nombre}".` : ''} Otros platos de la semana: ${S.aiPlan.dias.flatMap((x) => x.comidas.map((c) => c.nombre)).join('; ')}.`),
    });
    m.comida = key; delete S.swaps[ctxKey(d, key, 'ia')];
    const i = day.comidas.findIndex((x) => x.comida === key);
    if (i >= 0) day.comidas[i] = m; else day.comidas.push(m);
    if (P.vianda && key === 'cena' && d < 6) { const nx = S.aiPlan.dias[d + 1].comidas; const j = nx.findIndex((x) => x.comida === 'almuerzo'); if (j >= 0 && cur && nx[j].nombre === cur.nombre) toast('Ojo: el almuerzo de mañana era la vianda de esta cena'); }
    store.save(); idle(); render();
  } catch (e) { aiFail(e); }
}

async function aiFridge() {
  const P = S.profile; const X = calc(P);
  const have = ($('#aiFridge') || {}).value?.trim(); const key = ($('#aiFridgeSlot') || {}).value;
  if (!have) { toast('Contá qué tenés'); return; }
  const tsl = daySlots(X, P, todayIdx()); const slot = tsl.find((s) => s.key === key) || tsl[0];
  const signal = busy('Pensando una receta…');
  try {
    const m = await gemGenerate({
      system: AI_SYSTEM, signal, temperature: 0.8, schema: mealSchema(null),
      contents: userMsg(`${aiProfileText()}

Tengo esto disponible: ${have}.
Armá UNA receta para mi ${slot.name.toLowerCase()} usando principalmente eso. Podés sumar básicos de alacena (aceite, sal, especias, ajo, cebolla, harina, arroz, fideos), siempre que no estén excluidos. Objetivo: ${Math.round(slot.k)} kcal, P ${Math.round(slot.p)} g, C ${Math.round(slot.c)} g, G ${Math.round(slot.f)} g (±10 %). Usá "${slot.key}" como valor de comida. Sumá un consejo breve.`),
    });
    m.comida = slot.key; m.id = 'ia' + Date.now();
    S.aiRecipes = [m].concat(S.aiRecipes || []).slice(0, 30);
    store.save(); idle(); render(); openAIMeal(m, null);
  } catch (e) { aiFail(e); }
}

async function aiChatSend() {
  const inp = $('#chatIn'); const text = inp && inp.value.trim(); if (!text) return;
  S.chat = (S.chat || []).concat({ role: 'user', text }); store.save(); render();
  const box = $('#chatLog'); box.insertAdjacentHTML('beforeend', '<div class="bub model typing">Escribiendo…</div>'); box.scrollIntoView({ block: 'end' });
  aiAbort = new AbortController();
  try {
    const X = calc(S.profile); const today = S.aiPlan && S.menuSource === 'ia' ? S.aiPlan.dias[todayIdx()] : null;
    const todayTxt = today ? today.comidas.map((m) => `${m.comida}: ${m.nombre}`).join('; ') : X.slots.map((s) => { const r = RECIPES.find((x) => x.id === S.menu.days[todayIdx()][s.key]); return `${s.key}: ${r ? r.n : ''}`; }).join('; ');
    const reply = await gemGenerate({
      system: `${AI_SYSTEM}\n\nEstás respondiendo consultas por chat de esta persona. Respondé breve y práctico (hasta ~150 palabras, salvo que pida detalle), con viñetas si ayuda.\n\n${aiProfileText()}\n\nMENÚ DE HOY (${DAYS[todayIdx()]}): ${todayTxt}`,
      contents: S.chat.slice(-20).map((m) => ({ role: m.role, parts: [{ text: m.text }] })), signal: aiAbort.signal,
    });
    S.chat.push({ role: 'model', text: reply.trim() });
  } catch (e) {
    S.chat.push({ role: 'model', text: '⚠️ ' + (e.message || 'Error') , err: true });
  }
  aiAbort = null; S.chat = S.chat.slice(-60); store.save(); render();
  const log = $('#chatLog'); if (log) log.scrollIntoView({ block: 'end' });
}

// ---------------- Diagnóstico ----------------
// Hace pedidos de complejidad creciente con el modelo elegido (y uno mínimo con otros modelos)
// y muestra qué funciona y qué no, con el código y el mensaje real de Google. No muestra la clave.
async function aiDiag() {
  const signal = busy('Probando la conexión con Gemini…');
  const model = S.ai.model;
  const schemaQ = { type: 'OBJECT', properties: { preguntas: { type: 'ARRAY', items: S_STR } }, required: ['preguntas'] };
  const rows = [];
  try {
    // 1) El modelo elegido: pedido mínimo y pedido real de la app.
    busyMsg(`Probando ${model}…`);
    rows.push(Object.assign(await pingModel(model, signal, 45000), { name: 'Pedido mínimo' }));
    busyMsg(`Probando pedido real con ${model}…`);
    const t0 = Date.now();
    try {
      await gemFetch(`models/${model}:generateContent`, { systemInstruction: { parts: [{ text: AI_SYSTEM }] }, contents: userMsg(`${aiProfileText()}\n\nHacé entre 3 y 6 preguntas de seguimiento para personalizar el plan.`), generationConfig: { temperature: 0.5, responseMimeType: 'application/json', responseSchema: schemaQ } }, signal, S.ai.key, 60000);
      rows.push({ name: 'Pedido real de la app', m: model, ok: true, code: 200, ms: Date.now() - t0, det: 'OK' });
    } catch (e) { if (e.name === 'AbortError') throw e; rows.push({ name: 'Pedido real de la app', m: model, ok: false, code: e.status, ms: Date.now() - t0, det: String(e.raw || e.message).slice(0, 160) }); }
    // 2) Los demás modelos estándar de la lista, con un pedido mínimo.
    const others = stdModels().filter((x) => x.id !== model).sort((a, b) => (a.i.fam === 'pro') - (b.i.fam === 'pro') || b.i.v - a.i.v || a.i.lite - b.i.lite).slice(0, 10);
    for (const x of others) { busyMsg(`Probando ${x.id}…`); rows.push(Object.assign(await pingModel(x.id, signal, 25000), { name: 'Pedido mínimo' })); }
    idle();
  } catch (e) { aiFail(e); return; }
  const curOk = rows.filter((r) => r.m === model).every((r) => r.ok);
  const okOthers = rows.filter((r) => r.m !== model && r.ok);
  let switched = null;
  if (!curOk && okOthers.length) {
    const best = okOthers.slice().sort((a, b) => { const ia = modelInfo(a.m), ib = modelInfo(b.m); return (ia.fam === 'pro') - (ib.fam === 'pro') || ib.v - ia.v || ia.lite - ib.lite; })[0];
    switched = best.m; S.ai.model = best.m; store.save(); render();
  }
  const txt = [`Fit v${typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?'} · ${new Date().toLocaleString('es-AR')} · ${navigator.userAgent.replace(/\s+/g, ' ').slice(0, 120)}`]
    .concat(rows.map((r) => `${r.ok ? 'OK ' : 'ERR'} | ${r.name} | ${r.m} | ${r.code} | ${(r.ms / 1000).toFixed(1)} s | ${r.det}`)).concat(switched ? [`Cambiado automáticamente a: ${switched}`] : []).join('\n');
  $('#modalBody').innerHTML = `<h2>Resultado de la prueba</h2>
    ${curOk ? `<div class="note ok">${esc(model)} funciona bien.</div>`
      : switched ? `<div class="note ok">${esc(model)} no está respondiendo. Se cambió automáticamente a <b>${esc(switched)}</b>, que sí respondió. Ya podés volver a intentar.</div>`
      : '<div class="note warn">Ningún modelo respondió en este momento. Suele ser saturación temporal de Google: probá de nuevo más tarde. Si se repite, tocá "Copiar resultado" y pegalo en el chat de soporte (no incluye tu clave).</div>'}
    <ul class="opts">${rows.map((r) => `<li><span>${r.ok ? '✅' : '❌'} ${esc(r.m)}</span><b>${(r.ms / 1000).toFixed(1)} s</b><small>${esc(r.name)} · ${esc(String(r.code))} · ${esc(r.det)}</small>${r.ok && r.m !== S.ai.model ? `<button class="swapbtn" data-ai="usemodel" data-m="${esc(r.m)}">Usar este</button>` : ''}</li>`).join('')}</ul>
    <textarea id="diagTxt" rows="6" hidden readonly>${esc(txt)}</textarea>
    <div class="actions"><button class="ghost" data-ai="diagcopy">Copiar resultado</button></div>`;
  $('#modal').showModal();
}

// ---------------- Foto del plato ----------------
// La persona saca una foto; Gemini identifica los alimentos y estima gramos, calorías y macros.
// Se muestra editable (los gramos se pueden corregir) antes de guardarlo en la comida del día.
let PHOTO = null;
const PHOTO_SYSTEM = `Sos licenciado/a en Nutrición en Argentina, con experiencia en estimar porciones a partir de fotos.
Reglas: identificá solo lo que se ve (no inventes alimentos ocultos); estimá el peso de cada alimento TAL COMO ESTÁ SERVIDO (cocido);
usá valores de tablas de composición (USDA, ARGENFOODS); tené en cuenta el aceite o la manteca cuando el alimento se ve frito, salteado o con salsa;
sé realista: si dudás entre dos tamaños, elegí el intermedio. Respondé en español rioplatense.`;
const PHOTO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    plato: S_STR,
    alimentos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { nombre: S_STR, gramos: { type: 'NUMBER' }, kcal: { type: 'NUMBER' }, proteinas: { type: 'NUMBER' }, carbohidratos: { type: 'NUMBER' }, grasas: { type: 'NUMBER' } }, required: ['nombre', 'gramos', 'kcal', 'proteinas', 'carbohidratos', 'grasas'] } },
    confianza: { type: 'STRING', enum: ['baja', 'media', 'alta'] },
    comentario: S_STR,
  },
  required: ['alimentos'],
};

async function resizeImage(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('No se pudo leer la imagen.')); img.src = url; });
    const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const du = c.toDataURL('image/jpeg', 0.82);
    return { mime: 'image/jpeg', data: du.split(',')[1], preview: du };
  } finally { URL.revokeObjectURL(url); }
}

function openPhoto(slot) {
  if (!aiReady()) { toast('Primero conectá Gemini en Más → Perfil'); TAB = 'perfil'; render(); return; }
  PHOTO = { slot: slot || null, img: null, res: null };
  $('#modalBody').innerHTML = `<h2>Foto del plato</h2>
    <p class="hint">Sacá la foto desde arriba, con todo el plato a la vista. Si hay algo de referencia al lado (un tenedor, un vaso), ayuda a estimar el tamaño.</p>
    <label class="btn photobtn">📷 Sacar o elegir foto<input type="file" accept="image/*" capture="environment" id="photoIn" hidden></label>
    <img id="photoPrev" class="photoprev" alt="" hidden>
    <label style="margin-top:10px">Aclaraciones (opcional)<textarea id="photoNote" rows="2" placeholder="Ej.: comí la mitad, la carne estaba frita, tenía mayonesa…"></textarea></label>
    <div class="actions"><button id="photoGo" data-ai="photogo" disabled>Calcular calorías</button></div>
    <div id="photoRes"></div>`;
  $('#modal').showModal();
}

async function photoAnalyze() {
  if (!PHOTO || !PHOTO.img) { toast('Primero sacá o elegí una foto'); return; }
  const note = ($('#photoNote') || {}).value || '';
  const signal = busy('Analizando la foto…');
  try {
    const r = await gemGenerate({
      system: PHOTO_SYSTEM, signal, temperature: 0.3, schema: PHOTO_SCHEMA,
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: PHOTO.img.mime, data: PHOTO.img.data } },
        { text: `Identificá los alimentos de esta foto y estimá para cada uno: gramos (tal como está servido), kcal, proteínas, carbohidratos y grasas. Ponele un nombre corto al plato. Indicá tu confianza (baja, media o alta) y, en comentario, qué fue lo más difícil de estimar. Si la foto no muestra comida, devolvé la lista vacía y explicalo en comentario.${note ? `\nAclaraciones de la persona: ${note}` : ''}` },
      ] }],
    });
    idle();
    PHOTO.res = { plato: r.plato || 'Plato', confianza: r.confianza || '', comentario: r.comentario || '',
      items: (r.alimentos || []).map((x) => ({ n: String(x.nombre || 'Alimento'), g0: +x.gramos || 0, g: Math.round(+x.gramos || 0), k: +x.kcal || 0, p: +x.proteinas || 0, c: +x.carbohidratos || 0, f: +x.grasas || 0 })) };
    drawPhotoRes();
  } catch (e) { aiFail(e); }
}

function photoTotHTML() {
  const R0 = PHOTO.res; const tot = R0.items.reduce((t, it) => { const v = photoItemVals(it); t.k += v.k; t.p += v.p; t.c += v.c; t.f += v.f; return t; }, { k: 0, p: 0, c: 0, f: 0 });
  return `<b>≈ ${Math.round(tot.k)} kcal</b><span class="p">P ${Math.round(tot.p)}</span><span class="c">C ${Math.round(tot.c)}</span><span class="f">G ${Math.round(tot.f)}</span>${R0.confianza ? `<span class="muted">confianza ${esc(R0.confianza)}</span>` : ''}`;
}
function photoItemVals(it) { const q = it.g0 ? it.g / it.g0 : 1; return { k: it.k * q, p: it.p * q, c: it.c * q, f: it.f * q }; }
function drawPhotoRes() {
  const R0 = PHOTO.res; const box = $('#photoRes'); if (!box || !R0) return;
  if (!R0.items.length) { box.innerHTML = `<div class="note warn">${esc(R0.comentario || 'No se reconocieron alimentos en la foto.')}</div>`; return; }
  const tot = R0.items.reduce((t, it) => { const v = photoItemVals(it); t.k += v.k; t.p += v.p; t.c += v.c; t.f += v.f; return t; }, { k: 0, p: 0, c: 0, f: 0 });
  const slots = diaSlots(diaDate || todayISO());
  box.innerHTML = `<h3>${esc(R0.plato)}</h3>
    <div class="mrow" id="photoTot">${photoTotHTML()}</div>
    <p class="hint">Corregí los gramos si sabés que eran más o menos: las calorías se recalculan.</p>
    <ul class="opts">${R0.items.map((it, i) => { const v = photoItemVals(it); return `<li><span>${esc(it.n)}</span><b>${Math.round(v.k)} kcal <button class="x" data-ai="photodel" data-i="${i}" aria-label="Quitar">×</button></b>
      <small><input class="gin" type="number" inputmode="numeric" value="${it.g}" data-pg="${i}"> g · <span class="pv">P ${Math.round(v.p)} · C ${Math.round(v.c)} · G ${Math.round(v.f)}</span></small></li>`; }).join('')}</ul>
    ${R0.comentario ? `<p class="hint">${esc(R0.comentario)}</p>` : ''}
    <p class="hint">Es una estimación a partir de una foto: puede errar bastante, sobre todo con aceites, salsas y lo que no se ve.</p>
    <div class="grid2"><label>Guardar en<select id="photoSlot">${slots.map((s) => `<option value="${s.key}" ${s.key === PHOTO.slot ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="" ${PHOTO.slot ? '' : 'selected'}>Fuera de las comidas</option></select></label>
    <button data-ai="photoadd" style="align-self:end">Agregar a hoy</button></div>`;
}

function photoAdd() {
  if (!PHOTO || !PHOTO.res) return;
  if (!diaDate) diaDate = todayISO();
  ADDSLOT = ($('#photoSlot') || {}).value || null;
  PHOTO.res.items.forEach((it) => { const v = photoItemVals(it); addItem({ n: it.n, g: it.g, k: v.k, p: v.p, c: v.c, f: v.f, est: true, src: 'foto' }); });
  ADDSLOT = null; $('#modal').close(); TAB = 'diario'; render(); toast('Agregado desde la foto');
}

// ---------------- Vistas ----------------
function mdLite(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^\s*[-*•]\s+/gm, '• ').replace(/\n/g, '<br>');
}

function aiPlanCard() {
  if (!aiReady()) {
    return `<section class="card ai"><h3>✨ Armá tu plan con IA</h3><p class="hint">Conectá Gemini (gratis, con tu cuenta de Google) y Fit te hace preguntas de seguimiento, te explica tu plan y te arma un menú semanal a tu gusto, con recetas, lista de compras y chat.</p>
      <div class="actions"><button data-ai="goSettings">Conectar Gemini</button></div></section>`;
  }
  const A = S.aiPlan;
  if (!A) {
    return `<section class="card ai"><h3>✨ Armá tu plan con IA</h3><p class="hint">La IA te va a hacer unas preguntas más y después arma tu plan explicado y un menú semanal con recetas, respetando tus calorías y macros.</p>
      <div class="actions"><button data-ai="start">Empezar</button></div></section>`;
  }
  return `<section class="card ai"><h3>✨ Tu plan explicado</h3>
    <div class="aitext">${mdLite(A.resumen)}</div>
    ${A.alertas && A.alertas.length ? A.alertas.map((x) => `<div class="note warn">${esc(x)}</div>`).join('') : ''}
    ${A.consejos && A.consejos.length ? `<details open><summary>Consejos para vos</summary><ul class="tips">${A.consejos.map((x) => `<li>${mdLite(x)}</li>`).join('')}</ul></details>` : ''}
    <div class="actions"><button data-tab="menu">Ver menú de la IA</button><button class="ghost" data-ai="start">Rehacer plan</button></div>
    <p class="hint">Generado con ${esc(A.model)} el ${new Date(A.created).toLocaleDateString('es-AR')}. Si cambiás tu perfil, conviene rehacerlo.</p>
  </section>`;
}

function aiMenuToggle() {
  if (!S.aiPlan) return '';
  const src = S.menuSource === 'ia' ? 'ia' : 'fit';
  return `<div class="seg"><button class="${src === 'ia' ? 'on' : ''}" data-ai="src" data-src="ia">✨ Menú IA</button><button class="${src === 'fit' ? 'on' : ''}" data-ai="src" data-src="fit">Menú Fit</button></div>`;
}

function viewMenuAI() {
  const P = S.profile; const X = calc(P); const A = S.aiPlan;
  let wk = 0;
  const days = A.dias.map((day, d) => {
    let tk = 0;
    const rows = daySlots(X, P, d).map((s) => {
      const m = day.comidas.find((x) => x.comida === s.key);
      if (!m) { tk += s.k; return `<li><small class="ml">${esc(s.name)}</small><span class="muted">Sin receta</span><b></b><button class="ic" data-ai="remeal" data-d="${d}" data-k="${s.key}" aria-label="Generar">↻</button></li>`; }
      const ctx = ctxKey(d, s.key, 'ia'); const nsw = Object.keys(S.swaps[ctx] || {}).length;
      const free = !m.ingredientes || !m.ingredientes.length; const n = free ? { k: s.k } : sumLines(aiLines(m, ctx)); tk += n.k;
      return `<li><small class="ml">${esc(s.name)}</small><span><a href="#" data-ai="meal" data-d="${d}" data-k="${s.key}">${esc(m.nombre)}</a>${nsw ? ` <small class="sw">· ${nsw} cambio${nsw > 1 ? 's' : ''}</small>` : ''}</span>
        <b>${free ? 'libre' : Math.round(n.k)}</b><button class="ic" data-ai="remeal" data-d="${d}" data-k="${s.key}" aria-label="Otra opción con IA">↻</button></li>`;
    }).join('');
    wk += tk;
    const TD = sumSlots(daySlots(X, P, d)); const dev = (tk - TD.k) / TD.k;
    return `<section class="card mday ${d === todayIdx() ? 'today' : ''}"><header><h3>${DAYS[d]}</h3>${isTrainDay(P, d) ? '<span class="pill tr">Entreno</span>' : ''}<span class="muted ${Math.abs(dev) > 0.12 ? 'warnc' : ''}">${Math.round(tk)} kcal</span></header><ul class="mlist">${rows}</ul></section>`;
  }).join('');
  return `${aiMenuToggle()}
  <p class="hint">Tocá una comida para ver la receta y reemplazar ingredientes. ↻ pide otra opción a la IA. Los valores los informa la IA: son aproximados.</p>
  ${days}
  <section class="card"><p class="hint" style="margin:0">Promedio semanal: <b>${Math.round(wk / A.dias.length)} kcal/día</b> (objetivo ${X.kcal}). En naranja, los días que se desvían más de 12 %.</p></section>
  <div class="actions center"><button class="ghost" data-ai="start">Rehacer plan y menú con IA</button></div>`;
}

function aiFridgeCard() {
  if (!aiReady()) return '';
  const X = calc(S.profile);
  return `<section class="card ai"><h3>✨ Receta con lo que tenés</h3>
    <textarea id="aiFridge" rows="2" placeholder="Ej.: pollo, zapallitos, media cebolla, arroz, huevos"></textarea>
    <div class="grid2" style="margin-top:8px"><label>Para<select id="aiFridgeSlot">${X.slots.map((s) => `<option value="${s.key}" ${s.key === 'cena' ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <button data-ai="fridge" style="align-self:end">Crear receta</button></div></section>`;
}

function aiSavedRecipes() {
  const list = S.aiRecipes || []; if (!list.length) return '<p class="hint center">Todavía no creaste recetas con IA.</p>';
  return list.map((m, i) => { const n = mealTotals(m); return `<section class="card rec"><div class="rhead"><a href="#" data-ai="saved" data-i="${i}">${esc(m.nombre)}</a><button class="x" data-ai="delsaved" data-i="${i}" aria-label="Borrar">×</button></div>
    <div class="mrow"><b>${Math.round(n.k)} kcal</b><span class="p">P ${Math.round(n.p)}</span><span class="c">C ${Math.round(n.c)}</span><span class="f">G ${Math.round(n.f)}</span><span class="muted">✨ IA</span></div></section>`; }).join('');
}

function aiShopItems() {
  const tot = {};
  S.aiPlan.dias.forEach((d, di) => d.comidas.forEach((m) => aiLines(m, ctxKey(di, m.comida, 'ia')).forEach((l) => {
    const k = l.n.trim().toLowerCase(); if (!k) return;
    tot[k] = tot[k] || { n: l.n.trim(), g: 0 }; tot[k].g += l.g || 0;
  })));
  return Object.entries(tot).sort((a, b) => a[1].n.localeCompare(b[1].n));
}

function viewShopAI() {
  const key = 'ia' + S.aiPlan.created; const checked = S.shop[key] || {};
  const fmt = (g) => { const gg = Math.ceil(g / 10) * 10; return gg >= 1000 ? `${(gg / 1000).toFixed(2).replace('.', ',')} kg` : `${gg} g`; };
  return `${aiMenuToggle()}<h2 class="sec">Lista de compras (menú IA)</h2>
  <p class="hint">Suma de los ingredientes del menú de la IA para 1 persona, pesos en crudo. Revisala: la IA puede nombrar un mismo alimento de dos formas.</p>
  <section class="card"><ul class="shop">${aiShopItems().map(([k, v]) => `<li><label><input type="checkbox" data-aishop="${esc(k)}" ${checked[k] ? 'checked' : ''}><span>${esc(v.n)}</span><b>${fmt(v.g)}</b></label></li>`).join('')}</ul></section>
  <div class="actions center"><button class="ghost" data-shopclear>Desmarcar todo</button><button data-shopshare>Compartir lista</button></div>`;
}

function viewChat() {
  if (!aiReady()) return `<section class="card ai"><h3>✨ Chat con tu nutri IA</h3><p class="hint">Para usar el chat conectá Gemini con tu clave gratuita.</p><div class="actions"><button data-ai="goSettings">Conectar Gemini</button></div></section>`;
  const msgs = S.chat || [];
  return `<div id="chatLog" class="chat">
    ${msgs.length ? '' : `<div class="bub model">Hola${S.profile.name ? ' ' + esc(S.profile.name) : ''}. Conozco tu perfil y tu plan. Preguntame lo que quieras: qué comer antes de entrenar, con qué reemplazar algo, qué pedir si comés afuera…</div>`}
    ${msgs.map((m) => `<div class="bub ${m.role}${m.err ? ' err' : ''}">${mdLite(m.text)}</div>`).join('')}
  </div>
  <form id="chatForm" class="chatbar"><input id="chatIn" placeholder="Escribí tu consulta…" autocomplete="off"><button type="submit" aria-label="Enviar">➤</button></form>
  ${msgs.length ? '<div class="actions center"><button class="ghost" data-ai="clearchat">Borrar conversación</button></div>' : ''}
  <p class="disclaimer">Respuestas generadas por IA: pueden equivocarse. No reemplazan una consulta profesional.</p>`;
}

function aiSettingsCard() {
  const A = S.ai || {};
  return `<section class="card" id="aiSettings"><h3>✨ Inteligencia artificial (Gemini)</h3>
    <p class="hint">Opcional. Con una clave gratuita de Google, Fit usa Gemini para: preguntas de seguimiento, tu plan explicado, menú semanal con recetas, recetas con lo que tengas y chat.</p>
    <ol class="hint steps"><li>Entrá a <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> con tu cuenta de Google.</li><li>Tocá <b>Create API key</b> y copiá la clave.</li><li>Pegala acá abajo y tocá <b>Conectar</b>.</li></ol>
    <label>Clave de API<input type="password" id="aiKey" value="${esc(A.key || '')}" autocomplete="off" placeholder="AIza…"></label>
    ${A.models && A.models.length ? `<label style="margin-top:8px">Modelo<select id="aiModel">${A.models.map((m) => `<option value="${esc(m.id)}" ${m.id === A.model ? 'selected' : ''}>${esc(m.label)} (${esc(m.id)})</option>`).join('')}</select></label>` : ''}
    <div class="actions"><button data-ai="connect">${A.key ? 'Reconectar' : 'Conectar'}</button>${A.key ? '<button class="ghost" data-ai="diag">Probar conexión</button><button class="ghost danger" data-ai="disconnect">Quitar clave</button>' : ''}</div>
    <div class="note warn">Privacidad: al usar la IA, tu perfil (edad, medidas, salud, gustos) se envía a Google. En el uso gratuito de la API, Google puede usar ese contenido para mejorar sus productos y puede ser leído por revisores humanos: no cargues datos que no quieras compartir. Términos: ai.google.dev/gemini-api/terms. La clave queda guardada solo en este teléfono y no se incluye en el backup.</div>
  </section>`;
}

// ---------------- Eventos ----------------
function aiAction(t) {
  const a = t.dataset.ai;
  if (a === 'goSettings') { TAB = 'perfil'; render(); setTimeout(() => { const el = $('#aiSettings'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 50); return; }
  if (a === 'connect') return aiConnect();
  if (a === 'disconnect') { if (confirm('¿Quitar la clave de Gemini de este teléfono?')) { S.ai = null; store.save(); render(); } return; }
  if (a === 'start') return aiStart();
  if (a === 'diag') return aiDiag();
  if (a === 'photo') return openPhoto(t.dataset.slot);
  if (a === 'photogo') return photoAnalyze();
  if (a === 'photodel') { PHOTO.res.items.splice(+t.dataset.i, 1); drawPhotoRes(); return; }
  if (a === 'photoadd') return photoAdd();
  if (a === 'usemodel') { S.ai.model = t.dataset.m; store.save(); $('#modal').close(); render(); toast('Ahora se usa ' + t.dataset.m); return; }
  if (a === 'diagcopy') { const txt = ($('#diagTxt') || {}).value || ''; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Resultado copiado')).catch(() => { const ta = $('#diagTxt'); ta.hidden = false; ta.select(); toast('Copialo de la caja de texto'); }); return; }
  if (a === 'src') { S.menuSource = t.dataset.src; store.save(); render(); return; }
  if (a === 'remeal') return aiRemeal(+t.dataset.d, t.dataset.k);
  if (a === 'meal') { const m = S.aiPlan.dias[+t.dataset.d].comidas.find((x) => x.comida === t.dataset.k); if (m) openAIMeal(m, ctxKey(+t.dataset.d, t.dataset.k, 'ia')); return; }
  if (a === 'fridge') return aiFridge();
  if (a === 'saved') { openAIMeal(S.aiRecipes[+t.dataset.i], null); return; }
  if (a === 'delsaved') { S.aiRecipes.splice(+t.dataset.i, 1); store.save(); render(); return; }
  if (a === 'clearchat') { if (confirm('¿Borrar la conversación?')) { S.chat = []; store.save(); render(); } }
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'aiModel') { S.ai.model = e.target.value; store.save(); toast('Modelo actualizado'); }
  if (e.target.dataset.aishop) { const k = 'ia' + S.aiPlan.created; S.shop[k] = S.shop[k] || {}; S.shop[k][e.target.dataset.aishop] = e.target.checked; store.save(); }
});
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'photoIn' || !e.target.files[0]) return;
  try {
    PHOTO.img = await resizeImage(e.target.files[0]);
    const im = $('#photoPrev'); im.src = PHOTO.img.preview; im.hidden = false; $('#photoGo').disabled = false;
    PHOTO.res = null; $('#photoRes').innerHTML = '';
  } catch (err) { toast(err.message || 'No se pudo leer la foto'); }
});
document.addEventListener('input', (e) => {
  if (e.target.dataset && e.target.dataset.pg != null && PHOTO && PHOTO.res) {
    const it = PHOTO.res.items[+e.target.dataset.pg]; it.g = +e.target.value || 0;
    const li = e.target.closest('li'); const v = photoItemVals(it);
    li.querySelector('b').firstChild.textContent = `${Math.round(v.k)} kcal `;
    li.querySelector('.pv').textContent = `P ${Math.round(v.p)} · C ${Math.round(v.c)} · G ${Math.round(v.f)}`;
    $('#photoTot').innerHTML = photoTotHTML();
  }
});
document.addEventListener('submit', (e) => { if (e.target.id === 'chatForm') { e.preventDefault(); aiChatSend(); } });
