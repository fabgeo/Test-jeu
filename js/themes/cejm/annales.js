// =========================================================
//  CEJM – Section spéciale « Annales BTS »
//  Notions des chapitres 1 à 13 demandées dans les sujets de BTS CEJM
//  2024 (Notarius), 2025 (Tout en perles) et 2026 (Savonnerie du Paradou).
//  Uniquement des notions présentes dans les cours de l'élève.
//  Format QCM : { q, choices: [bonne réponse en 1er, puis 3 pièges], answer: 0, explain }
//  (les positions des réponses sont mélangées automatiquement par le jeu)
// =========================================================
(() => {
  const S = (annee, cas) => `[Sujet ${annee} – ${cas}] `;
  const N24 = S(2024, "Notarius"), T25 = S(2025, "Tout en perles"), P26 = S(2026, "Savonnerie du Paradou");

  const questions = [
    // ---------- Marché (ch. 2) ----------
    { q: T25 + "Pour « présenter un marché », par quelle définition commence-t-on ?",
      choices: ["Un lieu de rencontre qui ajuste l'offre et la demande grâce au prix", "Le lieu où les entreprises fixent seules leurs prix sans tenir compte des clients", "L'ensemble des clients actuels d'une entreprise sur un territoire donné", "L'ensemble des entreprises qui fabriquent le même produit dans un pays"], answer: 0,
      explain: "Corrigé 2025 : on définit le marché (offre, demande, prix), puis on présente les offreurs, les demandeurs et les produits avec des chiffres." },
    { q: T25 + "Pour présenter un marché, quels éléments analyse-t-on ?",
      choices: ["Les offreurs, les demandeurs et les produits, chiffres à l'appui", "Uniquement le chiffre d'affaires réalisé par l'entreprise étudiée", "Uniquement les prix pratiqués par le leader du marché et ses rivaux", "Uniquement la réglementation qui s'applique aux produits vendus en ligne"], answer: 0,
      explain: "Méthode : l'offre (concurrents, leaders, canaux de vente), la demande (profil, évolution) et les produits, toujours chiffrés." },
    { q: N24 + "Le marché des logiciels pour notaires demande une grande technicité juridique et informatique. C'est…",
      choices: ["Une barrière à l'entrée qui freine l'arrivée de nouveaux concurrents", "Une externalité négative imposée par les notaires aux éditeurs de logiciels", "Une asymétrie d'information au détriment des clients de l'entreprise", "Une entente illicite entre les trois éditeurs présents sur ce marché"], answer: 0,
      explain: "Q 2.1 du sujet 2024 : caractériser les barrières à l'entrée (coûts élevés, technicité, comportements stratégiques…)." },
    { q: N24 + "Lequel de ces éléments est un comportement stratégique qui crée une barrière à l'entrée ?",
      choices: ["Les entreprises déjà en place différencient leurs produits", "Une forte hausse de la demande attire de nouveaux concurrents", "L'État supprime une réglementation qui protégeait ce secteur", "Les prix baissent fortement pendant une période de surproduction"], answer: 0,
      explain: "Ton cours : les entreprises en place peuvent bloquer l'entrée en contrôlant la distribution ou en différenciant leurs produits." },

    // ---------- Logiques (ch. 4) ----------
    { q: T25 + "Dominique Partol a eu une idée innovante, a saisi une opportunité et a investi 10 000 € de sa poche. Cela montre une logique…",
      choices: ["Entrepreneuriale : opportunités et prise de risques", "Managériale : allocation optimale des ressources au quotidien", "Collaborative : partage de toutes les décisions avec les salariés", "Administrative : application stricte des règles et des procédures"], answer: 0,
      explain: "Q 1.2 du sujet 2025. Logique entrepreneuriale = recherche d'opportunités + prise de risques." },
    { q: T25 + "Dominique gère lui-même ses 15 salariés et ses 50 000 références au quotidien. Cela montre une logique…",
      choices: ["Managériale : gestion courante des ressources", "Entrepreneuriale : recherche permanente de nouvelles opportunités", "Spéculative : recherche d'une plus-value rapide à la revente", "Sociétale : priorité absolue donnée aux impacts sur l'environnement"], answer: 0,
      explain: "Logique managériale = allocation optimale des ressources, décisions de gestion courante, continuité d'exploitation." },

    // ---------- Concurrence et droit (ch. 7) ----------
    { q: N24 + "Quels sont les 3 éléments à prouver pour agir en concurrence déloyale ?",
      choices: ["Une faute, un préjudice et un lien de causalité", "Un contrat, une inexécution et une mise en demeure du débiteur", "Une infraction, une plainte et une condamnation pénale définitive", "Une position dominante, un abus et un effet sur la concurrence"], answer: 0,
      explain: "Annexe 2 du sujet 2024 et ton cours : responsabilité délictuelle (art. 1240) = comportement fautif + dommage + lien de causalité." },
    { q: N24 + "Un nouvel entrant prend le nom « Notar@us », très proche de « Notarius ». Quel comportement déloyal est en cause ?",
      choices: ["La confusion", "La désorganisation", "Le dénigrement", "La revente à perte"], answer: 0,
      explain: "Un nom presque identique crée une confusion dans l'esprit des clients (imitation / confusion)." },
    { q: N24 + "Les avis négatifs sur Notar@us peuvent nuire à Notarius à cause de la confusion des noms. Quel est le préjudice ?",
      choices: ["Une atteinte à l'image et une perte de clientèle", "La nullité de tous les contrats signés avec les notaires clients", "L'obligation de baisser ses prix en dessous du prix d'achat effectif", "La perte automatique de sa marque déposée auprès de l'INPI"], answer: 0,
      explain: "Ton cours : perte de clientèle, atteinte à l'image, baisse du chiffre d'affaires." },
    { q: P26 + "Trois savonneries concurrentes s'associent dans un projet commun. Quelle règle de ton cours encadre les ententes ?",
      choices: ["Elles sont interdites par l'article L420-1 du Code de commerce", "Elles sont toujours libres entre membres d'un même syndicat professionnel", "Elles sont autorisées dès que l'accord est signé par écrit", "Elles sont interdites seulement entre entreprises étrangères"], answer: 0,
      explain: "Ton cours : les ententes (horizontales ou verticales) sont interdites par l'article L420-1, car elles nuisent souvent aux consommateurs." },
    { q: P26 + "Une entente entre savonneries concurrentes (même niveau) est une entente…",
      choices: ["Horizontale", "Verticale", "Transversale", "Diagonale"], answer: 0,
      explain: "Horizontale = entre concurrents. Verticale = entre un fournisseur et un distributeur." },

    // ---------- Facteurs de production (ch. 9) ----------
    { q: P26 + "La savonnerie automatise sa production (robot, machines numériques) et passe de 50 à 45 salariés. Il s'agit…",
      choices: ["D'une substitution du capital au travail", "D'une substitution du travail au capital", "D'une suppression de la combinaison productive", "D'un simple investissement de renouvellement"], answer: 0,
      explain: "Q 1.2 du sujet 2026 : les facteurs sont substituables dans l'industrie. On remplace ici du travail par du capital." },
    { q: P26 + "Quelle conséquence économique positive peut avoir cette automatisation ?",
      choices: ["Des gains de productivité", "Une hausse des coûts de personnel", "Une baisse du prix de l'huile achetée", "La disparition de tous les coûts fixes"], answer: 0,
      explain: "Produire plus avec moins de travail = gains de productivité. Attention : les machines augmentent les coûts fixes." },

    // ---------- Structure juridique (ch. 10) ----------
    { q: P26 + "Les dirigeantes veulent préserver leur patrimoine personnel. Dans une société (SARL, SAS…), les créanciers peuvent-ils saisir les biens personnels des associés ?",
      choices: ["Non, la société a son propre patrimoine", "Oui, toujours, dès le premier impayé", "Oui, mais seulement pour les dettes fiscales", "Non, sauf si la société a moins de 10 salariés"], answer: 0,
      explain: "Ton cours : la société a un patrimoine propre. Exception : le dirigeant, en cas de faute de gestion liée au passif." },
    { q: P26 + "Selon ton cours, quelle forme de société permet l'appel public à l'épargne (entrée en Bourse) ?",
      choices: ["La SA", "La SARL", "L'EURL", "La Scop"], answer: 0,
      explain: "Seule la société anonyme (SA) permet une introduction en Bourse." },

    // ---------- Responsabilité (ch. 11) ----------
    { q: T25 + "Un client fait une réaction allergique à une colle vendue dans un kit. Quel régime de responsabilité étudie-t-on ?",
      choices: ["Les produits défectueux (art. 1245)", "La responsabilité contractuelle pour retard de livraison", "La responsabilité pénale pour concurrence déloyale", "La responsabilité de l'entreprise du fait de ses salariés"], answer: 0,
      explain: "Q 2.3 du sujet 2025 : article 1245 du Code civil, le producteur répond du défaut de son produit." },
    { q: T25 + "Dominique vend la colle sans la fabriquer, et le nom du fabricant est sur le tube. Que peut-il invoquer ?",
      choices: ["Le producteur est identifié : c'est lui qui répond", "Le client a un contrat avec lui, donc ce régime ne s'applique pas", "Un produit défectueux engage toujours tous les vendeurs", "Le délai pour agir est dépassé au bout d'une semaine"], answer: 0,
      explain: "Ton cours : le distributeur ou le fournisseur ne répond que si le producteur ne peut pas être identifié." },
    { q: T25 + "Un produit est défectueux quand…",
      choices: ["Il n'offre pas la sécurité qu'on peut légitimement attendre", "Il ne plaît pas au client après réception et première utilisation", "Il est vendu plus cher que chez les principaux concurrents directs", "Il est livré après le délai de 30 jours prévu pour la vente en ligne"], answer: 0,
      explain: "Ton cours : le défaut de sécurité peut venir du produit lui-même ou de sa présentation." },

    // ---------- Ressources (ch. 12) ----------
    { q: N24 + "Pour le diagnostic interne de Notarius, comment classe-t-on « la réputation de son SAV » ?",
      choices: ["Ressource intangible", "Ressource tangible", "Ressource financière", "Ressource matérielle"], answer: 0,
      explain: "Intangibles : réputation, marque, culture, savoir-faire. Tangibles : locaux, machines, stocks, fonds." },
    { q: N24 + "Les 2 ordinateurs par salarié et les véhicules de fonction de Notarius sont des ressources…",
      choices: ["Tangibles", "Intangibles", "Collectives", "Culturelles"], answer: 0,
      explain: "Ressources tangibles = celles qu'on peut toucher : matériel, locaux, stocks, argent." },
    { q: P26 + "Le savoir-faire très rare du Maître Savonnier est une ressource stratégique, car…",
      choices: ["Elle est difficile à imiter", "Elle s'achète facilement sur le marché", "Elle figure à l'actif comme une machine", "Elle ne demande aucune formation"], answer: 0,
      explain: "Ton cours : les ressources intangibles, difficiles à identifier et à imiter, fondent un avantage concurrentiel durable." },
    { q: N24 + "Les compétences individuelles des développeurs de Notarius regroupent…",
      choices: ["Savoir, savoir-faire et savoir-être", "Salaire, statut et ancienneté", "Locaux, matériel et logiciels", "Diplôme, âge et expérience"], answer: 0,
      explain: "Savoir (connaissances), savoir-faire (habiletés pratiques), savoir-être (comportements). Ils se développent par la formation." },

    // ---------- Financement (ch. 13) ----------
    { q: N24 + "Notarius veut réduire les délais de paiement de ses clients de 60 à 30 jours. Quel est l'effet sur le BFR ?",
      choices: ["Le BFR baisse", "Le BFR augmente", "Le BFR ne change pas", "Le BFR devient égal au capital"], answer: 0,
      explain: "Q 3.2 du sujet 2024 : les clients paient plus tôt, donc le besoin de financement diminue (1 des 3 leviers)." },
    { q: N24 + "Notarius veut rester une entreprise familiale. Quelle solution de financement respecte cette volonté ?",
      choices: ["Un emprunt bancaire", "Une augmentation de capital", "Une entrée en Bourse", "L'arrivée d'un nouvel associé"], answer: 0,
      explain: "Q 3.3 du sujet 2024 : l'emprunt ne fait pas entrer de nouveaux associés. Une augmentation de capital donne une part du contrôle aux investisseurs." },
    { q: N24 + "Notarius innove pour se démarquer de concurrents plus puissants, sans miser sur le prix. Quelle stratégie l'investissement de modernisation sert-il ?",
      choices: ["La différenciation", "La domination par les coûts", "L'internationalisation", "La diversification"], answer: 0,
      explain: "Ton cours : modernisation (innovation, qualité) = différenciation ; productivité = domination par les coûts." },
  ];

  // Mode difficile : réponses courtes
  const short = [
    [N24 + "Quels sont les 3 éléments à prouver en concurrence déloyale ?", ["faute préjudice lien de causalité", "faute dommage lien de causalité", "fait générateur dommage lien de causalité"], "Comportement fautif + dommage + lien de causalité (art. 1240)."],
    [N24 + "Comment s'appellent les obstacles qui empêchent de nouveaux concurrents d'entrer sur un marché ?", ["barrières à l'entrée", "barrière à l'entrée"], "Barrières à l'entrée : coûts élevés, technicité, comportements stratégiques."],
    [N24 + "Raccourcir les délais clients fait baisser quel indicateur de financement ?", ["BFR", "besoin en fonds de roulement"], "Les 3 leviers du BFR : délais clients, délais fournisseurs, stocks."],
    [N24 + "Quelle stratégie consiste à proposer un produit différent ou de meilleure qualité que les concurrents ?", ["différenciation", "la différenciation"], "Investissement de modernisation (innovation, qualité) = différenciation."],
    [T25 + "Article du Code civil sur la responsabilité du fait des produits défectueux ?", ["1245", "article 1245"], "Article 1245 du Code civil."],
    [T25 + "Quelle logique repose sur la recherche d'opportunités et la prise de risques ?", ["logique entrepreneuriale", "entrepreneuriale"], "Logique entrepreneuriale. La logique managériale gère les ressources au quotidien."],
    [T25 + "Le marché ajuste l'offre et la demande grâce à quoi ?", ["prix", "le prix"], "Le marché est un lieu de rencontre qui ajuste l'offre et la demande grâce au prix."],
    [P26 + "Article du Code de commerce qui interdit les ententes ?", ["L420-1", "L 420-1", "article L420-1"], "Article L420-1 du Code de commerce."],
    [P26 + "La savonnerie remplace des salariés par des robots : quel facteur de production augmente ?", ["capital", "le capital", "facteur capital"], "Substitution du capital au travail : gains de productivité, mais coûts fixes plus élevés."],
    [P26 + "Une ressource qu'on ne peut pas toucher (réputation, savoir-faire) est une ressource… ?", ["intangible", "immatérielle"], "Ressources intangibles (Penrose) : difficiles à imiter, source d'avantage concurrentiel."],
  ].map(([q, a, explain]) => ({ q, a, explain }));

  THEMES["cejm-annales"] = {
    group: "CEJM – Annales BTS",
    name: "Sujets 2024 à 2026 (notions BTS1)",
    icon: "📝",
    questions,
    short,
  };
})();
