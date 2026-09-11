#!/usr/bin/env python3
"""Every QR in the page must encode the address printed beside it.

A QR nobody can read by eye is the one thing on the page that cannot be
proof-read. So it gets decoded here, twice, by two unrelated decoders -- if
they disagree, neither is trusted -- and the result is compared against the
href in the same card. A code that points somewhere the words do not is worse
than no code: the visitor has no way to know.
"""
import re, sys, base64, io
from PIL import Image
import numpy as np, cv2
from pyzbar.pyzbar import decode as zbar

PAGE = 'index.html'
# card label -> the address the QR must carry
EXPECT = {
    'Clinic registration QR code':
        'https://docs.google.com/forms/d/e/1FAIpQLSew0h9ZESmDLy7uWTP3snK9qpZsU0TtdLvz0cb--WGYHU8r8w/viewform',
    'More info QR code':  'https://my.facerinna.com/',
    'WhatsApp QR code':   'https://wa.me/message/YKYI736CG4FZH1',
}

# Codes you can press. "More info" is absent on purpose: it encodes this very
# page, and a link back to where you already are looks broken.
TAPPABLE = {'Clinic registration QR code', 'WhatsApp QR code'}

def decode(png: bytes):
    im = Image.open(io.BytesIO(png))
    a = zbar(im)
    a = a[0].data.decode() if len(a) == 1 else None
    arr = np.array(im.convert('L'))
    ok, txt, _, _ = cv2.QRCodeDetector().detectAndDecodeMulti(
        cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR))
    b = txt[0] if ok and len(txt) == 1 else None
    return (a if a == b else None), im.size

src = open(PAGE, encoding='utf-8').read()
seg = src[src.index('<div class="qr-grid reveal">'):src.index('<!-- INTERACTIVE GAME -->')]
cards = re.findall(r'<div class="qr-card">(.*?)\n      </div>', seg, re.S)

bad = 0
def check(label, cond):
    global bad
    if not cond: bad += 1
    print(('  PASS  ' if cond else '  FAIL  ') + label)

check(f'{len(EXPECT)} cards in the segment', len(cards) == len(EXPECT))
seen = set()
for card in cards:
    m = re.search(r'<img src="data:image/png;base64,([A-Za-z0-9+/=]+)" alt="([^"]*)"', card)
    if not m:
        check('a card with no QR image', False); continue
    alt = m.group(2); seen.add(alt)
    url, size = decode(base64.b64decode(m.group(1)))
    check(f'{alt}: both decoders agree', url is not None)
    if url is None: continue
    check(f'{alt}: encodes {url}', url == EXPECT.get(alt))
    tap  = re.search(r'<a class="qr-tap" href="([^"]+)"', card)
    link = re.search(r'<a class="qr-link" href="([^"]+)"', card)
    if alt in TAPPABLE:
        check(f'{alt}: the code itself is pressable', tap is not None)
        check(f'{alt}: pressing it goes where scanning it goes',
              tap is not None and tap.group(1) == url)
        check(f'{alt}: and it is not a second tab stop for the same place',
              'tabindex="-1"' in card)
    else:
        check(f'{alt}: this one is deliberately not pressable', tap is None)
    if link:
        check(f'{alt}: the printed link is the same address', link.group(1) == url)
    # nothing in the card may point anywhere else
    others = [h for h in re.findall(r'href="([^"]+)"', card) if h != url]
    check(f'{alt}: no stray address in the card' + (': ' + others[0] if others else ''),
          not others)
    check(f'{alt}: a quiet zone is present', size[0] >= 29)

check('no card is missing', seen == set(EXPECT))
print('\nall good' if not bad else '\nSOMETHING IS WRONG')
sys.exit(1 if bad else 0)
