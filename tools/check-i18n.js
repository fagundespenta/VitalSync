// Confere se todos os textos usados no app existem em pt, en e es.
// Uso: node tools/check-i18n.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'www');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
for (const l of ['pt', 'en', 'es']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'i18n', `${l}.js`), 'utf8'), ctx);
}
const dicts = ctx.window.VS_I18N;

// Ignora comentários de linha.
const code = app.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
// Chaves fixas: t('x') e tn('x', ...)
const used = new Set();
for (const m of code.matchAll(/\bt\('([^'$`]+)'/g)) used.add(m[1]);
for (const m of code.matchAll(/\btn\('([^'$`]+)'/g)) { used.add(`${m[1]}.one`); used.add(`${m[1]}.other`); }
// Chaves dentro de ternários: t(cond ? 'a.b' : 'c.d')
for (const m of code.matchAll(/\bt\([^()]*?\?\s*'([\w.]+\.[\w.]+)'\s*:\s*'([\w.]+\.[\w.]+)'/g)) { used.add(m[1]); used.add(m[2]); }
// Chaves passadas de forma indireta (ex.: ph('x.y'), msgKey = 'x.y'): qualquer texto entre aspas que seja uma chave.
for (const m of code.matchAll(/'([a-z]+\.[\w.]+)'/g)) if (m[1] in (ctx.window.VS_I18N.pt || {})) used.add(m[1]);

// Chaves montadas no código (com variáveis)
const dyn = {
  'mood.': [1, 2, 3, 4, 5],
  'symptom.': ['headache', 'nausea', 'tired', 'fever', 'breath', 'dizzy', 'bodyache', 'anxiety', 'none'],
  'level.': [0, 1, 2, 3],
  'sleep.': ['good', 'bad'],
  'intensity.': [1, 2, 3, 4, 5],
  'interval.': [24, 12, 8, 6, 4],
  'lead.': [0, 15, 30, 60, 120, 1440, 2880],
  'period.': [7, 30, 90],
  'period.name.': [7, 30, 90],
  'chartName.': ['mood', 'symptoms', 'meds', 'sleep', 'water'],
  'feature.': ['greeting', 'symptoms', 'sleep', 'water', 'meds', 'doubts', 'sos'],
  'size.': [0, 1, 2, 3],
  'theme.': ['light', 'dark', 'auto'],
  'tab.': ['today', 'meds', 'charts', 'doubts', 'settings'],
  'title.': ['today', 'meds', 'charts', 'doubts', 'settings'],
  'qq.': ['food', 'forgot', 'fever', 'headache', 'nausea', 'sleep', 'water', 'anxiety', 'exercise'],
  'preset.': ['morning', 'afternoon', 'night', 'other'],
  'age.': ['young', 'middle', 'senior'],
  'sizePreset.': ['normal', 'large', 'xlarge'],
};
['welcome', 'daily', 'meds', 'charts', 'sos', 'settings'].forEach((k) => { used.add(`tour.${k}.title`); used.add(`tour.${k}.text`); });
Object.entries(dyn).forEach(([p, vals]) => vals.forEach((v) => used.add(p + v)));
['mood', 'symptoms', 'meds', 'sleep', 'water'].forEach((k) => used.add(`chart.${k}.title`));
['medication', 'appointment', 'symptom'].forEach((ty) => ['new', 'edit'].forEach((m) => used.add(`entry.title.${ty}.${m}`)));

let problems = 0;
const ptKeys = Object.keys(dicts.pt);
for (const l of ['pt', 'en', 'es']) {
  const keys = new Set(Object.keys(dicts[l]));
  const missing = [...used].filter((k) => !keys.has(k));
  const notInPt = l === 'pt' ? [] : ptKeys.filter((k) => !keys.has(k));
  const extra = l === 'pt' ? [...keys].filter((k) => !used.has(k) && !/\.hint$/.test(k)) : [];
  if (missing.length) { problems++; console.log(`[${l}] faltando (usadas no app):`, missing); }
  if (notInPt.length) { problems++; console.log(`[${l}] faltando (existem em pt):`, notInPt); }
  if (extra.length) console.log(`[${l}] não usadas no app:`, extra);
  // Os {marcadores} precisam ser iguais nos três idiomas.
  if (l !== 'pt') {
    ptKeys.forEach((k) => {
      if (!keys.has(k)) return;
      const a = (dicts.pt[k].match(/\{\w+\}/g) || []).sort().join();
      const b = (dicts[l][k].match(/\{\w+\}/g) || []).sort().join();
      // No singular (.one) o número pode ficar implícito ("Every hour").
      if (a !== b && !k.endsWith('.one')) { problems++; console.log(`[${l}] marcadores diferentes em ${k}: pt=${a} ${l}=${b}`); }
    });
  }
}
console.log(problems ? `\n${problems} problema(s) encontrado(s).` : `OK: ${used.size} chaves conferidas nos 3 idiomas.`);
process.exit(problems ? 1 : 0);
