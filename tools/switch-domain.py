#!/usr/bin/env python3
"""Move the booth from wanshah07.github.io to my.facerinna.com.

Run it only once the DNS record is live. It refuses to do anything before that,
because the CNAME file makes GitHub Pages redirect the working github.io URL to
the new host — so adding it early takes the booth down rather than moving it.

    python3 tools/switch-domain.py --check     # just the DNS
    python3 tools/switch-domain.py             # do the move
    python3 tools/switch-domain.py --force     # do it anyway (don't)

It changes four things and nothing else:
  1. CNAME              — what tells Pages to answer on the new host
  2. the More Info QR   — a static PNG in the markup, re-drawn for the new URL
  3. README             — the live link
  4. build-artifact.py  — the base the artifact points its file links at
"""
import argparse, base64, io, os, re, subprocess, sys

HOST = 'my.facerinna.com'
OLD  = 'https://wanshah07.github.io/facerinna-showcase/'
NEW  = 'https://my.facerinna.com/'
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRIV = '/home/user/malaysian-regulatory-affairs/facerinna-agm.html'
BUILD = ('/tmp/claude-0/-home-user-malaysian-regulatory-affairs/'
         'a350608a-af0e-5a88-a9b8-2006caaa3055/scratchpad/build-artifact.py')


def resolves():
    """True only if a public resolver really answers for the host.

    getent and gethostbyname have both reported this host as resolving in this
    sandbox while every public resolver returned NXDOMAIN, so neither is asked.
    """
    try:
        import dns.resolver
    except ImportError:
        print('dnspython missing — cannot check DNS honestly. Install it or use --force.')
        return False
    ok = []
    for server in ('1.1.1.1', '8.8.8.8'):
        r = dns.resolver.Resolver(configure=False)
        r.nameservers = [server]; r.timeout = 6; r.lifetime = 10
        answer = None
        for rdtype in ('CNAME', 'A'):
            try:
                answer = [x.to_text() for x in r.resolve(HOST, rdtype)]
                break
            except Exception:
                continue
        print('  %-9s %s -> %s' % (server, HOST, answer or 'NXDOMAIN'))
        ok.append(bool(answer))
    return all(ok)


def qr_png(url, box=10, border=2):
    import qrcode
    img = qrcode.make(url, box_size=box, border=border).convert('L')
    buf = io.BytesIO(); img.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def swap_qr(html, alt, url):
    """Replace the base64 of the <img> carrying this alt text."""
    i = html.index('alt="%s"' % alt)
    head = 'src="data:image/png;base64,'
    j = html.rfind(head, 0, i)
    k = html.index('"', j + len(head))
    return html[:j + len(head)] + qr_png(url) + html[k:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='only report DNS')
    ap.add_argument('--force', action='store_true', help='switch even without DNS')
    args = ap.parse_args()

    print('DNS for %s:' % HOST)
    live = resolves()
    print('  ->', 'live' if live else 'NOT live yet')
    if args.check:
        return 0
    if not live and not args.force:
        print('\nStopping. Add this at the registrar first, then run again:')
        print('    CNAME   host: my   value: wanshah07.github.io')
        print('The booth link keeps working until then.')
        return 1

    show = os.path.join(HERE, 'index.html')
    with io.open(show, encoding='utf-8') as f:
        html = f.read()
    html = swap_qr(html, 'More info QR code', NEW)
    for path in (show, PRIV):
        with io.open(path, 'w', encoding='utf-8') as f:
            f.write(html)
    print('QR redrawn for', NEW)

    with io.open(os.path.join(HERE, 'CNAME'), 'w', encoding='utf-8') as f:
        f.write(HOST + '\n')
    print('CNAME written')

    rd = os.path.join(HERE, 'README.md')
    with io.open(rd, encoding='utf-8') as f:
        t = f.read()
    with io.open(rd, 'w', encoding='utf-8') as f:
        f.write(t.replace(OLD, NEW))
    print('README updated')

    if os.path.exists(BUILD):
        with io.open(BUILD, encoding='utf-8') as f:
            t = f.read()
        with io.open(BUILD, 'w', encoding='utf-8') as f:
            f.write(t.replace(OLD, NEW))
        print('artifact base updated')
    else:
        print('artifact build script not on this machine — set BASE to', NEW)

    print('\nNow commit both repos and republish the artifact.')
    print('Pages takes a few minutes to issue the certificate; until it does,')
    print('the new host serves a warning rather than the booth.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
