// =========================================================
//  QUIZ CULTURE G - logique du jeu
// =========================================================

const BASE_POINTS = 100;      // points pour une bonne réponse
const MAX_SPEED_BONUS = 50;   // bonus max si on répond vite (mode chronométré)
const BOARD_KEY = "quiz-cultureg-board";
const MAX_PLAYERS = 8;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const settings = {
  mode: "solo",
  theme: Object.keys(THEMES)[0],
  nbQuestions: 10,
  nbWanted: 10, // nombre choisi par le joueur (nbQuestions est limité au nombre de questions du thème)
  time: 20,
  players: ["Joueur 1", "Joueur 2"],
};

let game = null;
let timerId = null;

// ---------- Utilitaires ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showScreen(id) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  $("#" + id).classList.add("active");
  window.scrollTo(0, 0);
}

// ---------- Classement (sauvegardé dans le navigateur) ----------
function loadBoard() {
  try { return JSON.parse(localStorage.getItem(BOARD_KEY)) || []; } catch { return []; }
}
function saveBoard(board) {
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); } catch {}
}

// ---------- Écran de réglages ----------
// Regroupe les thèmes par catégorie (propriété "group"), dans l'ordre d'apparition
function themeGroups() {
  const groups = new Map();
  Object.entries(THEMES).forEach(([key, t]) => {
    const g = t.group || "Autres";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([key, t]);
  });
  return groups;
}

const openGroups = new Set(["Général", "🎯 Sélection personnalisée", "CEJM – Révisions globales"]);

// ---------- « Mes chapitres » : thème composé des chapitres cochés ----------
const CUSTOM_KEY = "custom";
const LS_CUSTOM = "quiz-custom-selection";
let customSel = new Set();
try { customSel = new Set((JSON.parse(localStorage.getItem(LS_CUSTOM)) || []).filter((k) => THEMES[k] && THEMES[k].selectable)); } catch {}

const selectableThemes = () => Object.entries(THEMES).filter(([k, t]) => t.selectable);

function updateCustomTheme() {
  const keys = selectableThemes().map(([k]) => k).filter((k) => customSel.has(k));
  const t = THEMES[CUSTOM_KEY];
  t.questions = keys.flatMap((k) => THEMES[k].questions);
  const nums = keys.map((k) => (k.match(/ch(\d+)$/) || [])[1]).filter(Boolean).map(Number);
  const others = keys.filter((k) => !/ch\d+$/.test(k)).map((k) => THEMES[k].name);
  t.name = keys.length
    ? "Mes chapitres : " + [...(nums.length ? ["ch. " + nums.join(", ")] : []), ...others].join(" + ")
    : "Mes chapitres (à choisir)";
  try { localStorage.setItem(LS_CUSTOM, JSON.stringify(keys)); } catch {}
}

// Ajoute le thème « Mes chapitres » juste après « Général »
(() => {
  const entries = Object.entries(THEMES);
  entries.forEach(([k]) => delete THEMES[k]);
  const custom = { group: "🎯 Sélection personnalisée", name: "Mes chapitres", icon: "🎯", questions: [] };
  let added = false;
  entries.forEach(([k, t], i) => {
    if (!added && t.group !== "Général") { THEMES[CUSTOM_KEY] = custom; added = true; }
    THEMES[k] = t;
  });
  if (!added) THEMES[CUSTOM_KEY] = custom;
  updateCustomTheme();
})();

