"""Generate the code-native Roam compass icons using only Python's standard library."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'pwa'
BACKGROUND = (11, 18, 32)
AMBER = (245, 158, 11)
WHITE = (248, 250, 252)


def triangle(x, y, points):
    crosses = [(b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
               for a, b in zip(points, points[1:] + points[:1])]
    return all(v >= 0 for v in crosses) or all(v <= 0 for v in crosses)


def pixel(x, y):
    if triangle(x, y, [(352, 160), (288, 288), (224, 224)]):
        return AMBER
    if triangle(x, y, [(160, 352), (224, 224), (288, 288)]):
        return WHITE
    if abs(math.hypot(x - 256, y - 256) - 160) <= 11:
        return AMBER
    return BACKGROUND


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def generate(size):
    data = bytearray()
    for row in range(size):
        data.append(0)
        for column in range(size):
            samples = [pixel((column + (sx + .5) / 3) * 512 / size,
                             (row + (sy + .5) / 3) * 512 / size)
                       for sx in range(3) for sy in range(3)]
            data.extend(round(sum(sample[channel] for sample in samples) / 9) for channel in range(3))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(data), 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    ROOT.mkdir(parents=True, exist_ok=True)
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('icon-maskable-512.png', 512), ('apple-touch-icon.png', 180)]:
        (ROOT / name).write_bytes(generate(size))
