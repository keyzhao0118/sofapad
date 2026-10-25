"""Publish both desktop platforms atomically from a successful tagged CI run."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--version', required=True)
parser.add_argument('--assets', type=Path, required=True)
parser.add_argument('--commit', required=True)
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
version = args.version
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise SystemExit('Version must be MAJOR.MINOR.PATCH')
if not re.fullmatch(r'[0-9a-f]{40}', args.commit):
    raise SystemExit('A full source commit SHA is required')
versions = [json.loads((root / 'Web/package.json').read_text(encoding='utf-8'))['version'],
            plistlib.loads((root / 'MacApp/Info.plist').read_bytes())['CFBundleShortVersionString'],
            ET.parse(root / 'WindowsApp/Directory.Build.props').findtext('.//Version')]
if any(v != version for v in versions):
    raise SystemExit('Tag, Windows, Mac and web versions must agree')
notes = (root / f'docs/releases/{version}.md').read_text(encoding='utf-8')
names = [f'SofaPad-{version}-{suffix}' for suffix in
         ('windows-x64-setup.exe', 'windows-x64.zip', 'macos-arm64.pkg', 'macos-arm64.zip')]
paths = [args.assets / name for name in names]
if any(not p.is_file() or p.stat().st_size < 1024 for p in paths):
    raise SystemExit('All four nonempty desktop packages must exist before publication')
checksum = args.assets / f'SofaPad-{version}-SHA256SUMS.txt'
checksum.write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in paths), encoding='ascii')
paths.append(checksum)
print('Validated source versions and packages: ' + ', '.join(p.name for p in paths))
if args.dry_run:
    raise SystemExit(0)
token = os.environ.get('GH_TOKEN')
if not token:
    raise SystemExit('GH_TOKEN is required; never put credentials in command arguments or files')
repo = os.environ.get('GITHUB_REPOSITORY', 'keyzhao0118/sofapad')
if repo != 'keyzhao0118/sofapad':
    raise SystemExit('Unexpected release repository')
api = f'https://api.github.com/repos/{repo}'
headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
           'User-Agent': 'SofaPad-release', 'X-GitHub-Api-Version': '2022-11-28'}
def request(method, url, payload=None, binary=None):
    body = binary if binary is not None else json.dumps(payload).encode() if payload is not None else None
    kind = 'application/octet-stream' if binary is not None else 'application/json'
    req = urllib.request.Request(url, data=body, headers={**headers, 'Content-Type': kind}, method=method)
    with urllib.request.urlopen(req, timeout=240) as response:
        data = response.read()
        return json.loads(data) if data else None

tag = 'v' + version
actual = subprocess.check_output(['git', 'rev-parse', f'{tag}^{{commit}}'], cwd=root, text=True).strip()
if actual != args.commit:
    raise SystemExit('Refusing to publish: tag differs from the tested source commit')
try:
    release = request('GET', api + '/releases/tags/' + tag)
except urllib.error.HTTPError as error:
    if error.code != 404:
        raise
    release = request('POST', api + '/releases', {'tag_name': tag, 'target_commitish': args.commit,
        'name': f'SofaPad {version} - Windows / Mac', 'body': notes, 'draft': True, 'prerelease': False})
if not release['draft']:
    raise SystemExit('This release is already public; refusing to replace published files')
existing = {a['name']: a for a in request('GET', api + f"/releases/{release['id']}/assets?per_page=100")}
for path in paths:
    digest = 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()
    asset = existing.get(path.name)
    if asset is None:
        upload = release['upload_url'].split('{')[0] + '?name=' + urllib.parse.quote(path.name)
        asset = request('POST', upload, binary=path.read_bytes())
    if asset.get('size') != path.stat().st_size or asset.get('digest') != digest or asset.get('state') != 'uploaded':
        raise SystemExit('Asset verification failed; draft retained: ' + path.name)
    print('Verified uploaded asset: ' + path.name)
request('PATCH', api + f"/releases/{release['id']}", {'name': f'SofaPad {version} - Windows / Mac',
        'body': notes, 'draft': False, 'prerelease': False, 'make_latest': 'true'})
print(f'Published https://github.com/{repo}/releases/tag/{tag}')
