'use strict';

/**
 * Мягкие переносы для русского и латиницы.
 * Правила консервативные: в каждой части слова обязана быть гласная,
 * строка не начинается с ь/ъ/й, короткие огрызки не отрываются.
 * Задача — убрать огромные межсловные пробелы при выключке, а не
 * соблюсти все тонкости орфографии.
 */

const VOWELS_RU = 'аеёиоуыэюя';
const VOWELS_LAT = 'aeiouy';
const NO_LEAD = 'ьъй'; // этими буквами строка начинаться не может
const NO_SPLIT_AFTER = ''; // зарезервировано

const MIN_HEAD = 2; // минимум символов до переноса
const MIN_TAIL = 3; // минимум символов после переноса
const MIN_WORD = 6;

function isVowel(ch) {
  const c = ch.toLowerCase();
  return VOWELS_RU.includes(c) || VOWELS_LAT.includes(c);
}

function isLetter(ch) {
  return /\p{L}/u.test(ch);
}

/**
 * Допустимые позиции переноса внутри слова.
 * @param {string} word слово без пунктуации по краям
 * @returns {number[]} индексы, перед которыми можно разорвать слово
 */
function hyphenPoints(word) {
  if (!word || word.length < MIN_WORD) return [];
  // Аббревиатуры, числа и смешанные коды не переносим.
  if (!/\p{Ll}/u.test(word)) return [];
  if (/\d/.test(word)) return [];
  if (!/^[\p{L}\-’']+$/u.test(word)) return [];

  const chars = [...word];
  const n = chars.length;
  const points = [];

  // Готовый дефис — естественная точка разрыва.
  for (let i = 1; i < n - 1; i += 1) {
    if (chars[i] === '-' && i + 1 < n) points.push(i + 1);
  }

  const vowelFlags = chars.map(isVowel);
  const vowelsBefore = [];
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    vowelsBefore.push(acc);
    if (vowelFlags[i]) acc += 1;
  }
  const totalVowels = acc;
  if (totalVowels < 2) return points;

  for (let i = MIN_HEAD; i <= n - MIN_TAIL; i += 1) {
    const left = chars[i - 1];
    const right = chars[i];
    if (!isLetter(left) || !isLetter(right)) continue;
    if (NO_LEAD.includes(right.toLowerCase())) continue;
    if (NO_SPLIT_AFTER.includes(left.toLowerCase())) continue;

    const vLeft = vowelsBefore[i];
    const vRight = totalVowels - vLeft;
    if (vLeft < 1 || vRight < 1) continue;

    const lv = isVowel(left);
    const rv = isVowel(right);

    // Стык «гласная|гласная» читается плохо: «кри-ошоу».
    if (lv && rv) continue;

    // Главное правило слогоделения: согласная уходит к следующей гласной,
    // поэтому разрыв «согласная|гласная» неверен — «откл-ючишь», «вставл-яет»,
    // «по-др-угому». Допустимы только «гласная|согласная» и «согласная|согласная».
    if (!lv && rv) continue;

    // Удвоенную согласную разрывают между буквами: «искрен-нюю», не «искре-ннюю».
    const next = chars[i + 1];
    if (lv && next && right.toLowerCase() === next.toLowerCase() && !rv) continue;

    // Мягкий знак не отрывают от своей согласной: «удивитель-ного», не «удивите-льного».
    if (next && 'ьъ'.includes(next.toLowerCase())) continue;

    // После дефиса в составном слове нужно оставить не меньше двух букв:
    // «по-|другому», а не «по-д-|ругому».
    const prevHyphen = word.lastIndexOf('-', i - 1);
    if (prevHyphen >= 0 && i - prevHyphen < 3) continue;

    points.push(i);
  }

  return [...new Set(points)].sort((a, b) => a - b);
}

/**
 * Подбор самой длинной части слова с дефисом, влезающей в доступную ширину.
 * @param {string} word
 * @param {number} avail доступная ширина в pt
 * @param {(s:string)=>number} measure
 * @returns {{head:string, tail:string}|null}
 */
function splitToFit(word, avail, measure) {
  // Пунктуация по краям не участвует в расчёте точек переноса.
  const m = word.match(/^([^\p{L}]*)(.*?)([^\p{L}]*)$/u);
  const pre = m ? m[1] : '';
  const core = m ? m[2] : word;
  const post = m ? m[3] : '';

  const points = hyphenPoints(core);
  if (!points.length) return null;

  for (let k = points.length - 1; k >= 0; k -= 1) {
    const i = points[k];
    const headCore = core.slice(0, i);
    const alreadyHyphen = headCore.endsWith('-');
    const head = pre + headCore + (alreadyHyphen ? '' : '-');
    if (measure(head) <= avail) {
      return { head, tail: core.slice(i) + post };
    }
  }
  return null;
}

module.exports = { hyphenPoints, splitToFit };
