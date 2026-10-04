import axios from 'axios';
import { readFileSync } from 'fs';

const UNIVERSE = JSON.parse(readFileSync('./screener/src/lib/universe_500.json'));
const keys = Object.values(UNIVERSE).map(u => u.key);

async function run() {
  const token = ""; // We can't access user's token directly easily... wait. I CAN access the browser's token or run tests locally if I knew it. But I don't have the token.
}
