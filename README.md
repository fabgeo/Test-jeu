# 🧠 Quiz Culture G

Jeu de questions à 4 réponses, jouable dans le navigateur.

- Mode **solo** ou **multijoueur** (2 à 8 joueurs sur le même appareil, chacun son tour)
- Choix du **nombre de questions** et du **temps par question**
- **100 points** par bonne réponse + jusqu'à **50 points de bonus** de rapidité
- **Podium**, résultats de la partie et **classement général** (sauvegardé dans le navigateur)

## Ajouter un thème
Ouvre `js/questions.js` et ajoute une entrée dans `THEMES` :
```js
monTheme: {
  name: "Mon cours",
  icon: "📚",
  questions: [
    { q: "La question ?", choices: ["A", "B", "C", "D"], answer: 0 } // answer = index de la bonne réponse
  ]
}
```
