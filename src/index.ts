import { Context, deduplicate, difference, intersection, noop, Schema, Session } from 'koishi'
import {} from '@koishijs/plugin-admin'

declare module 'koishi' {
  namespace Command {
    interface Config {
      userCall?: 'enabled' | 'disabled' | 'aliasOnly'
    }
  }

  interface Channel {
    enable: string[]
    disable: string[]
  }
}

export interface Config {}

export const name = 'switch'
export const using = ['database'] as const
export const Config: Schema<Config> = Schema.object({})

export function apply(ctx: Context, config: Config = {}) {
  ctx.i18n.define('zh', require('./locales/zh-CN'))

  ctx.schema.extend('command', Schema.object({
    userCall: Schema.union([
      Schema.const('enabled').description('允许用户调用'),
      Schema.const('disabled').description('禁止用户调用'),
      Schema.const('aliasOnly').description('仅允许用户使用别名调用'),
    ]).role('radio').description('用户调用方式。').default('enabled'),
  }), 900)

  ctx.model.extend('channel', {
    // enable: 'list',
    disable: 'list',
  })

  ctx.before('attach-channel', (session, fields) => {
    if (!session.argv) return
    // fields.add('enable')
    fields.add('disable')
  })

  // check channel
  ctx.on('attach', (session: Session<never, 'enable' | 'disable'>) => {
    let command = session.argv?.command
    const { enable = [], disable = [] } = session.channel || {}
    while (command) {
      if (command.config.userCall === 'disabled') {
        if (!enable.includes(command.name)) session.response = noop
        return
      } else if (command.config.userCall === 'aliasOnly') {
        const [name] = session.stripped.content.toLowerCase().slice(session.stripped.prefix.length).split(' ', 1)
        if (name === command.name) session.response = noop
        return
      } else if (disable.includes(command.name)) {
        session.response = noop
        return
      }
      command = command.parent as any
    }
  })

  ctx.command('switch <command...>', '启用和禁用功能', { authority: 3, admin: { channel: true } })
    .channelFields(['disable'])
    .userFields(['authority'])
    .option('enable', '-e')
    .option('disable', '-d')
    .action(async ({ session, options }, ...names: string[]) => {
      const channel = session.channel
      if (!names.length) {
        if (!channel.disable.length) return session.text('.none')
        return session.text('.list', [channel.disable.join(', ')])
      }

      if (options.enable && options.disable) return session.text('.conflict')

      names = deduplicate(names)
      const forbidden = names.filter((name) => {
        const command = ctx.$commander._commands.get(name)
        return command && session.resolve(command.config.authority) >= session.user.authority
      })
      if (forbidden.length) return session.text('.forbidden', [forbidden.join(', ')])

      const add = options.enable ? [] : difference(names, channel.disable)
      const remove = options.disable ? [] : intersection(names, channel.disable)
      const preserve = difference(channel.disable, names)
      if (!add.length && !remove.length) return session.text('.unchanged')

      const output: string[] = []
      if (add.length) output.push(`禁用 ${add.join(', ')} 功能`)
      if (remove.length) output.push(`启用 ${remove.join(', ')} 功能`)
      channel.disable = [...preserve, ...add]
      await channel.$update()
      return `已${output.join('，')}。`
    })
}
