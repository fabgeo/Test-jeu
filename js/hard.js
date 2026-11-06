// =========================================================
//  MODE DIFFICILE : on écrit sa réponse
//  - le jeu propose une correction automatique (juste / approximatif / faux)
//    en comparant les mots-clés de la réponse à ceux de la « réponse type » ;
//  - c'est l'hôte (en ligne) ou le joueur (solo / même appareil) qui décide.
// =========================================================

const VERDICTS = {
  juste: { label: "✅ Juste", short: "✅", pts: BASE_POINTS },
  approx: { label: "🟡 Approximatif", short: "🟡", pts: Math.round(BASE_POINTS / 2) },
  faux: { label: "❌ Faux", short: "❌", pts: 0 },
};

// Points : juste = 100 + bonus de vitesse ; approximatif = 50 ; faux = 0
function hardPoints(verdict, ms, time) {
  if (verdict === "juste") {
    let pts = BASE_POINTS;
    if (time) pts += Math.round(MAX_SPEED_BONUS * Math.max(0, 1 - (ms || 0) / (time * 1000)));
    return pts;
  }
  return verdict === "approx" ? VERDICTS.approx.pts : 0;
}

// Questions qui n'ont de sens qu'avec les 4 propositions (« Lequel… », « …n'est PAS… ») : exclues du mode difficile
function isOpenable(q) {
  return !/\b(lequel|laquelle|lesquels|lesquelles)\b|\bPAS\b|\bparmi\b|^exemples?\b/i.test(q.q);
}
// Questions du mode difficile : { q, a: [réponses acceptées], explain }
// - thèmes CEJM : questions à réponse courte (short.js), correction fiable
// - autres thèmes : les questions à 4 choix « ouvrables », la bonne réponse sert de réponse type
function hardPool(themeKey) {
  const t = THEMES[themeKey];
  if (!t) return [];
  if (themeKey === CUSTOM_KEY) return [...customSel].filter((k) => THEMES[k]).flatMap((k) => hardPool(k));
  if (t.short && t.short.length) return t.short;
  return t.questions.filter(isOpenable).map((q) => ({ q: q.q, a: [q.choices[q.answer]], explain: q.explain || "" }));
}

function buildHardQuestions(themeKey, n) {
  return shuffle(hardPool(themeKey)).slice(0, n).map((h) => ({
    hard: true, q: h.q, model: h.a[0], accepted: h.a, explain: h.explain || "",
  }));
}

// ---------- Correction automatique (suggestion) ----------
const STOP = new Set(("le la les l un une des de du d et ou a au aux en dans sur pour par avec sans ce cet cette ces qui que qu " +
  "est sont etre son sa ses leur leurs il elle ils elles on se s ne n pas plus y c j m t lui eux tout tous toute toutes " +
  "tres bien comme mais donc car si quand selon entre ainsi alors aussi autre autres meme chaque elle-meme sous vers").split(" "));

const normTxt = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/œ/g, "oe").replace(/[^a-z0-9%]+/g, " ").trim();
const stem = (w) => (w.length > 4 ? w.replace(/(ements|ement|ations|ation|ites|ite|ives|ive|ifs|if|eurs|eur|euses|euse|aux|es|s|x|e)$/, "") : w);
const keywords = (s) => [...new Set(normTxt(s).split(" ").filter((w) => w && !STOP.has(w) && (w.length > 2 || /\d/.test(w))).map(stem))];

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Un mot de la réponse type est-il présent (à une petite faute près) dans la réponse du joueur ?
// (tolérance : 1 faute pour les mots de 6 lettres et plus, 2 fautes à partir de 9 — « micro » ≠ « macro »)
function wordFound(k, words) {
  // la 1re lettre doit être la même : « désintermédiation » ≠ « réintermédiation »
  return words.some((w) => w === k || (k.length >= 6 && w[0] === k[0] && lev(w, k) <= (k.length >= 9 ? 2 : 1)));
}

