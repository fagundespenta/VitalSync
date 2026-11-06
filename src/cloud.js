/* VitalSync — conexão com a nuvem (Firebase: login com Google + banco Firestore).
   Aqui fica só a "conversa" com o Firebase; quando e o que enviar é decidido em app.js. */
window.VSCloud = (() => {
  'use strict';
  const cfg = window.FIREBASE_CONFIG || {};
  const fb = window.firebase;
  const configured = !!(fb && cfg.apiKey && cfg.projectId && cfg.appId);
  let auth = null;
  let db = null;
  let nativeAuth;

  const isNative = () => !!window.Capacitor?.isNativePlatform?.();
  // Plugin nativo de login (@capacitor-firebase/authentication): abre a escolha de conta Google do Android.
  const getNativeAuth = () => {
    if (nativeAuth === undefined) {
      const register = window.capacitorExports?.registerPlugin || window.Capacitor?.registerPlugin;
      try { nativeAuth = window.Capacitor?.Plugins?.FirebaseAuthentication || (register ? register('FirebaseAuthentication') : null); }
      catch { nativeAuth = null; }
    }
    return nativeAuth;
  };

  // keepOnDevice = true: o Firestore guarda uma cópia no aparelho e envia sozinho quando a internet volta.
  // keepOnDevice = false (modo "só nuvem"): nada fica gravado no aparelho, só na memória enquanto o app está aberto.
  const start = (keepOnDevice) => {
    if (!configured) return false;
    if (db) return true;
    fb.initializeApp(cfg);
    auth = fb.auth();
    db = fb.firestore();
    db.settings({ ignoreUndefinedProperties: true, merge: true });
    if (keepOnDevice) db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* navegador sem suporte: segue só na memória */ });
    return true;
  };

  const onUser = (cb) => (auth ? auth.onAuthStateChanged(cb) : cb(null));
  const user = () => auth?.currentUser || null;

  const signIn = async () => {
    if (!auth) throw new Error('not-configured');
    if (isNative()) {
      const res = await getNativeAuth().signInWithGoogle();
      const idToken = res?.credential?.idToken;
      if (!idToken) throw new Error('no-token');
      return auth.signInWithCredential(fb.auth.GoogleAuthProvider.credential(idToken));
    }
    return auth.signInWithPopup(new fb.auth.GoogleAuthProvider());
  };

  const signOut = async () => {
    if (isNative()) { try { await getNativeAuth()?.signOut(); } catch { /* ignora */ } }
    if (auth) await auth.signOut();
  };

  // Cada pessoa só enxerga a própria pasta: users/{id da conta}/records/{registro}
  const records = () => db.collection('users').doc(auth.currentUser.uid).collection('records');

  // Lê tudo direto do servidor (falha se estiver sem internet — de propósito).
  const pullAll = async () => {
    const snap = await records().get({ source: 'server' });
    const out = {};
    snap.forEach((d) => { out[d.id] = d.data(); });
    return out;
  };
  // A promessa só termina quando o servidor confirma. Sem internet, ela espera.
  const push = (id, rec) => records().doc(id).set(rec);

  const deleteAll = async () => {
    const snap = await records().get({ source: 'server' });
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  };

  // Apaga a cópia que o Firestore guarda no aparelho (usado ao mudar para "só nuvem").
  const clearDeviceCache = async () => {
    if (!db) return;
    await db.terminate();
    await db.clearPersistence();
  };

  return { configured, start, onUser, user, signIn, signOut, pullAll, push, deleteAll, clearDeviceCache };
})();
