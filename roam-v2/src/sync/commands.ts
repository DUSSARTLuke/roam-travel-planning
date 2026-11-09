import type { RoamDatabase } from '../db/database'
import type { EntityState } from './model'

export class LocalRevisionConflict extends Error {
  readonly entityKey: string
  readonly expected: number
  readonly actual: number
  constructor(entityKey: string, expected: number, actual: number) {
    super('Ces données ont changé. Conserve ta saisie puis recharge leur dernière version.'); this.name = 'LocalRevisionConflict'; this.entityKey = entityKey; this.expected = expected; this.actual = actual
  }
}
// Local command envelope for future adapters. Business validation stays in repositories.
// A successful retry does not invoke action again. Never perform network inside action.
export async function runLocalCommand(database: RoamDatabase, command: { id: string; fingerprint: string; expected: { key: string; revision: number; identity?: string }[] }, action: () => Promise<void>): Promise<'applied' | 'already-applied'> {
  if (!command.id.trim() || command.id.length > 512 || !command.fingerprint.trim() || command.fingerprint.length > 16384 || command.expected.some((item) => !Number.isSafeInteger(item.revision) || item.revision < 0 || item.revision > 0 && !item.identity)) throw new Error('Commande locale invalide.')
  const fingerprint = JSON.stringify([command.fingerprint, command.expected])
  return database.transaction('rw', database.tables, async () => {
    const done = await database.syncCommands.get(command.id)
    if (done) {
      if (done.fingerprint !== fingerprint) throw new Error('Identifiant de commande réutilisé pour une autre opération.')
      return 'already-applied'
    }
    for (const expected of command.expected) {
      const state = await database.syncEntities.get(expected.key)
      const actual = state?.revision ?? 0
      if (actual !== expected.revision || state?.identity !== expected.identity) throw new LocalRevisionConflict(expected.key, expected.revision, actual)
    }
    await action()
    await database.syncCommands.add({ id: command.id, fingerprint, completedAt: new Date().toISOString() })
    return 'applied'
  })
}
export function revisionMatches(state: EntityState | undefined, expected: number) { return (state?.revision ?? 0) === expected }
