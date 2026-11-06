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
  const ROOT = "quiz-revisions-fabgeo/v3/";
  // Relais publics essayés dans l'ordre (?mqtt=ws://a,ws://b pour tester avec des relais locaux)
  const BROKERS = params.get("mqtt") ? params.get("mqtt").split(",") : [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/mqtt",
  ];
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
  api.host = async (resume = null) => {
    if (!window.mqtt) return setError("Le module de connexion n'a pas chargé. Vérifie ta connexion internet.");
    setError("");
    cleanup();
    const my = session;
    isHost = true;
    myId = "host";
    const code = resume ? resume.code : genCode();
    st = resume || {
      code, phase: "lobby", qi: 0, questions: [], answers: {}, paused: false, broker: 0,
      conf: { theme: settings.theme, nb: settings.nbQuestions, nbWanted: settings.nbWanted, time: settings.time },
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
    let c = null, i = 0;
    for (; i < BROKERS.length && !c; i++) {
      $("#lobby-status").textContent = `Connexion au serveur ${i + 1}/${BROKERS.length}…`;
      c = await connectTo(i, { topic: T(code, "host"), payload: "", retain: true, qos: 1 });
      if (my !== session) { try { c && c.end(true); } catch {} return; }
    }
    if (!c) return fail("Impossible de joindre le serveur de jeu. Vérifie ta connexion internet.");
    mq = c;
    st.broker = i - 1;

    const announce = () => pub(T(code, "host"), { on: true, at: Date.now() }, { retain: true });
    c.on("message", (t, buf) => {
      if (my !== session || t !== T(code, "act")) return;
      const d = parse(buf);
      if (!d || typeof d.from !== "string") return;
      const id = d.from.slice(0, 40);
      onHostData(conns.get(id) || makeConn(id), d);
    });
    c.on("connect", () => { if (my === session) c.subscribe(T(code, "act"), { qos: 1 }, announce); }); // après une coupure
    c.subscribe(T(code, "act"), { qos: 1 }, (err) => {
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
  function resumeBroadcast() {
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
    }));
  }

  function hostTick() {
    if (!st || !api.active) return;
    broadcast({ t: "presence", players: presenceList() });
    if (st.phase === "question" && !st.paused) checkAllAnswered(); // un absent ne bloque pas la question
    persistHost();
  }

  function publicPlayers() {
    return st.players
      .map((p) => ({ id: p.id, name: p.name, score: p.score, correct: p.correct, left: !!p.left }))
      .sort((a, b) => b.score - a.score);
  }

  // Nombre de questions réel : celui choisi, limité au nombre de questions du thème
  const effNb = () => Math.max(1, Math.min(st.conf.nbWanted || st.conf.nb, (THEMES[st.conf.theme] || { questions: [] }).questions.length || 1));

  function lobbyMsg() {
    st.conf.nb = effNb();
    const t = THEMES[st.conf.theme] || THEMES[Object.keys(THEMES)[0]];
    return {
      t: "lobby", code: st.code, players: presenceList(),
      info: `${t.icon || "📚"} ${t.name} · ${st.conf.nb} questions · ${st.conf.time ? st.conf.time + " s par question" : "temps illimité"}`,
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

    if (d.t === "answer") onAnswer(id, d.qi, d.choice, d.ms);
  }

  // Renvoie l'état actuel à un joueur qui (re)arrive
  function resync(id) {
    if (st.phase === "lobby") return sendTo(id, lobbyMsg());
    if (st.phase === "end") return sendTo(id, st.lastEnd);
    const now = st.paused ? st.pausedAt : Date.now();
    sendTo(id, { ...st.lastQuestion, players: publicPlayers(), elapsed: now - st.qStart - st.pausedTotal });
    if (st.phase === "question" && st.paused) sendTo(id, { t: "pause" });
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
  api.kick = (id) => {
    if (!isHost || !st || id === "host") return;
    sendTo(id, { t: "refused", msg: "L'hôte t'a retiré de la salle." });
    conns.delete(id);
    st.players = st.players.filter((p) => p.id !== id);
    if (st.phase === "lobby") broadcastLobby(); else hostTick();
  };

  function startOnline() {
    if (!st || st.phase !== "lobby") return;
    if (!THEMES[st.conf.theme] || !THEMES[st.conf.theme].questions.length) {
      $("#lobby-start").disabled = false;
      $("#lobby-status").textContent = "⚠️ Coche au moins un chapitre dans « Mes chapitres ».";
      return;
    }
    st.questions = buildQuestions(st.conf.theme, effNb());
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
    st.lastQuestion = { t: "question", qi, total: st.questions.length, q: q.q, choices: q.choices, time: st.conf.time };
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
    if (!isHost || !st || st.phase !== "question" || !st.conf.time) return;
    const now = Date.now();
    if (!st.paused) {
      st.paused = true;
      st.pausedAt = now;
      st.remaining = st.deadline - now;
      clearTimeout(st.timer);
      clearTimeout(st.soonTimer); st.soonTimer = null;
      broadcast({ t: "pause" });
    } else {
      st.paused = false;
      st.pausedTotal += now - st.pausedAt;
      st.deadline = now + st.remaining;
      st.timer = setTimeout(reveal, st.remaining);
      broadcast({ t: "resume" });
    }
    persistHost();
  };

  // Un joueur peut changer de réponse tant qu'elle n'est pas révélée (on garde la dernière)
  function onAnswer(id, qi, choice, ms) {
    if (!st || st.phase !== "question" || qi !== st.qi) return;
    if (!st.players.some((p) => p.id === id && !p.left)) return;
    const first = !st.answers[id];
    st.answers[id] = { choice: Number(choice), ms: Math.max(0, Number(ms) || 0) };
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
    st.phase = "reveal";
    st.paused = false;
    const q = st.questions[st.qi];
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

    let found = null, reached = 0;
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
      if (ok) { found = c; break; }
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
    setNet("Salle trouvée ✔ Connexion à l'hôte…");
    hostConn = { open: true, send: (msg) => pub(T(code, "act"), { ...msg, from: UID }, { qos: msg.t === "ping" ? 0 : 1 }) };
    const hello = () => hostConn.send({ t: "join", name: myName() });
    lastHostMsg = Date.now();

    const welcomeTimeout = setTimeout(() => {
      if (my === session && !api.active) { restoreBtn(); fail("La salle existe mais l'hôte ne répond pas. Réessaie dans un instant."); }
    }, 12000);

    c.on("message", (t, buf) => {
      if (my !== session) return;
      const d = parse(buf);
      if (t === T(code, "host")) {
        if (!d || !d.on) hostDisconnected();
        else if (hostAwaySince) { hostAwaySince = 0; hello(); } // l'hôte est revenu : on se resynchronise
        return;
      }
      if (!d || typeof d !== "object") return;
      const isPrivate = t === T(code, "p/" + UID);
      if (!api.active && !isPrivate) return; // pas encore accepté dans la salle
      lastHostMsg = Date.now();
      if (d.t === "hostleft") return onHostLost();
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
    const topics = [T(code, "all"), T(code, "p/" + UID), T(code, "host")];
    c.on("connect", () => { if (my === session) c.subscribe(topics, { qos: 1 }, hello); }); // après une coupure
    c.subscribe(topics, { qos: 1 }, hello);
  };

  function sendPing() {
    if (hostConn) hostConn.send({ t: "ping", visible: !document.hidden });
  }

  // L'hôte a perdu sa connexion (ex. téléphone en veille, page rechargée) : on attend son retour
  function hostDisconnected() {
    if (!hostAwaySince) hostAwaySince = Date.now();
    const msg = "⚠️ L'hôte s'est déconnecté… en attente de son retour.";
    if (view && view.phase === "lobby") $("#lobby-status").textContent = msg;
    else $("#q-wait").textContent = msg;
  }

  function onHostLost() {
    if (!api.active) return;
    const atEnd = view && view.phase === "end";
    lsSet(LS_GUEST, null);
    cleanup();
    if (!atEnd) fail("L'hôte a quitté la partie.");
  }

  function sendAnswer(choice, ms) {
    if (isHost) onAnswer("host", view.qi, choice, ms);
    else if (hostConn) hostConn.send({ t: "answer", qi: view.qi, choice, ms });
  }

  // Quitter volontairement
  api.leave = () => {
    if (isHost && st) {
      pub(T(st.code, "all"), { t: "hostleft" });
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
          setPauseUI(true, isHost, isHost ? "Le chrono est arrêté pour tout le monde. La question est cachée." : "L'hôte a mis la partie en pause. Le chrono est arrêté.");
        }
        break;

      case "resume":
        if (view && view.paused) {
          view.start += Date.now() - view.pausedAt; // le temps de pause ne compte pas
          view.paused = false;
          setPauseUI(false);
          if (view.time) startLocalTimer();
        }
        break;

      case "reveal": showReveal(m); break;

      case "end": showEnd(m); break;
    }
  }

  function renderPresence(list) {
    if (!list) return;
    $("#lobby-players").innerHTML = list.map((p, i) => {
      const [dot, label] = PRESENCE[p.status] || PRESENCE.present;
      const kick = isHost && p.id !== "host" && p.status === "absent"
        ? `<button class="kick" data-id="${escapeHtml(p.id)}" title="Retirer ce joueur">✕</button>` : "";
      return `<li class="st-${p.status}">${i === 0 ? "👑 " : ""}${escapeHtml(p.name)}${p.id === myId ? " (toi)" : ""} <span class="st">${dot} ${label}</span>${kick}</li>`;
    }).join("");

    if (!hostAwaySince) {
      const present = list.filter((p) => p.status === "present").length;
      const absent = list.filter((p) => p.status === "absent").length;
      $("#lobby-status").textContent = isHost
        ? `${present} présent(s)` + (absent ? ` · ${absent} absent(s) (clique ✕ pour retirer)` : "") +
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
        $("#q-feedback").textContent = view.answered ? "⏰ Temps écoulé — ta réponse est enregistrée" : "⏰ Temps écoulé !";
        $("#q-feedback").className = view.answered ? "feedback" : "feedback bad";
      }
    };
    tick();
    localTimer = setInterval(tick, 100);
  }

  function showOnlineQuestion(m) {
    view = { phase: "question", qi: m.qi, start: Date.now() - (m.elapsed || 0), time: m.time, answered: false, paused: false, closed: false, choice: -1 };
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
    showPauseButton(isHost && !!m.time);

    const box = $("#q-choices");
    box.innerHTML = "";
    m.choices.forEach((c, i) => {
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

  function showReveal(m) {
    clearInterval(localTimer);
    if (!view) view = {};
    view.phase = "reveal";
    view.paused = false;
    showPauseButton(false);
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
    const max = Math.max(1, THEMES[c.theme].questions.length);
    c.nb = Math.min(c.nbWanted || c.nb, max);
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

  // ======================================================
  //  BRANCHEMENTS
  // ======================================================
  $("#join-btn").onclick = () => api.join($("#join-code").value);
  $("#join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") api.join(e.target.value); });
  $("#lobby-start").onclick = () => { $("#lobby-start").disabled = true; startOnline(); };
  $("#lobby-leave").onclick = api.leave;
  $("#lobby-players").addEventListener("click", (e) => {
    const k = e.target.closest(".kick");
    if (k) api.kick(k.dataset.id);
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
