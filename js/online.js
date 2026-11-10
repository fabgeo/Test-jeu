// =========================================================
//  MODE EN LIGNE (chacun sur son appareil)
//  Même méthode que le jeu « Taupe » (github.com/fabgeo/taupe) :
//  les messages passent par un relais MQTT public gratuit (WebSocket sécurisé),
//  ce qui marche derrière n'importe quelle box / 4G / wifi.
//
//  L'appareil de l'hôte fait tourner la partie. Sujets d'une salle :
//    <racine>/<CODE>/host    message RETENU « l'hôte est en ligne », renvoyé toutes les 10 s,
//                            effacé par le testament MQTT si l'hôte disparaît
//    <racine>/<CODE>/act     joueurs -> hôte (join, réponses, ping, bye en testament)
//    <racine>/<CODE>/all     hôte -> tout le monde
//    <racine>/<CODE>/p/<id>  hôte -> un joueur précis
//
//  Pour rejoindre, le joueur essaie chaque relais et garde celui où il trouve
//  le message retenu /host de la salle.
// =========================================================

const Online = (() => {
  const params = new URLSearchParams(location.search);
  const ROOT = NET.ROOT; // configuration commune : js/net-config.js
  // Relais publics essayés dans l'ordre (?mqtt=ws://a,ws://b pour tester avec des relais locaux)
  const BROKERS = params.get("mqtt") ? params.get("mqtt").split(",") : NET.BROKERS;
  const BANS_TOPIC = ROOT + "_admin/bans"; // liste des joueurs bloqués (signée par l'administrateur)
  const MAX_ONLINE = 12;
  const GRACE_MS = 1000;          // marge réseau après la fin du chrono
  const PING_MS = 2000;           // les joueurs donnent signe de vie toutes les 2 s
  const ABSENT_AFTER_MS = 7000;   // sans nouvelles depuis 7 s => absent
  const HOST_BEAT_MS = 10000;     // l'hôte redit « je suis là » toutes les 10 s
  const FIND_WAIT_MS = 4000;      // attente du message retenu /host sur chaque relais
  const HOST_AWAY_MAX_MS = 180000; // l'hôte disparu depuis 3 min => fin
  const RESUME_MAX_MS = 15 * 60 * 1000; // reprise auto après rechargement (15 min)
  const PRESENCE = { present: ["🟢", "Présent"], away: ["🟡", "Inactif"], absent: ["🔴", "Absent"] };

  // ---------- Stockage local (identifiant et reprise après rechargement) ----------
  const LS_UID = "quiz-online-uid", LS_GUEST = "quiz-online-guest", LS_HOST = "quiz-online-host";
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const randId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  let UID = lsGet(LS_UID);
  if (typeof UID !== "string" || UID.length < 6) { UID = randId(); lsSet(LS_UID, UID); }

  const api = { active: false };
  let mq = null;            // client MQTT
  let session = 0;          // change à chaque nouvelle connexion (annule les anciennes)
  let isHost = false;
  let myId = null;
  let hostConn = null;      // (joueur) envoi vers l'hôte
  const conns = new Map();  // (hôte) id -> connexion
  let st = null;            // (hôte) état complet de la partie
  let view = null;          // affichage local
  let localTimer = null, presenceTimer = null, beatTimer = null, pingTimer = null, hostWatch = null;
  let lastHostMsg = 0, hostAwaySince = 0;
  // Reprise de la main si l'hôte part
  const TAKEOVER_DELAY_MS = 20000;   // l'hôte disparu depuis 20 s : le 1er joueur présent reprend la main
  const TAKEOVER_STEP_MS = 8000;     // puis le 2e 8 s plus tard, etc. (si le 1er n'est plus là)
  const HANDOVER_DELAY_MS = 3000;    // l'hôte est parti volontairement : passation rapide
  let lastBackup = null;             // (joueur) dernière sauvegarde de la partie publiée par l'hôte
  let guestCode = null, guestBroker = 0, takeoverTimer = null, takeoverAt = 0, awayTicker = null;
  let lastBackupJson = "";

  // ---------- Administration (commandes signées par l'administrateur) ----------
  // Seule la page admin possède la clé privée ; le jeu vérifie avec la clé publique (net-config.js).
  const LS_BANS = "quiz-online-bans";
  let bans = (lsGet(LS_BANS) || { list: [] }).list || [];
  let adminKeyP = null;
  const adminKey = () => (adminKeyP = adminKeyP || crypto.subtle.importKey(
    "jwk", NET.ADMIN_PUBLIC_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  async function verifyAdmin(msg) {
    try {
      if (!msg || typeof msg.p !== "string" || typeof msg.s !== "string" || !window.crypto || !crypto.subtle) return null;
      const sig = Uint8Array.from(atob(msg.s), (ch) => ch.charCodeAt(0));
      const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await adminKey(), sig, new TextEncoder().encode(msg.p));
      return ok ? JSON.parse(msg.p) : null;
    } catch { return null; }
  }
  const normName = (n) => String(n || "").trim().toLowerCase();
  const isBanned = (uid, name) => bans.some((b) => (b.type === "uid" && b.value === uid) || (b.type === "name" && normName(b.value) === normName(name)));
  const BANNED_MSG = "⛔ Tu as été bloqué(e) par l'administrateur du jeu.";

  // Nouvelle liste de blocage reçue (message retenu sur le relais)
  async function onBans(buf) {
    const payload = await verifyAdmin(parse(buf));
    if (!payload || !Array.isArray(payload.list)) return;
    const prev = lsGet(LS_BANS);
    if (prev && prev.at && payload.at < prev.at) return; // on garde la plus récente
    bans = payload.list;
    lsSet(LS_BANS, { list: bans, at: payload.at });
    enforceBans();
  }
  function enforceBans() {
    if (!api.active) return;
    if (isHost && st) {
      if (isBanned(UID, myName())) return adminClose(BANNED_MSG);
      st.players.filter((p) => p.id !== "host" && isBanned(p.id, p.name)).forEach((p) => kickPlayer(p.id, BANNED_MSG));
    } else if (!isHost && isBanned(UID, myName())) {
      if (hostConn) hostConn.send({ t: "bye" });
      lsSet(LS_GUEST, null);
      fail(BANNED_MSG);
    }
  }

  // Commande de l'administrateur reçue par l'hôte
  async function onAdminCommand(d) {
    const cmd = await verifyAdmin(d);
    if (!cmd || !st || cmd.code !== st.code || Math.abs(Date.now() - cmd.at) > 10 * 60 * 1000) return;
    if (cmd.cmd === "close") adminClose("🛑 La salle a été fermée par l'administrateur.");
    if (cmd.cmd === "kick" && cmd.id) {
      if (cmd.id === UID || cmd.id === "host") adminClose("🛑 L'administrateur a fermé ta salle."); // retirer l'hôte = fermer la salle
      else kickPlayer(cmd.id, "L'administrateur t'a retiré de la salle.");
    }
    if (cmd.cmd === "notice" && cmd.text) broadcast({ t: "notice", text: String(cmd.text).slice(0, 200) });
  }
  function adminClose(reason) {
    if (!st) return;
    pub(T(st.code, "all"), { t: "hostleft", reason });
    pub(T(st.code, "host"), null, { retain: true });
    pub(T(st.code, "backup"), null, { retain: true });
    lsSet(LS_HOST, null);
    cleanup();
    showScreen("screen-setup");
    setError(reason);
  }

  // ---------- Utilitaires ----------
  const genCode = () => {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  };
  const myName = () => ($("#online-name").value.trim() || "Joueur").slice(0, 20);
  try { $("#online-name").value = localStorage.getItem("quiz-cultureg-name") || ""; } catch {}
  $("#online-name").addEventListener("change", () => { try { localStorage.setItem("quiz-cultureg-name", myName()); } catch {} });
  const setError = (msg) => { $("#online-error").textContent = msg || ""; };
  const setNet = (msg) => { $("#net-status").textContent = msg || ""; };
  const T = (code, sub) => ROOT + code + "/" + sub;
  const parse = (buf) => { try { const s = buf.toString(); return s ? JSON.parse(s) : null; } catch { return null; } };

  function pub(t, msg, { retain = false, qos = 1 } = {}) {
    if (mq) mq.publish(t, msg == null ? "" : JSON.stringify(msg), { qos, retain });
  }

  // Connexion à un relais : renvoie le client, ou null au bout de 8 s
  function connectTo(i, will) {
    return new Promise((resolve) => {
      const c = mqtt.connect(BROKERS[i], {
        clientId: "qz_" + randId(), clean: true, connectTimeout: 7000, reconnectPeriod: 2500, keepalive: 30, will,
      });
      let done = false;
      const fail = () => { if (done) return; done = true; try { c.end(true); } catch {} resolve(null); };
      const t = setTimeout(fail, 8000);
      c.once("connect", () => { if (done) return; done = true; clearTimeout(t); resolve(c); });
      c.once("error", fail);
    });
  }

  function cleanup() {
    session++;
    clearTimeout(st && st.timer);
    [localTimer, presenceTimer, beatTimer, pingTimer, hostWatch].forEach(clearInterval);
    api.active = false;
    conns.clear();
    if (mq) { const c = mq; setTimeout(() => { try { c.end(true); } catch {} }, 400); } // laisse partir les derniers messages
    mq = null; hostConn = null; st = null; view = null; myId = null; hostAwaySince = 0;
    clearTimeout(takeoverTimer); clearInterval(awayTicker); takeoverTimer = null; lastBackup = null; lastBackupJson = "";
    $("#host-away").classList.add("hidden");
    showPauseButton(false);
    $("#q-players").classList.add("hidden");
    setNet("");
  }

  function fail(msg) {
    cleanup();
    showScreen("screen-setup");
    setError(msg);
  }

  function shareLink(code) {
    const u = new URL(location.href);
    u.hash = "";
    [...u.searchParams.keys()].forEach((k) => { if (k !== "mqtt") u.searchParams.delete(k); });
    u.searchParams.set("salle", code);
    if (st && st.broker) u.searchParams.set("b", st.broker);
    return u.toString();
  }

  // ======================================================
  //  CÔTÉ HÔTE
  // ======================================================
  api.host = async (resume = null, preferBroker = null) => {
    if (!window.mqtt) return setError("Le module de connexion n'a pas chargé. Vérifie ta connexion internet.");
    // (le blocage est vérifié avec la liste à jour reçue du relais juste après la connexion)
    setError("");
    cleanup();
    const my = session;
    isHost = true;
    myId = "host";
    const code = resume ? resume.code : genCode();
    st = resume || {
      code, phase: "lobby", qi: 0, questions: [], answers: {}, paused: false, broker: 0,
      conf: { theme: settings.theme, nb: settings.nbQuestions, nbWanted: settings.nbWanted, time: settings.time, hard: settings.hard },
      players: [{ id: "host", name: myName(), score: 0, correct: 0 }],
    };
    st.timer = null;
    st.soonTimer = null;
    if (resume) st.players.forEach((p) => { if (p.id !== "host") p.lastSeen = 0; }); // absents tant qu'ils ne se manifestent pas

    $("#lobby-code").textContent = code;
    $("#lobby-share").classList.add("hidden");
    $("#lobby-start").classList.add("hidden");
    $("#lobby-players").innerHTML = "";
    showScreen("screen-lobby");

    // On essaie les relais dans l'ordre ; le testament efface « hôte en ligne » si on disparaît
    // (en cas de reprise, on essaie d'abord le relais où se trouvent déjà les joueurs)
    const order = [preferBroker != null ? preferBroker : (resume && resume.broker), ...BROKERS.keys()]
      .filter((v, k, a) => v != null && v >= 0 && v < BROKERS.length && a.indexOf(v) === k);
    let c = null, i = 0;
    for (const [k, b] of order.entries()) {
      $("#lobby-status").textContent = `Connexion au serveur ${k + 1}/${order.length}…`;
      c = await connectTo(b, { topic: T(code, "host"), payload: "", retain: true, qos: 1 });
      if (my !== session) { try { c && c.end(true); } catch {} return; }
      if (c) { i = b; break; }
    }
    if (!c) return fail("Impossible de joindre le serveur de jeu. Vérifie ta connexion internet.");
    // Reprise : si quelqu'un d'autre est déjà hôte de cette salle, on la rejoint comme joueur
    if (resume) {
      const other = await new Promise((res) => {
        const t = setTimeout(() => res(null), 2500);
        c.on("message", (tp, buf) => { const m = parse(buf); if (tp === T(code, "host") && m && m.on && m.uid && m.uid !== UID) { clearTimeout(t); res(m); } });
        c.subscribe(T(code, "host"), { qos: 1 });
      });
      if (my !== session) { try { c.end(true); } catch {} return; }
      if (other) {
        try { c.end(true); } catch {}
        lsSet(LS_HOST, null);
        cleanup();
        return api.join(code);
      }
      try { c.unsubscribe(T(code, "host")); } catch {}
    }
    mq = c;
    st.broker = i;
    st.term = (st.term || 0) + (resume && resume.takeover ? 1 : 0);
    delete st.takeover;

    const announce = () => pub(T(code, "host"), { on: true, at: Date.now(), uid: UID, name: myName(), term: st ? st.term || 0 : 0 }, { retain: true });
    c.on("message", (t, buf) => {
      if (my !== session) return;
      if (t === BANS_TOPIC) return onBans(buf);
      if (t === T(code, "host")) return onOtherHost(parse(buf), code);
      if (t !== T(code, "act")) return;
      const d = parse(buf);
      if (d && d.t === "admin") return onAdminCommand(d);
      if (!d || typeof d.from !== "string") return;
      const id = d.from.slice(0, 40);
      onHostData(conns.get(id) || makeConn(id), d);
    });
    c.on("connect", () => { if (my === session) c.subscribe([T(code, "act"), BANS_TOPIC, T(code, "host")], { qos: 1 }, announce); }); // après une coupure
    // Coupure réseau de l'hôte : on met la question en pause pour ne pénaliser personne
    c.on("offline", () => { if (my === session && st && st.phase === "question" && st.conf.time && !st.paused) api.togglePause(); });
    c.subscribe([T(code, "act"), BANS_TOPIC, T(code, "host")], { qos: 1 }, (err) => {
      if (err || my !== session) return;
      announce();
      api.active = true;
      $("#lobby-share").classList.remove("hidden");
      $("#lobby-link").value = shareLink(code);
      beatTimer = setInterval(() => { if (my === session && c.connected) announce(); }, HOST_BEAT_MS);
      presenceTimer = setInterval(hostTick, 1500);
      resumeBroadcast();
    });
  };

  // Après création (ou reprise), on renvoie l'état à tout le monde
  // Un autre hôte s'annonce sur la même salle (ex. on revient après qu'un joueur a repris la main)
  function onOtherHost(m, code) {
    if (!st || !mq) return;
    // « hôte en ligne » effacé alors qu'on est toujours là (ex. départ de l'ancien hôte) : on se ré-annonce
    if (!m || !m.on) return pub(T(code, "host"), { on: true, at: Date.now(), uid: UID, name: myName(), term: st.term || 0 }, { retain: true });
    if (!m.uid || m.uid === UID) return;
    if ((m.term || 0) <= (st.term || 0)) return; // c'est nous le plus récent
    // un joueur a repris la main pendant notre absence : on redevient simple joueur
    lsSet(LS_HOST, null);
    cleanup();
    api.join(code);
  }

  function resumeBroadcast() {
    if (st.phase === "takeover") {
      // reprise par un joueur : nouvelle question à l'endroit où on s'était arrêté, en pause
      if (st.qi >= st.questions.length) return endOnline();
      askQuestion(st.qi);
      if (st.conf.time) api.togglePause();
      broadcast({ t: "notice", text: `👑 ${myName()} a repris la main. La partie reprend en pause.` });
      return;
    }
    if (st.phase === "lobby") return broadcastLobby();
    if (st.phase === "end") return broadcast(st.lastEnd);
    // partie en cours : on la remet en pause pour laisser les joueurs revenir
    if (st.phase === "question" && st.conf.time && !st.paused) {
      st.paused = true; st.pausedAt = Date.now();
      st.remaining = Math.max(2000, (st.deadline || Date.now()) - Date.now());
    }
    const now = st.paused ? st.pausedAt : Date.now();
    broadcast({ ...st.lastQuestion, players: publicPlayers(), elapsed: now - st.qStart - st.pausedTotal });
    if (st.phase === "question" && st.paused) broadcast({ t: "pause" });
    if (st.phase === "judge") broadcast(st.lastJudge);
    if (st.phase === "reveal") broadcast(st.lastReveal);
  }

  function makeConn(id) {
    return { peer: id, open: true, send: (msg) => pub(T(st.code, "p/" + id), msg), close() { this.open = false; } };
  }

  function sendTo(id, msg) {
    if (id === "host") return handle(msg);
    const c = conns.get(id) || makeConn(id);
    c.send(msg);
  }

  function broadcast(msg) {
    pub(T(st.code, "all"), msg, { qos: msg.t === "presence" ? 0 : 1 });
    handle(msg); // l'hôte s'affiche aussi le message
  }

  // Sauvegarde de la partie, lue par les joueurs pour reprendre la main si l'hôte part.
  // Elle ne contient PAS les réponses : seulement les réglages, les scores et les questions déjà posées.
  function publishBackup() {
    if (!st || !mq) return;
    const b = {
      code: st.code, phase: st.phase, qi: st.qi, total: st.questions.length, term: st.term || 0,
      conf: { ...st.conf, customKeys: st.conf.theme === CUSTOM_KEY ? [...customSel] : undefined },
      asked: st.questions.slice(0, st.qi + 1).map((q) => q && q.q),
      hostUid: UID, hostName: myName(),
      players: st.players.map((p) => ({ id: p.id, name: p.name, score: p.score || 0, correct: p.correct || 0, left: !!p.left, status: statusOf(p) })),
    };
    const json = JSON.stringify(b);
    if (json === lastBackupJson) return;
    lastBackupJson = json;
    pub(T(st.code, "backup"), b, { retain: true });
  }

  function persistHost() {
    if (!st) return;
    const { timer, soonTimer, ...save } = st;
    lsSet(LS_HOST, { st: save, at: Date.now() });
  }

  // ----- Présence -----
  function statusOf(p) {
    if (p.left) return "absent";
    if (p.id === "host") return document.hidden ? "away" : "present";
    if (Date.now() - (p.lastSeen || 0) > ABSENT_AFTER_MS) return "absent";
    return p.visible === false ? "away" : "present";
  }
  const activePlayers = () => st.players.filter((p) => statusOf(p) !== "absent");

  function presenceList() {
    return st.players.map((p) => ({
      id: p.id, name: p.name, status: statusOf(p),
      answered: st.phase === "question" && !!st.answers[p.id],
      score: p.score || 0, uid: p.id === "host" ? UID : p.id,
    }));
  }

  function hostTick() {
    if (!st || !api.active) return;
    const t = THEMES[st.conf.theme];
    broadcast({
      t: "presence", players: presenceList(),
      // infos pour la page d'administration
      room: { phase: st.phase, qi: st.qi, total: st.questions.length, theme: t ? t.name : st.conf.theme, hard: !!st.conf.hard, time: st.conf.time, paused: !!st.paused, hostUid: UID },
    });
    if (st.phase === "question" && !st.paused) checkAllAnswered(); // un absent ne bloque pas la question
    persistHost();
    publishBackup();
  }

  function publicPlayers() {
    return st.players
      .map((p) => ({ id: p.id, name: p.name, score: p.score, correct: p.correct, left: !!p.left }))
      .sort((a, b) => b.score - a.score);
  }

  // Nombre de questions réel : celui choisi, limité au nombre de questions du thème
  const effNb = () => Math.max(1, Math.min(st.conf.nbWanted || st.conf.nb, playableCount(st.conf.theme, st.conf.hard) || 1));

  function lobbyMsg() {
    st.conf.nb = effNb();
    const t = THEMES[st.conf.theme] || THEMES[Object.keys(THEMES)[0]];
    return {
      t: "lobby", code: st.code, players: presenceList(),
      info: `${t.icon || "📚"} ${t.name} · ${st.conf.nb} questions · ${st.conf.time ? st.conf.time + " s par question" : "temps illimité"} · ${st.conf.hard ? "✍️ Difficile (on écrit)" : "🙂 Facile (4 choix)"}`,
    };
  }
  function broadcastLobby() { broadcast(lobbyMsg()); persistHost(); }

  function onHostData(conn, d) {
    if (!st) return;
    const id = conn.peer;
    const known = st.players.find((p) => p.id === id);
    if (known) {
      known.lastSeen = Date.now();
      if (known.left && d.t !== "bye") { known.left = false; conns.set(id, conn); } // il revient
    }

    if (d.t === "ping") { if (known) known.visible = !!d.visible; return; }
    if (d.t === "bye") return removePlayer(id);

    if (d.t === "join") {
      let name = String(d.name || "Joueur").trim().slice(0, 20) || "Joueur";
      if (isBanned(id, name)) return conn.send({ t: "refused", msg: BANNED_MSG });
      conns.set(id, conn);

      // Déjà dans la salle (reconnexion, rechargement de page…) : on lui renvoie l'état
      if (known) {
        known.visible = true;
        conn.send({ t: "welcome", you: id, code: st.code });
        resync(id);
        return hostTick();
      }

      // Même pseudo qu'un joueur absent : il retrouve sa place et ses points
      const ghost = st.players.find((p) => p.id !== "host" && p.name === name && statusOf(p) === "absent");
      if (ghost) {
        conns.delete(ghost.id);
        if (st.answers[ghost.id]) { st.answers[id] = st.answers[ghost.id]; delete st.answers[ghost.id]; }
        ghost.id = id; ghost.left = false; ghost.lastSeen = Date.now(); ghost.visible = true;
        conn.send({ t: "welcome", you: id, code: st.code });
        resync(id);
        return hostTick();
      }

      if (st.phase !== "lobby") { conns.delete(id); return conn.send({ t: "refused", msg: "La partie a déjà commencé. Attends la prochaine !" }); }
      if (st.players.filter((p) => !p.left).length >= MAX_ONLINE) { conns.delete(id); return conn.send({ t: "refused", msg: "La salle est pleine." }); }
      const base = name; let n = 2;
      while (st.players.some((p) => p.name === name)) name = `${base} ${n++}`;
      st.players.push({ id, name, score: 0, correct: 0, lastSeen: Date.now(), visible: true });
      conn.send({ t: "welcome", you: id, code: st.code });
      conn.send(lobbyMsg()); // en privé, pour qu'il arrive après « welcome »
      broadcastLobby();
    }

    if (d.t === "answer") onAnswer(id, d.qi, d.choice, d.ms, d.text);
  }

  // Renvoie l'état actuel à un joueur qui (re)arrive
  function resync(id) {
    if (st.phase === "lobby") return sendTo(id, lobbyMsg());
    if (st.phase === "end") return sendTo(id, st.lastEnd);
    const now = st.paused ? st.pausedAt : Date.now();
    sendTo(id, { ...st.lastQuestion, players: publicPlayers(), elapsed: now - st.qStart - st.pausedTotal });
    if (st.phase === "question" && st.paused) sendTo(id, { t: "pause" });
    if (st.phase === "judge") sendTo(id, st.lastJudge);
    if (st.phase === "reveal") sendTo(id, st.lastReveal);
  }

  function removePlayer(id) {
    if (!st) return;
    conns.delete(id);
    const p = st.players.find((x) => x.id === id);
    if (p) p.left = true; // reste affiché « Absent »
    if (st.phase === "lobby") broadcastLobby(); else hostTick();
  }

  // L'hôte retire définitivement un joueur
  api.kick = (id) => kickPlayer(id, "L'hôte t'a retiré de la salle.");
  function kickPlayer(id, msg) {
    if (!isHost || !st || id === "host") return;
    sendTo(id, { t: "refused", msg });
    conns.delete(id);
    st.players = st.players.filter((p) => p.id !== id);
    if (st.phase === "lobby") broadcastLobby(); else hostTick();
  }

  function startOnline() {
    if (!st || st.phase !== "lobby") return;
    if (!playableCount(st.conf.theme, st.conf.hard)) {
      $("#lobby-start").disabled = false;
      $("#lobby-status").textContent = "⚠️ Coche au moins un chapitre dans « Mes chapitres ».";
      return;
    }
    st.questions = st.conf.hard ? buildHardQuestions(st.conf.theme, effNb()) : buildQuestions(st.conf.theme, effNb());
    st.players = st.players.filter((p) => !p.left);
    st.players.forEach((p) => { p.score = 0; p.correct = 0; });
    askQuestion(0);
  }

  function askQuestion(qi) {
    st.qi = qi;
    st.answers = {};
    st.phase = "question";
    st.paused = false;
    st.qStart = Date.now();
    st.pausedTotal = 0;
    const q = st.questions[qi];
    st.lastQuestion = { t: "question", qi, total: st.questions.length, q: q.q, choices: q.hard ? [] : q.choices, hard: !!q.hard, time: st.conf.time };
    broadcast({ ...st.lastQuestion, players: publicPlayers(), elapsed: 0 });
    clearTimeout(st.timer);
    if (st.conf.time) {
      st.deadline = Date.now() + st.conf.time * 1000 + GRACE_MS;
      st.timer = setTimeout(reveal, st.deadline - Date.now());
    }
    hostTick();
  }

  // ----- Pause (hôte uniquement) -----
  api.togglePause = () => {
    if (!isHost || !st || st.phase !== "question") return;
    const now = Date.now();
    const timed = !!(st.lastQuestion && st.lastQuestion.time); // chrono de la question EN COURS
    if (!st.paused) {
      st.paused = true;
      st.pausedAt = now;
      if (timed) { st.remaining = st.deadline - now; clearTimeout(st.timer); }
      clearTimeout(st.soonTimer); st.soonTimer = null;
      broadcast({ t: "pause" });
    } else {
      st.paused = false;
      st.pausedTotal += now - st.pausedAt;
      if (timed) { st.deadline = now + st.remaining; st.timer = setTimeout(reveal, st.remaining); }
      broadcast({ t: "resume" });
      hostTick();
    }
    persistHost();
  };

  // ----- Panneau de l'hôte pendant la pause : joueurs (retirer) et paramètres -----
  function renderPausePanel(full) {
    const panel = $("#pause-panel");
    const show = isHost && st && view && view.paused && st.phase === "question";
    panel.classList.toggle("hidden", !show);
    $(".q-card").classList.toggle("has-panel", !!show); // la carte s'agrandit pour tout afficher
    if (!show) return;
    const DOTS = { present: "🟢", away: "🟡", absent: "🔴" };
    $("#pp-players").innerHTML = presenceList().map((p) => `
      <li><span>${DOTS[p.status] || "⚪"} ${escapeHtml(p.name)} · ${p.score || 0} pts${p.id === "host" ? " (toi)" : ""}</span>
        ${p.id === "host" ? "" : `<button type="button" class="pp-kick" data-kick="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">✕ Retirer</button>`}</li>`).join("");
    if (!full) return; // (la liste des joueurs se met à jour en continu, les réglages seulement à l'ouverture)
    const c = st.conf;
    const pool = playableCount(c.theme, c.hard);
    const max = Math.max(st.questions.length, Math.min(pool, 100));
    $("#pp-settings").innerHTML = `
      <div class="field">Temps par question
        <div class="toggle-group">${[0, 10, 20, 30, 60].map((t) => `<button type="button" class="toggle ${c.time === t ? "active" : ""}" data-ptime="${t}">${t ? t + " s" : "Illimité"}</button>`).join("")}</div></div>
      <div class="field">Nombre de questions : <strong id="pp-nb-val">${st.questions.length}</strong>
        <div class="range-row"><input type="range" id="pp-nb" min="${st.qi + 1}" max="${max}" value="${st.questions.length}" /></div></div>
      <div class="field">Difficulté
        <div class="toggle-group"><button type="button" class="toggle ${!c.hard ? "active" : ""}" data-phard="0">🙂 Facile (4 choix)</button><button type="button" class="toggle ${c.hard ? "active" : ""}" data-phard="1">✍️ Difficile (j'écris)</button></div></div>
      <p class="pp-note">Thème : ${escapeHtml((THEMES[c.theme] || {}).name || c.theme)} · la question en cours n'est pas modifiée.</p>`;
    const box = $("#pp-settings");
    box.querySelectorAll("[data-ptime]").forEach((b) => b.onclick = () => { changeSettings({ time: Number(b.dataset.ptime) }); });
    box.querySelectorAll("[data-phard]").forEach((b) => b.onclick = () => { changeSettings({ hard: b.dataset.phard === "1" }); });
    const nb = $("#pp-nb");
    nb.oninput = () => ($("#pp-nb-val").textContent = nb.value);
    nb.onchange = () => changeSettings({ total: Number(nb.value) });
  }

  // Questions supplémentaires (sans reprendre celles déjà prévues)
  function moreQuestions(n, hard) {
    const used = new Set(st.questions.map((q) => q && q.q));
    const fresh = (hard ? buildHardQuestions(st.conf.theme, 9999) : buildQuestions(st.conf.theme, 9999)).filter((q) => !used.has(q.q));
    return fresh.slice(0, n);
  }

  function changeSettings({ time, total, hard }) {
    if (!isHost || !st) return;
    const c = st.conf;
    if (time != null) c.time = time;
    if (hard != null && hard !== !!c.hard) {
      // les questions suivantes sont retirées dans le nouveau mode
      c.hard = hard;
      const keep = st.questions.slice(0, st.qi + 1);
      const rest = st.questions.length - keep.length;
      st.questions = keep;
      st.questions.push(...moreQuestions(rest, hard));
    }
    if (total != null && total !== st.questions.length) {
      total = Math.max(st.qi + 1, total);
      if (total < st.questions.length) st.questions = st.questions.slice(0, total);
      else st.questions.push(...moreQuestions(total - st.questions.length, !!c.hard));
    }
    c.nb = c.nbWanted = st.questions.length;
    st.lastQuestion.total = st.questions.length;
    broadcast({ t: "total", total: st.questions.length, qi: st.qi });
    persistHost();
    publishBackup();
    renderPausePanel(true);
  }

  $("#pause-panel").addEventListener("click", (e) => {
    const k = e.target.closest("[data-kick]");
    if (k && confirm(`Retirer ${k.dataset.name} de la partie ?`)) { kickPlayer(k.dataset.kick, "L'hôte t'a retiré de la partie."); renderPausePanel(false); }
  });

  // Un joueur peut changer de réponse tant qu'elle n'est pas révélée (on garde la dernière)
  function onAnswer(id, qi, choice, ms, text) {
    if (!st || st.phase !== "question" || qi !== st.qi) return;
    if (!st.players.some((p) => p.id === id && !p.left)) return;
    const first = !st.answers[id];
    st.answers[id] = { choice: Number(choice), ms: Math.max(0, Number(ms) || 0), text: String(text || "").slice(0, 300) };
    if (first) broadcast({ t: "progress", count: Object.keys(st.answers).length, total: activePlayers().length });
    hostTick();
  }

  // Quand tout le monde a répondu : encore 5 s pour changer d'avis, puis on révèle
  const LAST_CHANCE_MS = 5000;
  function checkAllAnswered() {
    const active = activePlayers();
    if (!active.length || !active.every((p) => st.answers[p.id]) || st.soonTimer) return;
    st.soonTimer = setTimeout(() => { st.soonTimer = null; reveal(); }, LAST_CHANCE_MS);
    broadcast({ t: "soon", ms: LAST_CHANCE_MS });
  }

  function reveal() {
    if (!st || st.phase !== "question") return;
    clearTimeout(st.timer);
    clearTimeout(st.soonTimer); st.soonTimer = null;
    st.paused = false;
    const q = st.questions[st.qi];
    if (q.hard) {
      st.phase = "judge";
      st.lastJudge = {
        t: "judge", qi: st.qi, model: q.model, alts: (q.accepted || []).slice(1), explain: q.explain,
        entries: st.players.filter((p) => !p.left || st.answers[p.id]).map((p) => {
          const a = st.answers[p.id];
          return { id: p.id, name: p.name, text: a ? a.text : "", auto: gradeAnswer(a ? a.text : "", q.accepted || [q.model]) };
        }),
      };
      broadcast(st.lastJudge);
      return hostTick();
    }
    st.phase = "reveal";
    const results = {};
    st.players.forEach((p) => {
      const a = st.answers[p.id];
      let pts = 0;
      if (a && a.choice === q.answer) {
        pts = BASE_POINTS;
        if (st.conf.time) pts += Math.round(MAX_SPEED_BONUS * Math.max(0, 1 - a.ms / (st.conf.time * 1000)));
        p.score += pts;
        p.correct++;
      }
      results[p.id] = { choice: a ? a.choice : -1, pts };
    });
    st.lastReveal = { t: "reveal", qi: st.qi, answer: q.answer, correctText: q.choices[q.answer], explain: q.explain, results, players: publicPlayers(), last: st.qi >= st.questions.length - 1 };
    broadcast(st.lastReveal);
    hostTick();
  }

  // L'hôte valide la correction : on attribue les points
  function finishJudge(verdicts) {
    if (!st || st.phase !== "judge") return;
    const q = st.questions[st.qi];
    const results = {};
    st.players.forEach((p) => {
      const a = st.answers[p.id];
      const verdict = verdicts[p.id] || (a ? gradeAnswer(a.text, q.accepted || [q.model]) : "faux");
      const pts = a ? hardPoints(verdict, a.ms, st.conf.time) : 0;
      p.score += pts;
      if (verdict === "juste" && a) p.correct++;
      results[p.id] = { verdict: a ? verdict : "faux", pts, text: a ? a.text : "" };
    });
    st.phase = "reveal";
    st.lastReveal = { t: "reveal", hard: true, qi: st.qi, model: q.model, alts: (q.accepted || []).slice(1), explain: q.explain, results, players: publicPlayers(), last: st.qi >= st.questions.length - 1 };
    broadcast(st.lastReveal);
    hostTick();
  }

  function endOnline() {
    st.phase = "end";
    const t = THEMES[st.conf.theme];
    st.lastEnd = { t: "end", players: publicPlayers(), total: st.questions.length, theme: st.conf.theme, themeName: t ? t.name : "" };
    broadcast(st.lastEnd);
    persistHost();
  }

  api.next = () => {
    if (!isHost || !st) return;
    if (st.phase === "question") return reveal();
    if (st.phase === "reveal") {
      if (st.qi >= st.questions.length - 1) endOnline();
      else askQuestion(st.qi + 1);
    }
  };

  api.backToLobby = () => {
    if (!isHost || !st) return;
    st.phase = "lobby";
    st.players = st.players.filter((p) => !p.left);
    broadcastLobby();
  };

  // ======================================================
  //  CÔTÉ JOUEUR
  // ======================================================
  api.join = async (raw, attempt = 1) => {
    if (!window.mqtt) return setError("Le module de connexion n'a pas chargé. Vérifie ta connexion internet.");
    const code = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 5) return setError("Le code de la salle doit faire 5 caractères.");
    setError("");
    cleanup();
    const my = session;
    isHost = false;
    myId = UID;
    lsSet(LS_GUEST, { code, name: myName(), at: Date.now() });
    $("#join-btn").disabled = true;
    $("#join-btn").textContent = "…";
    const restoreBtn = () => { $("#join-btn").disabled = false; $("#join-btn").textContent = "Rejoindre"; };

    // Ordre d'essai : relais indiqué dans le lien d'invitation, puis tous les autres
    const hint = params.has("b") ? Number(params.get("b")) : NaN;
    const order = [Number.isInteger(hint) ? hint : null, ...BROKERS.keys()]
      .filter((v, i, a) => v != null && v >= 0 && v < BROKERS.length && a.indexOf(v) === i);

    let found = null, reached = 0, foundBroker = 0;
    for (const [k, i] of order.entries()) {
      setNet(`Recherche de la salle ${code} sur le serveur ${k + 1}/${order.length}…`);
      const c = await connectTo(i, { topic: T(code, "act"), payload: JSON.stringify({ t: "bye", from: UID }), retain: false, qos: 1 });
      if (my !== session) { try { c && c.end(true); } catch {} return; }
      if (!c) continue;
      reached++;
      const ok = await new Promise((res) => {
        const t = setTimeout(() => res(false), FIND_WAIT_MS);
        c.on("message", (tp, buf) => { const m = parse(buf); if (tp === T(code, "host") && m && m.on) { clearTimeout(t); res(true); } });
        c.subscribe(T(code, "host"), { qos: 1 });
      });
      if (my !== session) { try { c.end(true); } catch {} return; }
      if (ok) { found = c; foundBroker = i; break; }
      try { c.end(true); } catch {}
    }

    if (!found) {
      if (!reached) { restoreBtn(); return fail("Impossible de joindre le serveur de jeu. Vérifie ta connexion internet."); }
      if (attempt < 3) {
        setNet(`Salle ${code} pas encore trouvée… nouvel essai dans 5 s (${attempt}/3)`);
        setTimeout(() => { if (my === session) api.join(code, attempt + 1); }, 5000);
        return;
      }
      restoreBtn();
      lsSet(LS_GUEST, null);
      return fail(`Salle ${code} introuvable : vérifie le code, et que l'hôte a bien créé la salle (et ne l'a pas quittée).`);
    }

    // Salle trouvée sur ce relais
    const c = mq = found;
    guestCode = code;
    guestBroker = foundBroker;
    setNet("Salle trouvée ✔ Connexion à l'hôte…");
    hostConn = { open: true, send: (msg) => pub(T(code, "act"), { ...msg, from: UID }, { qos: msg.t === "ping" ? 0 : 1 }) };
    const hello = () => hostConn.send({ t: "join", name: myName() });
    lastHostMsg = Date.now();

    const welcomeTimeout = setTimeout(() => {
      if (my === session && !api.active) { restoreBtn(); fail("La salle existe mais l'hôte ne répond pas. Réessaie dans un instant."); }
    }, 12000);

    c.on("message", (t, buf) => {
      if (my !== session) return;
      if (t === BANS_TOPIC) return onBans(buf);
      const d = parse(buf);
      if (t === T(code, "backup")) { if (d && d.code === code) lastBackup = d; return; }
      if (t === T(code, "host")) {
        if (!d || !d.on) hostDisconnected();
        else if (hostAwaySince) { hostBack(); hello(); } // l'hôte (ou un nouvel hôte) est là : on se resynchronise
        return;
      }
      if (!d || typeof d !== "object") return;
      const isPrivate = t === T(code, "p/" + UID);
      if (!api.active && !isPrivate) return; // pas encore accepté dans la salle
      lastHostMsg = Date.now();
      if (d.t === "hostleft") return d.handover && !d.reason ? hostDisconnected(true) : onHostLost(d.reason);
      if (d.t === "welcome") {
        clearTimeout(welcomeTimeout); restoreBtn(); setNet("");
        clearInterval(pingTimer); pingTimer = setInterval(sendPing, PING_MS);
        clearInterval(hostWatch);
        hostWatch = setInterval(() => {
          if (hostAwaySince && Date.now() - hostAwaySince > HOST_AWAY_MAX_MS) onHostLost();
        }, 3000);
      }
      handle(d);
    });
    const topics = [T(code, "all"), T(code, "p/" + UID), T(code, "host"), T(code, "backup"), BANS_TOPIC];
    c.on("connect", () => { if (my === session) c.subscribe(topics, { qos: 1 }, hello); }); // après une coupure
    c.subscribe(topics, { qos: 1 }, hello);
  };

  function sendPing() {
    if (hostConn) hostConn.send({ t: "ping", visible: !document.hidden });
  }

  // L'hôte est parti (coupure, veille, page fermée…) : pause, puis un joueur présent reprend la main
  function hostDisconnected(handover) {
    if (!api.active || isHost) return;
    if (hostAwaySince && !handover) return; // déjà en attente (le départ volontaire, plus rapide, reste prioritaire)
    if (!hostAwaySince) hostAwaySince = Date.now();
    // la question est figée : plus de chrono ni de réponse tant que personne ne mène la partie
    if (view && view.phase === "question" && !view.paused) {
      view.paused = true; view.pausedAt = Date.now();
      clearInterval(localTimer);
      setPauseUI(true, false, "L'hôte s'est déconnecté. Partie en pause.");
    }
    // ordre de reprise : les joueurs présents, dans leur ordre d'arrivée
    const line = lastBackup ? lastBackup.players.filter((p) => p.id !== "host" && !p.left && p.status !== "absent").map((p) => p.id) : [];
    const rank = line.indexOf(UID);
    clearTimeout(takeoverTimer);
    takeoverAt = 0;
    if (rank >= 0 && lastBackup.phase !== "end") {
      const delay = (handover ? HANDOVER_DELAY_MS : TAKEOVER_DELAY_MS) + rank * TAKEOVER_STEP_MS;
      takeoverAt = Date.now() + delay;
      takeoverTimer = setTimeout(takeOver, delay);
    }
    $("#takeover-btn").classList.toggle("hidden", rank < 0 || !lastBackup || lastBackup.phase === "end");
    $("#host-away").classList.remove("hidden");
    clearInterval(awayTicker);
    const tick = () => {
      const left = takeoverAt ? Math.max(0, Math.ceil((takeoverAt - Date.now()) / 1000)) : 0;
      $("#host-away-text").textContent = (handover ? "👋 L'hôte a quitté la partie." : "⏸ L'hôte s'est déconnecté — partie en pause.") +
        (takeoverAt ? (rank === 0 ? ` Tu reprends la main dans ${left} s si personne ne le fait.` : ` Un autre joueur va reprendre la main (${left} s).`) : " En attente de son retour…");
    };
    tick();
    awayTicker = setInterval(tick, 500);
  }

  function hostBack() {
    hostAwaySince = 0;
    clearTimeout(takeoverTimer); takeoverTimer = null;
    clearInterval(awayTicker);
    $("#host-away").classList.add("hidden");
  }

  // Ce joueur devient l'hôte : il reconstruit la partie à partir de la sauvegarde (sans les réponses)
  function takeOver() {
    const b = lastBackup;
    if (!b || isHost || !hostAwaySince || !guestCode) return;
    clearTimeout(takeoverTimer);
    const code = guestCode, broker = guestBroker;
    if (b.conf.theme === CUSTOM_KEY && Array.isArray(b.conf.customKeys)) { customSel = new Set(b.conf.customKeys); updateCustomTheme(); }
    // Joueurs : moi -> "host" (en tête de liste) ; l'ancien hôte garde ses points sous son identifiant (s'il revient)
    const players = b.players.map((p) =>
      p.id === UID ? { ...p, id: "host", left: false } :
      p.id === "host" ? { ...p, id: b.hostUid || "ancien-hote", left: true, lastSeen: 0 } : { ...p, lastSeen: 0 });
    players.sort((x, y) => (y.id === "host") - (x.id === "host"));
    // Questions : celles déjà posées sont gardées (texte seul), les suivantes sont tirées à nouveau
    let start = b.qi;
    if (b.phase === "reveal") start = b.qi + 1;                 // la réponse était déjà donnée
    const asked = new Set((b.asked || []).filter(Boolean));
    const fresh = (b.conf.hard ? buildHardQuestions(b.conf.theme, 9999) : buildQuestions(b.conf.theme, 9999)).filter((q) => !asked.has(q.q));
    const questions = [];
    for (let k = 0; k < b.total; k++) questions.push(k < start ? { q: (b.asked || [])[k] || "", choices: [], answer: 0 } : fresh.shift());
    const st2 = {
      code, phase: b.phase === "lobby" ? "lobby" : b.phase === "end" ? "end" : "takeover", qi: start,
      questions: questions.filter(Boolean), answers: {}, paused: false, broker, term: b.term || 0, takeover: true,
      conf: { ...b.conf }, players,
    };
    if (st2.phase === "end") st2.lastEnd = null;
    lsSet(LS_GUEST, null);
    cleanup();
    api.host(st2, broker);
  }
  $("#takeover-btn").onclick = () => takeOver();

  function onHostLost(reason) {
    if (!api.active) return;
    const atEnd = view && view.phase === "end";
    lsSet(LS_GUEST, null);
    cleanup();
    if (!atEnd || reason) fail(reason || "L'hôte a quitté la partie.");
  }

  function sendAnswer(choice, ms, text) {
    if (isHost) onAnswer("host", view.qi, choice, ms, text);
    else if (hostConn) hostConn.send({ t: "answer", qi: view.qi, choice, ms, text });
  }

  api.isHost = () => !!isHost;

  // Quitter volontairement
  api.leave = () => {
    if (isHost && st) {
      const others = st.players.some((p) => p.id !== "host" && statusOf(p) !== "absent");
      if (others && st.phase !== "end") {
        publishBackup();
        pub(T(st.code, "all"), { t: "hostleft", handover: true }); // un joueur va reprendre la main
      } else {
        pub(T(st.code, "all"), { t: "hostleft" });
        pub(T(st.code, "backup"), null, { retain: true });
      }
      pub(T(st.code, "host"), null, { retain: true }); // efface « hôte en ligne »
      lsSet(LS_HOST, null);
    } else if (hostConn) {
      hostConn.send({ t: "bye" });
      lsSet(LS_GUEST, null);
    }
    cleanup();
    showScreen("screen-setup");
  };

  document.addEventListener("visibilitychange", () => {
    if (!api.active) return;
    if (document.visibilityState === "visible" && mq && !mq.connected) { try { mq.reconnect(); } catch {} }
    if (isHost) hostTick(); else sendPing();
  });

  // ======================================================
  //  AFFICHAGE (commun hôte / joueurs)
  // ======================================================
  function handle(m) {
    if (!m || typeof m !== "object") return;
    switch (m.t) {
      case "welcome":
        myId = m.you;
        api.active = true;
        break;

      case "refused":
        lsSet(LS_GUEST, null);
        fail(m.msg);
        break;

      case "lobby":
        view = { phase: "lobby" };
        clearInterval(localTimer);
        showPauseButton(false);
        $("#lobby-code").textContent = m.code;
        $("#lobby-link").value = shareLink(m.code);
        $("#lobby-share").classList.remove("hidden");
        $("#lobby-info").textContent = m.info;
        $("#lobby-start").classList.toggle("hidden", !isHost);
        $("#lobby-settings").classList.toggle("hidden", !isHost);
        if (isHost) renderLobbySettings();
        $("#lobby-start").disabled = false;
        renderPresence(m.players);
        showScreen("screen-lobby");
        break;

      case "presence": renderPresence(m.players); break;

      case "notice": showNotice(m.text); break;

      case "question": showOnlineQuestion(m); break;

      case "soon":
        if (view && view.phase === "question") $("#q-wait").textContent = `✅ Tout le monde a répondu — réponse dans ${Math.round(m.ms / 1000)} s (tu peux encore changer d'avis)`;
        break;

      case "progress":
        if (view && view.phase === "question") $("#q-wait").textContent = `${m.count} / ${m.total} joueur(s) présent(s) ont répondu`;
        break;

      case "pause":
        if (view && view.phase === "question" && !view.paused) {
          view.paused = true;
          view.pausedAt = Date.now();
          clearInterval(localTimer);
          setPauseUI(true, isHost, isHost ? "La partie est en pause pour tout le monde. La question est cachée." : "L'hôte a mis la partie en pause. Le chrono est arrêté.");
          renderPausePanel(true);
        }
        break;

      case "total":
        if (view && view.phase === "question") $("#q-progress").textContent = `Question ${(m.qi || 0) + 1} / ${m.total}`;
        break;

      case "resume":
        if (view && view.paused) {
          view.start += Date.now() - view.pausedAt; // le temps de pause ne compte pas
          view.paused = false;
          setPauseUI(false);
          renderPausePanel(false);
          if (view.time) startLocalTimer();
        }
        break;

      case "judge": showJudge(m); break;

      case "reveal": showReveal(m); break;

      case "end": showEnd(m); break;
    }
  }

  // Message de l'administrateur (bandeau en haut de l'écran)
  function showNotice(text) {
    let el = document.getElementById("admin-notice");
    if (!el) { el = document.createElement("div"); el.id = "admin-notice"; el.className = "admin-notice"; document.body.prepend(el); }
    el.textContent = "📢 " + text;
    el.classList.remove("hidden");
    clearTimeout(showNotice.t);
    showNotice.t = setTimeout(() => el.classList.add("hidden"), 12000);
  }

  function renderPresence(list) {
    if (!list) return;
    if (isHost && view && view.paused) renderPausePanel(false);
    $("#lobby-players").innerHTML = list.map((p, i) => {
      const [dot, label] = PRESENCE[p.status] || PRESENCE.present;
      const kick = isHost && p.id !== "host"
        ? `<button class="kick" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="Retirer ce joueur">✕</button>` : "";
      return `<li class="st-${p.status}">${i === 0 ? "👑 " : ""}${escapeHtml(p.name)}${p.id === myId ? " (toi)" : ""} <span class="st">${dot} ${label}</span>${kick}</li>`;
    }).join("");

    if (!hostAwaySince) {
      const present = list.filter((p) => p.status === "present").length;
      const absent = list.filter((p) => p.status === "absent").length;
      $("#lobby-status").textContent = isHost
        ? `${present} présent(s)` + (absent ? ` · ${absent} absent(s)` : "") + (list.length > 1 ? " · ✕ pour retirer un joueur" : "") +
          (list.length < 2 ? " — en attente d'autres joueurs… (tu peux aussi lancer seul)" : "")
        : "En attente que l'hôte lance la partie…";
    }

    const bar = $("#q-players");
    if (view && (view.phase === "question" || view.phase === "reveal")) {
      bar.classList.remove("hidden");
      bar.innerHTML = list.map((p) => {
        const [dot, label] = PRESENCE[p.status] || PRESENCE.present;
        return `<span class="st-${p.status}${p.answered ? " done" : ""}" title="${label}">${dot} ${escapeHtml(p.name)}${p.answered ? " ✔" : ""}</span>`;
      }).join("");
    }
  }

  function me(players) { return players.find((p) => p.id === myId) || { name: myName(), score: 0 }; }

  function startLocalTimer() {
    clearInterval(localTimer);
    const tick = () => {
      if (drawTimer(view.start, view.time) <= 0) {
        clearInterval(localTimer);
        view.closed = true; // plus possible de répondre ni de changer
        $$("#q-choices .choice").forEach((x) => (x.disabled = true));
        if (view.hard) {
          const txt = $("#hard-input").value.trim();
          if (txt && txt !== view.sentText) { view.answered = true; view.sentText = txt; sendAnswer(-1, Date.now() - view.start, txt); }
          $("#hard-input").disabled = true; $("#hard-submit").disabled = true;
        }
        $("#q-feedback").textContent = view.answered ? "⏰ Temps écoulé — ta réponse est enregistrée" : "⏰ Temps écoulé !";
        $("#q-feedback").className = view.answered ? "feedback" : "feedback bad";
      }
    };
    tick();
    localTimer = setInterval(tick, 100);
  }

  function showOnlineQuestion(m) {
    view = { phase: "question", qi: m.qi, start: Date.now() - (m.elapsed || 0), time: m.time, answered: false, paused: false, closed: false, choice: -1, hard: !!m.hard, sentText: "" };
    const mine = me(m.players);

    $("#q-player").textContent = "👤 " + mine.name;
    $("#q-progress").textContent = `Question ${m.qi + 1} / ${m.total}`;
    $("#q-score").textContent = mine.score + " pts";
    $("#progress-bar").style.width = (m.qi / m.total) * 100 + "%";
    $("#q-text").textContent = m.q;
    $("#q-feedback").textContent = "";
    $("#q-feedback").className = "feedback";
    $("#q-wait").textContent = "";
    $("#q-live").innerHTML = "";
    $("#q-explain").classList.add("hidden");
    $("#next-btn").classList.add("hidden");
    $("#validate-btn").classList.add("hidden");
    $("#q-players").classList.remove("hidden");
    setPauseUI(false);
    showPauseButton(isHost);

    const box = $("#q-choices");
    box.innerHTML = "";
    hideHardZones();
    if (m.hard) {
      // Réponse écrite : on peut la renvoyer (modifier) tant que la question n'est pas close
      showHardInput((text) => {
        if (view.closed || view.paused || view.phase !== "question" || !text || text === view.sentText) return;
        view.answered = true;
        view.sentText = text;
        sendAnswer(-1, Date.now() - view.start, text);
        $("#hard-submit").textContent = "✏️ Modifier ma réponse";
        $("#q-feedback").textContent = "Réponse envoyée ✔ — tu peux encore la modifier";
        $("#q-feedback").className = "feedback";
        if (isHost && view.phase === "question") showSkip();
      });
    }
    (m.hard ? [] : m.choices).forEach((c, i) => {
      const b = makeChoiceButton(c, i, () => {
        if (view.closed || view.paused || view.phase !== "question" || view.choice === i) return;
        view.answered = true;
        view.choice = i;
        $$("#q-choices .choice").forEach((x, j) => { x.classList.toggle("picked", j === i); x.classList.toggle("unpicked", j !== i); });
        $("#q-feedback").textContent = "Réponse envoyée ✔ — tu peux encore changer d'avis";
        $("#q-feedback").className = "feedback";
        sendAnswer(i, Date.now() - view.start);
        if (isHost && view.phase === "question") showSkip(); // (la réponse a pu être révélée aussitôt)
      });
      box.appendChild(b);
    });
    if (isHost && !m.time) showSkip();

    clearInterval(localTimer);
    if (!m.time) $("#timer-wrap").classList.add("hidden");
    else { $("#timer-wrap").classList.remove("hidden"); startLocalTimer(); }
    showScreen("screen-question");
  }

  function showSkip() {
    const btn = $("#next-btn");
    btn.textContent = "Révéler la réponse ⏭";
    btn.classList.remove("hidden");
  }

  // Phase de correction (mode difficile) : l'hôte attribue les points, les autres attendent
  function showJudge(m) {
    clearInterval(localTimer);
    if (!view) view = {};
    view.phase = "judge";
    view.closed = true;
    view.paused = false;
    setPauseUI(false);
    showPauseButton(false);
    $("#hard-zone").classList.add("hidden");
    $("#next-btn").classList.add("hidden");
    const mine = m.entries.find((e) => e.id === myId);
    $("#q-feedback").textContent = isHost ? "✍️ Corrige les réponses, puis valide" : "⏳ L'hôte corrige les réponses…";
    $("#q-feedback").className = "feedback";
    $("#q-wait").textContent = !isHost && mine ? `Ta réponse : ${mine.text ? "« " + mine.text + " »" : "— pas de réponse —"}` : "";
    const zone = $("#judge-zone");
    zone.classList.remove("hidden");
    renderJudge(zone, {
      model: m.model, alts: m.alts, explain: m.explain, entries: m.entries, canJudge: isHost, myId,
      title: isHost ? "Réponses des joueurs — choisis la note de chacun" : "Réponses des joueurs",
      onSubmit: (verdicts) => finishJudge(verdicts),
    });
  }

  function showReveal(m) {
    clearInterval(localTimer);
    if (!view) view = {};
    view.phase = "reveal";
    view.paused = false;
    showPauseButton(false);
    if (m.hard) return showHardReveal(m);
    hideHardZones();
    const r = m.results[myId] || { choice: -1, pts: 0 };
    revealAnswer({ answer: m.answer, picked: r.choice, pts: r.pts, correctText: m.correctText, explain: m.explain });
    $("#q-score").textContent = me(m.players).score + " pts";

    $("#q-live").innerHTML = m.players.map((p, i) => {
      const res = m.results[p.id] || { pts: 0 };
      return `<span class="${res.pts ? "ok" : "ko"}">${i + 1}. ${escapeHtml(p.name)} · ${p.score} pts${res.pts ? " (+" + res.pts + ")" : ""}</span>`;
    }).join("");

    const btn = $("#next-btn");
    if (isHost) {
      btn.textContent = m.last ? "Voir les résultats 🏁" : "Question suivante ➜";
      btn.classList.remove("hidden");
      $("#q-wait").textContent = "";
    } else {
      btn.classList.add("hidden");
      $("#q-wait").textContent = "En attente de l'hôte pour la suite…";
    }
  }

  function showHardReveal(m) {
    $("#hard-zone").classList.add("hidden");
    const r = m.results[myId] || { verdict: "faux", pts: 0, text: "" };
    const fb = $("#q-feedback");
    fb.textContent = r.verdict === "juste" ? `✅ Juste ! +${r.pts} pts` : r.verdict === "approx" ? `🟡 Approximatif : +${r.pts} pts` : "❌ Faux";
    fb.className = "feedback big " + (r.verdict === "juste" ? "good" : r.verdict === "approx" ? "approx" : "bad");
    $("#q-score").textContent = me(m.players).score + " pts";
    const zone = $("#judge-zone");
    zone.classList.remove("hidden");
    renderJudge(zone, {
      model: m.model, alts: m.alts, explain: m.explain, canJudge: false, myId, title: "Correction de l'hôte",
      entries: m.players.filter((p) => m.results[p.id]).map((p) => ({ id: p.id, name: p.name, text: m.results[p.id].text, auto: m.results[p.id].verdict })),
    });
    zone.querySelectorAll(".judge-auto").forEach((x) => (x.textContent = x.textContent.replace("suggestion : ", "note : ")));
    $("#q-live").innerHTML = m.players.map((p, i) => {
      const res = m.results[p.id] || { pts: 0, verdict: "faux" };
      return `<span class="${res.pts ? "ok" : "ko"}">${i + 1}. ${VERDICTS[res.verdict].short} ${escapeHtml(p.name)} · ${p.score} pts${res.pts ? " (+" + res.pts + ")" : ""}</span>`;
    }).join("");
    const btn = $("#next-btn");
    if (isHost) {
      btn.textContent = m.last ? "Voir les résultats 🏁" : "Question suivante ➜";
      btn.classList.remove("hidden");
      $("#q-wait").textContent = "";
    } else {
      btn.classList.add("hidden");
      $("#q-wait").textContent = "En attente de l'hôte pour la suite…";
    }
  }

  let lastSavedEnd = null;
  function showEnd(m) {
    clearInterval(localTimer);
    view = { phase: "end" };
    showPauseButton(false);
    $("#q-players").classList.add("hidden");
    renderResults(m.players, m.total);
    $$("#results-body tr").forEach((tr, i) => tr.classList.toggle("me", m.players[i].id === myId));

    // on enregistre son propre score dans le classement de cet appareil (une seule fois)
    const mine = m.players.find((p) => p.id === myId);
    const key = JSON.stringify(m.players);
    if (mine && lastSavedEnd !== key) {
      lastSavedEnd = key;
      const board = loadBoard();
      board.push({ name: mine.name, theme: m.theme, correct: mine.correct, total: m.total, score: mine.score, date: new Date().toLocaleDateString("fr-FR"), mode: "online" });
      board.sort((a, b) => b.score - a.score);
      saveBoard(board.slice(0, 100));
    }

    const replay = $("#replay-btn");
    replay.classList.toggle("hidden", !isHost);
    replay.textContent = "Nouvelle partie dans la salle ↻";
    $("#home-btn").textContent = "Quitter la salle";
    showScreen("screen-results");
  }

  // Réglages modifiables par l'hôte dans la salle d'attente
  function renderLobbySettings() {
    const c = st.conf;
    if (!THEMES[c.theme]) c.theme = Object.keys(THEMES)[0];
    $("#lobby-theme").innerHTML = [...themeGroups()].map(([group, items]) =>
      `<optgroup label="${escapeHtml(group)}">` + items.map(([k, t]) =>
        `<option value="${k}" ${k === c.theme ? "selected" : ""}>${t.icon || "📚"} ${escapeHtml(t.name)} (${t.questions.length})</option>`).join("") +
      `</optgroup>`).join("");
    const picker = $("#lobby-custom-picker");
    picker.classList.toggle("hidden", c.theme !== CUSTOM_KEY);
    if (c.theme === CUSTOM_KEY) renderChapterPicker(picker, () => { if (st) broadcastLobby(); });
    const max = Math.max(1, playableCount(c.theme, c.hard));
    c.nb = Math.min(c.nbWanted || c.nb, max);
    $$("#lobby-hard .toggle").forEach((b) => b.classList.toggle("active", (b.dataset.hard === "1") === !!c.hard));
    $("#lobby-nb").max = max;
    $("#lobby-nb").value = c.nb;
    $("#lobby-nb-value").textContent = c.nb;
    $$("#lobby-time .toggle").forEach((b) => b.classList.toggle("active", Number(b.dataset.time) === c.time));
  }

  $("#lobby-theme").onchange = (e) => { if (!st) return; st.conf.theme = e.target.value; broadcastLobby(); };
  $("#lobby-nb").oninput = (e) => { if (st) { st.conf.nb = st.conf.nbWanted = Number(e.target.value); $("#lobby-nb-value").textContent = st.conf.nb; } };
  $("#lobby-nb").onchange = () => { if (st) broadcastLobby(); };
  $$("#lobby-time .toggle").forEach((b) => b.onclick = () => {
    if (!st) return;
    st.conf.time = Number(b.dataset.time);
    broadcastLobby();
  });
  $$("#lobby-hard .toggle").forEach((b) => b.onclick = () => {
    if (!st) return;
    st.conf.hard = b.dataset.hard === "1";
    broadcastLobby();
  });

  // ======================================================
  //  BRANCHEMENTS
  // ======================================================
  $("#join-btn").onclick = () => api.join($("#join-code").value);
  $("#join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") api.join(e.target.value); });
  $("#lobby-start").onclick = () => { $("#lobby-start").disabled = true; startOnline(); };
  $("#lobby-leave").onclick = api.leave;
  $("#lobby-players").addEventListener("click", (e) => {
    const k = e.target.closest(".kick");
    if (k && confirm(`Retirer ${k.dataset.name || "ce joueur"} de la salle ?`)) api.kick(k.dataset.id);
  });
  $("#copy-link").onclick = () => {
    const input = $("#lobby-link");
    input.select();
    (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject())
      .catch(() => document.execCommand("copy"))
      .finally(() => { $("#copy-link").textContent = "Copié ✔"; setTimeout(() => ($("#copy-link").textContent = "Copier"), 1500); });
  };
  // Fermeture / rechargement de la page : le joueur prévient l'hôte (l'hôte, lui, garde sa salle
  // pour la reprendre ; s'il ne revient pas, son testament MQTT prévient les joueurs)
  window.addEventListener("pagehide", () => {
    if (!api.active) return;
    if (isHost) persistHost();
    else if (hostConn) hostConn.send({ t: "bye" });
  });

  // ---------- Au chargement de la page ----------
  const invite = params.get("salle");
  const savedHost = lsGet(LS_HOST);
  const savedGuest = lsGet(LS_GUEST);
  const fresh = (s) => s && Date.now() - (s.at || 0) < RESUME_MAX_MS;

  if (invite) {
    // Lien d'invitation : ?salle=CODE
    document.querySelector('#mode-group [data-mode="online"]').click();
    $("#join-code").value = invite.toUpperCase();
    $("#online-zone .hint").textContent = "Tu as été invité(e) ! Entre ton pseudo puis clique sur « Rejoindre ».";
    if (fresh(savedGuest) && savedGuest.code === invite.toUpperCase()) setTimeout(() => api.join(invite), 50); // déjà venu : on revient direct
    else $("#online-name").focus();
  } else if (fresh(savedHost) && savedHost.st && savedHost.st.code) {
    // L'hôte a rechargé sa page : on reprend sa salle
    document.querySelector('#mode-group [data-mode="online"]').click();
    setTimeout(() => api.host(savedHost.st), 50);
  } else if (fresh(savedGuest)) {
    // Un joueur a rechargé sa page : il revient dans sa salle
    document.querySelector('#mode-group [data-mode="online"]').click();
    $("#join-code").value = savedGuest.code;
    if (savedGuest.name) $("#online-name").value = savedGuest.name;
    setTimeout(() => api.join(savedGuest.code), 50);
  } else {
    lsSet(LS_HOST, null);
    lsSet(LS_GUEST, null);
  }

  return api;
})();
