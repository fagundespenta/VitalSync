/*
 * VitalSync - Offline-first cloud sync engine (Firestore, last-write-wins, per-record hashing)
 *
 * Excerpt from www/js/app.js (~3,400 lines, vanilla JavaScript).
 * Shared as a code sample; the full source is private. Comments are in Portuguese (original codebase).
 * Trecho do app.js original, publicado como amostra de código. O código completo é privado.
 */

  // ---------- Nuvem (Firestore) ----------
  // Os dados são divididos em "registros"; cada um vira um documento em users/{conta}/records/{id}:
  //   day_AAAA-MM-DD → um dia do diário · plans → remédios e lembretes · profile → seus dados
  // Cada documento leva { data, u, del }. Em conflito, vale o registro com o "u" (hora da alteração) mais recente.
  const Cloud = window.VSCloud || { configured: false };
  const inFlight = new Map(); // id → promessa do envio em andamento
  const hashOf = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return `${s.length}.${h}`; };
  const recordsNow = () => {
    const out = {};
    dayKeys().forEach((ds) => { out[`day_${ds}`] = state.data[ds]; });
    out.plans = { medPlans: state.data.medPlans, reminders: state.data.reminders };
    if (state.profile) out.profile = state.profile;
    return out;
  };
  const isEmptyRecord = (id, v) => id === 'plans' && !v.medPlans.length && !v.reminders.length;
  const applyRecord = (id, value) => {
    if (id.startsWith('day_')) {
      const ds = id.slice(4);
      if (!isISODate(ds)) return;
      if (value && typeof value === 'object') state.data[ds] = value; else delete state.data[ds];
    } else if (id === 'plans') {
      state.data.medPlans = Array.isArray(value?.medPlans) ? value.medPlans : [];
      state.data.reminders = Array.isArray(value?.reminders) ? value.reminders : [];
    } else if (id === 'profile' && value && typeof value === 'object') state.profile = value;
  };
  const saveSyncMeta = () => { if (!cloudMode()) ls.set(KEYS.sync, JSON.stringify(sync.meta)); };
  const pendingCount = () => Object.values(sync.meta).filter((m) => !m.s).length;
  const canSend = () => !!(Cloud.configured && sync.user);

  // Compara o que mudou desde a última vez e marca para envio.
  const markChanges = () => {
    const now = Date.now();
    const recs = recordsNow();
    let changed = false;
    Object.entries(recs).forEach(([id, v]) => {
      const h = hashOf(JSON.stringify(v));
      const m = sync.meta[id];
      if (m && m.h === h && !m.del) return;
      // Lista de remédios vazia num aparelho novo não deve apagar a da nuvem: conta como "mais antiga".
      sync.meta[id] = { u: !m && isEmptyRecord(id, v) ? 0 : now, h, s: false };
      changed = true;
    });
    Object.entries(sync.meta).forEach(([id, m]) => {
      if (!(id in recs) && !m.del) { sync.meta[id] = { u: now, h: '', s: false, del: true }; changed = true; }
    });
    if (changed) { saveSyncMeta(); flush(); }
  };

  // Envia o que ainda não está na nuvem. Sem internet, o Firestore guarda e envia quando ela voltar.
  const flush = () => {
    if (!canSend()) { updateSyncChip(); return; }
    const recs = recordsNow();
    Object.entries(sync.meta).forEach(([id, m]) => {
      if (m.s || inFlight.get(id)?.u === m.u) return;
      const u = m.u;
      const p = Cloud.push(id, { data: m.del ? null : (recs[id] ?? null), u, del: !!m.del })
        .then(() => {
          if (sync.meta[id]?.u === u) { sync.meta[id].s = true; saveSyncMeta(); }
          sync.error = '';
        })
        .catch((e) => { sync.error = e?.code || 'error'; console.warn('Nuvem:', e); })
        .finally(() => { if (inFlight.get(id)?.p === p) inFlight.delete(id); updateSyncChip(); });
      inFlight.set(id, { u, p });
    });
    updateSyncChip();
  };
  // Espera tudo chegar ao servidor (com limite de tempo). true = tudo enviado.
  const uploadAll = async (timeoutMs = 25000) => {
    markChanges();
    flush();
    const all = Promise.all([...inFlight.values()].map((x) => x.p));
    await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
    return canSend() && pendingCount() === 0 && !sync.error;
  };

  // Busca a nuvem e junta com o que está no aparelho (o mais recente prevalece).
  let pulling = null;
  const pull = () => {
    if (!canSend()) return Promise.resolve(false);
    if (pulling) return pulling;
    pulling = (async () => {
      let remote;
      try { remote = await Cloud.pullAll(); } catch (e) {
        sync.error = navigator.onLine === false || e?.code === 'unavailable' ? '' : (e?.code || 'error');
        console.warn('Nuvem:', e);
        updateSyncChip();
        return false;
      }
      sync.error = '';
      const applied = [];
      Object.entries(remote).forEach(([id, r]) => {
        if (id !== 'plans' && id !== 'profile' && !id.startsWith('day_')) return;
        const m = sync.meta[id];
        const ru = Number(r?.u) || 0;
        if (!m || ru > m.u) { applyRecord(id, r.del ? null : r.data); applied.push([id, ru, !!r.del]); }
        else if (ru === m.u) m.s = true;
        else m.s = false;
      });
      Object.keys(sync.meta).forEach((id) => { if (!(id in remote) && !sync.meta[id].del) sync.meta[id].s = false; });
      if (applied.length) {
        fixData();
        const recs = recordsNow();
        applied.forEach(([id, u]) => {
          sync.meta[id] = id in recs ? { u, h: hashOf(JSON.stringify(recs[id])), s: true } : { u, h: '', s: true, del: true };
        });
        saveLocal();
        syncNotifications();
      }
      saveSyncMeta();
      flush();
      if (applied.length && sync.ready && state.profile && !sheets.length) render();
      return true;
    })().finally(() => { pulling = null; });
    return pulling;
  };

  // Indicador discreto no topo: ☁️ sincronizado · ⏳ aguardando internet · 🔄 enviando · 📱 só no celular · ⚠️ erro
  const syncStatus = () => {
    if (!sync.online) return 'offline';
    if (!Cloud.configured || !sync.user) return cloudMode() ? 'offline' : 'local';
    if (sync.error) return 'error';
    return pendingCount() ? 'sending' : 'synced';
  };
  const SYNC_EMOJI = { local: '📱', synced: '☁️', offline: '⏳', sending: '🔄', error: '⚠️' };
  const updateSyncChip = () => {
    const chip = $('#sync-chip');
    if (!chip) return;
    const st = syncStatus();
    chip.hidden = !state.profile || (st === 'local' && !Cloud.configured);
    chip.dataset.state = st;
    chip.innerHTML = `<span aria-hidden="true">${SYNC_EMOJI[st]}</span><span class="sync-text">${esc(t(`sync.${st}`))}</span>`;
    chip.setAttribute('aria-label', t(`sync.${st}.long`));
    const line = $('[data-sync-line]');
    if (line) line.textContent = `${SYNC_EMOJI[st]} ${t(`sync.${st}.long`)}`;
  };

  const cloudErrorText = (e) => {
    const code = String(e?.code || e?.message || '');
    if (/cancel|12501|popup-closed/i.test(code)) return t('cloud.loginCanceled');
    if (/network|unavailable/i.test(code) || navigator.onLine === false) return t('cloud.needInternet');
    return t('cloud.loginError');
  };
  const cloudLogin = async () => {
    if (!Cloud.configured) { toast(t('cloud.notConfigured'), { type: 'error' }); return false; }
    if (navigator.onLine === false) { toast(t('cloud.needInternet'), { type: 'error' }); return false; }
    try {
      await Cloud.signIn();
      return true;
    } catch (e) {
      console.warn('Login:', e);
      toast(cloudErrorText(e), { type: 'error', duration: 6000 });
      return false;
    }
  };
