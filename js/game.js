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
function renderThemes() {
  const list = $("#themes-list");
  list.innerHTML = "";
  Object.entries(THEMES).forEach(([key, t]) => {
    const b = document.createElement("button");
    b.className = "theme" + (key === settings.theme ? " active" : "");
    b.innerHTML = `<span class="t-icon">${t.icon || "📚"}</span><strong>${escapeHtml(t.name)}</strong><br><span class="t-count">${t.questions.length} questions</span>`;
    b.onclick = () => { settings.theme = key; renderThemes(); updateRange(); };
    list.appendChild(b);
  });
}

function updateRange() {
  const max = THEMES[settings.theme].questions.length;
  const range = $("#nb-questions");
  range.max = max;
  range.min = Math.min(5, max);
  if (settings.nbQuestions > max) settings.nbQuestions = max;
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
    settings.nbQuestions = Number(e.target.value);
    $("#nb-questions-value").textContent = settings.nbQuestions;
  };

  $("#add-player").onclick = () => {
    if (settings.players.length < MAX_PLAYERS) {
      settings.players.push("Joueur " + (settings.players.length + 1));
      renderPlayers();
    }
  };

  $("#start-btn").onclick = () => (settings.mode === "online" ? Online.host() : startGame());
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

// ---------- Déroulement de la partie ----------
function startGame() {
  const names = (settings.mode === "solo" ? settings.players.slice(0, 1) : settings.players)
    .map((n, i) => n.trim() || "Joueur " + (i + 1));

  const questions = shuffle(THEMES[settings.theme].questions)
    .slice(0, settings.nbQuestions)
    .map((q) => {
      // on mélange aussi l'ordre des réponses
      const order = shuffle([0, 1, 2, 3]);
      return { q: q.q, choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer) };
    });

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
  $("#next-btn").classList.add("hidden");

  const box = $("#q-choices");
  box.innerHTML = "";
  q.choices.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.innerHTML = `<span class="letter">${"ABCD"[i]}</span><span>${escapeHtml(c)}</span>`;
    b.onclick = () => answer(i);
    box.appendChild(b);
  });

  showScreen("screen-question");
  startTimer();
}

function startTimer() {
  clearInterval(timerId);
  const wrap = $("#timer-wrap");
  const bar = $("#timer-bar");
  game.startTime = Date.now();
  if (!settings.time) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");
  bar.style.width = "100%";
  bar.style.background = "var(--good)";
  timerId = setInterval(() => {
    const left = 1 - (Date.now() - game.startTime) / (settings.time * 1000);
    bar.style.width = Math.max(0, left) * 100 + "%";
    bar.style.background = left < 0.25 ? "var(--bad)" : left < 0.5 ? "var(--warn)" : "var(--good)";
    if (left <= 0) answer(-1);
  }, 100);
}

function answer(choice) {
  if (game.answered) return;
  game.answered = true;
  clearInterval(timerId);

  const q = game.questions[game.qIndex];
  const p = game.players[game.pIndex];
  const buttons = $$("#q-choices .choice");
  buttons.forEach((b) => (b.disabled = true));
  buttons[q.answer].classList.add("good");

  const fb = $("#q-feedback");
  if (choice === q.answer) {
    let pts = BASE_POINTS;
    if (settings.time) {
      const ratio = Math.max(0, 1 - (Date.now() - game.startTime) / (settings.time * 1000));
      pts += Math.round(MAX_SPEED_BONUS * ratio);
    }
    p.score += pts;
    p.correct++;
    fb.textContent = `✅ Bonne réponse ! +${pts} pts`;
    fb.classList.add("good");
  } else {
    if (choice >= 0) buttons[choice].classList.add("bad");
    fb.textContent = choice < 0 ? "⏰ Temps écoulé !" : "❌ Mauvaise réponse";
    fb.classList.add("bad");
  }
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
