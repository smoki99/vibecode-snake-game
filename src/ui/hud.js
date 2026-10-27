/**
 * DOM readouts. Everything that writes to the page lives here, so the shapes of the overlays are
 * one file and the controller never touches an element.
 */
import { PRESETS, PRESET_IDS, speedProgress, tickMsFor } from '../sim/difficulty.js';
import { STATUS } from '../sim/constants.js';
import { iconMarkup } from './icons.js';

const pad4 = (n) => String(Math.max(0, Math.trunc(n))).padStart(4, '0');

export const OVERLAY_COPY = {
  [STATUS.idle]: {
    kicker: 'Grid Arcade',
    title: 'Ready when you are',
    body: 'Steer with the arrow keys, WASD, or swipe. Eat apples, avoid walls and your own tail.',
    primary: { label: 'Start', icon: 'play', action: 'start' },
    hint: 'Space also starts',
  },
  [STATUS.paused]: {
    kicker: 'Paused',
    title: 'Paused',
    body: 'The simulation is frozen. Nothing moves until you say so.',
    primary: { label: 'Resume', icon: 'play', action: 'resume' },
    secondary: { label: 'New run', icon: 'restart', action: 'restart' },
    hint: 'P or Escape resumes',
  },
  [STATUS.over]: {
    kicker: 'Run over',
    title: 'Run over',
    body: 'A wall or your own tail ended it. The board resets clean.',
    primary: { label: 'Play again', icon: 'restart', action: 'restart' },
    secondary: { label: 'Close', icon: 'close', action: 'close' },
    hint: 'R starts a new run',
  },
  [STATUS.won]: {
    kicker: 'Impossible',
    title: 'Board complete',
    body: 'You filled every cell. There is nowhere left to go.',
    primary: { label: 'Play again', icon: 'restart', action: 'restart' },
    hint: 'R starts a new run',
  },
};

const DEATH_HEADLINE = {
  wall: 'You met the wall',
  self: 'You met yourself',
  'board-full': 'Board complete',
};

function setText(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

export function createHud({ dom, announce = () => {} }) {
  let lastScore = null;
  let lastStatus = null;

  function renderOverlay(state, api) {
    const overlay = dom.overlay;
    if (!overlay) return;
    const show = state.status !== STATUS.playing;
    overlay.hidden = show === false;
    overlay.dataset.status = state.status;
    if (!show) return;

    const copy = { ...OVERLAY_COPY[state.status] };
    const reason = state.lastEvent?.reason;
    if (state.status === STATUS.over && reason && DEATH_HEADLINE[reason]) copy.title = DEATH_HEADLINE[reason];
    if (state.status === STATUS.won) copy.title = DEATH_HEADLINE['board-full'];

    setText(dom.overlayKicker, copy.kicker);
    setText(dom.overlayTitle, copy.title);
    setText(dom.overlayBody, copy.body);
    setText(dom.overlayHint, copy.hint ?? '');

    const finishedRun = state.status === STATUS.over || state.status === STATUS.won;
    if (dom.overlayScore) {
      dom.overlayScore.hidden = !finishedRun;
      const best = Math.max(state.best, state.score);
      const badge = state.score > 0 && state.score >= best ? ' · new best' : '';
      setText(dom.overlayScore, finishedRun ? `${pad4(state.score)} pts · best ${pad4(best)}${badge}` : '');
    }
    if (dom.overlayBadge) {
      const isNewBest = finishedRun && state.score > 0 && state.score >= state.best;
      dom.overlayBadge.hidden = !isNewBest;
      if (isNewBest) dom.overlayBadge.innerHTML = `${iconMarkup('trophy')}<span>New personal best</span>`;
    }

    if (dom.overlayPrimary && copy.primary) {
      dom.overlayPrimary.dataset.action = copy.primary.action;
      dom.overlayPrimary.innerHTML = `${iconMarkup(copy.primary.icon)}<span>${copy.primary.label}</span>`;
    }
    if (dom.overlaySecondary) {
      const secondary = copy.secondary;
      dom.overlaySecondary.hidden = !secondary;
      if (secondary) {
        dom.overlaySecondary.dataset.action = secondary.action;
        dom.overlaySecondary.innerHTML = `${iconMarkup(secondary.icon)}<span>${secondary.label}</span>`;
      }
    }
    void api;
  }

  function renderRanks(scores) {
    if (!dom.ranksList) return;
    const rows = PRESET_IDS.map((id) => ({ id, preset: PRESETS[id], score: scores[id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    dom.ranksList.innerHTML = rows
      .map((row, index) => {
        const medal = row.score > 0 ? iconMarkup(index === 0 ? 'trophy' : 'medal') : iconMarkup('medal');
        return `<li class="rank" data-rank="${index + 1}" data-preset="${row.id}">
          <span class="rank-medal">${medal}</span>
          <span><span class="rank-name">${row.preset.label}</span><br><span class="rank-spec">${row.preset.baseMs} → ${row.preset.minMs} ms</span></span>
          <span class="rank-score">${pad4(row.score)}</span>
        </li>`;
      })
      .join('');
  }

  function render(state, api) {
    const bumped = lastScore !== null && state.score > lastScore;
    setText(dom.score, pad4(state.score));
    setText(dom.best, pad4(Math.max(state.best, state.score)));
    setText(dom.apples, String(state.eaten));
    if (dom.score) {
      dom.score.classList.toggle('is-bumped', bumped);
    }

    const progress = Math.round(speedProgress(state.preset, state.eaten) * 100);
    if (dom.speedFill) dom.speedFill.style.width = `${progress}%`;
    setText(dom.speedTier, `Tier ${state.tier}`);
    setText(dom.speedMs, `${tickMsFor(state.preset, state.eaten)} ms / tick`);

    if (dom.difficultyInputs) {
      dom.difficultyInputs.forEach((input) => {
        input.checked = input.value === state.difficulty;
      });
    }
    if (dom.pauseBtn) {
      const paused = state.status === STATUS.paused;
      dom.pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      setText(dom.pauseLabel, paused ? 'Resume' : 'Pause');
    }
    if (dom.soundBtn) {
      dom.soundBtn.setAttribute('aria-pressed', api.muted ? 'false' : 'true');
      const use = dom.soundBtn.querySelector('use');
      if (use) use.setAttribute('href', api.muted ? '#icon-sound-off' : '#icon-sound-on');
      setText(dom.soundLabel, api.muted ? 'Muted' : 'Sound');
    }
    if (dom.seedNote) dom.seedNote.textContent = `seed ${state.seed} · ${state.board.cols}x${state.board.rows}`;

    renderOverlay(state, api);
    if (state.status !== lastStatus) {
      lastStatus = state.status;
      renderRanks(api.scores());
    }
    lastScore = state.score;
  }

  const SPOKEN = {
    eat: (s) => `Apple. Score ${s.score}.`,
    die: (s) => `Game over. ${s.lastEvent?.reason === 'wall' ? 'Wall' : 'Self collision'}. Score ${s.score}.`,
    win: () => 'Board complete. Every cell filled.',
    start: () => 'Run started.',
    pause: () => 'Paused.',
    resume: () => 'Resumed.',
    tier: (s) => `Speed tier ${s.tier}.`,
    difficulty: (s) => `Difficulty ${s.preset.label}.`,
    mute: () => 'Sound off.',
    unmute: () => 'Sound on.',
  };

  function announceEvent(name, state) {
    const spoken = SPOKEN[name];
    if (spoken) announce(spoken(state));
  }

  return { render, renderRanks, announceEvent, OVERLAY_COPY };
}
