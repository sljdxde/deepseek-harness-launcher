// 生成插件中心图标库（Tabler Icons，MIT，24 网格 / 2 描边 / currentColor）
//   node scripts/build-plugin-icon-library.mjs
// 图标源：@tabler/icons（MIT，https://tabler.io/icons）；本地缓存 $TMPDIR/tabler-icons
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadNormalized, KEY_TO_TABLER } from './lib/tabler-icons.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'windows/docs/plugin-icon-library.html')
const CACHE = path.join(os.tmpdir(), 'icon-research/tabler/package/icons/outline')

// ── 目录：25 个分类，每个分类给语义互不重复的图标（不用 brain 这类拟物图标）──
const CATALOG = [
  { cat: '界面', desc: '侧栏 / 顶栏 / 窗口 / 设备', icons: [
    ['layout-sidebar-left-expand', '侧栏展开'], ['layout-sidebar-right', '右侧栏'], ['layout-sidebar-right-expand', '顶栏面板'],
    ['app-window', '应用窗口'], ['window-maximize', '窗口最大化'], ['layout-board-split', '分屏布局'],
    ['device-desktop', '桌面端'], ['device-mobile', '移动端'], ['viewfinder', '取景框'],
  ]},
  { cat: '工具', desc: '通用工具 / 设置 / 装卸', icons: [
    ['tools', '工具箱'], ['settings', '设置'], ['adjustments', '参数调节'], ['hammer', '构建'],
    ['package', '扩展包'], ['plug-connected', '已接入'], ['tool', '维护'], ['components', '组件装配'],
  ]},
  { cat: '会话', desc: '对话 / 记录 / 协作', icons: [
    ['message', '消息'], ['messages', '会话组'], ['message-chatbot', '对话体'], ['notes', '会话笔记'],
    ['checklist', '待办清单'], ['writing', '撰写回复'], ['clock-up', '最近会话'], ['users-group', '群组会话'],
  ]},
  { cat: '工作流', desc: '编排 / 路由 / 拓扑', icons: [
    ['route', '执行路径'], ['sitemap', '流程结构'], ['hierarchy-2', '层级编排'], ['topology-full-hierarchy', '拓扑全览'],
    ['arrows-split-2', '拆分并行'], ['arrows-join', '汇聚合并'], ['stairs-up', '步骤推进'], ['git-branch', '分支流程'],
  ]},
  { cat: '开发', desc: '代码 / 缺陷 / 依赖 / 评审', icons: [
    ['code', '代码'], ['file-code', '源码文件'], ['terminal-2', '终端会话'], ['bug', '缺陷追踪'],
    ['braces', '数据结构'], ['regex', '正则匹配'], ['container', '容器环境'], ['git-pull-request', '代码评审'],
    ['package', '依赖包'], ['brand-github', '代码托管'],
  ]},
  { cat: '用量', desc: '额度 / 成本 / 耗时', icons: [
    ['gauge', '额度仪表'], ['chart-bar', '用量统计'], ['chart-line', '趋势曲线'],
    ['chart-donut', '占比分布'], ['activity-heartbeat', '活跃曲线'], ['trending-up', '增长趋势'],
    ['coin', '花费成本'], ['wallet', '预算钱包'], ['receipt', '账单明细'], ['hourglass', '耗时'],
  ]},
  { cat: '模型', desc: '推理 / 量化 / 编排', icons: [
    ['cpu', '本地推理'], ['robot', '模型服务'], ['sparkles', '生成能力'], ['wand', '提示增强'],
    ['binary-tree', '多模型协同'], ['affiliate', '模型编排'], ['layers-subtract', '模型分层'],
    ['server-cog', '推理服务'], ['cpu-2', '算力调度'],
  ]},
  { cat: '视觉', desc: '看图 / 识别 / 截图', icons: [
    ['eye', '查看预览'], ['scan', '图像扫描'], ['photo', '单张图片'], ['photo-plus', '图片集'],
    ['camera', '截屏相机'], ['crop', '裁剪标注'], ['focus-2', '聚焦目标'], ['zoom-in', '放大细节'],
  ]},
  { cat: '记忆', desc: '长期记忆 / 归档 / 知识库', icons: [
    ['notebook', '记忆笔记'], ['bookmark', '收藏夹'], ['archive', '归档'], ['database', '记忆存储'],
    ['library', '知识库'], ['history', '回溯检索'], ['timeline', '时间线'], ['file-invoice', '记录条目'],
  ]},
  { cat: '搜索', desc: '检索 / 过滤 / 定位', icons: [
    ['search', '全局搜索'], ['zoom-code', '代码搜索'], ['filter', '结果过滤'],
    ['chart-funnel', '筛选漏斗'], ['scan', '扫描查找'], ['target-arrow', '定位目标'],
    ['command', '快捷指令'], ['filter-2', '扩展过滤'],
  ]},
  { cat: '导出', desc: '导入导出 / 分享 / 打包', icons: [
    ['download', '导出下载'], ['upload', '导入上传'], ['file-download', '导出文件'],
    ['file-upload', '导入文件'], ['file-export', '导出报告'], ['share-3', '分享'],
    ['file-type-csv', '表格导出'], ['printer', '打印'], ['clipboard-copy', '复制结果'],
    ['file-zip', '归档打包'], ['send', '发送出去'],
  ]},
  { cat: '通知', desc: '提醒 / 广播 / 订阅', icons: [
    ['bell', '通知铃'], ['bell-ringing', '强提醒'], ['bell-off', '免打扰'], ['notification', '系统通知'],
    ['broadcast', '广播公告'], ['mail', '邮件通知'], ['alert-triangle', '告警警笛'], ['antenna-bars-5', '订阅推送'],
    ['calendar-event', '定时提醒'], ['inbox', '收件箱'],
  ]},
  { cat: '主题', desc: '外观 / 配色 / 字体', icons: [
    ['palette', '配色主题'], ['brush', '画笔自定义'], ['paint', '涂装风格'],
    ['contrast-2', '明暗对比'], ['sun-moon', '昼夜切换'], ['color-picker', '取色器'],
    ['text-size', '字号字重'], ['color-swatch', '色卡样本'], ['layers-subtract', '分层外观'],
  ]},
  { cat: '终端', desc: 'Shell / 远程 / 脚本', icons: [
    ['terminal', '终端'], ['terminal-2', '会话终端'], ['command', '命令执行'],
    ['device-desktop-cog', '远程会话'], ['file-code-2', '脚本文件'], ['keyboard', '键盘映射'],
    ['pointer', '鼠标操作'], ['columns-2', '分屏终端'],
  ]},
  { cat: 'Git', desc: '版本 / 提交 / 分支', icons: [
    ['brand-git', '版本控制'], ['git-branch', '分支'], ['git-commit', '提交'],
    ['git-merge', '合并'], ['git-pull-request', '合并请求'], ['git-fork', '分叉'],
    ['git-compare', '版本对比'], ['tag', '版本标签'], ['history', '提交历史'],
  ]},
  { cat: '编辑器', desc: '文档 / 批注 / 排版', icons: [
    ['file-text', '文本文档'], ['file-code', '代码文件'], ['note', '空白笔记'],
    ['pencil', '编辑修改'], ['writing-sign', '手写批注'], ['typography', '排版样式'],
    ['list', '清单列表'], ['text-spellcheck', '拼写校对'], ['cursor-text', '光标输入'],
  ]},
  { cat: '代理', desc: '智能体 / 编排 / 身份', icons: [
    ['robot', '智能体'], ['message-chatbot', '对话体'], ['affiliate', '多体协作'],
    ['sparkles', '智能生成'], ['topology-star-3', '拓扑协同'], ['network', '编排拓扑'],
    ['route', '任务流'], ['user-circle', '使用者身份'], ['user-cog', '身份配置'],
  ]},
  { cat: '数据', desc: '库表 / 指标 / 同步', icons: [
    ['database', '数据库'], ['database-cog', '实时同步'], ['table', '数据表'],
    ['table-row', '行视图'], ['columns-3', '列视图'], ['chart-dots', '指标统计'],
    ['server-2', '本地存储'], ['server', '数据服务'], ['math-function', '汇总计算'],
  ]},
  { cat: '安全', desc: '权限 / 加密 / 隐私', icons: [
    ['shield', '防护'], ['shield-check', '已加固'], ['lock', '锁定'], ['key', '密钥'],
    ['fingerprint', '生物识别'], ['face-id', '人脸验证'], ['eye-off', '隐私模式'],
    ['file-lock', '加密文件'], ['user-check', '身份认证'], ['shield-lock', '隔离加固'],
  ]},
  { cat: '翻译', desc: '多语言 / 校对 / 对照', icons: [
    ['language', '多语言'], ['text-spellcheck', '拼写校对'], ['replace', '替换文本'],
    ['arrows-left-right', '双语对照'], ['book-2', '词条解释'], ['typography', '文本处理'],
    ['file-type-txt', '字符集'], ['scan', '文字提取'],
  ]},
  { cat: '日历', desc: '日程 / 计划 / 时间', icons: [
    ['calendar', '日历'], ['calendar-month', '月视图'], ['calendar-event', '定时任务'],
    ['calendar-check', '已排期'], ['calendar-plus', '新建日程'], ['calendar-cancel', '取消日程'],
    ['calendar-heart', '重点标记'], ['calendar-search', '日程检索'], ['clock', '时刻'],
  ]},
  { cat: '邮件', desc: '收发 / 附件 / 联系人', icons: [
    ['mail', '邮件'], ['mailbox', '收件箱'], ['send', '发送邮件'], ['mail-forward', '转发'],
    ['paperclip', '附件'], ['mail-check', '已送达'], ['mail-x', '退信警告'],
    ['address-book', '联系人'], ['mail-plus', '新邮件'],
  ]},
  { cat: '图表', desc: '统计 / 趋势 / 汇总', icons: [
    ['chart-bar', '柱状图'], ['chart-line', '折线图'], ['chart-donut', '占比图'],
    ['chart-histogram', '分布图'], ['chart-dots', '散点图'], ['trending-up', '上升趋势'],
    ['activity', '活跃曲线'], ['gauge', '仪表盘'], ['sum', '总计'],
  ]},
  { cat: '媒体', desc: '图 / 音 / 视频 / 播放', icons: [
    ['photo', '图片'], ['photo-plus', '图集'], ['movie', '视频'], ['music', '音频'],
    ['player-play', '播放'], ['antenna-bars-5', '广播流'], ['device-tv', '屏幕投送'], ['headphones', '耳机'],
    ['microphone', '录音'], ['camera', '相机'],
  ]},
  { cat: '其他', desc: '未归类 / 兜底', icons: [
    ['puzzle', '插件'], ['package', '扩展包'], ['box', '集合'], ['components', '组件'],
    ['help-circle', '帮助'], ['asterisk', '其它'], ['infinity', '更多'],
    ['arrows-shuffle', '随机'],
  ]},
]

