import { Game } from './game.js';
import { DIFFICULTIES, MODES } from './config.js';
import { randomSeed } from './rng.js';
import { renderMarkdown } from './markdown.js';

const params = new URLSearchParams(location.search);
const play = params.get('play') === '1';
const difficulty = DIFFICULTIES[params.get('diff')] ? params.get('diff') : 'normal';
const mode = MODES[params.get('mode')] ? params.get('mode') : 'regular';
let seed = sanitizeSeed(params.get('seed'));
if (!seed) seed = randomSeed();

function sanitizeSeed(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 10);
}

function buildUrl(nextSeed, nextDifficulty, nextMode, isPlay) {
  const url = new URL(location.href);
  url.searchParams.set('seed', nextSeed);
  url.searchParams.set('diff', nextDifficulty);
  url.searchParams.set('mode', nextMode);
  if (isPlay) url.searchParams.set('play', '1');
  else url.searchParams.delete('play');
  return `${url.pathname}${url.search}${url.hash}`;
}

function writeCurrentUrl(nextSeed, nextDifficulty, nextMode, isPlay) {
  history.replaceState(
    null,
    '',
    buildUrl(nextSeed, nextDifficulty, nextMode, isPlay)
  );
}

if (!play) {
  initHome();
} else {
  startGame();
}

function initHome() {
  const home = document.getElementById('home-screen');
  const modeSelect = document.getElementById('home-mode');
  const difficultySelect = document.getElementById('home-difficulty');
  const hint = document.getElementById('home-hint');
  const startButton = document.getElementById('home-start');
  const restartButton = document.getElementById('home-restart');
  const helpButton = document.getElementById('home-help');
  const helpModal = document.getElementById('help-modal');
  const helpReadme = document.getElementById('help-readme');
  const helpClose = document.getElementById('help-close');

  document.body.classList.add('home-mode');
  document.body.classList.remove('game-mode');
  home.classList.remove('hidden');

  for (const [key, config] of Object.entries(MODES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = config.label;
    option.selected = key === mode;
    modeSelect.appendChild(option);
  }

  for (const [key, config] of Object.entries(DIFFICULTIES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = config.label;
    option.selected = key === difficulty;
    difficultySelect.appendChild(option);
  }

  writeCurrentUrl(seed, difficulty, mode, false);
  updateHint();
  setupHomeHelp();

  modeSelect.addEventListener('change', () => {
    writeCurrentUrl(seed, difficultySelect.value, modeSelect.value, false);
    updateHint();
  });
  difficultySelect.addEventListener('change', () => {
    writeCurrentUrl(seed, difficultySelect.value, modeSelect.value, false);
    updateHint();
  });

  startButton.addEventListener('click', () => {
    location.href = buildUrl(
      randomSeed(),
      difficultySelect.value,
      modeSelect.value,
      true
    );
  });

  restartButton.addEventListener('click', () => {
    location.href = buildUrl(seed, difficultySelect.value, modeSelect.value, true);
  });

  function updateHint() {
    const selectedDifficulty = difficultySelect.value;
    hint.textContent =
      selectedDifficulty === 'easy'
        ? '轻松：全塔开放，无流派限制。'
        : '标准 / 高压：开局选择光/暗流派，未选属性塔最多 1 座。';
  }

  function setupHomeHelp() {
    let loaded = false;
    let loading = false;

    const close = () => {
      helpModal.classList.add('hidden');
    };

    const open = async () => {
      helpModal.classList.remove('hidden');
      if (loaded || loading) return;
      loading = true;
      helpReadme.hidden = false;
      helpReadme.innerHTML = '<p>正在加载 README.md ...</p>';
      try {
        const response = await fetch('./README.md', { cache: 'no-cache' });
        if (!response.ok) throw new Error(`README ${response.status}`);
        helpReadme.innerHTML = renderMarkdown(await response.text());
        loaded = true;
      } catch {
        helpReadme.innerHTML =
          '<p>无法加载 README.md。请确认它和 index.html 位于同一目录，并通过本地服务器打开游戏。</p>';
      } finally {
        loading = false;
      }
    };

    helpButton.addEventListener('click', open);
    helpClose.addEventListener('click', close);
    helpModal.addEventListener('click', (event) => {
      if (event.target === helpModal) close();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !helpModal.classList.contains('hidden')) {
        close();
      }
    });
  }
}

function startGame() {
  document.body.classList.remove('home-mode');
  document.body.classList.add('game-mode');
  document.getElementById('home-screen').classList.add('hidden');
  writeCurrentUrl(seed, difficulty, mode, true);

  const game = new Game({ seed, difficulty, mode });
  window.__game = game;
}
