export const IMAGE_EXPIRATION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const IMAGE_UPLOAD_UNAVAILABLE_MESSAGE = "暫時無法上傳";

type ImageMetadata = { mimeType: string; size: number };
type PutImage = (
  key: string,
  value: ArrayBuffer,
  options: { expirationTtl: number; metadata: ImageMetadata },
) => Promise<void>;

export async function writeExpiringImage(
  put: PutImage,
  key: string,
  value: ArrayBuffer,
  metadata: ImageMetadata,
): Promise<boolean> {
  try {
    await put(key, value, { expirationTtl: IMAGE_EXPIRATION_TTL_SECONDS, metadata });
    return true;
  } catch {
    return false;
  }
}