// Liste de cases à cocher (utilisée à l'accueil et dans la salle d'attente en ligne)
function renderChapterPicker(container, onChange) {
  const groups = new Map();
  selectableThemes().forEach(([k, t]) => {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push([k, t]);
  });
  container.innerHTML =
    `<div class="cp-title">🎯 Coche les chapitres à réviser</div>
     <div class="cp-actions">
       <button type="button" data-act="all">Tout cocher</button>
       ${[...groups.keys()].map((g) => `<button type="button" data-act="group" data-group="${escapeHtml(g)}">${escapeHtml(g.replace("CEJM – Chapitres ", "Tout "))}</button>`).join("")}
       <button type="button" data-act="none">Tout décocher</button>
     </div>` +
    [...groups].map(([g, items]) =>
      `<div class="cp-group"><h4>${escapeHtml(g)}</h4><div class="cp-list">` +
      items.map(([k, t]) =>
        `<label class="cp-item"><input type="checkbox" value="${k}" ${customSel.has(k) ? "checked" : ""}>${escapeHtml(t.name)}<span>${t.questions.length}</span></label>`).join("") +
      `</div></div>`).join("") +
    `<div class="cp-count">${customSel.size ? `${customSel.size} chapitre(s) coché(s) · ${THEMES[CUSTOM_KEY].questions.length} questions` : "Aucun chapitre coché"}</div>`;

  const changed = () => { updateCustomTheme(); onChange(); };
  container.querySelectorAll("input[type=checkbox]").forEach((cb) => cb.onchange = () => {
    if (cb.checked) customSel.add(cb.value); else customSel.delete(cb.value);
    changed();
  });
  container.querySelectorAll(".cp-actions button").forEach((btn) => btn.onclick = () => {
    const act = btn.dataset.act;
    if (act === "all") selectableThemes().forEach(([k]) => customSel.add(k));
    if (act === "none") customSel.clear();
    if (act === "group") {
      const keys = (groups.get(btn.dataset.group) || []).map(([k]) => k);
      const allOn = keys.every((k) => customSel.has(k));
      keys.forEach((k) => (allOn ? customSel.delete(k) : customSel.add(k)));
    }
    changed();
  });
}

function renderSetupPicker() {
  const box = $("#custom-picker");
  box.classList.toggle("hidden", settings.theme !== CUSTOM_KEY);
  if (settings.theme === CUSTOM_KEY) renderChapterPicker(box, () => { $("#setup-msg").textContent = ""; renderThemes(); updateRange(); });
}

function renderThemes() {
  const list = $("#themes-list");
  list.innerHTML = "";
  themeGroups().forEach((items, group) => {
    const hasActive = items.some(([k]) => k === settings.theme);
    const det = document.createElement("details");
    det.className = "theme-group";
    det.open = openGroups.has(group) || hasActive;
    det.ontoggle = () => { if (det.open) openGroups.add(group); else openGroups.delete(group); };
    det.innerHTML = `<summary>${escapeHtml(group)} <span class="t-count">(${items.length})</span></summary>`;
    const grid = document.createElement("div");
    grid.className = "themes";
    items.forEach(([key, t]) => {
      const b = document.createElement("button");
      b.className = "theme" + (key === settings.theme ? " active" : "");
      b.innerHTML = `<span class="t-icon">${t.icon || "📚"}</span><strong>${escapeHtml(t.name)}</strong><br><span class="t-count">${t.questions.length} questions</span>`;
      b.onclick = () => { settings.theme = key; renderThemes(); updateRange(); $("#setup-msg").textContent = ""; };
      grid.appendChild(b);
    });
    det.appendChild(grid);
    list.appendChild(det);
  });
}

function updateRange() {
  renderSetupPicker();
  const max = Math.max(1, THEMES[settings.theme].questions.length);
  const range = $("#nb-questions");
  range.max = max;
  range.min = Math.min(5, max);
  settings.nbQuestions = Math.min(settings.nbWanted, max);
  range.value = settings.nbQuestions;
  $("#nb-questions-value").textContent = settings.nbQuestions;
}

