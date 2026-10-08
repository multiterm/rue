import {conversationSchema} from './conversation-schema.js'
import {domainSchema} from './domain-schema.js'
export * from './conversation-schema.js'
export * from './domain-schema.js'
export const postgresSchema={...conversationSchema,...domainSchema}
