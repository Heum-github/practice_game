/**
 * 한국어 조사 선택.
 *
 * 아이템 이름이 데이터에서 오기 때문에 "곡괭이이(가)" 같은 문장이 나온다.
 * 받침 유무만 보면 정확히 고를 수 있으므로 굳이 괄호로 도망갈 이유가 없다.
 */

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 마지막 글자에 받침이 있는지 */
export function hasFinalConsonant(word: string): boolean {
  const last = word.trimEnd().slice(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) {
    // 한글이 아니면 숫자·영문 — 대충 받침 없음으로 본다
    return false;
  }
  return (code - HANGUL_START) % 28 !== 0;
}

const PAIRS = {
  이가: ['이', '가'],
  은는: ['은', '는'],
  을를: ['을', '를'],
  와과: ['와', '과'],
  으로로: ['으로', '로'],
} as const;

export type JosaPair = keyof typeof PAIRS;

/** 단어에 맞는 조사를 고른다 */
export function josa(word: string, pair: JosaPair): string {
  const [withFinal, withoutFinal] = PAIRS[pair];
  return hasFinalConsonant(word) ? withFinal : withoutFinal;
}

/** 단어와 조사를 붙여 돌려준다 */
export function withJosa(word: string, pair: JosaPair): string {
  return word + josa(word, pair);
}
