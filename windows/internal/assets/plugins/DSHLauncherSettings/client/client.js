/**
 * dsh-launcher-settings 的客户端。
 *
 * 这里刻意什么都不注册。设置界面只有一处：启动器自己的设置窗口
 * （面板 →「设置…」、托盘、或 Ctrl+,），和 macOS 版一致。之前这里往
 * sidebar.panellist 注册过一个「启动器设置」列表项，它和设置窗口是同一
 * 组开关的第二个入口，只让侧边栏更长——已移除。
 *
 * 服务端路由（lib/index.js 的 /dsh-launcher-settings/state）仍然保留：
 * 启动器的控制服务和插件管理器都读它，删掉客户端不影响它们。
 */
window.__ModuleLoader__.load({ id: 'dsh-launcher-settings', factory: () => {
  return { inject: ['slots'], apply() {} }
}})
