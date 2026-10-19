import type { ChannelAdapter } from '@/lib/channels/types';
import { ChannelNotConfiguredError, UnsupportedMessageError } from '@/lib/channels/types';
import { getInstagramToken, sendInstagramMessage } from './client';

export const instagramChannel: ChannelAdapter = {
  type: 'instagram',
  capabilities: {
    templates: false,
    broadcasts: false,
    interactive: false,
    media: ['image', 'video', 'audio', 'document'],
    reactions: true,
    replyContext: true,
    replyWindowHours: 24,
  },
  async send({ db, accountId, conversationId, channel, recipient }, message, options) {
    if (!channel?.external_id || channel.status !== 'connected') {
      throw new ChannelNotConfiguredError('instagram', 'Instagram is not connected');
    }
    const { data: conversation } = await db.from('conversations')
      .select('last_inbound_at').eq('id', conversationId)
      .eq('account_id', accountId).eq('channel_id', channel.id).single();
    const lastInbound = Date.parse(conversation?.last_inbound_at ?? '');
    if (!Number.isFinite(lastInbound) || Date.now() - lastInbound > 24 * 60 * 60 * 1000) {
      throw new UnsupportedMessageError('Instagram reply window has closed');
    }
    if (message.type !== 'text' && message.type !== 'media') {
      throw new UnsupportedMessageError('Instagram supports text and media replies here');
    }
    const media = message.type === 'media'
      ? { type: message.kind === 'document' ? 'file' as const : message.kind, url: message.url }
      : undefined;
    const messageId = await sendInstagramMessage({
      userId: channel.external_id,
      recipientId: recipient.externalId,
      token: await getInstagramToken(accountId, channel.id),
      ...(message.type === 'text' ? { text: message.text } : { media }),
      replyTo: options?.contextMessageId,
    });
    return { messageId, via: 'instagram' };
  },
};
