# FACERINNA Showcase

Interactive booth dashboard for the Persatuan Dermatologi Malaysia AGM.
Live: https://my.facerinna.com/

## Verification

The QR test decodes the images embedded in `index.html` with both zbar and
OpenCV, then checks the decoded destinations against the visible links. It
requires Python 3.13, the native zbar library, Pillow, NumPy,
opencv-python-headless, and pyzbar. Exact Python versions are pinned in
`tools/requirements.txt`.

```sh
# Debian/Ubuntu: install the native decoder used by pyzbar
sudo apt-get install libzbar0
python -m pip install -r tools/requirements.txt
python tools/qr-test.py
```

Browser verification scripts use the checkout's own Playwright package and
resolve site files relative to the checkout, so they can run from any working
directory:

```sh
npm ci
npx playwright install --with-deps chromium
node tools/booth-board.test.mjs
```

The Playwright and http-server versions are pinned in `package-lock.json`.
The QR check also runs on every pull request through `.github/workflows/verify.yml`.
