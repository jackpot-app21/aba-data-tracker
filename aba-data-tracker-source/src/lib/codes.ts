// Genera un codice pseudonimo per un bambino: nessun collegamento con dati
// anagrafici reali, solo lettere/numeri non ambigui.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateChildCode(length = 5): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}
