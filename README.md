# 🧠 Quiz Culture G

Jeu de questions à 4 réponses, jouable dans le navigateur.

- Mode **solo**
- Mode **même appareil** (2 à 8 joueurs, chacun son tour)
- Mode **en ligne** 🌐 : chacun sur son ordi/téléphone. Un joueur crée une salle (code à 5 lettres + lien à partager), les autres la rejoignent. Les messages passent par un serveur relais public gratuit (MQTT sur WebSocket : EMQX, puis HiveMQ ou Mosquitto en secours), ce qui marche sur tous les réseaux. Aucun serveur à installer.
- Choix du **nombre de questions** et du **temps par question**
- **100 points** par bonne réponse + jusqu'à **50 points de bonus** de rapidité
- **Podium**, résultats de la partie et **classement général** (sauvegardé dans le navigateur)

## Thèmes
- **Culture générale** : `js/questions.js`
- **CEJM (BTS)** : un fichier par chapitre dans `js/themes/cejm/ch01.js` … `ch20.js`.
  Les thèmes « Tout le programme », « BTS1 », « BTS2 », « Économie », « Droit » et « Management » sont construits automatiquement (`build.js`).

## Ajouter des questions
Dans le fichier du chapitre, ajoute une entrée dans `questions` :
```js
{ q: "La question ?", choices: ["Bonne réponse", "B", "C", "D"], answer: 0, explain: "Explication affichée en cas d'erreur" }
```
La position de la bonne réponse (A, B, C ou D) est tirée au hasard et équilibrée à chaque partie.
