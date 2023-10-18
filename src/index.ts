import { Context, deduplicate, difference, intersection, noop, Schema, Session } from 'koishi'
import {} from '@koishijs/plugin-admin'

declare module 'koishi' {
  namespace Command {
    interface Config {
      disabled?: boolean
      userTriggerDisabled?: boolean
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
    userTriggerDisabled: Schema.boolean().description('禁止用户触发').default(false),
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
      if (command.config.userTriggerDisabled && session.argv.root) {
        session.response = noop
        return
      } else if (command.config.disabled) {
        if (enable.includes(command.name)) return
        session.response = noop
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
    .action(async ({ session }, ...names: string[]) => {
      const channel = session.channel
      if (!names.length) {
        if (!channel.disable.length) return session.text('.none')
        return session.text('.list', [channel.disable.join(', ')])
      }

      names = deduplicate(names)
      const forbidden = names.filter((name) => {
        const command = ctx.$commander._commands.get(name)
        return command && session.resolve(command.config.authority) >= session.user.authority
      })
      if (forbidden.length) return session.text('.forbidden', [forbidden.join(', ')])

      const add = difference(names, channel.disable)
      const remove = intersection(names, channel.disable)
      const preserve = difference(channel.disable, names)
      const output: string[] = []
      if (add.length) output.push(`禁用 ${add.join(', ')} 功能`)
      if (remove.length) output.push(`启用 ${remove.join(', ')} 功能`)
      channel.disable = [...preserve, ...add]
      await channel.$update()
      return `已${output.join('，')}。`
    })
}