function autoGrade(text, model) {
  const words = keywords(text);
  if (!words.length) return "faux";
  const core = String(model).replace(/\([^)]*\)/g, " "); // les exemples entre parenthèses sont un bonus
  let keys = keywords(core);
  if (!keys.length) keys = keywords(model);

  // Un sigle ou une précision entre parenthèses suffit (ex. « BCE » pour « Banque centrale européenne (BCE) »)
  const paren = [...String(model).matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  for (const p of paren) {
    const pk = keywords(p);
    if (/^[A-Z0-9]{2,6}$/.test(p.trim()) && pk.length && pk.every((k) => words.includes(k))) return "juste";
  }

  // Les nombres (20 ans, 14 jours, 3 %…) doivent être exacts
  const nums = keys.filter((k) => /\d/.test(k));
  const numsFound = nums.filter((n) => words.includes(n)).length;
  if (nums.length && !numsFound) return "faux";

  const found = keys.filter((k) => wordFound(k, words));
  const ratio = found.length / keys.length;
  const longest = [...keys].sort((x, y) => y.length - x.length)[0];
  const okNums = numsFound === nums.length;
  if (okNums && (ratio >= 0.75 || (keys.length >= 3 && ratio >= 0.5 && found.includes(longest)))) return "juste";
  if (ratio >= 0.3 || found.length >= 1 && keys.length <= 2) return "approx";
  return "faux";
}

// Correction d'une réponse courte : comparée à chacune des réponses acceptées
function gradeAnswer(text, accepted) {
  const t = normTxt(text);
  if (!t) return "faux";
  let best = "faux";
  for (const a of accepted) {
    const n = normTxt(a);
    if (n && (t === n || (" " + t + " ").includes(" " + n + " "))) return "juste"; // présente telle quelle (sigles courts : SA, IS…)
    const g = autoGrade(text, a);
    if (g === "juste") return "juste";
    if (g === "approx") best = "approx";
  }
  return best;
}

// ---------- Écran de correction ----------
// entries : [{ id, name, text, auto }] ; canJudge : peut attribuer les points ; onSubmit(verdicts)
function renderJudge(container, { model, alts, explain, entries, canJudge, onSubmit, title, myId }) {
  const verdicts = {};
  entries.forEach((e) => (verdicts[e.id] = e.auto));
  container.innerHTML =
    `<div class="judge-model"><div class="judge-title">📘 Réponse type</div><div class="judge-model-text">${escapeHtml(model)}</div>` +
    (alts && alts.length ? `<div class="judge-explain">Accepté aussi : ${alts.map(escapeHtml).join(" · ")}</div>` : "") +
    (explain ? `<div class="judge-explain">💡 ${escapeHtml(explain)}</div>` : "") + `</div>` +
    `<div class="judge-title">${escapeHtml(title || (canJudge ? "À toi de corriger" : "Les réponses"))}</div>` +
    entries.map((e) => `
      <div class="judge-row" data-id="${escapeHtml(e.id)}">
        <div class="judge-head"><strong>${escapeHtml(e.name)}${e.id === myId ? " (toi)" : ""}</strong>
          <span class="judge-auto">suggestion : ${VERDICTS[e.auto].label}</span></div>
        <div class="judge-answer">${e.text ? "« " + escapeHtml(e.text) + " »" : "<em>— pas de réponse —</em>"}</div>
        ${canJudge ? `<div class="judge-btns">${Object.entries(VERDICTS).map(([k, v]) =>
          `<button type="button" class="jv jv-${k} ${verdicts[e.id] === k ? "on" : ""}" data-v="${k}">${v.label}${k !== "faux" ? ` <small>+${k === "juste" ? "100" : v.pts}</small>` : ""}</button>`).join("")}</div>` : ""}
      </div>`).join("") +
    (canJudge ? `<button type="button" class="btn-primary judge-submit">Valider la correction ✔</button>` : "");

  if (!canJudge) return;
  container.querySelectorAll(".judge-row").forEach((row) => {
    row.querySelectorAll(".jv").forEach((b) => b.onclick = () => {
      verdicts[row.dataset.id] = b.dataset.v;
      row.querySelectorAll(".jv").forEach((x) => x.classList.toggle("on", x === b));
    });
  });
  container.querySelector(".judge-submit").onclick = (ev) => { ev.target.disabled = true; onSubmit({ ...verdicts }); };
}

// Zone de saisie (sous la question)
function showHardInput(onSubmit, label) {
  const zone = $("#hard-zone"), input = $("#hard-input"), btn = $("#hard-submit");
  zone.classList.remove("hidden");
  input.value = "";
  input.disabled = false;
  btn.disabled = false;
  btn.textContent = label || "✔ Valider ma réponse";
  btn.onclick = () => onSubmit(input.value.trim());
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(input.value.trim()); } };
  setTimeout(() => input.focus(), 50);
}
function hideHardZones() {
  $("#hard-zone").classList.add("hidden");
  $("#judge-zone").classList.add("hidden");
  $("#judge-zone").innerHTML = "";
}
