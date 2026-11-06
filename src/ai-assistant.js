/*
 * VitalSync - AI health assistant (OpenAI / Gemini, retries, timeout, native HTTP to avoid CORS)
 *
 * Excerpt from www/js/app.js (~3,400 lines, vanilla JavaScript).
 * Shared as a code sample; the full source is private. Comments are in Portuguese (original codebase).
 * Trecho do app.js original, publicado como amostra de código. O código completo é privado.
 */

  // ---------- Assistente IA ----------
  const isOpenAI = () => CONFIG.provider === 'openai';
  const aiApiKey = () => (isOpenAI() ? CONFIG.openaiApiKey : CONFIG.geminiApiKey);

  // Dados do perfil que ajudam a IA a responder (vão só nesta chamada).
  const aiContext = () => {
    const age = ageFrom(state.profile?.dob);
    const meds = [
      ...visiblePlans().map((p) => `${p.name}${p.dosage ? ` (${p.dosage})` : ''} — ${p.times.join(', ')}`),
      ...[...new Map(dayKeys().flatMap((ds) => (state.data[ds].medications || []).map((m) => [m.name.toLowerCase(), m.name]))).values()],
    ].slice(0, 15);
    const day = getDay(todayISO());
    const syms = (day.symptomsCheck || []).map((s) => (SYMPTOMS.some((x) => x.k === s.k)
      ? `${symptomLabel(s.k)}${s.level ? ` (${t(`level.${s.level}`).toLowerCase()})` : ''}` : '')).filter(Boolean);
    const lines = [
      firstName() && t('ai.ctx.name', { name: firstName() }),
      age != null && t('ai.ctx.age', { age }),
      meds.length && t('ai.ctx.meds', { meds: meds.join('; ') }),
      state.profile?.healthNotes && t('ai.ctx.notes', { notes: state.profile.healthNotes }),
      day.mood && t('ai.ctx.mood', { mood: moodLabel(Number(day.mood)) }),
      syms.length && t('ai.ctx.symptoms', { symptoms: syms.join(', ') }),
    ].filter(Boolean);
    return lines.length ? `\n\n${t('ai.ctx.header')}\n${lines.join('\n')}` : '';
  };

  // Monta a chamada para o provedor escolhido em config.js.
  // history: [{ role: 'user' | 'assistant', text }] — a conversa até agora, terminando na pergunta atual.
  // No celular, a IA usa o HTTP nativo (CapacitorHttp) só nesta chamada: evita o bloqueio de CORS da OpenAI
  // sem mexer nas outras conexões (o Firebase não funciona se o HTTP nativo substituir todas).
  const postJSON = async (url, headers, body, signal) => {
    const http = plugin('CapacitorHttp');
    if (http) {
      const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      const r = await Promise.race([http.request({ url, method: 'POST', headers, data: JSON.parse(body), responseType: 'json' }), aborted]);
      let json = r.data;
      if (typeof json === 'string') { try { json = JSON.parse(json); } catch { json = {}; } }
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: json || {} };
    }
    const res = await fetch(url, { method: 'POST', headers, body, signal });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  };

  const buildAIRequest = (history) => {
    const system = t('ai.system') + aiContext();
    if (isOpenAI()) {
      // API "Chat Completions" — também funciona com serviços compatíveis (ex.: OpenRouter) trocando openaiBaseUrl.
      // A OpenAI bloqueia chamadas do navegador (CORS). No app nativo o CapacitorHttp resolve;
      // no navegador local, o dev-server.js repassa a chamada.
      const base = CONFIG.openaiBaseUrl.replace(/\/+$/, '');
      const viaProxy = !isNative() && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
      return {
        url: viaProxy ? '/ai-proxy/chat/completions' : `${base}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CONFIG.openaiApiKey}`,
          ...(viaProxy ? { 'X-Target-Base': base } : {}),
        },
        body: JSON.stringify({
          model: CONFIG.openaiModel,
          messages: [
            { role: 'system', content: system },
            ...history.map((m) => ({ role: m.role, content: m.text })),
          ],
        }),
        readText: (json) => String(json.choices?.[0]?.message?.content || '').trim(),
      };
    }
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(CONFIG.geminiModel)}:generateContent?key=${encodeURIComponent(CONFIG.geminiApiKey)}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
      }),
      readText: (json) => (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim(),
    };
  };

  // Apaga a conversa (e cancela uma resposta em andamento).
  let aiAbort = null;
  const clearChat = () => {
    if (aiAbort) { aiAbort.cleared = true; aiAbort.abort(); aiAbort = null; }
    state.chat = [];
    state.aiBusy = false;
  };

  const askAI = async (question) => {
    const q = question.trim();
    if (!q || state.aiBusy) return;
    state.tab = 'doubts';
    state.chat.push({ role: 'user', text: q });
    if (!aiApiKey()) {
      state.chat.push({ role: 'bot', error: true, html: esc(t('ai.noKey', { field: isOpenAI() ? 'openaiApiKey' : 'geminiApiKey' })) });
      render(); scrollToEnd();
      return;
    }
    // Histórico: perguntas e respostas válidas desta conversa (as mais recentes), terminando na pergunta atual.
    const history = state.chat
      .filter((m) => m.role === 'user' || (m.role === 'bot' && m.text))
      .slice(-(MAX_HISTORY + 1))
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }));
    const pending = { role: 'bot', loading: true };
    state.chat.push(pending);
    state.aiBusy = true;
    render(); scrollToEnd();

    const ctrl = new AbortController();
    aiAbort = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const { url, headers, body, readText } = buildAIRequest(history);
      // Erros de sobrecarga (429/5xx) costumam ser passageiros: tenta de novo algumas vezes.
      // Exceção: 429 por falta de créditos não adianta repetir.
      const isBusy = (res, json) => (res.status === 429 || res.status >= 500) && json?.error?.code !== 'insufficient_quota';
      let res, json;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
        res = await postJSON(url, headers, body, ctrl.signal);
        json = res.json;
        if (res.ok || !isBusy(res, json)) break;
      }
      if (!res.ok) {
        const err = new Error(json?.error?.message || `HTTP ${res.status}`);
        err.busy = isBusy(res, json);
        throw err;
      }
      const text = readText(json);
      if (!text) throw new Error(t('ai.emptyAnswer'));
      pending.text = text;
      pending.html = `${md(text)}<span class="foot">${esc(t('ai.footnote'))}</span>`;
    } catch (e) {
      if (e.name === 'AbortError' && ctrl.cleared) return; // conversa apagada no meio da resposta
      pending.error = true;
      pending.html = e.name === 'AbortError'
        ? esc(t('ai.timeout'))
        : !navigator.onLine
          ? esc(t('ai.offline'))
          : e.busy
            ? esc(t('ai.busy'))
            : `${esc(t('ai.failed'))}<br><small>${esc(e.message)}</small>`;
    } finally {
      clearTimeout(timer);
      if (aiAbort === ctrl) aiAbort = null;
      pending.loading = false;
      if (!ctrl.cleared) {
        state.aiBusy = false;
        if (state.tab === 'doubts') { render(); scrollToEnd(); }
      }
    }
  };
