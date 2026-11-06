/*
 * VitalSync - Medication plans and native alarm/notification scheduler (Capacitor)
 *
 * Excerpt from www/js/app.js (~3,400 lines, vanilla JavaScript).
 * Shared as a code sample; the full source is private. Comments are in Portuguese (original codebase).
 * Trecho do app.js original, publicado como amostra de código. O código completo é privado.
 */

  // ----- Planos de remédio (horários que se repetem todo dia) -----
  // { id, name, dosage, mode: 'fixed'|'interval', times: ['08:00', ...], intervalHours, firstTime,
  //   startDate, days: número | null (uso contínuo), removed, removedOn }
  // Doses tomadas ficam em data[dia].doses = { 'idDoPlano|08:00': '08:12' (hora em que tocou "Tomei") }.
  const intervalTimes = (first, hours) => {
    const [h, m] = first.split(':').map(Number);
    const out = [];
    for (let i = 0, min = h * 60 + m; i < Math.floor(24 / hours); i++, min += hours * 60) {
      out.push(`${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`);
    }
    return [...new Set(out)].sort();
  };
  const planEnd = (p) => (p.days ? toISO(addDays(fromISO(p.startDate), p.days)) : null); // exclusivo
  const planActiveOn = (p, ds) => ds >= p.startDate
    && (!p.days || ds < planEnd(p))
    && (!p.removed || ds < p.removedOn);
  const visiblePlans = () => state.data.medPlans.filter((p) => !p.removed);
  const dosesFor = (ds) => {
    const day = getDay(ds);
    return state.data.medPlans
      .filter((p) => planActiveOn(p, ds))
      .flatMap((p) => p.times.map((time) => ({ plan: p, time, key: `${p.id}|${time}`, takenAt: day.doses?.[`${p.id}|${time}`] || '' })))
      .sort((a, b) => a.time.localeCompare(b.time));
  };
  const intervalLabel = (h) => (INTERVALS.includes(Number(h)) ? t(`interval.${h}`) : t('interval.custom', { h }));
  const planSummary = (p) => {
    const when = p.mode === 'interval' ? intervalLabel(p.intervalHours) : tn('plan.timesPerDay', p.times.length);
    let period = t('plan.continuous');
    if (p.days) {
      const end = addDays(fromISO(planEnd(p)), -1);
      period = t(toISO(end) < todayISO() ? 'plan.endedOn' : 'plan.until', { date: shortDate(end) });
    }
    return `${when} · ${period}`;
  };

  // ----- Lembretes da versão anterior (remédio por intervalo e aviso de consulta) -----
  const reminderFor = (itemId) => state.data.reminders.find((r) => sameId(r.originalId, itemId));
  const reminderDay = (r) => r.originalDate || findEntry(r.originalId)?.ds || r.date.slice(0, 10);
  // Remédio:  { date: 1ª dose, intervalHours, repeatDays }  → uma notificação por dose.
  // Consulta: { date: horário da consulta, leadMinutes }   → uma notificação X min antes.
  // Lembretes antigos (sem esses campos) disparam uma única vez em `date`.
  const setReminder = (item, type, ds, opts) => {
    state.data.reminders = state.data.reminders.filter((r) => !sameId(r.originalId, item.id));
    const base = { id: uid(), originalId: item.id, type, originalDate: ds };
    if (type === 'medication' && opts.when) {
      state.data.reminders.push({
        ...base, name: item.name, date: opts.when,
        intervalHours: Number(opts.intervalHours) || 24,
        repeatDays: Math.min(MAX_DAYS, Math.max(1, Number(opts.repeatDays) || 1)),
      });
    }
    if (type === 'appointment' && opts.lead !== '' && opts.lead != null && item.time) {
      state.data.reminders.push({ ...base, name: item.specialty, date: `${ds}T${item.time}`, leadMinutes: Number(opts.lead) });
    }
  };
  // Horários em que o lembrete dispara (Date[]).
  const reminderTimes = (r) => {
    const start = new Date(r.date);
    if (Number.isNaN(start.getTime())) return [];
    if (r.type === 'appointment' && r.leadMinutes != null) return [new Date(start.getTime() - r.leadMinutes * 60000)];
    if (!r.repeatDays) return [start];
    const step = (Number(r.intervalHours) || 24) * 3600000;
    const end = start.getTime() + r.repeatDays * 86400000;
    const out = [];
    for (let tm = start.getTime(); tm < end; tm += step) out.push(new Date(tm));
    return out;
  };
  // Data principal para exibir: a consulta em si, ou a próxima dose (ou a última, se já acabou).
  const reminderWhen = (r) => {
    if (r.type === 'appointment') return new Date(r.date);
    const times = reminderTimes(r);
    return times.find((d) => d.getTime() >= Date.now()) || times[times.length - 1] || new Date(r.date);
  };
  const reminderDone = (r) => (r.type === 'appointment'
    ? new Date(r.date).getTime() < Date.now()
    : !reminderTimes(r).some((d) => d.getTime() >= Date.now()));
  const leadLabel = (m) => (LEADS.includes(m) ? t(`lead.${m}`) : t('lead.custom', { m }));
  // Texto curto da regra: "de 8 em 8 h · até 26 de out." / "aviso 1 hora antes".
  const reminderRule = (r) => {
    if (r.type === 'appointment') {
      if (r.leadMinutes == null) return '';
      return t('reminder.alertRule', { lead: leadLabel(r.leadMinutes).toLowerCase() });
    }
    if (!r.repeatDays) return '';
    const times = reminderTimes(r);
    if (times.length <= 1) return t('reminder.singleDose');
    return t('reminder.repeatRule', { interval: intervalLabel(r.intervalHours).toLowerCase(), date: shortDate(times[times.length - 1]) });
  };
  const countEntries = () => dayKeys().reduce((n, ds) => {
    const d = state.data[ds];
    return n + (d.medications?.length || 0) + (d.appointments?.length || 0) + (d.symptoms?.length || 0) + (hasCheckin(d) ? 1 : 0);
  }, 0);

  // ----- Alarme dos remédios -----
  // Sons em android/app/src/main/res/raw (gerados por tools/make-sounds.js); prévia em www/sounds.
  const ALARM_SOUNDS = [{ id: 'classic', e: '⏰' }, { id: 'bell', e: '🔔' }, { id: 'digital', e: '📟' }];
  const ALARM_VOLUMES = [{ id: 'low', e: '🔈', gain: 0.3 }, { id: 'medium', e: '🔉', gain: 0.6 }, { id: 'high', e: '🔊', gain: 0.95 }];
  const alarmOn = () => { const n = state.settings.notif; return n.enabled && n.meds && n.alarm !== false && feat('meds'); };
  // Cria (no Android) o canal do alarme com o som e o volume escolhidos. Devolve o id do canal.
  const alarmChannel = async () => {
    const AC = plugin('AlarmChannel');
    if (!AC || !alarmOn()) { try { await AC?.removeAll(); } catch { /* ignora */ } return null; }
    const n = state.settings.notif;
    try {
      const r = await AC.ensure({ sound: n.alarmSound, volume: n.alarmVolume, name: t('alarm.channelName'), description: t('alarm.channelDesc') });
      return r?.id || null;
    } catch (e) { console.warn('Canal do alarme:', e); return null; }
  };
  const alarmSoundFile = () => `alarm_${state.settings.notif.alarmSound}_${state.settings.notif.alarmVolume}.wav`;
  const registerMedActions = async (LN) => {
    try {
      await LN.registerActionTypes({
        types: [
          { id: 'MED_DOSE', actions: [{ id: 'took', title: t('notif.took') }, { id: 'snooze', title: t('notif.snooze') }] },
          { id: 'MED_SNOOZE', actions: [{ id: 'snooze', title: t('notif.snooze') }] },
        ],
      });
    } catch (e) { console.warn('Botões da notificação:', e); }
  };

  const refreshNotifPerm = async () => {
    const LN = plugin('LocalNotifications');
    if (!LN) { state.notifPerm = 'unavailable'; return; }
    try { state.notifPerm = (await LN.checkPermissions()).display; } catch { state.notifPerm = 'unavailable'; }
  };

  // Só pede a permissão do Android quando o usuário liga a primeira notificação.
  const ensureNotifPermission = async () => {
    const LN = plugin('LocalNotifications');
    if (!LN) {
      if (!isNative()) toast(t('notif.onlyOnPhone'));
      return false;
    }
    try {
      let p = (await LN.checkPermissions()).display;
      if (p !== 'granted') p = (await LN.requestPermissions()).display;
      state.notifPerm = p;
      if (p === 'granted') syncNotifications();
      else toast(t('notif.deniedToast'), { duration: 6000 });
      if (state.tab === 'settings' || state.tab === 'meds') render();
      return p === 'granted';
    } catch (e) { console.warn('Notificações:', e); return false; }
  };

  // Monta a lista completa de notificações a partir dos dados e das preferências (no idioma atual).
  // alarmId: canal do alarme dos remédios (null = som normal de notificação).
  const buildNotifications = (alarmId = null) => {
    const n = state.settings.notif;
    if (!n.enabled) return [];
    const now = Date.now();
    const list = [];
    const hm = (tm) => { const [hour, minute] = tm.split(':').map(Number); return { hour, minute }; };
    const medBody = (p, tm) => t('notif.medBody', { emoji: timeEmoji(tm), time: tm, name: p.name, dosage: p.dosage ? ` (${p.dosage})` : '' });
    // Alarme: canal próprio (Android 8+) ou som no próprio aviso (Android 7).
    const alarm = alarmId ? { channelId: alarmId, sound: alarmSoundFile() } : {};

    if (n.meds && feat('meds')) {
      // Planos de remédio (horários fixos / de X em X horas) — com os botões "Tomei" e "Lembrar em 10 minutos"
      visiblePlans().forEach((p) => {
        if (!p.days) {
          p.times.forEach((tm, i) => list.push({
            id: notifId(p.id, i), title: t('notif.medTitle'), body: medBody(p, tm),
            schedule: { on: hm(tm), allowWhileIdle: true }, actionTypeId: 'MED_DOSE', ...alarm,
            extra: { open: 'meds', planId: p.id, time: tm },
          }));
          return;
        }
        let k = 0;
        for (let d = fromISO(p.startDate); toISO(d) < planEnd(p) && k < MAX_NOTIFS_PER_REMINDER; d = addDays(d, 1)) {
          p.times.forEach((tm) => {
            const at = new Date(`${toISO(d)}T${tm}`);
            if (at.getTime() > now && k < MAX_NOTIFS_PER_REMINDER) {
              list.push({
                id: notifId(p.id, k++), title: t('notif.medTitle'), body: medBody(p, tm),
                schedule: { at, allowWhileIdle: true }, actionTypeId: 'MED_DOSE', ...alarm,
                extra: { open: 'meds', date: toISO(d), planId: p.id, time: tm },
              });
            }
          });
        }
      });
      // Lembretes da versão anterior (remédio por intervalo e consultas)
      state.data.reminders.forEach((r) => {
        const appt = new Date(r.date);
        reminderTimes(r)
          .map((at, k) => ({ at, k }))
          .filter(({ at }) => at.getTime() > now)
          .slice(0, MAX_NOTIFS_PER_REMINDER)
          .forEach(({ at, k }) => list.push({
            id: notifId(r.id, k),
            title: t(r.type === 'medication' ? 'notif.medTitle' : 'notif.apptTitle'),
            body: r.type === 'medication'
              ? t('notif.medSimple', { name: r.name })
              : t('notif.apptBody', { name: r.name, day: relDayShort(appt).toLowerCase(), time: fmtTime(appt) }),
            schedule: { at, allowWhileIdle: true },
            ...(r.type === 'medication' ? { actionTypeId: 'MED_SNOOZE', ...alarm } : {}),
            extra: { open: 'meds', date: reminderDay(r) },
          }));
      });
    }

    // Aviso diário que chama para o app: "O que você está sentindo hoje?"
    if (n.checkin && isTime(n.checkinTime)) {
      list.push({
        id: NOTIF_CHECKIN, title: t('notif.checkinTitle'),
        body: firstName() ? t('notif.checkinBodyName', { name: firstName() }) : t('notif.checkinBody'),
        schedule: { on: hm(n.checkinTime), allowWhileIdle: true }, extra: { open: 'checkin' },
      });
    }

    // Água: de X em X horas, entre o horário inicial e o final
    if (n.water && feat('water') && isTime(n.waterFrom) && isTime(n.waterTo)) {
      const from = hm(n.waterFrom), to = hm(n.waterTo);
      const step = Math.max(1, Number(n.waterEvery) || 2) * 60;
      for (let m = from.hour * 60 + from.minute, i = 0; m <= to.hour * 60 + to.minute && i < 24; m += step, i++) {
        list.push({
          id: NOTIF_WATER + i, title: t('notif.waterTitle'), body: t('notif.waterBody'),
          schedule: { on: { hour: Math.floor(m / 60), minute: m % 60 }, allowWhileIdle: true }, extra: { open: 'water' },
        });
      }
    }
    return list.slice(0, MAX_NOTIFS_TOTAL);
  };

  // Reagenda tudo do zero (simples e sempre consistente): desligar um tipo cancela os avisos dele.
  const syncNotifications = debounce(async () => {
    const LN = plugin('LocalNotifications');
    if (!LN) return;
    // Modo "só nuvem": espera os dados chegarem para não apagar os avisos já agendados.
    if (cloudMode() && !sync.ready) return;
    try {
      if ((await LN.checkPermissions()).display !== 'granted') return;
      await registerMedActions(LN); // de novo a cada vez: os textos dos botões seguem o idioma
      const alarmId = await alarmChannel();
      const pending = await LN.getPending();
      // Os "Lembrar em 10 minutos" já pedidos continuam valendo.
      const toCancel = (pending.notifications || []).filter((x) => !isSnoozeId(x.id) && x.id !== NOTIF_TEST);
      if (toCancel.length) await LN.cancel({ notifications: toCancel.map((x) => ({ id: x.id })) });
      const list = buildNotifications(alarmId);
      if (list.length) await LN.schedule({ notifications: list });
    } catch (e) { console.warn('Falha ao agendar notificações:', e); }
  }, 400);

  const scrollToCard = (id) => setTimeout(() => {
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
  }, 80);

  const snoozeNotification = async (LN, notif) => {
    const at = new Date(Date.now() + SNOOZE_MIN * 60000);
    try {
      await LN.schedule({
        notifications: [{
          id: NOTIF_SNOOZE + (Math.floor(Date.now() / 1000) % 1000),
          title: notif.title || t('notif.medTitle'),
          body: notif.body || '',
          schedule: { at, allowWhileIdle: true },
          actionTypeId: notif.actionTypeId || 'MED_SNOOZE',
          channelId: notif.channelId || (await alarmChannel()) || undefined,
          sound: notif.sound || undefined,
          extra: notif.extra || { open: 'meds' },
        }],
      });
      toast(`⏰ ${t('notif.snoozedToast', { time: fmtTime(at) })}`, { duration: 5000 });
    } catch (e) { console.warn('Lembrar depois:', e); toast(t('notif.snoozeError'), { type: 'error' }); }
  };

  // Alarmes exatos (Android 12+): sem essa permissão o Android pode atrasar o alarme.
  const refreshExactAlarm = async () => {
    const LN = plugin('LocalNotifications');
    try { state.exactAlarm = LN ? (await LN.checkExactNotificationSetting()).exact_alarm : 'granted'; } catch { state.exactAlarm = 'granted'; }
  };

  const setupNative = () => {
    if (!isNative()) return;
    const safe = (fn) => { try { Promise.resolve(fn()).catch(() => {}); } catch { /* plugin ausente */ } };
    const App = plugin('App');
    safe(() => App?.addListener('backButton', () => {
      if (tour) return endTutorial();
      if (sheets.length) return closeSheet();
      if (state.tab !== 'today') return go('today');
      App.exitApp();
    }));
    loadAppInfo();
    safe(() => App?.addListener('pause', () => clearChat()));
    safe(() => App?.addListener('resume', () => {
      // Volta das configurações do Android (ex.: "Alarmes e lembretes"): confere de novo a permissão.
      refreshExactAlarm().then(() => { if (state.tab === 'settings' && !sheets.length) render(); });
      if (state.profile) { render(); maybeGreet(); }
      setTimeout(() => checkForUpdate(), 3000);
    }));
    const LN = plugin('LocalNotifications');
    safe(() => LN?.addListener('localNotificationActionPerformed', (ev) => {
      const notif = ev?.notification || {};
      const ex = notif.extra || {};
      // Botão "💊 Tomei": marca a dose como tomada.
      if (ev?.actionId === 'took' && ex.planId != null && isTime(ex.time)) {
        // No modo "só nuvem", espera os dados chegarem antes de marcar (senão apagaria o dia na nuvem).
        if (cloudMode() && !sync.ready) { afterCloudReady.push(() => markTookFromNotif(ex)); return; }
        markTookFromNotif(ex);
        return;
      }
      // Botão "⏰ Lembrar em 10 minutos": agenda o mesmo aviso de novo.
      if (ev?.actionId === 'snooze') {
        snoozeNotification(LN, notif);
        return;
      }
      closeAllSheets();
      selectDate(ex.date && isISODate(ex.date) ? fromISO(ex.date) : today());
      go('today');
      if (ex.open === 'checkin') openGreeting();
      else if (ex.open === 'water') scrollToCard('card-water');
      else scrollToCard('card-meds');
    }));
    Promise.all([refreshNotifPerm(), refreshExactAlarm()]).then(() => { syncNotifications(); if (state.tab === 'settings') render(); });
  };
  const afterCloudReady = [];
  // Toca 4 segundos do som escolhido, no volume escolhido (só uma prévia; o alarme real usa o volume de alarme do celular).
  let previewAudio = null;
  const playAlarmPreview = () => {
    const n = state.settings.notif;
    try {
      previewAudio?.pause();
      previewAudio = new Audio(`sounds/alarm_${n.alarmSound}.wav`);
      previewAudio.volume = ALARM_VOLUMES.find((v) => v.id === n.alarmVolume)?.gain ?? 0.95;
      previewAudio.play().catch(() => {});
    } catch { /* sem áudio */ }
  };

  // Botão "💊 Tomei" da notificação: marca a dose (se ainda não estava marcada) e mostra o dia.
  const markTookFromNotif = (ex) => {
    const ds = ex.date && isISODate(ex.date) ? ex.date : todayISO();
    const day = ensureDay(ds);
    day.doses ||= {};
    day.doses[`${ex.planId}|${ex.time}`] ||= ds === todayISO() ? fmtTime(new Date()) : ex.time;
    persist();
    closeAllSheets();
    selectDate(fromISO(ds));
    go('today');
    scrollToCard('card-meds');
    toast(`✅ ${t('meds.tookToast')}`);
  };
