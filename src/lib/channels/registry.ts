import { whatsappChannel } from '@/lib/whatsapp/channel-adapter';
import { instagramChannel } from '@/lib/instagram/channel-adapter';
import {
  ChannelNotConfiguredError,
  UnsupportedMessageError,
  type ChannelAdapter,
  type ChannelCapabilities,
  type ChannelMessage,
  type ChannelType,
} from './types';

// One entry per integrated network. Adding a channel = writing its
// adapter and registering it here; nothing else branches on the type.
const ADAPTERS: Partial<Record<ChannelType, ChannelAdapter>> = {
  whatsapp: whatsappChannel,
  instagram: instagramChannel,
};

export function getChannelAdapter(type: ChannelType): ChannelAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) {
    throw new ChannelNotConfiguredError(type, `Channel "${type}" is not available yet.`);
  }
  return adapter;
}

export function getChannelCapabilities(type: ChannelType): ChannelCapabilities | null {
  return ADAPTERS[type]?.capabilities ?? null;
}

/** Throws {@link UnsupportedMessageError} when `type` can't carry `message`. */
export function assertChannelSupports(
  type: ChannelType,
  capabilities: ChannelCapabilities,
  message: ChannelMessage
): void {
  const unsupported =
    (message.type === 'template' && !capabilities.templates) ||
    (message.type === 'interactive' && !capabilities.interactive) ||
    (message.type === 'media' && !capabilities.media.includes(message.kind));
  if (unsupported) {
    const what = message.type === 'media' ? `${message.kind} messages` : `${message.type} messages`;
    throw new UnsupportedMessageError(`${type} does not support ${what}.`);
  }
}
