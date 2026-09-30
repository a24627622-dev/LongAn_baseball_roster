#!/usr/bin/env python3
"""球員照片處理：表單收來的照片 → 400×400 大頭貼 → images/players/背號.jpg

由 Claude 在「執行照片更新」時使用（步驟見 DEVELOPMENT.md「球員名單與照片」）。
需要 Python 3、Pillow、opencv-python-headless（pip install pillow opencv-python-headless）。

用法：
  python3 dev/photos/process_photos.py manifest.json [--out images/players] [--players data/players.json]
                                                     [--sheet 對照圖.jpg] [--dry-run]

manifest.json：[{ "number": "6", "file": "下載的照片路徑", "focus": [0.5, 0.35] }, ...]
  - focus（選填）：手動指定臉的中心（寬、高的比例，0～1）。偵測不到臉、或偵測錯人時才需要

做的事：
  1. 依手機的 EXIF 方向轉正，轉成 RGB
  2. 偵測臉部（取最大的一張臉），以臉為中心裁正方形：臉寬的 2.6 倍，臉放在高度 42% 的位置（頭頂留空、帶到肩膀）
     偵測不到臉 → 取畫面中上方的正方形，並在報告與對照圖標「⚠️ 沒偵測到臉」
  3. 縮成 400×400、存成 jpg（品質 85），不保留 EXIF（手機照片的 EXIF 可能有拍攝地點）
  4. data/players.json 裡這些背號的 photo 設成 "images/players/背號.jpg"
  5. 產生對照圖（每張縮圖＋背號姓名），給使用者確認
最後印出 JSON 報告：每張的背號、是否偵測到臉、偵測到幾張臉、輸出檔。
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

SIZE = 400
FACE_SCALE = 2.6      # 裁切邊長 = 臉寬 × 這個倍數
FACE_Y = 0.42         # 臉的中心放在裁切框高度的這個比例
QUALITY = 85
FONT_PATHS = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    'C:/Windows/Fonts/msjh.ttc',
]


def detect_faces(img):
    """回傳 [(x, y, w, h), ...]，座標是原圖尺寸。沒有 OpenCV 時回傳 None。"""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None
    scale = 800 / max(img.size) if max(img.size) > 800 else 1.0
    small = img.resize((round(img.width * scale), round(img.height * scale))) if scale != 1.0 else img
    gray = cv2.cvtColor(np.array(small), cv2.COLOR_RGB2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    min_side = max(30, round(min(small.size) * 0.08))
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side))
    return [tuple(round(v / scale) for v in f) for f in faces]


def crop_box(width, height, center, face_w):
    """以 center（臉中心）為準算正方形裁切框，框不超出圖片。"""
    side = min(width, height, max(round(face_w * FACE_SCALE), 1)) if face_w else min(width, height)
    cx, cy = center
    left = round(cx - side / 2)
    top = round(cy - side * FACE_Y)
    left = min(max(left, 0), width - side)
    top = min(max(top, 0), height - side)
    return (left, top, left + side, top + side)


def process_one(entry, out_dir, dry_run=False):
    number = str(entry['number']).strip()
    img = ImageOps.exif_transpose(Image.open(entry['file'])).convert('RGB')
    w, h = img.size
    faces = detect_faces(img)
    focus = entry.get('focus')
    if focus:
        center, face_w, found = (focus[0] * w, focus[1] * h), min(w, h) / FACE_SCALE * 0.9, 'manual'
    elif faces:
        x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        center, face_w, found = (x + fw / 2, y + fh / 2), fw, 'face'
    else:
        # 沒偵測到臉：取中上方（人像照的臉通常在上半部）
        side = min(w, h)
        center, face_w, found = (w / 2, side * FACE_Y if h > w else h / 2), None, 'none'
    box = crop_box(w, h, center, face_w)
    out = img.crop(box).resize((SIZE, SIZE), Image.LANCZOS)
    dest = Path(out_dir) / f'{number}.jpg'
    if not dry_run:
        dest.parent.mkdir(parents=True, exist_ok=True)
        out.save(dest, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
    return {
        'number': number,
        'file': str(entry['file']),
        'found': found,
        'faces': None if faces is None else len(faces),
        'box': box,
        'output': str(dest),
        'image': out,
    }


def load_font(size):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def contact_sheet(results, names, path, cols=4, thumb=200):
    label_h = 56
    rows = (len(results) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * thumb, rows * (thumb + label_h)), 'white')
    draw = ImageDraw.Draw(sheet)
    font, small = load_font(22), load_font(16)
    for i, r in enumerate(results):
        x, y = (i % cols) * thumb, (i // cols) * (thumb + label_h)
        sheet.paste(r['image'].resize((thumb, thumb)), (x, y))
        draw.text((x + 8, y + thumb + 4), f"#{r['number']} {names.get(r['number'], '（名單上沒有）')}", fill='black', font=font)
        note = {'face': '', 'manual': '手動指定位置', 'none': '⚠ 沒偵測到臉'}[r['found']]
        if r['faces'] and r['faces'] > 1:
            note = f'偵測到 {r["faces"]} 張臉，取最大的'
        if note:
            draw.text((x + 8, y + thumb + 32), note, fill='#b91c1c', font=small)
    sheet.save(path, 'JPEG', quality=85)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('manifest')
    ap.add_argument('--out', default='images/players')
    ap.add_argument('--players', default='data/players.json')
    ap.add_argument('--sheet', default=None, help='對照圖輸出路徑')
    ap.add_argument('--dry-run', action='store_true', help='只算裁切，不寫檔')
    args = ap.parse_args()

    entries = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    players_path = Path(args.players)
    players = json.loads(players_path.read_text(encoding='utf-8'))
    names = {p['number']: p['name'] for p in players}

    unknown = [str(e['number']) for e in entries if str(e['number']) not in names]
    if unknown:
        print(f'❌ 名單上沒有這些背號：{", ".join(unknown)}（先確認試算表與 data/players.json）', file=sys.stderr)
        sys.exit(1)

    results = [process_one(e, args.out, args.dry_run) for e in entries]

    if not args.dry_run:
        done = {r['number'] for r in results}
        for p in players:
            if p['number'] in done:
                p['photo'] = f"images/players/{p['number']}.jpg"
        players_path.write_text(json.dumps(players, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.sheet:
        contact_sheet(results, names, args.sheet)

    print(json.dumps([{k: v for k, v in r.items() if k != 'image'} for r in results], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