function renderPlayers() {
  const zone = $("#players-zone");
  zone.classList.toggle("hidden", settings.mode !== "multi");
  const list = $("#players-list");
  list.innerHTML = "";
  const shown = settings.mode === "solo" ? settings.players.slice(0, 1) : settings.players;
  shown.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<input type="text" maxlength="20" placeholder="Nom du joueur ${i + 1}" value="${escapeHtml(name)}" />
      ${settings.players.length > 2 ? '<button title="Retirer">✕</button>' : ""}`;
    row.querySelector("input").oninput = (e) => { settings.players[i] = e.target.value; };
    const del = row.querySelector("button");
    if (del) del.onclick = () => { settings.players.splice(i, 1); renderPlayers(); };
    list.appendChild(row);
  });
  $("#add-player").classList.toggle("hidden", settings.players.length >= MAX_PLAYERS);
}

function setupListeners() {
  $$("#mode-group .toggle").forEach((b) => b.onclick = () => {
    $$("#mode-group .toggle").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    settings.mode = b.dataset.mode;
    renderPlayers();
    updateModeUI();
  });

  $$("#time-group .toggle").forEach((b) => b.onclick = () => {
    $$("#time-group .toggle").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    settings.time = Number(b.dataset.time);
  });

  $("#nb-questions").oninput = (e) => {
    settings.nbQuestions = settings.nbWanted = Number(e.target.value);
    $("#nb-questions-value").textContent = settings.nbQuestions;
  };

  $("#add-player").onclick = () => {
    if (settings.players.length < MAX_PLAYERS) {
      settings.players.push("Joueur " + (settings.players.length + 1));
      renderPlayers();
    }
  };

  $("#pause-btn").onclick = () => (Online.active ? Online.togglePause() : togglePauseLocal());
  $("#resume-btn").onclick = () => (Online.active ? Online.togglePause() : togglePauseLocal());
  $("#start-btn").onclick = () => {
    if (!THEMES[settings.theme].questions.length) { $("#setup-msg").textContent = "Coche au moins un chapitre dans « Mes chapitres »."; return; }
    $("#setup-msg").textContent = "";
    settings.mode === "online" ? Online.host() : startGame();
  };
  $("#turn-ready").onclick = showQuestion;
  $("#next-btn").onclick = () => (Online.active ? Online.next() : nextTurn());
  $("#replay-btn").onclick = () => (Online.active ? Online.backToLobby() : startGame());
  $("#home-btn").onclick = () => { if (Online.active) Online.leave(); showScreen("screen-setup"); };
  $("#show-board-btn").onclick = () => openBoard("screen-setup");
  $("#board-btn").onclick = () => openBoard("screen-results");
  $("#board-filter").onchange = renderBoard;
  $("#board-clear").onclick = () => {
    if (confirm("Effacer tout le classement général ?")) { saveBoard([]); renderBoard(); }
  };
}

function updateModeUI() {
  const online = settings.mode === "online";
  $("#online-zone").classList.toggle("hidden", !online);
  $("#start-btn").textContent = online ? "Créer une salle en ligne 🌐" : "Lancer la partie ▶";
}

// ---------- Affichage commun des réponses ----------
function makeChoiceButton(text, i, onPick) {
  const b = document.createElement("button");
  b.className = "choice c" + i;
  b.innerHTML = `<span class="letter">${"ABCD"[i]}</span><span>${escapeHtml(text)}</span>`;
  b.onclick = () => onPick(i);
  return b;
}

// Montre la bonne réponse (✔), la mauvaise choisie (✖), grise les autres,
// et affiche le message + l'explication si c'est raté.
function revealAnswer({ answer, picked, pts, correctText, explain }) {
  const buttons = $$("#q-choices .choice");
  buttons.forEach((b, i) => {
    b.disabled = true;
    b.classList.remove("picked", "dim", "unpicked");
    if (i === answer) b.classList.add("good");
    else if (i === picked) b.classList.add("bad");
    else b.classList.add("dim");
  });

  const fb = $("#q-feedback");
  const ex = $("#q-explain");
  if (picked === answer) {
    fb.textContent = `✅ Bonne réponse ! +${pts} pts`;
    fb.className = "feedback big good";
    ex.classList.add("hidden");
  } else {
    fb.textContent = picked < 0 ? "⏰ Temps écoulé !" : "❌ Mauvaise réponse";
    fb.className = "feedback big bad";
    ex.innerHTML = `<strong>La bonne réponse était : ${escapeHtml(correctText)}</strong>` +
      (explain ? `<br>💡 ${escapeHtml(explain)}` : "");
    ex.classList.remove("hidden");
  }
}

// ---------- Tirage des questions ----------
// Positions des bonnes réponses équilibrées : sur une partie, A, B, C et D
// sont la bonne réponse à peu près le même nombre de fois (écart max : 1),
// dans un ordre aléatoire, et jamais plus de 2 fois la même lettre d'affilée.
function balancedPositions(n) {
  for (let attempt = 0; attempt < 200; attempt++) {
    // chaque lettre apparaît floor(n/4) fois, le reste est réparti au hasard sur des lettres différentes
    const pos = [];
    for (let i = 0; i < Math.floor(n / 4); i++) pos.push(0, 1, 2, 3);
    pos.push(...shuffle([0, 1, 2, 3]).slice(0, n % 4));
    const order = shuffle(pos);
    if (order.every((p, i) => i < 2 || !(p === order[i - 1] && p === order[i - 2]))) return order;
  }
  return shuffle(Array.from({ length: n }, (_, i) => i % 4));
}

function buildQuestions(themeKey, n) {
  const picked = shuffle(THEMES[themeKey].questions).slice(0, n);
  const positions = balancedPositions(picked.length);
  return picked.map((q, k) => {
    const target = positions[k];
    const wrong = shuffle(q.choices.filter((_, i) => i !== q.answer));
    const choices = [];
    for (let i = 0; i < 4; i++) choices.push(i === target ? q.choices[q.answer] : wrong.shift());
    return { q: q.q, choices, answer: target, explain: q.explain || "" };
  });
}

// ---------- Déroulement de la partie ----------
function startGame() {
  if (!THEMES[settings.theme].questions.length) {
    $("#setup-msg").textContent = "Coche au moins un chapitre dans « Mes chapitres ».";
    return;
  }
  $("#setup-msg").textContent = "";
  const names = (settings.mode === "solo" ? settings.players.slice(0, 1) : settings.players)
    .map((n, i) => n.trim() || "Joueur " + (i + 1));

  const questions = buildQuestions(settings.theme, settings.nbQuestions);

  game = {
    questions,
    players: names.map((name) => ({ name, score: 0, correct: 0 })),
    qIndex: 0,
    pIndex: 0,
    answered: false,
    startTime: 0,
  };
  beginTurn();
}

function beginTurn() {
  if (game.players.length > 1) {
    $("#turn-qnum").textContent = `${game.qIndex + 1} / ${game.questions.length}`;
    $("#turn-player").textContent = game.players[game.pIndex].name;
    showScreen("screen-turn");
  } else {
    showQuestion();
  }
}

function showQuestion() {
  const q = game.questions[game.qIndex];
  const p = game.players[game.pIndex];
  game.answered = false;

  $("#q-player").textContent = "👤 " + p.name;
  $("#q-progress").textContent = `Question ${game.qIndex + 1} / ${game.questions.length}`;
  $("#q-score").textContent = p.score + " pts";
  $("#progress-bar").style.width = (game.qIndex / game.questions.length) * 100 + "%";
  $("#q-text").textContent = q.q;
  $("#q-feedback").textContent = "";
  $("#q-feedback").className = "feedback";
  $("#q-wait").textContent = "";
  $("#q-live").innerHTML = "";
  $("#q-explain").classList.add("hidden");
  $("#q-players").classList.add("hidden");
  $("#next-btn").classList.add("hidden");

  const box = $("#q-choices");
  box.innerHTML = "";
  q.choices.forEach((c, i) => box.appendChild(makeChoiceButton(c, i, answer)));

  showScreen("screen-question");
  startTimer();
}

// ---------- Pause (commun) ----------
// paused : en pause ou non ; canResume : afficher le bouton "Reprendre" ; msg : texte sous "Pause"
function setPauseUI(paused, canResume, msg) {
  $("#pause-overlay").classList.toggle("hidden", !paused);
  $("#resume-btn").classList.toggle("hidden", !canResume);
  $("#pause-msg").textContent = msg || "";
  const btn = $("#pause-btn");
  btn.textContent = paused ? "▶ Reprendre" : "⏸ Pause";
  btn.classList.toggle("paused", paused);
}
function showPauseButton(visible) {
  $("#pause-btn").classList.toggle("hidden", !visible);
  if (!visible) setPauseUI(false);
}

function drawTimer(startTime, time) {
  const left = 1 - (Date.now() - startTime) / (time * 1000);
  const bar = $("#timer-bar");
  bar.style.width = Math.max(0, left) * 100 + "%";
  bar.style.background = left < 0.25 ? "var(--bad)" : left < 0.5 ? "var(--warn)" : "var(--good)";
  return left;
}

function startTimer() {
  clearInterval(timerId);
  game.startTime = Date.now();
  game.paused = false;
  setPauseUI(false);
  if (!settings.time) { $("#timer-wrap").classList.add("hidden"); showPauseButton(false); return; }
  $("#timer-wrap").classList.remove("hidden");
  showPauseButton(true);
  runTimer();
}

function runTimer() {
  clearInterval(timerId);
  drawTimer(game.startTime, settings.time);
  timerId = setInterval(() => {
    if (drawTimer(game.startTime, settings.time) <= 0) answer(-1);
  }, 100);
}

function togglePauseLocal() {
  if (!game || game.answered || !settings.time) return;
  if (!game.paused) {
    game.paused = true;
    game.pausedAt = Date.now();
    clearInterval(timerId);
    setPauseUI(true, true, "Le chrono est arrêté. La question est cachée.");
  } else {
    game.startTime += Date.now() - game.pausedAt; // le temps de pause ne compte pas
    game.paused = false;
    setPauseUI(false);
    runTimer();
  }
}

function answer(choice) {
  if (game.answered || game.paused) return;
  game.answered = true;
  clearInterval(timerId);
  showPauseButton(false);

  const q = game.questions[game.qIndex];
  const p = game.players[game.pIndex];
  let pts = 0;
  if (choice === q.answer) {
    pts = BASE_POINTS;
    if (settings.time) {
      const ratio = Math.max(0, 1 - (Date.now() - game.startTime) / (settings.time * 1000));
      pts += Math.round(MAX_SPEED_BONUS * ratio);
    }
    p.score += pts;
    p.correct++;
  }
  revealAnswer({ answer: q.answer, picked: choice, pts, correctText: q.choices[q.answer], explain: q.explain });
  $("#q-score").textContent = p.score + " pts";
  $("#next-btn").classList.remove("hidden");
  $("#next-btn").focus();
}

function nextTurn() {
  game.pIndex++;
  if (game.pIndex >= game.players.length) {
    game.pIndex = 0;
    game.qIndex++;
  }
  if (game.qIndex >= game.questions.length) endGame();
  else beginTurn();
}

// ---------- Fin de partie ----------
function renderResults(ranking, total) {
  // Podium
  const podium = $("#podium");
  podium.innerHTML = "";
  const medals = ["🥇", "🥈", "🥉"];
  const order = ranking.length >= 3 ? [1, 0, 2] : ranking.length === 2 ? [1, 0] : [0];
  order.forEach((idx) => {
    const p = ranking[idx];
    const d = document.createElement("div");
    d.className = "pod p" + (idx + 1);
    d.innerHTML = `<div class="name">${escapeHtml(p.name)}</div><div class="pts">${p.score} pts</div><div class="bar">${medals[idx]}</div>`;
    podium.appendChild(d);
  });

  // Tableau
  $("#results-body").innerHTML = ranking.map((p, i) =>
    `<tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${p.correct} / ${total}</td><td>${p.score}</td></tr>`
  ).join("");
}

function endGame() {
  const ranking = [...game.players].sort((a, b) => b.score - a.score);
  const total = game.questions.length;
  renderResults(ranking, total);
  $("#replay-btn").classList.remove("hidden");
  $("#replay-btn").textContent = "Rejouer ↻";
  $("#home-btn").textContent = "Menu principal";

  // Sauvegarde dans le classement général
  const board = loadBoard();
  const date = new Date().toLocaleDateString("fr-FR");
  game.players.forEach((p) => board.push({
    name: p.name, theme: settings.theme, correct: p.correct, total, score: p.score, date,
    mode: game.players.length > 1 ? "multi" : "solo",
  }));
  board.sort((a, b) => b.score - a.score);
  saveBoard(board.slice(0, 100));

  showScreen("screen-results");
}

// ---------- Classement général ----------
let boardReturn = "screen-setup";
function openBoard(from) {
  boardReturn = from;
  const sel = $("#board-filter");
  sel.innerHTML = `<option value="">Tous les thèmes</option>` +
    Object.entries(THEMES).map(([k, t]) => `<option value="${k}">${escapeHtml(t.name)}</option>`).join("");
  renderBoard();
  $("#board-back").onclick = () => showScreen(boardReturn);
  showScreen("screen-board");
}

function renderBoard() {
  const filter = $("#board-filter").value;
  const rows = loadBoard().filter((r) => !filter || r.theme === filter).slice(0, 20);
  $("#board-body").innerHTML = rows.length
    ? rows.map((r, i) => `<tr><td>${["🥇", "🥈", "🥉"][i] || i + 1}</td><td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(THEMES[r.theme]?.name || r.theme)}</td><td>${r.correct}/${r.total}</td>
        <td><strong>${r.score}</strong></td><td>${escapeHtml(r.date)}</td></tr>`).join("")
    : `<tr><td colspan="6" style="text-align:center;color:var(--muted)">Aucun score pour l'instant</td></tr>`;
}

// ---------- Initialisation ----------
renderThemes();
updateRange();
renderPlayers();
setupListeners();
