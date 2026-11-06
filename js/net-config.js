// =========================================================
//  Configuration réseau commune au jeu (online.js) et à la page admin (admin.js)
// =========================================================
const NET = {
  // Préfixe des sujets MQTT de ce jeu
  ROOT: "quiz-revisions-fabgeo/v3/",
  // Relais publics essayés dans l'ordre
  BROKERS: [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/mqtt",
  ],
  // Clé PUBLIQUE de l'administrateur : le jeu n'accepte que les commandes signées avec la clé privée
  // correspondante (stockée chiffrée par mot de passe dans admin.html). Elle ne permet pas de signer.
  ADMIN_PUBLIC_JWK: {"kty":"EC","crv":"P-256","x":"2--B136yGHjVqctaEejH6Ulkibme47SwpHXO29sanGU","y":"RZtF_W5cXXm2TpAacS6m8x18q760eoJd9VWEFMsVbTM"},
};
