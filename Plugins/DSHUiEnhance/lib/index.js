// dsh-ui-enhance 的服务端部分只做一件事：让这个包作为 Cordis 插件被加载。
//
// 界面增强全在 client/client.js 里（浏览器侧），这里不需要注册任何 HTTP
// 路由 —— 与归档管理、插件管理那三个内置插件不同，它没有服务端行为。
export const name = 'dsh-ui-enhance'

export function apply() {
  // 有意留空：这个插件的全部工作是浏览器端的样式与按钮，
  // 而 client 端由 dsh 的 web 宿主单独加载（见 package.json 的 dsh.client）
}
