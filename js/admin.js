// =========================================================
//  PAGE D'ADMINISTRATION
//  - écoute TOUTES les salles en ligne sur les 3 relais MQTT (sujets <racine>/+/host et /+/all)
//  - actions signées avec la clé privée de l'administrateur (déverrouillée par mot de passe) :
//    fermer une salle, retirer un joueur, envoyer un message, bloquer / débloquer
//  Le jeu vérifie chaque commande avec la clé publique (net-config.js) : sans le mot de passe,
//  impossible d'envoyer une commande acceptée.
// =========================================================
(() => {
  // Clé privée chiffrée (PBKDF2 + AES-GCM) : inutilisable sans le mot de passe
  const VAULT = {"salt":"Yhz62Pl7/MZbqOAD1lrnGg==","iv":"MvtPNrqx+OvoHaNz","ct":"ors9/KH0npdpwNAyuoxDiB4ieP0iEhf+gWlljC8N1qF6bD0hZbZ37nxMipu8ey4V8fmuVJ0n7V7if7oOJm4wMo4wwfUtrLo7VEs5fmbnZO07oXm+WB7K27Vtjwz+JXgnfJKZ5j8GrWx2Rz1LNflhScqjdTCurCEqlmlMTO1VbKReuwD1Ayuih3d9VCTlk8vApUilFwSb/pkcw8eHeBddowLwk/7mMXtZH1RJJyEiz8A89NExjfujXqGn4XV+AVZBPGI8ToHqWYBXRE10MIspHLA52ncLe0WOR8SR11sG","iterations":2000000};

  const params = new URLSearchParams(location.search);
  const ROOT = NET.ROOT;
  const BROKERS = params.get("mqtt") ? params.get("mqtt").split(",") : NET.BROKERS;
  const BANS_TOPIC = ROOT + "_admin/bans";
  const SS_KEY = "quiz-admin-key"; // clé déverrouillée gardée pour cet onglet seulement

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64e = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
  const parse = (buf) => { try { const s = buf.toString(); return s ? JSON.parse(s) : null; } catch { return null; } };

  let privKey = null;
  const ver = ((document.querySelector('script[src*="admin.js"]') || {}).src || "").split("v=")[1] || "?";
  $("#admin-version").textContent = "Version de la page : " + ver;
  const clients = [];          // un client MQTT par relais
  const serverState = BROKERS.map(() => "connexion…");
  const rooms = new Map();     // code -> infos de la salle
  let bans = { list: [], at: 0 };

  // ---------- Connexion (mot de passe) ----------
  async function unlock(password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64d(VAULT.salt), iterations: VAULT.iterations, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const jwk = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(VAULT.iv) }, aes, b64d(VAULT.ct))));
    return jwk;
  }
  async function useKey(jwk) {
    privKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(jwk)); } catch {}
    $("#login").classList.add("hidden");
    $("#dash").classList.remove("hidden");
    connectAll();
    setInterval(render, 1000);
    render();
  }
  // Saisie tolérante : espaces autour et majuscules ignorés (« compta », « COMPTA », « Compta » …)
  $("#login-btn").onclick = async () => {
    const raw = $("#pwd").value;
    const t = raw.trim();
    const candidates = [...new Set([raw, t, t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(), t.toLowerCase()])].filter(Boolean);
    $("#login-msg").textContent = "Vérification…";
    $("#login-btn").disabled = true;
    for (const pwd of candidates) {
      try { const jwk = await unlock(pwd); $("#login-msg").textContent = ""; $("#login-btn").disabled = false; return useKey(jwk); } catch {}
    }
    $("#login-btn").disabled = false;
    $("#login-msg").textContent = "Mot de passe incorrect.";
  };
  $("#pwd").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#login-btn").click(); });
  $("#logout").onclick = () => { try { sessionStorage.removeItem(SS_KEY); } catch {} location.reload(); };
  try { const saved = JSON.parse(sessionStorage.getItem(SS_KEY)); if (saved) useKey(saved); } catch {}

  // ---------- Signature des commandes ----------
  async function signed(payload) {
    const p = JSON.stringify(payload);
    const s = b64e(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privKey, new TextEncoder().encode(p)));
    return { t: "admin", from: "admin", p, s };
  }
  async function verify(msg) {
    try {
      const key = await crypto.subtle.importKey("jwk", NET.ADMIN_PUBLIC_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      return (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64d(msg.s), new TextEncoder().encode(msg.p))) ? JSON.parse(msg.p) : null;
    } catch { return null; }
  }
  async function sendCommand(room, payload) {
    const c = clients[room.broker];
    if (!c || !c.connected) return toast("⚠️ Serveur de cette salle injoignable pour l'instant", true);
    c.publish(ROOT + room.code + "/act", JSON.stringify(await signed({ ...payload, code: room.code, at: Date.now() })), { qos: 1 });
  }
  async function publishBans() {
    bans.at = Date.now();
    const msg = JSON.stringify(await signed({ list: bans.list, at: bans.at }));
    clients.forEach((c) => c && c.connected && c.publish(BANS_TOPIC, msg, { qos: 1, retain: true }));
    render();
  }

  // ---------- Écoute de toutes les salles ----------
  function connectAll() {
    BROKERS.forEach((url, i) => {
      const c = mqtt.connect(url, { clientId: "qz_admin_" + Math.random().toString(36).slice(2, 10), clean: true, reconnectPeriod: 3000, connectTimeout: 8000, keepalive: 30 });
      clients[i] = c;
      c.on("connect", () => { serverState[i] = "ok"; c.subscribe([ROOT + "+/host", ROOT + "+/all", BANS_TOPIC], { qos: 1 }); });
      c.on("offline", () => (serverState[i] = "hors ligne"));
      c.on("error", () => (serverState[i] = "erreur"));
      c.on("message", (topic, buf) => onMessage(i, topic, buf));
    });
  }

  async function onMessage(i, topic, buf) {
    if (topic === BANS_TOPIC) {
      const payload = await verify(parse(buf) || {});
      if (payload && Array.isArray(payload.list) && payload.at >= bans.at) bans = { list: payload.list, at: payload.at };
      return;
    }
    const [code, sub] = topic.slice(ROOT.length).split("/");
    if (!code || code.length !== 5) return;
    const m = parse(buf);
    let r = rooms.get(code);
    if (!r) {
      if (sub === "host" && (!m || !m.on)) return; // salle déjà fermée
      r = { code, broker: i, players: [], online: true, first: Date.now() };
      rooms.set(code, r);
    }
    r.broker = i;
    r.last = Date.now();
    if (sub === "host") {
      r.online = !!(m && m.on);
      if (m && m.on) { r.hostName = m.name || r.hostName; r.hostUid = m.uid || r.hostUid; r.closedAt = 0; }
      else if (!r.closedAt) r.closedAt = Date.now();
      return;
    }
    if (!m) return;
    if (m.t === "presence") { r.players = m.players || []; if (m.room) Object.assign(r, m.room); r.online = true; }
    if (m.t === "lobby") { r.phase = "lobby"; r.info = m.info; }
    if (m.t === "question") { r.phase = "question"; r.qi = m.qi; r.total = m.total; r.q = m.q; }
    if (m.t === "end") r.phase = "end";
    if (m.t === "hostleft") { r.online = false; r.closedAt = Date.now(); }
  }

  // ---------- Affichage ----------
  const PHASES = { lobby: "🕒 Salle d'attente", question: "❓ Question", judge: "✍️ Correction", reveal: "✅ Réponse affichée", end: "🏁 Terminée" };
  const DOT = { present: "🟢", away: "🟡", absent: "🔴" };

  function phaseText(r) {
    if (!r.online) return "⚫ Fermée / hôte déconnecté";
    let t = PHASES[r.phase] || "…";
    if (["question", "judge", "reveal"].includes(r.phase) && r.total) t += ` ${r.qi + 1}/${r.total}`;
    if (r.paused) t += " ⏸ (pause)";
    return t;
  }
  const bannedEntry = (type, value) => bans.list.find((b) => b.type === type && (type === "name" ? b.value.toLowerCase() === String(value).toLowerCase() : b.value === value));

  function render() {
    // nettoyage : salles fermées depuis 2 min, ou silencieuses depuis 1 min
    const now = Date.now();
    rooms.forEach((r, code) => {
      if ((r.closedAt && now - r.closedAt > 120000) || now - r.last > 60000) rooms.delete(code);
      else if (now - r.last > 20000) r.online = false;
    });

    $("#servers").innerHTML = BROKERS.map((u, i) =>
      `<span>${serverState[i] === "ok" ? "🟢" : "🔴"} ${esc(u.replace(/^wss?:\/\//, "").split(/[:/]/)[0])}</span>`).join("");
    const active = [...rooms.values()].filter((r) => r.online);
    const nbPlayers = active.reduce((n, r) => n + r.players.filter((p) => p.status !== "absent").length, 0);
    $("#summary").textContent = `${active.length} salle(s) active(s) · ${nbPlayers} joueur(s) connecté(s)`;

    const list = [...rooms.values()].sort((a, b) => (b.online - a.online) || (b.first - a.first));
    $("#rooms").innerHTML = list.length ? list.map((r) => `
      <div class="card room ${r.online ? "" : "closed"}" data-code="${esc(r.code)}">
        <div class="room-head">
          <div><span class="room-code">${esc(r.code)}</span>
            <div class="room-meta">Hôte : <strong>${esc(r.hostName || "?")}</strong> · ${esc(r.theme || r.info || "thème ?")}
              ${r.hard ? " · ✍️ difficile" : ""}${r.time ? ` · ${r.time} s` : ""}</div>
            <div class="room-state">${phaseText(r)}</div>
            ${r.phase === "question" && r.q ? `<div class="room-meta">« ${esc(r.q)} »</div>` : ""}
          </div>
          <div class="room-actions">
            <button class="adm-btn" data-act="notice" ${r.online ? "" : "disabled"}>📢 Message</button>
            <button class="adm-btn danger" data-act="close" ${r.online ? "" : "disabled"}>🛑 Fermer la salle</button>
          </div>
        </div>
        <table>
          <thead><tr><th>Joueur</th><th>État</th><th>Score</th><th class="hide-sm">Répondu</th><th>Actions</th></tr></thead>
          <tbody>${r.players.map((p) => {
            const isHostRow = p.id === "host";
            const bannedUid = p.uid && bannedEntry("uid", p.uid);
            return `<tr>
              <td>${isHostRow ? "👑 " : ""}${esc(p.name)}</td>
              <td>${DOT[p.status] || "⚪"} ${esc(p.status === "present" ? "Présent" : p.status === "away" ? "Inactif" : "Absent")}</td>
              <td>${p.score || 0}</td>
              <td class="hide-sm">${p.answered ? "✔" : ""}</td>
              <td class="room-actions">
                <button class="adm-btn warn" data-act="kick" data-id="${esc(p.uid || p.id)}" ${r.online ? "" : "disabled"} title="${isHostRow ? "Retirer l'hôte ferme la salle" : "Retirer de la salle"}">Retirer</button>
                <button class="adm-btn danger" data-act="ban-uid" data-id="${esc(p.uid || "")}" data-name="${esc(p.name)}" ${bannedUid || !p.uid ? "disabled" : ""}>${bannedUid ? "Bloqué" : "Bloquer l'appareil"}</button>
                <button class="adm-btn danger" data-act="ban-name" data-name="${esc(p.name)}" ${bannedEntry("name", p.name) ? "disabled" : ""}>Bloquer le pseudo</button>
              </td></tr>`;
          }).join("") || `<tr><td colspan="5" class="empty">Aucun joueur pour l'instant</td></tr>`}</tbody>
        </table>
      </div>`).join("") : `<div class="card empty">Aucune salle en ligne pour le moment. Elles apparaîtront ici dès qu'un joueur en crée une.</div>`;

    $("#bans").innerHTML = bans.list.length ? bans.list.map((b, i) => `
      <div class="ban-row"><div>${b.type === "uid" ? "📱 Appareil" : "🏷️ Pseudo"} : <strong>${esc(b.label || b.value)}</strong>
        <small>${b.type === "uid" ? " (" + esc(b.value.slice(0, 6)) + "…)" : ""} · le ${esc(new Date(b.at).toLocaleString("fr-FR"))}</small></div>
        <button class="adm-btn" data-unban="${i}">Débloquer</button></div>`).join("")
      : `<p class="empty">Personne n'est bloqué.</p>`;
  }

  // ---------- Actions ----------
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn || !privKey) return;
    if (btn.dataset.unban != null) {
      const b = bans.list[Number(btn.dataset.unban)];
      if (b && confirm(`Débloquer ${b.label || b.value} ?`)) { bans.list.splice(Number(btn.dataset.unban), 1); await publishBans(); toast("Débloqué ✔"); }
      return;
    }
    const card = btn.closest(".room");
    const r = card && rooms.get(card.dataset.code);
    const act = btn.dataset.act;
    if (!r || !act) return;
    if (act === "close" && confirm(`Fermer la salle ${r.code} pour tous les joueurs ?`)) { await sendCommand(r, { cmd: "close" }); toast("Commande envoyée ✔"); }
    if (act === "notice") {
      const text = prompt(`Message à afficher dans la salle ${r.code} :`);
      if (text) { await sendCommand(r, { cmd: "notice", text }); toast("Message envoyé ✔"); }
    }
    if (act === "kick" && confirm(`Retirer ce joueur de la salle ${r.code} ?`)) { await sendCommand(r, { cmd: "kick", id: btn.dataset.id }); toast("Commande envoyée ✔"); }
    if (act === "ban-uid" && confirm(`Bloquer l'appareil de « ${btn.dataset.name} » ? Il sera retiré et ne pourra plus jouer en ligne.`)) {
      bans.list.push({ type: "uid", value: btn.dataset.id, label: btn.dataset.name, at: Date.now() });
      await publishBans(); toast("Appareil bloqué ✔");
    }
    if (act === "ban-name" && confirm(`Bloquer le pseudo « ${btn.dataset.name} » ?`)) {
      bans.list.push({ type: "name", value: btn.dataset.name, label: btn.dataset.name, at: Date.now() });
      await publishBans(); toast("Pseudo bloqué ✔");
    }
  });
  $("#ban-name-btn").onclick = async () => {
    const name = $("#ban-name").value.trim();
    if (!name || !privKey || bannedEntry("name", name)) return;
    bans.list.push({ type: "name", value: name, label: name, at: Date.now() });
    $("#ban-name").value = "";
    await publishBans(); toast("Pseudo bloqué ✔");
  };

  function toast(text) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }
})();
