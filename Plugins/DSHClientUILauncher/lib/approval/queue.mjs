/**
 * 进程内串行队列：审批的「读 → 改 → 写」与审计写入共用同一条 promise 链。
 *
 * 为什么需要：只靠 `version` 乐观锁会丢更新——两个同版本请求各自读到 v3、各自写 v4，
 * 两边都「成功」。把整段临界区串起来之后，第二个请求在读到 v4 时才比对版本，才会拿到
 * `conflict`（05-设计 §7.4 并发第 1 条）。
 *
 * 本版按「单 dsh web 进程」假设；跨进程锁见 policy-store.mjs 里的 TODO。
 */

/** 队列尾：每个任务挂在上一个任务之后；任务抛错不影响后续任务继续排。 */
let tail = Promise.resolve()

/** 排队中的任务数，给自检与日志用。 */
let depth = 0

/**
 * 把一个任务排进队列，按调用顺序执行。
 * @template T
 * @param {() => Promise<T> | T} task - 临界区内的任务。
 * @returns {Promise<T>} 任务自己的结果；任务抛错时在调用方 reject。
 */
export function enqueue(task) {
  depth += 1
  const result = tail.then(() => task())
  tail = result.then(
    () => { depth -= 1 },
    () => { depth -= 1 },
  )
  return result
}

/** 当前排队深度（含正在执行的那个）。 */
export function queueDepth() {
  return depth
}
