declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    type?: string;
    quality?: number;
    margin?: number;
    scale?: number;
    width?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toDataURL(
    text: string | Buffer,
    options?: QRCodeToDataURLOptions
  ): Promise<string>;

  export function toDataURL(
    text: string | Buffer,
    options: QRCodeToDataURLOptions,
    callback: (error: Error | null, url: string) => void
  ): void;

  export function toString(
    text: string | Buffer,
    options?: any
  ): Promise<string>;
}
