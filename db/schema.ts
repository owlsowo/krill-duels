import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey().notNull(),
  host: text('host').notNull(),
  guest: text('guest'),
  version: text('version').notNull(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(0),
  hostSeen: integer('host_seen').notNull(),
  guestSeen: integer('guest_seen').notNull().default(0),
  expires: integer('expires').notNull(),
}, table => [index('rooms_expires').on(table.expires)]);
