import sys
from PIL import Image, ImageFilter, ImageChops

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
w, h = im.size
blur = im.filter(ImageFilter.GaussianBlur(22))
mask = Image.new("L", im.size, 0)
mask.paste(255, (int(w * 0.33), int(h * 0.2), int(w * 0.67), int(h * 0.78)))
mask = mask.filter(ImageFilter.GaussianBlur(26))
out = Image.composite(blur, im, mask)
out.save(dst, "WEBP", quality=82, method=6)
