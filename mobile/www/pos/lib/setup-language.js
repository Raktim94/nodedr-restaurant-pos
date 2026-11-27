// Only the offline account and regional settings forms use this catalog.
export const setupLanguage = /^it(?:-|$)/i.test(navigator.language) ? 'it' : 'en';

const italian = {
  'Create your account': 'Crea il tuo account',
  'No server needed. Your menu and sales stay on this phone. You can connect a restaurant server later and your sales will be sent to it.': 'Menu e vendite restano su questo telefono. Puoi iniziare senza un server e collegarti in seguito a quello del ristorante per inviare le vendite.',
  'Your name': 'Il tuo nome',
  '(optional)': '(facoltativo)',
  'Restaurant or shop name': 'Nome del ristorante o del negozio',
  '(at least 6 characters)': '(almeno 6 caratteri)',
  'Create account and start': 'Crea account e inizia',
  'I already have a server': 'Ho già un server',
  'Country code': 'Codice paese',
  'e.g. BR': 'ad es. IT',
  'Currency': 'Valuta',
  'e.g. BRL': 'ad es. EUR',
  'Time zone': 'Fuso orario',
  'e.g. America/Sao_Paulo': 'ad es. Europe/Rome',
  'UPI id': 'ID UPI',
  '(optional, for Scan to pay)': '(facoltativo, per pagare tramite QR)',
  'name@bank': 'nome@banca',
  'Shop settings': 'Impostazioni del negozio',
  'Regional settings': 'Impostazioni regionali',
  'Save regional settings': 'Salva impostazioni regionali',
  'Regional settings saved.': 'Impostazioni regionali salvate.',
  'Change the restaurant’s regional settings.': 'Modifica le impostazioni regionali del ristorante.',
  'Enter your name.': 'Inserisci il tuo nome.',
  'Enter the name of your restaurant or shop.': 'Inserisci il nome del ristorante o del negozio.',
  'Choose a password of at least 6 characters.': 'Scegli una password di almeno 6 caratteri.',
  'That email address does not look right.': 'Inserisci un indirizzo email valido.',
  'Enter a two-letter country code, for example BR or IN.': 'Inserisci un codice paese di due lettere, ad esempio IT o CH.',
  'Enter a valid currency code, for example BRL or EUR.': 'Inserisci un codice valuta valido, ad esempio EUR o CHF.',
  'Enter a time zone, for example America/Sao_Paulo.': 'Inserisci un fuso orario, ad esempio Europe/Rome.',
  'Enter a valid time zone, for example America/Sao_Paulo.': 'Inserisci un fuso orario valido, ad esempio Europe/Rome.',
  'A UPI id looks like name@bank.': 'Un ID UPI ha il formato nome@banca.',
  'Change the regional settings on your restaurant server.': 'Modifica le impostazioni regionali sul server del ristorante.',
};

export function setupText(english) {
  return setupLanguage === 'it' && Object.hasOwn(italian, english) ? italian[english] : english;
}
