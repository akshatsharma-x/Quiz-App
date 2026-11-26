/* Leaderboard with scopes, podium, tier progress and live refresh */
(async () => {
  const { requireAuth, api, html, setHTML, icon, fmt, toast, debounce, initials, $, $$ } = QM;

  const user = await requireAuth({ role: 'user' });
  const { socket } = await QMShell.mount({ active: 'leaderboard', user });

  let scope = 'global';
  let tiers = [];
  const SCOPE_LABEL = {
    global: 'across the university',
    batch: `in ${user.program} ${user.branch} · ${user.batchYear}`,
    section: `in Section ${user.section} · ${user.branch} ${user.batchYear}`
  };

  const who = (e) => [e.program, e.branch, e.batchYear].filter(Boolean).join(' · ') || 'Student';

  const renderMe = (data) => {
    const me = data.me;
    const tier = me.tier;
    setHTML($('#meCard'), html`
      <div class="me-id">
        <span class="avatar avatar-lg">${initials(user.name)}</span>
        <div><span class="badge badge-brand">You</span><h2 class="mt-1">${user.name}</h2><span class="small subtle">${me.rank ? `Ranked ${SCOPE_LABEL[data.scope]}` : 'Not ranked yet — finish a quiz to join'}</span></div>
      </div>
      <div class="me-figs">
        <div><span>Rank</span><strong>${me.rank ? `#${me.rank}` : '—'}</strong></div>
        <div><span>Total XP</span><strong>${fmt.compact(me.xp)}</strong></div>
        <div><span>Quizzes</span><strong>${me.quizzes || 0}</strong></div>
        <div><span>Accuracy</span><strong>${me.avgPercentage === null || me.avgPercentage === undefined ? '—' : fmt.pct(me.avgPercentage, 1)}</strong></div>
      </div>
      <div class="me-tier">
        <div class="row" style="gap:.5rem"><span style="color:${tier.color}">${icon('award')}</span><strong>${tier.name}</strong></div>
        <div class="meter mt-1" role="meter" aria-label="Progress to next tier" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${tier.progress}"><span data-w="${tier.progress}"></span></div>
        <div class="row-between"><span>${tier.next ? `${fmt.number(tier.next.xpNeeded)} XP to ${tier.next.name}` : 'Top tier reached'}</span><span>${tier.progress}%</span></div>
      </div>`);
  };

  const podiumSpot = (e, place) => html`
    <div class="podium-spot p${place} ${e.isMe ? 'is-me' : ''}">
      ${place === 1 ? html`<span class="crown">${icon('award', 'icon-lg')}</span>` : ''}
      <span class="avatar">${initials(e.name)}</span>
      <div style="max-width:100%"><div class="name" title="${e.name}">${e.name}</div><div class="sub">${who(e)}</div></div>
      <div class="xp">${fmt.compact(e.xp)} XP</div>
      <div class="podium-step" aria-label="Rank ${e.rank}">${e.rank}</div>
    </div>`;

  const row = (e, sep = false) => html`
    <li class="lb-row ${e.isMe ? 'is-me' : ''} ${sep ? 'sep' : ''}">
      <span class="lb-rank">${e.rank ? `#${e.rank}` : '—'}</span>
      <span class="avatar avatar-sm">${initials(e.name)}</span>
      <div class="lb-who"><strong>${e.name}${e.isMe ? html` <span class="badge badge-brand" style="height:20px">You</span>` : ''}</strong><span>${who(e)} · ${e.tier.name}</span></div>
      <div class="lb-score"><strong>${fmt.compact(e.xp)} XP</strong><span>${e.quizzes} quiz${e.quizzes === 1 ? '' : 'zes'} · ${e.avgPercentage === null ? '—' : fmt.pct(e.avgPercentage, 1)}</span></div>
    </li>`;

  const render = (data) => {
    renderMe(data);
    const entries = data.entries;
    if (!entries.length) {
      setHTML($('#podium'), '');
      setHTML($('#lbList'), html`<li><div class="empty"><div class="empty-icon">${icon('award')}</div><h3>No rankings yet</h3><p>Be the first to finish a quiz ${SCOPE_LABEL[data.scope]}.</p></div></li>`);
    } else {
      const top = entries.slice(0, 3);
      const order = [top[1], top[0], top[2]].map((e, i) => (e ? podiumSpot(e, [2, 1, 3][i]) : html`<div></div>`));
      setHTML($('#podium'), order);
      const rest = entries.slice(3).map((e) => row(e));
      const meInList = entries.some((e) => e.isMe);
      if (!meInList && data.me.rank) rest.push(row({ ...data.me, isMe: true }, true));
      setHTML($('#lbList'), rest.length ? rest : html`<li class="center small subtle" style="padding:1rem">That’s everyone ranked ${SCOPE_LABEL[data.scope]} so far.</li>`);
    }
    $$('#lbList, #podium').forEach((el) => el.closest('.card').classList.remove('loading'));
    requestAnimationFrame(() => $$('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; }));

    setHTML($('#tierList'), tiers.map((t) => html`
      <li class="${t.name === data.me.tier.name ? 'current' : ''}"><span class="gem" style="color:${t.color}">${icon('award')}</span>${t.name}<b>${fmt.number(t.min)}+ XP</b></li>`));
  };

  let requestSeq = 0;
  const load = async () => {
    const seq = ++requestSeq;
    try {
      const r = await api(`/student/leaderboard?scope=${scope}`);
      if (seq !== requestSeq) return; // a newer scope was requested meanwhile
      render(r.data);
    } catch (err) {
      toast(err.message, { type: 'error', title: 'Could not load the leaderboard' });
    }
  };

  $('#scope').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope]');
    if (!b || b.dataset.scope === scope) return;
    scope = b.dataset.scope;
    $$('#scope button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  });

  try { tiers = (await api('/meta/config', { auth: false })).data.tiers || []; } catch (e) { tiers = []; }
  await load();
  if (socket) socket.on('leaderboard:update', debounce(load, 800));
})();
