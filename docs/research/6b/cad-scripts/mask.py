# 사용: python3 -I mask.py <입력> x0 y0 x1 y1 <색: red|blue|green|gray> [행 간격]
import sys
import numpy as np
from PIL import Image
src = sys.argv[1]
x0, y0, x1, y1 = map(int, sys.argv[2:6])
kind = sys.argv[6]
step = int(sys.argv[7]) if len(sys.argv) > 7 else 10
a = np.asarray(Image.open(src).convert('RGB')).astype(int)[y0:y1, x0:x1]
r, g, b = a[..., 0], a[..., 1], a[..., 2]
if kind == 'red':
    m = (r > 150) & (g < 90) & (b < 90)
elif kind == 'blue':
    m = (b > 120) & (r < 80) & (g < 110)
elif kind == 'green':
    m = (g > 150) & (r < 150) & (b < 120)
elif kind == 'dark':
    m = (r < 90) & (g < 90) & (b < 90)
else:
    m = (abs(r - g) < 12) & (abs(g - b) < 12) & (r < 200) & (r > 60)
ys, xs = np.nonzero(m)
print('bbox x', xs.min() + x0, xs.max() + x0, 'y', ys.min() + y0, ys.max() + y0)
for yy in range(0, m.shape[0], step):
    row = np.nonzero(m[yy])[0]
    if len(row):
        # 연속 구간
        runs = []
        s = row[0]; p = row[0]
        for v in row[1:]:
            if v != p + 1:
                runs.append((s + x0, p + x0)); s = v
            p = v
        runs.append((s + x0, p + x0))
        print(yy + y0, runs[:8])
