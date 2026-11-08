/* Dream Nails Institut — comportement du site
   Site 100 % statique : aucune requête vers un serveur, aucun cookie.
   Réservation = SMS pré-rempli (sms:) / appel (tel:) / fichier .ics généré dans le navigateur. */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const pad2 = n => String(n).padStart(2, '0');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hasGsap = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

  const BIZ = { name: 'Dream Nails Institut', tel: '+33777761013', display: '07 77 76 10 13', address: '27 cours Forbin, 13120 Gardanne' };
  // 0 = dimanche … 6 = samedi ; [ouverture, fermeture] en heures
  const HOURS = { 0: null, 1: null, 2: [9, 18], 3: [9, 18], 4: [9, 18], 5: [9, 18], 6: [9, 13] };
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const SLOT_STEP = 30;          // minutes entre deux créneaux proposés
  const LAST_START = 90;         // dernier départ : 1h30 avant la fermeture
  const SAME_DAY_NOTICE = 120;   // préavis minimal pour le jour même (minutes)
  const MONTHS_AHEAD = 3;

  let lenis = null;

  /* ------------------------------------------------------------------ */
  /* Défilement vers une ancre (Lenis si dispo, sinon natif)             */
  /* ------------------------------------------------------------------ */
  function scrollToTarget(target, offset = 0) {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    let y = null;
    if (hasGsap) {
      const st = ScrollTrigger.getAll().find(s => s.trigger === el && s.pin);
      if (st) y = st.start;
    }
    if (y === null && el.id === 'top') y = 0;
    const dest = y !== null ? y : el;
    if (lenis) {
      lenis.scrollTo(dest, { offset, duration: 1.7, easing: t => 1 - Math.pow(1 - t, 4) });
    } else if (y !== null) {
      window.scrollTo({ top: y + offset, behavior: reduce ? 'auto' : 'smooth' });
    } else {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function initAnchors() {
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const hash = a.getAttribute('href');
      if (hash.length < 2) return;
      const target = $(hash);
      if (!target) return;
      e.preventDefault();
      if (document.documentElement.classList.contains('menu-open')) window.__closeMenu && window.__closeMenu();
      scrollToTarget(target);
      try { history.replaceState(null, '', hash); } catch (_) { /* aperçu en iframe : on ignore */ }
    });
    const up = $('#toTop');
    if (up) up.addEventListener('click', () => scrollToTarget($('#top')));
  }

  /* ------------------------------------------------------------------ */
  /* Horaires + statut « ouvert / fermé » (heure de Paris)               */
  /* ------------------------------------------------------------------ */
  function parisNow() {
    const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const m = {};
    parts.forEach(p => { m[p.type] = p.value; });
    return { day: DAYS.indexOf(m.weekday.toLowerCase()), h: parseInt(m.hour, 10), min: parseInt(m.minute, 10) };
  }
  const fmtH = h => `${h}h`;

  function initHours() {
    const status = $('#status'), text = $('#statusText');
    if (!status) return;
    function update() {
      const { day, h, min } = parisNow();
      const t = h + min / 60;
      const today = HOURS[day];
      $$('#hours tr').forEach(tr => tr.classList.toggle('is-today', +tr.dataset.d === day));
      let open = false, msg = '';
      if (today && t >= today[0] && t < today[1]) {
        open = true; msg = `Ouvert maintenant · jusqu’à ${fmtH(today[1])}`;
      } else if (today && t < today[0]) {
        msg = `Fermé · ouvre aujourd’hui à ${fmtH(today[0])}`;
      } else {
        for (let i = 1; i <= 7; i++) {
          const d = (day + i) % 7;
          if (HOURS[d]) { msg = `Fermé · ouvre ${i === 1 ? 'demain' : DAYS[d]} à ${fmtH(HOURS[d][0])}`; break; }
        }
      }
      status.classList.toggle('is-open', open);
      text.textContent = msg;
    }
    update();
    setInterval(update, 60000);
  }

  /* ------------------------------------------------------------------ */
  /* Réservation sans back-end : SMS pré-rempli, appel, .ics, copie      */
  /* ------------------------------------------------------------------ */
  function initBooking() {
    const form = $('#booker');
    if (!form) return { preselect() {} };

    const panels = $$('.booker__panel', form);
    const stepLis = $$('.booker__steps li', form);
    const back = $('#bkBack'), next = $('#bkNext'), live = $('#bkLive');
    const calGrid = $('#calGrid'), calTitle = $('#calTitle'), calPrev = $('#calPrev'), calNext = $('#calNext');
    const slotsGrid = $('#slotsGrid'), slotsTitle = $('#slotsTitle');
    const fName = $('#fName'), fPhone = $('#fPhone'), fMsg = $('#fMsg');
    const recapText = $('#recapText'), smsBtn = $('#smsBtn'), icsBtn = $('#icsBtn'), copyBtn = $('#copyBtn'), after = $('#afterSend');
    const chips = $$('#chips input');
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    calGrid.removeAttribute('role');

    const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const longDate = d => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const today0 = startOfDay(new Date());
    const state = { step: 1, date: null, time: null, month: new Date(today0.getFullYear(), today0.getMonth(), 1) };
    const maxMonth = new Date(today0.getFullYear(), today0.getMonth() + MONTHS_AHEAD, 1);

    function slotsFor(date) {
      const h = HOURS[date.getDay()];
      if (!h) return [];
      const out = [];
      for (let t = h[0] * 60; t <= h[1] * 60 - LAST_START; t += SLOT_STEP) out.push(`${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`);
      if (sameDay(date, new Date())) {
        const now = new Date();
        const limit = now.getHours() * 60 + now.getMinutes() + SAME_DAY_NOTICE;
        return out.filter(s => toMin(s) >= limit);
      }
      return out;
    }
    const isBookable = date => date >= today0 && slotsFor(date).length > 0;

    /* --- Calendrier --- */
    function renderCal() {
      const y = state.month.getFullYear(), m = state.month.getMonth();
      calTitle.textContent = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(state.month);
      const offset = (new Date(y, m, 1).getDay() + 6) % 7;
      const total = new Date(y, m + 1, 0).getDate();
      calGrid.textContent = '';
      for (let i = 0; i < offset; i++) {
        const s = document.createElement('span'); s.className = 'day day--empty'; calGrid.appendChild(s);
      }
      for (let d = 1; d <= total; d++) {
        const date = new Date(y, m, d);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'day' + (sameDay(date, today0) ? ' day--today' : '') + (state.date && sameDay(date, state.date) ? ' day--sel' : '');
        b.textContent = d;
        b.disabled = !isBookable(date);
        b.setAttribute('aria-label', cap(longDate(date)) + (b.disabled ? ' (indisponible)' : ''));
        b.setAttribute('aria-pressed', state.date && sameDay(date, state.date) ? 'true' : 'false');
        b.addEventListener('click', () => { state.date = date; state.time = null; hideErr(2); renderCal(); renderSlots(); });
        calGrid.appendChild(b);
      }
      calPrev.disabled = state.month <= new Date(today0.getFullYear(), today0.getMonth(), 1);
      calNext.disabled = state.month >= maxMonth;
    }
    calPrev.addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCal(); });
    calNext.addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCal(); });

    /* --- Créneaux --- */
    function renderSlots() {
      slotsGrid.textContent = '';
      if (!state.date) { slotsTitle.textContent = 'Choisissez d’abord un jour'; return; }
      slotsTitle.textContent = cap(longDate(state.date));
      const list = slotsFor(state.date);
      if (!list.length) {
        const p = document.createElement('p'); p.className = 'slots__none'; p.textContent = 'Plus de créneau ce jour-là : choisissez un autre jour ou appelez-nous.'; slotsGrid.appendChild(p); return;
      }
      list.forEach(s => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'slot'; b.textContent = s.replace(':', 'h');
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', state.time === s ? 'true' : 'false');
        b.addEventListener('click', () => {
          state.time = s; hideErr(2);
          $$('.slot', slotsGrid).forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
        });
        slotsGrid.appendChild(b);
      });
    }

    /* --- Étapes --- */
    const showErr = n => { const e = $(`[data-err="${n}"]`, form); if (e) e.hidden = false; };
    const hideErr = n => { const e = $(`[data-err="${n}"]`, form); if (e) e.hidden = true; };
    const selectedServices = () => chips.filter(c => c.checked).map(c => c.value);

    function goto(n) {
      state.step = n;
      panels.forEach(p => { p.hidden = +p.dataset.panel !== n; });
      stepLis.forEach(li => { const s = +li.dataset.s; li.classList.toggle('is-active', s === n); li.classList.toggle('is-done', s < n); });
      back.hidden = n === 1;
      next.hidden = n === 3;
      const panel = panels[n - 1];
      if (n === 2) { renderCal(); renderSlots(); }
      if (n === 3) refreshRecap();
      live.textContent = `Étape ${n} sur 3`;
      if (hasGsap && !reduce) gsap.fromTo(panel, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: .65, ease: 'power3.out', clearProps: 'transform,opacity' });
      if (form.getBoundingClientRect().top < 0) scrollToTarget(form, -90);
      panel.setAttribute('tabindex', '-1');
      panel.focus({ preventScroll: true });
    }

    next.addEventListener('click', () => {
      if (state.step === 1) {
        if (!selectedServices().length) { showErr(1); return; }
        hideErr(1); goto(2);
      } else if (state.step === 2) {
        if (!state.date || !state.time) { showErr(2); return; }
        hideErr(2); goto(3);
      }
    });
    back.addEventListener('click', () => goto(Math.max(1, state.step - 1)));
    chips.forEach(c => c.addEventListener('change', () => hideErr(1)));
    form.addEventListener('submit', e => e.preventDefault());

    /* --- Message + récap --- */
    const phoneOk = v => { const d = v.replace(/[\s.\-()]/g, ''); return /^(?:\+33|0033|0)[1-9]\d{8}$/.test(d) || /^\+\d{8,14}$/.test(d); };

    function buildMessage() {
      const lines = [
        'Bonjour Sonia, je souhaiterais prendre rendez-vous chez Dream Nails Institut.',
        `Prestation(s) : ${selectedServices().join(', ')}`,
        `Créneau souhaité : ${longDate(state.date)} à ${state.time.replace(':', 'h')}`,
        `Prénom : ${fName.value.trim() || '…'}`,
        `Mon numéro : ${fPhone.value.trim() || '…'}`
      ];
      if (fMsg.value.trim()) lines.push(`Précision : ${fMsg.value.trim()}`);
      lines.push('Merci de me confirmer le créneau !');
      return lines.join('\n');
    }
    const smsHref = () => `sms:${BIZ.tel}${isIOS ? '&' : '?'}body=${encodeURIComponent(buildMessage())}`;

    function refreshRecap() {
      if (!state.date || !state.time) return;
      const parts = [
        `<b>Prestation(s) :</b> ${esc(selectedServices().join(', '))}`,
        `<b>Créneau souhaité :</b> ${esc(longDate(state.date))} à ${esc(state.time.replace(':', 'h'))}`
      ];
      if (fName.value.trim()) parts.push(`<b>Prénom :</b> ${esc(fName.value.trim())}`);
      if (fPhone.value.trim()) parts.push(`<b>Mobile :</b> ${esc(fPhone.value.trim())}`);
      if (fMsg.value.trim()) parts.push(`<b>Précision :</b> ${esc(fMsg.value.trim())}`);
      recapText.innerHTML = parts.join('<br>');
      smsBtn.setAttribute('href', smsHref());
    }
    [fName, fPhone, fMsg].forEach(f => f.addEventListener('input', () => {
      if (f === fName) { fName.removeAttribute('aria-invalid'); $('[data-ferr="name"]').hidden = true; }
      if (f === fPhone) { fPhone.removeAttribute('aria-invalid'); $('[data-ferr="phone"]').hidden = true; }
      refreshRecap();
    }));

    function validateContact() {
      let ok = true;
      const nameOk = fName.value.trim().length >= 2;
      fName.setAttribute('aria-invalid', String(!nameOk)); $('[data-ferr="name"]').hidden = nameOk;
      const pOk = phoneOk(fPhone.value.trim());
      fPhone.setAttribute('aria-invalid', String(!pOk)); $('[data-ferr="phone"]').hidden = pOk;
      if (!nameOk) { fName.focus(); ok = false; } else if (!pOk) { fPhone.focus(); ok = false; }
      return ok;
    }

    smsBtn.addEventListener('click', e => {
      if (!validateContact()) { e.preventDefault(); return; }
      smsBtn.setAttribute('href', smsHref());
      after.hidden = false;
    });

    function flash(btn, label) {
      const span = $('.btn__label', btn); const old = span.textContent;
      span.textContent = label; setTimeout(() => { span.textContent = old; }, 2200);
    }
    copyBtn.addEventListener('click', async () => {
      if (!validateContact()) return;
      const text = buildMessage();
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (__) { /* rien */ } ta.remove();
      }
      flash(copyBtn, 'Copié ✓'); after.hidden = false;
    });

    /* --- Fichier agenda (.ics) généré localement --- */
    const icsStamp = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
    const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const fold = line => { const out = []; let l = line; while (l.length > 73) { out.push(l.slice(0, 73)); l = ' ' + l.slice(73); } out.push(l); return out.join('\r\n'); };

    icsBtn.addEventListener('click', () => {
      if (!state.date || !state.time) return;
      const [h, m] = state.time.split(':').map(Number);
      const start = new Date(state.date.getFullYear(), state.date.getMonth(), state.date.getDate(), h, m);
      const end = new Date(start.getTime() + 90 * 60000);
      const now = new Date();
      const nowUtc = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;
      const desc = `Demande de rendez-vous à confirmer avec Sonia (${BIZ.display}).\nPrestation(s) : ${selectedServices().join(', ')}\nDurée indicative.`;
      const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dream Nails Institut//Reservation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${now.getTime()}-${Math.random().toString(36).slice(2, 8)}@dream-nails-institut`,
        `DTSTAMP:${nowUtc}`,
        `DTSTART:${icsStamp(start)}`,
        `DTEND:${icsStamp(end)}`,
        fold(`SUMMARY:${icsEsc('Dream Nails Institut — RDV à confirmer')}`),
        fold(`LOCATION:${icsEsc(BIZ.address)}`),
        fold(`DESCRIPTION:${icsEsc(desc)}`),
        'STATUS:TENTATIVE',
        'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Rendez-vous Dream Nails Institut', 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR'
      ].join('\r\n');
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'rdv-dream-nails.ics';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      flash(icsBtn, 'Fichier prêt ✓');
    });

    /* --- Pré-sélection depuis les cartes « Prestations » --- */
    function preselect(id) {
      chips.forEach(c => { c.checked = c.dataset.id === id ? true : c.checked; });
      hideErr(1);
      if (state.step !== 1) goto(1);
      scrollToTarget($('#reserver'));
    }
    $$('[data-book]').forEach(b => b.addEventListener('click', () => preselect(b.dataset.book)));

    renderCal(); renderSlots();
    return { preselect };
  }

  /* ------------------------------------------------------------------ */
  /* Lightbox de la galerie                                              */
  /* ------------------------------------------------------------------ */
  function initLightbox() {
    const lb = $('#lightbox'); if (!lb) return;
    const items = $$('.gal__btn');
    const img = $('#lbImg'), cap = $('#lbCap');
    const btnClose = $('#lbClose'), btnPrev = $('#lbPrev'), btnNext = $('#lbNext');
    let cur = 0, last = null;

    const show = () => {
      const b = items[cur];
      img.src = b.dataset.full; img.alt = $('img', b).alt; cap.textContent = b.closest('.gal').dataset.cap || '';
    };
    const open = i => {
      last = document.activeElement; cur = i; show();
      lb.hidden = false; document.body.style.overflow = 'hidden'; lenis && lenis.stop();
      if (hasGsap && !reduce) gsap.fromTo(lb, { opacity: 0 }, { opacity: 1, duration: .5, ease: 'power2.out' });
      btnClose.focus();
    };
    const close = () => {
      lb.hidden = true; document.body.style.overflow = ''; lenis && lenis.start();
      last && last.focus();
    };
    const step = d => { cur = (cur + d + items.length) % items.length; show(); if (hasGsap && !reduce) gsap.fromTo(img, { opacity: 0, x: d * 30 }, { opacity: 1, x: 0, duration: .5, ease: 'power3.out' }); };

    items.forEach((b, i) => b.addEventListener('click', () => open(i)));
    btnClose.addEventListener('click', close);
    btnPrev.addEventListener('click', () => step(-1));
    btnNext.addEventListener('click', () => step(1));
    lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('lightbox__fig')) close(); });
    document.addEventListener('keydown', e => {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Tab') {
        const f = [btnClose, btnPrev, btnNext];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Nuancier interactif                                                 */
  /* ------------------------------------------------------------------ */
  function initNuancier() {
    const section = $('#nuancier'); if (!section) return;
    const btns = $$('.swatch', section), imgs = $$('.nuancier__frame img', section);
    let cur = 0, timer = null, touched = false;
    function set(i, user) {
      cur = i;
      btns.forEach((b, k) => { b.classList.toggle('is-active', k === i); b.setAttribute('aria-pressed', String(k === i)); });
      imgs.forEach((im, k) => im.classList.toggle('is-active', k === i));
      section.style.setProperty('--tint', btns[i].dataset.color);
      if (user) { touched = true; clearInterval(timer); }
    }
    btns.forEach((b, i) => {
      b.addEventListener('click', () => set(i, true));
      b.addEventListener('focus', () => set(i, true));
      if (finePointer) b.addEventListener('mouseenter', () => set(i, true));
    });
    if (reduce || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(([en]) => {
      clearInterval(timer);
      if (en.isIntersecting && !touched) timer = setInterval(() => set((cur + 1) % btns.length), 4200);
    }, { threshold: .35 }).observe(section);
  }

  /* ------------------------------------------------------------------ */
  /* Carrousel d'avis (glisser, flèches, points, lecture auto)           */
  /* ------------------------------------------------------------------ */
  function initReviews() {
    const vp = $('#revViewport'), track = $('#revTrack'); if (!vp || !track) return;
    if (!hasGsap) { vp.style.overflowX = 'auto'; return; }
    const cards = $$('.rev', track), dotsWrap = $('#revDots');
    let idx = 0, positions = [], max = 0, auto = null, dragged = false, interacted = false;

    cards.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-label', `Avis ${i + 1}`);
      b.addEventListener('click', () => goTo(i, true)); dotsWrap.appendChild(b);
    });
    const dots = $$('button', dotsWrap);

    function measure() {
      const padL = parseFloat(getComputedStyle(vp).paddingLeft) || 0;
      positions = cards.map(c => c.offsetLeft - cards[0].offsetLeft);
      max = Math.max(0, track.scrollWidth - (vp.clientWidth - padL));
    }
    const clampX = v => Math.max(-max, Math.min(0, v));
    function paint() { dots.forEach((d, i) => { d.classList.toggle('is-active', i === idx); d.setAttribute('aria-selected', String(i === idx)); }); }
    function goTo(i, user) {
      idx = (i + cards.length) % cards.length;
      if (user) { interacted = true; clearInterval(auto); }
      gsap.to(track, { x: clampX(-positions[idx]), duration: 1.1, ease: 'expo.out', overwrite: true });
      paint();
    }
    $('#revPrev').addEventListener('click', () => goTo(idx - 1, true));
    $('#revNext').addEventListener('click', () => goTo(idx + 1, true));
    vp.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(idx + 1, true); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(idx - 1, true); }
    });

    let startX = 0, startTx = 0, down = false;
    vp.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down = true; dragged = false; startX = e.clientX; startTx = gsap.getProperty(track, 'x');
    });
    window.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) > 6) { dragged = true; vp.classList.add('is-drag'); gsap.killTweensOf(track); }
      if (dragged) {
        let nx = startTx + dx;
        if (nx > 0) nx *= .35;
        if (nx < -max) nx = -max + (nx + max) * .35;
        gsap.set(track, { x: nx });
      }
    });
    window.addEventListener('pointerup', e => {
      if (!down) return; down = false; vp.classList.remove('is-drag');
      if (!dragged) return;
      const dx = e.clientX - startX;
      const x = gsap.getProperty(track, 'x');
      let best = 0, bd = Infinity;
      positions.forEach((p, i) => { const d = Math.abs(-p - x); if (d < bd) { bd = d; best = i; } });
      if (Math.abs(dx) > 70 && best === idx) best = Math.max(0, Math.min(cards.length - 1, idx + (dx < 0 ? 1 : -1)));
      goTo(best, true);
    });
    vp.addEventListener('click', e => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } }, true);
    vp.addEventListener('dragstart', e => e.preventDefault());

    measure(); paint();
    window.addEventListener('resize', () => { measure(); gsap.set(track, { x: clampX(-positions[idx]) }); });
    window.addEventListener('load', measure);
    if (document.fonts) document.fonts.ready.then(measure);

    if (!reduce && 'IntersectionObserver' in window) {
      new IntersectionObserver(([en]) => {
        clearInterval(auto);
        if (en.isIntersecting && !interacted) auto = setInterval(() => goTo(idx + 1 >= cards.length ? 0 : idx + 1), 5500);
      }, { threshold: .4 }).observe(vp);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Découpe de texte (mots / lettres) avec masque                       */
  /* ------------------------------------------------------------------ */
  function splitText(el, mode) {
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    const inner = [];
    const walk = node => {
      Array.from(node.childNodes).forEach(n => {
        if (n.nodeType === 3) {
          if (!n.textContent.trim()) return;
          const frag = document.createDocumentFragment();
          n.textContent.split(/([ \t\n\r]+)/).forEach(part => {
            if (!part) return;
            if (/^[ \t\n\r]+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
            const units = mode === 'chars' ? Array.from(part) : [part];
            units.forEach(u => {
              const m = document.createElement('span'); m.className = 'ch-mask';
              const i = document.createElement('span'); i.className = 'ch'; i.textContent = u;
              m.appendChild(i); w.appendChild(m); inner.push(i);
            });
            frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(el);
    return inner;
  }

  /* ------------------------------------------------------------------ */
  /* Préchargeur → entrée spectaculaire                                  */
  /* ------------------------------------------------------------------ */
  function runLoader(onReveal) {
    const loader = $('#loader');
    if (!loader) { onReveal(); return; }
    if (reduce || !hasGsap) { loader.remove(); onReveal(); return; }

    const fill = $('.loader__fill'), shine = $('.loader__shine'), count = $('#loaderCount');
    const bloom = $('.loader__bloom'), panel = $('.loader__panel');
    const obj = { v: 0 };
    gsap.set(fill, { y: 160 });
    gsap.set(shine, { opacity: 0 });

    const ready = Promise.race([
      Promise.all([
        new Promise(r => (document.readyState === 'complete' ? r() : window.addEventListener('load', r, { once: true }))),
        document.fonts ? document.fonts.ready : Promise.resolve()
      ]),
      new Promise(r => setTimeout(r, 6500))
    ]);

    const tl = gsap.timeline();
    tl.from('.loader__nail', { scale: .85, opacity: 0, duration: .9, ease: 'power3.out' }, 0)
      .from('.loader__script', { y: 34, opacity: 0, duration: 1, ease: 'power3.out' }, .1)
      .from('.loader__sub', { y: 12, opacity: 0, duration: .8, ease: 'power3.out' }, .3)
      .to(obj, { v: 100, duration: 2.1, ease: 'power1.inOut', onUpdate: () => { count.textContent = Math.round(obj.v); } }, .15)
      .to(fill, { y: 0, duration: 2.1, ease: 'power1.inOut' }, .15)
      .to(shine, { opacity: 1, duration: .6 }, 1.9);

    tl.eventCallback('onComplete', () => ready.then(exit));

    function exit() {
      const R = Math.hypot(innerWidth, innerHeight) / 20;
      const out = gsap.timeline({ onComplete: () => loader.remove() });
      out.to(bloom, { scale: R, duration: 1.05, ease: 'power3.in' });
      out.add(() => { loader.style.background = '#a8102f'; loader.classList.add('is-leaving'); panel.style.display = 'none'; bloom.style.display = 'none'; });
      out.add(() => onReveal());
      out.to(loader, { y: -(innerHeight + innerWidth * .15 + 30), duration: 1.25, ease: 'expo.inOut' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mode allégé (prefers-reduced-motion ou GSAP indisponible)           */
  /* ------------------------------------------------------------------ */
  function initLite() {
    const nav = $('#nav'), fab = $('#fab'), bar = $('#progress');
    const video = $('.hero__video');
    if (video) { video.removeAttribute('autoplay'); try { video.pause(); } catch (_) { /* rien */ } }
    function onScroll() {
      const y = window.scrollY, h = document.documentElement.scrollHeight - innerHeight;
      nav.classList.toggle('nav--solid', y > 60);
      if (bar) bar.style.transform = `scaleX(${h > 0 ? y / h : 0})`;
      fab && fab.classList.toggle('is-on', y > innerHeight * .7);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    initMenu();
  }

  /* ------------------------------------------------------------------ */
  /* Menu mobile plein écran                                             */
  /* ------------------------------------------------------------------ */
  function initMenu() {
    const burger = $('#burger'), menu = $('#menu'); if (!burger || !menu) return;
    let isOpen = false;
    menu.inert = true;
    function set(force) {
      isOpen = typeof force === 'boolean' ? force : !isOpen;
      burger.setAttribute('aria-expanded', String(isOpen));
      burger.setAttribute('aria-label', isOpen ? 'Fermer le menu' : 'Ouvrir le menu');
      menu.setAttribute('aria-hidden', String(!isOpen));
      menu.inert = !isOpen;
      document.documentElement.classList.toggle('menu-open', isOpen);
      lenis && (isOpen ? lenis.stop() : lenis.start());
      document.body.style.overflow = isOpen ? 'hidden' : '';
      if (!hasGsap || reduce) { menu.style.visibility = isOpen ? 'visible' : 'hidden'; menu.style.clipPath = 'none'; return; }
      const r = burger.getBoundingClientRect();
      const at = `${Math.round(r.left + r.width / 2)}px ${Math.round(r.top + r.height / 2)}px`;
      const R = Math.round(Math.hypot(innerWidth, innerHeight));
      if (isOpen) {
        gsap.set(menu, { visibility: 'visible', clipPath: `circle(0px at ${at})` });
        gsap.to(menu, { clipPath: `circle(${R}px at ${at})`, duration: 1.1, ease: 'expo.out' });
        gsap.fromTo('.menu__nav a', { yPercent: 110 }, { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: .07, delay: .18 });
        gsap.fromTo('.menu__foot', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: .9, delay: .5, ease: 'power3.out' });
      } else {
        gsap.to(menu, { clipPath: `circle(0px at ${at})`, duration: .75, ease: 'expo.inOut', onComplete: () => gsap.set(menu, { visibility: 'hidden' }) });
      }
    }
    window.__closeMenu = () => isOpen && set(false);
    burger.addEventListener('click', () => set());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) { set(false); burger.focus(); } });
    matchMedia('(min-width: 900px)').addEventListener('change', e => { if (e.matches && isOpen) set(false); });
  }

  /* ------------------------------------------------------------------ */
  /* Mouvement : Lenis + GSAP/ScrollTrigger                              */
  /* ------------------------------------------------------------------ */
  function initMotion() {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    lenis = new Lenis({ duration: 1.15, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();

    initMenu();

    /* split de tous les titres */
    const heroChars = [];
    const reveals = [];
    $$('[data-split]').forEach(el => {
      const targets = splitText(el, el.dataset.split);
      if (el.closest('.hero')) heroChars.push(...targets); else reveals.push({ el, targets, mode: el.dataset.split });
    });

    /* --- Barre de progression --- */
    gsap.to('#progress', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: .2 } });

    /* --- Navigation : se cache en descendant, revient en remontant --- */
    const nav = $('#nav');
    ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate(self) {
        const y = self.scroll();
        nav.classList.toggle('nav--solid', y > 60);
        if (self.direction === 1 && y > 320) nav.classList.add('nav--hide');
        else if (self.direction === -1 || y < 320) nav.classList.remove('nav--hide');
      }
    });
    nav.addEventListener('focusin', () => nav.classList.remove('nav--hide'));

    /* --- Bouton flottant mobile --- */
    const fab = $('#fab');
    let inBook = false, pastHero = false;
    const fabUpdate = () => fab.classList.toggle('is-on', pastHero && !inBook);
    ScrollTrigger.create({ trigger: '.hero', start: 'bottom 70%', end: 'max', onToggle: s => { pastHero = s.isActive; fabUpdate(); } });
    ScrollTrigger.create({ trigger: '#reserver', start: 'top 85%', end: 'bottom 15%', onToggle: s => { inBook = s.isActive; fabUpdate(); } });

    /* --- Hero : intro (timeline en pause tant que le préchargeur couvre l'écran) --- */
    const heroIn = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } });
    heroIn
      .from('.hero__media', { scale: 1.3, duration: 2.6 }, 0)
      .from('.hero__shade', { opacity: 0, duration: 1.6, ease: 'power2.out' }, 0)
      .from(heroChars, { yPercent: 125, rotate: 7, duration: 1.4, stagger: .05 }, .15)
      .from('[data-hero-in]', { y: 34, opacity: 0, duration: 1.2, stagger: .12, ease: 'power3.out' }, .55)
      .from('.hero__card .almond, .hero__card .arch', { yPercent: 28, opacity: 0, scale: .86, duration: 1.7, stagger: .18 }, .35)
      .from('.nav > *', { y: -22, opacity: 0, duration: 1, stagger: .08, ease: 'power3.out' }, .8);

    /* --- Hero : parallax multicouche au scroll --- */
    const heroSt = { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true };
    gsap.to('.hero__media', { yPercent: 14, ease: 'none', scrollTrigger: heroSt });
    gsap.to('.hero__inner', { yPercent: -16, opacity: .2, ease: 'none', scrollTrigger: heroSt });
    gsap.to('.hero__glow', { yPercent: 40, ease: 'none', scrollTrigger: heroSt });
    $$('[data-hero-card]').forEach(c => gsap.to(c, { yPercent: -(+c.dataset.depth) * 1.6, ease: 'none', scrollTrigger: heroSt }));
    $$('.hero__sparkles svg').forEach(s => gsap.to(s, { yPercent: -(+s.dataset.depth) * 2.4, ease: 'none', scrollTrigger: heroSt }));

    /* Hero : parallax à la souris */
    if (finePointer) {
      const layers = [...$$('[data-hero-card]'), ...$$('.hero__sparkles svg')].map(el => ({
        d: +el.dataset.depth, x: gsap.quickTo(el, 'x', { duration: 1, ease: 'power3' }), y: gsap.quickTo(el, 'y', { duration: 1, ease: 'power3' })
      }));
      $('.hero').addEventListener('pointermove', e => {
        const nx = e.clientX / innerWidth - .5, ny = e.clientY / innerHeight - .5;
        layers.forEach(l => { l.x(-nx * l.d * .9); l.y(-ny * l.d * .9); });
      });
    }

    /* Vidéo : pause hors écran / mode économie de données */
    const video = $('.hero__video');
    if (video) {
      const saver = navigator.connection && navigator.connection.saveData;
      if (saver) { video.removeAttribute('autoplay'); video.pause(); }
      else {
        video.play && video.play().catch(() => {});
        ScrollTrigger.create({ trigger: '.hero', start: 'top top', end: 'bottom top', onToggle: s => { s.isActive ? video.play().catch(() => {}) : video.pause(); } });
      }
    }

    /* --- Rubans : vitesse et sens réagissent au scroll --- */
    const rows = $$('[data-marquee]').map(r => ({ el: $('.ribbon__track', r), dir: +r.dataset.marquee, base: r.classList.contains('ribbon--a') ? 70 : 52, pos: 0, cur: 1, unit: 0 }));
    function measureRows() {
      rows.forEach(r => {
        if (!r.seed) { r.seed = r.el.innerHTML; r.n = r.el.children.length; }
        r.el.innerHTML = r.seed + r.seed;
        r.unit = r.el.children[r.n].offsetLeft - r.el.children[0].offsetLeft;
        let guard = 0;
        while (r.el.scrollWidth < innerWidth + r.unit * 2 && guard++ < 8) r.el.insertAdjacentHTML('beforeend', r.seed);
      });
    }
    measureRows();
    if (document.fonts) document.fonts.ready.then(measureRows);
    window.addEventListener('resize', measureRows);
    let sign = 1, vel = 0;
    ScrollTrigger.create({ start: 0, end: 'max', onUpdate(self) { vel = self.getVelocity(); if (Math.abs(vel) > 8) sign = vel > 0 ? 1 : -1; } });
    gsap.ticker.add((_, dtMs) => {
      const dt = Math.min(dtMs, 64) / 1000;
      const boost = Math.min(Math.abs(vel) / 380, 9);
      rows.forEach(r => {
        const target = r.dir * sign * (1 + boost);
        r.cur += (target - r.cur) * .07;
        r.pos += r.base * r.cur * dt;
        const x = -(((r.pos % r.unit) + r.unit) % r.unit);
        r.el.style.transform = `translate3d(${x}px,0,0)`;
      });
      vel *= .9;
    });

    /* --- Savoir-faire : section pinnée, storytelling en 4 étapes --- */
    (function story() {
      const section = $('.story'); if (!section) return;
      const steps = $$('.story__step', section), imgs = $$('.story__img', section), n = steps.length;
      const idx = $('#storyIdx');
      gsap.set(steps.slice(1), { autoAlpha: 0 });
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: section, start: 'top top', end: () => '+=' + Math.round(innerHeight * n * .85),
          pin: true, scrub: .7, anticipatePin: 1, invalidateOnRefresh: true,
          onUpdate: () => { const i = Math.max(0, Math.min(n - 1, Math.floor(tl.time() + .45))); idx.textContent = pad2(i + 1); }
        }
      });
      for (let k = 1; k < n; k++) {
        const t = k - .55;
        tl.to(steps[k - 1], { autoAlpha: 0, y: -30, duration: .3 }, t)
          .fromTo(steps[k], { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: .35 }, t + .2)
          .fromTo(imgs[k], { clipPath: 'circle(0% at 50% 100%)' }, { clipPath: 'circle(145% at 50% 100%)', duration: .6 }, t);
      }
      tl.fromTo('.story__line-fill', { scaleX: 0 }, { scaleX: 1, duration: n - 1 }, 0)
        .to('.story__badge', { rotation: 360, duration: n }, 0)
        .to({}, { duration: .6 }, n - 1);
      gsap.from('.story__frame', { yPercent: 14, opacity: 0, duration: 1.5, ease: 'expo.out', scrollTrigger: { trigger: section, start: 'top 75%', once: true } });
    })();

    /* --- Prestations : défilement horizontal piloté par le scroll vertical --- */
    (function services() {
      const pin = $('.services__pin'), track = $('.services__track'), idx = $('#svcIdx');
      if (!pin || !track) return;
      const cards = $$('[data-svc]', track);
      const mm = gsap.matchMedia();
      mm.add('(min-width: 900px)', () => {
        const dist = () => Math.max(0, track.scrollWidth - innerWidth);
        const tween = gsap.to(track, {
          x: () => -dist(), ease: 'none',
          scrollTrigger: {
            trigger: pin, start: 'top top', end: () => '+=' + dist(), pin: true, scrub: .8, anticipatePin: 1, invalidateOnRefresh: true,
            onUpdate: s => { idx.textContent = pad2(1 + Math.round(s.progress * (cards.length - 1))); }
          }
        });
        cards.forEach(card => {
          const im = $('img', card);
          gsap.fromTo(im, { xPercent: -7 }, { xPercent: 7, ease: 'none', scrollTrigger: { trigger: card, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } });
        });
        gsap.from('.services__intro > *', { y: 50, opacity: 0, stagger: .1, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: pin, start: 'top 70%', once: true } });
      });
      mm.add('(max-width: 899px)', () => {
        cards.forEach(c => { const im = $('img', c); im.style.transform = 'none'; });
        gsap.from('.services__intro > *', { y: 40, opacity: 0, stagger: .1, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: pin, start: 'top 80%', once: true } });
      });
    })();

    /* --- Nuancier --- */
    gsap.from('.nuancier__drop', { scale: 0, duration: 1.8, ease: 'expo.out', scrollTrigger: { trigger: '.nuancier', start: 'top 65%', once: true } });
    gsap.from('.nuancier__frame', { yPercent: 12, opacity: 0, duration: 1.5, ease: 'expo.out', scrollTrigger: { trigger: '.nuancier', start: 'top 65%', once: true } });
    gsap.from('.swatches li', { y: 36, opacity: 0, stagger: .08, duration: 1, ease: 'power3.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: '.swatches', start: 'top 85%', once: true } });

    /* --- Chiffres clés : compteurs + fantôme « 27 » en parallax --- */
    $$('[data-count]').forEach(el => {
      const target = parseFloat(el.dataset.count), dec = +(el.dataset.dec || 0);
      const f = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      el.textContent = f.format(0);
      ScrollTrigger.create({
        trigger: el, start: 'top 90%', once: true,
        onEnter: () => { const o = { v: 0 }; gsap.to(o, { v: target, duration: 2.4, ease: 'power3.out', onUpdate: () => { el.textContent = f.format(o.v); } }); }
      });
    });
    gsap.from('.stat', { y: 70, opacity: 0, stagger: .12, duration: 1.2, ease: 'expo.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: '.stats__grid', start: 'top 85%', once: true } });
    gsap.fromTo('.stats__ghost', { y: -140, yPercent: -50 }, { y: 140, yPercent: -50, ease: 'none', scrollTrigger: { trigger: '.stats', start: 'top bottom', end: 'bottom top', scrub: true } });

    /* --- Galerie : rideaux, zoom, inclinaison 3D --- */
    $$('.gal').forEach(g => {
      const c = $('.gal__curtain', g), im = $('img', g);
      const tl = gsap.timeline({ scrollTrigger: { trigger: g, start: 'top 90%', once: true } });
      tl.to(c, { scaleY: 0, duration: 1.2, ease: 'expo.inOut' })
        .from(im, { scale: 1.4, duration: 1.6, ease: 'expo.out', clearProps: 'transform' }, 0);
    });

    /* --- Inclinaison 3D + reflet lumineux (cartes prestations) et légère (galerie) --- */
    if (finePointer) {
      const tilt = (el, max, glare) => {
        gsap.set(el, { transformPerspective: 900 });
        const rx = gsap.quickTo(el, 'rotationX', { duration: .6, ease: 'power3' });
        const ry = gsap.quickTo(el, 'rotationY', { duration: .6, ease: 'power3' });
        let gx, gy, go;
        if (glare) { gx = gsap.quickTo(glare, 'x', { duration: .5, ease: 'power3' }); gy = gsap.quickTo(glare, 'y', { duration: .5, ease: 'power3' }); go = gsap.quickTo(glare, 'opacity', { duration: .4 }); }
        el.addEventListener('pointermove', e => {
          if (e.pointerType !== 'mouse') return;
          const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
          ry((px - .5) * 2 * max); rx(-(py - .5) * 2 * max);
          if (glare) { gx((px - .5) * r.width); gy((py - .5) * r.height); go(1); }
        });
        el.addEventListener('pointerleave', () => { rx(0); ry(0); glare && go(0); });
      };
      $$('.tilt').forEach(el => tilt(el, 9, $('.tilt__glare', el)));
      $$('.gal__btn').forEach(el => tilt(el, 5, null));
    }

    /* --- Boutons magnétiques --- */
    if (finePointer) {
      $$('.btn--magnet').forEach(btn => {
        const label = $('.btn__label', btn);
        const bx = gsap.quickTo(btn, 'x', { duration: .7, ease: 'elastic.out(1, .55)' }), by = gsap.quickTo(btn, 'y', { duration: .7, ease: 'elastic.out(1, .55)' });
        const lx = gsap.quickTo(label, 'x', { duration: .5, ease: 'power3' }), ly = gsap.quickTo(label, 'y', { duration: .5, ease: 'power3' });
        btn.addEventListener('pointermove', e => {
          const r = btn.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
          bx(dx * .32); by(dy * .42); lx(dx * .12); ly(dy * .16);
        });
        btn.addEventListener('pointerleave', () => { bx(0); by(0); lx(0); ly(0); });
      });
    }

    /* --- Curseur personnalisé --- */
    if (finePointer) {
      const c = $('#cursor');
      document.documentElement.classList.add('has-cursor');
      gsap.set(c, { opacity: 0 });
      const cx = gsap.quickTo(c, 'x', { duration: .22, ease: 'power3' }), cy = gsap.quickTo(c, 'y', { duration: .22, ease: 'power3' });
      let shown = false;
      window.addEventListener('pointermove', e => {
        if (!shown) { shown = true; gsap.set(c, { x: e.clientX, y: e.clientY }); gsap.to(c, { opacity: 1, duration: .4 }); }
        cx(e.clientX); cy(e.clientY);
      });
      document.addEventListener('pointerover', e => {
        const view = e.target.closest('.gal__btn');
        const link = e.target.closest('a, button, summary, label, input, textarea, .chip');
        c.classList.toggle('is-view', !!view);
        c.classList.toggle('is-link', !!link && !view);
      });
      document.addEventListener('mouseleave', () => gsap.to(c, { opacity: 0, duration: .3 }));
      document.addEventListener('mouseenter', () => gsap.to(c, { opacity: 1, duration: .3 }));
    }

    /* --- Apparitions génériques --- */
    ['.eyebrow', '.services__lead', '.nuancier__note', '.book__lead', '.book__tel', '.book__faq', '.booker', '.find__addr', '.hours', '.status', '.find__map',
      '.reviews__score', '.gallery__head > .btn', '.reviews__ctrl', '.footer__col'].forEach(sel => {
      $$(sel).forEach(el => {
        if (el.closest('.services__intro')) return;
        gsap.from(el, { y: 44, opacity: 0, duration: 1.1, ease: 'power3.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: el, start: 'top 92%', once: true } });
      });
    });
    gsap.from('.rev', { x: 90, opacity: 0, stagger: .12, duration: 1.3, ease: 'expo.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: '.reviews__viewport', start: 'top 85%', once: true } });

    /* --- Titres : mots / lettres qui montent --- */
    reveals.forEach(({ el, targets, mode }) => {
      const isFooter = !!el.closest('.footer__giant');
      gsap.from(targets, {
        yPercent: 118, rotate: mode === 'chars' ? 5 : 0, duration: isFooter ? 1.6 : 1.2, ease: 'expo.out', stagger: isFooter ? .06 : (mode === 'chars' ? .04 : .055),
        scrollTrigger: { trigger: el, start: isFooter ? 'top 98%' : 'top 86%', once: true }
      });
    });

    /* --- Fin d'initialisation --- */
    initNuancier();
    ScrollTrigger.sort();
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('load', () => setTimeout(refresh, 250));
    if (document.fonts) document.fonts.ready.then(() => setTimeout(refresh, 100));

    let revealed = false;
    const reveal = () => { if (revealed) return; revealed = true; heroIn.play(); lenis.start(); setTimeout(refresh, 1600); };
    runLoader(reveal);
    // filet de sécurité : si le préchargeur ne se termine pas, on libère la page
    setTimeout(() => { const l = $('#loader'); if (l) { l.remove(); reveal(); } }, 14000);
  }

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */
  function start() {
    initAnchors();
    initHours();
    initBooking();
    initLightbox();
    initReviews();

    if (reduce || !hasGsap) {
      $('#loader') && $('#loader').remove();
      initNuancier();
      initLite();
      return;
    }
    try {
      initMotion();
    } catch (err) {
      console.error('[Dream Nails] animations désactivées :', err);
      $('#loader') && $('#loader').remove();
      initLite();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
