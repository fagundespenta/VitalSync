// Link do APK. O plano grátis do Firebase Hosting não aceita arquivos .apk,
// então o arquivo fica em outro lugar (ex.: Google Drive ou GitHub Releases). Cole o link entre as aspas.
// Vazio = o botão leva para "Como instalar" e avisa que o download sai em breve.
// Google Drive (arquivo VitalSync.apk compartilhado como "Qualquer pessoa com o link · Leitor").
// Para atualizar o app: no Drive, botão direito no arquivo → Gerenciar versões → Enviar nova versão (o link continua o mesmo).
const APK_URL = 'https://drive.usercontent.google.com/download?id=1zA7thMWoCQxKZ5FVhpU83M1FK3ubNAUJ&export=download&confirm=t';

// Troca de idioma do site (lembra a escolha no navegador).
(() => {
  const DICT = window.SITE_I18N;
  const LOCALES = { pt: 'pt-BR', en: 'en', es: 'es' };
  const fromBrowser = () => {
    const nav = String(navigator.language || 'pt').toLowerCase();
    return nav.startsWith('es') ? 'es' : nav.startsWith('en') ? 'en' : 'pt';
  };
  const saved = () => { try { return localStorage.getItem('vitalsync-site-lang'); } catch { return null; } };
  const remember = (l) => { try { localStorage.setItem('vitalsync-site-lang', l); } catch { /* ignora */ } };

  const apply = (lang) => {
    const t = DICT[lang] || DICT.pt;
    document.documentElement.lang = LOCALES[lang] || 'pt-BR';
    document.title = t['meta.title'];
    document.querySelector('meta[name="description"]').setAttribute('content', t['meta.description']);
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const text = t[el.dataset.i18n];
      if (text != null) el.textContent = text;
    });
    document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    // Botões de download: link externo do APK (ou aviso de "em breve").
    document.querySelectorAll('.btn-download').forEach((a) => {
      a.removeAttribute('download');
      if (APK_URL) { a.href = APK_URL; a.target = '_blank'; a.rel = 'noopener'; }
      else { a.href = '#instalar'; a.querySelector('small').textContent = t['cta.soon']; }
    });
  };

  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    remember(b.dataset.lang);
    apply(b.dataset.lang);
  }));

  // Idioma pela URL (?lang=en), pela escolha anterior ou pelo idioma do navegador.
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const start = [fromUrl, saved(), fromBrowser()].find((l) => l && DICT[l]) || 'pt';
  apply(start);
  document.getElementById('ano').textContent = new Date().getFullYear();
})();
