import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, createFailureIndex, rootSessionId } from '../lib/index.js';

/** 一条 turn/end 事件；`reason` 是 `event.data.reason.kind`。 */
function turnEnd(reason) {
  return { type: 'turn/end', data: { reason: reason === undefined ? undefined : { kind: reason } } };
}

const start = { type: 'turn/start', data: {} };
const root = { header: { id: 'session-a' } };
const subagent = { header: { id: 'session-sub', origin: 'subagent' } };

test('主会话 id：子智能体会话与缺 id 都返回空串', () => {
  assert.equal(rootSessionId(root), 'session-a');
  assert.equal(rootSessionId(subagent), '');
  assert.equal(rootSessionId({}), '');
});

test('本轮报错 / 中断算异常，正常收尾与主动停止不算', () => {
  const cases = [
    ['completed', false],
    ['aborted', false],
    ['blocked', false],
    ['max-tokens', false],
    ['forked', false],
    [undefined, false],
    ['error', true],
    ['interrupted', true],
  ];
  for (const [reason, failed] of cases) {
    const index = createFailureIndex();
    index.record(root, turnEnd(reason));
    assert.deepEqual(index.state().failed, failed ? ['session-a'] : [], `reason=${String(reason)}`);
  }
});

test('子智能体的失败不进索引', () => {
  const index = createFailureIndex();
  index.record(subagent, turnEnd('error'));
  assert.deepEqual(index.state().failed, []);
});

test('新一轮开始清掉上一次失败（红点不盖住下一次正常完成）', () => {
  const index = createFailureIndex();
  index.record(root, turnEnd('error'));
  assert.deepEqual(index.state().failed, ['session-a']);
  index.record(root, start);
  assert.deepEqual(index.state().failed, []);
});

test('失败之后正常收尾也会清掉标记', () => {
  const index = createFailureIndex();
  index.record(root, turnEnd('error'));
  index.record(root, turnEnd('completed'));
  assert.deepEqual(index.state().failed, []);
});

test('revision 只在集合变化时前进（客户端据此判断是否要重画）', () => {
  const index = createFailureIndex();
  const before = index.state().revision;
  index.record(root, { type: 'step/end' });
  assert.equal(index.state().revision, before);
  index.record(root, turnEnd('error'));
  const afterFailure = index.state().revision;
  assert.ok(afterFailure > before);
  index.record(root, turnEnd('error'));
  assert.ok(index.state().revision > afterFailure);
});

test('索引有上限，丢最旧的失败', () => {
  const index = createFailureIndex(2);
  for (const id of ['a', 'b', 'c']) index.record({ header: { id } }, turnEnd('error'));
  assert.deepEqual(index.state().failed, ['b', 'c']);
});

test('插件把路由挂在 webServer 上，返回失败会话列表', async () => {
  const routes = [];
  const sessions = [];
  const ctx = {
    on(name, callback) {
      if (name === 'session/event') sessions.push(callback);
      return () => {};
    },
    inject(names, callback) {
      assert.deepEqual(names, ['webServer']);
      callback({
        effect(setup) { return setup(); },
        webServer: {
          register(route) { routes.push(route); return () => {}; },
        },
      });
    },
  };
  apply(ctx);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, '/dsh-interrupted-dot/state');

  sessions[0](root, turnEnd('error'));

  const headers = {};
  let body = '';
  await routes[0].handler(
    { method: 'GET' },
    {
      writeHead(status, values) { headers.status = status; headers.values = values; },
      end(chunk) { body = chunk ?? ''; },
    },
  );
  assert.equal(headers.status, 200);
  assert.deepEqual(JSON.parse(body).failed, ['session-a']);
});
