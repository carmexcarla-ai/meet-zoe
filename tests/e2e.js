const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
// Tests de bout en bout de Meet Zoe. Mode d'emploi : tests/README.md.
const { createClient } = require(process.env.SUPABASE_JS || '@supabase/supabase-js');
const CAPTURES = path.join(__dirname, 'captures');
fs.mkdirSync(CAPTURES, { recursive: true });
process.chdir(CAPTURES);
const JUSTIF = path.join(__dirname, 'justif.pdf');
const BOITE = 'http://127.0.0.1:8777';
const emails = async () => (await fetch(BOITE + '/')).json();
const BASE = 'http://127.0.0.1:8766', URL_SB = 'http://127.0.0.1:54321';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const COMMUNES = { 'Évreux': [1.1508, 49.0241, '27000'], 'Vernon': [1.4856, 49.0929, '27200'], 'Pacy-sur-Eure': [1.3811, 49.0166, '27120'], 'Bernay': [0.5986, 49.0886, '27300'] };
const sql = (q) => execSync(`PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -At -q -c "${q}" 2>/dev/null`).toString().trim();
sql('delete from auth.users; truncate etablissements, demandes_contact, journal_admin, adresses_bloquees, erreurs_client cascade; set session_replication_role = replica; delete from storage.objects');
const run = Date.now();
const mail = (n) => `${n.toLowerCase()}.${run}@test.fr`;
let ok = 0, ko = 0;
const check = (nom, cond, extra = '') => { cond ? ok++ : ko++; console.log(`${cond ? 'OK ' : 'ECHEC'} ${nom} ${cond ? '' : extra}`); };
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

