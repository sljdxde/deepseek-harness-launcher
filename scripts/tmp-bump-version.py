# One-shot: bump the four version spots from 0.4.1 to 0.5.0-1.1-SNAPSHOT
# (Windows box has no zsh, so scripts/bump-version.sh cannot run here; this does
# exactly what it does: Info.plist, InstallerInfo.plist, README.md, README.en.md).
import io
import re

OLD = '0.4.1'
NEW = '0.5.0-1.1-SNAPSHOT'
edits = [
    ('Resources/Info.plist', None),
    ('Resources/InstallerInfo.plist', None),
    ('README.md', '当前 App 版本为 `'),
    ('README.en.md', 'current app version is `'),
]

for path, anchor in edits:
    s = io.open(path, encoding='utf-8', newline='').read()
    if anchor is None:
        # plist: first CFBundleShortVersionString string value
        pat = re.compile(r'(<key>CFBundleShortVersionString</key>\s*<string>)' + re.escape(OLD) + r'(</string>)')
        n = len(pat.findall(s))
        assert n == 1, (path, n)
        s = pat.sub(lambda m: m.group(1) + NEW + m.group(2), s)
    else:
        assert s.count(anchor + OLD) == 1, (path, s.count(anchor + OLD))
        s = s.replace(anchor + OLD, anchor + NEW)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('bumped', path)

# read back and assert all four agree
values = []
for path, anchor in edits:
    s = io.open(path, encoding='utf-8', newline='').read()
    if anchor is None:
        m = re.search(r'<key>CFBundleShortVersionString</key>\s*<string>([^<]+)</string>', s)
        values.append((path, m.group(1)))
    else:
        m = re.search(re.escape(anchor) + r'([^`]+)`', s)
        values.append((path, m.group(1)))
for path, value in values:
    print(path, '->', value)
assert all(value == NEW for _, value in values), 'version spots disagree'
print('all four spots agree on', NEW)