// ── 通用操作图标（界面动作用）──
const ACTIONS = [
  ['search', '搜索'], ['refresh', '刷新'], ['plus', '新增'], ['check', '确认'],
  ['x', '关闭'], ['chevron-right', '前进'], ['chevron-left', '后退'], ['chevron-down', '展开'],
  ['arrows-maximize', '放大'], ['arrows-minimize', '缩小'], ['arrow-up', '上移'], ['arrow-down', '下移'],
  ['external-link', '外部打开'], ['copy', '复制'], ['trash', '删除'], ['filter', '过滤'],
  ['dots', '更多操作'], ['layout-sidebar', '左栏'], ['layout-sidebar-right', '右栏'],
  ['loader-2', '加载中'], ['alert-triangle', '警告'], ['info-circle', '说明'], ['circle-check', '完成'],
  ['settings', '设置'], ['download', '下载'], ['upload', '上传'], ['power', '启用/停用'],
  ['device-floppy', '保存'], ['star', '收藏'], ['link', '链接'], ['clock', '最近'],
]

// ── 读 SVG 并转成内联标记（光学归一：内容统一缩放并精确居中，与原型共用同一实现）──
const ALL_NAMES = [...new Set([
  ...Object.values(KEY_TO_TABLER),
  ...CATALOG.flatMap((g) => g.icons.map(([n]) => n)),
  ...ACTIONS.map(([n]) => n),
])]
const ICON_SET = loadNormalized(CACHE, ALL_NAMES)
function readSvg(name) {
  return ICON_SET[name] || null
}

