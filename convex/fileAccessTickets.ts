import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

const fileAccessTicketRecordValidator = v.object({
  createdAt: v.number(),
  expiresAt: v.number(),
  ipAddress: v.union(v.string(), v.null()),
  issuedFromSessionId: v.union(v.string(), v.null()),
  issuedToUserId: v.string(),
  organizationId: v.union(v.string(), v.null()),
  purpose: v.string(),
  sourceSurface: v.string(),
  redeemedAt: v.union(v.number(), v.null()),
  storageId: v.string(),
  ticketId: v.string(),
  userAgent: v.union(v.string(), v.null()),
});

export const getByTicketIdInternal = internalQuery({
  args: {
    ticketId: v.string(),
  },
  returns: v.union(fileAccessTicketRecordValidator, v.null()),
  handler: async (ctx, args) => {
    const ticket = await ctx.db
      .query('fileAccessTickets')
      .withIndex('by_ticketId', (q) => q.eq('ticketId', args.ticketId))
      .unique();

    if (!ticket) {
      return null;
    }

    return {
      ...ticket,
      organizationId: ticket.organizationId ?? null,
      redeemedAt: ticket.redeemedAt ?? null,
      ipAddress: ticket.ipAddress ?? null,
      issuedFromSessionId: ticket.issuedFromSessionId ?? null,
      userAgent: ticket.userAgent ?? null,
    };
  },
});

export const createInternal = internalMutation({
  args: {
    expiresAt: v.number(),
    ipAddress: v.union(v.string(), v.null()),
    issuedFromSessionId: v.union(v.string(), v.null()),
    issuedToUserId: v.string(),
    organizationId: v.union(v.string(), v.null()),
    purpose: v.string(),
    sourceSurface: v.string(),
    storageId: v.string(),
    ticketId: v.string(),
    userAgent: v.union(v.string(), v.null()),
  },
  returns: fileAccessTicketRecordValidator,
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    await ctx.db.insert('fileAccessTickets', {
      ...args,
      createdAt,
    });

    return {
      ...args,
      createdAt,
      redeemedAt: null,
    };
  },
});

export const redeemInternal = internalMutation({
  args: {
    redeemedAt: v.number(),
    ticketId: v.string(),
  },
  returns: v.union(fileAccessTicketRecordValidator, v.null()),
  handler: async (ctx, args) => {
    const ticket = await ctx.db
      .query('fileAccessTickets')
      .withIndex('by_ticketId', (q) => q.eq('ticketId', args.ticketId))
      .unique();

    if (!ticket) {
      return null;
    }

    if (ticket.redeemedAt) {
      throw new ConvexError('File access ticket has already been redeemed.');
    }

    if (ticket.expiresAt <= args.redeemedAt) {
      throw new ConvexError('File access ticket has expired.');
    }

    await ctx.db.patch(ticket._id, {
      redeemedAt: args.redeemedAt,
    });

    return {
      ...ticket,
      organizationId: ticket.organizationId ?? null,
      redeemedAt: args.redeemedAt,
      ipAddress: ticket.ipAddress ?? null,
      issuedFromSessionId: ticket.issuedFromSessionId ?? null,
      userAgent: ticket.userAgent ?? null,
    };
  },
});
