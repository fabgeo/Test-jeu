# 🧠 Quiz Culture G

Jeu de questions à 4 réponses, jouable dans le navigateur.

- Mode **solo**
- Mode **même appareil** (2 à 8 joueurs, chacun son tour)
- Mode **en ligne** 🌐 : chacun sur son ordi/téléphone. Un joueur crée une salle (code à 5 lettres + lien à partager), les autres la rejoignent. Connexion directe entre navigateurs (PeerJS / WebRTC), aucun serveur à installer.
- Choix du **nombre de questions** et du **temps par question**
- **100 points** par bonne réponse + jusqu'à **50 points de bonus** de rapidité
- **Podium**, résultats de la partie et **classement général** (sauvegardé dans le navigateur)

## Ajouter un thème
Thèmes disponibles : Culture générale (`js/questions.js`), CEJM – Fiche 1 (`js/themes/cejm.js`).

Pour un nouveau thème, crée un fichier dans `js/themes/` (et ajoute-le dans `index.html`) ou ajoute une entrée dans `THEMES` :
```js
monTheme: {
  name: "Mon cours",
  icon: "📚",
  questions: [
    { q: "La question ?", choices: ["A", "B", "C", "D"], answer: 0 } // answer = index de la bonne réponse
  ]
}
```
