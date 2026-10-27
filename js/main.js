import { Game } from './game.js';
import { DIFFICULTIES, MODES } from './config.js';
import { randomSeed } from './rng.js';

const params = new URLSearchParams(location.search);
const difficulty = DIFFICULTIES[params.get('diff')] ? params.get('diff') : 'normal';
const mode = MODES[params.get('mode')] ? params.get('mode') : 'regular';
let seed = (params.get('seed') || '')
  .toUpperCase()
  .replace(/[^A-Z0-9_-]/g, '')
  .slice(0, 10);
if (!seed) seed = randomSeed();

if (!params.get('seed') || params.get('diff') !== difficulty || params.get('mode') !== mode) {
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  url.searchParams.set('diff', difficulty);
  url.searchParams.set('mode', mode);
  history.replaceState(null, '', url);
}

const game = new Game({ seed, difficulty, mode });
window.__game = game;