(async () => {
  const browser = await chromium.launch();
  const erreurs = [];
  async function ouvrir() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('https://geo.api.gouv.fr/**', (r) => {
      const q = norm(new URL(r.request().url()).searchParams.get('nom'));
      const res = Object.entries(COMMUNES).filter(([n]) => norm(n).startsWith(q)).map(([nom, [lng, lat, cp]]) => ({ nom, codesPostaux: [cp], centre: { type: 'Point', coordinates: [lng, lat] } }));
      r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(res) });
    });
    await ctx.route('https://fonts.g**', (r) => r.abort());
    // Service d'adresses simulé : les communes de test, plus une adresse précise.
    await ctx.route('https://data.geopf.fr/**', async (r) => {
      const q = norm(new URL(r.request().url()).searchParams.get('q'));
      if (q.startsWith('pann')) return r.abort();   // simule une panne du service
      if (q.startsWith('lent')) await new Promise((x) => setTimeout(x, 900));
      const features = Object.entries(COMMUNES).filter(([n]) => norm(n).startsWith(q) || q.startsWith('lent')).map(([nom, [lng, lat, cp]]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { label: nom, name: nom, city: nom, postcode: cp, type: 'municipality', context: '27, Eure' } }));
      if (q.startsWith('44')) features.unshift({ type: 'Feature', geometry: { type: 'Point', coordinates: [1.14273, 49.02687] }, properties: { label: '44 Rue Joséphine 27000 Évreux', name: '44 Rue Joséphine', city: 'Évreux', postcode: '27000', type: 'housenumber', context: '27, Eure, Normandie' } });
      r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features }) });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => erreurs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) erreurs.push(m.text()); });
    return page;
  }
  const commune = async (page, sel, nom) => { await page.fill(sel, nom.slice(0, 4)); await page.click(`${sel} + .suggestions button:has-text("${nom}")`); };
  // Lit le code de confirmation dans la boîte e-mail de test.
  const codeEmail = async (email, apres = 0) => {
    for (let i = 0; i < 40; i++) {
      const liste = await (await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent('to:' + email)}`)).json();
      const msgs = (liste.messages || []).filter((m) => new Date(m.Created).getTime() > apres);
      if (msgs.length) { const m = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${msgs[0].ID}`)).json(); return { code: (m.Text.match(/\b\d{6}\b/) || [])[0], sujet: m.Subject, texte: m.Text }; }
      await new Promise((r) => setTimeout(r, 300));
    }
    return {};
  };
  // Répond à la fenêtre de question du site (Zoe.demander).
  const repondre = async (page, { texte, choix } = {}) => {
    const f = page.locator('dialog.question[open]'); await f.waitFor();
    if (choix) await f.locator('select').selectOption({ label: choix });
    if (texte) await f.locator('textarea').fill(texte);
    await f.locator('[type=submit]').click();
  };
  const toast = (page) => page.locator('.toast').last().textContent({ timeout: 8000 });
  async function inscrire(prenom, categorie = 'esi', conducteur = false) {
    const page = await ouvrir();
    await page.goto(`${BASE}/connexion.html#inscription`);
    const f = page.locator('#form-inscription');
    await f.locator('[name=prenom]').fill(prenom); await f.locator('[name=nom]').fill('Test');
    await f.locator('[name=email]').fill(mail(prenom)); await f.locator('[name=mdp]').fill('motdepasse123');
    await f.locator('[name=categorie]').selectOption(categorie); await f.locator('[name=etablissement]').fill("IFSI d'Évreux");
    if (conducteur) await f.locator('[name=conducteur][value=true]').check();
    await f.locator('[name=accord]').check(); await f.locator('[type=submit]').click();
    await page.waitForSelector('#form-code:not([hidden])');
    const { code: c } = await codeEmail(mail(prenom));
    await page.fill('#form-code [name=code]', c); await page.click('#form-code [type=submit]');
    await page.waitForURL('**/espace.html');
    return page;
  }
  const connecter = async (page, prenom) => {
    await page.goto(`${BASE}/connexion.html`);
    await page.waitForTimeout(1500);
    if (!page.url().includes('connexion.html')) return; // déjà connecté : redirigé
    await page.fill('#form-connexion [name=email]', mail(prenom)); await page.fill('#form-connexion [name=mdp]', 'motdepasse123');
    await page.click('#form-connexion [type=submit]');
  };

  // 1. Vitrine : formulaire de contact
  const vitrine = await ouvrir();
  await vitrine.goto(BASE + '/index.html');
  check('accueil: page resserrée (7 sections au plus)', await vitrine.locator('main > section').count() <= 7);
  await vitrine.goto(BASE + '/etablissements.html');
  await vitrine.fill('#contact [name=nom]', 'Mme Direction'); await vitrine.fill('#contact [name=email]', 'direction@ifsi.fr');
  await vitrine.fill('#contact [name=organisme]', 'IFSI Test'); await vitrine.click('#contact [type=submit]');
  await vitrine.waitForSelector('#message.ok');
  check('établissements: demande de contact enregistrée', sql("select count(*) from demandes_contact where organisme='IFSI Test'") >= 1);
  await vitrine.fill('#contact [name=nom]', 'Robot'); await vitrine.fill('#contact [name=email]', 'robot@spam.fr'); await vitrine.fill('#contact [name=organisme]', 'Spam SA');
  await vitrine.evaluate(() => { document.querySelector('[name=site_web]').value = 'http://spam'; }); await vitrine.click('#contact [type=submit]'); await vitrine.waitForTimeout(800);
  check('sécu: un robot qui remplit le champ piège n\'enregistre rien', sql("select count(*) from demandes_contact where organisme='Spam SA'") === '0');

  // 1 bis. Code de confirmation par e-mail
  {
    const p = await ouvrir(); await p.goto(`${BASE}/connexion.html#inscription`); const f = p.locator('#form-inscription');
    await f.locator('[name=prenom]').fill('Carl'); await f.locator('[name=nom]').fill('Test'); await f.locator('[name=email]').fill(mail('Carl')); await f.locator('[name=mdp]').fill('motdepasse123');
    await f.locator('[name=categorie]').selectOption('esi'); await f.locator('[name=etablissement]').fill('IFSI'); await f.locator('[name=accord]').check(); await f.locator('[type=submit]').click();
    await p.waitForSelector('#form-code:not([hidden])');
    const m1 = await codeEmail(mail('Carl'));
    console.log('   e-mail:', m1.sujet, '|', (m1.texte || '').replace(/\s+/g, ' ').slice(0, 150));
    check('code: e-mail en français avec un code à 6 chiffres', /^\d{6}$/.test(m1.code || '') && /Meet Zoe/.test(m1.sujet) && /valable une heure/.test(m1.texte));
    check('code: adresse affichée, pas de session avant confirmation', (await p.textContent('#code-email')) === mail('Carl') && sql(`select count(*) from auth.users where email='${mail('Carl')}' and email_confirmed_at is null`) === '1');
    await p.fill('#form-code [name=code]', '000000'); await p.click('#form-code [type=submit]');
    check('code: un mauvais code est refusé', /incorrect ou a expiré/.test(await toast(p)) && p.url().includes('connexion.html'));
    const t0 = Date.now(); await p.waitForTimeout(1500); await p.click('#renvoyer-code'); await p.waitForSelector('.toast:has-text("nouveau code")');
    const m2 = await codeEmail(mail('Carl'), t0);
    check('code: renvoi d\'un nouveau code', /^\d{6}$/.test(m2.code || ''));
    // connexion sans avoir confirmé : on retombe sur l'étape du code
    const q = await ouvrir(); await q.goto(`${BASE}/connexion.html`); await q.fill('#form-connexion [name=email]', mail('Carl')); await q.fill('#form-connexion [name=mdp]', 'motdepasse123');
    const t1 = Date.now(); await q.waitForTimeout(1500); await q.click('#form-connexion [type=submit]'); await q.waitForSelector('#form-code:not([hidden])');
    const m3 = await codeEmail(mail('Carl'), t1);
    check('code: connexion avant confirmation renvoie vers le code', /^\d{6}$/.test(m3.code || ''));
    await q.fill('#form-code [name=code]', m3.code); await q.click('#form-code [type=submit]'); await q.waitForURL('**/espace.html');
    check('code: bon code, compte confirmé et connecté', sql(`select count(*) from auth.users where email='${mail('Carl')}' and email_confirmed_at is not null`) === '1');
    await p.screenshot({ path: 'c-code.png' });
  }

  // 2. Admin
  const admin = await inscrire('Admin', 'pro_diplome');
  check('inscription: écran de vérification pour un non vérifié', await admin.locator('#verification').isVisible() && await admin.locator('#espace').isHidden());
  sql(`update profils set role='admin', statut='verifie', methode_verif='admin' where email='${mail('Admin')}'`);
  await connecter(admin, 'Admin'); await admin.waitForURL('**/admin.html');
  await admin.click('[data-onglet=etablissements]');
  await admin.fill('#form-etab [name=nom]', `IFSI Evreux ${run}`); await commune(admin, '#e-ville', 'Évreux');
  await admin.fill('#form-etab [name=quota]', '3'); await admin.click('#form-etab [type=submit]');
  await admin.waitForSelector(`#etablissements tr:has-text("IFSI Evreux ${run}")`);
  await admin.click(`#etablissements tr:has-text("IFSI Evreux ${run}") [data-action=code]`);
  await admin.waitForSelector('#codes-etab[open]'); await admin.fill('#codes-form [name=libelle]', 'Promotion 2026'); await admin.click('#codes-form [type=submit]');
  await admin.waitForSelector('#partage[open] .partage__qr svg');
  const code = await admin.locator('#partage code').textContent();
  check('admin: établissement et code créés', /^ZOE-[A-Z2-9]{8}$/.test(code || ''), code);
  const lienCode = await admin.inputValue('#partage input[readonly]');
  check('lien et QR code: lien d\'inscription avec le code, QR code dessiné', lienCode === `${BASE}/connexion.html?code=${code}#inscription` && await admin.locator('#partage .partage__qr svg rect, #partage .partage__qr svg path').count() > 0, lienCode);
  await admin.screenshot({ path: 'la-partage.png' });
  const affiche = await ouvrir(); await affiche.goto(`${BASE}/affiche.html?code=${code}&nom=${encodeURIComponent('IFSI <b>Évreux</b>')}`); await affiche.waitForSelector('#qr svg');
  check('affiche: QR code, code et nom affichés sans exécuter de HTML', (await affiche.textContent('#code')) === code && (await affiche.textContent('#nom')) === 'IFSI <b>Évreux</b>' && await affiche.locator('#nom b').count() === 0);
  await affiche.emulateMedia({ media: 'print' }); await affiche.pdf({ path: 'la-affiche.pdf', format: 'A4', printBackground: true }); await affiche.emulateMedia({ media: 'screen' });
  check('affiche: tient sur une seule page A4 à l\'impression', (fs.readFileSync('la-affiche.pdf', 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === 1);
  await affiche.setViewportSize({ width: 900, height: 1250 }); await affiche.screenshot({ path: 'la-affiche.png', fullPage: true });
  await admin.click('#partage [data-fermer]'); await admin.click('#codes-fermer');
  // Inscription par le lien du QR code : le compte est validé sans taper le code
  {
    const g = await ouvrir(); await g.goto(lienCode); const f = g.locator('#form-inscription');
    await g.waitForSelector('#acces-retenu:not([hidden])');
    check('lien: le code est retenu et annoncé sur l\'inscription', (await g.textContent('#acces-retenu')).includes(code) && await f.isVisible());
    await f.locator('[name=prenom]').fill('Gina'); await f.locator('[name=nom]').fill('Test'); await f.locator('[name=email]').fill(mail('Gina')); await f.locator('[name=mdp]').fill('motdepasse123');
    await f.locator('[name=categorie]').selectOption('esi'); await f.locator('[name=etablissement]').fill('IFSI'); await f.locator('[name=accord]').check(); await f.locator('[type=submit]').click();
    await g.waitForSelector('#form-code:not([hidden])'); const { code: c } = await codeEmail(mail('Gina')); await g.fill('#form-code [name=code]', c); await g.click('#form-code [type=submit]');
    await g.waitForSelector('#espace:not([hidden])', { timeout: 15000 });
    check('lien: compte validé automatiquement après l\'inscription', sql(`select statut||'|'||methode_verif from profils where email='${mail('Gina')}'`) === 'verifie|code' && await g.evaluate(() => localStorage.getItem('zoe.acces')) === null);
  }
  await admin.click('[data-onglet=contacts]'); await admin.waitForSelector('#contacts > *');
  check('admin: voit les demandes de contact', await admin.locator('#contacts .element').count() >= 1);

  // 3. Conductrice A : code d'établissement puis trajet
  const A = await inscrire('Alice', 'esi', true);
  await A.fill('#form-code [name=code]', 'ZOE-FAUXCODE'); await A.click('#form-code [type=submit]');
  check('code: un faux code est refusé', /pas valide/.test(await toast(A)));
  await A.fill('#form-code [name=code]', code.toLowerCase()); await A.click('#form-code [type=submit]');
  await A.waitForSelector('#espace:not([hidden])', { timeout: 10000 });
  check('code: accès immédiat avec un bon code', true);
  await A.waitForSelector('#conducteur-docs:not([hidden])');
  check('conducteur: arrive sur le dépôt des documents, formulaire de trajet masqué', await A.locator('[data-onglet=proposer]').getAttribute('aria-selected') === 'true' && await A.locator('#form-trajet').isHidden());
  {
    const c = createClient(URL_SB, KEY, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email: mail('Alice'), password: 'motdepasse123' });
    const id = (await c.auth.getUser()).data.user.id;
    const r = await c.from('trajets').insert({ conducteur_id: id, depart_ville: 'X', depart_lat: 49, depart_lng: 1, destination_nom: 'Test', destination_ville: 'Y', dest_lat: 49, dest_lng: 1, date_debut: '2030-01-01', date_fin: '2030-01-02', jours: [1], heure_arrivee: '06:00', places: 1 });
    check('sécu: pas de trajet sans validation conducteur', !!r.error);
  }
  await A.screenshot({ path: 'n-docs.png' });
  await A.setInputFiles('#form-conducteur [name=permis]', JUSTIF); await A.selectOption('#form-conducteur [name=type]', 'passeport');
  await A.setInputFiles('#form-conducteur [name=identite]', JUSTIF); await A.click('#form-conducteur [type=submit]');
  await A.waitForSelector('#conducteur-etat:not([hidden])');
  check('conducteur: documents envoyés, en attente', /contrôle à la main/.test(await A.locator('#conducteur-etat').textContent()) && sql("select count(*) from storage.objects where bucket_id='documents-conducteur'") === '2');
  await admin.click('[data-onglet=membres]'); await admin.selectOption('#filtre-statut', 'conducteurs');
  const ligneA = admin.locator(`#membres tr:has-text("${mail('Alice')}")`); await ligneA.waitFor();
  await admin.screenshot({ path: 'n-admin.png' });
  check('admin: liste des conducteurs à valider (passeport)', /Voir : Passeport/.test(await ligneA.textContent()));
  {
    const adm = createClient(URL_SB, KEY, { auth: { persistSession: false } }); await adm.auth.signInWithPassword({ email: mail('Admin'), password: 'motdepasse123' });
    const chemin = sql(`select permis_path from profils where email='${mail('Alice')}'`);
    const { data } = await adm.storage.from('documents-conducteur').createSignedUrl(chemin, 120);
    check('admin: peut ouvrir le permis', data && (await fetch(data.signedUrl)).status === 200);
  }
  await ligneA.locator('[data-action=conducteur-oui]').click(); await admin.waitForSelector('.toast:has-text("Conducteur validé")');
  await admin.waitForTimeout(800);
  check('admin: conducteur validé, fichiers effacés', sql(`select conducteur_statut||'|'||coalesce(permis_path,'-')||'|'||coalesce(identite_path,'-') from profils where email='${mail('Alice')}'`) === 'valide|-|-' && sql("select count(*) from storage.objects where bucket_id='documents-conducteur'") === '0');
  await admin.selectOption('#filtre-statut', 'en_attente');
  await A.reload(); await A.waitForSelector('#espace:not([hidden])'); await A.click('[data-onglet=proposer]'); await A.waitForSelector('#form-trajet:not([hidden])');
  await commune(A, '#t-depart', 'Vernon'); await commune(A, '#t-destination', 'Évreux');
  await A.fill('#form-trajet [name=destination_nom]', 'Centre hospitalier');
  const fin = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  check('proposer: durée 4 semaines présélectionnée, dates repliées', await A.locator('#t-dates').isHidden() && await A.locator('#form-trajet [data-duree="28"]').getAttribute('aria-pressed') === 'true');
  for (const j of ['6', '7']) await A.locator(`#form-trajet .jour:has([value="${j}"]) span`).click();
  check('trajet: heure de retour obligatoire', await A.locator('#form-trajet [name=heure_retour]').evaluate((e) => e.required));
  await A.addStyleTag({ content: '.header{position:static!important}' }); await A.screenshot({ path: 'rs-proposer.png', fullPage: true });
  check('proposer: heure de départ obligatoire', await A.locator('#form-trajet [name=heure_depart]').evaluate((e) => e.required));
  await A.fill('#form-trajet [name=heure_depart]', '06:05'); await A.fill('#form-trajet [name=heure_arrivee]', '06:40'); await A.fill('#form-trajet [name=heure_retour]', '14:30'); await A.fill('#form-trajet [name=places]', '1');
  await A.fill('#form-trajet [name=detour_max_km]', '10'); await A.click('#form-trajet [type=submit]');
  await A.waitForSelector('#mes-trajets .element');
  check('trajet: publié et listé', (await A.locator('#mes-trajets .element').first().textContent()).includes('Vernon → Centre hospitalier'));

  // 4. Passager B : justificatif, validation par l'admin
  const B = await inscrire('Bob', 'eas');
  await B.setInputFiles('#form-justificatif [name=fichier]', JUSTIF); await B.click('#form-justificatif [type=submit]');
  await B.waitForSelector('#etat-verification:not([hidden])', { timeout: 10000 });
  check('justificatif: envoyé, compte en attente', /contrôle à la main/.test(await B.locator('#etat-verification').textContent()));
  await admin.click('[data-onglet=membres]');
  const ligneB = admin.locator(`#membres tr:has-text("${mail('Bob')}")`);
  await ligneB.waitFor();
  // Le lien signé est vérifié directement (un PDF se télécharge au lieu de s'afficher en mode sans écran).
  {
    const adm = createClient(URL_SB, KEY, { auth: { persistSession: false } });
    await adm.auth.signInWithPassword({ email: mail('Admin'), password: 'motdepasse123' });
    const chemin = sql(`select justificatif_path from profils where email='${mail('Bob')}'`);
    const { data, error } = await adm.storage.from('justificatifs').createSignedUrl(chemin, 120);
    const rep = data ? await fetch(data.signedUrl) : null;
    check('admin: lien signé vers le justificatif', !error && rep.status === 200 && (await rep.text()).startsWith('%PDF'), error && error.message);
    const [popup] = await Promise.all([admin.context().waitForEvent('page'), ligneB.locator('[data-action=justificatif]').click()]);
    check('admin: le bouton ouvre le justificatif', true); await popup.close().catch(() => {});
  }
  await ligneB.locator('[data-action=verifie]').click(); await toast(admin);
  check('admin: validation + justificatif effacé', sql(`select statut||'|'||coalesce(justificatif_path,'-') from profils where email='${mail('Bob')}'`) === 'verifie|-' && sql("select count(*) from storage.objects where bucket_id='justificatifs'") === '0');

  // 5. B cherche et demande une place
  await B.reload(); await B.waitForSelector('#espace:not([hidden])');
  await commune(B, '#r-depart', 'Pacy-sur-Eure'); await commune(B, '#r-destination', 'Évreux');
  await B.fill('#r-heure', '06:45'); await B.click('#form-recherche [type=submit]');
  await B.waitForSelector('#resultats .result');
  const carte = B.locator('#resultats .result').first();
  console.log('   résultat:', (await carte.textContent()).replace(/\s+/g, ' ').slice(0, 220));
  check('matching: trajet d\'Alice trouvé avec un score', /Alice T\./.test(await carte.textContent()) && /\d+ %/.test(await carte.locator('.result__score').textContent()));
  check('recherche: fin de poste obligatoire', await B.locator('#r-retour').evaluate((e) => e.required));
  await B.fill('#r-heure', '06:30'); await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .tag--non');
  check('matching: aller signalé comme ne convenant pas si le conducteur arrive trop tard', /trop tôt ou trop tard/.test(await B.locator('#resultats .result').first().textContent()));
  await B.fill('#r-heure', '06:45'); await commune(B, '#r-depart', 'Bernay'); await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .empty');
  check('matching: écarté si le détour est trop grand', true);
  await commune(B, '#r-depart', 'Pacy-sur-Eure');
  // --- Exemple : stage du lundi au jeudi, 14 h - 21 h 30
  const joursLunJeu = async (page, nom) => { for (const j of [1,2,3,4,5,6,7]) await page.locator(`[name=${nom}][value="${j}"]`).setChecked(j <= 4, { force: true }); };
  await joursLunJeu(B, 'rjours'); await B.fill('#r-heure', '14:00'); await B.fill('#r-retour', '21:30');
  await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .empty');
  check('période: aucun trajet l\'après-midi pour l\'instant', true);
  await B.click('#resultats [data-action=enregistrer]'); await B.waitForSelector('#besoins .besoin');
  check('recherche enregistrée: listée, sans trajet', /Aucun trajet/.test(await B.locator('#besoins .besoin').textContent()) && /du lundi au jeudi, 14:00 – 21:30/.test(await B.locator('#besoins .besoin').textContent()));
  // Alice voit la demande, duplique son trajet et propose l'après-midi avec retour
  await A.reload(); await A.waitForSelector('#espace:not([hidden])'); await A.click('[data-onglet=proposer]'); await A.waitForSelector('#recherches-ouvertes:not([hidden])');
  check('conducteur: voit le trajet recherché, sans nom', /Pacy-sur-Eure → Évreux/.test(await A.locator('#recherches-ouvertes').textContent()) && !/Bob/.test(await A.locator('#recherches-ouvertes').textContent()));
  await A.click('[data-onglet=trajets]'); await A.click('#mes-trajets [data-action=dupliquer]'); await A.waitForSelector('#form-trajet:not([hidden])');
  check('dupliquer: formulaire prérempli', await A.inputValue('#t-depart') === 'Vernon' && await A.inputValue('#form-trajet [name=heure_arrivee]') === '06:40');
  check('dupliquer: heure de départ reprise, dates affichées', await A.inputValue('#form-trajet [name=heure_depart]') === '06:05' && await A.locator('#t-dates').isVisible());
  await joursLunJeu(A, 'jours'); await A.fill('#form-trajet [name=heure_depart]', '13:10'); await A.fill('#form-trajet [name=heure_arrivee]', '13:45'); await A.fill('#form-trajet [name=heure_retour]', '21:45');
  await A.click('#form-trajet [type=submit]'); await A.waitForFunction(() => document.querySelectorAll('#mes-trajets .element').length === 2);
  // Bob est prévenu
  await B.reload(); await B.waitForSelector('#pastille-recherche:not([hidden])');
  check('alerte: pastille et « 1 nouveau » sur la recherche enregistrée', (await B.locator('#pastille-recherche').textContent()) === '1' && /1 nouveau/.test(await B.locator('#besoins .besoin').textContent()));
  await B.click('#besoins [data-action=voir]'); await B.waitForSelector('#resultats .result');
  await B.waitForTimeout(500); await B.screenshot({ path: 'r-recherche.png', fullPage: true });
  await B.setViewportSize({ width: 390, height: 800 }); await B.waitForTimeout(300); await B.screenshot({ path: 'r-recherche-mob.png', fullPage: true }); console.log('   mobile hscroll:', await B.evaluate(() => document.documentElement.scrollWidth > innerWidth)); await B.setViewportSize({ width: 1280, height: 900 });
  const apm = (await B.locator('#resultats .result').first().textContent()).replace(/\s+/g, ' ');
  console.log('   après-midi:', apm.slice(0, 330));
  check('période: aller ET retour trouvés (14 h - 21 h 30, lun-jeu)', /Aller : départ 13:10, arrivée 13:45/.test(apm) && /Alice peut vous emmener à l'aller et au retour, tous vos jours\./.test(apm) && /Retour : départ 21:45/.test(apm) && /Lun, Mar, Mer, Jeu · (\d+) jours? sur \1/.test(apm));
  await B.waitForSelector('#pastille-recherche', { state: 'hidden' });
  check('alerte: retirée après consultation', /1 trajet/.test(await B.locator('#besoins .besoin').textContent()));
  await B.fill('#r-retour', '19:00'); await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .tag--non');
  check('période: retour signalé comme ne convenant pas (fin à 19 h)', /Retour : départ 21:45, ne convient pas/.test(await B.locator('#resultats .result').first().textContent()));
  await B.click('#form-recherche .plus summary'); await B.selectOption('#r-marge', '30'); await B.fill('#r-heure', '14:30'); await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .empty');
  check('marge: 30 minutes écarte une arrivée 45 minutes en avance', true);
  // poste de nuit : arrivée 20 h 45, retour 7 h 15 le lendemain
  {
    const idA = sql(`select id from profils where email='${mail('Alice')}'`);
    sql(`insert into trajets (id, conducteur_id, depart_ville, depart_lat, depart_lng, destination_nom, destination_ville, dest_lat, dest_lng, date_debut, date_fin, jours, heure_arrivee, heure_retour, places) values ('00000000-0000-0000-0000-00000000000a', '${idA}', 'Vernon', 49.0929, 1.4856, 'Nuit', 'Évreux', 49.0241, 1.1508, current_date, current_date + 20, '{1,2,3,4,5,6,7}', '20:45', '00:10', 1)`);
    const c = createClient(URL_SB, KEY, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email: mail('Bob'), password: 'motdepasse123' });
    const auj = new Date().toISOString().slice(0, 10), fin = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const r = await c.rpc('rechercher_trajets_periode', { p_dep_lat: 49.0166, p_dep_lng: 1.3811, p_dest_lat: 49.0241, p_dest_lng: 1.1508, p_debut: auj, p_fin: fin, p_jours: [1,2,3,4,5,6,7], p_arrivee: '21:00', p_retour: '23:50', p_marge: 60 });
    const nuit = (r.data || []).find((t) => t.destination_nom === 'Nuit');
    check('nuit: retour après minuit reconnu (fin 23 h 50, départ 0 h 10)', nuit && nuit.aller_ok && nuit.retour_ok && nuit.attente_min === 20, JSON.stringify(r.error || nuit));
    sql("delete from trajets where id='00000000-0000-0000-0000-00000000000a'");
  }
  for (const j of [1,2,3,4,5,6,7]) await B.locator(`[name=rjours][value="${j}"]`).setChecked(j <= 5, { force: true });
  await B.selectOption('#r-marge', '60'); await B.fill('#r-heure', '06:45'); await B.fill('#r-retour', '14:15');
  await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .result');
  // Raccourcis, mémoire du formulaire, recherche enregistrée dont la période est passée
  await B.click('#form-recherche [data-raccourcis=horaires] button:has-text("Après-midi")');
  check('raccourci horaires: remplit les deux heures', await B.inputValue('#r-heure') === '13:45' && await B.inputValue('#r-retour') === '21:15' && await B.locator('#form-recherche [data-raccourcis=horaires] button:has-text("Après-midi")').getAttribute('aria-pressed') === 'true');
  await B.click('#form-recherche [data-raccourcis=jours] button:has-text("Week-end")');
  await B.locator('#form-recherche .raccourcis').first().screenshot({ path: 'av-raccourci.png' });
  check('raccourci jours: le bouton choisi est allumé', await B.locator('#form-recherche [data-raccourcis=jours] button:has-text("Week-end")').getAttribute('aria-pressed') === 'true' && (await B.locator('#form-recherche [data-raccourcis=jours] button:has-text("Week-end")').evaluate((b) => getComputedStyle(b).backgroundColor)) === 'rgb(84, 37, 184)');
  check('raccourci jours: coche samedi et dimanche seulement', (await B.locator('[name=rjours]:checked').evaluateAll((l) => l.map((c) => c.value).join(','))) === '6,7');
  await B.click('#form-recherche [data-raccourcis=duree] button:has-text("Choisir les dates")');
  check('raccourci durée: les dates apparaissent à la demande', await B.locator('#r-dates').isVisible());
  await B.click('#form-recherche [data-raccourcis=duree] button:has-text("4 semaines")');
  await B.click('#form-recherche [data-raccourcis=jours] button:has-text("Lundi au vendredi")'); await B.click('#form-recherche [data-raccourcis=horaires] button:has-text("Matin")');
  await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .result');
  check('résultat: phrase en clair', /Alice peut vous emmener à l'aller et au retour, tous vos jours\./.test(await B.locator('#resultats .result__phrase').first().textContent()));
  await B.addStyleTag({ content: '.header{position:static!important}' }); await B.screenshot({ path: 'rs-recherche.png', fullPage: true });
  await B.setViewportSize({ width: 390, height: 850 }); await B.waitForTimeout(300); await B.screenshot({ path: 'rs-recherche-mob.png', fullPage: true }); console.log('   mobile déborde:', await B.evaluate(() => document.documentElement.scrollWidth > innerWidth)); await B.setViewportSize({ width: 1280, height: 900 });
  sql("update besoins set date_debut = current_date - 10, date_fin = current_date - 3");
  await B.reload(); await B.waitForSelector('#besoins .besoin');
  check('mémoire: le formulaire reprend la dernière recherche', await B.inputValue('#r-depart') === 'Pacy-sur-Eure' && await B.inputValue('#r-destination') === 'Évreux' && await B.inputValue('#r-heure') === '06:45');
  check('recherche passée: marquée « Période terminée », sans pastille', /Période terminée/.test(await B.locator('#besoins .besoin').textContent()) && await B.locator('#pastille-recherche').isHidden());
  await B.click('#besoins [data-action=relancer]'); await B.waitForSelector('.toast:has-text("relancée")');
  check('recherche passée: relancée sans erreur, à partir d\'aujourd\'hui', sql("select (date_debut = current_date and date_fin = current_date + 7)::text from besoins") === 'true' && await B.locator('.toast--err').count() === 0);
  for (const j of [1,2,3,4,5,6,7]) await B.locator(`[name=rjours][value="${j}"]`).setChecked(j <= 5, { force: true });
  await B.click('#form-recherche [data-raccourcis=duree] button:has-text("4 semaines")'); await B.click('#form-recherche [data-raccourcis=horaires] button:has-text("Matin")');
  await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .result');
  // Adresse complète : un seul appui suffit, l'adresse reste privée
  await B.fill('#r-depart', '44 rue jos'); await B.waitForSelector('#r-depart + .suggestions button:has-text("44 Rue Joséphine")');
  await B.locator('#r-depart + .suggestions button:has-text("44 Rue Joséphine")').dispatchEvent('pointerdown');
  check('adresse: retenue dès le premier appui', await B.inputValue('#r-depart') === '44 Rue Joséphine 27000 Évreux' && await B.locator('#r-depart + .suggestions').isHidden());
  await B.fill('#r-destination', 'lent'); await B.waitForTimeout(350); await B.fill('#r-destination', 'Évre'); await B.click('#r-destination + .suggestions button:has-text("Évreux")'); await B.waitForTimeout(1200);
  check('adresse: une réponse tardive ne rouvre pas la liste après le choix', await B.inputValue('#r-destination') === 'Évreux' && await B.locator('#r-destination + .suggestions').isHidden());
  await B.fill('#r-destination', 'Vern'); await B.waitForSelector('#r-destination + .suggestions button:has-text("Vernon")'); await B.locator('#r-heure').focus(); await B.waitForTimeout(500);
  check('adresse: en quittant la case, la première proposition est retenue', await B.inputValue('#r-destination') === 'Vernon');
  await B.fill('#r-destination', 'panne'); await B.waitForTimeout(700); await B.fill('#r-destination', 'Évre'); await B.click('#r-destination + .suggestions button:has-text("Évreux")');
  await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .result');
  await B.click('[data-action=demander]');
  check('adresse: proposée au conducteur dans le message, modifiable', /passer me prendre ici : 44 Rue Joséphine 27000 Évreux/.test(await B.inputValue('.result__demande textarea')));
  await B.click('#resultats [data-action=enregistrer]'); await B.waitForSelector('.toast:has-text("Recherche enregistrée")');
  check('adresse: jamais enregistrée (commune et position arrondie seulement)', sql("select depart_ville||'|'||depart_lat||'|'||depart_lng from besoins order by created_at desc limit 1") === 'Évreux|49.027|1.143' && !/Joséphine/.test(sql("select coalesce(string_agg(b::text, ' '), '') from besoins b")));
  check('adresse: position du conducteur arrondie dans le trajet publié', sql("select string_agg(distinct depart_lat||'/'||depart_lng, ',') from trajets") === '49.09/1.49');
  await B.fill('#r-depart', 'Pacy'); await B.click('#r-depart + .suggestions button:has-text("Pacy-sur-Eure")'); await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .result');
  await B.click('[data-action=question]'); await B.fill('.result__demande textarea', 'Vous passez par la gare ?'); await B.click('.result__demande [type=submit]');
  await B.waitForSelector('#conversations .conversation');
  check('messagerie: question envoyée sans réserver', sql("select statut from reservations") === 'contact' && /Vous : Vous passez par la gare/.test(await B.locator('#conversations .conversation').textContent()));
  await A.reload(); await A.waitForSelector('#pastille:not([hidden])');
  check('messagerie: pastille de non-lu chez la conductrice', (await A.locator('#pastille').textContent()) === '1');
  await A.click('[data-onglet=trajets]'); await A.waitForSelector('#mes-trajets .element:has-text("arrivée 06:40")');
  check('messagerie: une question ne compte pas comme une demande', /Aucune demande/.test(await A.locator('#mes-trajets .element:has-text("arrivée 06:40")').textContent()));
  {
    const c = createClient(URL_SB, KEY, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email: mail('Alice'), password: 'motdepasse123' });
    const r = await c.rpc('repondre_reservation', { p_reservation: sql('select id from reservations'), p_accepter: true });
    check('sécu: impossible d\'accepter une simple question', !!r.error);
  }
  await A.click('[data-onglet=messages]'); await A.waitForSelector('#conversations .conversation'); await A.screenshot({ path: 'n-messages.png' });
  await A.setViewportSize({ width: 390, height: 800 }); await A.screenshot({ path: 'n-messages-mob.png' }); console.log('   mobile hscroll:', await A.evaluate(() => document.documentElement.scrollWidth > innerWidth)); await A.setViewportSize({ width: 1280, height: 900 });
  await A.click('#conversations .conversation'); await A.waitForSelector('#fil .bulle');
  await A.fill('#fil-form input', 'Oui, 6h05 devant la gare.'); await A.click('#fil-form [type=submit]'); await A.waitForSelector('#fil .bulle--moi'); await A.click('#fil-fermer');
  await A.waitForSelector('#pastille', { state: 'hidden' });
  check('messagerie: lu après ouverture, pastille retirée', true);
  await B.click('[data-onglet=rechercher]'); await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats [data-action=voir-messages]');
  await B.click('[data-action=demander]'); await B.fill('.result__demande textarea', 'Bonjour <b>Alice</b> !'); await B.click('.result__demande [type=submit]');
  await B.waitForSelector('#resultats .badge--demandee');
  check('réservation: demande envoyée', true);

  // 6. A accepte et répond
  await A.click('[data-onglet=reservations]'); await A.click('[data-onglet=trajets]');
  await A.waitForSelector('#mes-trajets .demandes li');
  await A.click('#mes-trajets [data-action=accepter]'); await A.waitForSelector('#mes-trajets .badge--acceptee');
  check('réservation: acceptée, 1/1 place prise', (await A.locator('#mes-trajets .element:has-text("arrivée 06:40") .seats').textContent()).includes('1/1'));
  await A.click('#mes-trajets [data-action=messages]'); await A.waitForSelector('#fil .bulle');
  check('messages: texte affiché sans exécuter le HTML', (await A.locator('#fil .bulle p').last().textContent()) === 'Bonjour <b>Alice</b> !' && await A.locator('#fil .bulle b').count() === 0);
  await A.fill('#fil-form input', 'Avec plaisir.'); await A.click('#fil-form [type=submit]');
  await A.waitForFunction(() => document.querySelectorAll('#fil .bulle--moi').length === 2); await A.click('#fil-fermer');

  // 7. B voit la réponse ; trajet complet
  await B.click('[data-onglet=reservations]'); await B.waitForSelector('#mes-reservations .badge--acceptee');
  await B.click('#mes-reservations [data-action=messages]'); await B.waitForFunction(() => document.querySelectorAll('#fil .bulle').length === 4);
  check('messages: conversation à deux', true); await B.click('#fil-fermer');

  // Fiche du conducteur, photo, avis, signalement
  await A.click('[data-onglet=profil]'); await A.waitForSelector('#mes-avis .aide'); await A.click('#voir-ma-fiche'); await A.waitForSelector('#fiche[open] .fiche__tete');
  check('fiche sans avis: la rubrique des avis est affichée quand même', /Avis des passagers/.test(await A.locator('#fiche-corps').textContent()) && /Aucun avis pour l'instant/.test(await A.locator('#fiche-corps').textContent()));
  await A.waitForTimeout(300); await A.screenshot({ path: 'fv-vide.png' }); await A.click('#fiche-fermer');
  await A.fill('#form-profil [name=vehicule]', 'Clio grise'); await A.fill('#form-profil [name=bio]', 'Ponctuelle <script>alert(1)</script>'); await A.click('#form-profil [type=submit]'); await toast(A);
  await A.screenshot({ path: 'photo-test.png' }); await A.setInputFiles('#photo-fichier', 'photo-test.png'); await A.waitForSelector('#photo-apercu img');
  check('photo: enregistrée et réduite', sql(`select count(*) from storage.objects o join profils p on o.name like p.id || '/%' where o.bucket_id='photos' and p.email='${mail('Alice')}'`) === '1' && Number(sql(`select (o.metadata->>'size')::int from storage.objects o join profils p on o.name like p.id || '/%' where o.bucket_id='photos' and p.email='${mail('Alice')}'`)) < 200000);
  await B.click('[data-action=avis]'); await B.selectOption('.form-avis [name=note]', '4'); await B.fill('.form-avis textarea', 'Très ponctuelle <b>merci</b>'); await B.click('.form-avis [type=submit]'); await toast(B);
  check('avis: publié', sql('select note from avis') === '4');
  await B.waitForSelector('#mes-reservations [data-fiche]'); await B.click('#mes-reservations [data-fiche]'); await B.waitForSelector('#fiche[open] .fiche__tete');
  const fiche = (await B.locator('#fiche-corps').textContent()).replace(/\s+/g, ' ');
  console.log('   fiche:', fiche.slice(0, 300));
  check('fiche: badges, véhicule, note, avis, photo', /Permis et identité contrôlés/.test(fiche) && /Clio grise/.test(fiche) && /★ 4/.test(fiche) && /Très ponctuelle <b>merci<\/b>/.test(fiche) && await B.locator('#fiche-corps img.avatar--photo').count() === 1);
  check('fiche: aucun e-mail, aucun nom complet, aucun script exécuté', !fiche.includes('@') && !/Alice Test/.test(fiche) && await B.locator('#fiche-corps script, #fiche-corps .citation b, #fiche-corps .fiche__avis b').count() === 0);
  // Alice retrouve ses avis dans son profil, à côté de sa photo
  await A.click('[data-onglet=rechercher]'); await A.click('[data-onglet=profil]'); await A.waitForSelector('#mes-avis .fiche__avis li');
  const mesAvis = (await A.locator('#mes-avis').textContent()).replace(/\s+/g, ' ');
  check('profil: avis reçus dans le profil (note, auteur, commentaire)', /★ 4 sur 5 · 1 avis/.test(mesAvis) && /Bob T\./.test(mesAvis) && /Très ponctuelle <b>merci<\/b>/.test(mesAvis) && await A.locator('#mes-avis b').count() === 0, mesAvis.slice(0, 160));
  await A.addStyleTag({ content: '.header{position:static!important}' }); await A.screenshot({ path: 'av-profil.png', fullPage: true });
  await A.setViewportSize({ width: 390, height: 850 }); await A.waitForTimeout(300); console.log('   profil mobile déborde:', await A.evaluate(() => document.documentElement.scrollWidth > innerWidth)); await A.locator('#mes-avis').scrollIntoViewIfNeeded(); await A.screenshot({ path: 'av-profil-mob.png' }); await A.setViewportSize({ width: 1280, height: 900 });
  await B.click('[data-signaler]'); await repondre(B, { texte: 'Conduite dangereuse sur la nationale.' }); await B.waitForSelector('.toast:has-text("Signalement envoyé")');
  check('signalement: enregistré', sql('select count(*) from signalements') === '1');
  await B.click('#fiche-fermer');
  await admin.reload(); await admin.waitForSelector('#pastille-moderation:not([hidden])'); await admin.click('[data-onglet=moderation]'); await admin.waitForSelector('#signalements .element');
  check('admin: signalement et avis visibles en modération', /Conduite dangereuse/.test(await admin.locator('#signalements').textContent()) && /Très ponctuelle/.test(await admin.locator('#avis').textContent()));
  await admin.screenshot({ path: 's-moderation.png' });
  await admin.click('#avis [data-action=masquer]'); await admin.waitForSelector('#avis .badge--annulee');
  { const c = createClient(URL_SB, KEY, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email: mail('Bob'), password: 'motdepasse123' });
    const f = (await c.rpc('fiche_membre', { p_membre: sql(`select id from profils where email='${mail('Alice')}'`) })).data;
    check('modération: un avis masqué disparaît de la fiche', f.nb_avis === 0 && f.avis.length === 0); }
  await admin.click('#avis [data-action=masquer]'); await admin.waitForSelector('#avis .badge--annulee', { state: 'detached' });
  await admin.click('#signalements [data-action=basculer]'); await admin.waitForSelector('#pastille-moderation', { state: 'hidden' });
  await admin.click('[data-onglet=journal]'); await admin.waitForSelector('#journal tr td:nth-child(3)');
  const journal = await admin.locator('#journal').textContent();
  check('journal: actions tracées', /Conducteur validé/.test(journal) && /Avis masqué/.test(journal) && /Établissement créé/.test(journal));
  await admin.click('[data-onglet=membres]');
  await B.click('[data-onglet=rechercher]'); await B.click('#form-recherche [type=submit]'); await B.waitForSelector('#resultats .result img.avatar--photo');
  check('recherche: photo et note du conducteur affichées', /★ 4/.test(await B.locator('#resultats .result').first().textContent()));
  await B.screenshot({ path: 's-resultat.png' }); await B.click('#resultats [data-fiche]'); await B.waitForSelector('#fiche[open] .fiche__tete'); await B.waitForTimeout(400); await B.screenshot({ path: 's-fiche.png' });
  await B.setViewportSize({ width: 390, height: 800 }); await B.waitForTimeout(300); await B.screenshot({ path: 's-fiche-mob.png' }); await B.setViewportSize({ width: 1280, height: 900 }); await B.click('#fiche-fermer');
  await B.click('[data-onglet=reservations]');

  // 8. Invitation : A invite C
  await A.click('[data-onglet=profil]'); await A.click('#creer-invitation'); await A.waitForSelector('#invitations code');
  const inv = await A.locator('#invitations code').first().textContent();
  const wa = await A.locator('#invitations a[href^="https://wa.me/"]').first().getAttribute('href');
  check('invitation: bouton WhatsApp avec le lien d\'invitation', decodeURIComponent(wa).includes(`${BASE}/connexion.html?invitation=${inv}#inscription`) && /Je t'invite sur Meet Zoe/.test(decodeURIComponent(wa)));
  await A.screenshot({ path: 'la-invitation.png' });
  await A.click('#creer-invitation'); await A.waitForFunction(() => document.querySelectorAll('#invitations code').length === 2);
  {
    const inv2 = await A.locator('#invitations code').nth(1).textContent();
    const h = await ouvrir(); await h.goto(`${BASE}/connexion.html?invitation=${inv2}#inscription`); const f = h.locator('#form-inscription');
    await f.locator('[name=prenom]').fill('Hugo'); await f.locator('[name=nom]').fill('Test'); await f.locator('[name=email]').fill(mail('Hugo')); await f.locator('[name=mdp]').fill('motdepasse123');
    await f.locator('[name=categorie]').selectOption('pro_diplome'); await f.locator('[name=etablissement]').fill('CH'); await f.locator('[name=accord]').check(); await f.locator('[type=submit]').click();
    await h.waitForSelector('#form-code:not([hidden])'); const { code: c } = await codeEmail(mail('Hugo')); await h.fill('#form-code [name=code]', c); await h.click('#form-code [type=submit]');
    await h.waitForSelector('#espace:not([hidden])', { timeout: 15000 });
    check('invitation: le lien valide le compte automatiquement', sql(`select methode_verif from profils where email='${mail('Hugo')}'`) === 'invitation');
  }
  const C = await inscrire('Chloe', 'pro_diplome');
  await C.fill('#form-invitation [name=code]', inv); await C.click('#form-invitation [type=submit]');
  await C.waitForSelector('#espace:not([hidden])', { timeout: 10000 });
  check('invitation: accès immédiat', sql(`select methode_verif from profils where email='${mail('Chloe')}'`) === 'invitation');
  await commune(C, '#r-depart', 'Vernon'); await commune(C, '#r-destination', 'Évreux'); await C.click('#form-recherche [type=submit]');
  await C.waitForSelector('#resultats .result');
  check('trajet complet: affiché « Complet », pas de bouton', (await C.locator('#resultats .seats').textContent()) === 'Complet' && await C.locator('[data-action=demander]').count() === 0);
  const D0 = await inscrire('Zed'); await D0.fill('#form-invitation [name=code]', inv); await D0.click('#form-invitation [type=submit]');
  check('invitation: ne sert qu\'une fois', /pas valide/.test(await toast(D0)));

  // 9. Quota (2) : D passe, Zed est bloqué
  const D = await inscrire('Dan'); await D.fill('#form-code [name=code]', code); await D.click('#form-code [type=submit]');
  await D.waitForSelector('#espace:not([hidden])', { timeout: 10000 });
  await D0.fill('#form-code [name=code]', code); await D0.click('#form-code [type=submit]');
  await D0.waitForSelector('.toast:has-text("quota")', { timeout: 8000 }).then(() => check('quota: le 3e membre est refusé', true), () => check('quota: le 3e membre est refusé', false));

  // 10. Partenaire
  await admin.selectOption('#filtre-statut', 'verifie');
  const ligneD = admin.locator(`#membres tr:has-text("${mail('Dan')}")`); await ligneD.waitFor();
  await ligneD.locator('[data-champ=role]').selectOption('partenaire');
  await ligneD.locator('[data-champ=etab]').selectOption({ label: `IFSI Evreux ${run}` });
  await ligneD.locator('[data-action=role]').click(); await toast(admin);
  await connecter(D, 'Dan'); await D.waitForURL('**/partenaire.html'); await D.waitForSelector('#chiffres .chiffre');
  const chiffres = (await D.locator('#chiffres').textContent()).replace(/\s+/g, ' ');
  console.log('   stats:', chiffres);
  check('partenaire: statistiques (2 membres/3, 2 trajets, 1 place partagée)', /2 \/ 3/.test(chiffres) && /2 ?Trajets/.test(chiffres) && /2 ?Places proposées/.test(chiffres) && /1 ?Places partagées/.test(chiffres));
  await D.click('#codes [data-action=partager]'); await D.waitForSelector('#partage[open] .partage__qr svg');
  check('partenaire: lien et QR code de son code', (await D.inputValue('#partage input[readonly]')).includes('connexion.html?code=ZOE-')); await D.click('#partage [data-fermer]');
  await D.fill('#form-code [name=libelle]', 'Promo 2026'); await D.fill('#form-code [name=max]', '30'); await D.click('#form-code [type=submit]');
  await D.waitForSelector('#codes tr:has-text("Promo 2026")');
  check('partenaire: création de code', await D.locator('#codes tr').count() === 2);

  // 11. Sécurité : tentatives directes, sans passer par les pages
  const client = async (prenom) => { const c = createClient(URL_SB, KEY, { auth: { persistSession: false } }); if (prenom) await c.auth.signInWithPassword({ email: mail(prenom), password: 'motdepasse123' }); return c; };
  const zed = await client('Zed'), bob = await client('Bob'), anon = await client(), dan = await client('Dan');
  const idZed = (await zed.auth.getUser()).data.user.id;
  let r = await zed.from('profils').update({ statut: 'verifie' }).eq('id', idZed); check('sécu: un membre ne peut pas se vérifier seul', !!r.error);
  r = await zed.from('profils').update({ role: 'admin' }).eq('id', idZed); check('sécu: ni se nommer admin', !!r.error);
  r = await zed.from('trajets').select('*'); check('sécu: non vérifié ne voit aucun trajet', (r.data || []).length === 0);
  r = await zed.rpc('rechercher_trajets_periode', { p_dep_lat: 49.09, p_dep_lng: 1.48, p_dest_lat: 49.02, p_dest_lng: 1.15, p_debut: new Date().toISOString().slice(0, 10), p_fin: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), p_jours: [1,2,3,4,5,6,7], p_arrivee: '06:45' }); check('sécu: non vérifié, recherche vide', (r.data || []).length === 0);
  r = await zed.from('membres').select('*'); check('sécu: non vérifié ne voit aucun membre', (r.data || []).length === 0);
  r = await zed.from('messages').select('*'); check('sécu: messages invisibles aux tiers', (r.data || []).length === 0);
  r = await zed.rpc('admin_definir_statut', { p_membre: idZed, p_statut: 'verifie' }); check('sécu: fonction admin refusée', !!r.error);
  r = await zed.rpc('creer_code', { p_libelle: 'x', p_max: null, p_expire: null }); check('sécu: création de code refusée', !!r.error);
  r = await bob.from('profils').select('email'); check('sécu: un membre ne lit que son propre profil', r.data.length === 1);
  r = await bob.from('membres').select('*'); check('sécu: fiche publique sans e-mail ni téléphone', r.data.length >= 3 && !('email' in r.data[0]) && !('telephone' in r.data[0]));
  r = await bob.from('codes_acces').select('*'); check('sécu: codes invisibles aux membres', (r.data || []).length === 0);
  r = await bob.from('etablissements').select('*'); check('sécu: quotas/abonnements invisibles aux membres', (r.data || []).length === 0);
  r = await bob.from('demandes_contact').select('*'); check('sécu: demandes de contact invisibles aux membres', (r.data || []).length === 0);
  r = await bob.from('reservations').update({ statut: 'acceptee' }).neq('statut', 'x'); check('sécu: statut de réservation non modifiable directement', !!r.error);
  r = await bob.storage.from('justificatifs').list(''); check('sécu: justificatifs des autres invisibles', (r.data || []).length === 0);
  r = await zed.rpc('soumettre_documents_conducteur', { p_permis: idZed + '/a.pdf', p_identite: idZed + '/b.pdf', p_type: 'cni' }); check('sécu: documents conducteur refusés à un non vérifié', !!r.error);
  r = await bob.rpc('admin_valider_conducteur', { p_membre: (await bob.auth.getUser()).data.user.id, p_valider: true }); check('sécu: un membre ne peut pas se valider conducteur', !!r.error);
  r = await bob.from('profils').update({ conducteur_statut: 'valide' }).neq('email', ''); check('sécu: statut conducteur non modifiable directement', !!r.error);
  r = await bob.storage.from('documents-conducteur').list(''); check('sécu: documents des autres conducteurs invisibles', (r.data || []).length === 0);
  r = await dan.rpc('mes_conversations'); check('sécu: un tiers ne voit pas les conversations des autres', (r.data || []).length === 0);
  r = await zed.from('besoins').insert({ membre_id: idZed, depart_ville: 'A', depart_lat: 49, depart_lng: 1, destination_ville: 'B', dest_lat: 49, dest_lng: 1, date_debut: '2030-01-01', date_fin: '2030-01-02', jours: [1], heure_arrivee: '06:00' }); check('sécu: non vérifié ne peut pas enregistrer de recherche', !!r.error);
  r = await dan.from('besoins').select('*'); check('sécu: recherches des autres invisibles', (r.data || []).length === 0);
  r = await zed.rpc('besoins_ouverts'); check('sécu: non vérifié ne voit pas les trajets recherchés', (r.data || []).length === 0);
  r = await bob.rpc('trajets_compatibles', { p_membre: idZed, p_dep_lat: 49, p_dep_lng: 1, p_dest_lat: 49, p_dest_lng: 1, p_debut: '2030-01-01', p_fin: '2030-01-02', p_jours: [1], p_arrivee: '06:00', p_retour: null, p_marge: 60 }); check('sécu: fonction interne de matching fermée', !!r.error);
  r = await zed.rpc('fiche_membre', { p_membre: (await bob.auth.getUser()).data.user.id }); check('sécu: fiches invisibles aux non vérifiés', !r.data);
  r = await bob.from('avis').insert({ auteur_id: (await bob.auth.getUser()).data.user.id, cible_id: idZed, note: 1 }); check('sécu: pas d\'avis sans covoiturage accepté', !!r.error);
  r = await dan.rpc('laisser_avis', { p_reservation: sql('select id from reservations limit 1'), p_note: 1, p_commentaire: 'x' }); check('sécu: pas d\'avis sur la réservation d\'un autre', !!r.error);
  r = await bob.from('signalements').select('*'); check('sécu: signalements invisibles aux membres', (r.data || []).length === 0);
  r = await bob.from('journal_admin').select('*'); check('sécu: journal invisible aux membres', (r.data || []).length === 0);
  r = await bob.rpc('admin_masquer_avis', { p_avis: sql('select id from avis limit 1'), p_masquer: true }); check('sécu: un membre ne peut pas masquer un avis', !!r.error);
  r = await bob.rpc('definir_photo', { p_path: idZed + '/x.jpg' }); check('sécu: pas de photo pointant vers le dossier d\'un autre', !!r.error);
  r = await bob.rpc('journaliser', { p_action: 'x', p_cible: null, p_detail: null }); check('sécu: journal non falsifiable', !!r.error);
  {
    const idRes = sql('select id from reservations limit 1'), idBob = (await bob.auth.getUser()).data.user.id; let refus = null;
    for (let i = 0; i < 24 && !refus; i++) { const x = await bob.from('messages').insert({ reservation_id: idRes, expediteur_id: idBob, contenu: 'spam ' + i }); if (x.error) refus = x.error.message; }
    check('sécu: envoi de messages en rafale bloqué', /trop de messages/.test(refus || ''), refus);
    const eve = createClient(URL_SB, KEY, { auth: { persistSession: false } }); await eve.auth.signUp({ email: mail('Eve'), password: 'motdepasse123', options: { data: { prenom: 'Eve', nom: 'Test', categorie: 'esi' } } });
    sql(`update auth.users set email_confirmed_at = now() where email='${mail('Eve')}'`); await eve.auth.signInWithPassword({ email: mail('Eve'), password: 'motdepasse123' });
    let dernier; for (let i = 0; i < 11; i++) dernier = (await eve.rpc('utiliser_code', { p_code: 'ZOE-FAUX' + i })).data;
    const vrai = (await eve.rpc('utiliser_code', { p_code: code })).data;
    check('sécu: 10 essais de code ratés bloquent le compte pour la journée', /Trop d'essais/.test(dernier.message) && vrai.ok === false && /Trop d'essais/.test(vrai.message));
  }
  r = await anon.from('profils').select('*'); check('sécu: visiteur anonyme ne lit rien', !!r.error || r.data.length === 0);
  r = await anon.from('trajets').select('*'); check('sécu: visiteur anonyme ne voit aucun trajet', !!r.error || r.data.length === 0);
  r = await dan.from('profils').select('email'); check('sécu: partenaire sans accès aux données individuelles', r.data.length === 1);
  r = await dan.from('codes_acces').update({ utilisations: 0 }).neq('code', ''); check('sécu: partenaire ne peut pas remettre un compteur à zéro', !!r.error);


  // 11 bis. Alertes, e-mails, modification d'un trajet et garde-fous
  {
    const alice = await client('Alice'), chloe = await client('Chloe'), hugo = await client('Hugo'), adm = await client('Admin');
    const idDe = (p) => sql(`select id from profils where email='${mail(p)}'`);
    const idAlice = idDe('Alice'), idBob = idDe('Bob'), idChloe = idDe('Chloe'), idHugo = idDe('Hugo');
    const nb = (cond) => Number(sql(`select count(*) from notifications where ${cond}`));
    check('alertes: la conductrice est prévenue de la demande de place', nb(`membre_id='${idAlice}' and type='demande'`) >= 1);
    check('alertes: le passager est prévenu de l\'acceptation', nb(`membre_id='${idBob}' and type='reponse' and titre like '%a accepté votre demande'`) === 1);
    check('alertes: nouveau trajet correspondant à une recherche enregistrée', nb(`membre_id='${idBob}' and type='trajet' and titre like 'Un nouveau trajet%'`) >= 1);
    await new Promise((x) => setTimeout(x, 3000));
    let boite = await emails();
    const recu = (prenom, motif) => boite.some((m) => m.to && m.to[0].email === mail(prenom) && motif.test(m.subject));
    check('e-mails: demande de place envoyée à la conductrice, avec la clé privée et sans le contenu du message', recu('Alice', /demande une place/) && boite.every((m) => m.cle === 'cle-test' && !/Bonjour &lt;b&gt;Alice|spam \d/.test(m.htmlContent)), JSON.stringify(boite.map((m) => m.subject)).slice(0, 300));
    check('e-mails: compte vérifié, conducteur validé, réponse à une demande', recu('Bob', /compte Meet Zoe est vérifié/) && recu('Alice', /validé comme conducteur/) && recu('Bob', /a accepté votre demande/));
    check('e-mails: l\'administrateur est prévenu des dossiers à contrôler', recu('Admin', /Justificatif à contrôler/) && recu('Admin', /Documents de conducteur à contrôler/) && recu('Admin', /Nouveau signalement/));

    // La cloche et les pastilles
    const idTrajet2 = sql("select id from trajets where heure_arrivee='13:45'");
    let r = await chloe.rpc('demander_reservation', { p_trajet: idTrajet2, p_message: 'Bonjour, une place ?' }); check('demande de place de Chloé', !r.error, r.error && r.error.message);
    r = await hugo.rpc('demander_reservation', { p_trajet: idTrajet2, p_message: '' }); check('demande de place sans message (Hugo)', !r.error, r.error && r.error.message);
    await A.reload(); await A.waitForSelector('#pastille-trajets:not([hidden])');
    check('alertes: pastille sur « Mes trajets » et sur la cloche, même pour une demande sans message', Number(await A.locator('#pastille-trajets').textContent()) >= 2 && Number(await A.locator('#pastille-cloche').textContent()) >= 2);
    await A.click('#cloche'); await A.waitForSelector('#alertes[open] .alerte-ligne');
    check('alertes: la liste dit qui demande quoi', /Hugo T\. demande une place/.test(await A.locator('#alertes-liste').textContent()) && /Chloe T\. demande une place/.test(await A.locator('#alertes-liste').textContent()));
    await A.screenshot({ path: 'o9-alertes.png' });
    await A.locator('.alerte-ligne', { hasText: 'Chloe T. demande une place' }).first().click();
    await A.waitForSelector('#mes-trajets .demandes li');
    check('alertes: un clic mène à « Mes trajets », les demandes à traiter sont signalées', await A.locator('[data-onglet=trajets]').getAttribute('aria-selected') === 'true' && /2 demandes à traiter/.test(await A.locator('#mes-trajets').textContent()));
    await A.waitForSelector('#pastille-trajets', { state: 'hidden' });
    {
      const idRes = sql(`select id from reservations where passager_id='${idHugo}'`);
      for (const m of ['Bonjour', 'Je pars de Vernon', 'Merci']) await hugo.from('messages').insert({ reservation_id: idRes, expediteur_id: idHugo, contenu: m });
      check('alertes: trois messages de suite ne créent qu\'une alerte (et un seul e-mail)', nb(`membre_id='${idAlice}' and reservation_id='${idRes}' and type='message' and not lu`) === 1);
      await anon.from('demandes_contact').insert({ nom: 'Mme Test', email: 'direction@test.fr', organisme: 'EHPAD', message: 'Bonjour' });
      check('alertes: l\'administrateur est prévenu d\'un message de contact', nb(`type='admin' and titre='Nouveau message de contact' and texte like 'Mme Test%'`) === 1);
    }

    // Refus avec motif
    await A.locator('#mes-trajets li', { hasText: 'Chloe T.' }).locator('[data-action=refuser]').click();
    await repondre(A, { choix: 'Trop de détour' }); await A.waitForSelector('.toast:has-text("prévenue")');
    check('refus: motif enregistré et transmis au passager', sql(`select statut||'|'||motif_refus from reservations where passager_id='${idChloe}'`) === 'refusee|Trop de détour' && nb(`membre_id='${idChloe}' and titre like '%pas retenu votre demande' and texte like '%Trop de détour%'`) === 1);
    await C.reload(); await C.waitForSelector('#pastille-reservations:not([hidden])'); await C.click('[data-onglet=reservations]'); await C.waitForSelector('#mes-reservations .element');
    check('refus: le passager voit le motif dans « Mes réservations »', /Motif indiqué par le conducteur : Trop de détour/.test(await C.locator('#mes-reservations').textContent()));
    r = await chloe.rpc('contacter_conducteur', { p_trajet: idTrajet2, p_message: 'encore moi' }); check('sécu: un passager refusé ne peut plus écrire au conducteur', /refusé votre demande/.test((r.error || {}).message || ''), JSON.stringify(r.error));

    // Modifier un trajet déjà publié
    const carte2 = A.locator('#mes-trajets .element', { hasText: 'arrivée 13:45' });
    await carte2.locator('[data-action=modifier]').click(); await A.waitForSelector('#annuler-modif:not([hidden])');
    check('modifier: formulaire prérempli, titre et bouton adaptés', (await A.textContent('#titre-proposer')) === 'Modifier mon trajet' && await A.inputValue('#form-trajet [name=heure_arrivee]') === '13:45' && /Enregistrer les changements/.test(await A.textContent('#publier-trajet')));
    await A.fill('#form-trajet [name=heure_depart]', '15:00'); await A.click('#publier-trajet');
    check('modifier: horaires incohérents refusés', /Vérifiez vos horaires/.test(await toast(A)));
    await A.fill('#form-trajet [name=heure_depart]', '13:10'); await A.fill('#form-trajet [name=heure_retour]', '22:00'); await A.click('#publier-trajet');
    await A.waitForSelector('.toast:has-text("Trajet modifié")');
    check('modifier: le trajet est mis à jour (pas de doublon) et le passager est prévenu', sql(`select heure_retour from trajets where id='${idTrajet2}'`) === '22:00:00' && sql('select count(*) from trajets') === '2' && nb(`membre_id='${idHugo}' and titre like '%a modifié son trajet'`) === 1);
    await A.waitForSelector('#mes-trajets .element');
    await A.locator('#mes-trajets .element', { hasText: 'retour 22:00' }).locator('[data-action=pause]').click(); await A.waitForSelector('.toast:has-text("pause")');
    check('pause: le passager est prévenu', nb(`membre_id='${idHugo}' and titre like '%a mis son trajet en pause'`) === 1);
    const H = await ouvrir(); await connecter(H, 'Hugo'); await H.waitForSelector('#espace:not([hidden])'); await H.click('[data-onglet=reservations]'); await H.waitForSelector('#mes-reservations .element');
    check('pause: visible dans « Mes réservations » du passager', /En pause/.test(await H.locator('#mes-reservations').textContent()) && /mis ce trajet en pause/.test(await H.locator('#mes-reservations').textContent()));
    await A.locator('#mes-trajets .element', { hasText: 'retour 22:00' }).locator('[data-action=supprimer]').click();
    const question = A.locator('dialog.question[open]'); await question.waitFor();
    check('supprimer: la fenêtre prévient qu\'un membre a une demande et propose la pause', /1 membre a une demande ou une place/.test(await question.textContent()) && /Mettre en pause/.test(await question.textContent()));
    await A.screenshot({ path: 'o9-supprimer.png' });
    await repondre(A); await A.waitForSelector('.toast:has-text("Trajet supprimé")');
    check('supprimer: le passager est prévenu', sql('select count(*) from trajets') === '1' && nb(`membre_id='${idHugo}' and titre like '%a supprimé son trajet'`) === 1);

    // Garde-fous
    r = await alice.from('profils').update({ prenom: 'Alicia' }).eq('id', idAlice); check('sécu: un conducteur validé ne peut plus changer son nom', /pièce d'identité/.test((r.error || {}).message || ''), JSON.stringify(r.error));
    r = await alice.from('profils').update({ ville: 'Vernon' }).eq('id', idAlice); check('profil: les autres informations restent modifiables', !r.error);
    await A.click('[data-onglet=profil]'); await A.waitForSelector('#nom-verrou:not([hidden])');
    check('profil: nom verrouillé et expliqué à l\'écran', await A.locator('#form-profil [name=nom]').evaluate((e) => e.readOnly));
    {
      const idAvis = sql('select id from avis limit 1'); sql(`update avis set masque = true where id='${idAvis}'`);
      r = await bob.rpc('laisser_avis', { p_reservation: sql(`select reservation_id from avis where id='${idAvis}'`), p_note: 1, p_commentaire: 'je le remets' });
      check('sécu: un avis masqué par l\'administration le reste si son auteur le modifie', !r.error && sql(`select masque from avis where id='${idAvis}'`) === 't', JSON.stringify(r.error));
    }
    r = await chloe.rpc('creer_invitation'); check('sécu: un membre entré par invitation ne peut pas inviter à son tour', /réservées aux membres vérifiés par un code/.test((r.error || {}).message || ''));
    await C.click('[data-onglet=profil]'); await C.waitForSelector('#form-mdp');
    check('profil: bloc d\'invitation masqué pour un membre invité', await C.locator('#bloc-invitations').isHidden());
    r = await bob.rpc('fiche_membre', { p_membre: idChloe });
    check('fiche: mode de vérification et établissement « déclaré » distingués', r.data && r.data.methode_verif === 'invitation' && r.data.etablissement_verifie === false && (await bob.rpc('fiche_membre', { p_membre: idAlice })).data.etablissement_verifie === true);

    // Documents : la décision est refusée tant qu'un fichier reste dans le stockage
    const pdf = fs.readFileSync(JUSTIF);
    for (const n of ['permis', 'identite']) { const u = await hugo.storage.from('documents-conducteur').upload(`${idHugo}/${n}.pdf`, pdf, { contentType: 'application/pdf' }); if (u.error) console.log('   dépôt:', u.error.message); }
    r = await hugo.rpc('soumettre_documents_conducteur', { p_permis: `${idHugo}/permis.pdf`, p_identite: `${idHugo}/identite.pdf`, p_type: 'cni' }); check('documents de Hugo déposés', !r.error, r.error && r.error.message);
    r = await adm.rpc('admin_valider_conducteur', { p_membre: idHugo, p_valider: true });
    check('sécu: impossible de décider tant que les documents ne sont pas effacés', /pas pu être effacés/.test((r.error || {}).message || '') && sql(`select conducteur_statut from profils where id='${idHugo}'`) === 'en_attente');
    r = await zed.storage.from('documents-conducteur').upload(`${idZed}/x.pdf`, pdf, { contentType: 'application/pdf' }); check('sécu: dépôt de permis refusé à un compte non vérifié', !!r.error);
    await admin.reload(); await admin.waitForSelector('#bord-chiffres .chiffre'); await admin.click('[data-onglet=membres]'); await admin.selectOption('#filtre-statut', 'conducteurs');
    const ligneH = admin.locator(`#membres tr:has-text("${mail('Hugo')}")`); await ligneH.waitFor();
    await ligneH.locator('[data-action=conducteur-non]').click(); await repondre(admin, { choix: 'Permis illisible' }); await admin.waitForSelector('.toast');
    await admin.waitForTimeout(800);
    check('refus conducteur: fichiers effacés, motif enregistré et transmis', sql(`select conducteur_statut||'|'||conducteur_motif from profils where id='${idHugo}'`).startsWith('refuse|Permis illisible') && sql("select count(*) from storage.objects where bucket_id='documents-conducteur'") === '0' && nb(`membre_id='${idHugo}' and texte like 'Motif : Permis illisible%'`) === 1, sql(`select conducteur_statut||'|'||coalesce(conducteur_motif,'-') from profils where id='${idHugo}'`));
    await H.reload(); await H.waitForSelector('#espace:not([hidden])'); await H.click('[data-onglet=proposer]'); await H.waitForSelector('#conducteur-etat:not([hidden])');
    check('refus conducteur: le membre lit le motif', /Motif : Permis illisible/.test(await H.locator('#conducteur-etat').textContent()));

    // Fichiers oubliés dans le stockage
    await hugo.storage.from('photos').upload(`${idHugo}/vieux.jpg`, Buffer.from('ffd8ffe000104a464946', 'hex'), { contentType: 'image/jpeg' });
    sql("update storage.objects set created_at = now() - interval '2 hours' where name like '%vieux.jpg'");
    r = await adm.rpc('fichiers_orphelins'); const orphelins = r.data || [];
    check('entretien: l\'administration retrouve les fichiers oubliés, pas les autres membres', orphelins.some((o) => o.chemin === `${idHugo}/vieux.jpg` && o.bucket === 'photos') && ((await bob.rpc('fichiers_orphelins')).data || []).length === 0, JSON.stringify(r.error || orphelins));

    // Lecture directe limitée, réglages privés, version
    r = await dan.from('trajets').select('*'); const rb = await bob.from('trajets').select('*');
    check('sécu: un membre ne lit directement que ses trajets et ceux qu\'il a réservés', (r.data || []).length === 0 && (rb.data || []).length === 1);
    r = await bob.from('reglages_prives').select('*'); const ra = await anon.from('reglages_prives').select('*');
    check('sécu: la clé du service d\'e-mails est illisible', (!!r.error || r.data.length === 0) && (!!ra.error || ra.data.length === 0));
    r = await bob.from('notifications').select('membre_id'); const maj = await bob.from('notifications').update({ titre: 'x' }).neq('titre', '');
    check('sécu: chacun ne lit que ses alertes et ne peut pas les modifier', r.data.length > 0 && r.data.every((n) => n.membre_id === idBob) && !!maj.error);
    r = await bob.rpc('notifier', { p_membre: idAlice, p_type: 'x', p_onglet: 'trajets', p_titre: 'faux' }); check('sécu: impossible de fabriquer une alerte pour un autre', !!r.error);
    r = await anon.rpc('version_base'); check('version: la base annonce la version attendue par le site', r.data === 16 && await A.evaluate(() => Zoe.VERSION_BASE) === 16);

    // Compléments issus de la relecture
    r = await bob.from('profils').update({ prenom: 'Bobby' }).eq('id', idBob); check('sécu: nom verrouillé aussi après un contrôle sur justificatif', /justificatif ou votre pièce/.test((r.error || {}).message || ''), JSON.stringify(r.error));
    r = await adm.rpc('admin_definir_role', { p_membre: idZed, p_role: 'admin' }); check('sécu: pas de rôle d\'administrateur pour un compte non vérifié', /Validez d'abord ce membre/.test((r.error || {}).message || '') && sql(`select statut||'|'||role from profils where id='${idZed}'`) === 'en_attente|membre');
    await anon.from('demandes_contact').insert({ nom: 'Robot 1', email: 'robot@test.fr', message: 'x' }); await anon.from('demandes_contact').insert({ nom: 'Robot 2', email: 'robot@test.fr', message: 'x' });
    check('sécu: une rafale de messages de contact ne crée qu\'une alerte (donc un seul e-mail) par administrateur', nb(`type='admin' and titre='Nouveau message de contact' and not lu`) === 1);
    {
      // Une demande de place non lue ne doit pas étouffer les alertes de messages suivantes
      const idTrajet1 = sql("select id from trajets where heure_arrivee='06:40'");
      sql(`update trajets set places = 3 where id='${idTrajet1}'`);
      const dan2 = await client('Dan'); r = await dan2.rpc('demander_reservation', { p_trajet: idTrajet1, p_message: 'Bonjour, une place ?' });
      const idRes = sql(`select id from reservations where passager_id='${idDe('Dan')}'`);
      check('alertes: demande avec message = une seule alerte', !r.error && nb(`reservation_id='${idRes}' and membre_id='${idAlice}'`) === 1, JSON.stringify(r.error));
      await dan2.from('messages').insert({ reservation_id: idRes, expediteur_id: idDe('Dan'), contenu: 'Je précise mon adresse' });
      check('alertes: un message envoyé plus tard est signalé même si la demande n\'a pas été lue', nb(`reservation_id='${idRes}' and membre_id='${idAlice}' and type='message' and not lu`) === 1);
      await alice.rpc('marquer_lu', { p_reservation: idRes });
      check('alertes: lire la conversation marque aussi l\'alerte de demande comme lue', nb(`reservation_id='${idRes}' and membre_id='${idAlice}' and not lu`) === 0);
      r = await alice.rpc('repondre_reservation', { p_reservation: idRes, p_accepter: true });
      r = await alice.from('trajets').update({ places: 1 }).eq('id', idTrajet1);
      check('trajet: impossible de proposer moins de places que de passagers acceptés', /déjà accepté 2 passager/.test((r.error || {}).message || ''), JSON.stringify(r.error));
      r = await dan2.rpc('annuler_reservation', { p_reservation: idRes }); sql(`delete from reservations where id='${idRes}'`);
      check('alertes: une conversation supprimée ne laisse aucune alerte non lue', nb(`reservation_id='${idRes}' and not lu`) === 0);
      r = await alice.from('trajets').update({ places: 1 }).eq('id', idTrajet1); check('trajet: nombre de places remis à 1', !r.error);
    }
    check('erreurs: les messages anglais du service de comptes sont traduits', (await A.evaluate(() => ['New password should be different from the old password.', 'For security purposes, you can only request this after 42 seconds.', 'Something is not right.'].map((m) => Zoe.messageErreur(new Error(m))))).every((m) => /[éèàê]|Patientez/.test(m)));
    r = await adm.rpc('etat_emails'); const rb2 = await bob.rpc('etat_emails');
    check('entretien: l\'administration voit si les e-mails partent (clé présente, envois comptés)', r.data && r.data.cle === true && r.data.envois > 0 && r.data.echecs === 0 && !!rb2.error, JSON.stringify(r.data || r.error));
    {
      const p = await ouvrir(); await p.goto(`${BASE}/connexion.html#inscription`); const f = p.locator('#form-inscription');
      await f.locator('[name=prenom]').fill('Alice'); await f.locator('[name=nom]').fill('Bis'); await f.locator('[name=email]').fill(mail('Alice')); await f.locator('[name=mdp]').fill('motdepasse123');
      await f.locator('[name=categorie]').selectOption('esi'); await f.locator('[name=etablissement]').fill('IFSI'); await f.locator('[name=accord]').check(); await f.locator('[type=submit]').click();
      const vu = await p.waitForSelector('.toast:has-text("existe déjà")', { timeout: 8000 }).then(() => true, () => false);
      check('inscription: une adresse déjà utilisée est signalée au lieu d\'annoncer un code qui n\'arrivera pas', vu && await p.locator('#form-code').isHidden());
      await p.close();
    }
    {
      // Un compte non vérifié peut supprimer son compte
      const p = await ouvrir(); await connecter(p, 'Eve'); await p.waitForSelector('#verification:not([hidden])');
      await p.click('#verification [data-supprimer-compte]'); await repondre(p); await p.waitForURL('**/index.html');
      check('suppression de compte: possible avant la vérification', sql(`select count(*) from profils where email='${mail('Eve')}'`) === '0');
      await p.close();
    }

    // Préférence « pas d'e-mail »
    await fetch(BOITE + '/vider'); r = await alice.from('profils').update({ notif_email: false }).eq('id', idAlice);
    sql(`select notifier('${idAlice}','essai','recherche','Essai sans e-mail')`); await new Promise((x) => setTimeout(x, 2500));
    check('préférence: sans accord, l\'alerte reste sur le site et aucun e-mail ne part', !r.error && (await emails()).length === 0 && nb(`membre_id='${idAlice}' and type='essai'`) === 1);
    await alice.from('profils').update({ notif_email: true }).eq('id', idAlice);

    // Pannes : pas de déconnexion, messages en français, panne notée
    {
      const p = await ouvrir(); await connecter(p, 'Alice'); await p.waitForSelector('#espace:not([hidden])');
      await p.route('**/rest/v1/profils**', (x) => x.abort()); await p.reload(); await p.waitForSelector('#panne');
      const garde = await p.evaluate(() => Object.keys(localStorage).some((k) => /auth-token/.test(k)));
      check('panne: une coupure au chargement ne déconnecte plus, un bouton propose de réessayer', p.url().includes('espace.html') && garde && /Réessayer/.test(await p.textContent('#panne')));
      await p.screenshot({ path: 'o9-panne.png' });
      await p.unroute('**/rest/v1/profils**'); await p.click('#panne button'); await p.waitForSelector('#espace:not([hidden])');
      check('panne: « Réessayer » rouvre l\'espace', true);
      const fr = await p.evaluate(() => [Zoe.messageErreur(new Error('duplicate key value violates unique constraint "x"')), Zoe.messageErreur(new Error('Ce trajet est complet.'))]);
      await p.waitForTimeout(1200);
      check('erreurs: jamais d\'anglais technique à l\'écran, et la panne est notée pour le suivi', /^Une erreur est survenue/.test(fr[0]) && fr[1] === 'Ce trajet est complet.' && Number(sql("select count(*) from erreurs_client where message like 'duplicate key%'")) === 1);
      await p.close();
    }
    {
      // Le code reçu par QR code n'est pas perdu si l'envoi échoue
      await D0.evaluate((c) => localStorage.setItem('zoe.acces', JSON.stringify({ type: 'code', code: c })), code);
      await D0.route('**/rest/v1/rpc/utiliser_code', (x) => x.abort()); await D0.reload(); await D0.waitForSelector('.toast');
      check('QR code: le code est gardé si la connexion coupe pendant sa validation', await D0.evaluate(() => !!localStorage.getItem('zoe.acces')));
      await D0.unroute('**/rest/v1/rpc/utiliser_code'); await D0.evaluate(() => localStorage.removeItem('zoe.acces'));
    }
    // Téléphone : les six onglets visibles sans faire défiler
    await A.setViewportSize({ width: 360, height: 780 }); await A.click('[data-onglet=rechercher]'); await A.waitForTimeout(300);
    const onglets = await A.evaluate(() => [...document.querySelectorAll('#onglets button')].map((b) => { const x = b.getBoundingClientRect(); return x.left >= 0 && x.right <= innerWidth && x.width > 40; }));
    check('téléphone (360 px): les six onglets sont visibles, sans défilement horizontal', onglets.length === 6 && onglets.every(Boolean) && !(await A.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await A.screenshot({ path: 'o9-onglets-360.png' }); await A.setViewportSize({ width: 1280, height: 900 });
  }

  // 12. Suspension et suppression de compte
  await admin.selectOption('#filtre-statut', 'verifie');
  const ligneC = admin.locator(`#membres tr:has-text("${mail('Chloe')}")`);
  await ligneC.locator('[data-action=suspendu]').click(); await repondre(admin); await admin.waitForSelector('.toast');
  await C.reload(); await C.waitForSelector('#etat-verification:not([hidden])');
  check('suspension: accès coupé', /suspendu/.test(await C.locator('#etat-verification').textContent()) && await C.locator('#methodes').isHidden());
  {
    const chloe = await client('Chloe'); let r = await chloe.rpc('supprimer_mon_compte');
    const c2 = createClient(URL_SB, KEY, { auth: { persistSession: false } }); await c2.auth.signUp({ email: mail('Chloe'), password: 'motdepasse123', options: { data: { prenom: 'Chloe', nom: 'Test', categorie: 'esi' } } });
    check('suspension: supprimer puis recréer son compte avec la même adresse ne lève pas la suspension', !r.error && sql(`select statut from profils where email='${mail('Chloe')}'`) === 'suspendu', JSON.stringify(r.error));
  }
  await B.click('[data-onglet=profil]'); await B.click('#supprimer-compte'); await repondre(B); await B.waitForURL('**/index.html');
  check('suppression de compte: la conductrice est prévenue que la place se libère', sql(`select count(*) from notifications n join profils p on p.id = n.membre_id where p.email='${mail('Alice')}' and n.titre = 'Bob T. a annulé sa place'`) === '1');
  check('suppression de compte: profil et réservation effacés', sql(`select count(*) from profils where email='${mail('Bob')}'`) === '0' && sql(`select count(*) from auth.users where email='${mail('Bob')}'`) === '0');

  // Tableau de bord de l'administration
  await admin.reload(); await admin.waitForSelector('#bord-chiffres .chiffre');
  const bord = (await admin.locator('#bord-chiffres').textContent()).replace(/\s+/g, ' ');
  console.log('   tableau de bord:', bord);
  const attendu = { verifies: sql("select count(*) from profils where role='membre' and statut='verifie'"), conducteurs: sql("select count(*) from profils where conducteur_statut='valide'"), trajets: sql("select count(*) from trajets where actif and date_fin >= current_date") };
  check('tableau de bord: chiffres conformes à la base', new RegExp(`${attendu.verifies} ?Membres vérifiés`).test(bord) && new RegExp(`${attendu.conducteurs} ?Conducteurs validés`).test(bord) && new RegExp(`${attendu.trajets} ?Trajets proposés`).test(bord), JSON.stringify(attendu));
  check('tableau de bord: ouvert par défaut, semaines et parcours listés', await admin.locator('[data-onglet=bord]').getAttribute('aria-selected') === 'true' && await admin.locator('#bord-semaines tr').count() === 8 && /Vernon → Évreux/.test(await admin.locator('#bord-offres').textContent()));
  await admin.addStyleTag({ content: '.header{position:static!important}' }); await admin.screenshot({ path: 'la-bord.png', fullPage: true });
  await admin.setViewportSize({ width: 390, height: 850 }); await admin.waitForTimeout(300); console.log('   tableau de bord mobile déborde:', await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth)); await admin.setViewportSize({ width: 1280, height: 900 });
  await admin.click('[data-onglet=membres]');

  // Captures
  await A.click('[data-onglet=rechercher]'); await A.screenshot({ path: 'cap-espace.png' });
  await A.click('[data-onglet=trajets]'); await A.waitForTimeout(600); await A.screenshot({ path: 'cap-trajets.png' });
  await D.screenshot({ path: 'cap-partenaire.png' });
  await admin.selectOption('#filtre-statut', ''); await admin.waitForTimeout(700); await admin.screenshot({ path: 'cap-admin.png' });
  await D0.screenshot({ path: 'cap-verif.png' });
  const m = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await m.route('**/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: `window.ZOE_CONFIG={url:'${URL_SB}',cle:'${KEY}'};` }));
  const mp = await m.newPage(); await connecter(mp, 'Alice'); await mp.waitForURL('**/espace.html'); await mp.waitForSelector('#espace:not([hidden])');
  await mp.click('[data-onglet=trajets]'); await mp.waitForTimeout(700);
  check('mobile: pas de défilement horizontal', !(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await mp.screenshot({ path: 'cap-mobile.png' });
  await mp.goto(BASE + '/connexion.html#inscription');

  check('sécu: aucune violation de la politique de contenu', erreurs.filter((e) => /Content Security Policy|Refused to/.test(e)).length === 0, erreurs.filter((e) => /Content Security|Refused/.test(e)).slice(0, 2).join(' | '));
  { const p = await ouvrir(); const vus = []; p.on('request', (r) => /\.(js|css)(\?|$)/.test(r.url()) && r.url().includes('8766') && vus.push(r.url().split('/').pop())); await p.goto(BASE + '/espace.html'); await p.waitForTimeout(800);
    check('cache: tous les scripts et styles portent un numéro de version', vus.length >= 5 && vus.every((u) => /\?v=\d+$/.test(u)), vus.join(' ')); }
  { const p = await ouvrir(); await p.route('https://data.geopf.fr/**', (r) => r.abort()); await connecter(p, 'Alice'); await p.waitForSelector('#espace:not([hidden])');
    await p.fill('#r-depart', 'Vern'); const secours = await p.waitForSelector('#r-depart + .suggestions button:has-text("Vernon")', { timeout: 6000 }).then(() => true, () => false);
    check('adresse: si le service d\'adresses est en panne, les communes prennent le relais', secours); }
  {
    const adm = createClient(URL_SB, KEY, { auth: { persistSession: false } }); await adm.auth.signInWithPassword({ email: mail('Admin'), password: 'motdepasse123' });
    const idAlice = sql(`select id from profils where email='${mail('Alice')}'`);
    const gina = createClient(URL_SB, KEY, { auth: { persistSession: false } }); await gina.auth.signInWithPassword({ email: mail('Gina'), password: 'motdepasse123' });
    const idTrajet = sql(`select id from trajets where conducteur_id='${idAlice}' limit 1`);
    let r = await gina.rpc('demander_reservation', { p_trajet: idTrajet, p_message: '' });
    await fetch(BOITE + '/vider');
    const r2 = await adm.rpc('admin_definir_statut', { p_membre: idAlice, p_statut: 'suspendu', p_motif: 'Essai de suspension.' });
    sql(`select notifier('${idAlice}','essai','recherche','Ne doit pas partir par e-mail')`); await new Promise((x) => setTimeout(x, 2500));
    const boite = await emails();
    check('suspension d\'une conductrice: ses trajets sont mis en pause et ses passagers prévenus', !r.error && !r2.error && sql(`select count(*) from trajets where conducteur_id='${idAlice}' and actif`) === '0' && boite.some((m) => m.to[0].email === mail('Gina') && /a mis son trajet en pause/.test(m.subject)), JSON.stringify([r.error, r2.error, boite.map((m) => m.subject)]));
    check('suspension: le membre reçoit l\'e-mail qui le concerne (motif sans double point), et plus aucun autre', boite.some((m) => m.to[0].email === mail('Alice') && /compte Meet Zoe est suspendu/.test(m.subject) && /Motif : Essai de suspension\. Pour/.test(m.htmlContent)) && !boite.some((m) => /Ne doit pas partir/.test(m.subject)));
  }
  console.log('erreurs navigateur:', erreurs.filter((e) => !/Content Security|Refused/.test(e)).slice(0, 8));
  console.log(`\n${ok} réussis, ${ko} échoués`);
  await browser.close();
})().catch((e) => { console.error('ARRET:', e.message.split('\n').slice(0, 6).join('\n')); console.log(`${ok} réussis, ${ko} échoués`); process.exit(1); });
