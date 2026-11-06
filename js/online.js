// =========================================================
//  MODE EN LIGNE (chacun sur son appareil)
//  Les messages passent par un serveur relais public gratuit (MQTT sur WebSocket) :
//  ça marche quel que soit le réseau (4G, box, wifi d'école…).
//  L'hôte crée une salle avec un code ; il gère les questions, les scores,
//  la présence des joueurs et la pause.
//  Sujets (topics) d'une salle :
//    <racine>/<CODE>/host    : messages des joueurs vers l'hôte
//    <racine>/<CODE>/all     : messages de l'hôte vers tout le monde
//    <racine>/<CODE>/p/<id>  : messages de l'hôte vers un joueur précis
// =========================================================

const Online = (() => {
  const ROOT = "quiz-revisions-fabgeo/v2/";
  // Serveurs relais publics (le dernier caractère du code de salle indique lequel est utilisé)
  const BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/mqtt",
  ];
  const BROKER_TAG = "ABC"; // A = 1er serveur, B = 2e, C = 3e
  const CONNECT_TIMEOUT_MS = 7000;
  const HOST_SILENCE_MS = 45000; // sans nouvelles de l'hôte pendant 45 s => partie terminée
  const MAX_ONLINE = 12;
  const GRACE_MS = 1000;       // marge réseau après la fin du chrono
  const PING_MS = 2000;        // les invités donnent signe de vie toutes les 2 s
  const ABSENT_AFTER_MS = 7000; // sans nouvelles depuis 7 s => absent
  const PRESENCE = {
    present: ["🟢", "Présent"],
    away: ["🟡", "Inactif"],
    absent: ["🔴", "Absent"],
  };

  // Pour les tests : ?mqtt=ws://127.0.0.1:8888 (serveur relais local)
  const params = new URLSearchParams(location.search);
  const brokerUrl = (code) => params.get("mqtt") || BROKERS[Math.max(0, BROKER_TAG.indexOf(code[4]))] || BROKERS[0];
  const topic = (code, sub) => ROOT + code + "/" + sub;
  const randId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function mqttConnect(url, clientId, will) {
    return mqtt.connect(url, {
      clientId, clean: true, keepalive: 20, reconnectPeriod: 2000,
      connectTimeout: CONNECT_TIMEOUT_MS, resubscribe: true,
      will: { topic: will.topic, payload: JSON.stringify(will.msg), qos: 1, retain: false },
    });
  }
  function publish(t, msg, qos = 1) {
    if (mq) mq.publish(t, JSON.stringify(msg), { qos });
  }

  const api = { active: false };
  let mq = null;            // client MQTT (connexion au serveur relais)
  let isHost = false;
  let myId = null;
  let hostConn = null;      // (invité) connexion vers l'hôte
  const conns = new Map();  // (hôte) id -> connexion
  let st = null;            // (hôte) état de la partie
  let view = null;          // affichage local (hôte et invités)
  let localTimer = null;
  let presenceTimer = null; // (hôte) diffusion de la présence
  let pingTimer = null;     // (invité) signe de vie
  let hostWatch = null;     // (invité) surveille que l'hôte est toujours là
  let lastHostMsg = 0;

  // ---------- Utilitaires ----------
  const genCode = () => {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  };
  const myName = () => ($("#online-name").value.trim() || "Joueur").slice(0, 20);
  try { $("#online-name").value = localStorage.getItem("quiz-cultureg-name") || ""; } catch {}
  $("#online-name").addEventListener("change", () => { try { localStorage.setItem("quiz-cultureg-name", myName()); } catch {} });
  const setError = (msg) => { $("#online-error").textContent = msg || ""; };

  function cleanup() {
    clearTimeout(st && st.timer);
    clearInterval(localTimer);
    clearInterval(presenceTimer);
    clearInterval(pingTimer);
    clearInterval(hostWatch);
    api.active = false;
    conns.clear();
    if (mq) { const c = mq; setTimeout(() => { try { c.end(true); } catch {} }, 300); } // laisse partir le dernier message
    mq = null; hostConn = null; st = null; view = null; myId = null;
    showPauseButton(false);
    $("#q-players").classList.add("hidden");
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
    return u.toString();
  }

  // ======================================================
  //  CÔTÉ HÔTE
  // ======================================================
  api.host = (brokerIndex = 0) => {
    setError("");
    cleanup();
    isHost = true;
    const code = genCode().slice(0, 4) + BROKER_TAG[brokerIndex];
    st = {
      code, phase: "lobby", qi: 0, questions: [], answers: {}, timer: null, paused: false,
      conf: { theme: settings.theme, nb: settings.nbQuestions, time: settings.time },
      players: [{ id: "host", name: myName(), score: 0, correct: 0 }],
    };
    myId = "host";

    $("#lobby-code").textContent = "…";
    $("#lobby-share").classList.add("hidden");
    $("#lobby-status").textContent = "Création de la salle…";
    $("#lobby-start").classList.add("hidden");
    $("#lobby-players").innerHTML = "";
    showScreen("screen-lobby");

    const client = mq = mqttConnect(brokerUrl(code), "qh-" + randId(), { topic: topic(code, "all"), msg: { t: "hostgone" } });
    // Si ce serveur ne répond pas, on essaie le suivant
    const giveUp = setTimeout(() => {
      if (api.active || mq !== client) return;
      if (!params.get("mqtt") && brokerIndex + 1 < BROKERS.length) api.host(brokerIndex + 1);
      else fail("Impossible de créer la salle : serveur injoignable. Vérifie ta connexion internet.");
    }, CONNECT_TIMEOUT_MS + 1000);

    client.on("connect", () => {
      client.subscribe(topic(code, "host"), { qos: 1 }, (err) => {
        if (err || mq !== client || api.active) return;
        clearTimeout(giveUp);
        api.active = true;
        $("#lobby-share").classList.remove("hidden");
        $("#lobby-link").value = shareLink(code);
        broadcastLobby();
        presenceTimer = setInterval(hostTick, 1500);
      });
    });
    client.on("message", (t, payload) => {
      if (mq !== client) return;
      let d; try { d = JSON.parse(payload.toString()); } catch { return; }
      if (!d || typeof d.from !== "string") return;
      onHostData(conns.get(d.from) || makeConn(d.from), d);
    });
  };

  // Objet « connexion » vers un joueur (messages privés via son sujet)
  function makeConn(id) {
    return { peer: id, open: true, send: (msg) => publish(topic(st.code, "p/" + id), msg), close() { this.open = false; } };
  }

  function sendTo(id, msg) {
    if (id === "host") return handle(msg);
    const c = conns.get(id);
    if (c && c.open) c.send(msg);
  }

  function broadcast(msg) {
    publish(topic(st.code, "all"), msg, msg.t === "presence" ? 0 : 1);
    handle(msg); // l'hôte s'affiche aussi le message
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
    if (!st) return;
    broadcast({ t: "presence", players: presenceList() });
    // un joueur devenu absent ne doit pas bloquer la question
    if (st.phase === "question" && !st.paused) checkAllAnswered();
  }

  function publicPlayers() {
    return st.players
      .map((p) => ({ id: p.id, name: p.name, score: p.score, correct: p.correct, left: !!p.left }))
      .sort((a, b) => b.score - a.score);
  }

  function lobbyMsg() {
    const t = THEMES[st.conf.theme];
    return {
      t: "lobby", code: st.code,
      players: presenceList(),
      info: `${t.icon || "📚"} ${t.name} · ${st.conf.nb} questions · ${st.conf.time ? st.conf.time + " s par question" : "temps illimité"}`,
    };
  }
  function broadcastLobby() { broadcast(lobbyMsg()); }

  function onHostData(conn, d) {
    if (!d || typeof d !== "object" || !st) return;
    const id = conn.peer;
    const known = st.players.find((p) => p.id === id);
    if (known) {
      known.lastSeen = Date.now();
      // un joueur marqué parti qui donne de nouveau signe de vie (ex. téléphone sorti de veille)
      if (known.left && d.t !== "bye") { known.left = false; conns.set(id, makeConn(id)); }
    }

    if (d.t === "ping") {
      if (known) known.visible = !!d.visible;
      return;
    }

    if (d.t === "bye") return removePlayer(id); // le joueur a fermé la page

    if (d.t === "join") {
      let name = String(d.name || "Joueur").trim().slice(0, 20) || "Joueur";

      // Reconnexion d'un joueur absent avec le même pseudo : il retrouve sa place et ses points
      const ghost = st.players.find((p) => p.id !== "host" && p.name === name && statusOf(p) === "absent");
      if (ghost) {
        const old = conns.get(ghost.id);
        if (old && old !== conn) { try { old.close(); } catch {} conns.delete(ghost.id); }
        conns.set(id, conn);
        ghost.id = id; ghost.left = false; ghost.lastSeen = Date.now(); ghost.visible = true;
        conn.send({ t: "welcome", you: id, code: st.code });
        resync(id);
        hostTick();
        return;
      }

      // message reçu deux fois : le joueur est déjà là
      if (known) { conns.set(id, conn); conn.send({ t: "welcome", you: id, code: st.code }); return resync(id); }
      if (st.phase !== "lobby") return refuse(conn, "La partie a déjà commencé. Attends la prochaine !");
      if (st.players.filter((p) => !p.left).length >= MAX_ONLINE) return refuse(conn, "La salle est pleine.");
      const base = name; let n = 2;
      while (st.players.some((p) => p.name === name)) name = `${base} ${n++}`;
      conns.set(id, conn);
      st.players.push({ id, name, score: 0, correct: 0, lastSeen: Date.now(), visible: true });
      conn.send({ t: "welcome", you: id, code: st.code });
      conn.send(lobbyMsg()); // en privé, pour être sûr qu'il arrive après « welcome »
      broadcastLobby();
    }

    if (d.t === "answer") onAnswer(id, d.qi, d.choice, d.ms);
  }

  // Renvoie l'état actuel de la partie à un joueur qui revient
  function resync(id) {
    if (st.phase === "lobby") { sendTo(id, lobbyMsg()); return broadcastLobby(); }
    if (st.phase === "end") return sendTo(id, st.lastEnd);
    const now = st.paused ? st.pausedAt : Date.now();
    sendTo(id, { ...st.lastQuestion, players: publicPlayers(), elapsed: now - st.qStart - st.pausedTotal });
    if (st.phase === "question" && st.paused) sendTo(id, { t: "pause" });
    if (st.phase === "reveal") sendTo(id, st.lastReveal);
  }

  function refuse(conn, msg) {
    conn.send({ t: "refused", msg });
    setTimeout(() => conn.close(), 500);
  }

  function removePlayer(id) {
    if (!st || !conns.has(id)) return;
    conns.delete(id);
    const p = st.players.find((x) => x.id === id);
    if (p) p.left = true; // il reste affiché comme « Absent »
    if (st.phase === "lobby") broadcastLobby();
    else hostTick();
  }

  // L'hôte retire définitivement un joueur
  api.kick = (id) => {
    if (!isHost || !st || id === "host") return;
    const c = conns.get(id);
    if (c) { try { c.send({ t: "refused", msg: "L'hôte t'a retiré de la salle." }); } catch {} setTimeout(() => c.close(), 300); conns.delete(id); }
    st.players = st.players.filter((p) => p.id !== id);
    if (st.phase === "lobby") broadcastLobby(); else hostTick();
  };

  function startOnline() {
    if (!st || st.phase !== "lobby") return;
    st.questions = buildQuestions(st.conf.theme, st.conf.nb);
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
      broadcast({ t: "pause" });
    } else {
      st.paused = false;
      st.pausedTotal += now - st.pausedAt;
      st.deadline = now + st.remaining;
      st.timer = setTimeout(reveal, st.remaining);
      broadcast({ t: "resume" });
    }
  };

  function onAnswer(id, qi, choice, ms) {
    if (!st || st.phase !== "question" || qi !== st.qi || st.answers[id]) return;
    if (!st.players.some((p) => p.id === id && !p.left)) return;
    st.answers[id] = { choice: Number(choice), ms: Math.max(0, Number(ms) || 0) };
    broadcast({ t: "progress", count: Object.keys(st.answers).length, total: activePlayers().length });
    hostTick();
  }

  function checkAllAnswered() {
    const active = activePlayers();
    if (active.length && active.every((p) => st.answers[p.id])) reveal();
  }

  function reveal() {
    if (!st || st.phase !== "question") return;
    clearTimeout(st.timer);
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
    st.lastEnd = { t: "end", players: publicPlayers(), total: st.questions.length, theme: st.conf.theme, themeName: t.name };
    broadcast(st.lastEnd);
  }

  // Bouton "Suivant" / "Révéler" (hôte uniquement)
  api.next = () => {
    if (!isHost || !st) return;
    if (st.phase === "question") return reveal();
    if (st.phase === "reveal") {
      if (st.qi >= st.questions.length - 1) endOnline();
      else askQuestion(st.qi + 1);
    }
  };

  // Nouvelle partie dans la même salle
  api.backToLobby = () => {
    if (!isHost || !st) return;
    st.phase = "lobby";
    st.players = st.players.filter((p) => !p.left);
    broadcastLobby();
  };

  // ======================================================
  //  CÔTÉ INVITÉ
  // ======================================================
  api.join = (raw) => {
    const code = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 5) return setError("Le code de la salle doit faire 5 caractères.");
    setError("");
    cleanup();
    isHost = false;
    $("#join-btn").disabled = true;
    $("#join-btn").textContent = "…";
    const restoreBtn = () => { $("#join-btn").disabled = false; $("#join-btn").textContent = "Rejoindre"; };

    const me = randId();
    const client = mq = mqttConnect(brokerUrl(code), "qp-" + me, { topic: topic(code, "host"), msg: { t: "bye", from: me } });
    hostConn = { open: false, send: (msg) => publish(topic(code, "host"), { ...msg, from: me }, msg.t === "ping" ? 0 : 1) };
    let connectedOnce = false;
    const timeout = setTimeout(() => {
      if (api.active || mq !== client) return;
      restoreBtn();
      fail(connectedOnce
        ? "Salle introuvable : vérifie le code, et que la partie a bien été créée."
        : "Connexion au serveur impossible. Vérifie ta connexion internet.");
    }, 12000);

    client.on("connect", () => {
      connectedOnce = true;
      client.subscribe([topic(code, "all"), topic(code, "p/" + me)], { qos: 1 }, (err) => {
        if (err || mq !== client) return;
        hostConn.open = true;
        if (!api.active) hostConn.send({ t: "join", name: myName() });
      });
    });
    client.on("message", (t, payload) => {
      if (mq !== client) return;
      let d; try { d = JSON.parse(payload.toString()); } catch { return; }
      if (!d || typeof d !== "object") return;
      const isPrivate = t.endsWith("/p/" + me);
      if (!api.active && !isPrivate) return; // pas encore accepté dans la salle
      lastHostMsg = Date.now();
      if (d.t === "hostgone") return hostDisconnected();
      if (d.t === "hostleft") return onHostLost();
      if (d.t === "welcome") {
        clearTimeout(timeout); restoreBtn();
        clearInterval(pingTimer); pingTimer = setInterval(sendPing, PING_MS);
        clearInterval(hostWatch); hostWatch = setInterval(() => { if (Date.now() - lastHostMsg > HOST_SILENCE_MS) onHostLost(); }, 3000);
      }
      handle(d);
    });
  };

  // L'hôte a perdu sa connexion (ex. téléphone en veille) : on attend son retour
  function hostDisconnected() {
    const msg = "⚠️ L'hôte s'est déconnecté… en attente de son retour.";
    if (view && view.phase === "lobby") $("#lobby-status").textContent = msg;
    else $("#q-wait").textContent = msg;
  }

  function sendPing() {
    if (hostConn && hostConn.open) hostConn.send({ t: "ping", visible: !document.hidden });
  }

  // Quand on change d'onglet / d'appli, on prévient tout de suite
  document.addEventListener("visibilitychange", () => {
    if (!api.active) return;
    if (isHost) hostTick(); else sendPing();
  });

  function onHostLost() {
    if (!api.active) return;
    const atEnd = view && view.phase === "end";
    cleanup();
    if (!atEnd) fail("L'hôte a quitté la partie.");
  }

  function sendAnswer(choice, ms) {
    if (isHost) onAnswer("host", view.qi, choice, ms);
    else if (hostConn && hostConn.open) hostConn.send({ t: "answer", qi: view.qi, choice, ms });
  }

  api.leave = () => {
    if (!isHost && hostConn && hostConn.open) { try { hostConn.send({ t: "bye" }); } catch {} }
    if (isHost && st) publish(topic(st.code, "all"), { t: "hostleft" });
    cleanup(); // les invités voient la connexion se fermer
    showScreen("screen-setup");
  };

  // ======================================================
  //  AFFICHAGE (commun hôte / invités)
  // ======================================================
  function handle(m) {
    if (!m || typeof m !== "object") return;
    switch (m.t) {
      case "welcome":
        myId = m.you;
        api.active = true;
        break;

      case "refused":
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
    const ul = $("#lobby-players");
    ul.innerHTML = list.map((p, i) => {
      const [dot, label] = PRESENCE[p.status] || PRESENCE.present;
      const kick = isHost && p.id !== "host" && p.status === "absent"
        ? `<button class="kick" data-id="${escapeHtml(p.id)}" title="Retirer ce joueur">✕</button>` : "";
      return `<li class="st-${p.status}">${i === 0 ? "👑 " : ""}${escapeHtml(p.name)}${p.id === myId ? " (toi)" : ""} <span class="st">${dot} ${label}</span>${kick}</li>`;
    }).join("");

    const present = list.filter((p) => p.status === "present").length;
    const absent = list.filter((p) => p.status === "absent").length;
    $("#lobby-status").textContent = isHost
      ? `${present} présent(s)` + (absent ? ` · ${absent} absent(s) (clique ✕ pour retirer)` : "") +
        (list.length < 2 ? " — en attente d'autres joueurs… (tu peux aussi lancer seul)" : "")
      : "En attente que l'hôte lance la partie…";

    // Pendant la partie : bandeau des joueurs au-dessus de la question
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
        if (!view.answered) {
          view.answered = true;
          $$("#q-choices .choice").forEach((x) => (x.disabled = true));
          $("#q-feedback").textContent = "⏰ Temps écoulé !";
          $("#q-feedback").className = "feedback bad";
        }
      }
    };
    tick();
    localTimer = setInterval(tick, 100);
  }

  function showOnlineQuestion(m) {
    view = { phase: "question", qi: m.qi, start: Date.now() - (m.elapsed || 0), time: m.time, answered: false, paused: false };
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
    $("#q-players").classList.remove("hidden");
    setPauseUI(false);
    showPauseButton(isHost && !!m.time);

    const box = $("#q-choices");
    box.innerHTML = "";
    m.choices.forEach((c, i) => {
      const b = makeChoiceButton(c, i, () => {
        if (view.answered || view.paused) return;
        view.answered = true;
        view.choice = i;
        $$("#q-choices .choice").forEach((x) => { x.disabled = true; if (x !== b) x.classList.add("dim"); });
        b.classList.add("picked");
        $("#q-feedback").textContent = "Réponse envoyée ✔ — attends les autres…";
        sendAnswer(i, Date.now() - view.start);
        if (isHost && view.phase === "question") showSkip(); // (la réponse a pu être révélée aussitôt)
      });
      box.appendChild(b);
    });
    if (isHost && !m.time) showSkip();

    // chrono
    clearInterval(localTimer);
    if (!m.time) $("#timer-wrap").classList.add("hidden");
    else {
      $("#timer-wrap").classList.remove("hidden");
      startLocalTimer();
    }
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

  function showEnd(m) {
    clearInterval(localTimer);
    view = { phase: "end" };
    showPauseButton(false);
    $("#q-players").classList.add("hidden");
    renderResults(m.players, m.total);
    $$("#results-body tr").forEach((tr, i) => tr.classList.toggle("me", m.players[i].id === myId));

    // on enregistre son propre score dans le classement de cet appareil
    const mine = m.players.find((p) => p.id === myId);
    if (mine) {
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
    $("#lobby-theme").innerHTML = [...themeGroups()].map(([group, items]) =>
      `<optgroup label="${escapeHtml(group)}">` + items.map(([k, t]) =>
        `<option value="${k}" ${k === c.theme ? "selected" : ""}>${t.icon || "📚"} ${escapeHtml(t.name)} (${t.questions.length})</option>`).join("") +
      `</optgroup>`).join("");
    const max = THEMES[c.theme].questions.length;
    if (c.nb > max) c.nb = max;
    $("#lobby-nb").max = max;
    $("#lobby-nb").value = c.nb;
    $("#lobby-nb-value").textContent = c.nb;
    $$("#lobby-time .toggle").forEach((b) => b.classList.toggle("active", Number(b.dataset.time) === c.time));
  }

  $("#lobby-theme").onchange = (e) => { if (!st) return; st.conf.theme = e.target.value; broadcastLobby(); };
  $("#lobby-nb").oninput = (e) => { if (st) { st.conf.nb = Number(e.target.value); $("#lobby-nb-value").textContent = st.conf.nb; } };
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
  window.addEventListener("beforeunload", () => { if (api.active) api.leave(); });
  window.addEventListener("pagehide", () => { if (api.active) api.leave(); });

  // Lien d'invitation : ?salle=CODE
  const invite = params.get("salle");
  if (invite) {
    document.querySelector('#mode-group [data-mode="online"]').click();
    $("#join-code").value = invite.toUpperCase();
    $("#online-error").textContent = "";
    $("#online-zone .hint").textContent = "Tu as été invité(e) ! Entre ton pseudo puis clique sur « Rejoindre ».";
    $("#online-name").focus();
  }

  return api;
})();
