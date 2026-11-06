// =========================================================
//  CEJM – BTS (Culture Économique, Juridique et Managériale)
//  Chaque chapitre est dans son fichier : ch01.js … ch20.js
//  Pour ajouter des questions : ouvre le fichier du chapitre et
//  ajoute { q: "...", choices: [4 réponses], answer: 0-3, explain: "..." }
// =========================================================

const CEJM_CHAPTERS = [];

function cejmChapter(def) {
  // def = { num, title, matiere: "eco" | "droit" | "management", annee: 1 | 2, questions: [...] }
  CEJM_CHAPTERS.push(def);
}
