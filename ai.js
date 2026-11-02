/* Fit — funciones con IA (Google Gemini). Opcional: cada usuario usa su propia clave de API.
   Las calorías y macros los calculan las fórmulas de app.js; Gemini arma el contenido
   (preguntas de seguimiento, plan explicado, menú, recetas y chat) respetando esos objetivos. */
'use strict';

const GEM_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const aiReady = () => !!(S.ai && S.ai.key && S.ai.model);
let aiAbort = null;

// ---------------- Cliente de la API ----------------
async function gemFetch(path, body, signal, key = S.ai && S.ai.key) {
  let res;
  try {
    res = await fetch(`${GEM_BASE}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'x-goog-api-key': key }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('No hay conexión con Gemini. Revisá tu internet.');
  }
  const data = await res.json().catch(() => ({}));
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
  if (status >= 500) return 'Gemini está con problemas en este momento. Probá de nuevo en un rato.';
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
  const ver = (id) => { const m = id.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  const score = (id) => ver(id) * 10 + (/flash/.test(id) ? 3 : 0) - (/lite/.test(id) ? 2 : 0) - (/(preview|exp)/.test(id) ? 5 : 0) - (/-\d{3}$/.test(id) ? 0.5 : 0) - (/latest/.test(id) ? 0.2 : 0);
  return list.slice().sort((a, b) => score(b.id) - score(a.id))[0]?.id || null;
}

async function gemGenerate({ system, contents, schema, temperature = 0.7, signal }) {
  const body = { contents, generationConfig: { temperature } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (schema) { body.generationConfig.responseMimeType = 'application/json'; body.generationConfig.responseSchema = schema; }
  const path = `models/${S.ai.model}:generateContent`;
  let d;
  try { d = await gemFetch(path, body, signal); }
  catch (e) {
    // Algunos modelos no aceptan responseSchema: se reintenta pidiendo solo JSON.
    if (schema && e.status === 400 && /schema/i.test(e.raw || '')) {
      delete body.generationConfig.responseSchema;
      body.contents = contents.concat([{ role: 'user', parts: [{ text: 'Respondé SOLO con JSON válido que siga exactamente esta estructura (JSON Schema): ' + JSON.stringify(schema) }] }]);
      d = await gemFetch(path, body, signal);
    } else throw e;
  }
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
  const sp = Object.entries(P.specials || {}).map(([k, id]) => { const [d, slot] = k.split('-'); const r = RECIPES.find((x) => x.id === id); return `${DAYS[+d]} ${slot}: ${r ? r.n : id}`; });
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
    '- Objetivo por comida (días normales; ya compensan las comidas especiales):',
    ...X.slots.map((s) => `  · ${s.key} (${s.name}): ${Math.round(s.k)} kcal, P ${Math.round(s.p)} g, C ${Math.round(s.c)} g, G ${Math.round(s.f)} g`));
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
  alert('No se pudo completar: ' + (e && e.message ? e.message : e));
}

async function aiConnect() {
  const key = ($('#aiKey') || {}).value?.trim();
  if (!key) { toast('Pegá tu clave de API'); return; }
  busy('Conectando con Gemini…');
  try {
    const models = await listModels(key);
    if (!models.length) throw new Error('La clave funciona pero no se encontraron modelos de texto disponibles.');
    S.ai = { key, models, model: (S.ai && models.some((m) => m.id === S.ai.model)) ? S.ai.model : pickDefaultModel(models) };
    store.save(); idle(); render(); toast('Gemini conectado');
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
- Cada comida tiene que quedar cerca (±10 %) de su objetivo de kcal y macros.
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
  const P = S.profile; const X = calc(P); const slot = X.slots.find((s) => s.key === key); const day = S.aiPlan.dias[d];
  const cur = day.comidas.find((m) => m.comida === key);
  const signal = busy('Buscando otra opción…');
  try {
    const m = await gemGenerate({
      system: AI_SYSTEM, signal, temperature: 0.9, schema: mealSchema([key]),
      contents: userMsg(`${aiProfileText()}

Proponé UNA receta distinta para el ${slot.name.toLowerCase()} del ${DAYS[d]} (clave "${key}"). Objetivo: ${Math.round(slot.k)} kcal, P ${Math.round(slot.p)} g, C ${Math.round(slot.c)} g, G ${Math.round(slot.f)} g (±10 %).${cur ? ` Tiene que ser distinta de "${cur.nombre}".` : ''} Otros platos de la semana: ${S.aiPlan.dias.flatMap((x) => x.comidas.map((c) => c.nombre)).join('; ')}.`),
    });
    m.comida = key;
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
  const slot = X.slots.find((s) => s.key === key) || X.slots[0];
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
    store.save(); idle(); render(); openAIMeal(m);
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
  const d = Math.min(menuDay, A.dias.length - 1); const day = A.dias[d];
  const tot = { k: 0, p: 0, c: 0, f: 0 };
  const cards = X.slots.map((s) => {
    const m = day.comidas.find((x) => x.comida === s.key);
    if (!m) return `<section class="card meal"><header><h3>${esc(s.name)}</h3></header><p class="hint">Sin receta.</p><div class="actions"><button class="ghost" data-ai="remeal" data-d="${d}" data-k="${s.key}">Generar con IA</button></div></section>`;
    const n = mealTotals(m); const free = !m.ingredientes || !m.ingredientes.length;
    if (free) { tot.k += s.k; tot.p += s.p; tot.c += s.c; tot.f += s.f; } else { tot.k += n.k; tot.p += n.p; tot.c += n.c; tot.f += n.f; }
    return `<section class="card meal"><header><h3>${esc(s.name)}</h3></header>
      <p class="rname"><a href="#" data-ai="meal" data-d="${d}" data-k="${s.key}">${esc(m.nombre)}</a></p>
      ${free ? `<p class="hint">${esc((m.preparacion || []).join(' '))}</p>` : `<div class="mrow"><b>${Math.round(n.k)} kcal</b><span class="p">P ${Math.round(n.p)}</span><span class="c">C ${Math.round(n.c)}</span><span class="f">G ${Math.round(n.f)}</span></div>`}
      <div class="actions"><button class="ghost" data-ai="remeal" data-d="${d}" data-k="${s.key}">Otra opción con IA</button></div></section>`;
  }).join('');
  let wk = 0;
  A.dias.forEach((dd) => X.slots.forEach((s) => { const m = dd.comidas.find((x) => x.comida === s.key); const n = m && m.ingredientes && m.ingredientes.length ? mealTotals(m).k : s.k; wk += n; }));
  const avg = wk / A.dias.length; const dev = (tot.k - X.kcal) / X.kcal;
  return `${aiMenuToggle()}
  <div class="days">${DAYS_S.map((x, i) => `<button class="${i === d ? 'on' : ''}" data-day="${i}">${x}</button>`).join('')}</div>
  <h2 class="sec">${DAYS[d]}</h2>${cards}
  <section class="card">
    <div class="mrow"><b>Total del día: ${Math.round(tot.k)} kcal</b><span class="p">P ${Math.round(tot.p)}</span><span class="c">C ${Math.round(tot.c)}</span><span class="f">G ${Math.round(tot.f)}</span></div>
    <p class="hint">Objetivo: ${X.kcal} kcal · ${X.p} g de proteína. Promedio semanal del menú: <b>${Math.round(avg)} kcal/día</b>.</p>
    ${Math.abs(dev) > 0.12 ? `<div class="note warn">Este día se desvía ${dev > 0 ? '+' : ''}${Math.round(dev * 100)} % del objetivo${day.comidas.some((m) => /libre/i.test(m.nombre)) ? ' (incluye una comida especial o libre)' : ''}. Podés pedir otra opción para alguna comida.</div>` : ''}
    <p class="hint">Los valores nutricionales los informa la IA por ingrediente y Fit los suma: son aproximados y pueden tener errores.</p>
  </section>
  <div class="actions center"><button class="ghost" data-ai="start">Rehacer plan y menú con IA</button></div>`;
}

function openAIMeal(m) {
  const n = mealTotals(m);
  $('#modalBody').innerHTML = `<h2>${esc(m.nombre)}</h2>
    ${m.ingredientes && m.ingredientes.length ? `<div class="mrow"><b>${Math.round(n.k)} kcal</b><span class="p">P ${Math.round(n.p)} g</span><span class="c">C ${Math.round(n.c)} g</span><span class="f">G ${Math.round(n.f)} g</span>${m.tiempo_min ? `<span class="muted">${m.tiempo_min} min</span>` : ''}</div>
    <h3>Ingredientes <small>(1 porción, pesos en crudo)</small></h3>
    <ul class="opts">${m.ingredientes.map((i) => `<li><span>${esc(i.nombre)}</span><b>${Math.round(i.gramos)} g</b><small>${i.medida_casera ? esc(i.medida_casera) + ' · ' : ''}${Math.round(i.kcal)} kcal · P ${(+i.proteinas).toFixed(0)} · C ${(+i.carbohidratos).toFixed(0)} · G ${(+i.grasas).toFixed(0)}</small></li>`).join('')}</ul>` : ''}
    <h3>Preparación</h3><ol class="steps">${(m.preparacion || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${m.consejo ? `<div class="note info">${esc(m.consejo)}</div>` : ''}
    <p class="hint">Receta generada por IA: revisá que los ingredientes te sirvan. Los valores nutricionales son aproximados.</p>`;
  $('#modalBody').onclick = null;
  $('#modal').showModal();
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
  S.aiPlan.dias.forEach((d) => d.comidas.forEach((m) => (m.ingredientes || []).forEach((i) => {
    const k = String(i.nombre || '').trim().toLowerCase(); if (!k) return;
    tot[k] = tot[k] || { n: String(i.nombre).trim(), g: 0 }; tot[k].g += +i.gramos || 0;
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
    <div class="actions"><button data-ai="connect">${A.key ? 'Reconectar' : 'Conectar'}</button>${A.key ? '<button class="ghost danger" data-ai="disconnect">Quitar clave</button>' : ''}</div>
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
  if (a === 'src') { S.menuSource = t.dataset.src; store.save(); render(); return; }
  if (a === 'remeal') return aiRemeal(+t.dataset.d, t.dataset.k);
  if (a === 'meal') { const m = S.aiPlan.dias[+t.dataset.d].comidas.find((x) => x.comida === t.dataset.k); if (m) openAIMeal(m); return; }
  if (a === 'fridge') return aiFridge();
  if (a === 'saved') { openAIMeal(S.aiRecipes[+t.dataset.i]); return; }
  if (a === 'delsaved') { S.aiRecipes.splice(+t.dataset.i, 1); store.save(); render(); return; }
  if (a === 'clearchat') { if (confirm('¿Borrar la conversación?')) { S.chat = []; store.save(); render(); } }
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'aiModel') { S.ai.model = e.target.value; store.save(); toast('Modelo actualizado'); }
  if (e.target.dataset.aishop) { const k = 'ia' + S.aiPlan.created; S.shop[k] = S.shop[k] || {}; S.shop[k][e.target.dataset.aishop] = e.target.checked; store.save(); }
});
document.addEventListener('submit', (e) => { if (e.target.id === 'chatForm') { e.preventDefault(); aiChatSend(); } });