// ── 校验 ──
const used = new Set()
const problems = []
for (const g of CATALOG) {
  const seen = new Set()
  for (const [n] of g.icons) {
    if (!readSvg(n)) { problems.push(`${g.cat}/${n} 缺失`); continue }
    if (seen.has(n)) problems.push(`${g.cat}/${n} 同分类重复`)
    seen.add(n)
    used.add(n)
  }
}
for (const [n] of ACTIONS) { if (!readSvg(n)) problems.push(`actions/${n} 缺失`); used.add(n) }
if (problems.length) { console.error('图标问题：\n' + problems.join('\n')); process.exit(1) }

const icons = {}
for (const n of used) icons[n] = readSvg(n)

const payload = JSON.stringify({ icons, catalog: CATALOG, actions: ACTIONS })

const html = `<!doctype html>
<html lang="zh-CN" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>插件中心图标库 · 黑白版（Tabler Icons / 24 网格）</title>
<style>
/* ── 令牌：图标只有一档「墨色」，深浅随日夜反演 ── */
:root{
  --bg:#f2f2f5; --surface:#ffffff; --surface-2:#f7f7fa; --tile:#ececf1;
  --line:#e2e2e8; --line-2:#ededf1;
  --ink:#111114; --ink-2:#4b4b53; --ink-3:#86868e; --ink-4:#b6b6bf;
  --shadow:0 1px 2px rgba(0,0,0,.06),0 0 0 1px var(--line-2);
  --shadow-pop:0 16px 44px rgba(20,22,30,.16),0 2px 8px rgba(20,22,30,.06),0 0 0 .5px rgba(20,22,30,.1);
  --radius:12px;
  --font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  --code:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#101013; --surface:#191a1f; --surface-2:#202127; --tile:#26272e;
    --line:#2d2e35; --line-2:#24252b;
    --ink:#f4f4f7; --ink-2:#b9b9c2; --ink-3:#7c7c86; --ink-4:#55555f;
    --shadow:0 1px 2px rgba(0,0,0,.5),0 0 0 1px var(--line-2);
    --shadow-pop:0 16px 44px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4),0 0 0 .5px rgba(255,255,255,.08);
  }
}
:root[data-theme="dark"]{
  --bg:#101013; --surface:#191a1f; --surface-2:#202127; --tile:#26272e;
  --line:#2d2e35; --line-2:#24252b;
  --ink:#f4f4f7; --ink-2:#b9b9c2; --ink-3:#7c7c86; --ink-4:#55555f;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 0 0 1px var(--line-2);
  --shadow-pop:0 16px 44px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4),0 0 0 .5px rgba(255,255,255,.08);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.55 var(--font);padding:28px 24px 80px;-webkit-font-smoothing:antialiased}
.wrap{max-width:1320px;margin:0 auto}
h1{font-size:20px;font-weight:700;letter-spacing:-.01em;margin:0 0 6px}
h2{font-size:15px;font-weight:650;margin:0 0 4px}
h3{font-size:13px;font-weight:650;margin:0}
p{margin:0}
.lead{color:var(--ink-2);font-size:12.5px;max-width:860px}
code{font-family:var(--code);font-size:11.5px;background:var(--tile);border-radius:4px;padding:1px 5px}
.head{display:flex;align-items:flex-start;gap:18px}
.head .grow{flex:1}
.theme{display:inline-flex;background:var(--tile);border-radius:9px;padding:2px;gap:2px}
.theme button{background:none;border:0;border-radius:7px;color:var(--ink-3);cursor:pointer;font:inherit;font-size:12px;padding:5px 11px}
.theme button.on{background:var(--surface);box-shadow:var(--shadow);color:var(--ink);font-weight:600}
.rule{height:1px;background:var(--line);margin:22px 0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
.sec{padding:18px 20px;margin-bottom:14px}
.sec-head{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}
.sec-head .sub{color:var(--ink-3);font-size:11.5px}
.sec-head .count{color:var(--ink-4);font-size:11px;font-variant-numeric:tabular-nums;margin-left:auto}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(108px,1fr))}
/* 图标块：24 网格内居中，四周留 2px 安全边 */
.tile{align-items:center;background:var(--tile);border-radius:10px;color:var(--ink);display:flex;flex:none;height:48px;justify-content:center;overflow:hidden;position:relative;width:48px}
.tile svg{display:block;flex:none}
.item{background:var(--surface-2);border:1px solid var(--line-2);border-radius:10px;display:flex;flex-direction:column;align-items:center;gap:7px;padding:11px 6px 9px;text-align:center}
.item .lb{color:var(--ink-2);font-size:11px;line-height:1.35}
.item .nm{color:var(--ink-4);font-family:var(--code);font-size:9.5px;line-height:1.2;word-break:break-all}
.item:hover{border-color:var(--ink-4)}
.bar{align-items:center;display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.search{align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:9px;display:flex;gap:8px;padding:0 10px;height:32px;width:230px;color:var(--ink-3)}
.search input{background:none;border:0;color:var(--ink);font:inherit;font-size:12px;outline:none;width:100%}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{background:var(--surface);border:1px solid var(--line);border-radius:999px;color:var(--ink-2);cursor:pointer;font:inherit;font-size:11.5px;padding:4px 11px}
.chip.on{background:var(--ink);border-color:var(--ink);color:var(--surface);font-weight:600}
.seg{display:inline-flex;background:var(--tile);border-radius:8px;padding:2px;gap:2px}
.seg button{background:none;border:0;border-radius:6px;color:var(--ink-3);cursor:pointer;font:inherit;font-size:11.5px;padding:4px 10px}
.seg button.on{background:var(--surface);box-shadow:var(--shadow);color:var(--ink);font-weight:600}
.demo{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(270px,1fr))}
.demo .box{background:var(--surface-2);border:1px solid var(--line-2);border-radius:10px;padding:14px}
.demo .t{color:var(--ink-3);font-size:11px;margin-bottom:10px}
.row{display:flex;align-items:center;gap:10px}
.row .tile{height:34px;width:34px;border-radius:9px}
.row .nm{font-size:12.5px;font-weight:600}
.row .sb{color:var(--ink-3);font-size:11px}
.btn{align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:9px;color:var(--ink-2);display:inline-flex;font:inherit;font-size:12px;gap:6px;padding:6px 11px}
.btn.ghost{background:var(--tile);border-color:transparent}
.pill{align-items:center;background:var(--tile);border-radius:999px;color:var(--ink-2);display:inline-flex;font-size:11.5px;gap:5px;padding:4px 10px}
.sizes{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap}
.sz{display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--ink-3);font-size:11px}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border-bottom:1px solid var(--line-2);padding:8px 10px;text-align:left}
th{color:var(--ink-3);font-size:11px;font-weight:600}
td.num{font-variant-numeric:tabular-nums;text-align:right;width:70px}
.pick{color:var(--ink);font-weight:600}
footer{color:var(--ink-4);font-size:11px;padding:10px 2px}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div class="grow">
      <h1>插件中心图标库 · 黑白版</h1>
      <p class="lead">图标取自 <b>Tabler Icons</b>（MIT 许可，24 网格 / 2 描边 / <code>currentColor</code>）：全部 outline 线性风格，<b>一律黑白</b>，不按分类上色；分类靠<b>形状语义</b>区分，同一分类内按插件实际功能给不同图标（工程向：终端、容器、拓扑、仪表盘…）。
      颜色只有「墨色」一档，由 <code>--ink</code> 控制，白天近黑、夜晚近白。</p>
    </div>
    <div class="theme" id="themeSeg">
      <button data-mode="auto" class="on">跟随系统</button>
      <button data-mode="light">白天</button>
      <button data-mode="dark">夜晚</button>
    </div>
  </div>

  <div class="rule"></div>

  <div class="card sec">
    <div class="sec-head"><h2>选型对比</h2><span class="sub">同为 MIT / ISC 的开源线性图标集</span></div>
    <table>
      <thead><tr><th>图标集</th><th>许可</th><th>数量</th><th>工程语义</th><th>结论</th></tr></thead>
      <tbody>
        <tr><td class="pick">Tabler Icons</td><td>MIT</td><td class="num">4900+</td><td>终端/容器/拓扑/仪表/文件类型齐全，图形几何规整</td><td class="pick">采用</td></tr>
        <tr><td>Lucide</td><td>ISC</td><td class="num">1500+</td><td>偏通用，缺少工程细分（无终端/容器/拓扑）</td><td>现插件中心在用</td></tr>
        <tr><td>Phosphor</td><td>MIT</td><td class="num">1500+</td><td>多字重、偏产品感</td><td>备选</td></tr>
        <tr><td>Simple Icons</td><td>CC0</td><td class="num">3000+</td><td>仅品牌标志（GitHub/npm 等）</td><td>用于品牌插件</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card sec">
    <div class="sec-head"><h2>规范速览</h2><span class="sub">格网 / 描边 / 尺寸 / 色彩</span></div>
    <div class="demo">
      <div class="box">
        <div class="t">尺寸（14–24px 均清晰，24 网格内缩放居中）</div>
        <div class="sizes" id="sizes"></div>
      </div>
      <div class="box">
        <div class="t">色彩：只有墨色一档，靠层级区分</div>
        <div class="sizes">
          <div class="sz"><span class="tile" data-ink="var(--ink)"></span><span>ink 默认</span></div>
          <div class="sz"><span class="tile" data-ink="var(--ink-2)"></span><span>ink-2 次级</span></div>
          <div class="sz"><span class="tile" data-ink="var(--ink-3)"></span><span>ink-3 弱化</span></div>
          <div class="sz"><span class="tile" data-ink="var(--ink-4)"></span><span>ink-4 禁用</span></div>
        </div>
      </div>
      <div class="box">
        <div class="t">描边：2 为默认，1.5 仅用于 ≥20px</div>
        <div class="sizes">
          <div class="sz"><span class="tile" data-stroke="2"></span><span>stroke 2</span></div>
          <div class="sz"><span class="tile" data-stroke="1.5"></span><span>stroke 1.5</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="card sec">
    <div class="sec-head"><h2>用法</h2><span class="sub">图标块 / 列表行 / 按钮 / 状态 chip</span></div>
    <div class="demo" id="usage"></div>
  </div>

  <div class="card sec">
    <div class="sec-head"><h2>通用操作图标</h2><span class="sub">不属分类，用于界面动作</span><span class="count" id="actCount"></span></div>
    <div class="grid" id="actions"></div>
  </div>

  <div class="card sec">
    <div class="sec-head"><h2>分类图标</h2><span class="sub">25 个分类，同分类内按语义给不同图标</span><span class="count" id="catCount"></span></div>
    <div class="bar">
      <div class="search">
        <span id="searchIcon"></span>
        <input id="q" placeholder="搜索图标名或语义，如 terminal / 记忆">
      </div>
      <div class="chips" id="catChips"></div>
      <span class="grow" style="flex:1"></span>
      <div class="seg" id="sizeSeg">
        <button data-size="16" class="on">16</button>
        <button data-size="18">18</button>
        <button data-size="20">20</button>
        <button data-size="24">24</button>
      </div>
    </div>
    <div id="groups"></div>
  </div>

  <footer>Tabler Icons（MIT 许可，tabler.io/icons）· 页面由 scripts/build-plugin-icon-library.mjs 生成</footer>
</div>

<script>
const DATA = ${payload};
const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));

/** 渲染图标节点：24 网格、2 描边、currentColor（黑白） */
function iconEl(name,size,stroke){
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("width",size);svg.setAttribute("height",size);
  svg.setAttribute("viewBox","0 0 24 24");
  svg.setAttribute("fill","none");
  svg.setAttribute("stroke","currentColor");
  svg.setAttribute("stroke-width",stroke||2);
  svg.setAttribute("stroke-linecap","round");
  svg.setAttribute("stroke-linejoin","round");
  svg.innerHTML = DATA.icons[name]||"";
  return svg;
}

/* 主题：跟随系统 / 白天 / 夜晚 */
const seg=$("#themeSeg");
seg.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  $$("#themeSeg button").forEach(x=>x.classList.toggle("on",x===b));
  const mode=b.dataset.mode;
  if(mode==="auto")document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme",mode);
});

/* 尺寸示例 */
const SIZES=[[14,'14px'],[16,'16px'],[18,'18px'],[20,'20px'],[24,'24px']];
$("#sizes").innerHTML=SIZES.map(([s,l])=>'<div class="sz"><span class="tile" style="height:'+(s+16)+'px;width:'+(s+16)+'px"></span><span>'+l+'</span></div>').join("");
SIZES.forEach(([s])=>{const el=$("#sizes").children[SIZES.findIndex(x=>x[0]===s)];
  el.querySelector(".tile").appendChild(iconEl("terminal-2",s));});

/* 墨色与描边示例 */
$$('[data-ink],[data-stroke]').forEach(el=>{
  if(el.dataset.ink)el.style.color=el.dataset.ink;
  el.appendChild(iconEl('terminal-2',18,el.dataset.stroke?Number(el.dataset.stroke):2));
});

/* 场景示例 */
$("#usage").innerHTML=
  '<div class="box"><div class="t">卡片图标块（36–44px 圆角底）</div>'+
    '<div class="row"><span class="tile" data-demo="building-store" data-size="24"></span><div><div class="nm">dsh-market</div><div class="sb">市场 · v1.4.2</div></div></div></div>'+
  '<div class="box"><div class="t">榜单行（28px 图标 + 名称）</div>'+
    '<div class="row"><span class="tile" data-demo="terminal-2" data-size="18"></span><div><div class="nm">dsh-TUI</div><div class="sb">界面 · ↓ 17.0k</div></div></div></div>'+
  '<div class="box"><div class="t">按钮内嵌（13px）</div>'+
    '<div class="row"><span class="btn"><span class="tile" data-demo="download" data-size="13" style="background:none;width:13px;height:13px"></span>安装</span>'+
    '<span class="btn ghost"><span class="tile" data-demo="external-link" data-size="13" style="background:none;width:13px;height:13px"></span>详情</span></div></div>'+
  '<div class="box"><div class="t">状态 chip（12px）</div>'+
    '<div class="row"><span class="pill"><span class="tile" data-demo="layout-sidebar-left-expand" data-size="12" style="background:none;width:12px;height:12px"></span>界面</span>'+
    '<span class="pill"><span class="tile" data-demo="message" data-size="12" style="background:none;width:12px;height:12px"></span>会话</span></div></div>';
$$('#usage .tile[data-demo]').forEach(el=>{
  el.appendChild(iconEl(el.dataset.demo,+(el.dataset.size||16)));
});

/* 通用操作图标 */
$("#actions").innerHTML=DATA.actions.map(([n,lb])=>
  '<div class="item" data-name="'+n+'" data-label="'+lb+'"><span class="tile"></span><span class="lb">'+lb+'</span><span class="nm">'+n+'</span></div>').join("");
$("#actCount").textContent=DATA.actions.length+" 个";
DATA.actions.forEach(([n])=>{const el=$('#actions .item[data-name="'+n+'"] .tile');el.appendChild(iconEl(n,18));});

/* 分类 chips */
const state={cat:"all",q:"",size:16};
const chips=$("#catChips");
chips.innerHTML='<button class="chip on" data-cat="all">全部</button>'+
  DATA.catalog.map(g=>'<button class="chip" data-cat="'+g.cat+'">'+g.cat+'</button>').join("");
chips.addEventListener("click",e=>{
  const b=e.target.closest(".chip");if(!b)return;
  state.cat=b.dataset.cat;
  $$(".chip",chips).forEach(x=>x.classList.toggle("on",x===b));
  render();
});
$("#sizeSeg").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  state.size=+b.dataset.size;
  $$("#sizeSeg button").forEach(x=>x.classList.toggle("on",x===b));
  render();
});
$("#q").addEventListener("input",e=>{state.q=e.target.value.trim().toLowerCase();render();});
$("#searchIcon").appendChild(iconEl("search",14));

function render(){
  const host=$("#groups");
  host.innerHTML="";
  let shown=0;
  DATA.catalog.forEach(g=>{
    if(state.cat!=="all"&&state.cat!==g.cat)return;
    const items=g.icons.filter(([n,lb])=>!state.q||n.includes(state.q)||lb.toLowerCase().includes(state.q));
    if(!items.length)return;
    shown+=items.length;
    const sec=document.createElement("div");
    sec.style.marginBottom="22px";
    sec.innerHTML='<div class="sec-head"><h3>'+g.cat+'</h3><span class="sub">'+g.desc+'</span><span class="count">'+items.length+'</span></div>';
    const grid=document.createElement("div");
    grid.className="grid";
    items.forEach(([n,lb])=>{
      const it=document.createElement("div");
      it.className="item";
      it.innerHTML='<span class="tile"></span><span class="lb">'+lb+'</span><span class="nm">'+n+'</span>';
      it.querySelector(".tile").appendChild(iconEl(n,state.size));
      grid.appendChild(it);
    });
    sec.appendChild(grid);
    host.appendChild(sec);
  });
  $("#catCount").textContent=shown+" / "+DATA.catalog.reduce((n,g)=>n+g.icons.length,0)+" 个";
}
render();
</script>
</body>
</html>`

fs.writeFileSync(OUT, html, 'utf8')
console.log('written:', OUT, (html.length / 1024).toFixed(1) + ' KB | icons:', used.size)
