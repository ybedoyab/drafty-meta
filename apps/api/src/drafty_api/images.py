"""Decode reference images far enough to reject truncated or oversized files."""

PNG = b"\x89PNG\r\n\x1a\n"
MAX_EDGE = 8192
MAX_PIXELS = 16_000_000


def inspect_image(data: bytes) -> tuple[str, int, int]:
    if data.startswith(PNG):
        return "image/png", *_png_size(data)
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", *_jpeg_size(data)
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp", *_webp_size(data)
    raise ValueError("Reference images must be a readable PNG, JPEG, or WebP.")


def _png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or data[12:16] != b"IHDR":
        raise ValueError("The PNG header is truncated.")
    if b"IEND" not in data[-24:]:
        raise ValueError("The PNG file does not end with IEND.")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    _check_size(width, height)
    return width, height


def _jpeg_size(data: bytes) -> tuple[int, int]:
    if not data.endswith(b"\xff\xd9"):
        raise ValueError("The JPEG file is truncated.")
    offset = 2
    while offset + 8 < len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        if marker in {0xC0, 0xC1, 0xC2}:
            height = int.from_bytes(data[offset + 5 : offset + 7], "big")
            width = int.from_bytes(data[offset + 7 : offset + 9], "big")
            _check_size(width, height)
            return width, height
        if marker == 0xD9:
            break
        if offset + 4 > len(data):
            break
        length = int.from_bytes(data[offset + 2 : offset + 4], "big")
        if length < 2:
            break
        offset += 2 + length
    raise ValueError("The JPEG file has no readable image size.")


def _webp_size(data: bytes) -> tuple[int, int]:
    declared = int.from_bytes(data[4:8], "little")
    if declared + 8 != len(data):
        raise ValueError("The WebP length does not match the file.")
    if data[12:16] != b"VP8X" or len(data) < 30:
        raise ValueError("Only VP8X WebP images can be checked in this build.")
    width = int.from_bytes(data[24:27], "little") + 1
    height = int.from_bytes(data[27:30], "little") + 1
    _check_size(width, height)
    return width, height


def _check_size(width: int, height: int) -> None:
    if width < 1 or height < 1 or width > MAX_EDGE or height > MAX_EDGE or width * height > MAX_PIXELS:
        raise ValueError("The image is empty or larger than 8192 pixels on a side.")
