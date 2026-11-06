// =========================================================
//  Construit les thèmes CEJM à partir des chapitres :
//  - un thème par chapitre
//  - BTS1 / BTS2
//  - Économie / Droit / Management
//  - Tout le programme
// =========================================================
(() => {
  const MATIERES = {
    eco: { name: "Économie", icon: "📈" },
    droit: { name: "Droit", icon: "⚖️" },
    management: { name: "Management", icon: "🧭" },
  };
  const chapters = [...CEJM_CHAPTERS].sort((a, b) => a.num - b.num);
  const all = (list) => list.flatMap((c) => c.questions);

  THEMES["cejm-tout"] = { group: "CEJM – Révisions globales", name: "Tout le programme", icon: "🎓", questions: all(chapters) };
  THEMES["cejm-bts1"] = { group: "CEJM – Révisions globales", name: "BTS1 (ch. 1 à 13)", icon: "1️⃣", questions: all(chapters.filter((c) => c.annee === 1)) };
  THEMES["cejm-bts2"] = { group: "CEJM – Révisions globales", name: "BTS2 (ch. 14 à 20)", icon: "2️⃣", questions: all(chapters.filter((c) => c.annee === 2)) };

  Object.entries(MATIERES).forEach(([key, m]) => {
    const list = chapters.filter((c) => c.matiere === key);
    THEMES["cejm-" + key] = {
      group: "CEJM – Par matière",
      name: `${m.name} (ch. ${list.map((c) => c.num).join(", ")})`,
      icon: m.icon,
      questions: all(list),
    };
  });

  chapters.forEach((c) => {
    THEMES["cejm-ch" + String(c.num).padStart(2, "0")] = {
      group: c.annee === 1 ? "CEJM – Chapitres BTS1" : "CEJM – Chapitres BTS2",
      name: `Ch. ${c.num} : ${c.title}`,
      icon: MATIERES[c.matiere].icon,
      questions: c.questions,
    };
  });
})();
