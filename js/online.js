// =========================================================
//  MODE EN LIGNE (chacun sur son appareil)
//  Connexion directe entre navigateurs via PeerJS (WebRTC).
//  L'hôte crée une salle avec un code ; il gère les questions et les scores.
// =========================================================

const Online = (() => {
  const PREFIX = "quizcg-v1-";
  const MAX_ONLINE = 12;
  const GRACE_MS = 1000; // marge réseau après la fin du chrono

  // Pour les tests : ?peerhost=localhost&peerport=9000 (serveur PeerJS local)
  const params = new URLSearchParams(location.search);
  const peerOpts = params.get("peerhost")
    ? { host: params.get("peerhost"), port: Number(params.get("peerport") || 9000), path: "/", secure: false }
    : {};

  const api = { active: false };
  let peer = null;
  let isHost = false;
  let myId = null;
  let hostConn = null;      // (invité) connexion vers l'hôte
  const conns = new Map();  // (hôte) id -> connexion
  let st = null;            // (hôte) état de la partie
  let view = null;          // affichage local (hôte et invités)
  let localTimer = null;

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
    api.active = false;
    conns.forEach((c) => { try { c.close(); } catch {} });
    conns.clear();
    if (peer) { try { peer.destroy(); } catch {} }
    peer = null; hostConn = null; st = null; view = null; myId = null;
  }

  function fail(msg) {
    cleanup();
    showScreen("screen-setup");
    setError(msg);
  }

  function shareLink(code) {
    const u = new URL(location.href);
    u.hash = "";
    [...u.searchParams.keys()].forEach((k) => { if (!k.startsWith("peer")) u.searchParams.delete(k); });
    u.searchParams.set("salle", code);
    return u.toString();
  }

  // ======================================================
  //  CÔTÉ HÔTE
  // ======================================================
  api.host = () => {
    setError("");
    cleanup();
    isHost = true;
    const code = genCode();
    st = {
      code, phase: "lobby", qi: 0, questions: [], answers: {}, timer: null,
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

    peer = new Peer(PREFIX + code, peerOpts);
    peer.on("open", () => {
      api.active = true;
      $("#lobby-share").classList.remove("hidden");
      $("#lobby-link").value = shareLink(code);
      broadcastLobby();
    });
    peer.on("connection", (conn) => {
      conn.on("data", (d) => onHostData(conn, d));
      conn.on("close", () => removePlayer(conn.peer));
      conn.on("error", () => removePlayer(conn.peer));
    });
    peer.on("disconnected", () => { if (peer && !peer.destroyed) peer.reconnect(); });
    peer.on("error", (e) => {
      if (e.type === "unavailable-id") return api.host(); // code déjà pris : on en tire un autre
      if (e.type === "peer-unavailable") return;
      if (!api.active) fail("Impossible de créer la salle (" + e.type + "). Vérifie ta connexion internet.");
    });
  };

  function sendTo(id, msg) {
    if (id === "host") return handle(msg);
    const c = conns.get(id);
    if (c && c.open) c.send(msg);
  }

  function broadcast(msg) {
    conns.forEach((c) => { if (c.open) c.send(msg); });
    handle(msg); // l'hôte s'affiche aussi le message
  }

  function publicPlayers() {
    return st.players
      .map((p) => ({ id: p.id, name: p.name, score: p.score, correct: p.correct, left: !!p.left }))
      .sort((a, b) => b.score - a.score);
  }

  function broadcastLobby() {
    const t = THEMES[st.conf.theme];
    broadcast({
      t: "lobby", code: st.code,
      players: st.players.map((p) => p.name),
      info: `${t.icon || "📚"} ${t.name} · ${st.conf.nb} questions · ${st.conf.time ? st.conf.time + " s par question" : "temps illimité"}`,
    });
  }

  function onHostData(conn, d) {
    if (!d || typeof d !== "object" || !st) return;
    const id = conn.peer;

    if (d.t === "join") {
      if (st.phase !== "lobby") return refuse(conn, "La partie a déjà commencé. Attends la prochaine !");
      if (st.players.filter((p) => !p.left).length >= MAX_ONLINE) return refuse(conn, "La salle est pleine.");
      let name = String(d.name || "Joueur").trim().slice(0, 20) || "Joueur";
      const base = name; let n = 2;
      while (st.players.some((p) => p.name === name)) name = `${base} ${n++}`;
      conns.set(id, conn);
      st.players = st.players.filter((p) => p.id !== id);
      st.players.push({ id, name, score: 0, correct: 0 });
      conn.send({ t: "welcome", you: id, code: st.code });
      broadcastLobby();
    }

    if (d.t === "answer") onAnswer(id, d.qi, d.choice, d.ms);
  }

  function refuse(conn, msg) {
    conn.send({ t: "refused", msg });
    setTimeout(() => conn.close(), 500);
  }

  function removePlayer(id) {
    if (!st || !conns.has(id)) return;
    conns.delete(id);
    if (st.phase === "lobby") {
      st.players = st.players.filter((p) => p.id !== id);
      broadcastLobby();
    } else {
      const p = st.players.find((x) => x.id === id);
      if (p) p.left = true;
      if (st.phase === "question") checkAllAnswered();
    }
  }

  function startOnline() {
    if (!st || st.phase !== "lobby") return;
    st.questions = shuffle(THEMES[st.conf.theme].questions).slice(0, st.conf.nb).map((q) => {
      const order = shuffle([0, 1, 2, 3]);
      return { q: q.q, choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer), explain: q.explain || "" };
    });
    st.players = st.players.filter((p) => !p.left);
    st.players.forEach((p) => { p.score = 0; p.correct = 0; });
    askQuestion(0);
  }

  function askQuestion(qi) {
    st.qi = qi;
    st.answers = {};
    st.phase = "question";
    const q = st.questions[qi];
    broadcast({ t: "question", qi, total: st.questions.length, q: q.q, choices: q.choices, time: st.conf.time, players: publicPlayers() });
    clearTimeout(st.timer);
    if (st.conf.time) st.timer = setTimeout(reveal, st.conf.time * 1000 + GRACE_MS);
  }

  function onAnswer(id, qi, choice, ms) {
    if (!st || st.phase !== "question" || qi !== st.qi || st.answers[id]) return;
    if (!st.players.some((p) => p.id === id && !p.left)) return;
    st.answers[id] = { choice: Number(choice), ms: Math.max(0, Number(ms) || 0) };
    const active = st.players.filter((p) => !p.left);
    broadcast({ t: "progress", count: Object.keys(st.answers).length, total: active.length });
    checkAllAnswered();
  }

  function checkAllAnswered() {
    const active = st.players.filter((p) => !p.left);
    if (active.every((p) => st.answers[p.id])) reveal();
  }

  function reveal() {
    if (!st || st.phase !== "question") return;
    clearTimeout(st.timer);
    st.phase = "reveal";
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
    broadcast({ t: "reveal", qi: st.qi, answer: q.answer, correctText: q.choices[q.answer], explain: q.explain, results, players: publicPlayers(), last: st.qi >= st.questions.length - 1 });
  }

  function endOnline() {
    st.phase = "end";
    const t = THEMES[st.conf.theme];
    broadcast({ t: "end", players: publicPlayers(), total: st.questions.length, theme: st.conf.theme, themeName: t.name });
  }

  // Bouton "Suivant" / "Passer" (hôte uniquement)
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
    st.conf = { theme: settings.theme, nb: settings.nbQuestions, time: settings.time };
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

    peer = new Peer(undefined, peerOpts);
    const timeout = setTimeout(() => { if (!api.active) { restoreBtn(); fail("Salle introuvable ou connexion impossible. Vérifie le code."); } }, 15000);

    peer.on("open", () => {
      hostConn = peer.connect(PREFIX + code, { reliable: true });
      hostConn.on("open", () => hostConn.send({ t: "join", name: myName() }));
      hostConn.on("data", (d) => { if (d && d.t === "welcome") { clearTimeout(timeout); restoreBtn(); } handle(d); });
      hostConn.on("close", onHostLost);
    });
    peer.on("disconnected", () => { if (peer && !peer.destroyed) peer.reconnect(); });
    peer.on("error", (e) => {
      if (api.active) return;
      clearTimeout(timeout); restoreBtn();
      fail(e.type === "peer-unavailable" ? "Salle introuvable. Vérifie le code." : "Erreur de connexion (" + e.type + ").");
    });
  };

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
        $("#lobby-code").textContent = m.code;
        $("#lobby-link").value = shareLink(m.code);
        $("#lobby-share").classList.remove("hidden");
        $("#lobby-info").textContent = m.info;
        $("#lobby-players").innerHTML = m.players.map((n, i) => `<li>${i === 0 ? "👑 " : ""}${escapeHtml(n)}</li>`).join("");
        $("#lobby-start").classList.toggle("hidden", !isHost);
        $("#lobby-settings").classList.toggle("hidden", !isHost);
        if (isHost) renderLobbySettings();
        $("#lobby-start").disabled = false;
        $("#lobby-status").textContent = isHost
          ? (m.players.length < 2 ? "En attente d'autres joueurs… (tu peux aussi lancer seul)" : `${m.players.length} joueurs prêts !`)
          : "En attente que l'hôte lance la partie…";
        showScreen("screen-lobby");
        break;

      case "question": showOnlineQuestion(m); break;

      case "progress":
        if (view && view.phase === "question") $("#q-wait").textContent = `${m.count} / ${m.total} joueur(s) ont répondu`;
        break;

      case "reveal": showReveal(m); break;

      case "end": showEnd(m); break;
    }
  }

  function me(players) { return players.find((p) => p.id === myId) || { name: myName(), score: 0 }; }

  function showOnlineQuestion(m) {
    view = { phase: "question", qi: m.qi, start: Date.now(), time: m.time, answered: false };
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

    const box = $("#q-choices");
    box.innerHTML = "";
    m.choices.forEach((c, i) => {
      const b = makeChoiceButton(c, i, () => {
        if (view.answered) return;
        view.answered = true;
        view.choice = i;
        $$("#q-choices .choice").forEach((x) => { x.disabled = true; if (x !== b) x.classList.add("dim"); });
        b.classList.add("picked");
        $("#q-feedback").textContent = "Réponse envoyée ✔ — attends les autres…";
        sendAnswer(i, Date.now() - view.start);
        if (isHost) showSkip();
      });
      box.appendChild(b);
    });
    if (isHost && !m.time) showSkip();

    // chrono
    clearInterval(localTimer);
    const wrap = $("#timer-wrap"), bar = $("#timer-bar");
    if (!m.time) wrap.classList.add("hidden");
    else {
      wrap.classList.remove("hidden");
      bar.style.width = "100%";
      bar.style.background = "var(--good)";
      localTimer = setInterval(() => {
        const left = 1 - (Date.now() - view.start) / (m.time * 1000);
        bar.style.width = Math.max(0, left) * 100 + "%";
        bar.style.background = left < 0.25 ? "var(--bad)" : left < 0.5 ? "var(--warn)" : "var(--good)";
        if (left <= 0) {
          clearInterval(localTimer);
          if (!view.answered) {
            view.answered = true;
            $$("#q-choices .choice").forEach((x) => (x.disabled = true));
            $("#q-feedback").textContent = "⏰ Temps écoulé !";
            $("#q-feedback").className = "feedback bad";
          }
        }
      }, 100);
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
    view.phase = "reveal";
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
    $("#lobby-theme").innerHTML = Object.entries(THEMES).map(([k, t]) =>
      `<option value="${k}" ${k === c.theme ? "selected" : ""}>${t.icon || "📚"} ${escapeHtml(t.name)} (${t.questions.length})</option>`).join("");
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
  $("#copy-link").onclick = () => {
    const input = $("#lobby-link");
    input.select();
    (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject())
      .catch(() => document.execCommand("copy"))
      .finally(() => { $("#copy-link").textContent = "Copié ✔"; setTimeout(() => ($("#copy-link").textContent = "Copier"), 1500); });
  };
  window.addEventListener("beforeunload", () => { if (api.active) api.leave(); });

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
