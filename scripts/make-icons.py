#!/usr/bin/env python3
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "icons"


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size, pixel):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y, size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def pixel(x, y, size):
    nx = (x + 0.5) / size
    ny = (y + 0.5) / size
    ink = (22, 56, 44, 255)
    paper = (244, 239, 228, 255)
    gold = (212, 164, 52, 255)
    dx = max(abs(nx - 0.5) - 0.42, 0)
    dy = max(abs(ny - 0.5) - 0.42, 0)
    if dx * dx + dy * dy > 0.08 * 0.08:
        return (0, 0, 0, 0)
    if 0.24 <= nx <= 0.76 and 0.16 <= ny <= 0.70:
        for line in (0.32, 0.44, 0.56):
            if 0.32 <= nx <= 0.68 and abs(ny - line) <= 0.018:
                return ink
        return paper
    if abs(nx - 0.5) * 1.35 + (ny - 0.82) < 0.07 and ny > 0.78:
        return gold
    return ink


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        write_png(ROOT / f"icon{size}.png", size, pixel)
