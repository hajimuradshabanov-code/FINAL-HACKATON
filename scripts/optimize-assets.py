import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
im.save(dst, "WEBP", quality=82, method=6)

logo = Image.open(sys.argv[3]).convert("RGB")
logo.thumbnail((420, 420))
logo.save(sys.argv[4], "WEBP", quality=88, method=6)
