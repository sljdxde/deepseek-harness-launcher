/**
 * 单调 ULID：48 位毫秒时间 + 80 位随机，同一毫秒内递增随机段。
 *
 * 审计记录用它的原因：`id` 本身可比、按写入顺序单调（§7.3），
 * 排序与「哪条先发生」不需要再信 `ts` 的字符串精度。
 */

import { randomBytes } from 'node:crypto'

/** Crockford base32。 */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 已用过的最大毫秒时间。 */
let lastTime = -1

/** 同一毫秒内上一次的随机段（10 字节，大端）。 */
let lastRandom = null

/**
 * 把 48 位毫秒时间编成 10 个 base32 字符。
 * @param {number} time - 毫秒时间戳。
 * @returns {string} 10 字符。
 */
function encodeTime(time) {
  let rest = time
  let out = ''
  for (let index = 0; index < 10; index += 1) {
    out = ENCODING[rest % 32] + out
    rest = Math.floor(rest / 32)
  }
  return out
}

/**
 * 把 10 字节随机段编成 16 个 base32 字符（80 位刚好 16×5）。
 * @param {Uint8Array} bytes - 10 字节。
 * @returns {string} 16 字符。
 */
function encodeRandom(bytes) {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ENCODING[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out
}

/**
 * 随机段 +1（大端进位）；溢出说明同一毫秒的随机段用完了，返回 false。
 * @param {Uint8Array} bytes - 原地修改。
 * @returns {boolean} 是否成功进位。
 */
function increment(bytes) {
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    if (bytes[index] === 0xff) {
      bytes[index] = 0
      continue
    }
    bytes[index] += 1
    return true
  }
  return false
}

/**
 * 生成一个单调 ULID。
 * @param {number} [nowMs] - 毫秒时间，测试可注入。
 * @returns {string} 26 字符 ULID。
 */
export function ulid(nowMs = Date.now()) {
  const time = Math.max(nowMs, lastTime)
  if (time === lastTime && lastRandom !== null && increment(lastRandom)) {
    return encodeTime(time) + encodeRandom(lastRandom)
  }
  lastRandom = randomBytes(10)
  lastTime = time
  return encodeTime(time) + encodeRandom(lastRandom)
}
