import { App } from 'koishi'
import * as _switch from '../src'
import admin from '@koishijs/plugin-admin'
import memory from '@koishijs/plugin-database-memory'
import mock from '@koishijs/plugin-mock'

const app = new App()

app.plugin(memory)
app.plugin(mock)
app.plugin(admin)

const client = app.mock.client('123', '321')

app.plugin(_switch)
app.command('foo', { authority: 4 })
app.command('baz').action(() => 'zab')
app.command('bar').option('x', '-x <x>', { type: () => { throw Error('') } })
app.command('dis', { userCall: 'disabled' }).action(() => 'dis')

before(async () => {
  await app.start()
  await app.mock.initUser('123', 3)
  await app.mock.initChannel('321')
})

beforeEach(async () => {
  await app.database.setChannel('mock', '321', {
    enable: [],
    disable: []
  })
})

describe('koishi-plugin-switch', () => {
  it('basic support', async () => {
    await client.shouldReply('switch -c #123', '未找到指定的频道。')
    await client.shouldReply('switch', '当前没有启用或禁用功能。')
    await client.shouldReply('baz', 'zab')
    await client.shouldReply('switch baz', '已禁用 baz 功能。')
    await client.shouldReply('switch', '当前禁用的功能有：baz')
    await client.shouldNotReply('baz')
    await client.shouldReply('switch baz', '已启用 baz 功能。')
    await client.shouldReply('baz', 'zab')
    await client.shouldReply('switch foo', '您无权修改 foo 功能。')
    await client.shouldReply('switch bar', '已禁用 bar 功能。')
    await client.shouldNotReply('bar -x 1')
    await client.shouldReply('switch', '当前禁用的功能有：bar')
  })

  it('disable by default', async () => {
    await client.shouldNotReply('dis')
    await client.shouldReply('switch dis', '已启用 dis 功能。')
    await client.shouldReply('dis', 'dis')
    await client.shouldReply('switch', '当前启用的功能有：dis')
    await client.shouldReply('switch baz', '已禁用 baz 功能。')
    await client.shouldReply('switch', '当前启用的功能有：dis\n当前禁用的功能有：baz')
    await client.shouldReply('switch -e', '当前启用的功能有：dis')
    await client.shouldReply('switch -d', '当前禁用的功能有：baz')
    await client.shouldReply('switch dis baz', '已启用 baz 功能, 禁用 dis 功能。')
    await client.shouldNotReply('dis')
    await client.shouldReply('baz', 'zab')
  })

  it('with options', async () => {
    await client.shouldReply('switch -d dis', '无任何更改。')
    await client.shouldReply('switch -e bar', '无任何更改。')
    await client.shouldReply('switch -e foo', '您无权修改 foo 功能。')
    await client.shouldReply('switch -r dis bar', '无任何更改。')
    await client.shouldReply('switch dis bar', '已启用 dis 功能, 禁用 bar 功能。')
    await client.shouldReply('switch -e dis', '无任何更改。')
    await client.shouldReply('switch -d bar', '无任何更改。')
    await client.shouldReply('switch -r dis bar', '已启用 bar 功能, 禁用 dis 功能。')
    await client.shouldReply('switch', '当前没有启用或禁用功能。')
  })

  it('options conflict', async () => {
    await client.shouldReply('switch -d -r dis', '选项冲突。')
    await client.shouldReply('switch -d -e dis', '选项冲突。')
    await client.shouldReply('switch -e -r dis', '选项冲突。')
    await client.shouldReply('switch -d -e -r dis', '选项冲突。')
  })

  it('reset', async () => {
    await client.shouldReply('switch -r', '当前没有启用或禁用功能。')
    await client.shouldReply('switch dis bar', '已启用 dis 功能, 禁用 bar 功能。')
    await client.shouldReply('switch -r', '当前启用的功能有：dis\n当前禁用的功能有：bar\n要重置所有功能, 使用-R参数。')
    await client.shouldReply('switch -R', '已重置所有功能。')
    await client.shouldReply('switch -r', '当前没有启用或禁用功能。')
  })
})
