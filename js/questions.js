// =========================================================
//  BANQUE DE QUESTIONS
//  Pour ajouter un thème : ajoute une entrée dans THEMES.
//  Chaque question : { q: "texte", choices: [4 réponses], answer: index (0 à 3), explain: "explication" }
// =========================================================

const THEMES = {
  culture: {
    name: "Culture générale",
    icon: "🌍",
    questions: [
      { q: "Quelle est la capitale de l'Australie ?", choices: ["Sydney", "Melbourne", "Canberra", "Perth"], answer: 2,
        explain: "Sydney est la plus grande ville, mais Canberra a été construite pour être la capitale, comme compromis entre Sydney et Melbourne." },
      { q: "Combien de continents compte-t-on généralement ?", choices: ["5", "6", "7", "8"], answer: 2,
        explain: "On compte généralement 7 continents : Afrique, Amérique du Nord, Amérique du Sud, Antarctique, Asie, Europe et Océanie." },
      { q: "Qui a peint « La Joconde » ?", choices: ["Michel-Ange", "Léonard de Vinci", "Raphaël", "Botticelli"], answer: 1,
        explain: "La Joconde a été peinte par Léonard de Vinci au début du XVIe siècle. Elle est exposée au musée du Louvre à Paris." },
      { q: "Quel est le plus grand océan du monde ?", choices: ["Atlantique", "Indien", "Arctique", "Pacifique"], answer: 3,
        explain: "Le Pacifique est le plus grand océan : il couvre environ un tiers de la surface de la Terre." },
      { q: "En quelle année a eu lieu la prise de la Bastille ?", choices: ["1789", "1792", "1776", "1815"], answer: 0,
        explain: "La Bastille a été prise le 14 juillet 1789, au début de la Révolution française. C'est devenu la fête nationale." },
      { q: "Quelle planète est surnommée la « planète rouge » ?", choices: ["Vénus", "Jupiter", "Mars", "Saturne"], answer: 2,
        explain: "Mars est rouge à cause de l'oxyde de fer (la rouille) présent dans son sol." },
      { q: "Quel est le symbole chimique de l'or ?", choices: ["Or", "Au", "Ag", "Go"], answer: 1,
        explain: "Le symbole de l'or est Au, du latin « aurum ». Ag est l'argent (argentum)." },
      { q: "Combien de joueurs compte une équipe de football sur le terrain ?", choices: ["9", "10", "11", "12"], answer: 2,
        explain: "Une équipe de football compte 11 joueurs sur le terrain, gardien compris." },
      { q: "Qui a écrit « Les Misérables » ?", choices: ["Émile Zola", "Victor Hugo", "Gustave Flaubert", "Honoré de Balzac"], answer: 1,
        explain: "« Les Misérables » est un roman de Victor Hugo publié en 1862." },
      { q: "Quel est le plus long fleuve de France ?", choices: ["La Seine", "Le Rhône", "La Garonne", "La Loire"], answer: 3,
        explain: "La Loire est le plus long fleuve de France avec environ 1 000 km." },
      { q: "Quelle est la langue la plus parlée au Brésil ?", choices: ["Espagnol", "Portugais", "Français", "Anglais"], answer: 1,
        explain: "Le Brésil a été colonisé par le Portugal : on y parle portugais, contrairement à ses voisins hispanophones." },
      { q: "Combien d'os compte le squelette d'un adulte ?", choices: ["186", "206", "226", "256"], answer: 1,
        explain: "Un adulte a 206 os. Un bébé en a davantage (environ 300), certains se soudent en grandissant." },
      { q: "Quel pays a offert la statue de la Liberté aux États-Unis ?", choices: ["Royaume-Uni", "Espagne", "France", "Italie"], answer: 2,
        explain: "La France a offert la statue de la Liberté aux États-Unis en 1886 pour le centenaire de leur indépendance." },
      { q: "Quel est l'animal terrestre le plus rapide ?", choices: ["Le lion", "Le guépard", "L'antilope", "Le lévrier"], answer: 1,
        explain: "Le guépard peut dépasser 100 km/h en pointe sur de courtes distances." },
      { q: "Quelle est la monnaie du Japon ?", choices: ["Le yuan", "Le won", "Le yen", "Le baht"], answer: 2,
        explain: "La monnaie du Japon est le yen. Le yuan est chinois, le won coréen et le baht thaïlandais." },
      { q: "Qui a formulé la théorie de la relativité ?", choices: ["Isaac Newton", "Albert Einstein", "Niels Bohr", "Galilée"], answer: 1,
        explain: "Albert Einstein a publié la relativité restreinte en 1905 puis la relativité générale en 1915." },
      { q: "Quelle est la plus haute montagne du monde ?", choices: ["K2", "Mont Blanc", "Kilimandjaro", "Everest"], answer: 3,
        explain: "L'Everest culmine à environ 8 849 m, dans l'Himalaya. Le K2 est le deuxième plus haut sommet." },
      { q: "Combien de côtés possède un hexagone ?", choices: ["5", "6", "7", "8"], answer: 1,
        explain: "Un hexagone a 6 côtés (« hexa » = six en grec). La France est surnommée l'Hexagone." },
      { q: "Dans quelle ville se trouve le Colisée ?", choices: ["Athènes", "Rome", "Naples", "Florence"], answer: 1,
        explain: "Le Colisée est un amphithéâtre de la Rome antique, inauguré en l'an 80." },
      { q: "Quel gaz les plantes absorbent-elles pour la photosynthèse ?", choices: ["Oxygène", "Azote", "Dioxyde de carbone", "Hydrogène"], answer: 2,
        explain: "Les plantes absorbent du dioxyde de carbone (CO2) et rejettent de l'oxygène grâce à la photosynthèse." },
      { q: "Qui fut le premier homme à marcher sur la Lune ?", choices: ["Buzz Aldrin", "Youri Gagarine", "Neil Armstrong", "John Glenn"], answer: 2,
        explain: "Neil Armstrong a posé le pied sur la Lune le 21 juillet 1969 (mission Apollo 11), suivi de Buzz Aldrin." },
      { q: "Quel est le plus grand pays du monde par sa superficie ?", choices: ["Canada", "Chine", "États-Unis", "Russie"], answer: 3,
        explain: "La Russie est le plus grand pays du monde avec environ 17 millions de km²." },
      { q: "Combien de temps met la lumière du Soleil pour atteindre la Terre (environ) ?", choices: ["8 secondes", "8 minutes", "8 heures", "1 jour"], answer: 1,
        explain: "La lumière du Soleil met environ 8 minutes et 20 secondes pour arriver jusqu'à la Terre." },
      { q: "Quel compositeur est devenu sourd mais a continué à composer ?", choices: ["Mozart", "Bach", "Beethoven", "Chopin"], answer: 2,
        explain: "Beethoven est devenu progressivement sourd mais a continué à composer, notamment sa 9e symphonie." },
      { q: "Quelle est la capitale du Canada ?", choices: ["Toronto", "Ottawa", "Montréal", "Vancouver"], answer: 1,
        explain: "La capitale du Canada est Ottawa, même si Toronto et Montréal sont plus grandes." },
      { q: "Quel organe pompe le sang dans le corps humain ?", choices: ["Le foie", "Les poumons", "Le cœur", "Les reins"], answer: 2,
        explain: "Le cœur est un muscle qui pompe le sang dans tout le corps, environ 100 000 battements par jour." },
      { q: "En quelle année a pris fin la Seconde Guerre mondiale ?", choices: ["1918", "1939", "1945", "1950"], answer: 2,
        explain: "La Seconde Guerre mondiale s'est terminée en 1945 (8 mai en Europe, 2 septembre en Asie)." },
      { q: "Quel est le plus grand désert chaud du monde ?", choices: ["Gobi", "Kalahari", "Sahara", "Atacama"], answer: 2,
        explain: "Le Sahara est le plus grand désert chaud. L'Antarctique est le plus grand désert si l'on compte les déserts froids." },
      { q: "Combien y a-t-il de minutes dans une journée ?", choices: ["1 140", "1 440", "1 400", "2 400"], answer: 1,
        explain: "24 heures × 60 minutes = 1 440 minutes dans une journée." },
      { q: "Quel écrivain a créé le personnage de Sherlock Holmes ?", choices: ["Agatha Christie", "Arthur Conan Doyle", "Edgar Allan Poe", "Jules Verne"], answer: 1,
        explain: "Sherlock Holmes a été créé par l'écrivain écossais Arthur Conan Doyle en 1887." },
      { q: "Quelle est la formule chimique de l'eau ?", choices: ["CO2", "H2O", "O2", "NaCl"], answer: 1,
        explain: "L'eau, c'est H2O : deux atomes d'hydrogène et un atome d'oxygène." },
      { q: "Quel pays est célèbre pour ses pyramides de Gizeh ?", choices: ["Mexique", "Pérou", "Égypte", "Soudan"], answer: 2,
        explain: "Les pyramides de Gizeh se trouvent en Égypte, près du Caire." },
      { q: "Quel est le plus petit pays du monde ?", choices: ["Monaco", "Vatican", "Saint-Marin", "Liechtenstein"], answer: 1,
        explain: "Le Vatican est le plus petit pays du monde : moins d'un demi-km², à l'intérieur de Rome." },
      { q: "Combien de couleurs compte un arc-en-ciel traditionnellement ?", choices: ["5", "6", "7", "8"], answer: 2,
        explain: "L'arc-en-ciel compte traditionnellement 7 couleurs : rouge, orange, jaune, vert, bleu, indigo, violet." },
      { q: "Qui a inventé l'ampoule électrique à incandescence commercialisée ?", choices: ["Nikola Tesla", "Thomas Edison", "Graham Bell", "Louis Pasteur"], answer: 1,
        explain: "Thomas Edison a mis au point en 1879 une ampoule à incandescence durable et commercialisable." },
      { q: "Quel instrument possède 88 touches ?", choices: ["L'orgue", "L'accordéon", "Le piano", "Le synthétiseur"], answer: 2,
        explain: "Un piano standard a 88 touches : 52 blanches et 36 noires." },
      { q: "Quelle est la capitale de l'Espagne ?", choices: ["Barcelone", "Séville", "Madrid", "Valence"], answer: 2,
        explain: "La capitale de l'Espagne est Madrid, au centre du pays." },
      { q: "Quel est l'élément le plus abondant dans l'air ?", choices: ["Oxygène", "Azote", "Argon", "Carbone"], answer: 1,
        explain: "L'air est composé d'environ 78 % d'azote et 21 % d'oxygène." },
      { q: "Tous les combien d'années ont lieu les Jeux olympiques d'été ?", choices: ["2 ans", "3 ans", "4 ans", "5 ans"], answer: 2,
        explain: "Les Jeux olympiques d'été ont lieu tous les 4 ans." },
      { q: "Quel est le plus grand mammifère du monde ?", choices: ["L'éléphant d'Afrique", "La baleine bleue", "La girafe", "Le cachalot"], answer: 1,
        explain: "La baleine bleue est le plus grand animal ayant jamais existé : jusqu'à 30 m de long." }
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
