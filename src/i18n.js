/*
 * VitalSync - Lightweight i18n with interpolation and plurals (pt / en / es)
 *
 * Excerpt from www/js/app.js (~3,400 lines, vanilla JavaScript).
 * Shared as a code sample; the full source is private. Comments are in Portuguese (original codebase).
 * Trecho do app.js original, publicado como amostra de código. O código completo é privado.
 */

  // ---------- Idiomas ----------
  // Todos os textos ficam em www/i18n/{pt,en,es}.js. Aqui só usamos as chaves.
  const DICTS = window.VS_I18N || {};
  const LANGS = [
    { id: 'pt', flag: '🇧🇷', name: 'Português' },
    { id: 'en', flag: '🇺🇸', name: 'English' },
    { id: 'es', flag: '🇪🇸', name: 'Español' },
  ];
  const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };
  const detectLang = () => {
    const nav = String(navigator.language || 'pt').toLowerCase();
    return nav.startsWith('es') ? 'es' : nav.startsWith('en') ? 'en' : 'pt';
  };
  let lang = 'pt';
  // t('chave', { nome: 'Ana' }) → texto traduzido, trocando {nome} pelo valor.
  const t = (key, params) => {
    let s = DICTS[lang]?.[key] ?? DICTS.pt?.[key];
    if (s == null) { console.warn('Tradução ausente:', key); s = key; }
    return params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m)) : s;
  };
  // Plural: usa 'chave.one' quando n = 1 e 'chave.other' nos demais casos.
  const tn = (key, n, params = {}) => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params });
  const loc = () => LOCALES[lang] || 'pt-BR';
  const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const monthName = (m) => capFirst(new Date(2000, m, 1).toLocaleDateString(loc(), { month: 'long' }));
  // 1º de janeiro de 2023 foi um domingo.
  const weekdayShort = (i) => capFirst(new Date(2023, 0, 1 + i).toLocaleDateString(loc(), { weekday: 'short' }).replace(/\.$/, ''));
  const fmtNumber = (n, digits = 1) => Number(n).toLocaleString(loc(), { maximumFractionDigits: digits });
