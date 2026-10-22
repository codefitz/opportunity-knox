const LIMIT = 2 * 1024 * 1024;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const reject = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
function pngImage(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG)) return false;
  if (
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    return false;
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width > 16384 || height > 16384) return false;
  let offset = 8,
    data = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if (kind === "IDAT") data = true;
    offset += length + 12;
    if (kind === "IEND") return length === 0 && data && offset === bytes.length;
  }
  return false;
}
function jpegImage(bytes) {
  if (
    bytes.length < 16 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    return false;
  let offset = 2,
    dimensions = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) return dimensions; // Entropy-coded scan follows SOS.
    if (marker === 0xd9) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (length < 8) return false;
      const height = bytes.readUInt16BE(offset + 3),
        width = bytes.readUInt16BE(offset + 5);
      if (!height || !width || width > 16384 || height > 16384) return false;
      dimensions = true;
    }
    offset += length;
  }
  return false;
}
function webpImage(bytes) {
  if (
    bytes.length < 24 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    return false;
  let offset = 12,
    image = false;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", offset, offset + 4),
      length = bytes.readUInt32LE(offset + 4);
    if (length > bytes.length - offset - 8) return false;
    const start = offset + 8;
    if (kind === "VP8 ") {
      if (
        length < 10 ||
        !bytes
          .subarray(start + 3, start + 6)
          .equals(Buffer.from([0x9d, 0x01, 0x2a]))
      )
        return false;
      image =
        Boolean(bytes.readUInt16LE(start + 6) & 0x3fff) &&
        Boolean(bytes.readUInt16LE(start + 8) & 0x3fff);
    } else if (kind === "VP8L") {
      if (length < 5 || bytes[start] !== 0x2f) return false;
      image = true;
    }
    offset += 8 + length + (length % 2);
  }
  return image && offset === bytes.length;
}
/** Validate bytes independently of any filename or claimed browser MIME type. */
export function validateAvatar(imageBase64) {
  if (typeof imageBase64 !== "string")
    reject("Choose a PNG, JPEG, or WebP photo.");
  if (imageBase64.length > Math.ceil(LIMIT / 3) * 4)
    reject("The profile photo must be 2 MiB or smaller.", 413);
  if (
    !imageBase64 ||
    imageBase64.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(imageBase64)
  )
    reject("The photo data is invalid. Choose a PNG, JPEG, or WebP image.");
  const bytes = Buffer.from(imageBase64, "base64");
  if (bytes.length > LIMIT)
    reject("The profile photo must be 2 MiB or smaller.", 413);
  const contentType = pngImage(bytes)
    ? "image/png"
    : jpegImage(bytes)
      ? "image/jpeg"
      : webpImage(bytes)
        ? "image/webp"
        : "";
  if (!contentType)
    reject(
      "Choose a valid PNG, JPEG, or WebP photo. SVG and other file types are not supported.",
    );
  return { contentType, base64: bytes.toString("base64") };
}
