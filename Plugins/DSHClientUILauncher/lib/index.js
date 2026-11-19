/**
 * host 半区：本版（T3）只落外壳与容器，host 侧不提供服务——
 * 审批策略与审计是 T4 的 `approvalPolicy` Remote，按版本单单独一个 PR。
 *
 * 保留这个名字与空 apply 是为了：插件行本身可加载、`cordis.patch.yml` 可生效，
 * 客户端半区落地后不需要再动 host 侧任何东西。
 */
export const name = 'dsh-client-ui-launcher'

/**
 * 挂载点。当前没有 host 能力要注册，等 T4 的审批服务接进来。
 * @param {object} ctx - cordis 上下文（本版未使用）。
 */
export function apply(ctx) {
  void ctx
}
