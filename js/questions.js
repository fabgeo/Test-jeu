// =========================================================
//  BANQUE DE QUESTIONS
//  Pour ajouter un thème : ajoute une entrée dans THEMES.
//  Chaque question : { q: "texte", choices: [4 réponses], answer: index (0 à 3) }
// =========================================================

const THEMES = {
  culture: {
    name: "Culture générale",
    icon: "🌍",
    questions: [
      { q: "Quelle est la capitale de l'Australie ?", choices: ["Sydney", "Melbourne", "Canberra", "Perth"], answer: 2 },
      { q: "Combien de continents compte-t-on généralement ?", choices: ["5", "6", "7", "8"], answer: 2 },
      { q: "Qui a peint « La Joconde » ?", choices: ["Michel-Ange", "Léonard de Vinci", "Raphaël", "Botticelli"], answer: 1 },
      { q: "Quel est le plus grand océan du monde ?", choices: ["Atlantique", "Indien", "Arctique", "Pacifique"], answer: 3 },
      { q: "En quelle année a eu lieu la prise de la Bastille ?", choices: ["1789", "1792", "1776", "1815"], answer: 0 },
      { q: "Quelle planète est surnommée la « planète rouge » ?", choices: ["Vénus", "Jupiter", "Mars", "Saturne"], answer: 2 },
      { q: "Quel est le symbole chimique de l'or ?", choices: ["Or", "Au", "Ag", "Go"], answer: 1 },
      { q: "Combien de joueurs compte une équipe de football sur le terrain ?", choices: ["9", "10", "11", "12"], answer: 2 },
      { q: "Qui a écrit « Les Misérables » ?", choices: ["Émile Zola", "Victor Hugo", "Gustave Flaubert", "Honoré de Balzac"], answer: 1 },
      { q: "Quel est le plus long fleuve de France ?", choices: ["La Seine", "Le Rhône", "La Garonne", "La Loire"], answer: 3 },
      { q: "Quelle est la langue la plus parlée au Brésil ?", choices: ["Espagnol", "Portugais", "Français", "Anglais"], answer: 1 },
      { q: "Combien d'os compte le squelette d'un adulte ?", choices: ["186", "206", "226", "256"], answer: 1 },
      { q: "Quel pays a offert la statue de la Liberté aux États-Unis ?", choices: ["Royaume-Uni", "Espagne", "France", "Italie"], answer: 2 },
      { q: "Quel est l'animal terrestre le plus rapide ?", choices: ["Le lion", "Le guépard", "L'antilope", "Le lévrier"], answer: 1 },
      { q: "Quelle est la monnaie du Japon ?", choices: ["Le yuan", "Le won", "Le yen", "Le baht"], answer: 2 },
      { q: "Qui a formulé la théorie de la relativité ?", choices: ["Isaac Newton", "Albert Einstein", "Niels Bohr", "Galilée"], answer: 1 },
      { q: "Quelle est la plus haute montagne du monde ?", choices: ["K2", "Mont Blanc", "Kilimandjaro", "Everest"], answer: 3 },
      { q: "Combien de côtés possède un hexagone ?", choices: ["5", "6", "7", "8"], answer: 1 },
      { q: "Dans quelle ville se trouve le Colisée ?", choices: ["Athènes", "Rome", "Naples", "Florence"], answer: 1 },
      { q: "Quel gaz les plantes absorbent-elles pour la photosynthèse ?", choices: ["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"], answer: 2 },
      { q: "Qui fut le premier homme à marcher sur la Lune ?", choices: ["Buzz Aldrin", "Youri Gagarine", "Neil Armstrong", "John Glenn"], answer: 2 },
      { q: "Quel est le plus grand pays du monde par sa superficie ?", choices: ["Canada", "Chine", "États-Unis", "Russie"], answer: 3 },
      { q: "Combien de temps met la lumière du Soleil pour atteindre la Terre (environ) ?", choices: ["8 secondes", "8 minutes", "8 heures", "1 jour"], answer: 1 },
      { q: "Quel compositeur est devenu sourd mais a continué à composer ?", choices: ["Mozart", "Bach", "Beethoven", "Chopin"], answer: 2 },
      { q: "Quelle est la capitale du Canada ?", choices: ["Toronto", "Ottawa", "Montréal", "Vancouver"], answer: 1 },
      { q: "Quel organe pompe le sang dans le corps humain ?", choices: ["Le foie", "Les poumons", "Le cœur", "Les reins"], answer: 2 },
      { q: "En quelle année a pris fin la Seconde Guerre mondiale ?", choices: ["1918", "1939", "1945", "1950"], answer: 2 },
      { q: "Quel est le plus grand désert chaud du monde ?", choices: ["Gobi", "Kalahari", "Sahara", "Atacama"], answer: 2 },
      { q: "Combien y a-t-il de minutes dans une journée ?", choices: ["1 140", "1 440", "1 400", "2 400"], answer: 1 },
      { q: "Quel écrivain a créé le personnage de Sherlock Holmes ?", choices: ["Agatha Christie", "Arthur Conan Doyle", "Edgar Allan Poe", "Jules Verne"], answer: 1 },
      { q: "Quelle est la formule chimique de l'eau ?", choices: ["CO2", "H2O", "O2", "NaCl"], answer: 1 },
      { q: "Quel pays est célèbre pour ses pyramides de Gizeh ?", choices: ["Mexique", "Pérou", "Égypte", "Soudan"], answer: 2 },
      { q: "Quel est le plus petit pays du monde ?", choices: ["Monaco", "Vatican", "Saint-Marin", "Liechtenstein"], answer: 1 },
      { q: "Combien de couleurs compte un arc-en-ciel traditionnellement ?", choices: ["5", "6", "7", "8"], answer: 2 },
      { q: "Qui a inventé l'ampoule électrique à incandescence commercialisée ?", choices: ["Nikola Tesla", "Thomas Edison", "Graham Bell", "Louis Pasteur"], answer: 1 },
      { q: "Quel instrument possède 88 touches ?", choices: ["L'orgue", "L'accordéon", "Le piano", "Le synthétiseur"], answer: 2 },
      { q: "Quelle est la capitale de l'Espagne ?", choices: ["Barcelone", "Séville", "Madrid", "Valence"], answer: 2 },
      { q: "Quel est l'élément le plus abondant dans l'air ?", choices: ["Oxygène", "Azote", "Argon", "Carbone"], answer: 1 },
      { q: "Tous les combien d'années ont lieu les Jeux olympiques d'été ?", choices: ["2 ans", "3 ans", "4 ans", "5 ans"], answer: 2 },
      { q: "Quel est le plus grand mammifère du monde ?", choices: ["L'éléphant d'Afrique", "La baleine bleue", "La girafe", "Le cachalot"], answer: 1 }
    ]
  }

  // ---- Exemple pour ajouter un thème basé sur un cours ----
  // , histoire: {
  //   name: "Histoire - Chapitre 1",
  //   icon: "📜",
  //   questions: [
  //     { q: "...", choices: ["A", "B", "C", "D"], answer: 0 }
  //   ]
  // }
};
