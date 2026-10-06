"""Check delivered hashes, optionally also the package ZIP. Python standard library.

Usage: python3 verify_package.py [path/to/washed-jazz-band-package.zip]
Run before editing or regenerating, since the manifest is an edition snapshot.
"""
from pathlib import Path
import hashlib
import json
import sys
import zipfile

folder = Path(__file__).resolve().parent
manifest = json.loads((folder / 'manifest.json').read_text())
errors = []
for relative, record in manifest['files'].items():
    path = folder / relative
    if not path.is_file():
        errors.append('Missing: ' + relative)
    elif hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
        errors.append('Changed: ' + relative)

if len(sys.argv) > 1:
    with zipfile.ZipFile(sys.argv[1]) as archive:
        bad = archive.testzip()
        if bad:
            errors.append('ZIP CRC failure: ' + bad)
        expected = {'washed-jazz-band/' + name for name in manifest['files']}
        expected.add('washed-jazz-band/manifest.json')
        if set(archive.namelist()) != expected:
            errors.append('ZIP member list differs from manifest')
        for relative, record in manifest['files'].items():
            member = 'washed-jazz-band/' + relative
            if member in archive.namelist():
                digest = hashlib.sha256(archive.read(member)).hexdigest()
                if digest != record['sha256']:
                    errors.append('ZIP changed: ' + relative)
        if archive.read('washed-jazz-band/manifest.json') != (folder / 'manifest.json').read_bytes():
            errors.append('ZIP manifest differs from local edition')

if errors:
    print('\n'.join(errors))
    sys.exit(1)
print(f"Verified {len(manifest['files'])} file hashes" +
      (' and ZIP integrity.' if len(sys.argv) > 1 else '.'))
